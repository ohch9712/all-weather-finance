"""챗봇 테스트용 가짜 공급자(스펙 09 10절). 실제 Gemini·Ollama를 부르지 않는다."""

import copy
import time
from dataclasses import dataclass, field
from unittest.mock import Mock

from app.core.config import Settings
from app.modules.chat.providers.base import (
    ProviderUnavailable,
    RoundResult,
    TextDelta,
    ToolCall,
    ToolExecResult,
)
from app.modules.chat.providers.gemini import GeminiChatProvider
from app.modules.chat.providers.ollama_provider import OllamaChatProvider


@dataclass
class FakeRound:
    texts: list[str] = field(default_factory=list)
    stop: str = "end"
    tool_calls: list[ToolCall] = field(default_factory=list)
    items: list[dict] | None = None  # 없으면 공급자 형식으로 만든다
    usage: dict = field(
        default_factory=lambda: {"inputTokens": 10, "outputTokens": 5, "cachedInputTokens": 2}
    )
    raises: Exception | None = None
    delay: float = 0.0  # 라운드 응답 전 대기(ping 확인용)


def call(name: str, arguments: dict | None = None, call_id: str | None = None) -> ToolCall:
    return ToolCall(id=call_id or f"call-{name}", name=name, arguments=arguments or {})


class FakeChatProvider:
    """시나리오별 라운드를 차례로 돌려주고 받은 인자를 기록한다."""

    def __init__(self, rounds: list[FakeRound], *, name: str = "ollama", model: str = "gemma4:12b"):
        self.name = name
        self.model = model
        self.rounds = list(rounds)
        self.calls: list[dict] = []
        settings = Settings(gemini_model=model, ollama_model=model)
        codec = GeminiChatProvider if name == "gemini" else OllamaChatProvider
        # 항목 형식은 실제 어댑터의 것을 쓴다(SDK 클라이언트는 부르지 않는다).
        self._codec = codec(client=Mock(), settings=settings)

    def user_items(self, text: str) -> list[dict]:
        return self._codec.user_items(text)

    def tool_result_items(self, results: list[ToolExecResult]) -> list[dict]:
        return self._codec.tool_result_items(results)

    def _items(self, scenario: FakeRound, text: str) -> list[dict]:
        if scenario.items is not None:
            return scenario.items
        if self.name == "gemini":
            items = [{"type": "thought", "signature": "c2lnbmF0dXJl"}]
            if text:
                items.append({"type": "model_output", "content": [{"type": "text", "text": text}]})
            items += [
                {"type": "function_call", "id": c.id, "name": c.name, "arguments": c.arguments}
                for c in scenario.tool_calls
            ]
            return items
        item: dict = {"role": "assistant", "content": text}
        if scenario.tool_calls:
            item["tool_calls"] = [
                {"function": {"name": c.name, "arguments": c.arguments}}
                for c in scenario.tool_calls
            ]
        return [item]

    def run_round(self, *, system, history, tools, effort, max_tokens):
        self.calls.append(
            {
                "system": system,
                "history": copy.deepcopy(history),
                "tools": list(tools),
                "effort": effort,
                "max_tokens": max_tokens,
            }
        )
        assert self.rounds, "가짜 공급자에 남은 라운드가 없습니다."
        scenario = self.rounds.pop(0)
        if scenario.delay:
            time.sleep(scenario.delay)
        if scenario.raises is not None:
            raise scenario.raises
        for text in scenario.texts:
            yield TextDelta(text)
        text = "".join(scenario.texts)
        items = [] if scenario.stop == "refused" else self._items(scenario, text)
        yield RoundResult(
            stop=scenario.stop,
            text=text,
            tool_calls=list(scenario.tool_calls),
            items=items,
            usage=dict(scenario.usage),
            model=self.model,
        )


def unavailable(message: str = "로컬 AI(Ollama)에 연결하지 못했습니다.") -> FakeRound:
    return FakeRound(raises=ProviderUnavailable(message))
