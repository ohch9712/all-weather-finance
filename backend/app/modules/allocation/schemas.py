"""자산배분 요청·응답 모델(스펙 02 7절). 필드 이름과 순서가 API 계약이다."""

from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field, PlainSerializer, field_validator

from app.core.domain import AgeBand, AssetClass, RiskProfile
from app.core.schemas import CamelModel
from app.core.time import today_kst
from app.modules.allocation import rules


def _utc_iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[datetime, PlainSerializer(_utc_iso, return_type=str)]

GoalType = Literal["retirement", "home", "education", "marriage", "car", "lump_sum", "other"]
GoalHorizon = Literal["within_1y", "within_3y", "long_term"]
Grade = Literal["S", "A", "B", "C", "D"]
ReportStatus = Literal["needs_profile", "needs_assessment", "needs_holdings", "ready"]
RecommendationStatus = Literal["needs_profile", "needs_assessment", "ready"]
Layering = Literal["applied", "needs_holdings"]
DirectionKind = Literal[
    "pay_consumer_debt",
    "build_emergency_fund",
    "reserve_short_term_goal",
    "rebalance",
    "keep_allocation",
    "long_term_goal",
    "input_situation",
    "input_holdings",
]
ReasonCode = Literal[
    "age_band", "risk_profile", "emergency_fund", "short_term_goals", "long_term_mix"
]


class ByAssetClass[T](CamelModel):
    """자산군 5개를 고정 순서(stock, bond, gold, cash, other)로 담는다."""

    stock: T
    bond: T
    gold: T
    cash: T
    other: T

    @classmethod
    def of(cls, values: dict[AssetClass, Any]) -> "ByAssetClass[T]":
        return cls(**{asset_class.value: values[asset_class] for asset_class in AssetClass})


# ── 설문·진단 ────────────────────────────────────────────────────────────


class SurveyOption(CamelModel):
    value: int
    label: str


class SurveyQuestionOut(CamelModel):
    id: str
    text: str
    options: list[SurveyOption]


class SurveyOut(CamelModel):
    version: int
    questions: list[SurveyQuestionOut]


class RiskAssessmentCreate(CamelModel):
    survey_version: int = Field(strict=True)
    # 키·값 검증은 서비스가 스펙 02 7.2 문구로 한다.
    answers: dict[str, Any]


class RiskAssessmentCreated(CamelModel):
    id: UUID
    score: float
    risk_profile: RiskProfile
    created_at: UtcDateTime


class RiskAssessmentOut(CamelModel):
    id: UUID
    score: float
    risk_profile: RiskProfile
    answers: dict[str, int]
    created_at: UtcDateTime


class LatestAssessmentOut(CamelModel):
    assessment: RiskAssessmentOut | None


# ── 권장 배분표 ──────────────────────────────────────────────────────────


class TargetOut(CamelModel):
    age_band: AgeBand
    risk_profile: RiskProfile
    weights: ByAssetClass[int]
    risky_weight: int
    explanation: str


class TargetTableCell(CamelModel):
    risk_profile: RiskProfile
    weights: ByAssetClass[int]


class TargetTableRow(CamelModel):
    age_band: AgeBand
    cells: list[TargetTableCell]


class TargetTableOut(CamelModel):
    rows: list[TargetTableRow]


# ── 보유 자산 ────────────────────────────────────────────────────────────


def _normalize_holding_name(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    name = value.strip()
    if not 1 <= len(name) <= 50:
        raise ValueError("이름은 1~50자로 입력해 주세요.")
    return name


def _validate_memo(value: Any) -> Any:
    if isinstance(value, str) and len(value) > 200:
        raise ValueError("메모는 200자 이내로 입력해 주세요.")
    return value


HoldingAmount = Annotated[int, Field(strict=True, ge=0, le=rules.MAX_HOLDING_AMOUNT)]


class HoldingCreate(CamelModel):
    name: str = Field(strict=True)
    asset_class: AssetClass
    amount: HoldingAmount
    include_in_allocation: bool = Field(default=True, strict=True)
    memo: str | None = Field(default=None, strict=True)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: Any) -> Any:
        return _normalize_holding_name(value)

    @field_validator("memo")
    @classmethod
    def validate_memo(cls, value: Any) -> Any:
        return _validate_memo(value)


class HoldingUpdate(CamelModel):
    """보낸 필드만 바꾼다(model_fields_set). memo만 null로 지울 수 있다."""

    name: str = Field(default=None, strict=True)  # type: ignore[assignment]
    asset_class: AssetClass = None  # type: ignore[assignment]
    amount: HoldingAmount = None  # type: ignore[assignment]
    include_in_allocation: bool = Field(default=None, strict=True)  # type: ignore[assignment]
    memo: str | None = Field(default=None, strict=True)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: Any) -> Any:
        return _normalize_holding_name(value)

    @field_validator("memo")
    @classmethod
    def validate_memo(cls, value: Any) -> Any:
        return _validate_memo(value)


class HoldingOut(CamelModel):
    id: UUID
    name: str
    asset_class: AssetClass
    amount: int
    include_in_allocation: bool
    source: str
    memo: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    connection_id: UUID | None
    synced_at: UtcDateTime | None
    class_override: bool


class HoldingSyncRequest(CamelModel):
    connection_id: UUID


class HoldingSyncSkipped(CamelModel):
    name: str
    reason: str


class HoldingSyncResult(CamelModel):
    created: int
    updated: int
    removed: int
    skipped: list[HoldingSyncSkipped] = Field(default_factory=list)
    synced_at: UtcDateTime


