"""15 도구 공통 규칙(스펙 15 4절·6절·8절·10절).

도구 목록·입력 검증·설명 규칙·공개 함수만 사용·개인정보·카드 링크·savepoint·대화 시나리오
"""

import ast
import json
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import text

from app.integrations.llm.schema import portable_json_schema
from app.modules.chat import prompts
from app.modules.chat.agent import _safe_card
from app.modules.chat.tools.common import NoInput, krw_compact, rate
from app.modules.chat.tools.registry import (
    ToolOutput,
    ToolSpec,
    find_tool,
    get_registered_tools,
)
from tests.chat.conftest import (
    ALL_TOOL_NAMES,
    create_conversation,
    names,
    rows,
    send_events,
    user_by_email,
)
from tests.chat.fakes import FakeRound, call
from tests.chat.tool_helpers import (
    add_entry,
    add_gift,
    add_holding,
    add_member,
    add_trade,
    assess,
    run,
    tool_ctx,
)

TOOLS_DIR = Path(__file__).resolve().parents[2] / "app" / "modules" / "chat" / "tools"

# 도구마다 검증을 통과하는 최소 인자
VALID_ARGUMENTS = {
    "add_to_watchlist": {"code": "005930"},
    "compare_estate_plans": {},
    "estimate_gift_tax": {"amount": 1000},
    "get_allocation_report": {},
    "get_gift_deductions": {},
    "get_my_profile": {},
    "get_positions": {},
    "get_recommendation": {},
    "get_risk_profile": {},
    "get_spending_summary": {"month": None},
    "get_stock_detail": {"code": "005930"},
    "get_today": {},
    "get_trade_stats": {"from": None, "to": None},
    "get_watchlist": {},
    "plan_gifts": {"birthDate": "2018-01-01"},
    "screen_stocks": {
        "filter": {
            "markets": None,
            "kinds": None,
            "sectors": None,
            "conditions": [],
            "sort": None,
            "limit": 5,
        }
    },
    "search_learning": {"query": "PER"},
    "search_stocks": {"query": "삼성"},
}

# 스펙 15 4절 표의 호출 함수(모듈 → 허용 함수). 다른 함수·비공개 코드를 부르지 않는다.
ALLOWED_CALLS = {
    "allocation_service": {
        "get_allocation_report",
        "get_recommendation",
        "get_latest_risk_profile",
        "get_target_allocation",
    },
    "ledger_service": {"get_monthly_summary"},
    "journal_service": {"get_trade_stats", "get_positions"},
    "market_service": {"search_stocks", "get_stock_detail"},
    "screener_service": {"run_screen", "encode_filter", "get_filter_guide"},
    "watchlist_service": {"list_items", "add_item"},
    "estate_service": {
        "list_members",
        "get_deduction_status",
        "resolve_gift_input",
        "calc_gift_tax",
        "build_compare_input",
        "compare_estate_plans",
        "member_recipient",
        "prior_gifts",
        "simulate_gift_plan",
    },
    "learn_service": {"search_posts"},
    "auth_service": {"get_profile"},
}
WRITE_CALLS = {"add_item"}  # 쓰기 도구는 add_to_watchlist 하나(검증 체크리스트 2)


def test_registered_tools_are_18_sorted():
    tools = get_registered_tools()
    assert [tool.name for tool in tools] == ALL_TOOL_NAMES
    assert len(tools) == 18
    assert set(VALID_ARGUMENTS) == set(ALL_TOOL_NAMES)
    for tool in tools:
        assert tool.input_model.model_config.get("extra") == "forbid"
        schema = portable_json_schema(tool.input_model)
        assert schema["type"] == "object" and schema["additionalProperties"] is False
        assert tool.label.endswith("중")


@pytest.mark.parametrize("name", ALL_TOOL_NAMES)
def test_inputs_reject_unknown_keys(auth_client, db, name):
    tool = find_tool(name)
    tool.input_model.model_validate(VALID_ARGUMENTS[name])  # 최소 인자는 통과한다
    result = run(tool_ctx(db), name, {**VALID_ARGUMENTS[name], "unexpected": 1})
    assert result.is_error
    assert "INVALID_INPUT" in result.content and "unexpected" in result.content["INVALID_INPUT"]


def test_input_keys_are_camel_case_only():
    estimate = find_tool("estimate_gift_tax").input_model
    assert set(portable_json_schema(estimate)["properties"]) == {
        "memberName",
        "relation",
        "birthDate",
        "donorGroup",
        "amount",
        "giftedOn",
    }
    assert set(portable_json_schema(find_tool("plan_gifts").input_model)["properties"]) == {
        "memberName",
        "birthDate",
        "targetAge",
        "annualReturnRate",
    }
    assert set(
        portable_json_schema(find_tool("compare_estate_plans").input_model)["properties"]
    ) == {
        "horizonYears",
        "annualGrowthRate",
        "lumpSumPerChild",
    }
    assert set(portable_json_schema(find_tool("get_trade_stats").input_model)["properties"]) == {
        "from",
        "to",
    }


