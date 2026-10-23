"""상속·증여(과제) API 계약(스펙 22 8절)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.core.schemas import CamelModel

ParentRole = Literal["father", "mother"]
Health = Literal["good", "normal", "poor", "care"]
AssetKind = Literal["cash", "house", "land"]
Region = Literal[
    "서울",
    "부산",
    "대구",
    "인천",
    "광주",
    "대전",
    "울산",
    "세종",
    "경기",
    "강원",
    "충북",
    "충남",
    "전북",
    "전남",
    "경북",
    "경남",
    "제주",
]
PlanKey = Literal[
    "inherit_only",
    "cash_staged_deduction",
    "cash_staged_spread",
    "cash_lump_now",
    "realestate_gift_now",
    "realestate_sell_cash_now",
    "realestate_gift_cash_staged",
]
Money = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000_000)]
PositiveMoney = Annotated[int, Field(strict=True, ge=1, le=1_000_000_000_000)]
MonthlyMoney = Annotated[int, Field(strict=True, ge=0, le=100_000_000)]
Rate = Annotated[Decimal, Field(ge=0, le=10, decimal_places=2)]


def _trim(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("이름을 입력해 주세요.")
    return value


class ParentInput(CamelModel):
    role: ParentRole
    alive: bool = True
    # 살아 계신 분의 나이(40~110)는 서비스에서 확인한다. 돌아가신 분의 나이·건강은 무시한다.
    age: int | None = Field(default=None, ge=0, le=150)
    health: Health | None = None
    life_expectancy_years: Decimal | None = Field(
        default=None, ge=Decimal("0.5"), le=60, decimal_places=1
    )


class AssetInput(CamelModel):
    id: str = Field(min_length=1, max_length=36)
    kind: AssetKind
    label: str = Field(min_length=1, max_length=30)
    value: Money
    official_price: Money | None = None
    region: Region | None = None
    regulated: bool = False
    over85: bool = False
    loan: Money = 0
    acquired_on: date | None = None
    acquisition_cost: Money | None = None
    resided_years: int = Field(default=0, ge=0, le=80)
    regulated_at_acquisition: bool = False
    parents_live_here: bool = False
    non_business_land: bool = False

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str) -> str:
        return _trim(value)

    @model_validator(mode="after")
    def ignore_unused(self):
        # 현금은 지역·공시가격·취득 정보를, 토지는 주택 전용 항목을,
        # 주택은 토지 전용 항목을 무시한다.
        if self.kind == "cash":
            self.official_price = self.region = self.acquired_on = self.acquisition_cost = None
            self.regulated = self.regulated_at_acquisition = False
        if self.kind != "house":
            self.over85 = self.parents_live_here = self.regulated_at_acquisition = False
            self.resided_years = 0
        if self.kind != "land":
            self.non_business_land = False
        return self


class PastGift(CamelModel):
    gifted_on: date
    donor_group: Literal["parents", "grandparents"]
    amount: PositiveMoney
    tax_paid: Money = 0


class ChildInput(CamelModel):
    id: str = Field(min_length=1, max_length=36)
    display_name: str = Field(min_length=1, max_length=20)
    is_self: bool = False
    age: int = Field(ge=19, le=90)
    house_count: int = Field(default=0, ge=0, le=20)
    past_gifts: list[PastGift] = Field(default_factory=list, max_length=20)

    @field_validator("display_name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return _trim(value)


class Assumptions(CamelModel):
    annual_growth_rate: Rate = Decimal("3")
    cost_inflation_rate: Rate = Decimal("2")
    care_monthly_cost: MonthlyMoney = 2_000_000
    care_years: int = Field(default=2, ge=0, le=20)
    official_price_ratio: Decimal = Field(default=Decimal("70"), ge=10, le=100, decimal_places=2)


class SuccessionInput(CamelModel):
    base_date: date | None = None
    parents: list[ParentInput] = Field(min_length=1, max_length=2)
    owner_role: ParentRole
    monthly_living_cost: MonthlyMoney = 0
    monthly_income: MonthlyMoney = 0
    parents_house_count: int = Field(default=0, ge=0, le=20)
    assets: list[AssetInput] = Field(min_length=1, max_length=20)
    children: list[ChildInput] = Field(min_length=1, max_length=10)
    assumptions: Assumptions = Field(default_factory=Assumptions)


class CaseSave(CamelModel):
    case: SuccessionInput
    sensitive_consent: bool = False


class CaseEnvelope(CamelModel):
    case: SuccessionInput | None
    sensitive_consent_at: datetime | None
    updated_at: datetime | None


class LifeExpectancyInfo(CamelModel):
    table_life_expectancy: Decimal
    health_factor: Decimal
    life_expectancy: Decimal
    years_assumed: int
    source: str


class ParentResult(CamelModel):
    role: ParentRole
    age: int
    table_life_expectancy: Decimal
    health_factor: Decimal
    life_expectancy: Decimal
    years_assumed: int
    expected_until: date
    care_from: date | None
    is_owner: bool


class CostRow(CamelModel):
    year: int
    on: date
    living: int
    care: int
    total: int


class Funding(CamelModel):
    costs: list[CostRow]
    survivor_need: int
    reserve_present_value: int
    cash_assets: int
    transferable_now: int
    shortfall: int


class Assignment(CamelModel):
    asset_id: str
    child_id: str


TransferMethod = Literal["gift", "sale_gift", "inherit"]
AcquisitionCode = Literal["gift", "gift_heavy", "inherit", "inherit_first_home"]
SaleCase = Literal[
    "exempt", "heavy_20", "heavy_30", "one_house_high", "non_business_land", "general"
]


class Transfer(CamelModel):
    on: date
    method: TransferMethod
    child_id: str | None
    asset_id: str | None
    asset_label: str
    asset_kind: AssetKind
    amount: int
    gift_tax: int
    acquisition_tax: int
    acquisition_tax_code: AcquisitionCode | None


class Sale(CamelModel):
    asset_id: str
    label: str
    price: int
    acquisition_cost: int
    holding_years: int
    case: SaleCase
    gain: int
    taxable_gain: int
    long_term_deduction: int
    tax_base: int
    income_tax: int
    local_income_tax: int
    total: int
    net_proceeds: int


class InheritanceSummary(CamelModel):
    on: date
    financial_assets: int
    real_estate: int
    debts: int
    spouse_share: int
    prior_gifts_added: int
    taxable_value: int
    applied_deduction: int
    tax_base: int
    payable_tax: int


class Taxes(CamelModel):
    gift_tax: int
    acquisition_tax: int
    capital_gains_tax: int
    inheritance_tax: int
    total: int
    total_at_horizon: int


ImpactCode = Literal[
    "inherit_first_home",
    "gift_heavy_acquisition",
    "one_house_exemption_risk",
    "inherited_house_special",
    "multi_home_sale_surcharge",
    "comprehensive_tax_surcharge",
    "carryover_basis",
]


class ImpactFlag(CamelModel):
    code: ImpactCode
    message: str


class ChildImpact(CamelModel):
    child_id: str
    house_count_before: int
    house_count_after: int
    flags: list[ImpactFlag]


class Plan(CamelModel):
    key: PlanKey
    label: str
    rank: int
    tier: Literal["best", "runner_up", "other"]
    transfers: list[Transfer]
    sales: list[Sale]
    inheritance: InheritanceSummary
    taxes: Taxes
    parents_remaining_now: int
    parents_reserve: int
    children_receive_at_horizon: int
    child_impacts: list[ChildImpact]
    reasons: list[str]


class ExcludedPlan(CamelModel):
    key: PlanKey
    label: str
    reason: str


class Source(CamelModel):
    label: str
    url: str


class SuccessionResult(CamelModel):
    base_date: date
    horizon_date: date
    spouse_alive_at_horizon: bool
    rule_version: str
    parents: list[ParentResult]
    funding: Funding
    assignments: list[Assignment]
    plans: list[Plan]
    excluded: list[ExcludedPlan]
    notes: list[str]
    assumptions: list[str]
    sources: list[Source]


class LifeTableRow(CamelModel):
    age: int
    father: Decimal
    mother: Decimal


class AcquisitionRateInfo(CamelModel):
    code: AcquisitionCode
    label: str
    acquisition_rate: Decimal
    education_rate: Decimal
    rural_rate: Decimal


class BracketInfo(CamelModel):
    up_to: int | None
    rate: Decimal
    progressive_deduction: int


class RulesInfo(CamelModel):
    version: str
    effective_from: date
    sources: list[Source]
    life_table: list[LifeTableRow]
    health_factors: dict[str, Decimal]
    acquisition_rates: list[AcquisitionRateInfo]
    capital_gains_brackets: list[BracketInfo]
    defaults: Assumptions
