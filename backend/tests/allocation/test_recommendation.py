"""목표 반영 권장 배분·관리 방향·추천 이유(스펙 02 5.7~5.10) 순수 함수 테스트."""

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.domain import AgeBand, AssetClass, RiskProfile
from app.modules.allocation import rules
from app.modules.allocation.recommendation import (
    AssessmentData,
    GoalData,
    SituationData,
    allocation_score,
    answer_contributions,
    build_recommendation,
    emergency_months,
    goal_horizon,
    plan_targets,
    sort_goals,
    split_long_term,
    target_explanation,
)

TODAY = date(2026, 10, 16)
BASE_TIME = datetime(2026, 10, 1, 9, 0, 0)
KEYS = ("horizon", "experience", "knowledge", "income", "investmentRatio", "lossTolerance")
A = AssetClass


def answers(*values: int) -> dict[str, int]:
    return dict(zip(KEYS, values, strict=True))


def assessment(profile: RiskProfile, income: int = 3, score: str = "57.8") -> AssessmentData:
    return AssessmentData(Decimal(score), profile, answers(3, 4, 3, income, 3, 3))


def goal(goal_type: str, amount: int, target: date, order: int = 0, title: str | None = None):
    return GoalData(
        id=uuid4(),
        goal_type=goal_type,
        title=title or rules.GOAL_TYPE_LABEL[goal_type],
        target_amount=amount,
        target_date=target,
        created_at=BASE_TIME + timedelta(minutes=order),
    )


def holdings(stock=0, bond=0, gold=0, cash=0, other=0) -> dict[AssetClass, int]:
    return {A.STOCK: stock, A.BOND: bond, A.GOLD: gold, A.CASH: cash, A.OTHER: other}


def five(values) -> tuple:
    return tuple(getattr(values, key.value) for key in AssetClass)


def recommend(age_band, profile_data, situation=None, goals=(), assets=None):
    return build_recommendation(
        age_band=age_band,
        assessment=profile_data,
        situation=situation,
        goals=list(goals),
        holdings=assets or holdings(),
        today=TODAY,
    )


# 스펙 5.8 사례
def case_1():
    return recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        assets=holdings(stock=50_000_000, bond=30_000_000, cash=20_000_000),
    )


def case_2():
    return recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL, income=3),
        situation=SituationData(2_000_000, 0, 0),
        goals=[
            goal("home", 20_000_000, date(2028, 10, 16), 0),
            goal("retirement", 500_000_000, date(2056, 10, 16), 1),
        ],
        assets=holdings(stock=26_000_000, bond=6_000_000, cash=20_000_000),
    )


def case_3():
    return recommend(
        AgeBand.FORTIES,
        assessment(RiskProfile.ACTIVE, income=3, score="70.0"),
        situation=SituationData(3_000_000, 1, 0),
        assets=holdings(stock=10_000_000),
    )


def case_4():
    return recommend(
        AgeBand.TWENTIES,
        assessment(RiskProfile.AGGRESSIVE, income=2, score="90.0"),
        situation=SituationData(1_500_000, 0, 5_000_000),
        goals=[goal("marriage", 10_000_000, date(2027, 6, 30))],
        assets=holdings(stock=30_000_000, cash=5_000_000, other=5_000_000),
    )


def case_no_holdings():
    return recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        situation=SituationData(2_000_000, 0, 0),
    )


CASES = {"1": case_1, "2": case_2, "3": case_3, "4": case_4}
CASE_HOLDINGS = {
    "1": holdings(stock=50_000_000, bond=30_000_000, cash=20_000_000),
    "2": holdings(stock=26_000_000, bond=6_000_000, cash=20_000_000),
    "3": holdings(stock=10_000_000),
    "4": holdings(stock=30_000_000, cash=5_000_000, other=5_000_000),
}


