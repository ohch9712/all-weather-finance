from dataclasses import dataclass

from app.integrations.llm.types import DataClass, Effort


@dataclass(frozen=True)
class LLMTask:
    key: str
    data_class: DataClass
    effort: Effort
    max_tokens: int


LLM_TASKS = {
    task.key: task
    for task in (
        LLMTask("imports.column_mapping", "personal", "low", 4000),
        LLMTask("ledger.categorize", "personal", "low", 8000),
        LLMTask("ledger.extract_statement", "personal", "medium", 16000),
        LLMTask("learn.ai_draft", "general", "medium", 8000),
        LLMTask("screener.parse", "general", "medium", 4000),
        LLMTask("chat.agent", "personal", "medium", 8000),
    )
}


def get_task(key: str) -> LLMTask:
    if key not in LLM_TASKS:
        raise ValueError(f"등록되지 않은 AI 작업입니다: {key}")
    return LLM_TASKS[key]
