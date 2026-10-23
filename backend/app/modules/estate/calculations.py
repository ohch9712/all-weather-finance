"""DB·시계에 의존하지 않는 계산. 금액은 단계마다 원 미만 버림."""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal, localcontext

from app.core.errors import field_error
from app.modules.estate.rules import get_active_rules
from app.modules.estate.rules.kr_2024_01_01 import RULES_2024_01_01 as RULES
from app.modules.estate.schemas import (
    Category,
    CompareGift,
    CompareScenario,
    DeductionStatus,
    EligibilityWindow,
    EstateCompareInput,
    EstateCompareResult,
    GiftPlanInput,
    GiftPlanResult,
    GiftTaxInput,
    GiftTaxResult,
    InheritanceChild,
    InheritanceSummary,
    InheritanceTaxInput,
    InheritanceTaxResult,
    LumpSum,
    MarriageBirthStatus,
    PlannedGift,
    Pool,
    PriorGift,
    Recipient,
    Step,
)

CATEGORIES: dict[str, Category] = {
    "parents": "lineal_ascendant",
    "grandparents": "lineal_ascendant",
    "spouse": "spouse",
    "children": "lineal_descendant",
    "relative": "other_relative",
    "non_relative": "none",
}
ALLOWED_GROUPS = {
    "spouse": {"spouse"},
    "child": {"parents", "grandparents", "relative", "non_relative"},
    "grandchild": {"parents", "grandparents", "relative", "non_relative"},
    "parent": {"children", "relative", "non_relative"},
    "other_relative": {"relative", "non_relative"},
}
ASSUMPTIONS = [
    "거주자를 대상으로 하며 입력한 평가액을 그대로 사용합니다.",
    "부담부증여, 창업자금·가업승계·영농 특례와 증여재산 평가 규칙은 반영하지 않습니다.",
    "상속인은 배우자와 자녀만 다루며 대습상속, 직계존속·형제 상속은 제외합니다.",
    "배우자 상속공제의 법정 한도는 단순식으로 계산합니다.",
    "상속세 세대생략 할증, 재해손실공제, 가업·영농상속공제와 실제 신고서 작성은 다루지 않습니다.",
]


def won(value: Decimal | int) -> int:
    return int(Decimal(value).to_integral_value(rounding=ROUND_DOWN))


def add_years(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, day=28)


def age_on(birth_date: date | None, day: date) -> int | None:
    if birth_date is None:
        return None
    return day.year - birth_date.year - (day < add_years(birth_date, day.year - birth_date.year))


def validate_group(recipient: Recipient, group: str) -> None:
    if group not in ALLOWED_GROUPS[recipient.relation]:
        raise field_error("donorGroup", "이 가족에게 맞지 않는 증여자입니다.")


def limit_for(category: str, recipient: Recipient, day: date) -> int:
    if category == "lineal_ascendant":
        age = age_on(recipient.birth_date, day)
        if age is None:
            raise field_error("birthDate", "직계존속 공제를 계산하려면 생년월일이 필요합니다.")
        return RULES.minor_gift if age < RULES.minor_age else RULES.adult_gift
    return {
        "spouse": RULES.spouse_gift,
        "lineal_descendant": RULES.adult_gift,
        "other_relative": RULES.relative_gift,
        "none": 0,
    }[category]


def marriage_windows(recipient: Recipient) -> list[EligibilityWindow]:
    windows = []
    if recipient.married_on:
        windows.append(
            EligibilityWindow(
                kind="marriage",
                from_=add_years(recipient.married_on, -RULES.marriage_window_years),
                to=add_years(recipient.married_on, RULES.marriage_window_years),
            )
        )
    windows.extend(
        EligibilityWindow(kind="birth", from_=day, to=add_years(day, RULES.marriage_window_years))
        for day in recipient.child_birth_dates
    )
    return windows


def eligible(recipient: Recipient, day: date) -> bool:
    return day >= RULES.effective_from and any(
        window.from_ <= day <= window.to for window in marriage_windows(recipient)
    )


@dataclass(frozen=True)
class ReplayedGift:
    gift: PriorGift
    deduction: int
    marriage_birth_deduction: int
    estimated_tax: int


