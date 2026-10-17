"""공급자 중립 챗봇 인터페이스(스펙 09 5.1)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal, Protocol

from app.integrations.llm.status import get_ai_status
from app.integrations.llm.types import Effort
from app.modules.chat.tools.registry import ToolSpec


@dataclass(frozen=True)
class ToolCall:
    id: str  # Gemini는 응답의 id, Ollama는 "call_{라운드 번호}_{순번}"을 만든다
    name: str
    arguments: dict


@dataclass(frozen=True)
class ToolExecResult:
    call: ToolCall
    content: str  # 모델에 보낼 JSON 문자열(json.dumps(ensure_ascii=False, sort_keys=True))
    is_error: bool


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class RoundResult:
    stop: Literal["end", "tool_use", "max_tokens", "refused"]
    text: str
    tool_calls: list[ToolCall]
    items: list[dict]  # 저장하고 다시 보낼 공급자 원본 항목(refused면 빈 배열)
    usage: dict  # {"inputTokens", "outputTokens", "cachedInputTokens"}
    model: str


class ProviderUnavailable(Exception):
    """메시지는 화면에 보일 한국어 문장이다."""


class ChatProvider(Protocol):
    name: Literal["gemini", "ollama"]
    model: str

    def user_items(self, text: str) -> list[dict]: ...

    def run_round(
        self,
        *,
        system: str,
        history: list[dict],
        tools: list[ToolSpec],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[TextDelta | RoundResult]:
        """마지막 값은 항상 RoundResult 하나다."""
        ...

    def tool_result_items(self, results: list[ToolExecResult]) -> list[dict]: ...


# architecture 9.1.4·9.1.5와 같은 문장
CONNECT_FAILED_MESSAGE = (
    "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요."
)
MODEL_MISSING_MESSAGE = "로컬 AI 모델이 없습니다. 서버에서 ollama pull로 모델을 받아 주세요."
NO_RESPONSE_MESSAGE = "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."

# 도구 오류 결과 내용(5.4). 모델에 보내는 JSON 문자열이다.
TOOL_FAILED_MESSAGE = "도구 실행 중 오류가 발생했습니다."
INTERRUPTED_MESSAGE = "사용자가 중단했습니다."
ERROR_KEYS = ("INVALID_INPUT", "INTERRUPTED")


def to_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def tool_failed_content() -> str:
    return to_json(TOOL_FAILED_MESSAGE)


def invalid_input_content(summary: str) -> str:
    return to_json({"INVALID_INPUT": summary})


def interrupted_content() -> str:
    return to_json({"INTERRUPTED": INTERRUPTED_MESSAGE})


def is_error_content(content: str) -> bool:
    """위 세 가지 오류 결과 형식인지 본다(Ollama 결과 항목에는 오류 표시가 없다)."""
    try:
        value = json.loads(content)
    except ValueError:
        return False
    if value == TOOL_FAILED_MESSAGE:
        return True
    return isinstance(value, dict) and len(value) == 1 and next(iter(value)) in ERROR_KEYS


def empty_usage() -> dict:
    return {"inputTokens": 0, "outputTokens": 0, "cachedInputTokens": 0}


def get_chat_provider() -> ChatProvider | None:
    """FastAPI 의존성. personal 공급자가 꺼져 있으면 None, 켜져 있으면 그 공급자의 어댑터.

    personal 등급만 쓴다. Gemini는 get_ai_status()가 결제 조건(GEMINI_BILLING_ENABLED)을
    확인해 켠 경우에만 고른다. 다른 공급자로 자동 전환하지 않는다.
    """
    status = get_ai_status().personal
    if not status.enabled:
        return None
    if status.provider == "gemini":
        from app.modules.chat.providers.gemini import GeminiChatProvider

        return GeminiChatProvider()
    from app.modules.chat.providers.ollama_provider import OllamaChatProvider

    return OllamaChatProvider()


def _codec(provider: str):
    if provider == "gemini":
        from app.modules.chat.providers import gemini

        return gemini
    from app.modules.chat.providers import ollama_provider

    return ollama_provider


def display_parts(provider: str, items: list[dict]) -> tuple[str, list[str]]:
    """저장된 항목에서 화면용 텍스트와 도구 이름 목록을 뽑는다(공급자가 바뀐 이전 대화에도 쓴다)."""
    return _codec(provider).display_parts(items)


def question_text(provider: str, items: list[dict]) -> str:
    """question 행 항목에서 사용자가 보낸 글을 꺼낸다."""
    return _codec(provider).question_text(items)


def stored_tool_calls(provider: str, items: list[dict]) -> list[ToolCall]:
    """response 행 항목의 도구 호출(끊긴 도구 호출 복구용)."""
    return _codec(provider).stored_tool_calls(items)


def tool_result_errors(
    provider: str, response_items: list[dict], result_items: list[dict]
) -> list[bool | None]:
    """response 행의 호출마다 바로 뒤 tool_results 행의 오류 여부. 결과가 없으면 None"""
    return _codec(provider).tool_result_errors(response_items, result_items)
