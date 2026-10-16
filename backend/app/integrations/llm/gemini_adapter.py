import base64
import logging

from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.core.errors import AppError
from app.integrations.llm.clients import get_gemini_client
from app.integrations.llm.schema import portable_json_schema
from app.integrations.llm.tasks import get_task
from app.integrations.llm.types import Part, TextPart

logger = logging.getLogger(__name__)


class GeminiStructuredLLM:
    def __init__(self, client=None, settings=None):
        self.settings = settings if settings is not None else get_settings()
        self.client = client if client is not None else get_gemini_client()

    def enabled_for(self, task: str) -> bool:
        config = get_task(task)
        return bool(self.settings.gemini_api_key) and (
            config.data_class != "personal" or self.settings.gemini_billing_enabled
        )

    def generate[T: BaseModel](
        self, *, task: str, system: str, content: str | list[Part], output: type[T]
    ) -> T:
        config = get_task(task)
        if not self.enabled_for(task):
            from app.integrations.llm.structured import DisabledLLM

            return DisabledLLM().generate(task=task, system=system, content=content, output=output)
        parts = [TextPart(content)] if isinstance(content, str) else content
        files = [
            {
                "type": "image" if part.mime_type.startswith("image/") else "document",
                "data": base64.b64encode(part.data).decode(),
                "mime_type": part.mime_type,
            }
            for part in parts
            if not isinstance(part, TextPart)
        ]
        text = "\n".join(part.text for part in parts if isinstance(part, TextPart))
        # 호출 계약 및 출처: docs/architecture.md 9.1.4, google-genai 2.31 Interactions.
        try:
            interaction = self.client.interactions.create(
                model=self.settings.gemini_model,
                store=False,
                system_instruction=system,
                input=[*files, {"type": "text", "text": text}],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": portable_json_schema(output),
                },
                generation_config={
                    "thinking_level": config.effort,
                    "max_output_tokens": config.max_tokens,
                },
            )
        except Exception as exc:
            status = getattr(exc, "status_code", None)
            body = getattr(exc, "body", None)
            error = body.get("error", body) if isinstance(body, dict) else {}
            logger.warning("AI 호출 오류: %s status=%s", type(exc).__name__, status)
            if (
                status == 400
                and isinstance(error, dict)
                and error.get("code") in {"safety", "jailbreak", "prohibited_content", "blocklist"}
            ):
                raise AppError(
                    422,
                    "LLM_REFUSED",
                    "AI가 이 요청을 처리하지 않았습니다. 다른 표현으로 다시 시도해 주세요.",
                ) from exc
            raise AppError(
                503, "LLM_UNAVAILABLE", "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."
            ) from exc
        if interaction.status == "incomplete":
            raise AppError(
                503,
                "LLM_UNAVAILABLE",
                "AI 응답이 너무 길어 중단됐습니다. 잠시 후 다시 시도해 주세요.",
            )
        if interaction.status != "completed":
            raise AppError(
                503, "LLM_UNAVAILABLE", "AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요."
            )
        try:
            return output.model_validate_json(interaction.output_text or "")
        except ValidationError as exc:
            raise AppError(
                503,
                "LLM_UNAVAILABLE",
                "AI 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.",
            ) from exc
