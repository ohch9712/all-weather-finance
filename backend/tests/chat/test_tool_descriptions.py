"""도구 설명의 쓰임 구분과 시스템 프롬프트 고정 문장(스펙 15 4절·6절, 웨이브 4 평가 F4).

13·15번 평가 질문에서 계산 도구 대신 공제 현황 도구를, 4번에서 get_today를 먼저 불렀다.
설명과 시스템 프롬프트에 쓰임 구분 문구가 남아 있는지 고정한다.
"""

import importlib
import re

import pytest
from freezegun import freeze_time

from app.modules.chat import prompts
from app.modules.chat.tools.registry import find_tool


def description(name: str) -> str:
    return find_tool(name).description


@pytest.mark.parametrize(
    "phrase",
    [
        "남은 공제 한도·사용액·다시 생기는 날만 궁금할 때 쓴다",
        "금액이 주어진 세금 질문",
        "이 도구를 쓰지 않고 estimate_gift_tax를 쓴다",
        "언제·얼마씩 나눠 줄지 묻는 일정 질문",
        "이 도구를 쓰지 않고 plan_gifts를 쓴다",
    ],
)
def test_gift_deductions_points_to_calculation_tools(phrase):
    assert phrase in description("get_gift_deductions")


@pytest.mark.parametrize(
    ("name", "usage"),
    [
        ("estimate_gift_tax", "증여 금액이 주어진 세금 질문에 쓴다"),
        ("plan_gifts", "언제·얼마씩 나눠 줄지 묻는 일정 질문에 쓴다"),
    ],
)
def test_calculation_tools_do_not_need_deductions_first(name, usage):
    text = description(name)
    assert usage in text
    assert "공제 한도와 10년 합산 증여 기록을 이 도구가 직접 반영" in text
    assert "get_gift_deductions를 먼저 부를 필요가 없다" in text
    assert "참고용" in text  # 기존 규칙(참고용 추정) 유지


def test_spending_summary_skips_get_today_for_this_month():
    text = description("get_spending_summary")
    assert "이번 달이면 get_today 없이 바로 month를 null로 부른다" in text
    assert "지난달처럼 상대적인 달만 get_today로 날짜를 먼저 확인한다" in text


def test_system_prompt_routes_gift_questions_to_calculation_tools():
    sentence = (
        "- 증여세 계산·증여 일정 질문은 공제 현황 도구(get_gift_deductions)가 아니라 계산"
        " 도구(세금은 estimate_gift_tax, 나눠 주는 일정은 plan_gifts)를 쓴다."
    )
    tax_rule = "- 세금 질문은 계산 결과와 함께 가정(신고기한 내 신고 등)을 짧게 밝힌다."
    lines = prompts.SYSTEM_PROMPT.split("\n")
    assert lines.count(sentence) == 1
    # 도구 사용 절 안, 세금 질문 안내 바로 뒤에 둔다.
    assert lines.index("도구 사용") < lines.index(tax_rule)
    assert lines.index(sentence) == lines.index(tax_rule) + 1


def test_system_prompt_stays_fixed_after_new_sentence():
    with freeze_time("2026-10-18 09:00:00"):
        first = importlib.reload(prompts).SYSTEM_PROMPT
    with freeze_time("2032-03-04 23:59:00"):
        second = importlib.reload(prompts).SYSTEM_PROMPT
    assert first.encode() == second.encode()
    assert not re.search(r"\d{4}", first)  # 날짜 같은 가변 값이 없다
