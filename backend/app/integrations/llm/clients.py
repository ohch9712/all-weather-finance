from functools import lru_cache

import ollama
from google import genai

from app.core.config import get_settings


@lru_cache
def get_gemini_client() -> genai.Client:
    settings = get_settings()
    return genai.Client(
        api_key=settings.gemini_api_key,
        http_options={"timeout": settings.gemini_timeout_seconds * 1000},
    )


@lru_cache
def get_ollama_client() -> ollama.Client:
    settings = get_settings()
    return ollama.Client(host=settings.ollama_host, timeout=settings.ollama_timeout_seconds)