def replay_gifts(recipient: Recipient, records: list[PriorGift]) -> list[ReplayedGift]:
    """기본 공제의 과거 사용액을 재생한다. 혼인·출산 공제는 시행일 이후만 적용한다."""
    result: list[ReplayedGift] = []
    for gift in sorted(records, key=lambda x: x.gifted_on):
        category = CATEGORIES[gift.donor_group]
        used = sum(
            row.deduction
            for row in result
            if CATEGORIES[row.gift.donor_group] == category
            and add_years(gift.gifted_on, -RULES.gift_window_years)
            < row.gift.gifted_on
            <= gift.gifted_on
        )
        deduction = min(max(0, limit_for(category, recipient, gift.gifted_on) - used), gift.amount)
        marriage_used = sum(row.marriage_birth_deduction for row in result)
        marriage = 0
        if (
            category == "lineal_ascendant"
            and gift.marriage_birth_claimed
            and eligible(recipient, gift.gifted_on)
        ):
            marriage = min(max(0, RULES.marriage_birth - marriage_used), gift.amount - deduction)
        estimate = _gift_tax(
            GiftTaxInput(
                recipient=recipient,
                gifted_on=gift.gifted_on,
                donor_group=gift.donor_group,
                amount=gift.amount,
                appraisal_fee=gift.appraisal_fee,
                claim_marriage_birth=gift.marriage_birth_claimed,
            ),
            result,
        ).payable_tax
        result.append(ReplayedGift(gift, deduction, marriage, estimate))
    return result


def tax_for(base: int) -> tuple[int, str]:
    if base < RULES.minimum_tax_base:
        return 0, "과세표준 50만원 미만은 과세하지 않습니다."
    bracket = next(b for b in RULES.brackets if b.up_to is None or base <= b.up_to)
    return won(
        Decimal(base) * bracket.rate - bracket.progressive_deduction
    ), f"{won(bracket.rate * 100)}% 구간, 누진공제 {bracket.progressive_deduction:,}원"


def _gift_tax(req: GiftTaxInput, prior: list[ReplayedGift]) -> GiftTaxResult:
    category = CATEGORIES[req.donor_group]
    recent = [
        row
        for row in prior
        if add_years(req.gifted_on, -RULES.gift_window_years) < row.gift.gifted_on < req.gifted_on
    ]
    same = [row for row in recent if row.gift.donor_group == req.donor_group]
    aggregated = sum(row.gift.amount for row in same)
    if aggregated < RULES.aggregation_threshold:
        aggregated, same = 0, []
    taxable = req.amount + aggregated
    other_used = sum(
        row.deduction
        for row in recent
        if CATEGORIES[row.gift.donor_group] == category and row.gift.donor_group != req.donor_group
    )
    deduction = min(max(0, limit_for(category, req.recipient, req.gifted_on) - other_used), taxable)
    marriage = 0
    if (
        req.claim_marriage_birth
        and category == "lineal_ascendant"
        and eligible(req.recipient, req.gifted_on)
    ):
        marriage = min(
            max(
                0,
                RULES.marriage_birth
                - sum(
                    row.marriage_birth_deduction
                    for row in prior
                    if row.gift.gifted_on < req.gifted_on
                ),
            ),
            taxable - deduction,
        )
    base = max(0, taxable - deduction - marriage - req.appraisal_fee)
    calculated, bracket_note = tax_for(base)
    surcharge = 0
    if req.donor_group == "grandparents" and not req.recipient.parent_deceased:
        rate = (
            RULES.minor_skip_rate
            if (age_on(req.recipient.birth_date, req.gifted_on) or 0) < RULES.minor_age
            and req.amount > RULES.minor_skip_threshold
            else RULES.skip_rate
        )
        surcharge = won(Decimal(calculated) * rate)
    prior_credit = min(sum(row.gift.tax_paid for row in same), calculated + surcharge)
    filing = won(Decimal(calculated + surcharge - prior_credit) * RULES.filing_rate)
    payable = max(0, calculated + surcharge - prior_credit - filing)
    amounts = [
        req.amount,
        aggregated,
        taxable,
        deduction,
        marriage,
        req.appraisal_fee,
        base,
        calculated,
        surcharge,
        prior_credit,
        filing,
        payable,
    ]
    keys = [
        "giftAmount",
        "aggregatedPrior",
        "taxableValue",
        "deduction",
        "marriageBirthDeduction",
        "appraisalFee",
        "taxBase",
        "calculatedTax",
        "surcharge",
        "priorTaxCredit",
        "filingCredit",
        "payableTax",
    ]
    labels = [
        "이번 증여재산가액",
        "10년 내 동일 그룹 합산",
        "과세가액",
        "증여재산공제",
        "혼인·출산 공제",
        "감정평가수수료",
        "과세표준",
        "산출세액",
        "세대생략 할증",
        "기납부세액공제",
        "신고세액공제",
        "납부세액",
    ]
    notes = [
        "입력한 평가액",
        "같은 증여자 그룹 합계 1천만원 이상만 합산",
        "이번 증여액 + 합산액",
        "제53조: 같은 공제 구분의 다른 그룹 사용액 차감",
        "제53조의2: 직계존속·기간 충족·평생 1억원",
        "입력한 수수료 차감",
        "과세가액 − 공제 − 수수료",
        bracket_note,
        "제57조: 30%, 미성년·20억원 초과 40%, 부모 사망 시 제외",
        "합산한 기록의 실제 납부세액, 산출세액+할증 한도",
        "공제 후 세액의 3%, 원 미만 버림",
        "산출세액 + 할증 − 세액공제",
    ]
    return GiftTaxResult(
        steps=[
            Step(key=k, label=label, amount=a, note=n)
            for k, label, a, n in zip(keys, labels, amounts, notes, strict=True)
        ],
        taxable_value=taxable,
        deduction=deduction,
        marriage_birth_deduction=marriage,
        tax_base=base,
        calculated_tax=calculated,
        surcharge=surcharge,
        prior_tax_credit=prior_credit,
        filing_credit=filing,
        payable_tax=payable,
        notes=["신고기한(증여일이 속한 달의 말일부터 3개월) 안에 신고한다고 가정했습니다."],
        assumptions=list(ASSUMPTIONS),
        rule_version=RULES.version,
    )


