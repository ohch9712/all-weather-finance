from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import ROUND_HALF_UP, Decimal, localcontext

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from app.core.errors import AppError
from app.core.schemas import Page
from app.core.time import KST
from app.modules.journal import repository as repo
from app.modules.journal.models import Trade, TradeNote
from app.modules.journal.schemas import (
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
    return trade_out(repo.save(db, Trade(user_id=user_id, **trade_values(data))))


def update_trade(db, user_id, trade_id, patch):
    trade = require_trade(db, user_id, trade_id)
    # 응답의 통화별 반올림 값 대신 DB 원본 정밀도로 부분 수정을 합친다.
    existing = trade_out(trade).model_dump(include=set(TradeInput.model_fields))
    existing.update({name: getattr(trade, name) for name in ("quantity", "price", "fee", "tax")})
    data = validated(TradeInput, {**existing, **patch})
    for name, value in trade_values(data).items():
        setattr(trade, name, value)
    return trade_out(repo.save(db, trade))


def delete_trade(db, user_id, trade_id):
    repo.delete(db, require_trade(db, user_id, trade_id))


def list_trades(db, user_id, page, **filters):
    items, total = repo.trade_page(db, user_id, page, **filters)
    return Page(items=[trade_out(item) for item in items], total=total, **page.model_dump())


def check_note_trade(db, user_id, data):
    if data.trade_id and repo.owned_trade(db, user_id, data.trade_id) is None:
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body", "tradeId"),
                    "msg": "Value error, 내 매매 기록을 선택해 주세요.",
                }
            ]
        )


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


def get_positions(db, user_id, *, include_closed: bool = False) -> list[Position]:
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
    return items


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
