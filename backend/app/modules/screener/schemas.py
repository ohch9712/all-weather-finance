from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.core.schemas import CamelModel

FilterField = Literal[
    "price",
    "changeRate",
    "volume",
    "tradingValue",
    "marketCap",
    "per",
    "pbr",
    "roe",
    "eps",
    "bps",
    "foreignRatio",
    "high52wGapRate",
    "low52wGapRate",
]
Op = Literal["gt", "gte", "lt", "lte", "between"]


class StrictModel(CamelModel):
    model_config = ConfigDict(extra="forbid")


class Condition(StrictModel):
    field: FilterField
    op: Op
    value: Decimal = Field(allow_inf_nan=False)
    value_to: Decimal | None = Field(default=None, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_range(self):
        if self.op == "between":
            if self.value_to is None or self.value > self.value_to:
                raise ValueError("범위의 끝값은 시작값 이상이어야 합니다.")
        elif self.value_to is not None:
            raise ValueError("끝값은 범위 조건에만 입력해 주세요.")
        return self


class SortSpec(StrictModel):
    field: FilterField
    direction: Literal["asc", "desc"]


class ScreenFilter(StrictModel):
    markets: list[Literal["KOSPI", "KOSDAQ"]] | None = None
    kinds: list[Literal["stock", "etf"]] | None = Field(default=None, min_length=1, max_length=2)
    sectors: list[str] | None = None
    conditions: list[Condition] = Field(default_factory=list, max_length=10)
    sort: SortSpec | None = None
    limit: int = Field(default=30, ge=1, le=100)

    @field_validator("kinds")
    @classmethod
    def unique_kinds(cls, value):
        if value is not None and len(set(value)) != len(value):
            raise ValueError("종류는 중복 없이 선택해 주세요.")
        return value


class ParseRequest(StrictModel):
    query: str = Field(min_length=1, max_length=300)

    @field_validator("query", mode="before")
    @classmethod
    def trim_query(cls, value):
        return value.strip() if isinstance(value, str) else value


class Unsupported(StrictModel):
    text: str
    reason: str


class ParsedScreenOutput(StrictModel):
    filter: ScreenFilter
    explanation: str
    unsupported: list[Unsupported]


class Chip(CamelModel):
    label: str


class ParsedScreen(ParsedScreenOutput):
    chips: list[Chip]


class RunRequest(StrictModel):
    filter: ScreenFilter


class ScreenItem(CamelModel):
    code: str
    name: str
    market: str | None = None
    sector: str | None = None
    kind: Literal["stock", "etf"] | None = None
    price: Decimal | None = None
    change_rate: float | None = None
    market_cap: int | None = None
    per: Decimal | None = None
    pbr: Decimal | None = None
    roe: Decimal | None = None
    trading_value: int | None = None


class ScreenResult(CamelModel):
    as_of: date | None
    source: str | None
    total: int
    excluded_for_missing_data: int
    items: list[ScreenItem]


class SavedCreate(StrictModel):
    name: str = Field(min_length=1, max_length=40)
    query_text: str | None = Field(default=None, max_length=300)
    filter: ScreenFilter

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class SavedScreen(SavedCreate):
    id: UUID
    created_at: datetime


class SavedList(CamelModel):
    items: list[SavedScreen]


class BrokerCondition(CamelModel):
    seq: str
    name: str


class BrokerConditionList(CamelModel):
    items: list[BrokerCondition]
    source: str


class BrokerRun(StrictModel):
    connection_id: UUID | None = None
    seq: str = Field(min_length=1, max_length=100)