@pytest.mark.parametrize(
    "case,amounts,weights,score,grade",
    [
        (
            "1",
            (65_000_000, 25_000_000, 5_000_000, 5_000_000, 0),
            (65.0, 25.0, 5.0, 5.0, 0.0),
            80,
            "A",
        ),
        (
            "2",
            (16_900_000, 26_500_000, 1_300_000, 7_300_000, 0),
            (32.5, 50.96, 2.5, 14.04, 0.0),
            58,
            "D",
        ),
        ("3", (0, 0, 0, 10_000_000, 0), (0.0, 0.0, 0.0, 100.0, 0.0), 0, "D"),
        (
            "4",
            (16_800_000, 0, 1_050_000, 20_050_000, 2_100_000),
            (42.0, 0.0, 2.63, 50.13, 5.25),
            60,
            "C",
        ),
    ],
)
def test_layering_cases(case, amounts, weights, score, grade):
    result = CASES[case]()
    assert result.layering == "applied"
    assert five(result.target_amounts) == amounts
    assert five(result.target_weights) == weights
    assert sum(amounts) == result.total_amount
    target = dict(zip(AssetClass, amounts, strict=True))
    actual_score = allocation_score(CASE_HOLDINGS[case], target, result.total_amount)
    assert actual_score == score
    assert rules.grade_for_score(actual_score) == grade


def test_case_2_layers():
    layers = case_2().layers
    assert layers.emergency.model_dump() == {
        "monthly_expense": 2_000_000,
        "months": 3,
        "target_amount": 6_000_000,
        "allocated_amount": 6_000_000,
    }
    rows = [
        (item.title, item.horizon, item.allocated_amount, item.asset_class)
        for item in layers.short_term_goals
    ]
    assert rows == [("내 집 마련", "within_3y", 20_000_000, A.BOND)]
    assert layers.long_term_amount == 26_000_000
    split = split_long_term(26_000_000, rules.TARGET_TABLE[AgeBand.THIRTIES][RiskProfile.NEUTRAL])
    assert split == holdings(
        stock=16_900_000, bond=6_500_000, gold=1_300_000, cash=1_300_000, other=0
    )


def test_case_4_score_boundary():
    # 차이 합 32,200,000원 → 100 − 80.5 ÷ 2 = 59.75 → 60
    result = case_4()
    target = dict(zip(AssetClass, five(result.target_amounts), strict=True))
    diff = sum(abs(CASE_HOLDINGS["4"][key] - target[key]) for key in AssetClass)
    assert diff == 32_200_000
    assert allocation_score(CASE_HOLDINGS["4"], target, 40_000_000) == 60


def test_case_3_emergency_takes_everything():
    result = case_3()
    assert result.layers.emergency.months == 6
    assert result.layers.emergency.target_amount == 18_000_000
    assert result.layers.emergency.allocated_amount == 10_000_000
    assert result.layers.long_term_amount == 0


def test_no_holdings_uses_table_weights():
    result = case_no_holdings()
    assert result.layering == "needs_holdings"
    assert result.target_amounts is None
    assert result.layers.long_term_amount is None
    assert result.layers.emergency.allocated_amount is None
    assert result.layers.emergency.target_amount == 6_000_000
    assert five(result.target_weights) == (65.0, 25.0, 5.0, 5.0, 0.0)
    assert result.total_amount == 0


def test_no_situation_no_goals_equals_table():
    for age_band in AgeBand:
        for profile in RiskProfile:
            plan = plan_targets(
                base_weights=rules.TARGET_TABLE[age_band][profile],
                situation=None,
                income_answer=None,
                goals=[],
                total=100_000_000,
                today=TODAY,
            )
            assert plan.target_amounts == {
                key: value * 1_000_000
                for key, value in rules.TARGET_TABLE[age_band][profile].items()
            }


