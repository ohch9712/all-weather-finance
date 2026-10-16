"""자산배분 규칙 상수(스펙 02 5절). 설문 문항, 25칸 권장 배분표, 고정 문구를 둔다.

프론트는 문항과 표를 API로 받아 그린다. 여기 값이 유일한 기준이다.
"""

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.core.domain import AGE_BAND_REPRESENTATIVE_AGE, AgeBand, AssetClass, RiskProfile

# 문항이 바뀌면 버전을 올린다(스펙 02 4절).
SURVEY_VERSION = 1


@dataclass(frozen=True)
class SurveyQuestion:
    id: str
    text: str
    options: tuple[str, ...]  # 값은 1부터 차례로 붙는다
    weight: Decimal

    @property
    def option_count(self) -> int:
        return len(self.options)

    def label(self, value: int) -> str:
        return self.options[value - 1]


# 스펙 02 5.1 표. 순서와 문구를 그대로 둔다.
SURVEY_QUESTIONS: tuple[SurveyQuestion, ...] = (
    SurveyQuestion(
        "horizon",
        "이 돈을 얼마 동안 투자할 수 있나요?",
        ("6개월 미만", "6개월 ~ 1년", "1년 ~ 3년", "3년 ~ 5년", "5년 이상"),
        Decimal("1.5"),
    ),
    SurveyQuestion(
        "experience",
        "지금까지 투자해 본 상품 중 가장 위험한 것은 무엇인가요?",
        (
            "예금·적금만 해 봤어요",
            "채권, 채권형 펀드",
            "혼합형 펀드, ELS 같은 파생결합증권",
            "주식, 주식형 펀드, ETF",
            "레버리지·인버스 ETF, 선물·옵션, 신용거래",
        ),
        Decimal("1"),
    ),
    SurveyQuestion(
        "knowledge",
        "금융상품에 대해 얼마나 알고 있나요?",
        (
            "거의 모른다",
            "예금과 펀드의 차이 정도는 안다",
            "주식과 채권의 위험 차이를 설명할 수 있다",
            "대부분의 금융상품 구조와 위험을 이해한다",
        ),
        Decimal("1"),
    ),
    SurveyQuestion(
        "income",
        "앞으로의 수입은 어떨 것 같나요?",
        (
            "수입이 없거나 줄어들 것 같다",
            "지금은 안정적이지만 앞으로 불안정할 것 같다",
            "안정적으로 유지될 것 같다",
            "꾸준히 늘어날 것 같다",
        ),
        Decimal("1"),
    ),
    SurveyQuestion(
        "investmentRatio",
        "가진 금융자산 중 원금 손실이 날 수 있는 상품에 투자할 비중은 얼마인가요?",
        ("10% 이하", "10% ~ 20%", "20% ~ 30%", "30% ~ 40%", "40% 초과"),
        Decimal("1"),
    ),
    SurveyQuestion(
        "lossTolerance",
        "투자금이 1년 동안 어느 정도 손실이 나도 견딜 수 있나요?",
        (
            "원금은 꼭 지켜야 한다",
            "10% 이내",
            "20% 이내",
            "30% 이내",
            "기대 수익이 크다면 그 이상도 괜찮다",
        ),
        Decimal("2"),
    ),
)
QUESTION_BY_ID = {question.id: question for question in SURVEY_QUESTIONS}
WEIGHT_SUM = sum((question.weight for question in SURVEY_QUESTIONS), Decimal(0))  # 7.5

ONE_DECIMAL = Decimal("0.1")
TWO_DECIMALS = Decimal("0.01")


def round_half_up(value: Decimal, unit: Decimal = ONE_DECIMAL) -> Decimal:
    return value.quantize(unit, ROUND_HALF_UP)


def answer_points(question: SurveyQuestion, value: int) -> Decimal:
    """반올림 전 문항 점수: 100 × 가중치 × (값 − 1) ÷ (선택지 수 − 1) ÷ 가중치 합"""
    return (
        Decimal(100)
        * question.weight
        * Decimal(value - 1)
        / Decimal(question.option_count - 1)
        / WEIGHT_SUM
    )


def max_points(question: SurveyQuestion) -> Decimal:
    return Decimal(100) * question.weight / WEIGHT_SUM


