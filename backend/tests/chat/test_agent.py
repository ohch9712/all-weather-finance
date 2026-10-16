"""에이전트 루프 시나리오(스펙 09 5.4·10절). 가짜 공급자만 쓴다."""

import json
from uuid import UUID

import pytest
from pydantic import BaseModel, ConfigDict

from app.core.time import today_kst
from app.integrations.llm.tasks import get_task
from app.modules.chat import agent
from app.modules.chat.agent import MAX_TOOL_ROUNDS, run_turn
from app.modules.chat.models import ChatConversation
from app.modules.chat.prompts import SYSTEM_PROMPT
from app.modules.chat.tools.registry import ToolContext, ToolOutput, ToolSpec
from tests.chat.conftest import (
    create_conversation,
    enable_gemini,
    names,
    parse_sse,
    rows,
    send,
    send_events,
    user_by_email,
)
from tests.chat.fakes import FakeRound, call, unavailable


def test_text_only(auth_client, use_provider, db):
    provider = use_provider([FakeRound(texts=["안녕하세요", ", 반가워요"])])
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"], "안녕")
    assert names(events) == ["message_start", "text_delta", "text_delta", "message_end"]
    start, end = events[0][1], events[-1][1]
    assert start["conversationId"] == conversation["id"]
    assert start["provider"] == "ollama" and start["model"] == "gemma4:12b"
    saved = rows(db, UUID(conversation["id"]))
    assert [(r.seq, r.role, r.kind) for r in saved] == [
        (0, "user", "question"),
        (1, "assistant", "response"),
    ]
    assert str(saved[0].id) == start["questionMessageId"]
    assert str(saved[0].turn_id) == start["turnId"] == str(saved[1].turn_id)
    assert saved[0].content == [{"role": "user", "content": "안녕"}]
    assert saved[1].text_preview == "안녕하세요, 반가워요"
    assert saved[1].stop_reason == "end" and saved[1].model == "gemma4:12b"
    usage = {"inputTokens": 10, "outputTokens": 5, "cachedInputTokens": 2}
    assert saved[1].usage == usage
    assert end == {
        "messageId": str(saved[1].id),
        "stopReason": "end",
        "model": "gemma4:12b",
        "usage": usage,
    }
    # 루프가 넘긴 인자: 고정 프롬프트, 작업 등록부 effort·max_tokens, 이름순 도구
    task = get_task("chat.agent")
    recorded = provider.calls[0]
    assert recorded["system"] == SYSTEM_PROMPT
    assert (recorded["effort"], recorded["max_tokens"]) == (task.effort, task.max_tokens)
    assert [t.name for t in recorded["tools"]] == ["get_my_profile", "get_today"]
    assert recorded["history"] == [{"role": "user", "content": "안녕"}]


