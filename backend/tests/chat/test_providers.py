"""공급자 어댑터(스펙 09 5.2·5.3). SDK 클라이언트 자리에 가짜 객체를 넣는다."""

from unittest.mock import Mock

import httpx
import ollama
import pytest
from google.genai.interactions import Interaction
from ollama import ChatResponse

from app.core.config import Settings
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.status import get_ai_status
from app.modules.chat.providers import base
from app.modules.chat.providers.base import (
    ProviderUnavailable,
    RoundResult,
    TextDelta,
    ToolCall,
    ToolExecResult,
    display_parts,
    get_chat_provider,
)
from app.modules.chat.providers.gemini import GeminiChatProvider
from app.modules.chat.providers.ollama_provider import OllamaChatProvider
from app.modules.chat.tools.registry import get_registered_tools
from tests.chat.conftest import ALL_TOOL_NAMES


@pytest.fixture
def settings():
    return Settings(
        gemini_api_key="fake-key",
        gemini_billing_enabled=True,
        llm_personal_provider="ollama",
        gemini_model="test-gemini-model",
        ollama_model="test-ollama-model",
        ollama_num_ctx=4096,
    )


def run(provider, history=None, effort="medium", max_tokens=8000):
    events = list(
        provider.run_round(
            system="시스템",
            history=history or [],
            tools=get_registered_tools(),
            effort=effort,
            max_tokens=max_tokens,
        )
    )
    assert isinstance(events[-1], RoundResult)
    assert all(isinstance(event, TextDelta) for event in events[:-1])
    return [event.text for event in events[:-1]], events[-1]


# ── Gemini ──────────────────────────────────────────────────────────────


def gemini_client(**interaction):
    client = Mock()
    client.interactions.create.return_value = Interaction.model_validate(
        {"id": "i-1", "status": "completed", **interaction}
    )
    return client


GEMINI_STEPS = [
    {"type": "user_input", "content": [{"type": "text", "text": "질문"}]},
    {"type": "thought", "signature": "c2lnbmF0dXJl", "summary": [{"type": "text", "text": "생각"}]},
    {"type": "model_output", "content": [{"type": "text", "text": "확인할게요."}]},
    {"type": "function_call", "id": "fc_1", "name": "get_my_profile", "arguments": {}},
    {"type": "function_result", "call_id": "old", "result": [{"type": "text", "text": "{}"}]},
]


def test_gemini_call_arguments(settings):
    client = gemini_client(
        steps=[{"type": "model_output", "content": [{"type": "text", "text": "안녕"}]}]
    )
    provider = GeminiChatProvider(client, settings)
    history = provider.user_items("안녕")
    assert history == [{"type": "user_input", "content": [{"type": "text", "text": "안녕"}]}]
    run(provider, history, effort="medium", max_tokens=8000)
    args = client.interactions.create.call_args.kwargs
    assert args["model"] == "test-gemini-model"
    assert args["store"] is False
    assert args["system_instruction"] == "시스템"
    assert args["input"] == history
    assert args["tools"] == [
        {
            "type": "function",
            "name": tool.name,
            "description": tool.description,
            "parameters": portable_json_schema(tool.input_model),
        }
        for tool in get_registered_tools()
    ]
    assert [tool["name"] for tool in args["tools"]] == ALL_TOOL_NAMES
    assert args["generation_config"] == {
        "thinking_level": "medium",
        "max_output_tokens": 8000,
        "tool_choice": "auto",
    }
    # 강제 도구 호출·사용 중단 파라미터를 보내지 않는다.
    assert set(args) == {
        "model",
        "store",
        "system_instruction",
        "input",
        "tools",
        "generation_config",
    }


