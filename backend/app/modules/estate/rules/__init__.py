from datetime import date

from app.core.errors import field_error
from app.modules.estate.rules.kr_2024_01_01 import RULES_2024_01_01, RuleSet


def get_active_rules(on: date) -> RuleSet:
    candidates = [r for r in (RULES_2024_01_01,) if r.effective_from <= on]
    if not candidates:
        raise field_error("asOf", "2024년 1월 1일 이후 날짜로 계산해 주세요.")
    return max(candidates, key=lambda r: r.effective_from)
