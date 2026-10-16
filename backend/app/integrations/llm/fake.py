from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel

from app.integrations.llm.structured import DisabledLLM
from app.integrations.llm.tasks import get_task
from app.integrations.llm.types import DataClass, Part, TextPart


@dataclass(frozen=True)
class FakeRequest:
    task: str
    data_class: DataClass
    system: str
    content: list[Part]
    output_name: str


class FakeStructuredLLM:
    def __init__(self):
        self.calls: list[FakeRequest] = []
        self.handlers: dict[str, Callable[[FakeRequest], dict]] = {}
        self.enabled: dict[str, bool] = {}

    def register(self, task: str, handler: Callable[[FakeRequest], dict]) -> None:
        get_task(task)
        self.handlers[task] = handler

    def set_enabled(self, task: str, enabled: bool) -> None:
        get_task(task)
        self.enabled[task] = enabled

    def enabled_for(self, task: str) -> bool:
        get_task(task)
        return self.enabled.get(task, True)

    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T:
        config = get_task(task)
        if not self.enabled_for(task):
            return DisabledLLM().generate(task=task, system=system, content=content, output=output)
        assert task in self.handlers, f"가짜 AI 응답이 등록되지 않았습니다: {task}"
        request = FakeRequest(
            task,
            config.data_class,
            system,
            [TextPart(content)] if isinstance(content, str) else content,
            output.__name__,
        )
        self.calls.append(request)
        return output.model_validate(self.handlers[task](request))
