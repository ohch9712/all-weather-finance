"""설문 점수·등급, 25칸 배분표, 배분 점수·등급(스펙 02 5.1·5.2·5.4)."""

from decimal import Decimal

import pytest

from app.core.domain import AGE_BAND_REPRESENTATIVE_AGE, AgeBand, AssetClass, RiskProfile
from app.modules.allocation import rules
from app.modules.allocation.recommendation import allocation_score

KEYS = ("horizon", "experience", "knowledge", "income", "investmentRatio", "lossTolerance")


def answers(*values: int) -> dict[str, int]:
    return dict(zip(KEYS, values, strict=True))


def test_survey_questions_match_spec():
    assert [question.id for question in rules.SURVEY_QUESTIONS] == list(KEYS)
    assert rules.WEIGHT_SUM == Decimal("7.5")
    assert [question.weight for question in rules.SURVEY_QUESTIONS] == [
        Decimal("1.5"),
        Decimal("1"),
        Decimal("1"),
        Decimal("1"),
        Decimal("1"),
        Decimal("2"),
    ]
    horizon, experience, knowledge, income, ratio, loss = rules.SURVEY_QUESTIONS
    assert horizon.text == "이 돈을 얼마 동안 투자할 수 있나요?"
    assert horizon.options == ("6개월 미만", "6개월 ~ 1년", "1년 ~ 3년", "3년 ~ 5년", "5년 이상")
    assert experience.text == "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?"
    assert experience.options == (
        "예금·적금만 해 봤어요",
        "채권, 채권형 펀드",
        "혼합형 펀드, ELS 같은 파생결합증권",
        "주식, 주식형 펀드, ETF",
        "레버리지·인버스 ETF, 선물·옵션, 신용거래",
    )
    assert knowledge.text == "금융상품에 대해 얼마나 알고 있나요?"
    assert knowledge.options == (
        "거의 모른다",
        "예금과 펀드의 차이 정도는 안다",
        "주식과 채권의 위험 차이를 설명할 수 있다",
        "대부분의 금융상품 구조와 위험을 이해한다",
    )
    assert income.text == "앞으로의 수입은 어떨 것 같나요?"
    assert income.options == (
        "수입이 없거나 줄어들 것 같다",
        "지금은 안정적이지만 앞으로 불안정할 것 같다",
        "안정적으로 유지될 것 같다",
        "꾸준히 늘어날 것 같다",
    )
    assert ratio.text == "가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요?"
    assert ratio.options == ("10% 이하", "10% ~ 20%", "20% ~ 30%", "30% ~ 40%", "40% 초과")
    assert loss.text == "투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요?"
    assert loss.options == (
        "원금은 꼭 지켜야 한다",
        "10% 이내",
        "20% 이내",
        "30% 이내",
        "기대 수익이 크다면 그 이상도 괜찮다",
    )


@pytest.mark.parametrize(
    "values,score,profile",
    [
        ((1, 1, 1, 1, 1, 1), "0.0", RiskProfile.STABLE),
        ((1, 1, 1, 1, 1, 3), "13.3", RiskProfile.STABLE),
        ((3, 4, 3, 3, 3, 3), "57.8", RiskProfile.NEUTRAL),
        ((5, 5, 4, 4, 5, 1), "73.3", RiskProfile.ACTIVE),
        ((5, 5, 4, 4, 5, 5), "100.0", RiskProfile.AGGRESSIVE),
    ],
)
def test_survey_score_cases(values, score, profile):
    result = rules.survey_score(answers(*values))
    assert result == Decimal(score)
    assert str(result) == score
    assert rules.classify_risk_profile(result) == profile


@pytest.mark.parametrize(
    "score,profile",
    [
        ("20.0", RiskProfile.STABLE),
        ("20.1", RiskProfile.STABLE_SEEKING),
        ("40.0", RiskProfile.STABLE_SEEKING),
        ("40.1", RiskProfile.NEUTRAL),
        ("60.0", RiskProfile.NEUTRAL),
        ("60.1", RiskProfile.ACTIVE),
        ("80.0", RiskProfile.ACTIVE),
        ("80.1", RiskProfile.AGGRESSIVE),
    ],
)
def test_risk_profile_boundaries(score, profile):
    assert rules.classify_risk_profile(Decimal(score)) == profile