def test_tool_once_then_answer(auth_client, use_provider, db):
    provider = use_provider(
        [
            FakeRound(
                texts=["확인해 볼게요."], stop="tool_use", tool_calls=[call("get_my_profile")]
            ),
            FakeRound(texts=["30대예요."]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert names(events) == [
        "message_start",
        "text_delta",
        "tool_start",
        "tool_end",
        "text_delta",
        "message_end",
    ]
    assert events[2][1] == {
        "toolUseId": "call-get_my_profile",
        "name": "get_my_profile",
        "label": "프로필 확인 중",
    }
    tool_end = events[3][1]
    assert tool_end["ok"] is True and tool_end["toolUseId"] == "call-get_my_profile"
    assert tool_end["card"]["type"] == "key_value"
    assert {"label": "나이대", "value": "30대"} in tool_end["card"]["items"]
    saved = rows(db, UUID(conversation["id"]))
    assert [r.kind for r in saved] == ["question", "response", "tool_results", "response"]
    assert saved[2].role == "user" and saved[2].text_preview == ""
    # 카드는 마지막 응답 행에만 담긴다.
    assert saved[1].cards == [] and saved[3].cards == [tool_end["card"]]
    result = json.loads(saved[2].content[0]["content"])
    age = today_kst().year - 1994
    assert result == {
        "age": age,
        "ageBand": f"{min(60, age // 10 * 10)}s",
        "ageBandLabel": f"{min(60, age // 10 * 10)}대",
        "birthYear": 1994,
        "nickname": None,
    }
    assert saved[2].content[0]["tool_name"] == "get_my_profile"
    # 두 번째 라운드 기록 = 질문 + 첫 응답 + 도구 결과
    assert provider.calls[1]["history"] == [
        *saved[0].content,
        *saved[1].content,
        *saved[2].content,
    ]
    assert events[-1][1]["messageId"] == str(saved[3].id)


def test_two_tools_in_one_round_run_in_order(auth_client, use_provider, db):
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_today"), call("get_my_profile")]),
            FakeRound(texts=["끝"]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    tool_events = [(n, d["name"]) for n, d in events if n.startswith("tool_")]
    assert tool_events == [
        ("tool_start", "get_today"),
        ("tool_end", "get_today"),
        ("tool_start", "get_my_profile"),
        ("tool_end", "get_my_profile"),
    ]
    saved = rows(db, UUID(conversation["id"]))
    # 도구 결과는 한 행에 모두 담는다.
    assert [r.kind for r in saved] == ["question", "response", "tool_results", "response"]
    assert [item["tool_name"] for item in saved[2].content] == ["get_today", "get_my_profile"]
    today = json.loads(saved[2].content[0]["content"])
    assert today["today"] == today_kst().isoformat() and today["timezone"] == "Asia/Seoul"


def test_invalid_tool_input_returns_error_result(auth_client, use_provider, db):
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_today", {"unexpected": 1})]),
            FakeRound(texts=["다시 해 볼게요"]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    tool_end = next(data for name, data in events if name == "tool_end")
    assert tool_end["ok"] is False and tool_end["card"] is None
    saved = rows(db, UUID(conversation["id"]))
    content = json.loads(saved[2].content[0]["content"])
    assert list(content) == ["INVALID_INPUT"] and "unexpected" in content["INVALID_INPUT"]
    assert names(events)[-1] == "message_end"


def test_unknown_tool_is_error_result(auth_client, use_provider, db):
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("place_order")]),
            FakeRound(texts=["주문은 할 수 없어요"]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    start = next(data for name, data in events if name == "tool_start")
    end = next(data for name, data in events if name == "tool_end")
    assert start["label"] == "place_order" and end["ok"] is False


class EmptyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


def test_tool_exception_hides_internal_message(auth_client, use_provider, temp_tool, db, caplog):
    def broken(ctx: ToolContext, params: BaseModel) -> ToolOutput:
        raise RuntimeError("비밀 내부 오류 secret-detail")

    temp_tool(ToolSpec("broken_tool", "항상 실패하는 도구", EmptyInput, "실패 확인 중", broken))
    provider = use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("broken_tool")]),
            FakeRound(texts=["도구가 실패했어요"]),
        ]
    )
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"])
    assert "secret-detail" not in response.text
    events, _ = parse_sse(response.text)
    tool_end = next(data for name, data in events if name == "tool_end")
    assert tool_end == {
        "toolUseId": "call-broken_tool",
        "name": "broken_tool",
        "ok": False,
        "card": None,
    }
    saved = rows(db, UUID(conversation["id"]))
    assert saved[2].content == [
        {
            "role": "tool",
            "tool_name": "broken_tool",
            "content": json.dumps("도구 실행 중 오류가 발생했습니다.", ensure_ascii=False),
        }
    ]
    assert "secret-detail" not in json.dumps(provider.calls[1]["history"], ensure_ascii=False)
    assert "broken_tool" in caplog.text  # 로그에는 남긴다
    assert names(events)[-1] == "message_end"