def test_gemini_steps_to_items_and_tool_calls(settings):
    client = gemini_client(
        status="requires_action",
        model="test-gemini-model",
        steps=GEMINI_STEPS,
        usage={"total_input_tokens": 120, "total_output_tokens": 30, "total_cached_tokens": 100},
    )
    texts, result = run(GeminiChatProvider(client, settings))
    assert texts == ["확인할게요."]
    assert result.stop == "tool_use"
    assert result.text == "확인할게요."
    assert result.tool_calls == [ToolCall(id="fc_1", name="get_my_profile", arguments={})]
    # user_input·function_result는 저장하지 않고, thought의 signature는 보존한다.
    assert result.items == [
        {
            "type": "thought",
            "signature": "c2lnbmF0dXJl",
            "summary": [{"type": "text", "text": "생각"}],
        },
        {"type": "model_output", "content": [{"type": "text", "text": "확인할게요."}]},
        {"type": "function_call", "id": "fc_1", "name": "get_my_profile", "arguments": {}},
    ]
    assert result.usage == {"inputTokens": 120, "outputTokens": 30, "cachedInputTokens": 100}
    assert result.model == "test-gemini-model"


def test_gemini_completed_and_incomplete(settings):
    steps = [{"type": "model_output", "content": [{"type": "text", "text": "끝"}]}]
    texts, result = run(GeminiChatProvider(gemini_client(steps=steps), settings))
    assert (texts, result.stop, result.usage) == (
        ["끝"],
        "end",
        {"inputTokens": 0, "outputTokens": 0, "cachedInputTokens": 0},
    )
    steps_with_call = [*steps, GEMINI_STEPS[3]]
    client = gemini_client(status="incomplete", steps=steps_with_call)
    _, result = run(GeminiChatProvider(client, settings))
    assert result.stop == "max_tokens"  # incomplete가 도구 호출보다 먼저다
    _, result = run(GeminiChatProvider(gemini_client(steps=[]), settings))
    assert (result.stop, result.text, result.items) == ("end", "", [])


@pytest.mark.parametrize("status", ["failed", "cancelled", "in_progress"])
def test_gemini_other_status_is_unavailable(settings, status):
    client = gemini_client(status=status, steps=[])
    with pytest.raises(ProviderUnavailable) as exc:
        run(GeminiChatProvider(client, settings))
    assert str(exc.value) == "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."


@pytest.mark.parametrize("nested", [True, False])
@pytest.mark.parametrize("code", ["safety", "jailbreak", "prohibited_content", "blocklist"])
def test_gemini_safety_block_is_refused(settings, code, nested):
    class SDKError(Exception):
        status_code = 400
        body = {"error": {"code": code}} if nested else {"code": code}

    client = Mock()
    client.interactions.create.side_effect = SDKError("비공개 원문")
    texts, result = run(GeminiChatProvider(client, settings))
    assert texts == []
    assert (result.stop, result.items, result.tool_calls) == ("refused", [], [])


@pytest.mark.parametrize(
    "error",
    [
        TimeoutError(),
        type("RateLimit", (Exception,), {"status_code": 429, "body": {}})(),
        type("BadRequest", (Exception,), {"status_code": 400, "body": {"code": "other"}})(),
    ],
)
def test_gemini_sdk_errors_are_unavailable(settings, error, caplog):
    client = Mock()
    client.interactions.create.side_effect = error
    with pytest.raises(ProviderUnavailable):
        run(GeminiChatProvider(client, settings))
    assert "fake-key" not in caplog.text


def test_gemini_tool_result_items(settings):
    provider = GeminiChatProvider(Mock(), settings)
    tool_call = ToolCall("fc_1", "get_today", {})
    assert provider.tool_result_items([ToolExecResult(tool_call, '{"today": "x"}', False)]) == [
        {
            "type": "function_result",
            "call_id": "fc_1",
            "name": "get_today",
            "result": [{"type": "text", "text": '{"today": "x"}'}],
            "is_error": False,
        }
    ]


def test_gemini_display_parts():
    items = [
        {"type": "thought", "signature": "abc"},
        {"type": "model_output", "content": [{"type": "text", "text": "앞"}]},
        {"type": "function_call", "id": "1", "name": "get_today", "arguments": {}},
        {"type": "model_output", "content": [{"type": "text", "text": "뒤"}, {"type": "image"}]},
        {"type": "function_call", "id": "2", "name": "get_my_profile", "arguments": {}},
    ]
    assert display_parts("gemini", items) == ("앞뒤", ["get_today", "get_my_profile"])