def calc_gift_tax(req: GiftTaxInput) -> GiftTaxResult:
    if req.gifted_on < RULES.effective_from:
        raise field_error("giftedOn", "2024년 1월 1일 이후 증여만 계산할 수 있어요.")
    get_active_rules(req.gifted_on)
    validate_group(req.recipient, req.donor_group)
    if req.recipient.birth_date and req.gifted_on < req.recipient.birth_date:
        raise field_error("giftedOn", "증여일은 생년월일 이후여야 합니다.")
    prior = replay_gifts(
        req.recipient, [gift for gift in req.prior_gifts if gift.gifted_on < req.gifted_on]
    )
    return _gift_tax(req, prior)


def deduction_status(
    recipient: Recipient, records: list[PriorGift], as_of: date
) -> DeductionStatus:
    rules = get_active_rules(as_of)
    replayed = replay_gifts(recipient, [g for g in records if g.gifted_on <= as_of])
    default_category = {
        "child": "lineal_ascendant",
        "grandchild": "lineal_ascendant",
        "spouse": "spouse",
        "parent": "lineal_descendant",
        "other_relative": "other_relative",
    }[recipient.relation]
    categories = {default_category} | {CATEGORIES[g.gift.donor_group] for g in replayed}
    pools = []
    for category in CATEGORIES.values():
        if category not in categories:
            continue
        categories.remove(category)
        recent = [
            r
            for r in replayed
            if CATEGORIES[r.gift.donor_group] == category
            and add_years(as_of, -RULES.gift_window_years) < r.gift.gifted_on <= as_of
        ]
        limit = limit_for(category, recipient, as_of)
        used = sum(r.deduction for r in recent)
        reset = min(
            (
                add_years(r.gift.gifted_on, RULES.gift_window_years) + timedelta(days=1)
                for r in recent
            ),
            default=None,
        )
        pools.append(
            Pool(
                category=category,
                limit=limit,
                used_within10y=used,
                available=max(0, limit - used),
                next_reset_on=reset,
            )
        )
    age = age_on(recipient.birth_date, as_of)
    used_marriage = sum(r.marriage_birth_deduction for r in replayed)
    return DeductionStatus(
        as_of=as_of,
        age=age,
        is_minor=None if age is None else age < RULES.minor_age,
        adult_on=add_years(recipient.birth_date, RULES.minor_age)
        if recipient.birth_date and age is not None and age < RULES.minor_age
        else None,
        pools=pools,
        marriage_birth=MarriageBirthStatus(
            limit=RULES.marriage_birth,
            used=used_marriage,
            available=max(0, RULES.marriage_birth - used_marriage),
            eligible_now=recipient.relation in {"child", "grandchild"}
            and eligible(recipient, as_of),
            windows=marriage_windows(recipient),
        ),
        rule_version=rules.version,
    )


