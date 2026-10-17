"""상속세 및 증여세법 제13·18~26·47·53·53의2·55~57·69조, 시행령 제9조."""

# 제53조 제4호: 기타친족은 4촌 이내 혈족·3촌 이내 인척이다(공제액은 1천만원).
# 법률 제20777호(2025-03-14 시행) 부칙 제4조에 따라 시행 전 증여는
# 종전 범위(6촌 이내 혈족·4촌 이내 인척)를 적용한다.
# 출처: https://www.law.go.kr/LSW/lsRvsDocInfoR.do?lsiSeq=269799&chrClsCd=010202

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True)
class Bracket:
    up_to: int | None
    rate: Decimal
    progressive_deduction: int


@dataclass(frozen=True)
class RuleSet:
    version: str
    effective_from: date
    sources: tuple[tuple[str, str], ...]
    brackets: tuple[Bracket, ...]
    spouse_gift: int = 600_000_000
    adult_gift: int = 50_000_000
    minor_gift: int = 20_000_000
    relative_gift: int = 10_000_000
    marriage_birth: int = 100_000_000
    minor_age: int = 19
    aggregation_threshold: int = 10_000_000
    minimum_tax_base: int = 500_000
    filing_rate: Decimal = Decimal("0.03")
    skip_rate: Decimal = Decimal("0.30")
    minor_skip_rate: Decimal = Decimal("0.40")
    minor_skip_threshold: int = 2_000_000_000
    basic_inheritance: int = 200_000_000
    child_deduction: int = 50_000_000
    minor_year_deduction: int = 10_000_000
    elderly_age: int = 65
    elderly_deduction: int = 50_000_000
    disability_year_deduction: int = 10_000_000
    lump_sum_deduction: int = 500_000_000
    spouse_minimum: int = 500_000_000
    spouse_maximum: int = 3_000_000_000
    spouse_weight: Decimal = Decimal("1.5")
    financial_small: int = 20_000_000
    financial_middle: int = 100_000_000
    financial_rate: Decimal = Decimal("0.20")
    financial_maximum: int = 200_000_000
    cohabiting_maximum: int = 600_000_000
    funeral_minimum: int = 5_000_000
    funeral_maximum: int = 10_000_000
    enshrinement_maximum: int = 5_000_000
    gift_window_years: int = 10
    marriage_window_years: int = 2
    heir_window_years: int = 10
    non_heir_window_years: int = 5


RULES_2024_01_01 = RuleSet(
    version="KR-2024.01.01",
    effective_from=date(2024, 1, 1),
    sources=(
        ("상속세 및 증여세법", "https://www.law.go.kr/법령/상속세및증여세법"),
        (
            "상속세 및 증여세법 시행령 제9조",
            "https://www.law.go.kr/법령/상속세및증여세법시행령/제9조",
        ),
        ("민법 제4조", "https://www.law.go.kr/법령/민법/제4조"),
    ),
    brackets=(
        Bracket(100_000_000, Decimal("0.10"), 0),
        Bracket(500_000_000, Decimal("0.20"), 10_000_000),
        Bracket(1_000_000_000, Decimal("0.30"), 60_000_000),
        Bracket(3_000_000_000, Decimal("0.40"), 160_000_000),
        Bracket(None, Decimal("0.50"), 460_000_000),
    ),
)
