from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field

from app.core.schemas import CamelModel
from app.integrations.brokers.base import Market

Provider = Literal["mock", "kiwoom", "toss"]


class StockSummary(CamelModel):
    model_config = ConfigDict(from_attributes=True)
    code: str
    name: str
    market: Market
    sector: str | None
    kind: Literal["stock", "etf"]


class Quote(CamelModel):
    code: str
    price: Decimal
    change: Decimal | None
    change_rate: float | None
    volume: int | None
    as_of: datetime
    source: Provider


class Snapshot(CamelModel):
    as_of: date
    price: Decimal
    change_rate: float | None
    market_cap: int | None
    per: Decimal | None
    pbr: Decimal | None
    roe: Decimal | None
    eps: Decimal | None
    bps: Decimal | None
    foreign_ratio: Decimal | None
    high_52w: Decimal | None = Field(alias="high52w")
    low_52w: Decimal | None = Field(alias="low52w")
    trading_value: int | None
    volume: int | None


class StockDetail(StockSummary):
    snapshot: Snapshot | None
    quote: Quote | None
    source: Provider


class StockList(CamelModel):
    items: list[StockSummary]
    source: Provider


class QuoteList(CamelModel):
    items: list[Quote]


class CandleView(CamelModel):
    date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


class CandleList(CamelModel):
    items: list[CandleView]
    source: Provider


class SnapshotStatus(CamelModel):
    as_of: date | None
    count: int
    source: str | None


class ConnectionCreate(CamelModel):
    provider: Provider
    environment: Literal["real", "mock"]
    label: str = Field(min_length=1, max_length=30)
    app_key: str = Field(min_length=1, max_length=200)
    app_secret: str = Field(min_length=1, max_length=200)
    account_no: str | None = Field(default=None, max_length=200)


class Connection(CamelModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    provider: Provider
    environment: Literal["real", "mock"]
    label: str
    app_key_masked: str | None
    account_no_masked: str | None
    status: Literal["unverified", "active", "error"]
    last_verified_at: datetime | None
    last_error_code: str | None
    created_at: datetime


class ConnectionList(CamelModel):
    items: list[Connection]


class EgressIp(CamelModel):
    ip: str | None


class TossAccountsRequest(CamelModel):
    # 빈 값·공백은 서비스에서 필드별 422로 거른다. 키는 저장하지 않는다.
    app_key: str = Field(max_length=200)
    app_secret: str = Field(max_length=200)


class TossAccount(CamelModel):
    account_seq: str
    account_type: str
    account_no_last4: str


class TossAccountList(CamelModel):
    items: list[TossAccount]
