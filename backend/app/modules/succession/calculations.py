"""DB·시계 없는 상속·증여(과제) 계산(스펙 22 5절). 금액은 단계마다 원 미만 버림.

증여세·상속세·공제 재생은 06의 공개 순수 함수(estate.service)만 부른다.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, localcontext

from app.core.errors import field_error
from app.modules.estate.schemas import (
    GiftTaxInput,
    InheritanceChild,
    InheritanceTaxInput,
    PriorGift,
    Recipient,
)
from app.modules.estate.service import (
    calc_deduction_status,
    calc_gift_tax,
    calc_inheritance_tax,
    replay_gift_deductions,
)
from app.modules.succession.rules.kr_2026_05_10 import RULES_2026_05_10 as RULES
from app.modules.succession.schemas import (
    AssetInput,
    Assignment,
    ChildImpact,
    CostRow,
    ExcludedPlan,
    Funding,
    Health,
    ImpactFlag,
    InheritanceSummary,
    LifeExpectancyInfo,
    ParentResult,
    ParentRole,
    Plan,
    PlanKey,
    Sale,
    Source,
    SuccessionInput,
    SuccessionResult,
    Taxes,
    Transfer,
)

LIFE_TABLE_SOURCE = "국가데이터처 2024년 생명표"
TENTH = Decimal("0.1")

PLAN_LABELS: dict[PlanKey, str] = {
    "inherit_only": "증여 없이 모두 상속",
    "cash_staged_deduction": "현금을 10년마다 공제 한도만큼 증여",
    "cash_staged_spread": "현금을 10년마다 나눠 증여(이전 가능액 전부)",
    "cash_lump_now": "이전 가능액을 지금 현금으로 증여",
    "realestate_gift_now": "부동산을 지금 그대로 증여",
    "realestate_sell_cash_now": "부동산을 팔아 현금으로 지금 증여",
    "realestate_gift_cash_staged": "부동산 증여 + 현금 10년 공제 한도 증여",
}

NO_CASH = "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요."
NO_GIFT_TARGET = "증여할 부동산이 없어요(부모님이 사시는 집은 빼요)."
NO_SALE_TARGET = "취득일·취득가액을 넣은 부동산이 없어 매각안을 계산하지 못했어요."
SHORT_FOR_REAL_ESTATE = "생활비·간병비가 현금보다 많아 부동산을 지금 넘기기 어려워요."
NO_DEDUCTION_LEFT = "자녀의 증여재산공제가 이미 모두 쓰여 공제 한도 안에서 넘길 금액이 없어요."

FLAG_MESSAGES = {
    "inherit_first_home": "무주택 상태에서 상속받는 첫 주택이라 취득세 특례(0.8%)가 적용돼요.",
    "gift_heavy_acquisition": (
        "부모님이 주택을 2채 이상 가지고 계셔서 이 주택 증여 취득세가 12%로 중과돼요."
    ),
    "one_house_exemption_risk": (
        "증여받은 주택이 주택 수에 더해져 지금 집을 팔 때 1세대 1주택 비과세를 받기 "
        "어려워질 수 있어요."
    ),
    "inherited_house_special": (
        "상속받은 주택은 요건을 갖추면 지금 집의 1세대 1주택 비과세 판단에서 빠질 수 "
        "있어요(상속주택 특례)."
    ),
    "multi_home_sale_surcharge": (
        "조정대상지역 주택을 포함해 2채 이상이 되면 나중에 팔 때 양도세가 중과"
        "(2채 +20%p, 3채 이상 +30%p)될 수 있어요."
    ),
    "comprehensive_tax_surcharge": (
        "주택이 3채 이상이면 종합부동산세 과세표준 12억 원 초과분에 중과세율이 적용될 수 있어요."
    ),
    "carryover_basis": (
        "증여받은 부동산을 10년 안에 팔면 부모님이 산 값으로 양도세를 계산해요(이월과세)."
    ),
}

EXCLUDED_SCOPE = [
    "2차 상속(명의자보다 오래 사시는 부모님이 돌아가실 때의 상속), 공동명의 지분별 상속, "
    "배우자 실제 상속분 협의는 계산하지 않아요.",
    "부담부증여, 동거주택 상속공제, 단기재상속 세액공제, 가업·영농 상속, "
    "농지 취득세 특례는 반영하지 않아요.",
    "양도세의 일시적 2주택·장기임대주택·상속주택 특례, 다주택 중과 배제 예외, "
    "같은 해 여러 자산 양도의 합산·비교과세는 반영하지 않아요.",
    "종합부동산세·재산세 금액과 자녀가 받은 뒤 팔 때의 양도세 금액은 계산하지 않아요"
    "(다주택 영향은 안내 문구로만 보여 줘요).",
    "손자녀·사위·며느리에게 넘기는 방안과 미성년 자녀는 다루지 않아요.",
    "조정대상지역 지정 여부는 자동으로 판정하지 않아요.",
    "이 화면의 입력과 결과는 AI 기능(LLM·챗봇)에 보내지 않아요.",
]


def won(value: Decimal | int) -> int:
    return int(Decimal(value).to_integral_value(rounding=ROUND_DOWN))


def money(value: int) -> str:
    return f"{value:,}원"


def percent(value: Decimal) -> str:
    return format(value.normalize(), "f")


def topic(word: str) -> str:
    """이름 뒤 보조사(은/는). 마지막 글자가 한글이 아니면 '은(는)'."""
    last = word[-1]
    if "가" <= last <= "힣":
        return word + ("은" if (ord(last) - 0xAC00) % 28 else "는")
    return word + "은(는)"


def add_years(day: date, years: int) -> date:
    # 06 add_years와 같다(2월 29일은 2월 28일).
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, day=28)


def full_years(start: date, end: date) -> int:
    return end.year - start.year - (end < add_years(start, end.year - start.year))


# ── 4.1 기대여명 ─────────────────────────────────────────────────────


def table_life_expectancy(role: ParentRole, age: int) -> Decimal:
    ages, values = RULES.life_table_ages, RULES.life_table[role]
    if age >= ages[-1]:
        return values[-1]
    for (low, high), (a, b) in zip(
        zip(ages, ages[1:], strict=False), zip(values, values[1:], strict=False), strict=True
    ):
        if low <= age <= high:
            value = a + (b - a) * Decimal(age - low) / Decimal(high - low)
            return value.quantize(TENTH, rounding=ROUND_HALF_UP)
    return values[0]


def life_expectancy(
    role: ParentRole, age: int, health: Health | None, override: Decimal | None = None
) -> LifeExpectancyInfo:
    table = table_life_expectancy(role, age)
    factor = RULES.health_factors.get(health, Decimal("1.0")) if health else Decimal("1.0")
    applied = (
        override.quantize(TENTH, rounding=ROUND_HALF_UP)
        if override is not None
        else (table * factor).quantize(TENTH, rounding=ROUND_HALF_UP)
    )
    return LifeExpectancyInfo(
        table_life_expectancy=table,
        health_factor=factor,
        life_expectancy=applied,
        years_assumed=max(1, int(applied.quantize(Decimal(1), rounding=ROUND_HALF_UP))),
        source=LIFE_TABLE_SOURCE,
    )


# ── 4.2 취득세 ──────────────────────────────────────────────────────


def acquisition_tax(base: int, code: str, asset: AssetInput) -> int:
    rate = RULES.acquisition_rates[code]
    rural = rate.rural if asset.kind == "land" or asset.over85 else Decimal(0)
    return won(base * rate.acquisition) + won(base * rate.education) + won(base * rural)


def official_price(asset: AssetInput, ratio: Decimal) -> int:
    if asset.official_price is not None:
        return asset.official_price
    return won(Decimal(asset.value) * ratio / 100)


def gift_acquisition_code(asset: AssetInput, parents_house_count: int, ratio: Decimal) -> str:
    heavy = (
        asset.kind == "house"
        and asset.regulated
        and official_price(asset, ratio) >= RULES.heavy_gift_official_price
        and parents_house_count >= 2
    )
    return "gift_heavy" if heavy else "gift"


# ── 4.3 양도소득세 ────────────────────────────────────────────────────


def capital_gains(
    asset: AssetInput, base_date: date, parents_house_count: int, apply_basic: bool
) -> Sale:
    price, cost = asset.value, asset.acquisition_cost or 0
    gain = max(0, price - cost)
    holding = full_years(asset.acquired_on, base_date)
    resided = min(asset.resided_years, holding)
    is_house = asset.kind == "house"
    one_house = (
        is_house
        and parents_house_count == 1
        and holding >= RULES.one_house_min_holding_years
        and (not asset.regulated_at_acquisition or resided >= RULES.one_house_min_residence_years)
    )
    base = {
        "asset_id": asset.id,
        "label": asset.label,
        "price": price,
        "acquisition_cost": cost,
        "holding_years": holding,
        "gain": gain,
    }
    if one_house and price <= RULES.one_house_exempt_price:
        return Sale(
            **base,
            case="exempt",
            taxable_gain=0,
            long_term_deduction=0,
            tax_base=0,
            income_tax=0,
            local_income_tax=0,
            total=0,
            net_proceeds=max(0, price - asset.loan),
        )
    surcharge, ltd_rate, case = Decimal(0), Decimal(0), "general"
    taxable = gain
    if is_house and asset.regulated and parents_house_count >= 2:
        surcharge = RULES.heavy_two_houses if parents_house_count == 2 else RULES.heavy_three_houses
        case = "heavy_20" if parents_house_count == 2 else "heavy_30"
    else:
        if one_house:
            case = "one_house_high"
            taxable = won(Decimal(gain) * (price - RULES.one_house_exempt_price) / Decimal(price))
        elif asset.kind == "land" and asset.non_business_land:
            case = "non_business_land"
            surcharge = RULES.non_business_land_surcharge
        if one_house and holding >= RULES.ltd_min_holding_years and resided >= 2:
            ltd_rate = RULES.one_house_ltd_rate * (
                min(holding, RULES.one_house_ltd_max_years)
                + min(resided, RULES.one_house_ltd_max_years)
            )
        elif holding >= RULES.ltd_min_holding_years:
            ltd_rate = RULES.general_ltd_rate * min(holding, RULES.general_ltd_max_years)
    deduction = won(taxable * ltd_rate)
    tax_base = max(
        0, taxable - deduction - (RULES.basic_capital_gains_deduction if apply_basic else 0)
    )
    bracket = next(
        b for b in RULES.capital_gains_brackets if b.up_to is None or tax_base <= b.up_to
    )
    tax = max(0, won(tax_base * (bracket.rate + surcharge) - bracket.progressive_deduction))
    if holding < 2:
        short = RULES.short_term_house if is_house else RULES.short_term_other
        tax = max(tax, won(tax_base * (short[0] if holding < 1 else short[1])))
    local = tax // RULES.local_income_tax_divisor
    return Sale(
        **base,
        case=case,
        taxable_gain=taxable,
        long_term_deduction=deduction,
        tax_base=tax_base,
        income_tax=tax,
        local_income_tax=local,
        total=tax + local,
        net_proceeds=max(0, price - asset.loan - tax - local),
    )


# ── 8.1 서비스 검증 ──────────────────────────────────────────────────


def validate_input(req: SuccessionInput) -> None:
    """형식 검증 뒤 필드 사이 규칙(8.1)을 확인한다. base_date는 이미 정해져 있어야 한다."""
    if req.base_date is None or req.base_date < RULES.effective_from:
        raise field_error("baseDate", "2026년 5월 10일 이후 기준일만 계산할 수 있어요.")
    roles = [parent.role for parent in req.parents]
    if len(set(roles)) != len(roles):
        raise field_error("parents", "아버지와 어머니는 한 번씩만 입력해 주세요.")
    alive = [parent for parent in req.parents if parent.alive]
    if not alive:
        raise field_error("parents", "살아 계신 부모님을 한 분 이상 입력해 주세요.")
    for index, parent in enumerate(req.parents):
        if parent.alive and (parent.age is None or not 40 <= parent.age <= 110):
            raise field_error(
                f"parents.{index}.age", "살아 계신 부모님 나이는 40~110세로 입력해 주세요."
            )
    if req.owner_role not in {parent.role for parent in alive}:
        raise field_error("ownerRole", "재산 명의자는 살아 계신 부모님이어야 해요.")
    if req.parents_house_count < sum(asset.kind == "house" for asset in req.assets):
        raise field_error("parentsHouseCount", "입력한 주택 수보다 적을 수 없어요.")
    seen: set[str] = set()
    for index, asset in enumerate(req.assets):
        if asset.id in seen:
            raise field_error(f"assets.{index}.id", "재산 id가 겹쳐요.")
        seen.add(asset.id)
        if asset.acquired_on and asset.acquired_on > req.base_date:
            raise field_error(f"assets.{index}.acquiredOn", "취득일은 기준일 이전이어야 해요.")
    if sum(child.is_self for child in req.children) > 1:
        raise field_error("children", "본인은 한 명만 고를 수 있어요.")
    seen = set()
    for index, child in enumerate(req.children):
        if child.id in seen:
            raise field_error(f"children.{index}.id", "자녀 id가 겹쳐요.")
        seen.add(child.id)
        for gift_index, gift in enumerate(child.past_gifts):
            if gift.gifted_on > req.base_date:
                raise field_error(
                    f"children.{index}.pastGifts.{gift_index}.giftedOn",
                    "과거 증여일은 기준일 이전이어야 해요.",
                )


# ── 5절 방안 계산 ────────────────────────────────────────────────────


@dataclass
class GiftItem:
    on: date
    child: int
    method: str  # "gift" | "sale_gift"
    asset: AssetInput | None
    amount: int
    gift_tax: int = 0
    acquisition_tax: int = 0
    acquisition_code: str | None = None

    @property
    def is_cash(self) -> bool:
        return self.asset is None or self.method == "sale_gift"


@dataclass
class Candidate:
    key: PlanKey
    gifts: list[GiftItem]
    sales: list[Sale]


class _Calculator:
    def __init__(self, req: SuccessionInput) -> None:
        self.req = req
        self.d0: date = req.base_date
        self.assumptions = req.assumptions
        self.growth = 1 + req.assumptions.annual_growth_rate / 100
        self.ratio = req.assumptions.official_price_ratio
        self.children = req.children
        self.recipients = [
            Recipient(relation="child", birth_date=add_years(self.d0, -child.age))
            for child in req.children
        ]
        self.assets = req.assets
        self.cash_total = sum(a.value for a in req.assets if a.kind == "cash")
        self.real = [a for a in req.assets if a.kind in ("house", "land")]
        self._factors: dict[tuple[date, date], Decimal] = {}
        self._timeline()
        self._funding()
        self._assign()
        self.gift_targets = [a for a in self.real if not a.parents_live_here and a.value > 0]
        self.sale_targets = [
            a
            for a in self.gift_targets
            if a.acquired_on is not None and a.acquisition_cost is not None
        ]
        self.rounds: list[date] = []
        day = self.d0
        while day < self.horizon:
            self.rounds.append(day)
            day = add_years(day, RULES.gift_round_years) + timedelta(days=1)

    # 5.1 시점
    def _timeline(self) -> None:
        self.parents = []
        self.years: dict[str, int] = {}
        for parent in self.req.parents:
            if not parent.alive:
                continue
            info = life_expectancy(
                parent.role, parent.age, parent.health, parent.life_expectancy_years
            )
            self.years[parent.role] = info.years_assumed
            self.parents.append((parent, info))
        self.n_owner = self.years[self.req.owner_role]
        self.horizon = add_years(self.d0, self.n_owner)
        others = [n for role, n in self.years.items() if role != self.req.owner_role]
        self.spouse_alive = bool(others) and others[0] > self.n_owner
        self.span = max(self.years.values())

    # 5.2 성장 계수
    def factor(self, start: date, end: date) -> Decimal:
        key = (start, end)
        if key not in self._factors:
            self._factors[key] = self.growth ** (Decimal((end - start).days) / 365)
        return self._factors[key]

    def at_horizon(self, amount: int, on: date) -> int:
        return won(amount * self.factor(on, self.horizon))

    def present(self, amount: int, on: date) -> int:
        return won(amount / self.factor(self.d0, on))

    # 5.3 생활비·간병비와 이전 가능액
    def _funding(self) -> None:
        assumptions = self.assumptions
        inflation = 1 + assumptions.cost_inflation_rate / 100
        monthly = max(0, self.req.monthly_living_cost - self.req.monthly_income)
        care_windows = []
        for parent, info in self.parents:
            n = info.years_assumed
            years = n if parent.health == "care" else min(assumptions.care_years, n)
            care_windows.append((n - years, n))
        self.costs: list[CostRow] = []
        for year in range(self.span):
            grown = inflation**year
            living = won(monthly * 12 * grown)
            care = sum(
                won(assumptions.care_monthly_cost * 12 * grown)
                for start, end in care_windows
                if start <= year < end
            )
            self.costs.append(
                CostRow(
                    year=year,
                    on=add_years(self.d0, year),
                    living=living,
                    care=care,
                    total=living + care,
                )
            )
        owner_costs = [row for row in self.costs if row.year < self.n_owner]
        self.survivor_need = (
            sum(row.total for row in self.costs if row.year >= self.n_owner)
            if self.spouse_alive
            else 0
        )
        self.reserve = sum(self.present(row.total, row.on) for row in owner_costs) + self.present(
            self.survivor_need, self.horizon
        )
        self.owner_costs_at_horizon = sum(self.at_horizon(row.total, row.on) for row in owner_costs)
        self.transferable = self.cash_total - self.reserve
        self.care_from = {
            parent.role: add_years(self.d0, start) if end > start else None
            for (parent, _), (start, end) in zip(self.parents, care_windows, strict=True)
        }

    # 5.4 부동산을 받을 자녀
    def _assign(self) -> None:
        houses = [child.house_count for child in self.children]
        values = [0] * len(self.children)
        self.assignment: dict[str, int] = {}
        for asset in self.real:
            if asset.kind == "house":
                index = min(range(len(self.children)), key=lambda i: (houses[i], values[i], i))
                houses[index] += 1
            else:
                index = min(range(len(self.children)), key=lambda i: (values[i], i))
            values[index] += asset.value
            self.assignment[asset.id] = index

    # 5.6 방안 후보
    def _histories(self) -> list[list[PriorGift]]:
        return [
            [
                PriorGift(
                    gifted_on=gift.gifted_on,
                    donor_group=gift.donor_group,
                    amount=gift.amount,
                    tax_paid=gift.tax_paid,
                )
                for gift in child.past_gifts
            ]
            for child in self.children
        ]

    def _record(self, histories, item: GiftItem) -> None:
        histories[item.child].append(
            PriorGift(gifted_on=item.on, donor_group="parents", amount=item.amount)
        )

    def _staged_deduction(self, histories) -> list[GiftItem]:
        items, budget = [], self.transferable
        for day in self.rounds:
            grown = self.factor(self.d0, day)
            for index in range(len(self.children)):
                status = calc_deduction_status(self.recipients[index], histories[index], day)
                available = next(
                    pool.available for pool in status.pools if pool.category == "lineal_ascendant"
                )
                amount = min(available, won(budget * grown))
                if amount <= 0:
                    continue
                item = GiftItem(day, index, "gift", None, amount)
                items.append(item)
                self._record(histories, item)
                budget -= self.present(amount, day)
        return items

    def _real_estate_gifts(self, histories) -> list[GiftItem]:
        items = []
        for asset in self.gift_targets:
            item = GiftItem(self.d0, self.assignment[asset.id], "gift", asset, asset.value)
            items.append(item)
            self._record(histories, item)
        return items

    def candidates(self) -> tuple[list[Candidate], list[ExcludedPlan]]:
        a, k, m = self.transferable, len(self.children), len(self.rounds)
        built: list[Candidate] = [Candidate("inherit_only", [], [])]
        excluded: list[ExcludedPlan] = []

        def exclude(key: PlanKey, reason: str) -> None:
            excluded.append(ExcludedPlan(key=key, label=PLAN_LABELS[key], reason=reason))

        if a <= 0:
            exclude("cash_staged_deduction", NO_CASH)
        else:
            gifts = self._staged_deduction(self._histories())
            if gifts:
                built.append(Candidate("cash_staged_deduction", gifts, []))
            else:
                exclude("cash_staged_deduction", NO_DEDUCTION_LEFT)
        if a <= 0:
            exclude("cash_staged_spread", NO_CASH)
            exclude("cash_lump_now", NO_CASH)
        else:
            share = won(Decimal(a) / (m * k))
            spread = [
                GiftItem(day, index, "gift", None, won(share * self.factor(self.d0, day)))
                for day in self.rounds
                for index in range(k)
            ]
            built.append(Candidate("cash_staged_spread", [g for g in spread if g.amount > 0], []))
            lump = won(Decimal(a) / k)
            built.append(
                Candidate(
                    "cash_lump_now",
                    [GiftItem(self.d0, index, "gift", None, lump) for index in range(k) if lump],
                    [],
                )
            )
        if not self.gift_targets:
            exclude("realestate_gift_now", NO_GIFT_TARGET)
        elif a < 0:
            exclude("realestate_gift_now", SHORT_FOR_REAL_ESTATE)
        else:
            built.append(
                Candidate("realestate_gift_now", self._real_estate_gifts(self._histories()), [])
            )
        if not self.gift_targets:
            exclude("realestate_sell_cash_now", NO_GIFT_TARGET)
        elif not self.sale_targets:
            exclude("realestate_sell_cash_now", NO_SALE_TARGET)
        else:
            built.append(self._sell_cash_now())
        if not self.gift_targets:
            exclude("realestate_gift_cash_staged", NO_GIFT_TARGET)
        elif a < 0:
            exclude("realestate_gift_cash_staged", SHORT_FOR_REAL_ESTATE)
        elif a == 0:
            exclude("realestate_gift_cash_staged", NO_CASH)
        else:
            histories = self._histories()
            gifts = self._real_estate_gifts(histories)
            gifts += self._staged_deduction(histories)
            built.append(Candidate("realestate_gift_cash_staged", gifts, []))
        return built, excluded

    def _sell_cash_now(self) -> Candidate:
        sales, basic_used = [], False
        for asset in self.sale_targets:
            sale = capital_gains(asset, self.d0, self.req.parents_house_count, not basic_used)
            basic_used = basic_used or sale.case != "exempt"
            sales.append(sale)
        limit = max(0, self.cash_total + sum(s.net_proceeds for s in sales) - self.reserve)
        gifts = []
        for asset, sale in zip(self.sale_targets, sales, strict=True):
            amount = min(sale.net_proceeds, limit)
            limit -= amount
            if amount > 0:
                gifts.append(
                    GiftItem(self.d0, self.assignment[asset.id], "sale_gift", asset, amount)
                )
        return Candidate("realestate_sell_cash_now", gifts, sales)

    # 5.5 증여세(같은 날 같은 자녀는 한 건으로)
    def _gift_taxes(self, gifts: list[GiftItem]) -> list[list[PriorGift]]:
        histories = self._histories()
        groups: dict[tuple[date, int], list[GiftItem]] = {}
        for item in gifts:
            groups.setdefault((item.on, item.child), []).append(item)
        for (on, index), items in sorted(groups.items(), key=lambda pair: pair[0]):
            total = sum(item.amount for item in items)
            tax = calc_gift_tax(
                GiftTaxInput(
                    recipient=self.recipients[index],
                    donor_group="parents",
                    gifted_on=on,
                    amount=total,
                    prior_gifts=histories[index],
                )
            ).payable_tax
            assigned = 0
            for item in items[:-1]:
                item.gift_tax = won(Decimal(tax) * item.amount / total)
                assigned += item.gift_tax
            items[-1].gift_tax = tax - assigned
            histories[index].append(
                PriorGift(gifted_on=on, donor_group="parents", amount=total, tax_paid=tax)
            )
        for item in gifts:
            if item.method == "gift" and item.asset is not None:
                item.acquisition_code = gift_acquisition_code(
                    item.asset, self.req.parents_house_count, self.ratio
                )
                item.acquisition_tax = acquisition_tax(
                    item.amount, item.acquisition_code, item.asset
                )
        return histories

    # 5.7 상속과 5.8 결과
    def evaluate(self, candidate: Candidate) -> Plan:
        gifts, sales = candidate.gifts, candidate.sales
        histories = self._gift_taxes(gifts)
        sold = {sale.asset_id for sale in sales}
        gifted = {g.asset.id for g in gifts if g.method == "gift" and g.asset is not None}
        net_total = sum(sale.net_proceeds for sale in sales)
        remaining = [a for a in self.real if a.id not in sold and a.id not in gifted]
        financial = max(
            0,
            self.at_horizon(self.cash_total + net_total, self.d0)
            - sum(self.at_horizon(g.amount, g.on) for g in gifts if g.is_cash)
            - self.owner_costs_at_horizon,
        )
        real_estate = sum(self.at_horizon(a.value, self.d0) for a in remaining)
        debts = sum(a.loan for a in self.assets if a.id not in sold)
        window_start = add_years(self.horizon, -RULES.heir_window_years)
        added = deductions = paid = 0
        for index, history in enumerate(histories):
            for gift, deduction in replay_gift_deductions(self.recipients[index], history):
                if gift.donor_group == "parents" and window_start < gift.gifted_on <= self.horizon:
                    added += gift.amount
                    deductions += deduction
                    paid += gift.tax_paid
        spouse_share = self.survivor_need if self.spouse_alive else 0
        # T 시점 금액은 요청 상한(1조 원)을 넘을 수 있어 06 비교와 같이 검증 없이 만든다.
        tax = calc_inheritance_tax(
            InheritanceTaxInput.model_construct(
                financial_assets=financial,
                real_estate=real_estate,
                debts=debts,
                financial_debts=debts,
                spouse_alive=self.spouse_alive,
                spouse_actual_share=self.survivor_need if self.spouse_alive else None,
                children=[
                    InheritanceChild(age=full_years(r.birth_date, self.horizon))
                    for r in self.recipients
                ],
                prior_gifts_to_heirs10y=added,
                prior_gift_deductions=deductions,
                prior_gift_tax_paid=paid,
            )
        )
        gift_houses = [0] * len(self.children)
        for g in gifts:
            if g.method == "gift" and g.asset is not None and g.asset.kind == "house":
                gift_houses[g.child] += 1
        houses_at_horizon = [
            c.house_count + n for c, n in zip(self.children, gift_houses, strict=True)
        ]
        first_home_used = [False] * len(self.children)
        transfers = [
            Transfer(
                on=g.on,
                method=g.method,
                child_id=self.children[g.child].id,
                asset_id=g.asset.id if g.asset else None,
                asset_label=(
                    "현금"
                    if g.asset is None
                    else f"{g.asset.label} 매각대금"
                    if g.method == "sale_gift"
                    else g.asset.label
                ),
                asset_kind="cash" if g.is_cash else g.asset.kind,
                amount=g.amount,
                gift_tax=g.gift_tax,
                acquisition_tax=g.acquisition_tax,
                acquisition_tax_code=g.acquisition_code,
            )
            for g in sorted(gifts, key=lambda g: (g.on, g.child))
        ]
        inherit_acquisition = 0
        inherited: list[tuple[int, AssetInput, str]] = []
        for asset in remaining:
            index = self.assignment[asset.id]
            code = "inherit"
            if (
                asset.kind == "house"
                and houses_at_horizon[index] == 0
                and not first_home_used[index]
            ):
                code = "inherit_first_home"
                first_home_used[index] = True
            amount = self.at_horizon(asset.value, self.d0)
            acq = acquisition_tax(
                self.at_horizon(official_price(asset, self.ratio), self.d0), code, asset
            )
            inherit_acquisition += acq
            inherited.append((index, asset, code))
            transfers.append(
                Transfer(
                    on=self.horizon,
                    method="inherit",
                    child_id=self.children[index].id,
                    asset_id=asset.id,
                    asset_label=asset.label,
                    asset_kind=asset.kind,
                    amount=amount,
                    gift_tax=0,
                    acquisition_tax=acq,
                    acquisition_tax_code=code,
                )
            )
        transfers.append(
            Transfer(
                on=self.horizon,
                method="inherit",
                child_id=None,
                asset_id=None,
                asset_label="금융재산(자녀 공동)",
                asset_kind="cash",
                amount=max(0, financial - spouse_share),
                gift_tax=0,
                acquisition_tax=0,
                acquisition_tax_code=None,
            )
        )
        gift_tax = sum(g.gift_tax for g in gifts)
        gift_acquisition = sum(g.acquisition_tax for g in gifts)
        capital = sum(sale.total for sale in sales)
        # 19절: 지금 내는 세금은 낸 날부터 T까지 불리고, T에 내는 세금은 그대로 더한다.
        total_at_horizon = (
            sum(self.at_horizon(g.gift_tax + g.acquisition_tax, g.on) for g in gifts)
            + sum(self.at_horizon(sale.total, self.d0) for sale in sales)
            + inherit_acquisition
            + tax.payable_tax
        )
        taxes = Taxes(
            gift_tax=gift_tax,
            acquisition_tax=gift_acquisition + inherit_acquisition,
            capital_gains_tax=capital,
            inheritance_tax=tax.payable_tax,
            total=gift_tax + gift_acquisition + inherit_acquisition + capital + tax.payable_tax,
            total_at_horizon=total_at_horizon,
        )
        remaining_now = (
            self.cash_total
            + net_total
            - sum(g.amount for g in gifts if g.is_cash and g.on == self.d0)
            + sum(a.value for a in remaining)
            - debts
        )
        receive = (
            sum(self.at_horizon(g.amount - g.gift_tax - g.acquisition_tax, g.on) for g in gifts)
            + max(0, financial + real_estate - debts)
            - spouse_share
            - tax.payable_tax
            - inherit_acquisition
        )
        return Plan(
            key=candidate.key,
            label=PLAN_LABELS[candidate.key],
            rank=0,
            tier="other",
            transfers=transfers,
            sales=sales,
            inheritance=InheritanceSummary(
                on=self.horizon,
                financial_assets=financial,
                real_estate=real_estate,
                debts=debts,
                spouse_share=spouse_share,
                prior_gifts_added=added,
                taxable_value=tax.taxable_value,
                applied_deduction=tax.applied_deduction,
                tax_base=tax.tax_base,
                payable_tax=tax.payable_tax,
            ),
            taxes=taxes,
            parents_remaining_now=remaining_now,
            parents_reserve=self.reserve,
            children_receive_at_horizon=receive,
            child_impacts=self._impacts(gifts, inherited, houses_at_horizon),
            reasons=self._plan_reasons(candidate.key, gifts, sales, tax.applied_deduction),
        )

    # 5.10 자녀 주택 수 영향
    def _impacts(self, gifts, inherited, houses_at_horizon) -> list[ChildImpact]:
        impacts = []
        for index, child in enumerate(self.children):
            gifted = [g.asset for g in gifts if g.child == index and g.method == "gift" and g.asset]
            got = [(asset, code) for i, asset, code in inherited if i == index]
            if not gifted and not got:
                continue
            gift_houses = [a for a in gifted if a.kind == "house"]
            inherit_houses = [a for a, _ in got if a.kind == "house"]
            houses = gift_houses + inherit_houses
            after = child.house_count + len(houses)
            codes = []
            if any(code == "inherit_first_home" for _, code in got):
                codes.append("inherit_first_home")
            if any(
                g.acquisition_code == "gift_heavy" for g in gifts if g.child == index and g.asset
            ):
                codes.append("gift_heavy_acquisition")
            if gift_houses and child.house_count >= 1:
                codes.append("one_house_exemption_risk")
            if inherit_houses and houses_at_horizon[index] >= 1:
                codes.append("inherited_house_special")
            if houses and after >= 2 and any(a.regulated for a in houses):
                codes.append("multi_home_sale_surcharge")
            if houses and after >= 3:
                codes.append("comprehensive_tax_surcharge")
            if gifted:
                codes.append("carryover_basis")
            impacts.append(
                ChildImpact(
                    child_id=child.id,
                    house_count_before=child.house_count,
                    house_count_after=after,
                    flags=[ImpactFlag(code=code, message=FLAG_MESSAGES[code]) for code in codes],
                )
            )
        return impacts

    # 5.9 추천 이유(순위 문장은 순위를 정한 뒤 앞에 붙인다)
    def _plan_reasons(self, key: PlanKey, gifts, sales, applied_deduction: int) -> list[str]:
        gift_tax = sum(g.gift_tax for g in gifts)
        reasons = [
            {
                "inherit_only": (
                    "지금은 재산을 넘기지 않아 부모님 재산이 그대로 남고, "
                    f"상속 때 공제 {money(applied_deduction)}을 받아요."
                ),
                "cash_staged_deduction": (
                    "10년마다 자녀 1명당 5천만 원 공제 한도 안에서만 넘겨 "
                    f"증여세가 {money(gift_tax)}이에요."
                ),
                "cash_staged_spread": (
                    f"이전 가능액을 {len(self.rounds)}번에 나눠 넘겨 "
                    "한 번에 높은 세율 구간이 적용되지 않게 해요."
                ),
                "cash_lump_now": (
                    "이전 가능액을 지금 넘겨 앞으로 늘어날 가치가 상속재산에서 빠져요."
                ),
                "realestate_gift_now": (
                    "부동산을 지금 넘겨 앞으로 오를 가격만큼 상속재산이 줄어요. "
                    "대신 자녀가 증여세와 취득세 "
                    f"{money(gift_tax + sum(g.acquisition_tax for g in gifts))}을 내요."
                ),
                "realestate_sell_cash_now": (
                    "부동산을 팔아 현금으로 넘겨요. "
                    f"부모님이 양도소득세 {money(sum(s.total for s in sales))}을 내요."
                ),
                "realestate_gift_cash_staged": (
                    "부동산을 지금 넘기고, 남는 현금은 10년마다 공제 한도만큼 넘겨요."
                ),
            }[key]
        ]
        window_start = add_years(self.horizon, -RULES.heir_window_years)
        recent = sum(g.amount for g in gifts if g.on > window_start)
        if recent:
            reasons.append(
                f"상속 가정 시점({self.horizon.isoformat()}) 전 10년 안에 한 증여 "
                f"{money(recent)}은 상속재산에 다시 더해져요."
            )
        if any(g.acquisition_code == "gift_heavy" for g in gifts):
            reasons.append(
                "부모님이 주택을 2채 이상 가지고 계셔서 조정대상지역 주택 증여 취득세가 "
                "12%로 무거워져요."
            )
        return reasons

    def notes(self, included: set[PlanKey]) -> list[str]:
        notes = [
            "기대여명은 2024년 생명표 평균에 건강 상태 가정을 곱한 값이에요. "
            "실제와 다를 수 있어요.",
            f"재산은 연 {percent(self.assumptions.annual_growth_rate)}%, 생활비·간병비는 "
            f"연 {percent(self.assumptions.cost_inflation_rate)}%씩 늘어난다고 가정했어요.",
            f"지금 내는 세금은 상속 시점까지 연 {percent(self.assumptions.annual_growth_rate)}%로 "
            "불려 상속세와 더해 순위를 매겼어요.",
            "실행 전에 세무전문가에게 입력 정보와 결과를 검토받으세요.",
        ]
        if "realestate_sell_cash_now" in included:
            sale_ids = {a.id for a in self.sale_targets}
            notes.extend(
                f"취득 정보가 없는 {topic(a.label)} 팔지 않고 계산했어요."
                for a in self.gift_targets
                if a.id not in sale_ids
            )
        return notes

    def assumption_lines(self) -> list[str]:
        return [
            *EXCLUDED_SCOPE,
            "재산 명의자는 한 분이며, 공동명의 재산도 명의자 재산으로 합쳐 계산해요.",
            "명의자보다 오래 사시는 부모님은 남은 생활·간병비만큼 상속받고 나머지는 "
            "자녀가 상속받는다고 봐요.",
            "생활·간병비는 부모님 현금에서 쓰고, 모자라도 부동산을 팔지 않는다고 봐요.",
            "대출은 상속 때까지 그대로 남고 모두 금융회사 채무로 봐요. "
            "부동산 증여는 대출을 넘기지 않는 단순 증여예요.",
            "부동산 가격은 입력한 시가를 쓰고, 공시가격을 비우면 시가의 "
            f"{percent(self.ratio)}%로 봐요.",
            "장례비는 최소 공제(500만 원)만 반영해요.",
            "양도세 기본공제 250만 원은 한 번만 적용해요.",
            "증여세·증여 취득세·양도세는 증여하거나 판 날, 상속세·상속 취득세는 상속 가정 "
            "시점에 낸다고 봐요.",
            "부모님이 준 과거 증여는 모두 재산 명의자가 준 것으로 봐요.",
            "자녀 생년월일은 기준일에서 나이만큼 뺀 날로 봐요.",
            "조정대상지역 여부는 입력한 값을 그대로 써요.",
        ]


ORDER: list[PlanKey] = list(PLAN_LABELS)


def calculate_plans(req: SuccessionInput) -> SuccessionResult:
    """스펙 22 5절. base_date가 정해진 입력을 받는 순수 함수."""
    validate_input(req)
    with localcontext() as ctx:
        ctx.prec = 28
        calc = _Calculator(req)
        candidates, excluded = calc.candidates()
        plans = [calc.evaluate(candidate) for candidate in candidates]
    plans.sort(
        key=lambda p: (
            p.taxes.total_at_horizon,
            -p.children_receive_at_horizon,
            ORDER.index(p.key),
        )
    )
    best = plans[0].taxes.total_at_horizon
    for rank, plan in enumerate(plans, start=1):
        plan.rank = rank
        plan.tier = "best" if rank == 1 else "runner_up" if rank <= 3 else "other"
        plan.reasons.insert(
            0,
            f"상속 시점({calc.horizon.isoformat()}) 기준으로 맞춘 세금 합계가 가장 적어요"
            f"({money(best)})."
            if rank == 1
            else "상속 시점 기준 세금 합계가 최선안보다 "
            f"{money(plan.taxes.total_at_horizon - best)} 많아요.",
        )
    excluded.sort(key=lambda e: ORDER.index(e.key))
    return SuccessionResult(
        base_date=calc.d0,
        horizon_date=calc.horizon,
        spouse_alive_at_horizon=calc.spouse_alive,
        rule_version=RULES.version,
        parents=[
            ParentResult(
                role=parent.role,
                age=parent.age,
                table_life_expectancy=info.table_life_expectancy,
                health_factor=info.health_factor,
                life_expectancy=info.life_expectancy,
                years_assumed=info.years_assumed,
                expected_until=add_years(calc.d0, info.years_assumed),
                care_from=calc.care_from[parent.role],
                is_owner=parent.role == req.owner_role,
            )
            for parent, info in calc.parents
        ],
        funding=Funding(
            costs=calc.costs,
            survivor_need=calc.survivor_need,
            reserve_present_value=calc.reserve,
            cash_assets=calc.cash_total,
            transferable_now=calc.transferable,
            shortfall=max(0, -calc.transferable),
        ),
        assignments=[
            Assignment(asset_id=asset.id, child_id=req.children[calc.assignment[asset.id]].id)
            for asset in calc.real
        ],
        plans=plans,
        excluded=excluded,
        notes=calc.notes({p.key for p in plans}),
        assumptions=calc.assumption_lines(),
        sources=[Source(label=label, url=url) for label, url in RULES.sources],
    )
