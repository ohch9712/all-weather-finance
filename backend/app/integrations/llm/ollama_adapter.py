import httpx
import ollama
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.core.errors import AppError
from app.integrations.llm.clients import get_ollama_client
from app.integrations.llm.pdf import pdf_to_png_pages
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.tasks import get_task
from app.integrations.llm.types import DocumentPart, ImagePart, Part, TextPart


class OllamaStructuredLLM:
    def __init__(self, client=None, settings=None):
        self.settings = settings if settings is not None else get_settings()
        self.client = client if client is not None else get_ollama_client()

    def enabled_for(self, task: str) -> bool:
        get_task(task)
        return True

    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T:
        config = get_task(task)
        parts = [TextPart(content)] if isinstance(content, str) else content
        text = "\n".join(part.text for part in parts if isinstance(part, TextPart))
        images = []
        for part in parts:
            if isinstance(part, ImagePart):
                images.append(part.data)
            elif isinstance(part, DocumentPart):
                images.extend(pdf_to_png_pages(part.data))
        user = {"role": "user", "content": text}
        if images:
            user["images"] = images
        kwargs = {}
        if self.settings.ollama_thinking:
            kwargs["think"] = config.effort != "low"
        # 호출 계약 및 출처: docs/architecture.md 9.1.5, ollama 0.6.3 Client.chat.
        try:
            response = self.client.chat(
                model=self.settings.ollama_model,
                messages=[{"role": "system", "content": system}, user],
                format=portable_json_schema(output),
                stream=False,
                options={
                    "temperature": 0,
                    "num_predict": config.max_tokens,
                    "num_ctx": self.settings.ollama_num_ctx,
                },
                **kwargs,
            )
        except ConnectionError as exc:
            raise AppError(
                503,
                "LLM_UNAVAILABLE",
                "로컬 AI(Ollama)에 연결하지 못했습니다. Ollama가 실행 중인지 확인해 주세요.",
            ) from exc
        except (ollama.ResponseError, httpx.TimeoutException) as exc:
            if isinstance(exc, ollama.ResponseError) and exc.status_code == 404:
                raise AppError(
                    503,
                    "LLM_UNAVAILABLE",
                    "로컬 AI 모델이 없습니다. 서버에서 ollama pull로 모델을 받아 주세요.",
                ) from exc
            raise AppError(
                503, "LLM_UNAVAILABLE", "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."
            ) from exc
        if response.done_reason == "length":
            raise AppError(
                503,
                "LLM_UNAVAILABLE",
                "AI 응답이 너무 길어 중단됐습니다. 잠시 후 다시 시도해 주세요.",
            )
        try:
            return output.model_validate_json(response.message.content or "")
        except ValidationError as exc:
            raise AppError(
                503,
                "LLM_UNAVAILABLE",
                "AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.",
            ) from exc