@pytest.mark.parametrize("total", [1, 3, 5, 7, 99, 101, 12_345_679, 99_999_999])
@pytest.mark.parametrize("age_band", list(AgeBand))
@pytest.mark.parametrize("profile", list(RiskProfile))
def test_cash_takes_remainder(total, age_band, profile):
    split = split_long_term(total, rules.TARGET_TABLE[age_band][profile])
    assert sum(split.values()) == total
    assert all(value >= 0 for value in split.values())


def test_same_date_goals_keep_creation_order():
    later = goal("car", 3_000_000, date(2027, 3, 1), order=2, title="두 번째")
    earlier = goal("car", 4_000_000, date(2027, 3, 1), order=1, title="첫 번째")
    first_date = goal("home", 1_000_000, date(2027, 1, 1), order=3, title="날짜 먼저")
    assert [item.title for item in sort_goals([later, earlier, first_date])] == [
        "날짜 먼저",
        "첫 번째",
        "두 번째",
    ]
    plan = plan_targets(
        base_weights=rules.TARGET_TABLE[AgeBand.THIRTIES][RiskProfile.NEUTRAL],
        situation=None,
        income_answer=None,
        goals=[later, earlier, first_date],
        total=6_000_000,
        today=TODAY,
    )
    # 남은 금액이 목표일·생성 순으로 채워진다: 1,000,000 → 4,000,000 → 나머지 1,000,000
    assert [(item.goal.title, item.allocated_amount) for item in plan.short_term] == [
        ("날짜 먼저", 1_000_000),
        ("첫 번째", 4_000_000),
        ("두 번째", 1_000_000),
    ]
    assert plan.long_term_amount == 0


@pytest.mark.parametrize(
    "target,horizon",
    [
        (date(2026, 10, 17), "within_1y"),
        (date(2027, 10, 16), "within_1y"),
        (date(2027, 10, 17), "within_3y"),
        (date(2029, 10, 16), "within_3y"),
        (date(2029, 10, 17), "long_term"),
    ],
)
def test_goal_horizon_boundaries(target, horizon):
    assert goal_horizon(target, TODAY) == horizon


def test_goal_horizon_leap_day():
    assert goal_horizon(date(2029, 2, 28), date(2028, 2, 29)) == "within_1y"
    assert goal_horizon(date(2029, 3, 1), date(2028, 2, 29)) == "within_3y"


@pytest.mark.parametrize(
    "dependents,income,months",
    [(0, 3, 3), (0, 4, 3), (1, 3, 6), (0, 1, 6), (0, 2, 6), (0, None, 3), (2, None, 6)],
)
def test_emergency_months(dependents, income, months):
    assert emergency_months(dependents, income) == months


# ── 5.9 관리 방향 ────────────────────────────────────────────────────────


def summary(result):
    return [(item.kind, item.amount, item.asset_class) for item in result.directions]


def test_directions_case_1():
    result = case_1()
    assert summary(result) == [
        ("rebalance", 15_000_000, A.STOCK),
        ("rebalance", 15_000_000, A.CASH),
        ("input_situation", None, None),
    ]
    stock, cash, situation = result.directions
    assert stock.title == "주식 비중을 늘려요"
    assert stock.body == (
        "지금 주식 비중은 50.0%로 권장 65.0%보다 15.0%p 낮아요. "
        "약 1,500만원을 더 모으면 권장 배분에 가까워져요."
    )
    assert cash.title == "현금성 자산 비중을 줄여요"
    assert cash.body == (
        "지금 현금성 자산 비중은 20.0%로 권장 5.0%보다 15.0%p 높아요. "
        "약 1,500만원을 줄이면 권장 배분에 가까워져요."
    )
    assert situation.title == "생활비를 알려 주세요"
    assert situation.href == "/allocation/situation"