def test_risk_profile_summary():
    assert rules.RISK_PROFILE_SUMMARY == {
        RiskProfile.STABLE: "원금 보전이 가장 중요해요.",
        RiskProfile.STABLE_SEEKING: "손실은 작게, 이자보다 조금 높은 수익을 원해요.",
        RiskProfile.NEUTRAL: "수익과 위험의 균형을 원해요.",
        RiskProfile.ACTIVE: "높은 수익을 위해 손실도 어느 정도 감수해요.",
        RiskProfile.AGGRESSIVE: "큰 수익을 위해 큰 손실도 감수할 수 있어요.",
    }


# ── 5.2 권장 배분표 ──────────────────────────────────────────────────────

SPEC_TABLE = """
20대 | 45 / 40 / 10 / 5 / 0 | 60 / 30 / 5 / 5 / 0 | 75 / 15 / 5 / 5 / 0 | 80 / 5 / 5 / 5 / 5 | 80 / 0 / 5 / 5 / 10
30대 | 35 / 50 / 10 / 5 / 0 | 50 / 35 / 10 / 5 / 0 | 65 / 25 / 5 / 5 / 0 | 70 / 15 / 5 / 5 / 5 | 75 / 5 / 5 / 5 / 10
40대 | 25 / 55 / 10 / 10 / 0 | 40 / 40 / 10 / 10 / 0 | 55 / 25 / 10 / 10 / 0 | 60 / 20 / 5 / 10 / 5 | 65 / 10 / 5 / 10 / 10
50대 | 15 / 65 / 10 / 10 / 0 | 30 / 50 / 10 / 10 / 0 | 45 / 35 / 10 / 10 / 0 | 50 / 25 / 10 / 10 / 5 | 55 / 20 / 5 / 10 / 10
60대 이상 | 10 / 65 / 10 / 15 / 0 | 20 / 55 / 10 / 15 / 0 | 35 / 40 / 10 / 15 / 0 | 40 / 30 / 10 / 15 / 5 | 45 / 20 / 10 / 15 / 10
"""  # noqa: E501


def table_text() -> str:
    lines = []
    for age_band, row in rules.TARGET_TABLE.items():
        label = {"20s": "20대", "30s": "30대", "40s": "40대", "50s": "50대", "60s": "60대 이상"}
        cells = [
            " / ".join(str(row[profile][asset_class]) for asset_class in AssetClass)
            for profile in RiskProfile
        ]
        lines.append(" | ".join([label[age_band.value], *cells]))
    return "\n".join(lines)


def test_table_matches_spec_text():
    assert list(rules.TARGET_TABLE) == list(AgeBand)
    for row in rules.TARGET_TABLE.values():
        assert list(row) == list(RiskProfile)
        for weights in row.values():
            assert list(weights) == list(AssetClass)
    assert table_text() == SPEC_TABLE.strip()


def test_table_sums_and_non_negative():
    for row in rules.TARGET_TABLE.values():
        for weights in row.values():
            assert sum(weights.values()) == 100
            assert all(value >= 0 for value in weights.values())


def recompute(age_band: AgeBand, profile: RiskProfile) -> dict[AssetClass, int]:
    """스펙 5.2 규칙 1~5를 그대로 옮긴 독립 계산"""
    adjustment = {"stable": -30, "stable_seeking": -15, "neutral": 0, "active": 10}.get(
        profile.value, 20
    )
    risky = min(90, max(10, 100 - AGE_BAND_REPRESENTATIVE_AGE[age_band] + adjustment))
    other = {"aggressive": 10, "active": 5}.get(profile.value, 0)
    stock = risky - other
    safe = 100 - risky
    gold = 10 if safe > 40 else 5
    cash_base = {"20s": 5, "30s": 5, "40s": 10, "50s": 10, "60s": 15}[age_band.value]
    cash = min(cash_base, safe - gold)
    bond = safe - gold - cash
    return {
        AssetClass.STOCK: stock,
        AssetClass.BOND: bond,
        AssetClass.GOLD: gold,
        AssetClass.CASH: cash,
        AssetClass.OTHER: other,
    }


