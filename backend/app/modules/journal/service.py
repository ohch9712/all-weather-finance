from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, localcontext
from typing import Literal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.core.errors import AppError, field_error
from app.core.schemas import Page
from app.core.time import KST
from app.modules.imports.registry import ImportResult
from app.modules.journal import repository as repo
from app.modules.journal.costs import DEFAULT_RATES
from app.modules.journal.models import Trade, TradeCostSettings, TradeNote
from app.modules.journal.schemas import (
    CostEstimate,
    CostSettings,
    CurrencyStats,
    DailyPnl,
    MonthlyPnl,
    NoteInput,
    NoteOut,
    Position,
    SymbolPnl,
    TradeDetail,
    TradeInput,
    TradeOut,
    TradePerformance,
    TradeStats,
)

ZERO = Decimal(0)


def money(value: Decimal, currency: str) -> str:
    with localcontext() as context:
        context.prec = 80
        result = value.quantize(
            Decimal("1" if currency == "KRW" else "0.01"), rounding=ROUND_HALF_UP
        )
    return format(abs(result) if result == 0 else result, "f")


def quantity(value: Decimal) -> str:
    return (
        format(value, "f").rstrip("0").rstrip(".")
        if "." in format(value, "f")
        else format(value, "f")
    )


def trade_out(trade):
    local = trade.traded_at.astimezone(KST)
    data = {name: getattr(trade, name) for name in TradeOut.model_fields if hasattr(trade, name)}
    data.update(
        traded_on=local.date(), traded_time=local.strftime("%H:%M") if trade.time_known else None
    )
    data.update(
        quantity=quantity(trade.quantity),
        **{name: money(getattr(trade, name), trade.currency) for name in ("price", "fee", "tax")},
    )
    return TradeOut(**data)


def require_trade(db, user_id, trade_id):
    trade = repo.owned_trade(db, user_id, trade_id)
    if trade is None:
        raise AppError(404, "NOT_FOUND", "매매 기록을 찾을 수 없습니다.")
    return trade


def require_note(db, user_id, note_id):
    note = repo.owned_note(db, user_id, note_id)
    if note is None:
        raise AppError(404, "NOT_FOUND", "노트를 찾을 수 없습니다.")
    return note


def validated(model, data):
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise RequestValidationError(
            [{**error, "loc": ("body", *error["loc"])} for error in exc.errors()]
        ) from exc


def trade_values(data):
    values = data.model_dump(exclude={"traded_on", "traded_time"})
    values["traded_at"] = datetime.combine(
        data.traded_on, time.fromisoformat(data.traded_time or "09:00"), KST
    ).astimezone(UTC)
    values["time_known"] = data.traded_time is not None
    return values


def create_trade(db, user_id, data):
    values = trade_values(data)
    missing = {"fee", "tax"} - data.model_fields_set
    if data.market in {"KRX", "US"} and missing:
        costs = estimate_trade_costs(
            db,
            user_id,
            market=data.market,
            side=data.side,
            quantity=data.quantity,
            price=data.price,
            is_etf=is_domestic_etf(db, data.market, data.symbol_code),
        )
        for name in missing:
            values[name] = getattr(costs, name)
        values["cost_estimated"] = True
    return trade_out(repo.save(db, Trade(user_id=user_id, **values)))


def update_trade(db, user_id, trade_id, patch):
    trade = require_trade(db, user_id, trade_id)
    # 응답의 통화별 반올림 값 대신 DB 원본 정밀도로 부분 수정을 합친다.
    existing = trade_out(trade).model_dump(include=set(TradeInput.model_fields))
    existing.update({name: getattr(trade, name) for name in ("quantity", "price", "fee", "tax")})
    data = validated(TradeInput, {**existing, **patch})
    for name, value in trade_values(data).items():
        setattr(trade, name, value)
    if "fee" in patch or "tax" in patch:
        trade.cost_estimated = False
    return trade_out(repo.save(db, trade))


def delete_trade(db, user_id, trade_id):
    repo.delete(db, require_trade(db, user_id, trade_id))


def list_trades(db, user_id, page, **filters):
    items, total = repo.trade_page(db, user_id, page, **filters)
    return Page(items=[trade_out(item) for item in items], total=total, **page.model_dump())


def check_note_trade(db, user_id, data):
    if data.trade_id and repo.owned_trade(db, user_id, data.trade_id) is None:
        raise field_error("tradeId", "내 매매 기록을 선택해 주세요.")


def create_note(db, user_id, data):
    check_note_trade(db, user_id, data)
    return NoteOut.model_validate(repo.save(db, TradeNote(user_id=user_id, **data.model_dump())))


