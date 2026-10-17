from dataclasses import asdict
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.core.errors import AppError, field_error
from app.integrations.brokers.base import Market
from app.integrations.brokers.errors import BrokerError
from app.modules.market import schemas, service
from app.modules.market.service import MarketDataClientDep

router = APIRouter(prefix="/market", tags=["market"])


@router.get("/stocks", response_model=schemas.StockList)
def stocks(
    user: CurrentUser,
    db: DBSession,
    client: MarketDataClientDep,
    q: str = "",
    market: Market | None = None,
    kind: Literal["stock", "etf"] | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    return schemas.StockList(
        items=service.search_stocks_in_market(db, q, limit=limit, market=market, kind=kind),
        source=client.provider,
    )


@router.get("/stocks/{code}", response_model=schemas.StockDetail)
def detail(code: str, user: CurrentUser, db: DBSession, client: MarketDataClientDep):
    result = service.stock_detail_with_client(db, code, client)
    if result is None:
        raise AppError(404, "NOT_FOUND", "종목을 찾을 수 없습니다.")
    return result


@router.get("/quotes", response_model=schemas.QuoteList)
def quotes(codes: str, user: CurrentUser, client: MarketDataClientDep):
    values = [c.strip() for c in codes.split(",")]
    if not 1 <= len(values) <= 50 or any(not c or len(c) > 20 for c in values):
        raise field_error("codes", "종목 코드를 1~50개 입력해 주세요.")
    return schemas.QuoteList(items=service.quotes_for_client(values, client))


@router.get("/stocks/{code}/candles", response_model=schemas.CandleList)
def candles(
    code: str,
    user: CurrentUser,
    client: MarketDataClientDep,
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
):
    if end < start or (end - start).days + 1 > 366:
        raise field_error("to", "시작일 이후 최대 366일 안에서 조회해 주세요.")
    try:
        rows = client.get_daily_candles(code, start, end)
    except BrokerError as exc:
        raise exc.as_app_error() from None
    return schemas.CandleList(
        items=[
            schemas.CandleView(date=r.day, **{k: v for k, v in asdict(r).items() if k != "day"})
            for r in rows
        ],
        source=client.provider,
    )


@router.get("/snapshot/status", response_model=schemas.SnapshotStatus)
def snapshot_status(user: CurrentUser, db: DBSession):
    result = service.list_snapshot_rows(db)
    return schemas.SnapshotStatus(as_of=result.as_of, count=len(result.rows), source=result.source)


@router.get("/connections", response_model=schemas.ConnectionList)
def connections(user: CurrentUser, db: DBSession):
    return schemas.ConnectionList(items=service.list_connections(db, user.id))


@router.get("/connections/egress-ip", response_model=schemas.EgressIp)
def egress_ip(user: CurrentUser):
    return schemas.EgressIp(ip=service.get_egress_ip())


@router.post(
    "/connections",
    status_code=201,
    response_model=schemas.Connection,
    dependencies=[Depends(require_json)],
)
def create_connection(data: schemas.ConnectionCreate, user: CurrentUser, db: DBSession):
    return service.create_connection(db, user.id, data)


@router.post(
    "/connections/{connection_id}/verify",
    response_model=schemas.Connection,
    dependencies=[Depends(require_json)],
)
def verify_connection(connection_id: UUID, user: CurrentUser, db: DBSession):
    return service.verify_connection(db, user.id, connection_id)


@router.delete(
    "/connections/{connection_id}", status_code=204, dependencies=[Depends(require_json)]
)
def delete_connection(connection_id: UUID, user: CurrentUser, db: DBSession):
    service.delete_connection(db, user.id, connection_id)
    return Response(status_code=204)
