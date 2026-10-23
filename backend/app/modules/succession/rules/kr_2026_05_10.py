"""상속·증여(과제) 규칙. 증여세·상속세 수치는 06(estate) 규칙 파일을 그대로 쓴다.

2026-10-21에 국가법령정보센터 원문과 국가데이터처 생명표 원자료로 다시 확인했다(스펙 22 4절과 같음).

- 생명표: 국가데이터처 「2024년 생명표」 보도자료(2025-12-03) [표 2] 성·연령별 기대여명.
  40·50·60·70·80·90·100세 이상은 표 2, 65세는 같은 자료의 본문(남 19.5, 여 23.7).
- 취득세(지방세법, 2026-07-01 시행본)
  - 제11조 제1항 제1호 나목: 상속(농지 외) 1천분의 28 / 제2호: 그 밖의 무상취득 1천분의 35
  - 제6조 제19호: 중과기준세율 1천분의 20
  - 제13조의2 제2항: 조정대상지역 일정가액 이상 주택 무상취득은 제11조 제1항 제7호 나목(1천분의 40)
    + 중과기준세율의 100분의 400 = 12%. 단서: 1세대 1주택자의 주택을 직계비속이 무상취득하면 제외
  - 시행령 제28조의6: 일정가액은 취득 당시 시가표준액 3억원, 제외 대상은 1세대 1주택자의 직계비속
  - 제15조 제1항 제2호 가목: 상속 1가구 1주택은 세율에서 중과기준세율을 뺀 세율(2.8% − 2% = 0.8%)
  - 제151조 제1항 제1호: 지방교육세 = (세율 − 1천분의 20) × 100분의 20 → 증여 0.3%, 상속 0.16%.
    나목: 제13조의2 중과는 (1천분의 40 − 중과기준세율) × 100분의 20 = 0.4%
- 농어촌특별세법 제5조 제1항 제6호: 표준세율을 1천분의 20으로 계산한 취득세액의 100분의 10(0.2%,
  중과는 (2% + 8%) × 10% = 1.0%). 제4조 제9호(시행령 제4조, 국민주택규모 85㎡ 이하 주택)와
  제10호의4(지방세법 제15조 제1항 제1호~제3호 특례)는 비과세
- 양도소득세(소득세법, 2026-07-01 시행본)
  - 제55조 제1항: 기본세율 표(6%~45%, 아래 누진공제는 표의 누적 세액에서 계산한 값과 같음)
  - 제89조 제1항 제3호: 1세대 1주택 비과세, 실지거래가액 12억원 초과 고가주택 제외
  - 시행령 제154조 제1항: 보유 2년 이상, 취득 당시 조정대상지역이면 거주 2년 이상
  - 제95조 제2항 표 1(3년 이상 연 2%, 15년 이상 30%)·표 2(보유 연 4%·최대 40%, 거주 2년 이상 연 4%·
    최대 40%), 제95조 제3항·시행령 제160조: 고가주택 양도차익 × (양도가액 − 12억원) ÷ 양도가액
  - 제103조: 양도소득 기본공제 연 250만원
  - 제104조 제1항 제2·3호: 단기 세율(주택 1년 미만 70%·2년 미만 60%, 그 밖 50%·40%),
    제8호: 비사업용 토지 기본세율 + 10%p, 제7항: 조정대상지역 2주택 +20%p, 3주택 이상 +30%p.
    시행령 제167조의3 제1항 제12호의2·제167조의10 제1항 제6호의2의 중과 배제는 "2026년 5월 9일까지
    양도하는 주택"이라 2026-05-10부터 중과가 다시 적용된다
  - 지방세법 제103조의3: 양도소득 개인지방소득세 표준세율은 소득세율의 10분의 1
    (산출세액의 10%로 계산)
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

D = Decimal


@dataclass(frozen=True)
class Bracket:
    up_to: int | None
    rate: Decimal
    progressive_deduction: int


@dataclass(frozen=True)
class AcquisitionRate:
    code: str
    label: str
    acquisition: Decimal
    education: Decimal
    # 농어촌특별세. 주택은 전용 85㎡ 초과만 낸다(토지는 항상).
    rural: Decimal


@dataclass(frozen=True)
class SuccessionRules:
    version: str
    effective_from: date
    sources: tuple[tuple[str, str], ...]
    life_table_ages: tuple[int, ...]
    life_table: dict[str, tuple[Decimal, ...]]
    health_factors: dict[str, Decimal]
    acquisition_rates: dict[str, AcquisitionRate]
    heavy_gift_official_price: int
    capital_gains_brackets: tuple[Bracket, ...]
    one_house_exempt_price: int = 1_200_000_000
    basic_capital_gains_deduction: int = 2_500_000
    one_house_min_holding_years: int = 2
    one_house_min_residence_years: int = 2
    heavy_two_houses: Decimal = D("0.20")
    heavy_three_houses: Decimal = D("0.30")
    non_business_land_surcharge: Decimal = D("0.10")
    general_ltd_rate: Decimal = D("0.02")
    general_ltd_max_years: int = 15
    one_house_ltd_rate: Decimal = D("0.04")
    one_house_ltd_max_years: int = 10
    ltd_min_holding_years: int = 3
    short_term_house: tuple[Decimal, Decimal] = (D("0.70"), D("0.60"))
    short_term_other: tuple[Decimal, Decimal] = (D("0.50"), D("0.40"))
    local_income_tax_divisor: int = 10
    gift_round_years: int = 10
    heir_window_years: int = 10


RULES_2026_05_10 = SuccessionRules(
    version="KR-2026.05.10",
    # 다주택자 양도세 중과 유예가 끝나고 중과가 다시 적용된 날
    effective_from=date(2026, 5, 10),
    sources=(
        (
            "국가데이터처 2024년 생명표",
            "https://mods.go.kr/board.es?act=view&bid=208&list_no=439533&mainXml=Y&mid=a10301010000",
        ),
        ("상속세 및 증여세법", "https://www.law.go.kr/법령/상속세및증여세법"),
        ("지방세법", "https://www.law.go.kr/법령/지방세법"),
        ("지방세법 시행령", "https://www.law.go.kr/법령/지방세법시행령"),
        ("농어촌특별세법", "https://www.law.go.kr/법령/농어촌특별세법"),
        ("소득세법", "https://www.law.go.kr/법령/소득세법"),
        ("소득세법 시행령", "https://www.law.go.kr/법령/소득세법시행령"),
        (
            "정책브리핑, 서울 전역·경기 12곳 조정대상지역 지정(2025-10)",
            "https://www.korea.kr/news/policyNewsView.do?newsId=148950973",
        ),
        # 21절: 한 분만 계실 때 생활비·수입 비율 가정값의 근거
        ("보건복지부, 기준 중위소득", "https://www.mohw.go.kr/menu.es?mid=a10708010900"),
        ("국민연금공단, 유족연금", "https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0072M0.do"),
    ),
    life_table_ages=(40, 50, 60, 65, 70, 80, 90, 100),
    life_table={
        "father": (
            D("41.9"),
            D("32.5"),
            D("23.7"),
            D("19.5"),
            D("15.5"),
            D("8.5"),
            D("4.0"),
            D("1.9"),
        ),
        "mother": (
            D("47.4"),
            D("37.8"),
            D("28.4"),
            D("23.7"),
            D("19.2"),
            D("10.9"),
            D("5.1"),
            D("2.3"),
        ),
    },
    # 앱 가정값(통계 근거 아님)
    health_factors={"good": D("1.1"), "normal": D("1.0"), "poor": D("0.7"), "care": D("0.4")},
    acquisition_rates={
        "gift": AcquisitionRate("gift", "주택·토지 증여", D("0.035"), D("0.003"), D("0.002")),
        "gift_heavy": AcquisitionRate(
            "gift_heavy",
            "조정대상지역 공시가격 3억 원 이상 주택 증여(중과)",
            D("0.12"),
            D("0.004"),
            D("0.010"),
        ),
        "inherit": AcquisitionRate(
            "inherit", "주택·토지 상속", D("0.028"), D("0.0016"), D("0.002")
        ),
        "inherit_first_home": AcquisitionRate(
            "inherit_first_home",
            "무주택 자녀의 상속 1가구 1주택(특례)",
            D("0.008"),
            D("0.0016"),
            D("0"),
        ),
    },
    heavy_gift_official_price=300_000_000,
    capital_gains_brackets=(
        Bracket(14_000_000, D("0.06"), 0),
        Bracket(50_000_000, D("0.15"), 1_260_000),
        Bracket(88_000_000, D("0.24"), 5_760_000),
        Bracket(150_000_000, D("0.35"), 15_440_000),
        Bracket(300_000_000, D("0.38"), 19_940_000),
        Bracket(500_000_000, D("0.40"), 25_940_000),
        Bracket(1_000_000_000, D("0.42"), 35_940_000),
        Bracket(None, D("0.45"), 65_940_000),
    ),
)

# 4.4 기본 가정값(앱 가정값)
DEFAULT_ASSUMPTIONS = {
    "annual_growth_rate": D("3"),
    "cost_inflation_rate": D("2"),
    "care_monthly_cost": 2_000_000,
    "care_years": 2,
    "official_price_ratio": D("70"),
    # 2026년 기준 중위소득 1인 가구 2,564,238원 ÷ 2인 가구 4,199,292원 ≈ 61%
    "survivor_living_ratio": D("61"),
    # 국민연금 유족연금은 가입기간에 따라 기본연금액의 40~60%,
    # 본인 연금과 겹치면 본인 연금 + 유족연금 30%
    "survivor_income_ratio": D("60"),
}