def test_directions_case_2():
    result = case_2()
    assert summary(result) == [
        ("reserve_short_term_goal", 20_000_000, A.BOND),
        ("rebalance", 20_500_000, A.BOND),
        ("rebalance", 12_700_000, A.CASH),
        ("long_term_goal", None, None),
    ]
    reserve, bond, cash, long_term = result.directions
    assert reserve.title == "'내 집 마련' 자금은 안전하게"
    assert reserve.body == (
        "2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요."
    )
    assert reserve.href == "/allocation/recommendation/detail"
    assert bond.body == (
        "지금 채권 비중은 11.5%로 권장 51.0%보다 39.5%p 낮아요. "
        "약 2,050만원을 더 모으면 권장 배분에 가까워져요."
    )
    assert "38.5%로 권장 14.0%보다 24.5%p 높아요" in cash.body
    assert long_term.title == "'노후 준비'은 장기 투자로 준비해요"
    assert long_term.body == (
        "2056년 10월까지 시간이 넉넉해서 장기 투자 몫(권장 배분)으로 꾸준히 모으는 방식이 어울려요."
    )
    assert [item.priority for item in result.directions] == [3, 4, 4, 5]


def test_directions_case_3():
    result = case_3()
    assert summary(result) == [
        ("build_emergency_fund", 18_000_000, A.CASH),
        ("rebalance", 10_000_000, A.STOCK),
        ("rebalance", 10_000_000, A.CASH),
    ]
    _, stock, cash = result.directions
    assert stock.title == "주식 비중을 줄여요"
    assert "100.0%p 높아요" in stock.body
    assert cash.title == "현금성 자산 비중을 늘려요"
    assert "100.0%p 낮아요" in cash.body


def test_directions_case_4():
    result = case_4()
    assert summary(result) == [
        ("pay_consumer_debt", 5_000_000, None),
        ("build_emergency_fund", 4_000_000, A.CASH),
        ("reserve_short_term_goal", 10_000_000, A.CASH),
        ("rebalance", 15_050_000, A.CASH),
        ("rebalance", 13_200_000, A.STOCK),
    ]
    debt, emergency, reserve, cash, stock = result.directions
    assert debt.title == "고금리 대출부터 갚아요"
    assert debt.body == (
        "신용대출·카드론 같은 대출이 500만원이에요. 이런 대출의 이자는 보통 투자로 기대할 수 있는 "
        "수익보다 높아서, 투자를 늘리기 전에 갚는 것을 먼저 검토하는 것이 일반적이에요."
    )
    assert emergency.body == (
        "생활비 150만원의 6개월치인 900만원을 현금성 자산으로 두는 것을 권해요. "
        "지금 현금성 자산은 500만원이라 400만원이 부족해요."
    )
    assert emergency.href == "/allocation/assets"
    assert reserve.body == (
        "2027년 6월에 쓸 1,000만원은 값이 크게 흔들리지 않는 현금성 자산으로 모아 두는 것을 권해요."
    )
    assert "12.5%로 권장 50.1%보다 37.6%p 낮아요" in cash.body
    assert "75.0%로 권장 42.0%보다 33.0%p 높아요" in stock.body
    assert [item.priority for item in result.directions] == [1, 2, 3, 4, 4]


def test_directions_no_holdings():
    result = case_no_holdings()
    assert summary(result) == [
        ("build_emergency_fund", 6_000_000, A.CASH),
        ("input_holdings", None, None),
    ]
    assert result.directions[0].body == (
        "생활비 200만원의 3개월치인 600만원을 비상금으로 먼저 모아 두세요."
    )
    assert result.directions[1].title == "보유 자산을 입력해 주세요"


def test_directions_no_holdings_short_term_goal_uses_target_amount():
    result = recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        goals=[goal("car", 30_000_000, date(2027, 5, 1))],
    )
    assert summary(result) == [
        ("reserve_short_term_goal", 30_000_000, A.CASH),
        ("input_situation", None, None),
        ("input_holdings", None, None),
    ]


