from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel

Provider = Literal["mock", "kiwoom", "toss"]


class WatchlistQuote(CamelModel):
    price: Decimal
    change: Decimal | None
    change_rate: float | None
    as_of: datetime


class WatchlistMetrics(CamelModel):
    per: Decimal | None
    pbr: Decimal | None
    market_cap: int | None


class WatchlistItemView(CamelModel):
    id: UUID
    code: str
    name: str
    # 종목 마스터에서 빠진(상장폐지 등) 코드는 시장·업종을 알 수 없어 null이다.
    market: str | None
    sector: str | None
    kind: Literal["stock", "etf"]
    group_name: str
    memo: str | None
    sort_order: int
    quote: WatchlistQuote | None
    metrics: WatchlistMetrics | None
    source: Provider
    created_at: datetime


class WatchlistList(CamelModel):
    items: list[WatchlistItemView]
    groups: list[str]
    source: Provider


class WatchlistCreate(CamelModel):
    code: str = Field(min_length=1, max_length=20)
    group_name: str = "기본"
    memo: str | None = None


class WatchlistPatch(CamelModel):
    group_name: str | None = None
    memo: str | None = None


class WatchlistOrder(CamelModel):
    group_name: str
    ids: list[UUID]
