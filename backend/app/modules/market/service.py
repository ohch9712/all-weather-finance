import ipaddress
import threading
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal
from functools import lru_cache
from typing import Annotated, Literal
from uuid import UUID

import httpx
from cryptography.fernet import InvalidToken
from fastapi import Depends
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.crypto import decrypt_str, encrypt_str
from app.core.errors import AppError, field_error
from app.core.time import now_utc
from app.integrations.brokers.base import BrokerClient
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.kiwoom import KiwoomBroker
from app.integrations.brokers.mock import MockBroker
from app.integrations.brokers.toss import TossBroker
from app.modules.market import repository
from app.modules.market.schemas import (
    Connection,
    ConnectionCreate,
    Quote,
    Snapshot,
    StockDetail,
    StockSummary,
)


@dataclass(frozen=True)
class SnapshotRow:
    as_of: date
    code: str
    price: Decimal
    change_rate: Decimal | None
    volume: int | None
    trading_value: int | None
    market_cap: int | None
    per: Decimal | None
    pbr: Decimal | None
    roe: Decimal | None
    eps: Decimal | None
    bps: Decimal | None
    foreign_ratio: Decimal | None
    high_52w: Decimal | None
    low_52w: Decimal | None
    source: str
    created_at: datetime
    name: str
    market: str
    sector: str | None
    kind: Literal["stock", "etf"]


@dataclass(frozen=True)
class SnapshotSet:
    as_of: date | None
    source: str | None
    rows: list[SnapshotRow]


@lru_cache(maxsize=16)
def _make_client(provider, environment, app_key, app_secret, account_no=None) -> BrokerClient:
    if provider == "kiwoom":
        return KiwoomBroker(app_key, app_secret, environment, account_no)
    if provider == "toss":
        return TossBroker(app_key, app_secret, account_no)
    return MockBroker()


def get_market_data_client() -> BrokerClient:
    settings = get_settings()
    return _make_client(
        settings.market_data_provider,
        settings.kiwoom_env,
        settings.kiwoom_app_key
        if settings.market_data_provider == "kiwoom"
        else settings.toss_client_id,
        settings.kiwoom_app_secret
        if settings.market_data_provider == "kiwoom"
        else settings.toss_client_secret,
    )


MarketDataClientDep = Annotated[BrokerClient, Depends(get_market_data_client)]


def _owned_connection(db, user_id, connection_id):
    row = repository.get_connection(db, user_id, connection_id)
    if row is None:
        raise AppError(404, "NOT_FOUND", "증권사 연결을 찾을 수 없습니다.")
    return row


def _connection_client(row):
    try:
        return _make_client(
            row.provider,
            row.environment,
            decrypt_str(row.app_key_enc),
            decrypt_str(row.app_secret_enc),
            decrypt_str(row.account_no_enc) if row.account_no_enc else None,
        )
    except InvalidToken:
        raise BrokerError("BROKER_AUTH_FAILED") from None


def get_user_broker_client(db, user_id, connection_id: UUID) -> BrokerClient:
    row = _owned_connection(db, user_id, connection_id)
    if row.status != "active":
        raise AppError(409, "BROKER_NOT_CONNECTED", "증권사 연결을 먼저 확인해 주세요.")
    if row.provider == "mock" and get_settings().app_env == "production":
        raise AppError(
            409, "BROKER_NOT_CONNECTED", "운영 환경에서는 샘플 증권사를 사용할 수 없습니다."
        )
    try:
        return _connection_client(row)
    except BrokerError as exc:
        raise exc.as_app_error() from None


def search_stocks(
    db, query: str, *, limit: int = 20, kind: Literal["stock", "etf"] | None = None
) -> list[StockSummary]:
    return search_stocks_in_market(db, query, limit=limit, kind=kind)


def search_stocks_in_market(db, query, *, limit=20, market=None, kind=None):
    return [
        StockSummary.model_validate(row)
        for row in repository.search_stocks(db, query, limit, market, kind)
    ]


_quote_cache: dict[tuple[object, str], tuple[float, Quote]] = {}
_quote_lock = threading.Lock()


def quotes_for_client(codes, client):
    result = {}
    with _quote_lock:
        now = time.monotonic()
        for key, (expires, _) in list(_quote_cache.items()):
            if expires <= now:
                del _quote_cache[key]
        for code in dict.fromkeys(codes):
            cached = _quote_cache.get((client, code))
            if cached:
                result[code] = cached[1]
        missing = [code for code in dict.fromkeys(codes) if code not in result]
        if missing:
            try:
                fetched = client.get_quotes(missing)
            except BrokerError:
                # 일부 코드 실패가 다른 코드의 조회를 가리지 않게 개별 조회한다.
                fetched = []
                for code in missing:
                    try:
                        fetched.extend(client.get_quotes([code]))
                    except BrokerError:
                        continue
            for row in fetched:
                if row.code not in missing:
                    continue
                quote = Quote(**asdict(row), source=client.provider)
                result[row.code] = quote
                if len(_quote_cache) >= 5000:
                    _quote_cache.pop(next(iter(_quote_cache)))
                _quote_cache[(client, row.code)] = (time.monotonic() + 30, quote)
    return [result[code] for code in dict.fromkeys(codes) if code in result]


def get_quotes(codes: list[str]) -> list[Quote]:
    return quotes_for_client(codes, get_market_data_client())


