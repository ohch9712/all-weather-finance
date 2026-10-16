from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Protocol

Market = Literal["KOSPI", "KOSDAQ", "KONEX", "NASDAQ", "NYSE", "AMEX", "OTHER"]
Capability = Literal[
    "STOCK_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS", "EXECUTIONS", "CONDITIONS"
]


@dataclass(frozen=True)
class StockInfo:
    code: str
    name: str
    market: Market
    sector: str | None


@dataclass(frozen=True)
class Fundamentals:
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


@dataclass(frozen=True)
class Quote:
    code: str
    price: Decimal
    change: Decimal | None
    change_rate: Decimal | None
    volume: int | None
    as_of: datetime


@dataclass(frozen=True)
class Candle:
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int


@dataclass(frozen=True)
class BrokerHolding:
    code: str
    name: str
    market: Market
    quantity: Decimal
    avg_price: Decimal | None
    eval_amount: int | None
    currency: Literal["KRW", "USD"]


@dataclass(frozen=True)
class HoldingsSnapshot:
    holdings: list[BrokerHolding]
    cash_krw: int | None
    as_of: datetime


@dataclass(frozen=True)
class Execution:
    external_id: str
    executed_at: datetime
    code: str
    name: str
    market: Market
    side: Literal["buy", "sell"]
    quantity: Decimal
    price: Decimal
    fee: Decimal
    tax: Decimal
    currency: Literal["KRW", "USD"]


@dataclass(frozen=True)
class ConditionInfo:
    seq: str
    name: str


class BrokerClient(Protocol):
    provider: Literal["mock", "kiwoom", "toss"]
    capabilities: frozenset[Capability]

    def list_stocks(self, market: Market) -> list[StockInfo]: ...
    def get_fundamentals(self, code: str) -> Fundamentals: ...
    def get_quotes(self, codes: list[str]) -> list[Quote]: ...
    def get_daily_candles(self, code: str, start: date, end: date) -> list[Candle]: ...
    def get_holdings(self) -> HoldingsSnapshot: ...
    def get_executions(self, start: date, end: date) -> list[Execution]: ...
    def list_conditions(self) -> list[ConditionInfo]: ...
    def run_condition(self, seq: str) -> list[str]: ...
