from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_serializer, field_validator

from app.core.schemas import CamelModel
from app.core.time import today_kst

Kind = Literal["income", "expense"]
PaymentMethod = Literal["card", "cash", "transfer", "other"]

MIN_OCCURRED_ON = date(2000, 1, 1)
MAX_AMOUNT = 1_000_000_000_000
# 날짜는 오늘(KST)부터 이 일수 뒤까지 받는다(예정된 지출 입력용).
MAX_FUTURE_DAYS = 366

Amount = Annotated[int, Field(strict=True, ge=1, le=MAX_AMOUNT)]
Merchant = Annotated[str | None, Field(max_length=100)]
Memo = Annotated[str | None, Field(max_length=200)]


def to_utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def strip_or_none(value):
    if isinstance(value, str):
        return value.strip() or None
    return value


def check_occurred_on(value: date) -> date:
    if not MIN_OCCURRED_ON <= value <= today_kst() + timedelta(days=MAX_FUTURE_DAYS):
        raise ValueError("날짜를 확인해 주세요.")
    return value


# ── 카테고리 ─────────────────────────────────────────────────────────


class CategoryOut(CamelModel):
    id: UUID
    kind: Kind
    name: str
    is_default: bool
    sort_order: int


class CategoryList(CamelModel):
    items: list[CategoryOut]


class CategoryName(CamelModel):
    name: Annotated[str, Field(min_length=1, max_length=20)]

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class CategoryCreate(CategoryName):
    kind: Kind


class CategoryUpdate(CategoryName):
    pass


# ── 내역 ────────────────────────────────────────────────────────────


class EntryInput(CamelModel):
    kind: Kind
    occurred_on: date
    amount: Amount
    category_id: UUID
    merchant: Merchant = None
    payment_method: PaymentMethod = "other"
    memo: Memo = None

    @field_validator("merchant", "memo", mode="before")
    @classmethod
    def clean_text(cls, value):
        return strip_or_none(value)

    @field_validator("occurred_on")
    @classmethod
    def validate_occurred_on(cls, value: date) -> date:
        return check_occurred_on(value)


class EntryPatch(CamelModel):
    """보낸 필드만 바꾼다. `merchant`·`memo`만 null로 지울 수 있다."""

    kind: Kind | None = None
    occurred_on: date | None = None
    amount: Amount | None = None
    category_id: UUID | None = None
    merchant: Merchant = None
    payment_method: PaymentMethod | None = None
    memo: Memo = None

    @field_validator(
        "kind", "occurred_on", "amount", "category_id", "payment_method", mode="before"
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("필수 항목입니다.")
        return value

    @field_validator("merchant", "memo", mode="before")
    @classmethod
    def clean_text(cls, value):
        return strip_or_none(value)

    @field_validator("occurred_on")
    @classmethod
    def validate_occurred_on(cls, value: date) -> date:
        return check_occurred_on(value)


class EntryOut(CamelModel):
    id: UUID
    kind: Kind
    occurred_on: date
    amount: int
    category_id: UUID
    category_name: str
    merchant: str | None
    payment_method: PaymentMethod
    memo: str | None
    card_name: str | None
    approval_no: str | None
    is_cancellation: bool
    import_batch_id: UUID | None
    source: Literal["manual", "import", "codef"]
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_timestamp(self, value: datetime) -> str:
        return to_utc_text(value)


# ── 요약·추이 ────────────────────────────────────────────────────────


class MonthTotals(CamelModel):
    month: str
    income_total: int
    expense_total: int


class CategoryAmount(CamelModel):
    category_id: UUID
    name: str
    kind: Kind
    amount: int
    ratio: float


class DailyAmount(CamelModel):
    date: date
    income: int
    expense: int


class MerchantAmount(CamelModel):
    merchant: str
    amount: int
    count: int


class MonthlySummary(CamelModel):
    month: str
    income_total: int
    expense_total: int
    net: int
    previous: MonthTotals
    expense_change_rate: float | None
    by_category: list[CategoryAmount]
    daily: list[DailyAmount]
    top_merchants: list[MerchantAmount]


class TrendOut(CamelModel):
    items: list[MonthTotals]


class MerchantRuleInput(CamelModel):
    merchant: Annotated[str, Field(min_length=1, max_length=100)]
    category_id: UUID
    apply_to_existing: bool = False


class MerchantRuleOut(CamelModel):
    id: UUID
    merchant_key: str
    category_id: UUID
    created_at: datetime
    updated_at: datetime

    @field_serializer("created_at", "updated_at")
    def serialize_timestamp(self, value: datetime) -> str:
        return to_utc_text(value)


class MerchantRuleList(CamelModel):
    items: list[MerchantRuleOut]


class MerchantRuleSaved(MerchantRuleOut):
    updated_count: int


class ExtractTransaction(CamelModel):
    occurred_on: date
    merchant: Annotated[str, Field(min_length=1, max_length=100)]
    amount: Annotated[int, Field(strict=True, ge=-MAX_AMOUNT, le=MAX_AMOUNT)]
    is_cancellation: bool
    card_name: Annotated[str | None, Field(max_length=50)] = None
    approval_no: Annotated[str | None, Field(max_length=30)] = None


class ExtractOutput(CamelModel):
    transactions: list[ExtractTransaction]
    warnings: list[str]
