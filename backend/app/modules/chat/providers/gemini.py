"""Gemini 대화 어댑터(스펙 09 5.2). 라운드 단위로 한 번에 받는다.

호출 형태 출처: docs/architecture.md 9.1.4·11절, google-genai 2.31 Interactions
(`google/genai/_gaos/types/interactions/interaction.py`, `step.py`, `functioncallstep.py`).
"""

import logging
from collections.abc import Iterator

from app.core.config import Settings, get_settings
from app.integrations.llm.clients import get_gemini_client
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.types import Effort
from app.modules.chat.providers.base import (
    NO_RESPONSE_MESSAGE,
    ProviderUnavailable,
    RoundResult,
    TextDelta,
    ToolCall,
    ToolExecResult,
    empty_usage,
)
from app.modules.chat.tools.registry import ToolSpec

logger = logging.getLogger(__name__)

# 안전 필터 차단 코드(architecture 9.1.4)
REFUSAL_CODES = {"safety", "jailbreak", "prohibited_content", "blocklist"}
# 응답에 입력이 다시 실려 와도 중복 저장하지 않는다.
INPUT_STEP_TYPES = ("user_input", "function_result")


def _is_refusal(exc: Exception) -> bool:
    body = getattr(exc, "body", None)
    error = body.get("error", body) if isinstance(body, dict) else {}
    return (
        getattr(exc, "status_code", None) == 400
        and isinstance(error, dict)
        and error.get("code") in REFUSAL_CODES
    )


def _step_item(step) -> dict:
    # SDK가 모르는 단계는 받은 원본(raw)을 그대로 보존한다.
    if getattr(step, "is_unknown", False) and isinstance(getattr(step, "raw", None), dict):
        return step.raw
    return step.model_dump(mode="json", by_alias=True, exclude_none=True)


class GeminiChatProvider:
    name = "gemini"

    def __init__(self, client=None, settings: Settings | None = None):
        self.settings = settings if settings is not None else get_settings()
        self.client = client if client is not None else get_gemini_client()
        self.model = self.settings.gemini_model

    def user_items(self, text: str) -> list[dict]:
        return [{"type": "user_input", "content": [{"type": "text", "text": text}]}]

    def run_round(
        self,
        *,
        system: str,
        history: list[dict],
        tools: list[ToolSpec],
        effort: Effort,
        max_tokens: int,
    ) -> Iterator[TextDelta | RoundResult]:
        try:
            interaction = self.client.interactions.create(
                model=self.settings.gemini_model,
                store=False,  # 항상 명시(architecture 9.1.1)
                system_instruction=system,
                input=history,
                tools=[
                    {
                        "type": "function",
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": portable_json_schema(tool.input_model),
                    }
                    for tool in tools
                ],
                generation_config={
                    "thinking_level": effort,
                    "max_output_tokens": max_tokens,
                    "tool_choice": "auto",
                },
            )
        except Exception as exc:
            # 예외 원문·요청 본문은 남기지 않는다.
            logger.warning(
                "챗봇 AI 호출 오류: %s status=%s",
                type(exc).__name__,
                getattr(exc, "status_code", None),
            )
            if _is_refusal(exc):
                yield RoundResult("refused", "", [], [], empty_usage(), self.model)
                return
            raise ProviderUnavailable(NO_RESPONSE_MESSAGE) from exc

        steps = interaction.steps or []
        items = [_step_item(step) for step in steps if step.type not in INPUT_STEP_TYPES]
        calls = [
            ToolCall(id=step.id, name=step.name, arguments=dict(step.arguments or {}))
            for step in steps
            if step.type == "function_call"
        ]
        if interaction.status == "incomplete":
            stop = "max_tokens"
        elif calls:
            stop = "tool_use"
        elif interaction.status == "completed":
            stop = "end"
        else:
            logger.warning("챗봇 AI 응답 상태 오류: status=%s", interaction.status)
            raise ProviderUnavailable(NO_RESPONSE_MESSAGE)
        text = interaction.output_text or ""
        if text:
            yield TextDelta(text)
        usage = interaction.usage
        yield RoundResult(
            stop=stop,
            text=text,
            tool_calls=calls,
            items=items,
            usage={
                "inputTokens": (usage.total_input_tokens if usage else None) or 0,
                "outputTokens": (usage.total_output_tokens if usage else None) or 0,
                "cachedInputTokens": (usage.total_cached_tokens if usage else None) or 0,
            },
            model=str(interaction.model) if interaction.model else self.model,
        )

    def tool_result_items(self, results: list[ToolExecResult]) -> list[dict]:
        return [
            {
                "type": "function_result",
                "call_id": result.call.id,
                "name": result.call.name,
                "result": [{"type": "text", "text": result.content}],
                "is_error": result.is_error,
            }
            for result in results
        ]


# ── 저장 항목 해석(화면·기록 복구용) ─────────────────────────────────────


def display_parts(items: list[dict]) -> tuple[str, list[str]]:
    text = "".join(
        part.get("text") or ""
        for item in items
        if item.get("type") == "model_output"
        for part in item.get("content") or []
        if part.get("type") == "text"
    )
    names = [item.get("name", "") for item in items if item.get("type") == "function_call"]
    return text, names


def question_text(items: list[dict]) -> str:
    return "".join(
        part.get("text") or ""
        for item in items
        if item.get("type") == "user_input"
        for part in item.get("content") or []
        if part.get("type") == "text"
    )


def stored_tool_calls(items: list[dict]) -> list[ToolCall]:
    return [
        ToolCall(
            id=item.get("id", ""), name=item.get("name", ""), arguments=item.get("arguments") or {}
        )
        for item in items
        if item.get("type") == "function_call"
    ]


def tool_result_errors(response_items: list[dict], result_items: list[dict]) -> list[bool | None]:
    """호출마다 결과의 오류 여부. 결과가 없으면 None"""
    errors = {
        item.get("call_id"): bool(item.get("is_error"))
        for item in result_items
        if item.get("type") == "function_result"
    }
    return [errors.get(call.id) for call in stored_tool_calls(response_items)]
