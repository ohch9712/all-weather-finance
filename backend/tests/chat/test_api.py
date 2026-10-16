"""챗봇 API 계약(스펙 09 5.5·5.7·8절)."""

import asyncio
import threading
import time
from datetime import date, datetime, timedelta
from uuid import UUID, uuid4

import pytest

from app.core.time import KST, now_utc
from app.modules.chat import service, sse
from app.modules.chat.agent import SseEvent
from app.modules.chat.models import ChatMessage
from app.modules.chat.sse import format_event, sse_body
from tests.chat.conftest import (
    MODEL,
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

# ── 상태 ────────────────────────────────────────────────────────────────


def test_status(auth_client, use_provider):
    use_provider([FakeRound(texts=["답"])])
    expected = {
        "enabled": True,
        "provider": "ollama",
        "location": "local",
        "model": MODEL,
        "dailyLimit": 100,
        "usedToday": 0,
    }
    assert auth_client.get("/api/chat/status").json() == expected
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"])
    assert auth_client.get("/api/chat/status").json()["usedToday"] == 1


def test_status_when_disabled(auth_client, chat_settings):
    chat_settings.llm_personal_provider = "disabled"
    assert auth_client.get("/api/chat/status").json() == {
        "enabled": False,
        "provider": None,
        "location": None,
        "model": None,
        "dailyLimit": 100,
        "usedToday": 0,
    }


def test_status_gemini_requires_billing(auth_client, chat_settings):
    chat_settings.llm_personal_provider = "gemini"
    chat_settings.gemini_api_key = "fake-key"
    assert auth_client.get("/api/chat/status").json()["enabled"] is False
    enable_gemini(chat_settings)
    status = auth_client.get("/api/chat/status").json()
    assert (status["enabled"], status["provider"], status["location"]) == (True, "gemini", "cloud")
    assert status["model"] == "gemini-3.8-flash"


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/chat/status"),
        ("get", "/api/chat/conversations"),
        ("post", "/api/chat/conversations"),
        ("get", f"/api/chat/conversations/{uuid4()}"),
        ("delete", f"/api/chat/conversations/{uuid4()}"),
        ("post", f"/api/chat/conversations/{uuid4()}/messages"),
    ],
)
def test_requires_login(client, method, path):
    kwargs = {"json": {"content": "안녕"}} if method == "post" else {}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


# ── 대화 CRUD ───────────────────────────────────────────────────────────


def test_create_conversation(auth_client, chat_settings):
    response = auth_client.post("/api/chat/conversations")  # 본문 없음
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {
        "id",
        "title",
        "provider",
        "model",
        "canContinue",
        "lastMessageAt",
        "createdAt",
    }
    assert body["title"] == "새 대화" and body["provider"] == "ollama" and body["model"] == MODEL
    assert body["canContinue"] is True and body["lastMessageAt"] is None
    assert body["createdAt"].endswith("Z") or "+00:00" in body["createdAt"]
    titled = create_conversation(auth_client, title="연금 상담")
    assert titled["title"] == "연금 상담"


def test_create_conversation_validation(auth_client, chat_settings):
    too_long = auth_client.post("/api/chat/conversations", json={"title": "가" * 101})
    assert too_long.status_code == 422
    assert too_long.json()["error"]["details"][0]["field"] == "title"
    not_json = auth_client.post(
        "/api/chat/conversations", content="title=x", headers={"Content-Type": "text/plain"}
    )
    assert not_json.status_code == 422
    broken = auth_client.post(
        "/api/chat/conversations", content="{", headers={"Content-Type": "application/json"}
    )
    assert broken.status_code == 422


def test_create_conversation_when_provider_off(auth_client, chat_settings):
    chat_settings.llm_personal_provider = "disabled"
    response = auth_client.post("/api/chat/conversations")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"
    # 결제 조건 없는 Gemini도 꺼진 것으로 본다.
    chat_settings.llm_personal_provider = "gemini"
    chat_settings.gemini_api_key = "fake-key"
    assert auth_client.post("/api/chat/conversations").status_code == 503


def test_list_conversations_recent_first_and_paged(auth_client, use_provider):
    use_provider([FakeRound(texts=["답"])])
    first = create_conversation(auth_client, title="첫째")
    second = create_conversation(auth_client, title="둘째")
    third = create_conversation(auth_client, title="셋째")
    send_events(auth_client, first["id"])  # 메시지를 보낸 대화가 맨 위로
    page = auth_client.get("/api/chat/conversations?page=1&pageSize=2").json()
    assert page["page"] == 1 and page["pageSize"] == 2 and page["total"] == 3
    assert [item["id"] for item in page["items"]] == [first["id"], third["id"]]
    rest = auth_client.get("/api/chat/conversations?page=2&pageSize=2").json()
    assert [item["id"] for item in rest["items"]] == [second["id"]]
    assert auth_client.get("/api/chat/conversations?pageSize=101").status_code == 422