@pytest.mark.parametrize("age_band", list(AgeBand))
@pytest.mark.parametrize("profile", list(RiskProfile))
def test_table_matches_rule(age_band, profile):
    assert rules.TARGET_TABLE[age_band][profile] == recompute(age_band, profile)
    risky = rules.risky_weight(age_band, profile)
    weights = rules.TARGET_TABLE[age_band][profile]
    assert risky.final == weights[AssetClass.STOCK] + weights[AssetClass.OTHER]


@pytest.mark.parametrize("profile", list(RiskProfile))
def test_stock_never_increases_with_age(profile):
    stocks = [rules.TARGET_TABLE[age_band][profile][AssetClass.STOCK] for age_band in AgeBand]
    assert all(later <= earlier for earlier, later in zip(stocks, stocks[1:], strict=False))


def test_risky_weight_clamp():
    assert rules.risky_weight(AgeBand.TWENTIES, RiskProfile.AGGRESSIVE) == rules.RiskyWeight(
        75, 20, 90, True
    )
    assert rules.risky_weight(AgeBand.SIXTIES, RiskProfile.STABLE) == rules.RiskyWeight(
        35, -30, 10, True
    )
    assert rules.risky_weight(AgeBand.THIRTIES, RiskProfile.NEUTRAL) == rules.RiskyWeight(
        65, 0, 65, False
    )


# ── 5.4 배분 점수와 등급 ─────────────────────────────────────────────────

TARGET_30S_NEUTRAL = rules.TARGET_TABLE[AgeBand.THIRTIES][RiskProfile.NEUTRAL]


def amounts(stock: int, bond: int, gold: int, cash: int, other: int, unit: int = 1_000_000):
    values = (stock, bond, gold, cash, other)
    return {
        asset_class: value * unit for asset_class, value in zip(AssetClass, values, strict=True)
    }


@pytest.mark.parametrize(
    "actual,score,grade",
    [
        ((65, 25, 5, 5, 0), 100, "S"),
        ((50, 30, 0, 20, 0), 80, "A"),
        ((0, 0, 0, 100, 0), 5, "D"),
    ],
)
def test_allocation_score_cases(actual, score, grade):
    target = {key: value * 1_000_000 for key, value in TARGET_30S_NEUTRAL.items()}
    result = allocation_score(amounts(*actual), target, 100_000_000)
    assert result == score
    assert rules.grade_for_score(result) == grade


@pytest.mark.parametrize(
    "score,grade",
    [(100, "S"), (90, "S"), (89, "A"), (80, "A"), (79, "B"), (70, "B"), (69, "C"), (60, "C")]
    + [(59, "D"), (0, "D")],
)
def test_grade_boundaries(score, grade):
    assert rules.grade_for_score(score) == grade


def test_allocation_score_rounds_half_up():
    # 차이 합 1% → 100 − 0.5 = 99.5 → 100, 차이 합 3% → 98.5 → 99
    target = amounts(65, 25, 5, 5, 0)
    assert allocation_score(amounts(65, 25, 5, 5, 0), target, 100_000_000) == 100
    half = {**target, AssetClass.STOCK: 65_500_000, AssetClass.BOND: 24_500_000}
    assert allocation_score(half, target, 100_000_000) == 100
    one_half = {**target, AssetClass.STOCK: 66_500_000, AssetClass.BOND: 23_500_000}
    assert allocation_score(one_half, target, 100_000_000) == 99


def test_add_years_leap_day():
    from datetime import date

    assert rules.add_years(date(2028, 2, 29), 1) == date(2029, 2, 28)
    assert rules.add_years(date(2026, 10, 16), 3) == date(2029, 10, 16)