def update_note(db, user_id, note_id, patch):
    note = require_note(db, user_id, note_id)
    existing = NoteOut.model_validate(note).model_dump(include=set(NoteInput.model_fields))
    data = validated(NoteInput, {**existing, **patch})
    check_note_trade(db, user_id, data)
    for name, value in data.model_dump().items():
        setattr(note, name, value)
    return NoteOut.model_validate(repo.save(db, note))


def delete_note(db, user_id, note_id):
    repo.delete(db, require_note(db, user_id, note_id))


def list_notes(db, user_id, page, **filters):
    if filters.get("trade_id"):
        require_trade(db, user_id, filters["trade_id"])
    items, total = repo.note_page(db, user_id, page, **filters)
    return Page(
        items=[NoteOut.model_validate(item) for item in items], total=total, **page.model_dump()
    )


@dataclass
class Holding:
    latest: Trade
    first_on: date
    quantity: Decimal = ZERO
    basis: Decimal = ZERO
    realized: Decimal = ZERO
    count: int = 0
    oversold: bool = False


@dataclass
class Result:
    trade: Trade
    pnl: Decimal | None
    oversold: bool


def calculate(trades):
    holdings = {}
    results = []
    with localcontext() as context:
        context.prec = 80
        for trade in trades:
            key = (trade.market, trade.symbol_code, trade.currency)
            holding = holdings.setdefault(
                key, Holding(trade, trade.traded_at.astimezone(KST).date())
            )
            holding.latest = trade
            holding.count += 1
            pnl = None
            oversold = False
            if trade.side == "buy":
                holding.quantity += trade.quantity
                holding.basis += trade.quantity * trade.price + trade.fee + trade.tax
            else:
                oversold = trade.quantity > holding.quantity
                holding.oversold |= oversold
                available = min(trade.quantity, holding.quantity)
                if available > 0:
                    average = holding.basis / holding.quantity
                    pnl = (
                        available * trade.price
                        - (trade.fee + trade.tax) * available / trade.quantity
                        - average * available
                    )
                    holding.basis -= average * available
                    holding.quantity -= available
                    if holding.quantity == 0:
                        holding.basis = ZERO
                    holding.realized += pnl
            results.append(Result(trade, pnl, oversold))
    return holdings, results


def get_positions(
    db, user_id, *, include_closed: bool = False, with_quotes: bool = False
) -> list[Position]:
    holdings, _ = calculate(repo.all_trades(db, user_id))
    items = []
    for key, holding in sorted(holdings.items()):
        if not include_closed and holding.quantity <= 0:
            continue
        trade = holding.latest
        with localcontext() as context:
            context.prec = 80
            average = holding.basis / holding.quantity if holding.quantity else ZERO
        items.append(
            Position(
                market=key[0],
                symbol_code=key[1],
                currency=key[2],
                symbol_name=trade.symbol_name,
                quantity=quantity(holding.quantity),
                avg_cost=money(average, trade.currency),
                cost_basis=money(holding.basis, trade.currency),
                realized_pnl=money(holding.realized, trade.currency),
                first_traded_on=holding.first_on,
                last_traded_on=trade.traded_at.astimezone(KST).date(),
                trade_count=holding.count,
                has_oversold=holding.oversold,
            )
        )
    if with_quotes:
        attach_quotes(items, holdings)
    return items


def attach_quotes(items, holdings):
    from app.integrations.brokers.errors import BrokerError
    from app.modules.market.service import get_quotes

    codes = [p.symbol_code for p in items if p.market == "KRX"]
    try:
        quotes = {q.code: q for q in get_quotes(codes)} if codes else {}
    except (AppError, BrokerError):
        quotes = {}
    for item in items:
        quote = quotes.get(item.symbol_code) if item.market == "KRX" else None
        if quote is None:
            continue
        holding = holdings[(item.market, item.symbol_code, item.currency)]
        with localcontext() as context:
            context.prec = 80
            price = Decimal(quote.price)
            amount = price * holding.quantity
            pnl = amount - holding.basis
            item.current_price = quantity(price)
            item.eval_amount = money(amount, item.currency)
            item.unrealized_pnl = money(pnl, item.currency)
            item.unrealized_pnl_rate = (
                float(round(pnl / holding.basis * 100, 2)) if holding.basis else None
            )
            item.quote_source = quote.source