def calc_inheritance_tax(req: InheritanceTaxInput) -> InheritanceTaxResult:
    if not req.spouse_alive and not req.children:
        raise field_error("children", "이 계산기는 배우자와 자녀 상속만 다룹니다.")
    funeral = max(RULES.funeral_minimum, min(req.funeral_expense, RULES.funeral_maximum)) + min(
        req.enshrinement_expense, RULES.enshrinement_maximum
    )
    total = req.financial_assets + req.real_estate + req.other_assets
    prior = req.prior_gifts_to_heirs10y + req.prior_gifts_to_non_heirs5y
    taxable = max(0, total - req.debts - funeral + prior)
    personal = (
        RULES.basic_inheritance
        + len(req.children) * RULES.child_deduction
        + req.elderly_dependents * RULES.elderly_deduction
    )
    for child in req.children:
        personal += max(0, RULES.minor_age - child.age) * RULES.minor_year_deduction
        personal += (child.disabled_life_expectancy_years or 0) * RULES.disability_year_deduction
    lump = 0 if req.spouse_alive and not req.children else RULES.lump_sum_deduction
    spouse = 0
    if req.spouse_alive:
        legal = won(
            Decimal(max(0, total - req.debts + req.prior_gifts_to_heirs10y))
            * RULES.spouse_weight
            / (RULES.spouse_weight + len(req.children))
        )
        actual = legal if req.spouse_actual_share is None else req.spouse_actual_share
        spouse = max(RULES.spouse_minimum, min(actual, legal, RULES.spouse_maximum))
    net_financial = max(0, req.financial_assets - req.financial_debts)
    financial = (
        net_financial
        if net_financial <= RULES.financial_small
        else RULES.financial_small
        if net_financial <= RULES.financial_middle
        else min(RULES.financial_maximum, won(Decimal(net_financial) * RULES.financial_rate))
    )
    house = (
        min(req.cohabiting_house.value, RULES.cohabiting_maximum)
        if req.cohabiting_house.eligible
        else 0
    )
    total_deduction = max(personal, lump) + spouse + financial + house
    limit = max(0, taxable - max(0, prior - req.prior_gift_deductions))
    applied = min(total_deduction, limit)
    base = max(0, taxable - applied - req.appraisal_fee)
    tax, bracket_note = tax_for(base)
    gift_credit = min(req.prior_gift_tax_paid, tax)
    filing = won(Decimal(tax - gift_credit) * RULES.filing_rate)
    payable = max(0, tax - gift_credit - filing)
    keys = [
        "funeralDeduction",
        "taxableValue",
        "basicPersonalDeduction",
        "lumpSumDeduction",
        "spouseDeduction",
        "financialDeduction",
        "cohabitingHouseDeduction",
        "totalDeduction",
        "deductionLimit",
        "appliedDeduction",
        "taxBase",
        "calculatedTax",
        "giftTaxCredit",
        "filingCredit",
        "payableTax",
    ]
    labels = [
        "장례비 공제",
        "과세가액",
        "기초 + 인적공제",
        "일괄공제",
        "배우자공제",
        "금융재산공제",
        "동거주택공제",
        "공제 합계",
        "종합한도",
        "적용 공제",
        "과세표준",
        "산출세액",
        "증여세액공제",
        "신고세액공제",
        "납부세액",
    ]
    amounts = [
        funeral,
        taxable,
        personal,
        lump,
        spouse,
        financial,
        house,
        total_deduction,
        limit,
        applied,
        base,
        tax,
        gift_credit,
        filing,
        payable,
    ]
    notes = [
        "장례비 500만~1천만원 + 봉안비 최대 500만원",
        "상속재산 − 채무 − 장례비 + 사전증여",
        "기초 2억원, 자녀·미성년·장애인·65세 이상 공제",
        "기초+인적공제와 큰 금액 적용, 배우자 단독은 적용 불가",
        "법정비율 1.5/(1.5+자녀 수), 최소 5억·최대 30억원",
        "순금융재산 기준, 최대 2억원",
        "요건 충족 시 주택가액, 최대 6억원",
        "선택한 인적공제 + 배우자 + 금융 + 주택",
        "과세가액 − (사전증여 − 증여재산공제), 0원 하한",
        "공제 합계와 종합한도 중 작은 값",
        "과세가액 − 적용 공제 − 감정평가수수료",
        bracket_note,
        "실제 낸 증여세, 산출세액 한도",
        "증여세액공제 후 3%, 원 미만 버림",
        "산출세액 − 증여세액공제 − 신고세액공제",
    ]
    return InheritanceTaxResult(
        steps=[
            Step(key=k, label=label, amount=a, note=n)
            for k, label, a, n in zip(keys, labels, amounts, notes, strict=True)
        ],
        funeral_deduction=funeral,
        taxable_value=taxable,
        basic_personal_deduction=personal,
        lump_sum_deduction=lump,
        spouse_deduction=spouse,
        financial_deduction=financial,
        cohabiting_house_deduction=house,
        total_deduction=total_deduction,
        deduction_limit=limit,
        applied_deduction=applied,
        tax_base=base,
        calculated_tax=tax,
        gift_tax_credit=gift_credit,
        filing_credit=filing,
        payable_tax=payable,
        notes=["신고기한 안에 신고하여 신고세액공제 3%를 받는다고 가정했습니다."],
        assumptions=list(ASSUMPTIONS),
        rule_version=RULES.version,
    )