def survey_score(answers: dict[str, int]) -> Decimal:
    """설문 점수(스펙 02 5.1), 소수 첫째 자리 ROUND_HALF_UP"""
    total = sum(
        (answer_points(question, answers[question.id]) for question in SURVEY_QUESTIONS),
        Decimal(0),
    )
    return round_half_up(total)


def classify_risk_profile(score: Decimal) -> RiskProfile:
    """금융투자협회 표준 구간: 20 이하 / 40 이하 / 60 이하 / 80 이하 / 그 초과"""
    if score <= 20:
        return RiskProfile.STABLE
    if score <= 40:
        return RiskProfile.STABLE_SEEKING
    if score <= 60:
        return RiskProfile.NEUTRAL
    if score <= 80:
        return RiskProfile.ACTIVE
    return RiskProfile.AGGRESSIVE


# 성향 한 줄 설명(스펙 02 9.1). 7.10의 riskProfileSummary와 추천 이유에 쓴다.
RISK_PROFILE_SUMMARY: dict[RiskProfile, str] = {
    RiskProfile.STABLE: "원금 보전이 가장 중요해요.",
    RiskProfile.STABLE_SEEKING: "손실은 작게, 이자보다 조금 높은 수익을 원해요.",
    RiskProfile.NEUTRAL: "수익과 위험의 균형을 원해요.",
    RiskProfile.ACTIVE: "높은 수익을 위해 손실도 어느 정도 감수해요.",
    RiskProfile.AGGRESSIVE: "큰 수익을 위해 큰 손실도 감수할 수 있어요.",
}

# 권장 배분표를 만드는 근거(스펙 02 5.2 규칙). 테스트가 이 규칙으로 표를 다시 계산한다.
RISK_ADJUSTMENT: dict[RiskProfile, int] = {
    RiskProfile.STABLE: -30,
    RiskProfile.STABLE_SEEKING: -15,
    RiskProfile.NEUTRAL: 0,
    RiskProfile.ACTIVE: 10,
    RiskProfile.AGGRESSIVE: 20,
}
RISKY_MIN = 10
RISKY_MAX = 90


@dataclass(frozen=True)
class RiskyWeight:
    start: int  # 100 − 대표 나이
    adjustment: int  # 성향 보정
    final: int  # 10~90으로 자른 값
    clamped: bool


def risky_weight(age_band: AgeBand, risk_profile: RiskProfile) -> RiskyWeight:
    start = 100 - AGE_BAND_REPRESENTATIVE_AGE[age_band]
    adjustment = RISK_ADJUSTMENT[risk_profile]
    raw = start + adjustment
    final = min(RISKY_MAX, max(RISKY_MIN, raw))
    return RiskyWeight(start, adjustment, final, final != raw)


Weights = dict[AssetClass, int]


def _weights(stock: int, bond: int, gold: int, cash: int, other: int) -> Weights:
    return {
        AssetClass.STOCK: stock,
        AssetClass.BOND: bond,
        AssetClass.GOLD: gold,
        AssetClass.CASH: cash,
        AssetClass.OTHER: other,
    }


S, SS, N, A, AG = (
    RiskProfile.STABLE,
    RiskProfile.STABLE_SEEKING,
    RiskProfile.NEUTRAL,
    RiskProfile.ACTIVE,
    RiskProfile.AGGRESSIVE,
)

# 스펙 02 5.2 결과 표(주식 / 채권 / 금 / 현금 / 기타, %). 글자 단위로 같아야 한다.
TARGET_TABLE: dict[AgeBand, dict[RiskProfile, Weights]] = {
    AgeBand.TWENTIES: {
        S: _weights(45, 40, 10, 5, 0),
        SS: _weights(60, 30, 5, 5, 0),
        N: _weights(75, 15, 5, 5, 0),
        A: _weights(80, 5, 5, 5, 5),
        AG: _weights(80, 0, 5, 5, 10),
    },
    AgeBand.THIRTIES: {
        S: _weights(35, 50, 10, 5, 0),
        SS: _weights(50, 35, 10, 5, 0),
        N: _weights(65, 25, 5, 5, 0),
        A: _weights(70, 15, 5, 5, 5),
        AG: _weights(75, 5, 5, 5, 10),
    },
    AgeBand.FORTIES: {
        S: _weights(25, 55, 10, 10, 0),
        SS: _weights(40, 40, 10, 10, 0),
        N: _weights(55, 25, 10, 10, 0),
        A: _weights(60, 20, 5, 10, 5),
        AG: _weights(65, 10, 5, 10, 10),
    },
    AgeBand.FIFTIES: {
        S: _weights(15, 65, 10, 10, 0),
        SS: _weights(30, 50, 10, 10, 0),
        N: _weights(45, 35, 10, 10, 0),
        A: _weights(50, 25, 10, 10, 5),
        AG: _weights(55, 20, 5, 10, 10),
    },
    AgeBand.SIXTIES: {
        S: _weights(10, 65, 10, 15, 0),
        SS: _weights(20, 55, 10, 15, 0),
        N: _weights(35, 40, 10, 15, 0),
        A: _weights(40, 30, 10, 15, 5),
        AG: _weights(45, 20, 10, 15, 10),
    },
}