def get_detail(db, user_id, trade_id):
    trade = require_trade(db, user_id, trade_id)
    _, results = calculate(repo.all_trades(db, user_id))
    result = next(item for item in results if item.trade.id == trade_id)
    return TradeDetail(
        trade=trade_out(trade),
        realized_pnl=money(result.pnl, trade.currency) if result.pnl is not None else None,
        oversold=result.oversold,
        notes=[NoteOut.model_validate(note) for note in repo.trade_notes(db, user_id, trade_id)],
    )


def performance(result):
    trade = result.trade
    return TradePerformance(
        trade_id=trade.id,
        symbol_name=trade.symbol_name,
        realized_pnl=money(result.pnl, trade.currency),
        traded_on=trade.traded_at.astimezone(KST).date(),
    )


def get_trade_stats(db, user_id, start: date | None = None, end: date | None = None) -> TradeStats:
    with localcontext() as context:
        context.prec = 80
        return _trade_stats(db, user_id, start, end)


def _trade_stats(db, user_id, start, end):
    trades = repo.all_trades(db, user_id)
    _, results = calculate(trades)
    grouped = defaultdict(list)
    monthly = defaultdict(lambda: ZERO)
    daily = defaultdict(lambda: ZERO)
    symbols = defaultdict(list)
    for result in results:
        trade = result.trade
        day = trade.traded_at.astimezone(KST).date()
        if trade.side != "sell" or (start and day < start) or (end and day > end):
            continue
        grouped[trade.currency].append(result)
        symbols[(trade.market, trade.symbol_code, trade.currency)].append(result)
        if result.pnl is not None:
            monthly[(day.strftime("%Y-%m"), trade.currency)] += result.pnl
            daily[(day, trade.currency)] += result.pnl
    by_currency = []
    for currency in sorted({trade.currency for trade in trades}):
        sells = grouped[currency]
        calculated = [item for item in sells if item.pnl is not None]
        wins = [item.pnl for item in calculated if item.pnl > 0]
        losses = [item.pnl for item in calculated if item.pnl < 0]
        by_currency.append(
            CurrencyStats(
                currency=currency,
                realized_pnl=money(sum((item.pnl for item in calculated), ZERO), currency),
                win_count=len(wins),
                loss_count=len(losses),
                win_rate=round(len(wins) / (len(wins) + len(losses)) * 100, 2)
                if wins or losses
                else None,
                sell_count=len(sells),
                avg_win=money(sum(wins, ZERO) / len(wins), currency) if wins else None,
                avg_loss=money(sum(losses, ZERO) / len(losses), currency) if losses else None,
                best_trade=performance(max(calculated, key=lambda item: item.pnl))
                if calculated
                else None,
                worst_trade=performance(min(calculated, key=lambda item: item.pnl))
                if calculated
                else None,
            )
        )
    return TradeStats(
        by_currency=by_currency,
        monthly=[
            MonthlyPnl(month=key[0], currency=key[1], realized_pnl=money(value, key[1]))
            for key, value in sorted(monthly.items())
        ],
        daily=[
            DailyPnl(date=key[0], currency=key[1], realized_pnl=money(value, key[1]))
            for key, value in sorted(daily.items())
        ],
        by_symbol=[
            SymbolPnl(
                symbol_code=key[1],
                currency=key[2],
                symbol_name=items[-1].trade.symbol_name,
                realized_pnl=money(
                    sum((item.pnl for item in items if item.pnl is not None), ZERO), key[2]
                ),
                sell_count=len(items),
            )
            for key, items in sorted(symbols.items())
        ],
    )


def get_cost_settings(db, user_id) -> CostSettings:
    settings = repo.cost_settings(db, user_id)
    rates = (
        {name: format(getattr(settings, name), "f") for name in DEFAULT_RATES}
        if settings
        else {name: format(value, "f") for name, value in DEFAULT_RATES.items()}
    )
    return CostSettings(
        **rates, is_default=settings is None, updated_at=settings.updated_at if settings else None
    )


def save_cost_settings(db, user_id, data) -> CostSettings:
    settings = repo.cost_settings(db, user_id) or TradeCostSettings(user_id=user_id)
    for name, value in data.model_dump().items():
        setattr(settings, name, value)
    repo.save(db, settings)
    return get_cost_settings(db, user_id)


def reset_cost_settings(db, user_id) -> CostSettings:
    settings = repo.cost_settings(db, user_id)
    if settings:
        repo.delete(db, settings)
    return get_cost_settings(db, user_id)


@dataclass(frozen=True)
class TradeCosts:
    fee: Decimal
    tax: Decimal


