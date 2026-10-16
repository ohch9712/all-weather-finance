"""Ollama 대화 어댑터(스펙 09 5.3). 글자 단위로 흘린다.

호출 형태 출처: docs/architecture.md 9.1.5·11절, ollama 0.6.3 `Client.chat(stream=True)`
(`ollama/_client.py`, `ollama/_types.py`의 `ChatResponse`·`Message.ToolCall`).
스트리밍 요청은 연결 실패를 `httpx.ConnectError`로 그대로 던지므로
(`_client.py` `_request`의 `inner`) `ConnectionError`와 함께 잡는다.
"""

import logging
from collections.abc import Iterator

import httpx
import ollama

from app.core.config import Settings, get_settings
from app.integrations.llm.clients import get_ollama_client
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.types import Effort
from app.modules.chat.providers.base import (
    CONNECT_FAILED_MESSAGE,
    MODEL_MISSING_MESSAGE,
    NO_RESPONSE_MESSAGE,
    ProviderUnavailable,
    RoundResult,
    TextDelta,
    ToolCall,
    ToolExecResult,
    empty_usage,
    is_error_content,
)
from app.modules.chat.tools.registry import ToolSpec

logger = logging.getLogger(__name__)


class OllamaChatProvider:
    name = "ollama"

    def __init__(self, client=None, settings: Settings | None = None):
        self.settings = settings if settings is not None else get_settings()
        self.client = client if client is not None else get_ollama_client()
        self.model = self.settings.ollama_model
        # 도구 호출 id의 라운드 번호. 어댑터는 요청마다 새로 만든다.
        self._round = 0

    def user_items(self, text: str) -> list[dict]:
        return [{"role": "user", "content": text}]

    def run_round(
        self,
        *,
        system: str,
        history: list[dict],
        tools: list[ToolSpec],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[TextDelta | RoundResult]:
        round_no = self._round
        self._round += 1
        texts: list[str] = []
        calls: list = []
        done_reason = None
        usage = empty_usage()
        model = self.model
        try:
            stream = self.client.chat(
                model=self.settings.ollama_model,
                messages=[{"role": "system", "content": system}, *history],
                tools=[
                    {
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": portable_json_schema(tool.input_model),
                        },
                    }
                    for tool in tools
                ],
                stream=True,
                think=(effort != "low") if self.settings.ollama_thinking else None,
                options={"num_predict": max_tokens, "num_ctx": self.settings.ollama_num_ctx},
            )
            for chunk in stream:
                # 사고 내용(message.thinking)은 흘리지도, 저장하지도 않는다.
                if chunk.message.content:
                    texts.append(chunk.message.content)
                    yield TextDelta(chunk.message.content)
                if chunk.message.tool_calls:
                    calls.extend(chunk.message.tool_calls)
                if chunk.done:
                    done_reason = chunk.done_reason
                    usage = {
                        "inputTokens": chunk.prompt_eval_count or 0,
                        "outputTokens": chunk.eval_count or 0,
                        "cachedInputTokens": 0,
                    }
                    model = chunk.model or model
        except (ConnectionError, httpx.ConnectError) as exc:
            logger.warning("챗봇 로컬 AI 연결 실패: %s", type(exc).__name__)
            raise ProviderUnavailable(CONNECT_FAILED_MESSAGE) from exc
        except ollama.ResponseError as exc:
            logger.warning("챗봇 로컬 AI 오류: %s status=%s", type(exc).__name__, exc.status_code)
            if exc.status_code == 404:
                raise ProviderUnavailable(MODEL_MISSING_MESSAGE) from exc
            raise ProviderUnavailable(NO_RESPONSE_MESSAGE) from exc
        except Exception as exc:
            logger.warning(
                "챗봇 로컬 AI 오류: %s status=%s",
                type(exc).__name__,
                getattr(exc, "status_code", None),
            )
            raise ProviderUnavailable(NO_RESPONSE_MESSAGE) from exc

        text = "".join(texts)
        tool_calls = [
            ToolCall(
                id=f"call_{round_no}_{index}",
                name=call.function.name,
                arguments=dict(call.function.arguments),
            )
            for index, call in enumerate(calls)
        ]
        item: dict = {"role": "assistant", "content": text}
        if tool_calls:
            item["tool_calls"] = [
                {"function": {"name": call.name, "arguments": call.arguments}}
                for call in tool_calls
            ]
        if done_reason == "length":
            stop = "max_tokens"
        elif tool_calls:
            stop = "tool_use"
        else:
            stop = "end"
        yield RoundResult(stop, text, tool_calls, [item], usage, model)

    def tool_result_items(self, results: list[ToolExecResult]) -> list[dict]:
        return [
            {"role": "tool", "tool_name": result.call.name, "content": result.content}
            for result in results
        ]


# ── 저장 항목 해석(화면·기록 복구용) ─────────────────────────────────────


def _calls(items: list[dict]) -> list[dict]:
    return [
        call
        for item in items
        if item.get("role") == "assistant"
        for call in item.get("tool_calls") or []
    ]


def display_parts(items: list[dict]) -> tuple[str, list[str]]:
    text = "".join(item.get("content") or "" for item in items if item.get("role") == "assistant")
    names = [(call.get("function") or {}).get("name", "") for call in _calls(items)]
    return text, names


def question_text(items: list[dict]) -> str:
    return "".join(item.get("content") or "" for item in items if item.get("role") == "user")


def stored_tool_calls(items: list[dict]) -> list[ToolCall]:
    return [
        ToolCall(
            id=f"call_stored_{index}",
            name=(call.get("function") or {}).get("name", ""),
            arguments=(call.get("function") or {}).get("arguments") or {},
        )
        for index, call in enumerate(_calls(items))
    ]


def tool_result_errors(response_items: list[dict], result_items: list[dict]) -> list[bool | None]:
    """Ollama 결과 항목에는 오류 표시가 없어 순서대로 짝짓고 오류 내용 형식으로 판별한다."""
    results = [item for item in result_items if item.get("role") == "tool"]
    return [
        is_error_content(results[index].get("content") or "") if index < len(results) else None
        for index in range(len(_calls(response_items)))
    ]
