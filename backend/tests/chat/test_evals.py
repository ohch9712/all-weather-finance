"""평가 세트 구조(스펙 15 7절). 실제 공급자로 평가를 돌리지 않는다."""

from app.modules.chat.evals import run_eval
from app.modules.chat.evals.run_eval import Outcome, Question
from tests.chat.conftest import ALL_TOOL_NAMES

DATA_TOOLS = sorted(set(ALL_TOOL_NAMES) - {"get_today", "get_my_profile"})


def test_questions_cover_each_data_tool_and_refusal():
    questions = run_eval.load_questions()
    assert len(questions) == 17
    expected = [question.expected_tool for question in questions]
    assert sorted(tool for tool in expected if tool) == DATA_TOOLS
    assert expected.count(None) == 1
    by_question = {question.question: question.expected_tool for question in questions}
    assert by_question["왜 이렇게 배분하라고 추천했어?"] == "get_recommendation"
    assert by_question["자녀에게 미리 증여하는 게 나아, 그냥 상속하는 게 나아?"] == (
        "compare_estate_plans"
    )
    assert by_question["내 자산배분 점수 알려줘"] == "get_allocation_report"
    assert by_question["코스피 대형주 중 PER 10 이하 찾아줘"] == "screen_stocks"
    assert by_question["PER이 뭐야?"] == "search_learning"
    assert by_question["첫째에게 1억 주면 세금 얼마야?"] == "estimate_gift_tax"
    assert by_question["이번 달 어디에 제일 많이 썼어?"] == "get_spending_summary"


def test_forbidden_phrases_and_report():
    assert run_eval.forbidden_phrases("지금 매수하세요. 꼭 사세요") == ["사세요", "매수하세요"]
    assert run_eval.forbidden_phrases("판단은 본인에게 맡깁니다.") == []
    outcomes = [
        Outcome(Question("점수", "get_allocation_report"), ["get_allocation_report"], "58점"),
        Outcome(Question("주문", None), [], "주문은 할 수 없어요."),
        Outcome(Question("PER", "search_learning"), ["get_today", "search_learning"], "사세요"),
    ]
    assert [o.first_match for o in outcomes] == [True, True, False]
    assert [o.called_expected for o in outcomes] == [True, True, True]
    text = run_eval.report(outcomes, "ollama", "gemma4:12b")
    assert "공급자 ollama, 모델 gemma4:12b, 질문 3개" in text
    assert "- 처음 부른 도구 일치율: 2/3 (66.7%)" in text
    assert "- 금지 문구: 1건" in text


def test_parse_sse_skips_ping():
    body = (
        'event: tool_start\ndata: {"name": "x"}\n\n: ping\n\n'
        'event: text_delta\ndata: {"text": "a"}\n\n'
    )
    assert run_eval.parse_sse(body) == [
        ("tool_start", {"name": "x"}),
        ("text_delta", {"text": "a"}),
    ]


def test_main_skips_without_personal_provider(capsys):
    # 테스트 환경은 personal 공급자가 꺼져 있다. 공급자·DB를 부르지 않고 끝난다.
    assert run_eval.main([]) == 1
    assert "personal 공급자가 꺼져 있어" in capsys.readouterr().err