def estimate_trade_costs(
    db,
    user_id: UUID,
    *,
    market: Literal["KRX", "US"],
    side: Literal["buy", "sell"],
    quantity: Decimal,
    price: Decimal,
    is_etf: bool = False,
) -> TradeCosts:
    rates = get_cost_settings(db, user_id)
    with localcontext() as context:
        context.prec = 80
        amount = quantity * price
        unit = Decimal("1" if market == "KRX" else "0.01")
        rate = rates.krx_commission_rate if market == "KRX" else rates.us_commission_rate
        fee = (amount * Decimal(rate) / 100).quantize(unit, rounding=ROUND_DOWN)
        tax_rate = (
            Decimal(rates.krx_sell_tax_rate)
            if market == "KRX" and side == "sell" and not is_etf
            else ZERO
        )
        tax = (amount * tax_rate / 100).quantize(unit, rounding=ROUND_DOWN)
    return TradeCosts(fee=fee, tax=tax)


def is_domestic_etf(db, market, symbol_code):
    if market != "KRX" or not symbol_code:
        return False
    from app.modules.market.service import search_stocks

    items = search_stocks(db, symbol_code, limit=1)
    return bool(items and items[0].code == symbol_code and items[0].kind == "etf")


def get_cost_estimate(db, user_id, data) -> CostEstimate:
    is_etf = is_domestic_etf(db, data.market, data.symbol_code)
    costs = estimate_trade_costs(
        db,
        user_id,
        market=data.market,
        side=data.side,
        quantity=data.quantity,
        price=data.price,
        is_etf=is_etf,
    )
    return CostEstimate(
        fee=format(costs.fee, "f"),
        tax=format(costs.tax, "f"),
        is_etf=is_etf,
        rates=get_cost_settings(db, user_id),
    )


@dataclass(frozen=True)
class TradeImportRow:
    traded_at: datetime
    time_known: bool
    market: Literal["KRX", "US", "OTHER"]
    symbol_code: str
    symbol_name: str
    side: Literal["buy", "sell"]
    quantity: Decimal
    price: Decimal
    currency: Literal["KRW", "USD"]
    fee: Decimal | None = None
    tax: Decimal | None = None
    broker: str | None = None


def imported_values(db, user_id, row):
    from dataclasses import asdict

    values = asdict(row)
    values.pop("market_explicit", None)
    values.pop("currency_explicit", None)
    values["cost_estimated"] = row.fee is None or row.tax is None
    if values["cost_estimated"]:
        costs = estimate_trade_costs(
            db,
            user_id,
            market=row.market,
            side=row.side,
            quantity=row.quantity,
            price=row.price,
            is_etf=is_domestic_etf(db, row.market, row.symbol_code),
        )
        for name in ("fee", "tax"):
            if values[name] is None:
                values[name] = getattr(costs, name)
    return values


def import_trades(
    db, user_id, rows: list[TradeImportRow], *, source: str, batch_id: UUID | None = None
) -> ImportResult:
    from dataclasses import replace
    from hashlib import sha256

    from app.modules.imports.registry import RowError
    from app.modules.journal.import_kind import _PendingSymbolTradeImportRow
    from app.modules.market.service import search_stocks

    repo.lock_imports(db, user_id)
    hashes = {t.dedup_hash for t in repo.all_trades(db, user_id) if t.dedup_hash}
    occurrences = defaultdict(int)
    result = ImportResult(inserted=0, skipped_duplicates=0, failed=0, errors=[])
    for number, row in enumerate(rows, 1):
        if not row.symbol_code:
            matches = [
                s
                for s in search_stocks(db, row.symbol_name, limit=5)
                if s.name == row.symbol_name and s.code.isdigit() and len(s.code) == 6
            ]
            if len(matches) != 1:
                result.failed += 1
                result.errors.append(
                    RowError(
                        number,
                        "symbolCode",
                        "종목코드를 찾지 못했습니다. 종목코드 열을 매핑해 주세요.",
                    )
                )
                continue
            mismatch = (
                ("market", row.market)
                if row.market != "KRX"
                and (not isinstance(row, _PendingSymbolTradeImportRow) or row.market_explicit)
                else ("currency", row.currency)
                if row.currency != "KRW"
                and (not isinstance(row, _PendingSymbolTradeImportRow) or row.currency_explicit)
                else None
            )
            if mismatch:
                result.failed += 1
                result.errors.append(
                    RowError(
                        number,
                        mismatch[0],
                        "찾은 종목의 시장·통화와 맞지 않습니다. 종목코드 열을 매핑해 주세요.",
                    )
                )
                continue
            row = replace(row, symbol_code=matches[0].code, market="KRX", currency="KRW")
        local = row.traded_at.astimezone(KST)
        known_time = local.strftime("%H:%M") if row.time_known else ""
        key = (
            f"{user_id}|{local.date()}|{known_time}|{row.symbol_code}|{row.side}|"
            f"{quantity(row.quantity)}|{quantity(row.price)}"
        )
        count = occurrences[key]
        occurrences[key] += 1
        digest = sha256((key + (f"|{count}" if count else "")).encode()).hexdigest()
        if digest in hashes:
            result.skipped_duplicates += 1
            continue
        repo.add_trade(
            db,
            dict(
                user_id=user_id,
                source=source,
                dedup_hash=digest,
                **imported_values(db, user_id, row),
            ),
        )
        hashes.add(digest)
        result.inserted += 1
    return result