def test_descriptions_follow_rules():
    description = {tool.name: tool.description for tool in get_registered_tools()}
    assert "분명히 말했을 때만" in description["add_to_watchlist"]
    for name in ("estimate_gift_tax", "plan_gifts", "compare_estate_plans"):
        assert "참고용" in description[name], name
    assert "assets_required" in description["compare_estate_plans"]
    assert "왜 이렇게 추천했어" in description["get_recommendation"]
    assert "뭐부터 해야 해" in description["get_recommendation"]
    for name in ("get_gift_deductions", "estimate_gift_tax", "plan_gifts"):
        assert "공백을 무시" in description[name] and "candidates" in description[name]
    for name in ALL_TOOL_NAMES:
        assert "쓴다" in description[name], name  # 언제 쓰는지 적는다


def _service_calls(tree: ast.Module) -> set[tuple[str, str]]:
    calls = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id.endswith("_service")
        ):
            calls.add((node.value.id, node.attr))
    return calls


def test_tools_use_only_public_service_functions():
    used: set[tuple[str, str]] = set()
    for path in sorted(TOOLS_DIR.glob("*.py")):
        if path.name == "registry.py":
            continue  # 09 레지스트리(User 타입 힌트용 import만 있다)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                parts = node.module.split(".")
                if parts[:2] == ["app", "modules"] and parts[2] not in {"chat"}:
                    # 다른 모듈은 service와 그 함수가 쓰는 타입(schemas)만 import한다.
                    assert parts[3:4] in (["service"], ["schemas"], []), (path.name, node.module)
                    names_ = {alias.name for alias in node.names}
                    if parts[3:] == []:
                        assert names_ == {"service"}, (path.name, names_)
                    assert not names_ & {"repository", "models", "router", "calculations"}
        used |= _service_calls(tree)
    for module, function in used:
        assert function in ALLOWED_CALLS[module], (module, function)
    writes = {function for _, function in used if function in WRITE_CALLS}
    assert writes == {"add_item"}


@pytest.mark.parametrize(
    "phrase",
    [
        "데이터 없음 상태",
        "screen_stocks",
        "카드 링크로 전체를",
        "search_learning",
        "링크를 함께",
        "신고기한 내 신고",
        "get_recommendation",
        "compare_estate_plans",
        "참고용",
        "세무 전문가와 상의",
        "add_to_watchlist",
    ],
)
def test_system_prompt_mentions_tool_rules(phrase):
    assert phrase in prompts.SYSTEM_PROMPT


def test_results_have_no_email_user_id_or_account(auth_client, db, market):
    """모든 도구 결과(모델용·카드)에 이메일·사용자 ID·계좌번호가 없다(검증 체크리스트 5)."""
    assess(auth_client)
    add_holding(auth_client, "cash", 300_000_000)
    add_entry(auth_client, "expense", "식비", 12_000, "2026-10-05")
    add_trade(auth_client, "buy", "1", "70000", "2026-03-02")
    member = add_member(auth_client, "첫째")
    add_gift(auth_client, member["id"], 10_000_000, "2025-01-10")
    run(tool_ctx(db), "add_to_watchlist", {"code": "005930"})
    ctx = tool_ctx(db)
    secrets = [ctx.user.email, str(ctx.user.id), member["id"]]
    arguments = {
        **VALID_ARGUMENTS,
        "get_gift_deductions": {"memberName": "첫째"},
        "estimate_gift_tax": {"memberName": "첫째", "amount": 50_000_000},
        "plan_gifts": {"memberName": "첫째"},
        "add_to_watchlist": {"code": "000660"},
    }
    for name in ALL_TOOL_NAMES:
        result = run(ctx, name, arguments[name])
        assert not result.is_error, (name, result.content)
        serialized = result.raw + json.dumps(result.card, ensure_ascii=False)
        for secret in secrets:
            assert secret not in serialized, (name, secret)


# ── 카드 링크 ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "card,expected",
    [
        ({"type": "table", "title": "t", "columns": [], "rows": [], "href": "/journal"}, True),
        ({"type": "table", "title": "t", "columns": [], "rows": []}, True),
        ({"type": "table", "title": "t", "columns": [], "rows": [], "href": "https://x"}, False),
        ({"type": "stock_list", "href": None, "items": []}, True),
        ({"type": "stock", "href": "//evil.example"}, False),
        ({"type": "link", "title": "t"}, False),
    ],
)
def test_safe_card_checks_href(card, expected):
    assert (_safe_card(card) is not None) is expected