def test_refused_stops_without_saving_response(auth_client, use_provider, db, chat_settings):
    enable_gemini(chat_settings)
    use_provider([FakeRound(stop="refused")], name="gemini", model="gemini-3.8-flash")
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert names(events) == ["message_start", "error"]
    assert events[1][1] == {
        "code": "LLM_REFUSED",
        "message": "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요.",
    }
    assert [r.kind for r in rows(db, UUID(conversation["id"]))] == ["question"]


def test_max_tokens_saves_response_then_errors(auth_client, use_provider, db):
    use_provider([FakeRound(texts=["긴 답"], stop="max_tokens", tool_calls=[call("get_today")])])
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert names(events) == ["message_start", "text_delta", "error"]
    assert events[-1][1] == {
        "code": "LLM_UNAVAILABLE",
        "message": "응답이 너무 길어 중단됐어요. 질문을 나눠 주세요.",
    }
    saved = rows(db, UUID(conversation["id"]))
    # 저장 → max_tokens 순서. 도구는 실행하지 않는다.
    assert [(r.kind, r.stop_reason) for r in saved] == [
        ("question", None),
        ("response", "max_tokens"),
    ]


def test_more_than_eight_tool_rounds_stops(auth_client, use_provider, db):
    provider = use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_today", call_id=f"c{n}")])
            for n in range(MAX_TOOL_ROUNDS + 1)
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert len(provider.calls) == MAX_TOOL_ROUNDS + 1 == 9
    assert names(events).count("tool_start") == MAX_TOOL_ROUNDS
    assert events[-1] == (
        "error",
        {"code": "LLM_UNAVAILABLE", "message": "도구 호출이 너무 많아 멈췄어요."},
    )
    saved = rows(db, UUID(conversation["id"]))
    assert [r.kind for r in saved].count("response") == 9
    assert [r.kind for r in saved].count("tool_results") == 8
    assert saved[-1].kind == "response"


def test_provider_unavailable_becomes_error_event(auth_client, use_provider, db):
    use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_today")]),
            unavailable(
                "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요."
            ),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"])
    assert events[-1] == (
        "error",
        {
            "code": "LLM_UNAVAILABLE",
            "message": "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요.",
        },
    )
    # 이미 저장한 행은 그대로 둔다.
    assert [r.kind for r in rows(db, UUID(conversation["id"]))] == [
        "question",
        "response",
        "tool_results",
    ]


def test_unanswered_question_is_left_out_of_next_history(auth_client, use_provider, db):
    provider = use_provider([unavailable(), FakeRound(texts=["두 번째 답"])])
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"], "첫 질문")
    send_events(auth_client, conversation["id"], "두 번째 질문")
    saved = rows(db, UUID(conversation["id"]))
    assert [r.kind for r in saved] == ["question", "question", "response"]
    # 행은 남지만 다음 기록에서는 빠진다.
    assert provider.calls[1]["history"] == [{"role": "user", "content": "두 번째 질문"}]


def test_history_is_byte_identical_to_saved_rows(auth_client, use_provider, db, chat_settings):
    enable_gemini(chat_settings)
    provider = use_provider(
        [
            FakeRound(
                texts=["확인"], stop="tool_use", tool_calls=[call("get_today", call_id="fc_1")]
            ),
            FakeRound(texts=["오늘이에요"]),
            FakeRound(texts=["두 번째"]),
        ],
        name="gemini",
        model="gemini-3.8-flash",
    )
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"], "오늘 며칠이야?")
    first_turn = rows(db, UUID(conversation["id"]))
    send_events(auth_client, conversation["id"], "고마워")
    second_history = provider.calls[2]["history"]
    expected = [item for row in first_turn for item in row.content] + provider.user_items("고마워")
    assert json.dumps(second_history, ensure_ascii=False) == json.dumps(
        expected, ensure_ascii=False
    )
    # thought 단계(서명 포함)를 빼지 않고 다시 보낸다.
    assert {"type": "thought", "signature": "c2lnbmF0dXJl"} in second_history
    # 첫 턴 저장 행은 바뀌지 않았다.
    again = rows(db, UUID(conversation["id"]))[: len(first_turn)]
    assert [r.content for r in again] == [r.content for r in first_turn]