def future_value(amount: int, day: date, end: date, rate: Decimal) -> int:
    with localcontext() as ctx:
        ctx.prec = 28
        return won(Decimal(amount) * (1 + rate / 100) ** (Decimal((end - day).days) / 365))


def simulate_gift_plan(req: GiftPlanInput) -> GiftPlanResult:
    get_active_rules(req.start_date)
    recipient = req.recipient or Recipient(
        birth_date=req.birth_date,
        relation="grandchild" if req.donor_group == "grandparents" else "child",
    )
    validate_group(recipient, req.donor_group)
    if CATEGORIES[req.donor_group] != "lineal_ascendant":
        raise field_error("donorGroup", "분산 증여 플랜은 부모·조부모 증여만 다룹니다.")
    if req.expected_marriage_date:
        recipient = recipient.model_copy(update={"married_on": req.expected_marriage_date})
    end = add_years(req.birth_date, req.target_age + 1) - timedelta(days=1)
    candidate = max(req.start_date, req.birth_date)
    first = candidate
    history = list(req.prior_gifts)
    schedule: list[PlannedGift] = []
    while candidate <= end:
        status = deduction_status(recipient, history, candidate)
        pool = next(p for p in status.pools if p.category == "lineal_ascendant")
        if pool.available > 0:
            amount = pool.available
            tax = calc_gift_tax(
                GiftTaxInput(
                    recipient=recipient,
                    donor_group=req.donor_group,
                    gifted_on=candidate,
                    amount=amount,
                    prior_gifts=history,
                )
            ).payable_tax
            schedule.append(
                PlannedGift(
                    gift_on=candidate,
                    age=age_on(req.birth_date, candidate),
                    amount=amount,
                    deduction_type="basic",
                    tax=tax,
                )
            )
            history.append(
                PriorGift(
                    gifted_on=candidate, donor_group=req.donor_group, amount=amount, tax_paid=tax
                )
            )
            candidate = add_years(candidate, RULES.gift_window_years) + timedelta(days=1)
        elif pool.next_reset_on:
            candidate = pool.next_reset_on
        else:
            break
    if req.expected_marriage_date and first <= req.expected_marriage_date <= end:
        status = deduction_status(recipient, history, req.expected_marriage_date)
        amount = status.marriage_birth.available
        if amount:
            schedule.append(
                PlannedGift(
                    gift_on=req.expected_marriage_date,
                    age=age_on(req.birth_date, req.expected_marriage_date),
                    amount=amount,
                    deduction_type="marriage",
                    tax=0,
                )
            )
    schedule.sort(key=lambda g: g.gift_on)
    total = sum(g.amount for g in schedule)
    lump_tax = (
        calc_gift_tax(
            GiftTaxInput(
                recipient=recipient, donor_group=req.donor_group, gifted_on=end, amount=total
            )
        ).model_dump()
        if total
        else {"tax_base": 0, "payable_tax": 0}
    )
    return GiftPlanResult(
        end_date=end,
        schedule=schedule,
        total_gifted=total,
        total_tax=sum(g.tax for g in schedule),
        future_value=sum(
            future_value(g.amount, g.gift_on, end, req.annual_return_rate) for g in schedule
        ),
        lump_sum=LumpSum(
            gift_on=end,
            amount=total,
            tax_base=lump_tax["tax_base"],
            payable_tax=lump_tax["payable_tax"],
        ),
        assumptions=[
            *ASSUMPTIONS,
            "성년 전환일의 추가 공제를 바로 쓰지 않고 10년 주기만 사용합니다.",
            "수익은 경과일/365의 복리로 계산하고 단계마다 원 미만을 버립니다.",
            "한 번에 증여할 때는 기존 기록이 없고 혼인·출산 공제를 신청하지 않는다고 가정합니다.",
            "증여 후 오른 가치는 일반적으로 증여세 대상이 아니지만, "
            "특수관계 거래·상장 차익 등 예외가 있습니다(제42조의3).",
        ],
        rule_version=RULES.version,
    )


