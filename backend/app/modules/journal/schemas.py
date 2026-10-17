from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, ValidationInfo, field_validator

from app.core import time as clock
from app.core.schemas import CamelModel

Market = Literal["KRX", "US", "OTHER"]
Currency = Literal["KRW", "USD"]
Side = Literal["buy", "sell"]
Kind = Literal["plan", "review", "memo"]
Emotion = Literal["confident", "calm", "anxious", "impulsive", "greedy", "fearful", "regret"]
PositiveDecimal = Annotated[Decimal, Field(gt=0, max_digits=20, decimal_places=6)]
NonnegativeDecimal = Annotated[Decimal, Field(ge=0, max_digits=20, decimal_places=6)]
Symbol = Annotated[str, Field(min_length=1, max_length=20, pattern=r"^[a-zA-Z0-9.\-]+$")]


class TradeInput(CamelModel):
    traded_on: date
    traded_time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    market: Market
    symbol_code: Symbol
    symbol_name: str = Field(min_length=1, max_length=100)
    side: Side
    quantity: PositiveDecimal
    price: PositiveDecimal
    currency: Currency
    fee: NonnegativeDecimal = Decimal(0)
    tax: NonnegativeDecimal = Decimal(0)
    broker: Literal["kiwoom", "toss", "other"] | None = None
    account_label: str | None = Field(default=None, max_length=30)

    @field_validator("traded_on")
    @classmethod
    def valid_date(cls, value):
        if not date(2000, 1, 1) <= value <= clock.today_kst():
            raise ValueError("거래 날짜는 2000년 1월 1일부터 오늘까지 입력해 주세요.")
        return value

    @field_validator("currency")
    @classmethod
    def matching_currency(cls, value, info: ValidationInfo):
        if {"KRX": "KRW", "US": "USD"}.get(info.data.get("market"), value) != value:
            raise ValueError("시장과 통화가 맞지 않습니다.")
        return value

    @field_validator("symbol_code")
    @classmethod
    def uppercase(cls, value):
        return value.upper()


class TradePatch(CamelModel):
    traded_on: date | None = None
    traded_time: str | None = None
    market: Market | None = None
    symbol_code: Symbol | None = None
    symbol_name: str | None = Field(default=None, min_length=1, max_length=100)
    side: Side | None = None
    quantity: PositiveDecimal | None = None
    price: PositiveDecimal | None = None
    currency: Currency | None = None
    fee: NonnegativeDecimal | None = None
    tax: NonnegativeDecimal | None = None
    broker: Literal["kiwoom", "toss", "other"] | None = None
    account_label: str | None = Field(default=None, max_length=30)


class TradeOut(CamelModel):
    traded_on: date
    traded_time: str | None
    market: Market
    symbol_code: str
    symbol_name: str
    side: Side
    currency: Currency
    broker: str | None
    account_label: str | None
    quantity: str
    price: str
    cost_estimated: bool
    fee: str
    tax: str
    id: UUID
    traded_at: datetime
    time_known: bool
    source: Literal["manual", "import", "kiwoom", "toss", "mock"]
    created_at: datetime
    updated_at: datetime


class NoteInput(CamelModel):
    trade_id: UUID | None = None
    symbol_code: Symbol | None = None
    noted_on: date
    kind: Kind
    content: str = Field(min_length=1, max_length=5000)
    tags: list[str] = Field(default_factory=list)
    emotion: Emotion | None = None

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value):
        result = list(dict.fromkeys(tag.strip() for tag in value))
        if len(result) > 10 or any(not 1 <= len(tag) <= 20 for tag in result):
            raise ValueError("태그는 1~20자, 최대 10개로 입력해 주세요.")
        return result

    @field_validator("symbol_code")
    @classmethod
    def uppercase(cls, value):
        return value.upper() if value else None


class NotePatch(CamelModel):
    trade_id: UUID | None = None
    symbol_code: Symbol | None = None
    noted_on: date | None = None
    kind: Kind | None = None
    content: str | None = Field(default=None, min_length=1, max_length=5000)
    tags: list[str] | None = None
    emotion: Emotion | None = None


class NoteOut(NoteInput):
    id: UUID
    created_at: datetime
    updated_at: datetime


class TradeDetail(CamelModel):
    trade: TradeOut
    realized_pnl: str | None
    oversold: bool
    notes: list[NoteOut]


class Position(CamelModel):
    market: Market
    symbol_code: str
    symbol_name: str
    currency: Currency
    quantity: str
    avg_cost: str
    cost_basis: str
    realized_pnl: str
    first_traded_on: date
    last_traded_on: date
    trade_count: int
    has_oversold: bool
    current_price: str | None = None
    eval_amount: str | None = None
    unrealized_pnl: str | None = None
    unrealized_pnl_rate: float | None = None
    quote_source: str | None = None


class Positions(CamelModel):
    items: list[Position]


class TradePerformance(CamelModel):
    trade_id: UUID
    symbol_name: str
    realized_pnl: str
    traded_on: date


class CurrencyStats(CamelModel):
    currency: Currency
    realized_pnl: str
    win_count: int
    loss_count: int
    win_rate: float | None
    sell_count: int
    avg_win: str | None
    avg_loss: str | None
    best_trade: TradePerformance | None
    worst_trade: TradePerformance | None


class MonthlyPnl(CamelModel):
    month: str
    currency: Currency
    realized_pnl: str


class DailyPnl(CamelModel):
    date: date
    currency: Currency
    realized_pnl: str


class SymbolPnl(CamelModel):
    symbol_code: str
    symbol_name: str
    currency: Currency
    realized_pnl: str
    sell_count: int


class TradeStats(CamelModel):
    by_currency: list[CurrencyStats]
    monthly: list[MonthlyPnl]
    daily: list[DailyPnl]
    by_symbol: list[SymbolPnl]


class CostSettingsInput(CamelModel):
    krx_commission_rate: Decimal
    krx_sell_tax_rate: Decimal
    us_commission_rate: Decimal

    @field_validator(
        "krx_commission_rate", "krx_sell_tax_rate", "us_commission_rate", mode="before"
    )
    @classmethod
    def valid_rate(cls, value, info: ValidationInfo):
        from decimal import InvalidOperation

        from app.core.errors import field_error
        from app.core.schemas import to_camel

        try:
            rate = Decimal(str(value))
            if rate.is_finite() and 0 <= rate <= 5 and rate.as_tuple().exponent >= -4:
                return rate
        except (InvalidOperation, ValueError):
            pass
        raise field_error(
            to_camel(info.field_name), "요율은 0~5%, 소수 넷째 자리까지 입력해 주세요."
        )


class CostSettings(CamelModel):
    krx_commission_rate: str
    krx_sell_tax_rate: str
    us_commission_rate: str
    is_default: bool
    updated_at: datetime | None


class CostEstimateInput(CamelModel):
    market: Literal["KRX", "US"]
    side: Side
    quantity: PositiveDecimal
    price: PositiveDecimal
    symbol_code: Symbol | None = None


class CostEstimate(CamelModel):
    fee: str
    tax: str
    is_etf: bool
    rates: CostSettings


class SyncInput(CamelModel):
    connection_id: UUID
    start: date = Field(alias="from")
    end: date = Field(alias="to")


class SyncResult(CamelModel):
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped_duplicates: int = 0
    start: date = Field(alias="from")
    end: date = Field(alias="to")
    synced_at: datetime


class SyncStatusItem(CamelModel):
    connection_id: UUID
    label: str
    provider: str
    last_synced_at: datetime | None
    trade_count: int


class SyncStatus(CamelModel):
    items: list[SyncStatusItem]
