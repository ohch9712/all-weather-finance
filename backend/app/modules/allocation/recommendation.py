"""목표 반영 권장 배분, 관리 방향, 추천 이유, 배분 점수(스펙 02 5.3~5.10).

모두 순수 함수다. DB와 시간을 직접 읽지 않고, 필요한 값(표 비중·진단·상황·목표·보유 자산·오늘)을
인자로 받는다. 서비스(service.py)가 DB에서 모은 값을 넘긴다.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from app.core.domain import (
    AGE_BAND_LABEL,
    AGE_BAND_REPRESENTATIVE_AGE,
    ASSET_CLASS_LABEL,
    RISK_PROFILE_LABEL,
    AgeBand,
    AssetClass,
    RiskProfile,
)
from app.core.format import format_krw_compact
from app.modules.allocation import rules
from app.modules.allocation.schemas import (
    AnswerContribution,
    AssetClassNote,
    ByAssetClass,
    Direction,
    EmergencyLayer,
    Layers,
    Reason,
    Recommendation,
    ReportClass,
    RiskyOut,
    ShortTermGoalLayer,
)

ORDER = rules.ASSET_CLASS_ORDER
HUNDRED = Decimal(100)

# ── 입력 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class AssessmentData:
    score: Decimal
    risk_profile: RiskProfile
    answers: Mapping[str, int]


@dataclass(frozen=True)
class SituationData:
    monthly_expense: int
    dependents: int
    consumer_debt: int


@dataclass(frozen=True)
class GoalData:
    id: UUID
    goal_type: str
    title: str
    target_amount: int
    target_date: date
    created_at: datetime


# ── 작은 계산 ────────────────────────────────────────────────────────────


def goal_horizon(target_date: date, today: date) -> str:
    """목표일 ≤ 오늘 + 1년 `within_1y`, ≤ 오늘 + 3년 `within_3y`, 그 뒤 `long_term`(5.7)"""
    if target_date <= rules.add_years(today, 1):
        return "within_1y"
    if target_date <= rules.add_years(today, 3):
        return "within_3y"
    return "long_term"


def sort_goals(goals: Sequence[GoalData]) -> list[GoalData]:
    """목표일 순, 같으면 만든 순"""
    return sorted(goals, key=lambda goal: (goal.target_date, goal.created_at))


def emergency_months(dependents: int, income_answer: int | None) -> int:
    """부양가족 1명 이상이거나 `income` 답이 1·2면 6개월, 아니면 3개월.

    진단이 없으면(`income_answer`가 None) 부양가족만 본다.
    """
    if dependents >= 1 or income_answer in rules.UNSTABLE_INCOME_ANSWERS:
        return rules.EMERGENCY_MONTHS_EXTENDED
    return rules.EMERGENCY_MONTHS_BASE


def emergency_target(situation: SituationData, income_answer: int | None) -> int:
    return situation.monthly_expense * emergency_months(situation.dependents, income_answer)


def ratio_percent(amount: int, total: int) -> Decimal:
    """반올림 전 비중(%)"""
    return Decimal(amount) * HUNDRED / Decimal(total)


def weights_of(amounts: Mapping[AssetClass, int], total: int) -> dict[AssetClass, Decimal]:
    """자산군별 비중(%), 소수 둘째 자리 ROUND_HALF_UP(5.3)"""
    return {
        asset_class: rules.round_half_up(
            ratio_percent(amounts[asset_class], total), rules.TWO_DECIMALS
        )
        for asset_class in ORDER
    }


def allocation_score(
    actual: Mapping[AssetClass, int], target: Mapping[AssetClass, int], total: int
) -> int:
    """100 − (Σ|실제 금액 − 권장 금액| ÷ T × 100) ÷ 2, 정수 ROUND_HALF_UP(5.4)"""
    diff = sum(abs(actual[asset_class] - target[asset_class]) for asset_class in ORDER)
    value = HUNDRED - Decimal(diff) * HUNDRED / Decimal(total) / 2
    score = int(value.quantize(Decimal(1), ROUND_HALF_UP))
    return max(0, min(100, score))


def month_text(day: date) -> str:
    return f"{day.year}년 {day.month}월"


def signed(value: int) -> str:
    return f"{value:+d}"


# ── 층 쌓기(5.8) ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ShortTermAllocation:
    goal: GoalData
    horizon: str
    asset_class: AssetClass
    allocated_amount: int | None  # T = 0이면 None


@dataclass(frozen=True)
class TargetPlan:
    total: int
    base_weights: rules.Weights
    emergency_months: int | None
    emergency_target: int | None
    emergency_allocated: int | None
    short_term: list[ShortTermAllocation] = field(default_factory=list)
    long_term_goals: list[GoalData] = field(default_factory=list)
    long_term_amount: int | None = None
    target_amounts: dict[AssetClass, int] | None = None
    target_weights: dict[AssetClass, Decimal] = field(default_factory=dict)

    @property
    def applied(self) -> bool:
        return self.total > 0


def split_long_term(amount: int, weights: rules.Weights) -> dict[AssetClass, int]:
    """장기 투자 층: 주식·채권·금·기타는 원 단위 반올림, 현금성 자산은 나머지(층 합 = amount)"""
    split = {
        asset_class: int(
            (Decimal(amount) * weights[asset_class] / HUNDRED).quantize(Decimal(1), ROUND_HALF_UP)
        )
        for asset_class in ORDER
        if asset_class != AssetClass.CASH
    }
    cash = amount - sum(split.values())
    # 수십 원 이하의 아주 작은 금액에서만 반올림이 겹쳐 나머지가 음수가 된다.
    # 그때는 큰 값에서 1원씩 덜어 나머지를 0으로 맞춘다.
    while cash < 0:
        largest = max(split, key=lambda asset_class: split[asset_class])
        split[largest] -= 1
        cash += 1
    split[AssetClass.CASH] = cash
    return {asset_class: split[asset_class] for asset_class in ORDER}


def plan_targets(
    *,
    base_weights: rules.Weights,
    situation: SituationData | None,
    income_answer: int | None,
    goals: Sequence[GoalData],
    total: int,
    today: date,
) -> TargetPlan:
    """비상금 → 3년 안 목표 → 장기 투자 순서로 권장 금액을 쌓는다."""
    applied = total > 0
    remaining = total
    amounts = {asset_class: 0 for asset_class in ORDER}

    months = target = allocated = None
    if situation is not None:
        months = emergency_months(situation.dependents, income_answer)
        target = situation.monthly_expense * months
        if applied:
            allocated = min(target, remaining)
            amounts[AssetClass.CASH] += allocated
            remaining -= allocated

    short_term: list[ShortTermAllocation] = []
    long_term_goals: list[GoalData] = []
    for goal in sort_goals(goals):
        horizon = goal_horizon(goal.target_date, today)
        if horizon == "long_term":
            long_term_goals.append(goal)
            continue
        asset_class = AssetClass.CASH if horizon == "within_1y" else AssetClass.BOND
        goal_allocated = None
        if applied:
            goal_allocated = min(goal.target_amount, remaining)
            amounts[asset_class] += goal_allocated
            remaining -= goal_allocated
        short_term.append(ShortTermAllocation(goal, horizon, asset_class, goal_allocated))

    if not applied:
        return TargetPlan(
            total=total,
            base_weights=base_weights,
            emergency_months=months,
            emergency_target=target,
            emergency_allocated=None,
            short_term=short_term,
            long_term_goals=long_term_goals,
            target_weights={
                asset_class: Decimal(base_weights[asset_class]) for asset_class in ORDER
            },
        )

    for asset_class, value in split_long_term(remaining, base_weights).items():
        amounts[asset_class] += value
    return TargetPlan(
        total=total,
        base_weights=base_weights,
        emergency_months=months,
        emergency_target=target,
        emergency_allocated=allocated,
        short_term=short_term,
        long_term_goals=long_term_goals,
        long_term_amount=remaining,
        target_amounts=amounts,
        target_weights=weights_of(amounts, total),
    )


# ── 리포트 행(5.3~5.5) ───────────────────────────────────────────────────


def report_classes(plan: TargetPlan, actual: Mapping[AssetClass, int]) -> list[ReportClass]:
    assert plan.target_amounts is not None
    actual_weights = weights_of(actual, plan.total)
    return [
        ReportClass(
            asset_class=asset_class,
            actual_amount=actual[asset_class],
            actual_weight=float(actual_weights[asset_class]),
            target_weight=float(plan.target_weights[asset_class]),
            target_amount=plan.target_amounts[asset_class],
            diff_amount=plan.target_amounts[asset_class] - actual[asset_class],
        )
        for asset_class in ORDER
    ]


# ── 관리 방향(5.9) ───────────────────────────────────────────────────────

HREF_SITUATION = "/allocation/situation"
HREF_ASSETS = "/allocation/assets"
HREF_DETAIL = "/allocation/recommendation/detail"
HREF_REPORT = "/allocation"


def _rebalance_directions(plan: TargetPlan, actual: Mapping[AssetClass, int]) -> list[Direction]:
    assert plan.target_amounts is not None
    total = plan.total
    candidates = []
    for index, asset_class in enumerate(ORDER):
        diff_amount = actual[asset_class] - plan.target_amounts[asset_class]
        diff_percent = Decimal(diff_amount) * HUNDRED / Decimal(total)
        if abs(diff_percent) >= rules.REBALANCE_THRESHOLD:
            candidates.append((-abs(diff_percent), index, asset_class, diff_amount))
    if not candidates:
        return [
            Direction(
                kind="keep_allocation",
                priority=4,
                title="지금 배분을 유지해요",
                body=(
                    "모든 자산군이 권장 비중과 5%p 안쪽이에요. 6개월에 한 번쯤 다시 점검해 보세요."
                ),
                amount=None,
                asset_class=None,
                href=HREF_REPORT,
            )
        ]
    directions = []
    for _, _, asset_class, diff_amount in sorted(candidates)[: rules.REBALANCE_MAX_ITEMS]:
        label = ASSET_CLASS_LABEL[asset_class]
        actual_rounded = rules.round_half_up(ratio_percent(actual[asset_class], total))
        target_rounded = rules.round_half_up(ratio_percent(plan.target_amounts[asset_class], total))
        gap = abs(actual_rounded - target_rounded)
        over = diff_amount > 0
        directions.append(
            Direction(
                kind="rebalance",
                priority=4,
                title=f"{label} 비중을 {'줄여요' if over else '늘려요'}",
                body=(
                    f"지금 {label} 비중은 {actual_rounded:.1f}%로 권장 {target_rounded:.1f}%보다 "
                    f"{gap:.1f}%p {'높아요' if over else '낮아요'}. "
                    f"약 {format_krw_compact(abs(diff_amount))}을 "
                    f"{'줄이면' if over else '더 모으면'} 권장 배분에 가까워져요."
                ),
                amount=abs(diff_amount),
                asset_class=asset_class,
                href=HREF_REPORT,
            )
        )
    return directions


def build_directions(
    plan: TargetPlan, situation: SituationData | None, actual: Mapping[AssetClass, int]
) -> list[Direction]:
    """규칙에 맞는 방향을 priority 순서로 모두 만든다. 화면은 앞 3개를 "먼저 할 일"로 쓴다."""
    directions: list[Direction] = []

    if situation is not None and situation.consumer_debt > 0:
        directions.append(
            Direction(
                kind="pay_consumer_debt",
                priority=1,
                title="고금리 대출부터 갚아요",
                body=(
                    "신용대출·카드론 같은 대출이 "
                    f"{format_krw_compact(situation.consumer_debt)}이에요. "
                    "이런 대출의 이자는 보통 투자로 기대할 수 있는 수익보다 높아서, "
                    "투자를 늘리기 전에 갚는 것을 먼저 검토하는 것이 일반적이에요."
                ),
                amount=situation.consumer_debt,
                asset_class=None,
                href=HREF_SITUATION,
            )
        )

    if situation is not None and plan.emergency_target is not None:
        cash = actual[AssetClass.CASH]
        target = plan.emergency_target
        if cash < target:
            expense = format_krw_compact(situation.monthly_expense)
            months = plan.emergency_months
            head = f"생활비 {expense}의 {months}개월치인 {format_krw_compact(target)}을 "
            if plan.applied:
                shortfall = target - cash
                body = (
                    f"{head}현금성 자산으로 두는 것을 권해요. 지금 현금성 자산은 "
                    f"{format_krw_compact(cash)}이라 {format_krw_compact(shortfall)}이 부족해요."
                )
                amount = shortfall
            else:
                body = f"{head}비상금으로 먼저 모아 두세요."
                amount = target
            directions.append(
                Direction(
                    kind="build_emergency_fund",
                    priority=2,
                    title="비상금을 먼저 채워요",
                    body=body,
                    amount=amount,
                    asset_class=AssetClass.CASH,
                    href=HREF_ASSETS,
                )
            )

    for item in plan.short_term:
        amount = item.allocated_amount if plan.applied else item.goal.target_amount
        assert amount is not None
        directions.append(
            Direction(
                kind="reserve_short_term_goal",
                priority=3,
                title=f"'{item.goal.title}' 자금은 안전하게",
                body=(
                    f"{month_text(item.goal.target_date)}에 쓸 {format_krw_compact(amount)}은 "
                    f"값이 크게 흔들리지 않는 {ASSET_CLASS_LABEL[item.asset_class]}으로 "
                    "모아 두는 것을 권해요."
                ),
                amount=amount,
                asset_class=item.asset_class,
                href=HREF_DETAIL,
            )
        )

    if plan.applied:
        directions.extend(_rebalance_directions(plan, actual))

    for goal in plan.long_term_goals:
        directions.append(
            Direction(
                kind="long_term_goal",
                priority=5,
                title=f"'{goal.title}'은 장기 투자로 준비해요",
                body=(
                    f"{month_text(goal.target_date)}까지 시간이 넉넉해서 "
                    "장기 투자 몫(권장 배분)으로 "
                    "꾸준히 모으는 방식이 어울려요."
                ),
                amount=None,
                asset_class=None,
                href=HREF_DETAIL,
            )
        )

    if situation is None:
        directions.append(
            Direction(
                kind="input_situation",
                priority=6,
                title="생활비를 알려 주세요",
                body="월 생활비를 입력하면 비상금 목표를 계산해 권장 배분에 반영해요.",
                amount=None,
                asset_class=None,
                href=HREF_SITUATION,
            )
        )
    if not plan.applied:
        directions.append(
            Direction(
                kind="input_holdings",
                priority=6,
                title="보유 자산을 입력해 주세요",
                body="자산을 입력하면 배분 점수와 조정할 금액을 알려 드려요.",
                amount=None,
                asset_class=None,
                href=HREF_ASSETS,
            )
        )
    return directions


# ── 추천 이유(5.10) ──────────────────────────────────────────────────────


def _weights_sentence(weights: rules.Weights) -> str:
    return " · ".join(
        f"{ASSET_CLASS_LABEL[asset_class]} {weights[asset_class]}%" for asset_class in ORDER
    )


def build_reasons(
    *,
    plan: TargetPlan,
    age_band: AgeBand,
    assessment: AssessmentData,
    situation: SituationData | None,
) -> list[Reason]:
    reasons: list[Reason] = []
    age = AGE_BAND_REPRESENTATIVE_AGE[age_band]
    risky = rules.risky_weight(age_band, assessment.risk_profile)
    reasons.append(
        Reason(
            code="age_band",
            title=f"나이대: {AGE_BAND_LABEL[age_band]}",
            body=(
                "투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요. "
                f"대표 나이 {age}세 기준 출발점은 100 − {age} = {risky.start}%예요."
            ),
        )
    )

    question = rules.QUESTION_BY_ID
    adjustment = (
        "그래서 위험자산 비중을 따로 조정하지 않았어요."
        if risky.adjustment == 0
        else f"그래서 위험자산 비중을 {signed(risky.adjustment)}%p 조정했어요."
    )
    limit = (
        f"위험자산 비중은 10~90% 사이로 제한해 {risky.final}%로 정했어요."
        if risky.clamped
        else f"위험자산 비중은 {risky.final}%예요."
    )
    horizon_label = question["horizon"].label(assessment.answers["horizon"])
    loss_label = question["lossTolerance"].label(assessment.answers["lossTolerance"])
    reasons.append(
        Reason(
            code="risk_profile",
            title=(
                f"투자성향: {RISK_PROFILE_LABEL[assessment.risk_profile]}"
                f"({rules.round_half_up(assessment.score):.1f}점)"
            ),
            body=(
                f"{rules.RISK_PROFILE_SUMMARY[assessment.risk_profile]} {adjustment} "
                f"투자 기간은 '{horizon_label}', 견딜 수 있는 손실은 '{loss_label}'이라고 답했고, "
                f"이 두 문항이 점수에 가장 크게 반영돼요. {limit}"
            ),
        )
    )

    if situation is not None and plan.emergency_target is not None:
        body = (
            f"생활비 {format_krw_compact(situation.monthly_expense)}의 "
            f"{plan.emergency_months}개월치를 현금성 자산으로 먼저 떼어 두었어요. "
            "부양가족이 있거나 앞으로 수입이 불안정할 것 같다고 "
            "답하면 6개월치로 늘려요."
        )
        if plan.applied and plan.emergency_target > plan.total:
            body += " 지금 자산이 비상금 목표보다 적어 자산 전부를 현금성 자산으로 잡았어요."
        reasons.append(
            Reason(
                code="emergency_fund",
                title=f"비상금: {format_krw_compact(plan.emergency_target)}",
                body=body,
            )
        )

    if plan.short_term:
        parts = []
        layer_total = 0
        for item in plan.short_term:
            amount = item.allocated_amount if plan.applied else item.goal.target_amount
            assert amount is not None
            layer_total += amount
            parts.append(
                f"'{item.goal.title}' {month_text(item.goal.target_date)} "
                f"{format_krw_compact(amount)}({ASSET_CLASS_LABEL[item.asset_class]})"
            )
        body = (
            "3년 안에 쓸 돈은 값이 크게 흔들리지 않게 1년 안이면 현금성 자산, 1~3년이면 채권으로 "
            f"잡았어요. {', '.join(parts)}"
        )
        if not plan.applied:
            body += " 자산을 입력하면 권장 배분에 반영해요."
        reasons.append(
            Reason(
                code="short_term_goals",
                title=f"가까운 목표 자금: {format_krw_compact(layer_total)}",
                body=body,
            )
        )

    if plan.applied:
        assert plan.long_term_amount is not None
        reasons.append(
            Reason(
                code="long_term_mix",
                title=f"장기 투자 몫: {format_krw_compact(plan.long_term_amount)}",
                body=(
                    "나머지는 나이대·성향 표 비중대로 "
                    f"{_weights_sentence(plan.base_weights)}로 나눴어요."
                ),
            )
        )
    else:
        reasons.append(
            Reason(
                code="long_term_mix",
                title="장기 투자 비중",
                body=(
                    "자산을 입력하면 비상금과 가까운 목표 자금을 뺀 나머지를 이 비중으로 나눠요: "
                    f"{_weights_sentence(plan.base_weights)}."
                ),
            )
        )
    return reasons


def answer_contributions(answers: Mapping[str, int]) -> list[AnswerContribution]:
    """문항별 성향 점수 기여(문항마다 소수 첫째 자리로 반올림)"""
    return [
        AnswerContribution(
            question_id=question.id,
            question=question.text,
            answer_label=question.label(answers[question.id]),
            points=float(rules.round_half_up(rules.answer_points(question, answers[question.id]))),
            max_points=float(rules.round_half_up(rules.max_points(question))),
        )
        for question in rules.SURVEY_QUESTIONS
    ]


# ── 추천 전체(7.10, status = ready) ──────────────────────────────────────


def build_recommendation(
    *,
    age_band: AgeBand,
    assessment: AssessmentData,
    situation: SituationData | None,
    goals: Sequence[GoalData],
    holdings: Mapping[AssetClass, int],
    today: date,
) -> Recommendation:
    """`holdings`는 배분 대상(포함, 금액 > 0) 자산의 자산군별 합계다. 5개 키가 모두 있어야 한다."""
    base_weights = rules.TARGET_TABLE[age_band][assessment.risk_profile]
    total = sum(holdings[asset_class] for asset_class in ORDER)
    plan = plan_targets(
        base_weights=base_weights,
        situation=situation,
        income_answer=assessment.answers.get("income"),
        goals=goals,
        total=total,
        today=today,
    )
    risky = rules.risky_weight(age_band, assessment.risk_profile)
    emergency = None
    if situation is not None:
        assert plan.emergency_months is not None and plan.emergency_target is not None
        emergency = EmergencyLayer(
            monthly_expense=situation.monthly_expense,
            months=plan.emergency_months,
            target_amount=plan.emergency_target,
            allocated_amount=plan.emergency_allocated,
        )
    return Recommendation(
        status="ready",
        layering="applied" if plan.applied else "needs_holdings",
        age_band=age_band,
        risk_profile=assessment.risk_profile,
        risk_score=float(rules.round_half_up(assessment.score)),
        risk_profile_summary=rules.RISK_PROFILE_SUMMARY[assessment.risk_profile],
        risky=RiskyOut(
            start=risky.start, adjustment=risky.adjustment, final=risky.final, clamped=risky.clamped
        ),
        base_weights=ByAssetClass[int].of(base_weights),
        total_amount=total,
        layers=Layers(
            emergency=emergency,
            short_term_goals=[
                ShortTermGoalLayer(
                    goal_id=item.goal.id,
                    title=item.goal.title,
                    target_date=item.goal.target_date,
                    horizon=item.horizon,
                    target_amount=item.goal.target_amount,
                    allocated_amount=item.allocated_amount,
                    asset_class=item.asset_class,
                )
                for item in plan.short_term
            ],
            long_term_amount=plan.long_term_amount,
        ),
        target_amounts=ByAssetClass[int].of(plan.target_amounts) if plan.target_amounts else None,
        target_weights=ByAssetClass[float].of(
            {asset_class: float(plan.target_weights[asset_class]) for asset_class in ORDER}
        ),
        directions=build_directions(plan, situation, holdings),
        reasons=build_reasons(
            plan=plan, age_band=age_band, assessment=assessment, situation=situation
        ),
        asset_class_notes=[
            AssetClassNote(
                asset_class=asset_class,
                weight=float(plan.target_weights[asset_class]),
                note=rules.ASSET_CLASS_NOTE[asset_class],
            )
            for asset_class in ORDER
        ],
        answer_contributions=answer_contributions(assessment.answers),
    )


def target_explanation(age_band: AgeBand, risk_profile: RiskProfile) -> str:
    """7.4 explanation. 예: "30대 위험중립형: 위험자산 비중 = 100 − 35 + 0 = 65%" """
    risky = rules.risky_weight(age_band, risk_profile)
    age = AGE_BAND_REPRESENTATIVE_AGE[age_band]
    operator = "+" if risky.adjustment >= 0 else "−"
    raw = risky.start + risky.adjustment
    text = (
        f"{AGE_BAND_LABEL[age_band]} {RISK_PROFILE_LABEL[risk_profile]}: 위험자산 비중 = "
        f"100 − {age} {operator} {abs(risky.adjustment)} = {raw}%"
    )
    if risky.clamped:
        text += f" → 10~90% 제한으로 {risky.final}%"
    return text