# ── Ollama ──────────────────────────────────────────────────────────────


def chunk(content="", *, done=False, tool_calls=None, thinking=None, **extra):
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    if thinking:
        message["thinking"] = thinking
    return ChatResponse(model="test-ollama-model", done=done, message=message, **extra)


def ollama_client(chunks):
    client = Mock()
    client.chat.side_effect = lambda **kwargs: iter(chunks)
    return client


@pytest.mark.parametrize(
    "effort,thinking,think",
    [("medium", True, True), ("high", True, True), ("low", True, False), ("medium", False, None)],
)
def test_ollama_call_arguments(settings, effort, thinking, think):
    settings.ollama_thinking = thinking
    client = ollama_client([chunk("안녕", done=True, done_reason="stop")])
    provider = OllamaChatProvider(client, settings)
    history = provider.user_items("안녕")
    assert history == [{"role": "user", "content": "안녕"}]
    run(provider, history, effort=effort, max_tokens=8000)
    args = client.chat.call_args.kwargs
    assert args["model"] == "test-ollama-model"
    assert args["messages"] == [{"role": "system", "content": "시스템"}, *history]
    assert args["tools"] == [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": portable_json_schema(tool.input_model),
            },
        }
        for tool in get_registered_tools()
    ]
    assert [tool["function"]["name"] for tool in args["tools"]] == ALL_TOOL_NAMES
    assert args["stream"] is True
    assert args["think"] is think
    assert args["options"] == {"num_predict": 8000, "num_ctx": 4096}
    assert set(args) == {"model", "messages", "tools", "stream", "think", "options"}


def test_ollama_stream_text_tool_calls_and_ids(settings):
    chunks = [
        chunk(thinking="비밀 생각"),
        chunk("확인"),
        chunk("할게요"),
        chunk(tool_calls=[{"function": {"name": "get_today", "arguments": {}}}]),
        chunk(
            tool_calls=[{"function": {"name": "get_my_profile", "arguments": {"a": 1}}}],
        ),
        chunk(done=True, done_reason="stop", prompt_eval_count=50, eval_count=7),
    ]
    provider = OllamaChatProvider(ollama_client(chunks), settings)
    texts, result = run(provider)
    assert texts == ["확인", "할게요"]
    assert result.stop == "tool_use"
    assert result.text == "확인할게요"
    assert result.tool_calls == [
        ToolCall("call_0_0", "get_today", {}),
        ToolCall("call_0_1", "get_my_profile", {"a": 1}),
    ]
    # 사고 내용은 저장하지 않는다.
    assert result.items == [
        {
            "role": "assistant",
            "content": "확인할게요",
            "tool_calls": [
                {"function": {"name": "get_today", "arguments": {}}},
                {"function": {"name": "get_my_profile", "arguments": {"a": 1}}},
            ],
        }
    ]
    assert "thinking" not in result.items[0]
    assert result.usage == {"inputTokens": 50, "outputTokens": 7, "cachedInputTokens": 0}
    # 다음 라운드는 라운드 번호가 오른다.
    provider.client = ollama_client(
        [chunk(tool_calls=[{"function": {"name": "get_today", "arguments": {}}}], done=True)]
    )
    _, second = run(provider)
    assert second.tool_calls[0].id == "call_1_0"


def test_ollama_end_and_length(settings):
    _, result = run(
        OllamaChatProvider(ollama_client([chunk("끝", done=True, done_reason="stop")]), settings)
    )
    assert result.stop == "end"
    assert result.items == [{"role": "assistant", "content": "끝"}]  # 도구 호출이 없으면 키를 뺀다
    chunks = [
        chunk("긴", tool_calls=[{"function": {"name": "get_today", "arguments": {}}}]),
        chunk(done=True, done_reason="length"),
    ]
    _, result = run(OllamaChatProvider(ollama_client(chunks), settings))
    assert result.stop == "max_tokens"


def failing_stream(error):
    def stream(**kwargs):
        yield chunk("부분")
        raise error

    client = Mock()
    client.chat.side_effect = stream
    return client