def stock_detail_with_client(db, code, client):
    stock = repository.get_stock(db, code)
    if stock is None:
        return None
    snapshot = repository.stock_snapshot(db, code)
    quotes = quotes_for_client([code], client)
    return StockDetail(
        code=stock.code,
        name=stock.name,
        market=stock.market,
        sector=stock.sector,
        kind=stock.kind,
        source=stock.source,
        snapshot=Snapshot(**{name: getattr(snapshot, name) for name in Snapshot.model_fields})
        if snapshot
        else None,
        quote=quotes[0] if quotes else None,
    )


def get_stock_detail(db, code: str) -> StockDetail | None:
    return stock_detail_with_client(db, code, get_market_data_client())


def list_snapshot_rows(db, as_of: date | None = None) -> SnapshotSet:
    as_of = as_of or repository.latest_date(db)
    pairs = repository.snapshot_rows(db, as_of) if as_of else []
    rows = [
        SnapshotRow(
            **{
                name: getattr(snap, name)
                for name in SnapshotRow.__dataclass_fields__
                if name not in {"name", "market", "sector", "kind"}
            },
            name=stock.name,
            market=stock.market,
            sector=stock.sector,
            kind=stock.kind,
        )
        for snap, stock in pairs
    ]
    return SnapshotSet(as_of, rows[0].source if rows else None, rows)


def list_connections(db, user_id):
    return [Connection.model_validate(r) for r in repository.list_connections(db, user_id)]


def create_connection(db, user_id, data: ConnectionCreate):
    settings = get_settings()
    if data.provider == "toss" and data.environment != "real":
        raise field_error("environment", "토스증권은 실전 환경만 지원합니다.")
    if data.provider == "mock":
        if settings.app_env == "production":
            raise field_error("provider", "운영 환경에서는 샘플 증권사를 사용할 수 없습니다.")
        if data.environment != "mock":
            raise field_error("environment", "샘플 증권사는 모의 환경만 지원합니다.")
    label = data.label.strip()
    if not label:
        raise field_error("label", "별칭을 입력해 주세요.")

    # 고정 길이 마스킹으로 varchar(30)을 넘지 않고 항상 끝 4글자까지만 보여 준다.
    def masked(value):
        return "****" + value[-4:] if value else None

    try:
        row = repository.create_connection(
            db,
            dict(
                user_id=user_id,
                provider=data.provider,
                environment=data.environment,
                label=label,
                app_key_enc=encrypt_str(data.app_key),
                app_secret_enc=encrypt_str(data.app_secret),
                account_no_enc=encrypt_str(data.account_no) if data.account_no else None,
                app_key_masked=masked(data.app_key),
                account_no_masked=masked(data.account_no),
            ),
        )
    except IntegrityError:
        db.rollback()
        raise AppError(409, "CONFLICT", "이미 사용 중인 연결 별칭입니다.") from None
    return Connection.model_validate(row)


def verify_connection(db, user_id, connection_id):
    row = _owned_connection(db, user_id, connection_id)
    row.last_verified_at = now_utc()
    try:
        if row.provider == "mock" and get_settings().app_env == "production":
            raise BrokerError("BROKER_NOT_SUPPORTED")
        _connection_client(row).get_holdings()
        row.status = "active"
        row.last_error_code = None
    except BrokerError as exc:
        row.status = "error"
        row.last_error_code = exc.code
    repository.save_connection(db, row)
    return Connection.model_validate(row)


def delete_connection(db, user_id, connection_id):
    row = _owned_connection(db, user_id, connection_id)
    repository.delete_connection(db, row)
    # 삭제한 연결의 복호화 자격증명·토큰도 메모리 캐시에서 제거한다.
    _make_client.cache_clear()


@lru_cache(maxsize=1)
def get_egress_ip() -> str | None:
    try:
        with httpx.Client(timeout=10) as client:
            response = client.get("https://api.ipify.org", params={"format": "json"})
            response.raise_for_status()
            return str(ipaddress.ip_address(response.json()["ip"]))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


def refresh_stocks(db, client):
    stocks = []
    for market in ("KOSPI", "KOSDAQ"):
        stocks.extend(client.list_stocks(market))
    kinds = {"stock"}
    if "ETF_LIST" in client.capabilities:
        stocks.extend(client.list_etfs())
        kinds.add("etf")
    repository.refresh_stocks(db, stocks, client.provider, kinds=kinds)
    return len(stocks)


def refresh_snapshot(db, client, as_of, *, limit=None, resume=False):
    import logging

    logger = logging.getLogger(__name__)
    stocks = repository.listed_stocks(db, limit)
    success = failed = skipped = 0
    for n, stock in enumerate(stocks, 1):
        if resume and repository.snapshot_exists(db, as_of, stock.code):
            skipped += 1
            continue
        try:
            values = asdict(client.get_fundamentals(stock.code))
            repository.upsert_snapshot(
                db, dict(**values, as_of=as_of, source=client.provider, created_at=now_utc())
            )
            success += 1
        except BrokerError:
            db.rollback()
            failed += 1
        if n % 100 == 0:
            logger.info("스냅샷 진행 %d/%d, 성공 %d, 실패 %d", n, len(stocks), success, failed)
    return {
        "success": success,
        "failed": failed,
        "skipped": skipped,
        "exit_code": int(failed > 0 and success / (success + failed) < 0.9),
    }


def prune_snapshots(db, before):
    return repository.prune_snapshots(db, before)
