"""상속·증여 API 계약과 순수 계산 입력."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.core.schemas import CamelModel

Relation = Literal["spouse", "child", "grandchild", "parent", "other_relative"]
DonorGroup = Literal["parents", "grandparents", "spouse", "children", "relative", "non_relative"]
Category = Literal["lineal_ascendant", "spouse", "lineal_descendant", "other_relative", "none"]
AssetType = Literal["cash", "listed_stock", "real_estate", "other"]
Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000_000)]
PositiveMoney = Annotated[int, Field(strict=True, ge=1, le=1_000_000_000_000)]


class Recipient(CamelModel):
    relation: Relation = "child"
    birth_date: date | None = None
    married_on: date | None = None
    child_birth_dates: list[date] = Field(default_factory=list, max_length=10)
    parent_deceased: bool = False


class MemberCreate(Recipient):
    display_name: str = Field(min_length=1, max_length=20)

    @field_validator("display_name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("별칭을 입력해 주세요.")
        return value


class MemberUpdate(CamelModel):
    relation: Relation | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=20)
    birth_date: date | None = None
    married_on: date | None = None
    child_birth_dates: list[date] | None = Field(default=None, max_length=10)
    parent_deceased: bool | None = None


class MemberInfo(MemberCreate):
    id: UUID
    age: int | None
    is_minor: bool | None
    created_at: datetime
    updated_at: datetime


class MemberList(CamelModel):
    items: list[MemberInfo]


class PriorGift(CamelModel):
    gifted_on: date
    donor_group: DonorGroup
    amount: PositiveMoney
    tax_paid: Money = 0
    marriage_birth_claimed: bool = False
    appraisal_fee: Money = 0


class GiftCreate(PriorGift):
    recipient_id: UUID
    asset_type: AssetType = "cash"
    filed: bool = False
    memo: str | None = Field(default=None, max_length=200)


class GiftUpdate(CamelModel):
    recipient_id: UUID | None = None
    gifted_on: date | None = None
    donor_group: DonorGroup | None = None
    amount: PositiveMoney | None = None
    tax_paid: Money | None = None
    marriage_birth_claimed: bool | None = None
    appraisal_fee: Money | None = None
    asset_type: AssetType | None = None
    filed: bool | None = None
    memo: str | None = Field(default=None, max_length=200)


class GiftInfo(GiftCreate):
    id: UUID
    user_id: UUID
    deduction_category: Category
    computed_deduction: int
    computed_marriage_birth_deduction: int
    estimated_tax: int
    created_at: datetime
    updated_at: datetime


class GiftList(CamelModel):
    items: list[GiftInfo]


class Step(CamelModel):
    key: str
    label: str
    amount: int
    note: str | None = None


class CalculationResult(CamelModel):
    steps: list[Step]
    notes: list[str]
    assumptions: list[str]
    rule_version: str


class GiftTaxInput(CamelModel):
    recipient: Recipient
    donor_group: DonorGroup = "parents"
    gifted_on: date
    amount: PositiveMoney
    appraisal_fee: Money = 0
    claim_marriage_birth: bool = False
    prior_gifts: list[PriorGift] = Field(default_factory=list)


class GiftTaxRequest(CamelModel):
    member_id: UUID | None = None
    recipient: Recipient | None = None
    donor_group: DonorGroup = "parents"
    gifted_on: date
    amount: PositiveMoney
    appraisal_fee: Money = 0
    claim_marriage_birth: bool = False
    use_records: bool = True
    prior_gifts: list[PriorGift] = Field(default_factory=list)


class GiftTaxResult(CalculationResult):
    taxable_value: int
    deduction: int
    marriage_birth_deduction: int
    tax_base: int
    calculated_tax: int
    surcharge: int
    prior_tax_credit: int
    filing_credit: int
    payable_tax: int


class Pool(CamelModel):
    category: Category
    limit: int
    used_within10y: int = Field(alias="usedWithin10y")
    available: int
    next_reset_on: date | None


class EligibilityWindow(CamelModel):
    kind: Literal["marriage", "birth"]
    from_: date = Field(alias="from")
    to: date


class MarriageBirthStatus(CamelModel):
    limit: int
    used: int
    available: int
    eligible_now: bool
    windows: list[EligibilityWindow]


class DeductionStatus(CamelModel):
    as_of: date
    age: int | None
    is_minor: bool | None
    adult_on: date | None
    pools: list[Pool]
    marriage_birth: MarriageBirthStatus
    rule_version: str


class InheritanceChild(CamelModel):
    age: int = Field(ge=0, le=150)
    disabled_life_expectancy_years: int | None = Field(default=None, ge=0, le=150)


class CohabitingHouse(CamelModel):
    eligible: bool = False
    value: Money = 0


class InheritanceTaxInput(CamelModel):
    financial_assets: Money = 0
    real_estate: Money = 0
    other_assets: Money = 0
    debts: Money = 0
    financial_debts: Money = 0
    funeral_expense: Money = 0
    enshrinement_expense: Money = 0
    spouse_alive: bool = False
    spouse_actual_share: Money | None = None
    children: list[InheritanceChild] = Field(default_factory=list)
    elderly_dependents: int = Field(default=0, ge=0, le=100)
    prior_gifts_to_heirs10y: Money = Field(default=0, alias="priorGiftsToHeirs10y")
    prior_gifts_to_non_heirs5y: Money = Field(default=0, alias="priorGiftsToNonHeirs5y")
    prior_gift_deductions: Money = 0
    prior_gift_tax_paid: Money = 0
    cohabiting_house: CohabitingHouse = Field(default_factory=CohabitingHouse)
    appraisal_fee: Money = 0


class InheritanceTaxResult(CalculationResult):
    funeral_deduction: int
    taxable_value: int
    basic_personal_deduction: int
    lump_sum_deduction: int
    spouse_deduction: int
    financial_deduction: int
    cohabiting_house_deduction: int
    total_deduction: int
    deduction_limit: int
    applied_deduction: int
    tax_base: int
    calculated_tax: int
    gift_tax_credit: int
    filing_credit: int
    payable_tax: int


class GiftPlanInput(CamelModel):
    birth_date: date
    start_date: date
    target_age: int = Field(default=30, ge=19, le=40)
    annual_return_rate: Decimal = Field(default=Decimal("4"), ge=0, le=20)
    donor_group: DonorGroup = "parents"
    expected_marriage_date: date | None = None
    recipient: Recipient | None = None
    prior_gifts: list[PriorGift] = Field(default_factory=list)


class GiftPlanRequest(CamelModel):
    member_id: UUID | None = None
    birth_date: date | None = None
    start_date: date | None = None
    target_age: int = Field(default=30, ge=19, le=40)
    annual_return_rate: Decimal = Field(default=Decimal("4"), ge=0, le=20)
    donor_group: DonorGroup = "parents"
    expected_marriage_date: date | None = None


class PlannedGift(CamelModel):
    gift_on: date
    age: int
    amount: int
    deduction_type: Literal["basic", "marriage"]
    tax: int


class LumpSum(CamelModel):
    gift_on: date
    amount: int
    tax_base: int
    payable_tax: int


class GiftPlanResult(CamelModel):
    end_date: date
    schedule: list[PlannedGift]
    total_gifted: int
    total_tax: int
    future_value: int
    lump_sum: LumpSum
    assumptions: list[str]
    rule_version: str


class PrefillAssets(CamelModel):
    financial_assets: Money
    real_estate: Money
    other_assets: Money


class CompareAssets(PrefillAssets):
    debts: Money = 0


class PrefillMember(CamelModel):
    member_id: UUID
    display_name: str
    age: int | None


class InheritancePrefill(CamelModel):
    assets: PrefillAssets | None
    spouse: bool
    children: list[PrefillMember]
    grandchildren: list[PrefillMember]
    prior_gifts_to_heirs10y: int = Field(alias="priorGiftsToHeirs10y")
    prior_gifts_to_non_heirs5y: int = Field(alias="priorGiftsToNonHeirs5y")
    prior_gift_deductions: int
    prior_gift_tax_paid: int


class CompareMember(Recipient):
    id: UUID
    display_name: str
    prior_gifts: list[PriorGift] = Field(default_factory=list)


class EstateCompareInput(CamelModel):
    base_date: date
    horizon_years: int = Field(default=20, ge=1, le=40)
    annual_growth_rate: Decimal = Field(default=Decimal("3"), ge=0, le=10)
    assets: CompareAssets
    spouse_alive: bool
    members: list[CompareMember] = Field(default_factory=list)
    lump_sum_per_child: PositiveMoney = 100_000_000


class CompareRequest(CamelModel):
    base_date: date | None = None
    horizon_years: int = Field(default=20, ge=1, le=40)
    annual_growth_rate: Decimal = Field(default=Decimal("3"), ge=0, le=10)
    assets: CompareAssets | None = None
    spouse_alive: bool | None = None
    lump_sum_per_child: PositiveMoney = 100_000_000


class CompareGift(CamelModel):
    member_id: UUID
    display_name: str
    gift_on: date
    amount: int
    gift_tax: int


class InheritanceSummary(CamelModel):
    taxable_value: int
    applied_deduction: int
    tax_base: int
    payable_tax: int


ScenarioKey = Literal["inherit_only", "staged_children", "lump_sum_now", "staged_grandchildren"]


class CompareScenario(CamelModel):
    key: ScenarioKey
    label: str
    gifts: list[CompareGift]
    total_gifted: int
    gift_tax_total: int
    gifts_value_at_horizon: int
    estate_at_horizon: int
    inheritance_tax: int
    total_tax: int
    gift_tax_at_horizon: int
    total_tax_at_horizon: int
    family_receives: int
    inheritance: InheritanceSummary


class EstateCompareResult(CamelModel):
    base_date: date
    horizon_date: date
    annual_growth_rate: Decimal
    scenarios: list[CompareScenario]
    recommended_key: ScenarioKey
    notes: list[str]
    assumptions: list[str]
    rule_version: str


class RuleSource(CamelModel):
    label: str
    url: str


class RuleBracket(CamelModel):
    up_to: int | None
    rate: Decimal
    progressive_deduction: int


class RulesInfo(CamelModel):
    version: str
    effective_from: date
    sources: list[RuleSource]
    gift_deductions: dict[str, int]
    brackets: list[RuleBracket]