@pytest.mark.parametrize(
    "client,message",
    [
        (
            Mock(chat=Mock(side_effect=ConnectionError("Failed to connect"))),
            "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요.",
        ),
        (
            failing_stream(httpx.ConnectError("refused")),
            "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요.",
        ),
        (
            failing_stream(ollama.ResponseError("model not found", 404)),
            "로컬 AI 모델이 없습니다. 서버에서 ollama pull로 모델을 받아 주세요.",
        ),
        (
            failing_stream(ollama.ResponseError("boom", 500)),
            "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ),
        (
            failing_stream(httpx.ReadTimeout("timeout")),
            "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ),
    ],
)
def test_ollama_errors_are_unavailable(settings, client, message):
    provider = OllamaChatProvider(client, settings)
    with pytest.raises(ProviderUnavailable) as exc:
        list(provider.run_round(system="", history=[], tools=[], effort="low", max_tokens=10))
    assert str(exc.value) == message


def test_ollama_tool_result_items(settings):
    provider = OllamaChatProvider(Mock(), settings)
    results = [
        ToolExecResult(ToolCall("call_0_0", "get_today", {}), '{"today": "x"}', False),
        ToolExecResult(ToolCall("call_0_1", "get_my_profile", {}), '"오류"', True),
    ]
    assert provider.tool_result_items(results) == [
        {"role": "tool", "tool_name": "get_today", "content": '{"today": "x"}'},
        {"role": "tool", "tool_name": "get_my_profile", "content": '"오류"'},
    ]


def test_ollama_display_parts():
    items = [
        {
            "role": "assistant",
            "content": "앞",
            "tool_calls": [{"function": {"name": "get_today", "arguments": {}}}],
        },
        {"role": "assistant", "content": "뒤"},
    ]
    assert display_parts("ollama", items) == ("앞뒤", ["get_today"])


# ── 공급자 선택(personal 등급만) ─────────────────────────────────────────


@pytest.mark.parametrize(
    "config,expected",
    [
        ({"llm_personal_provider": "disabled"}, None),
        ({"llm_personal_provider": "ollama"}, OllamaChatProvider),
        # 결제 조건 없이 Gemini로 가지 않는다(다른 공급자로 바꾸지도 않는다).
        (
            {
                "llm_personal_provider": "gemini",
                "gemini_api_key": "k",
                "gemini_billing_enabled": False,
            },
            None,
        ),
        (
            {
                "llm_personal_provider": "gemini",
                "gemini_api_key": "",
                "gemini_billing_enabled": True,
            },
            None,
        ),
        (
            {
                "llm_personal_provider": "gemini",
                "gemini_api_key": "k",
                "gemini_billing_enabled": True,
            },
            GeminiChatProvider,
        ),
        # general 등급 설정은 챗봇에 쓰지 않는다.
        (
            {
                "llm_personal_provider": "disabled",
                "llm_general_provider": "gemini",
                "gemini_api_key": "k",
            },
            None,
        ),
    ],
)
def test_get_chat_provider_uses_personal_scope(monkeypatch, config, expected):
    from app.integrations.llm import status

    settings = Settings(**config)
    monkeypatch.setattr(status, "get_settings", lambda: settings)
    monkeypatch.setattr("app.modules.chat.providers.gemini.get_settings", lambda: settings)
    monkeypatch.setattr("app.modules.chat.providers.gemini.get_gemini_client", Mock)
    monkeypatch.setattr("app.modules.chat.providers.ollama_provider.get_settings", lambda: settings)
    monkeypatch.setattr("app.modules.chat.providers.ollama_provider.get_ollama_client", Mock)
    provider = get_chat_provider()
    if expected is None:
        assert provider is None
        assert get_ai_status().personal.enabled is False
    else:
        assert isinstance(provider, expected)
        assert provider.name == get_ai_status().personal.provider
        assert provider.model == get_ai_status().personal.model


def test_error_content_detection():
    assert base.is_error_content(base.tool_failed_content())
    assert base.is_error_content(base.interrupted_content())
    assert base.is_error_content(base.invalid_input_content("x: 필수"))
    assert not base.is_error_content('{"today": "2026-10-16"}')
    assert not base.is_error_content("not json")