def rebalance_plan(stock_actual: int):
    """권장 = 30대 위험중립형, T = 100,000,000. 주식만 차이를 두고 나머지는 현금성 자산이 받는다."""
    target = holdings(stock=65_000_000, bond=25_000_000, gold=5_000_000, cash=5_000_000)
    diff = stock_actual - target[A.STOCK]
    actual = {**target, A.STOCK: stock_actual, A.CASH: target[A.CASH] - diff}
    return recommend(AgeBand.THIRTIES, assessment(RiskProfile.NEUTRAL), assets=actual)


def test_rebalance_threshold_boundary():
    # 4.99%p 차이: 방향 없음 → 유지
    below = rebalance_plan(65_000_000 - 4_990_000)
    assert [item.kind for item in below.directions] == ["keep_allocation", "input_situation"]
    keep = below.directions[0]
    assert keep.title == "지금 배분을 유지해요"
    assert (
        keep.body == "모든 자산군이 권장 비중과 5%p 안쪽이에요. 6개월에 한 번쯤 다시 점검해 보세요."
    )
    # 5.00%p 차이: 주식·현금성 자산 두 방향
    at = rebalance_plan(65_000_000 - 5_000_000)
    assert summary(at)[:2] == [("rebalance", 5_000_000, A.STOCK), ("rebalance", 5_000_000, A.CASH)]


def test_rebalance_picks_two_largest():
    result = recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        assets=holdings(stock=40_000_000, bond=40_000_000, gold=15_000_000, cash=5_000_000),
    )
    # 차이: 주식 −25, 채권 +15, 금 +10 → 주식·채권
    assert summary(result)[:2] == [
        ("rebalance", 25_000_000, A.STOCK),
        ("rebalance", 15_000_000, A.BOND),
    ]


def test_rebalance_sentence_gap_uses_rounded_values():
    # 실제 12.25% → 12.3%, 권장 25.0% → 차이 12.7%p(반올림한 두 값의 차)
    result = recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        assets=holdings(stock=77_750_000, bond=12_250_000, gold=5_000_000, cash=5_000_000),
    )
    bond = next(item for item in result.directions if item.asset_class == A.BOND)
    assert "12.3%로 권장 25.0%보다 12.7%p 낮아요" in bond.body


FORBIDDEN = ("사세요", "매수", "매도", "팔아요", "파세요", "사요")


@pytest.mark.parametrize("make", [case_1, case_2, case_3, case_4, case_no_holdings])
def test_no_solicitation_words(make):
    result = make()
    texts = [item.title + item.body for item in result.directions]
    texts += [item.title + item.body for item in result.reasons]
    texts += [item.note for item in result.asset_class_notes]
    for text in texts:
        for word in FORBIDDEN:
            assert word not in text


# ── 5.10 추천 이유 ───────────────────────────────────────────────────────


def test_reasons_case_2():
    reasons = case_2().reasons
    assert [item.code for item in reasons] == [
        "age_band",
        "risk_profile",
        "emergency_fund",
        "short_term_goals",
        "long_term_mix",
    ]
    age, profile, emergency, short_term, long_term = reasons
    assert age.title == "나이대: 30대"
    assert age.body == (
        "투자할 수 있는 기간이 길수록 위험자산(주식+기타) 비중을 높게 잡아요. "
        "대표 나이 35세 기준 출발점은 100 − 35 = 65%예요."
    )
    assert profile.title == "투자성향: 위험중립형(57.8점)"
    assert profile.body == (
        "수익과 위험의 균형을 원해요. 그래서 위험자산 비중을 따로 조정하지 않았어요. "
        "투자 기간은 '1년 ~ 3년', 견딜 수 있는 손실은 '20% 이내'이라고 답했고, "
        "이 두 문항이 점수에 가장 크게 반영돼요. 위험자산 비중은 65%예요."
    )
    assert emergency.title == "비상금: 600만원"
    assert emergency.body == (
        "생활비 200만원의 3개월치를 현금성 자산으로 먼저 떼어 두었어요. 부양가족이 있거나 "
        "앞으로 수입이 불안정할 것 같다고 답하면 6개월치로 늘려요."
    )
    assert short_term.title == "가까운 목표 자금: 2,000만원"
    assert short_term.body == (
        "3년 안에 쓸 돈은 값이 크게 흔들리지 않게 1년 안이면 현금성 자산, 1~3년이면 채권으로 "
        "잡았어요. '내 집 마련' 2028년 10월 2,000만원(채권)"
    )
    assert long_term.title == "장기 투자 몫: 2,600만원"
    assert long_term.body == (
        "나머지는 나이대·성향 표 비중대로 주식 65% · 채권 25% · 금 5% · 현금성 자산 5% · "
        "기타 0%로 나눴어요."
    )