def _ctx(db) -> ToolContext:
    return ToolContext(db=db, user=user_by_email(db), today=today_kst())


def test_interrupted_tool_call_gets_result_row(auth_client, use_provider, db):
    provider = use_provider(
        [
            FakeRound(stop="tool_use", tool_calls=[call("get_today"), call("get_my_profile")]),
            FakeRound(texts=["다음 답"]),
        ]
    )
    created = create_conversation(auth_client)
    conversation = db.get(ChatConversation, UUID(created["id"]))
    turn = run_turn(_ctx(db), provider, conversation, "첫 질문")
    for name, _ in ((e.event, e.data) for e in turn):
        if name == "tool_start":
            break
    turn.close()  # 도구 실행 중 연결이 끊겼다.
    saved = rows(db, conversation.id)
    assert [r.kind for r in saved] == ["question", "response"]
    response_turn = saved[1].turn_id

    second = list(run_turn(_ctx(db), provider, conversation, "다시"))
    assert [e.event for e in second][-1] == "message_end"
    saved = rows(db, conversation.id)
    assert [r.kind for r in saved] == [
        "question",
        "response",
        "tool_results",
        "question",
        "response",
    ]
    added = saved[2]
    assert added.turn_id == response_turn
    interrupted = json.dumps({"INTERRUPTED": "사용자가 중단했습니다."}, ensure_ascii=False)
    assert added.content == [
        {"role": "tool", "tool_name": "get_today", "content": interrupted},
        {"role": "tool", "tool_name": "get_my_profile", "content": interrupted},
    ]
    assert provider.calls[1]["history"] == [
        *saved[0].content,
        *saved[1].content,
        *added.content,
        *saved[3].content,
    ]


def test_closing_mid_round_discards_unfinished_response(auth_client, use_provider, db):
    provider = use_provider([FakeRound(texts=["반", "쯤"])])
    created = create_conversation(auth_client)
    conversation = db.get(ChatConversation, UUID(created["id"]))
    turn = run_turn(_ctx(db), provider, conversation, "질문")
    assert next(turn).event == "message_start"
    assert next(turn).event == "text_delta"
    turn.close()
    assert [r.kind for r in rows(db, conversation.id)] == ["question"]


def test_first_question_fills_title(auth_client, use_provider, db):
    use_provider([FakeRound(texts=["답"]), FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    assert conversation["title"] == "새 대화"
    long_question = "가" * 40
    send_events(auth_client, conversation["id"], f"  {long_question}  ")
    send_events(auth_client, conversation["id"], "두 번째 질문")
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assert detail["conversation"]["title"] == "가" * 30
    assert detail["conversation"]["lastMessageAt"] is not None


def test_explicit_title_is_kept(auth_client, use_provider):
    use_provider([FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client, title="  내 상담  ")
    assert conversation["title"] == "내 상담"
    send_events(auth_client, conversation["id"], "질문")
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assert detail["conversation"]["title"] == "내 상담"


@pytest.mark.parametrize(
    "card,kept",
    [
        ({"type": "link", "title": "배분", "href": "/allocation"}, True),
        ({"type": "link", "title": "외부", "href": "https://example.com"}, False),
        ({"type": "link", "title": "외부", "href": "//example.com"}, False),
        ({"type": "table", "title": "표", "columns": [], "rows": []}, True),
        ({"title": "타입 없음"}, False),
    ],
)
def test_cards_allow_only_internal_links(card, kept):
    assert (agent._safe_card(card) is not None) is kept