class HoldingList(CamelModel):
    items: list[HoldingOut]


class HoldingBulkCreate(CamelModel):
    # 항목은 서비스가 HoldingCreate로 하나씩 검증해 `items.0.amount`처럼 위치를 붙인다.
    items: list[Any]


# ── 상황과 목표 ──────────────────────────────────────────────────────────


class SituationIn(CamelModel):
    monthly_expense: int = Field(strict=True, ge=0, le=rules.MAX_MONTHLY_EXPENSE)
    dependents: int = Field(default=0, strict=True, ge=0, le=rules.MAX_DEPENDENTS)
    consumer_debt: int = Field(default=0, strict=True, ge=0, le=rules.MAX_CONSUMER_DEBT)


class SituationOut(CamelModel):
    monthly_expense: int
    dependents: int
    consumer_debt: int
    emergency_months: int
    emergency_target: int
    updated_at: UtcDateTime


class SituationEnvelope(CamelModel):
    situation: SituationOut | None


GoalAmount = Annotated[int, Field(strict=True, ge=1, le=rules.MAX_GOAL_AMOUNT)]


def _normalize_goal_title(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    title = value.strip()
    if len(title) > 30:
        raise ValueError("이름은 30자 이내로 입력해 주세요.")
    return title or None  # 비면 서비스가 종류 이름으로 바꾼다


def _validate_goal_date(value: Any) -> Any:
    if isinstance(value, date):
        today = today_kst()
        if not today < value <= rules.add_years(today, rules.MAX_GOAL_YEARS):
            raise ValueError("목표일은 내일부터 50년 안으로 골라 주세요.")
    return value


class GoalCreate(CamelModel):
    goal_type: GoalType
    title: str | None = Field(default=None, strict=True)
    target_amount: GoalAmount
    target_date: date

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: Any) -> Any:
        return _normalize_goal_title(value)

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, value: Any) -> Any:
        return _validate_goal_date(value)


class GoalUpdate(CamelModel):
    """보낸 필드만 바꾼다. title을 비우거나 null로 보내면 종류 이름으로 저장한다."""

    goal_type: GoalType = None  # type: ignore[assignment]
    title: str | None = Field(default=None, strict=True)
    target_amount: GoalAmount = None  # type: ignore[assignment]
    target_date: date = None  # type: ignore[assignment]

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: Any) -> Any:
        return _normalize_goal_title(value)

    @field_validator("target_date")
    @classmethod
    def validate_target_date(cls, value: Any) -> Any:
        return _validate_goal_date(value)


class GoalOut(CamelModel):
    id: UUID
    goal_type: GoalType
    title: str
    target_amount: int
    target_date: date
    horizon: GoalHorizon
    created_at: UtcDateTime
    updated_at: UtcDateTime


class GoalList(CamelModel):
    items: list[GoalOut]


# ── 리포트·점수 이력 ─────────────────────────────────────────────────────


class ReportClass(CamelModel):
    asset_class: AssetClass
    actual_amount: int
    actual_weight: float
    target_weight: float
    target_amount: int
    diff_amount: int


class AllocationReport(CamelModel):
    status: ReportStatus
    age_band: AgeBand | None
    risk_profile: RiskProfile | None
    total_amount: int
    excluded_amount: int
    score: int | None
    grade: Grade | None
    score_delta: int | None
    scored_on: date | None
    classes: list[ReportClass] | None


class ScoreItem(CamelModel):
    scored_on: date
    score: int
    grade: Grade


class ScoreList(CamelModel):
    items: list[ScoreItem]


# ── 추천 ─────────────────────────────────────────────────────────────────


class RiskyOut(CamelModel):
    start: int
    adjustment: int
    final: int
    clamped: bool


class EmergencyLayer(CamelModel):
    monthly_expense: int
    months: int
    target_amount: int
    allocated_amount: int | None


class ShortTermGoalLayer(CamelModel):
    goal_id: UUID
    title: str
    target_date: date
    horizon: GoalHorizon
    target_amount: int
    allocated_amount: int | None
    asset_class: AssetClass


class Layers(CamelModel):
    emergency: EmergencyLayer | None
    short_term_goals: list[ShortTermGoalLayer]
    long_term_amount: int | None


class Direction(CamelModel):
    kind: DirectionKind
    priority: int
    title: str
    body: str
    amount: int | None
    asset_class: AssetClass | None
    href: str


class Reason(CamelModel):
    code: ReasonCode
    title: str
    body: str


class AssetClassNote(CamelModel):
    asset_class: AssetClass
    weight: float
    note: str


class AnswerContribution(CamelModel):
    question_id: str
    question: str
    answer_label: str
    points: float
    max_points: float


class Recommendation(CamelModel):
    status: RecommendationStatus
    layering: Layering | None = None
    age_band: AgeBand | None = None
    risk_profile: RiskProfile | None = None
    risk_score: float | None = None
    risk_profile_summary: str | None = None
    risky: RiskyOut | None = None
    base_weights: ByAssetClass[int] | None = None
    total_amount: int | None = None
    layers: Layers | None = None
    target_amounts: ByAssetClass[int] | None = None
    target_weights: ByAssetClass[float] | None = None
    directions: list[Direction] = Field(default_factory=list)
    reasons: list[Reason] = Field(default_factory=list)
    asset_class_notes: list[AssetClassNote] = Field(default_factory=list)
    answer_contributions: list[AnswerContribution] = Field(default_factory=list)
