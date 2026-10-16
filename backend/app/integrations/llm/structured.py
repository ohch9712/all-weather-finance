from typing import Protocol

from pydantic import BaseModel

from app.core.errors import AppError
from app.integrations.llm.status import resolve_provider
from app.integrations.llm.tasks import get_task
from app.integrations.llm.types import Part


class StructuredLLM(Protocol):
    def enabled_for(self, task: str) -> bool: ...
    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T: ...


class DisabledLLM:
    def enabled_for(self, task: str) -> bool:
        get_task(task)
        return False

    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T:
        get_task(task)
        raise AppError(
            503,
            "LLM_UNAVAILABLE",
            "AI 기능이 꺼져 있습니다. 서버에 로컬 AI(Ollama)나 Gemini를 설정해야 합니다.",
        )


class RoutedStructuredLLM:
    def enabled_for(self, task: str) -> bool:
        return resolve_provider(get_task(task).data_class).enabled

    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T:
        status = resolve_provider(get_task(task).data_class)
        adapter: StructuredLLM
        if not status.enabled:
            adapter = DisabledLLM()
        elif status.provider == "gemini":
            from app.integrations.llm.gemini_adapter import GeminiStructuredLLM

            adapter = GeminiStructuredLLM()
        else:
            from app.integrations.llm.ollama_adapter import OllamaStructuredLLM

            adapter = OllamaStructuredLLM()
        return adapter.generate(task=task, system=system, content=content, output=output)