def execution_match(trade):
    return (
        trade.traded_at.astimezone(KST).date(),
        trade.symbol_code,
        trade.side,
        trade.quantity,
        trade.price,
    )


def sync_trades(db, user_id, data):
    from dataclasses import asdict

    from app.core import time as clock
    from app.integrations.brokers.errors import BrokerError
    from app.modules.journal.schemas import SyncResult
    from app.modules.market.service import get_user_broker_client, list_connections

    if data.end > clock.today_kst():
        raise field_error("to", "종료일은 오늘까지 선택해 주세요.")
    if data.start > data.end or (data.end - data.start).days >= 90:
        raise field_error("from", "조회 기간은 시작일부터 최대 90일로 선택해 주세요.")
    try:
        client = get_user_broker_client(db, user_id, data.connection_id)
        connection = next(c for c in list_connections(db, user_id) if c.id == data.connection_id)
        executions = client.get_executions(data.start, data.end)
    except BrokerError as exc:
        raise exc.as_app_error() from None
    now = clock.now_utc()
    result = SyncResult(start=data.start, end=data.end, synced_at=now)
    try:
        repo.lock_imports(db, user_id)
        trades = repo.all_trades(db, user_id)
        external = {(t.connection_id, t.external_id): t for t in trades if t.external_id}
        unmatched = defaultdict(list)
        for trade in trades:
            if trade.connection_id is None and trade.source in {"manual", "import"}:
                unmatched[execution_match(trade)].append(trade)
        for execution in executions:
            market = (
                "KRX"
                if execution.market in {"KOSPI", "KOSDAQ", "KONEX"}
                or (execution.market == "OTHER" and execution.currency == "KRW")
                else "US"
            )
            row = TradeImportRow(
                execution.executed_at,
                True,
                market,
                execution.code,
                execution.name,
                execution.side,
                execution.quantity,
                execution.price,
                execution.currency,
                execution.fee,
                execution.tax,
                connection.provider if connection.provider in {"kiwoom", "toss"} else None,
            )
            existing = external.get((connection.id, execution.external_id))
            if existing:
                values = asdict(row)
                for name in ("fee", "tax"):
                    if values[name] is None:
                        values.pop(name)
                if row.fee is not None and row.tax is not None:
                    values["cost_estimated"] = False
                values.update(source=connection.provider, account_label=connection.label)
                changed = any(getattr(existing, key) != value for key, value in values.items())
                if changed:
                    for key, value in values.items():
                        setattr(existing, key, value)
                    result.updated += 1
                else:
                    result.unchanged += 1
                existing.synced_at = now
                continue
            key = (
                execution.executed_at.astimezone(KST).date(),
                execution.code,
                execution.side,
                execution.quantity,
                execution.price,
            )
            if unmatched[key]:
                unmatched[key].pop()
                result.skipped_duplicates += 1
                continue
            values = imported_values(db, user_id, row)
            values.update(source=connection.provider, account_label=connection.label)
            trade = repo.add_trade(
                db,
                dict(
                    user_id=user_id,
                    **values,
                    connection_id=connection.id,
                    external_id=execution.external_id,
                    synced_at=now,
                ),
            )
            external[(connection.id, execution.external_id)] = trade
            result.inserted += 1
            if values["cost_estimated"]:
                result.cost_estimated += 1
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def sync_status(db, user_id):
    from app.modules.journal.schemas import SyncStatus, SyncStatusItem
    from app.modules.market.service import list_connections

    trades = repo.all_trades(db, user_id)
    items = []
    for connection in list_connections(db, user_id):
        owned = [t for t in trades if t.connection_id == connection.id]
        items.append(
            SyncStatusItem(
                connection_id=connection.id,
                label=connection.label,
                provider=connection.provider,
                trade_count=len(owned),
                last_synced_at=max((t.synced_at for t in owned if t.synced_at), default=None),
            )
        )
    return SyncStatus(items=items)