def test_safe_card_filters_link_list():
    card = {
        "type": "link_list",
        "title": "t",
        "links": [
            {"title": "a", "description": None, "href": "/learn/a"},
            {"title": "b", "description": None, "href": "https://example.com"},
        ],
    }
    assert _safe_card(card)["links"] == [card["links"][0]]
    assert _safe_card({**card, "links": [card["links"][1]]}) is None


# ── savepoint(스펙 15 4.1, 회귀) ─────────────────────────────────────


def test_add_to_watchlist_through_loop_saves_card(auth_client, use_provider, db, market):
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("add_to_watchlist", {"code": "005930"})]),
            FakeRound(texts=["담았어요."]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"], "삼성전자 관심종목에 넣어줘")
    assert names(events) == ["message_start", "tool_start", "tool_end", "text_delta", "message_end"]
    tool_end = events[2][1]
    assert tool_end["ok"] is True
    assert tool_end["card"]["type"] == "link" and tool_end["card"]["href"] == "/stocks/watchlist"
    saved = rows(db, UUID(conversation["id"]))
    assert [r.kind for r in saved] == ["question", "response", "tool_results", "response"]
    assert saved[-1].cards == [tool_end["card"]]
    items = auth_client.get("/api/watchlist").json()["items"]
    assert [item["code"] for item in items] == ["005930"]


def _db_error_tool(ctx, params):
    # 도구 안의 DB 오류. savepoint만 되돌리고 대화 저장은 이어 간다.
    ctx.db.execute(text("SELECT 1/0"))
    return ToolOutput("unreachable")


def _commit_then_fail_tool(ctx, params):
    # 공개 함수처럼 안에서 커밋한 뒤 실패한다(savepoint가 이미 닫힌 경우).
    ctx.db.commit()
    ctx.db.execute(text("SELECT 1/0"))
    return ToolOutput("unreachable")


@pytest.mark.parametrize("handler", [_db_error_tool, _commit_then_fail_tool])
def test_tool_db_error_keeps_conversation(auth_client, use_provider, temp_tool, db, handler):
    temp_tool(ToolSpec("zz_db_error", "임시", NoInput, "임시 확인 중", handler))
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("zz_db_error"), call("get_my_profile")]),
            FakeRound(texts=["확인했어요."]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert names(events)[-1] == "message_end"
    ends = [data for name, data in events if name == "tool_end"]
    assert [data["ok"] for data in ends] == [False, True]
    saved = rows(db, UUID(conversation["id"]))
    assert [r.kind for r in saved] == ["question", "response", "tool_results", "response"]
    # 뒤이은 도구도 DB를 정상으로 쓴다.
    assert ends[1]["card"]["type"] == "key_value"


# ── 대화 시나리오(스펙 15 8절) ───────────────────────────────────────


def test_score_question_scenario_saves_allocation_card(auth_client, use_provider, db):
    assess(auth_client)
    add_holding(auth_client, "stock", 6_000_000)
    add_holding(auth_client, "bond", 4_000_000)
    provider = use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_allocation_report")]),
            FakeRound(texts=["점수는 카드에서 확인해 주세요."]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"], "내 자산배분 점수 알려줘")
    tool_end = next(data for name, data in events if name == "tool_end")
    assert tool_end["name"] == "get_allocation_report" and tool_end["ok"] is True
    card = tool_end["card"]
    assert card["type"] == "allocation" and card["status"] == "ready"

    saved = rows(db, UUID(conversation["id"]))
    assert saved[1].cards == [] and saved[-1].cards == [card]
    # 모델에 보낸 결과는 숫자를 형식화하지 않은 JSON이다.
    result = json.loads(saved[2].content[0]["content"])
    assert result["status"] == "ready" and isinstance(result["score"], int)
    assert provider.calls[1]["history"][-1] == saved[2].content[0]

    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assistant = detail["messages"][-1]
    assert assistant["role"] == "assistant"
    assert assistant["toolCalls"] == [
        {"name": "get_allocation_report", "label": "자산배분 확인 중", "ok": True}
    ]
    assert assistant["cards"] == [card]
    assert user_by_email(db).email not in json.dumps(detail["messages"], ensure_ascii=False)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        (5_000, "5,000원"),
        (56_700_000, "5,670만원"),
        (123_400_000, "1.2억원"),
        (100_000_000, "1억원"),
        (1_275_600_000_000, "12,756억원"),
        (-218_910_000_000, "-2,189.1억원"),
    ],
)
def test_compact_krw_matches_frontend(value, expected):
    assert krw_compact(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [(1.11, "+1.11%"), (-1.205, "-1.21%"), (0, "0.00%"), (-0.001, "0.00%"), (None, None)],
)
def test_rate_text(value, expected):
    assert rate(value) == expected