def test_other_user_gets_404(auth_client, other_auth_client, use_provider):
    use_provider([FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    path = f"/api/chat/conversations/{conversation['id']}"
    assert other_auth_client.get(path).status_code == 404
    assert other_auth_client.get(path).json()["error"]["code"] == "NOT_FOUND"
    assert other_auth_client.delete(path).status_code == 404
    response = send(other_auth_client, conversation["id"])
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert other_auth_client.get("/api/chat/conversations").json()["total"] == 0
    # 원래 사용자는 그대로 쓴다.
    assert auth_client.get(path).status_code == 200
    assert send(auth_client, conversation["id"]).status_code == 200


def test_delete_conversation(auth_client, use_provider, db):
    use_provider([FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"])
    path = f"/api/chat/conversations/{conversation['id']}"
    response = auth_client.delete(path)
    assert response.status_code == 204 and response.content == b""
    assert auth_client.get(path).status_code == 404
    assert rows(db, UUID(conversation["id"])) == []
    assert auth_client.delete(path).status_code == 404


def test_unknown_conversation_is_404(auth_client, use_provider):
    use_provider([])
    assert auth_client.get(f"/api/chat/conversations/{uuid4()}").status_code == 404
    assert send(auth_client, str(uuid4())).status_code == 404


# ── 상세(DisplayMessage) ─────────────────────────────────────────────────


def test_detail_merges_turn_into_display_messages(auth_client, use_provider):
    use_provider(
        [
            FakeRound(texts=["확인할게요."], stop="tool_use", tool_calls=[call("get_my_profile")]),
            FakeRound(
                stop="tool_use", tool_calls=[call("get_today"), call("get_today", {"bad": 1})]
            ),
            FakeRound(texts=["30대예요."]),
        ]
    )
    conversation = create_conversation(auth_client)
    events = send_events(auth_client, conversation["id"], "내 나이대 알려줘")
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assert detail["conversation"]["id"] == conversation["id"]
    user, assistant = detail["messages"]
    assert set(user) == {"id", "turnId", "role", "text", "toolCalls", "cards", "createdAt"}
    assert user["role"] == "user" and user["text"] == "내 나이대 알려줘"
    assert user["id"] == events[0][1]["questionMessageId"]
    assert assistant["role"] == "assistant" and assistant["turnId"] == user["turnId"]
    assert assistant["id"] == events[-1][1]["messageId"]
    assert assistant["text"] == "확인할게요.\n\n30대예요."
    assert assistant["toolCalls"] == [
        {"name": "get_my_profile", "label": "프로필 확인 중", "ok": True},
        {"name": "get_today", "label": "오늘 날짜 확인 중", "ok": True},
        {"name": "get_today", "label": "오늘 날짜 확인 중", "ok": False},
    ]
    assert [card["type"] for card in assistant["cards"]] == ["key_value"]
    assert assistant["cards"][0]["title"] == "내 프로필"


def test_detail_gemini_format(auth_client, use_provider, chat_settings):
    enable_gemini(chat_settings)
    use_provider(
        [
            FakeRound(texts=["볼게요"], stop="tool_use", tool_calls=[call("get_today", {"x": 1})]),
            FakeRound(texts=["오늘은 금요일"]),
        ],
        name="gemini",
        model="gemini-3.8-flash",
    )
    conversation = create_conversation(auth_client)
    assert conversation["provider"] == "gemini"
    send_events(auth_client, conversation["id"], "오늘 무슨 요일?")
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    user, assistant = detail["messages"]
    assert user["text"] == "오늘 무슨 요일?"
    assert assistant["text"] == "볼게요\n\n오늘은 금요일"
    assert assistant["toolCalls"] == [
        {"name": "get_today", "label": "오늘 날짜 확인 중", "ok": False}
    ]


def test_detail_after_provider_change_still_readable(auth_client, use_provider, chat_settings):
    use_provider([FakeRound(texts=["로컬 답"])])
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"], "질문")
    enable_gemini(chat_settings)  # 설정이 Gemini로 바뀌었다
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assert detail["conversation"]["canContinue"] is False
    assert [m["text"] for m in detail["messages"]] == ["질문", "로컬 답"]
    listed = auth_client.get("/api/chat/conversations").json()["items"][0]
    assert listed["canContinue"] is False


def test_detail_shows_unanswered_question_without_assistant(auth_client, use_provider):
    use_provider([unavailable()])
    conversation = create_conversation(auth_client)
    send_events(auth_client, conversation["id"], "답 없는 질문")
    detail = auth_client.get(f"/api/chat/conversations/{conversation['id']}").json()
    assert [(m["role"], m["text"]) for m in detail["messages"]] == [("user", "답 없는 질문")]


# ── 공급자 묶음 ─────────────────────────────────────────────────────────


def test_can_continue_rules(auth_client, use_provider, chat_settings):
    use_provider([])
    conversation = create_conversation(auth_client)
    path = f"/api/chat/conversations/{conversation['id']}"
    assert auth_client.get(path).json()["conversation"]["canContinue"] is True
    chat_settings.ollama_model = "gemma4:e4b"  # 모델만 바뀜
    assert auth_client.get(path).json()["conversation"]["canContinue"] is False
    chat_settings.ollama_model = MODEL
    chat_settings.llm_personal_provider = "disabled"  # 꺼짐
    assert auth_client.get(path).json()["conversation"]["canContinue"] is False


@pytest.mark.parametrize("name,model", [("gemini", "gemini-3.8-flash"), ("ollama", "gemma4:e4b")])
def test_send_to_changed_provider_is_409(auth_client, use_provider, db, name, model):
    use_provider([])
    conversation = create_conversation(auth_client)
    use_provider([FakeRound(texts=["답"])], name=name, model=model)
    response = send(auth_client, conversation["id"])
    assert response.status_code == 409
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"] == {
        "code": "CHAT_PROVIDER_CHANGED",
        "message": "AI 설정이 바뀌어 이 대화는 이어 갈 수 없어요. 새 대화를 시작해 주세요.",
        "details": [],
    }
    assert rows(db, UUID(conversation["id"])) == []


def test_send_when_provider_off_is_503(auth_client, use_provider, app, db):
    use_provider([])
    conversation = create_conversation(auth_client)
    from app.modules.chat.providers.base import get_chat_provider

    app.dependency_overrides[get_chat_provider] = lambda: None
    response = send(auth_client, conversation["id"])
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"]["code"] == "LLM_UNAVAILABLE"
    assert rows(db, UUID(conversation["id"])) == []


# ── 상한·길이 ───────────────────────────────────────────────────────────


def _add_rows(db, conversation_id, user_id, count, *, created_at=None):
    turn = uuid4()
    for seq in range(count):
        db.add(
            ChatMessage(
                conversation_id=conversation_id,
                user_id=user_id,
                seq=seq,
                turn_id=turn,
                role="user" if seq % 2 == 0 else "assistant",
                kind="question" if seq % 2 == 0 else "response",
                content=[{"role": "user" if seq % 2 == 0 else "assistant", "content": "x"}],
                created_at=created_at or now_utc(),
            )
        )
    db.commit()


def test_daily_limit(auth_client, use_provider, chat_settings, db):
    chat_settings.chat_daily_message_limit = 2
    use_provider([FakeRound(texts=["답"]), FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    other = create_conversation(auth_client)
    user = user_by_email(db)
    # 어제(KST) 질문은 세지 않는다.
    yesterday = datetime.combine(date.today(), datetime.min.time(), tzinfo=KST) - timedelta(days=1)
    _add_rows(db, UUID(other["id"]), user.id, 2, created_at=yesterday)
    send_events(auth_client, conversation["id"])
    send_events(auth_client, conversation["id"])
    response = send(auth_client, conversation["id"])
    assert response.status_code == 429
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["error"] == {
        "code": "CHAT_LIMIT_EXCEEDED",
        "message": "오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요.",
        "details": [],
    }
    status = auth_client.get("/api/chat/status").json()
    assert (status["dailyLimit"], status["usedToday"]) == (2, 2)


def test_daily_limit_counts_kst_day(monkeypatch):
    monkeypatch.setattr(service, "today_kst", lambda: date(2026, 10, 16))
    start, end = service._today_bounds()
    assert start.isoformat() == "2026-10-16T00:00:00+09:00"
    assert end - start == timedelta(days=1)


def test_daily_limit_is_per_user(auth_client, other_auth_client, use_provider, chat_settings):
    chat_settings.chat_daily_message_limit = 1
    use_provider([FakeRound(texts=["답"]), FakeRound(texts=["답"])])
    mine = create_conversation(auth_client)
    send_events(auth_client, mine["id"])
    theirs = create_conversation(other_auth_client)
    assert send(other_auth_client, theirs["id"]).status_code == 200


def test_conversation_over_200_rows_is_409(auth_client, use_provider, db):
    use_provider([FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    user = user_by_email(db)
    # 하루 상한과 섞이지 않게 지난 행으로 채운다.
    _add_rows(db, UUID(conversation["id"]), user.id, 200, created_at=now_utc() - timedelta(days=2))
    # 200행까지는 이어 갈 수 있다.
    assert send(auth_client, conversation["id"]).status_code == 200
    response = send(auth_client, conversation["id"])
    assert len(rows(db, UUID(conversation["id"]))) == 202
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "CONFLICT",
        "message": "대화가 길어졌어요. 새 대화를 시작해 주세요.",
        "details": [],
    }


@pytest.mark.parametrize("content", ["", "   ", "가" * 4001])
def test_message_content_validation(auth_client, use_provider, content):
    use_provider([])
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"], content)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "content"


def test_message_content_is_trimmed_and_4000_allowed(auth_client, use_provider, db):
    provider = use_provider([FakeRound(texts=["답"])])
    conversation = create_conversation(auth_client)
    text = "가" * 4000
    assert send(auth_client, conversation["id"], f"  {text}\n").status_code == 200
    assert provider.calls[0]["history"] == [{"role": "user", "content": text}]


def test_message_requires_json(auth_client, use_provider):
    use_provider([])
    conversation = create_conversation(auth_client)
    response = auth_client.post(
        f"/api/chat/conversations/{conversation['id']}/messages",
        content='{"content": "안녕"}',
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 422


# ── SSE ─────────────────────────────────────────────────────────────────


def test_sse_format_and_headers(auth_client, use_provider):
    use_provider(
        [
            FakeRound(texts=["줄\n바꿈"], stop="tool_use", tool_calls=[call("get_today")]),
            FakeRound(texts=["끝"]),
        ]
    )
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"])
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    blocks = response.text.split("\n\n")
    assert blocks[0].startswith("event: message_start\ndata: {")
    assert blocks[1] == 'event: text_delta\ndata: {"text": "줄\\n바꿈"}'
    events, pings = parse_sse(response.text)
    assert pings == 0
    assert names(events) == [
        "message_start",
        "text_delta",
        "tool_start",
        "tool_end",
        "text_delta",
        "message_end",
    ]
    fields = {name: set(data) for name, data in events}
    assert fields == {
        "message_start": {"conversationId", "turnId", "questionMessageId", "provider", "model"},
        "text_delta": {"text"},
        "tool_start": {"toolUseId", "name", "label"},
        "tool_end": {"toolUseId", "name", "ok", "card"},
        "message_end": {"messageId", "stopReason", "model", "usage"},
    }
    assert set(events[-1][1]["usage"]) == {"inputTokens", "outputTokens", "cachedInputTokens"}


def test_sse_error_event_ends_stream(auth_client, use_provider):
    use_provider(
        [unavailable("로컬 AI 모델이 없습니다. 서버에서 ollama pull로 모델을 받아 주세요.")]
    )
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"])
    assert response.status_code == 200
    assert response.text.endswith(
        'event: error\ndata: {"code": "LLM_UNAVAILABLE", "message": '
        '"로컬 AI 모델이 없습니다. 서버에서 ollama pull로 모델을 받아 주세요."}\n\n'
    )


def test_sse_unexpected_exception_is_internal_error(auth_client, use_provider, caplog):
    use_provider([FakeRound(raises=RuntimeError("비공개 내부 오류"))])
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"])
    events, _ = parse_sse(response.text)
    assert events[-1] == (
        "error",
        {
            "code": "INTERNAL_ERROR",
            "message": "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        },
    )
    assert "비공개 내부 오류" not in response.text


def test_sse_ping_while_waiting(auth_client, use_provider, monkeypatch):
    # 시간 조작: ping 간격을 줄이고 공급자가 느리게 답하게 한다.
    monkeypatch.setattr(sse, "PING_INTERVAL_SECONDS", 0.02)
    use_provider([FakeRound(texts=["느린 답"], delay=0.2)])
    conversation = create_conversation(auth_client)
    response = send(auth_client, conversation["id"])
    events, pings = parse_sse(response.text)
    assert pings >= 2
    assert names(events) == ["message_start", "text_delta", "message_end"]
    head = response.text.split("event: text_delta")[0]
    assert ": ping\n\n" in head  # 응답을 기다리는 동안 보냈다


def test_ping_constant_is_15_seconds():
    assert sse.PING_INTERVAL_SECONDS == 15.0
    assert sse.PING == ": ping\n\n"


def test_format_event():
    assert (
        format_event(SseEvent("text_delta", {"text": "현재 "}))
        == 'event: text_delta\ndata: {"text": "현재 "}\n\n'
    )


def test_sse_body_stops_turn_when_client_disconnects():
    closed = threading.Event()
    after_disconnect = []

    def events():
        try:
            yield SseEvent("message_start", {})
            time.sleep(0.05)
            yield SseEvent("text_delta", {"text": "a"})
            after_disconnect.append(True)
            yield SseEvent("text_delta", {"text": "b"})
        finally:
            closed.set()

    async def consume_first_then_disconnect():
        body = sse_body(events())
        first = await body.__anext__()
        await body.aclose()  # 클라이언트 연결 끊김
        return first

    first = asyncio.run(consume_first_then_disconnect())
    assert first.startswith("event: message_start")
    assert closed.is_set()  # 루프 제너레이터를 닫았다
    assert after_disconnect == []