def prior_inheritance(members, histories, on: date) -> dict[str, int]:
    heirs = others = deductions = paid = 0
    for member in members:
        for row in replay_gifts(member, histories[member.id]):
            gift = row.gift
            is_heir = (member.relation == "child" and gift.donor_group == "parents") or (
                member.relation == "spouse" and gift.donor_group == "spouse"
            )
            non_heir = member.relation == "grandchild" and gift.donor_group == "grandparents"
            years = RULES.heir_window_years if is_heir else RULES.non_heir_window_years
            if (is_heir or non_heir) and add_years(on, -years) < gift.gifted_on <= on:
                if is_heir:
                    heirs += gift.amount
                else:
                    others += gift.amount
                deductions += row.deduction
                paid += gift.tax_paid
    return dict(
        prior_gifts_to_heirs10y=heirs,
        prior_gifts_to_non_heirs5y=others,
        prior_gift_deductions=deductions,
        prior_gift_tax_paid=paid,
    )


def compare_estate_plans(req: EstateCompareInput) -> EstateCompareResult:
    get_active_rules(req.base_date)
    children = [m for m in req.members if m.relation == "child" and m.birth_date]
    grandchildren = [m for m in req.members if m.relation == "grandchild" and m.birth_date]
    if not req.spouse_alive and not children:
        raise field_error("children", "자녀나 배우자를 먼저 가족에 등록해 주세요.")
    end = add_years(req.base_date, req.horizon_years)
    omitted = sum(
        m.relation in {"child", "grandchild"} and m.birth_date is None for m in req.members
    )
    specs = [("inherit_only", "증여 없이 상속", [], "parents")]
    if children:
        specs.extend(
            [
                ("staged_children", "자녀에게 10년마다 공제 한도만큼 증여", children, "parents"),
                (
                    "lump_sum_now",
                    f"자녀에게 지금 {req.lump_sum_per_child:,}원씩 증여",
                    children,
                    "parents",
                ),
            ]
        )
    if grandchildren:
        specs.append(
            (
                "staged_grandchildren",
                "손자녀에게 10년마다 공제 한도만큼 증여",
                grandchildren,
                "grandparents",
            )
        )
    scenarios = []
    for key, label, targets, group in specs:
        histories = {m.id: list(m.prior_gifts) for m in req.members}
        gifts = []
        budget = req.assets.financial_assets
        candidate = req.base_date
        while candidate <= end and targets and budget > 0:
            for member in sorted(targets, key=lambda m: (m.birth_date, m.display_name, str(m.id))):
                if candidate < member.birth_date:
                    continue
                status = deduction_status(member, histories[member.id], candidate)
                available = next(
                    p.available for p in status.pools if p.category == "lineal_ascendant"
                )
                amount = min(req.lump_sum_per_child if key == "lump_sum_now" else available, budget)
                if amount <= 0:
                    continue
                tax = calc_gift_tax(
                    GiftTaxInput(
                        recipient=member,
                        donor_group=group,
                        gifted_on=candidate,
                        amount=amount,
                        prior_gifts=histories[member.id],
                    )
                ).payable_tax
                gifts.append(
                    CompareGift(
                        member_id=member.id,
                        display_name=member.display_name,
                        gift_on=candidate,
                        amount=amount,
                        gift_tax=tax,
                    )
                )
                histories[member.id].append(
                    PriorGift(gifted_on=candidate, donor_group=group, amount=amount, tax_paid=tax)
                )
                budget -= amount
            if key == "lump_sum_now":
                break
            candidate = add_years(candidate, RULES.gift_window_years) + timedelta(days=1)
        gift_value = sum(
            future_value(g.amount, g.gift_on, end, req.annual_growth_rate) for g in gifts
        )
        financial = max(
            0,
            future_value(req.assets.financial_assets, req.base_date, end, req.annual_growth_rate)
            - gift_value,
        )
        real = future_value(req.assets.real_estate, req.base_date, end, req.annual_growth_rate)
        other = future_value(req.assets.other_assets, req.base_date, end, req.annual_growth_rate)
        estate = max(0, financial + real + other - req.assets.debts)
        # 미래 계산액은 요청 상한(현재 입력 1조원)을 넘을 수 있다.
        inheritance_req = InheritanceTaxInput.model_construct(
            financial_assets=financial,
            real_estate=real,
            other_assets=other,
            debts=req.assets.debts,
            spouse_alive=req.spouse_alive,
            children=[
                InheritanceChild(age=age_on(m.birth_date, end))
                for m in children
                if m.birth_date <= end
            ],
            **prior_inheritance(
                [
                    m
                    for m in req.members
                    if not (m.relation in {"child", "grandchild"} and m.birth_date is None)
                ],
                histories,
                end,
            ),
        )
        tax_result = calc_inheritance_tax(inheritance_req)
        gift_tax = sum(g.gift_tax for g in gifts)
        # 증여세도 낸 날부터 T까지 같은 증가율로 불린다(17절).
        gift_tax_value = sum(
            future_value(g.gift_tax, g.gift_on, end, req.annual_growth_rate) for g in gifts
        )
        scenarios.append(
            CompareScenario(
                key=key,
                label=label,
                gifts=gifts,
                total_gifted=sum(g.amount for g in gifts),
                gift_tax_total=gift_tax,
                gifts_value_at_horizon=gift_value,
                estate_at_horizon=estate,
                inheritance_tax=tax_result.payable_tax,
                total_tax=gift_tax + tax_result.payable_tax,
                gift_tax_at_horizon=gift_tax_value,
                total_tax_at_horizon=gift_tax_value + tax_result.payable_tax,
                family_receives=estate - tax_result.payable_tax + gift_value - gift_tax_value,
                inheritance=InheritanceSummary.model_validate(tax_result.model_dump()),
            )
        )
    best = max(scenarios, key=lambda s: (s.family_receives, -s.total_tax_at_horizon))
    notes = [
        "상속 전 10년(상속인이 아닌 손자녀는 5년) 안에 한 증여는 상속재산에 다시 더해져요.",
        f"재산과 증여한 돈이 모두 연 {req.annual_growth_rate}%씩 늘어난다고 가정했어요.",
        f"증여할 때 낸 증여세도 상속 시점까지 연 {req.annual_growth_rate}%로 불려 "
        "총 세금과 가족에게 남는 금액에 반영했어요.",
        "실제 상속 시점과 재산 가치, 세법은 달라질 수 있어요.",
    ]
    if omitted:
        notes.append(f"생년월일이 없는 가족 {omitted}명은 계산에서 뺐어요.")
    return EstateCompareResult(
        base_date=req.base_date,
        horizon_date=end,
        annual_growth_rate=req.annual_growth_rate,
        scenarios=scenarios,
        recommended_key=best.key,
        notes=notes,
        assumptions=[
            *ASSUMPTIONS,
            "증여는 금융재산에서 현금으로 하며 명목 합계는 현재 금융재산을 넘지 않습니다.",
            "부동산 증여·평가, 배우자 증여 방향과 2차 상속은 다루지 않습니다.",
            "장례비는 최소 공제만 반영합니다.",
            "혼인·출산 공제는 신청하지 않습니다.",
            "증여세는 받은 사람이 증여할 때 냅니다.",
        ],
        rule_version=RULES.version,
    )