ASSET_CLASS_ORDER: tuple[AssetClass, ...] = tuple(AssetClass)

# 배분 점수 등급(스펙 02 5.4): 90 이상 S, 80 이상 A, 70 이상 B, 60 이상 C, 그 밖 D
GRADE_THRESHOLDS: tuple[tuple[int, str], ...] = ((90, "S"), (80, "A"), (70, "B"), (60, "C"))
GRADES = ("S", "A", "B", "C", "D")


def grade_for_score(score: int) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "D"


# 목표 종류와 기본 이름(스펙 02 5.7)
GOAL_TYPE_LABEL: dict[str, str] = {
    "retirement": "노후 준비",
    "home": "내 집 마련",
    "education": "자녀 교육",
    "marriage": "결혼 자금",
    "car": "차량 구입",
    "lump_sum": "목돈 마련",
    "other": "기타 목표",
}
GOAL_TYPES = tuple(GOAL_TYPE_LABEL)
MAX_GOALS = 10
GOAL_HORIZONS = ("within_1y", "within_3y", "long_term")

# 상황 입력 범위(스펙 02 5.7)
MAX_MONTHLY_EXPENSE = 100_000_000
MAX_DEPENDENTS = 10
MAX_CONSUMER_DEBT = 1_000_000_000_000
MAX_GOAL_AMOUNT = 1_000_000_000_000
MAX_GOAL_YEARS = 50

# 보유 자산 입력 범위(스펙 02 7.6)
MAX_HOLDING_AMOUNT = 1_000_000_000_000
MAX_BULK_HOLDINGS = 20
HOLDING_SOURCES = ("manual", "kiwoom", "toss", "codef")

# 비상금 개월 수(스펙 02 5.7)
EMERGENCY_MONTHS_BASE = 3
EMERGENCY_MONTHS_EXTENDED = 6
UNSTABLE_INCOME_ANSWERS = (1, 2)

# 자산군별 역할(스펙 02 5.10 assetClassNotes)
ASSET_CLASS_NOTE: dict[AssetClass, str] = {
    AssetClass.STOCK: (
        "기업의 성장에 투자해요. 오래 둘수록 기대 수익이 크지만 값이 크게 오르내려요."
    ),
    AssetClass.BOND: "정해진 이자를 받으며, 주식이 흔들릴 때 전체 자산의 변동을 줄여 줘요.",
    AssetClass.GOLD: (
        "물가가 오르거나 시장이 불안할 때 다른 자산과 다르게 움직여 분산 효과가 있어요."
    ),
    AssetClass.CASH: (
        "비상금과 곧 쓸 돈이에요. 손실 위험은 거의 없지만 물가만큼 불어나기는 어려워요."
    ),
    AssetClass.OTHER: (
        "리츠·원자재처럼 주식·채권과 다르게 움직이는 자산이에요. 공격적인 성향에서만 조금 담아요."
    ),
}

# 리밸런싱 방향을 만드는 차이 기준(퍼센트포인트)과 개수(스펙 02 5.9)
REBALANCE_THRESHOLD = Decimal(5)
REBALANCE_MAX_ITEMS = 2


def add_years(day: date, years: int) -> date:
    """오늘 + N년: 같은 월·일, 없는 2월 29일은 2월 28일로 본다(스펙 02 5.7)."""
    try:
        return day.replace(year=day.year + years)
    except ValueError:
        return day.replace(year=day.year + years, day=28)