def test_reasons_case_1_only_always_and_long_term():
    assert [item.code for item in case_1().reasons] == ["age_band", "risk_profile", "long_term_mix"]


def test_reasons_case_3_emergency_exceeds_assets():
    emergency = next(item for item in case_3().reasons if item.code == "emergency_fund")
    assert emergency.title == "비상금: 1,800만원"
    assert emergency.body.endswith(
        "6개월치로 늘려요. 지금 자산이 비상금 목표보다 적어 자산 전부를 현금성 자산으로 잡았어요."
    )
    profile = next(item for item in case_3().reasons if item.code == "risk_profile")
    assert "그래서 위험자산 비중을 +10%p 조정했어요." in profile.body


def test_reasons_risk_profile_sign_and_clamp():
    clamped = recommend(AgeBand.TWENTIES, assessment(RiskProfile.AGGRESSIVE, score="90.0"))
    profile = clamped.reasons[1]
    assert profile.title == "투자성향: 공격투자형(90.0점)"
    assert profile.body.startswith(
        "큰 수익을 위해 큰 손실도 감수할 수 있어요. 그래서 위험자산 비중을 +20%p 조정했어요."
    )
    assert profile.body.endswith("위험자산 비중은 10~90% 사이로 제한해 90%로 정했어요.")
    assert clamped.risky.model_dump() == {
        "start": 75,
        "adjustment": 20,
        "final": 90,
        "clamped": True,
    }

    negative = recommend(AgeBand.SIXTIES, assessment(RiskProfile.STABLE_SEEKING, score="30.0"))
    assert negative.reasons[0].title == "나이대: 60대 이상"
    assert "그래서 위험자산 비중을 -15%p 조정했어요." in negative.reasons[1].body
    assert negative.reasons[1].body.endswith("위험자산 비중은 20%예요.")

    low = recommend(AgeBand.SIXTIES, assessment(RiskProfile.STABLE, score="10.0"))
    assert low.reasons[1].body.endswith("위험자산 비중은 10~90% 사이로 제한해 10%로 정했어요.")


def test_reasons_answer_labels():
    data = AssessmentData(Decimal("100.0"), RiskProfile.AGGRESSIVE, answers(5, 5, 4, 4, 5, 5))
    result = recommend(AgeBand.THIRTIES, data)
    assert (
        "투자 기간은 '5년 이상', "
        "견딜 수 있는 손실은 '기대 수익이 크다면 그 이상도 괜찮다'이라고 답했고"
        in result.reasons[1].body
    )


def test_reasons_no_holdings():
    result = recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        situation=SituationData(2_000_000, 0, 0),
        goals=[goal("car", 30_000_000, date(2027, 5, 1))],
    )
    codes = [item.code for item in result.reasons]
    assert codes == [
        "age_band",
        "risk_profile",
        "emergency_fund",
        "short_term_goals",
        "long_term_mix",
    ]
    short_term = result.reasons[3]
    assert short_term.title == "가까운 목표 자금: 3,000만원"
    assert short_term.body.endswith(
        "'차량 구입' 2027년 5월 3,000만원(현금성 자산) 자산을 입력하면 권장 배분에 반영해요."
    )
    long_term = result.reasons[4]
    assert long_term.title == "장기 투자 비중"
    assert long_term.body == (
        "자산을 입력하면 비상금과 가까운 목표 자금을 뺀 나머지를 이 비중으로 나눠요: "
        "주식 65% · 채권 25% · 금 5% · 현금성 자산 5% · 기타 0%."
    )
    emergency = result.reasons[2]
    assert "자산 전부를" not in emergency.body


