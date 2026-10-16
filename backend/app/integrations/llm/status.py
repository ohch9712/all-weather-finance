from typing import Literal

from app.core.config import get_settings
from app.core.schemas import CamelModel
from app.integrations.llm.types import DataClass, ProviderName


class ScopeStatus(CamelModel):
    enabled: bool
    provider: ProviderName | None
    location: Literal["cloud", "local"] | None
    model: str | None
    reason: Literal["not_configured", "missing_api_key", "billing_required"] | None


class AiStatus(CamelModel):
    general: ScopeStatus
    personal: ScopeStatus


def resolve_provider(data_class: DataClass) -> ScopeStatus:
    settings = get_settings()
    provider = (
        settings.llm_general_provider if data_class == "general" else settings.llm_personal_provider
    )
    if provider == "disabled":
        return ScopeStatus(
            enabled=False, provider=None, location=None, model=None, reason="not_configured"
        )
    reason = None
    if provider == "gemini":
        if not settings.gemini_api_key:
            reason = "missing_api_key"
        elif data_class == "personal" and not settings.gemini_billing_enabled:
            reason = "billing_required"
    return ScopeStatus(
        enabled=reason is None,
        provider=provider,
        location="cloud" if provider == "gemini" else "local",
        model=settings.gemini_model if provider == "gemini" else settings.ollama_model,
        reason=reason,
    )


def get_ai_status() -> AiStatus:
    return AiStatus(general=resolve_provider("general"), personal=resolve_provider("personal"))