def test_short_term_reason_joins_goals():
    result = recommend(
        AgeBand.THIRTIES,
        assessment(RiskProfile.NEUTRAL),
        goals=[
            goal("home", 20_000_000, date(2028, 10, 16), 0),
            goal("marriage", 10_000_000, date(2027, 6, 30), 1),
        ],
        assets=holdings(stock=100_000_000),
    )
    short_term = next(item for item in result.reasons if item.code == "short_term_goals")
    assert short_term.title == "가까운 목표 자금: 3,000만원"
    assert short_term.body.endswith(
        "'결혼 자금' 2027년 6월 1,000만원(현금성 자산), '내 집 마련' 2028년 10월 2,000만원(채권)"
    )


def test_asset_class_notes():
    notes = case_2().asset_class_notes
    assert [(item.asset_class, item.weight) for item in notes] == [
        (A.STOCK, 32.5),
        (A.BOND, 50.96),
        (A.GOLD, 2.5),
        (A.CASH, 14.04),
        (A.OTHER, 0.0),
    ]
    assert (
        notes[0].note
        == "기업의 성장에 투자해요. 오래 둘수록 기대 수익이 크지만 값이 크게 오르내려요."
    )
    assert notes[4].note == (
        "리츠·원자재처럼 주식·채권과 다르게 움직이는 자산이에요. 공격적인 성향에서만 조금 담아요."
    )


@pytest.mark.parametrize(
    "values,points,total,score",
    [
        ((3, 4, 3, 3, 3, 3), [10.0, 10.0, 8.9, 8.9, 6.7, 13.3], "57.8", "57.8"),
        ((5, 5, 4, 4, 5, 1), [20.0, 13.3, 13.3, 13.3, 13.3, 0.0], "73.2", "73.3"),
    ],
)
def test_answer_contributions(values, points, total, score):
    rows = answer_contributions(answers(*values))
    assert [row.question_id for row in rows] == list(KEYS)
    assert [row.points for row in rows] == points
    assert [row.max_points for row in rows] == [20.0, 13.3, 13.3, 13.3, 13.3, 26.7]
    assert sum(Decimal(str(row.points)) for row in rows) == Decimal(total)
    assert rules.survey_score(answers(*values)) == Decimal(score)
    assert rows[0].question == "이 돈을 얼마 동안 투자할 수 있나요?"
    assert rows[0].answer_label == rules.SURVEY_QUESTIONS[0].label(values[0])


def test_recommendation_header_fields():
    result = case_2()
    assert result.status == "ready"
    assert result.risk_score == 57.8
    assert result.risk_profile_summary == "수익과 위험의 균형을 원해요."
    assert result.risky.model_dump() == {
        "start": 65,
        "adjustment": 0,
        "final": 65,
        "clamped": False,
    }
    assert five(result.base_weights) == (65, 25, 5, 5, 0)


@pytest.mark.parametrize(
    "age_band,profile,text",
    [
        (
            AgeBand.THIRTIES,
            RiskProfile.NEUTRAL,
            "30대 위험중립형: 위험자산 비중 = 100 − 35 + 0 = 65%",
        ),
        (
            AgeBand.FORTIES,
            RiskProfile.STABLE_SEEKING,
            "40대 안정추구형: 위험자산 비중 = 100 − 45 − 15 = 40%",
        ),
        (
            AgeBand.TWENTIES,
            RiskProfile.AGGRESSIVE,
            "20대 공격투자형: 위험자산 비중 = 100 − 25 + 20 = 95% → 10~90% 제한으로 90%",
        ),
    ],
)
def test_target_explanation(age_band, profile, text):
    assert target_explanation(age_band, profile) == text
