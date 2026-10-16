from functools import lru_cache
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = (
        "postgresql+psycopg://finance:finance_local_password@localhost:5433/finance_00"
    )
    migration_database_url: str = ""
    db_connect_timeout_seconds: int = 5
    frontend_origin: str = "http://localhost:3000"
    session_cookie_name: str = "finance_session"
    session_ttl_seconds: int = 604800
    cookie_secure: bool = False
    app_encryption_key: str = ""
    llm_general_provider: Literal["disabled", "gemini", "ollama"] = "disabled"
    llm_personal_provider: Literal["disabled", "gemini", "ollama"] = "disabled"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_billing_enabled: bool = False
    gemini_timeout_seconds: int = 60
    ollama_host: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma4:12b"
    ollama_thinking: bool = True
    ollama_num_ctx: int = 32768
    ollama_timeout_seconds: int = 300
    market_data_provider: Literal["mock", "kiwoom", "toss"] = "mock"
    kiwoom_env: Literal["mock", "real"] = "mock"
    kiwoom_app_key: str = ""
    kiwoom_app_secret: str = ""
    toss_client_id: str = ""
    toss_client_secret: str = ""
    codef_env: Literal["sandbox", "development", "production"] = "sandbox"
    codef_client_id: str = ""
    codef_client_secret: str = ""
    codef_public_key: str = ""
    chat_daily_message_limit: int = 100
    import_max_file_mb: int = 10

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @model_validator(mode="after")
    def validate_encryption_key(self):
        try:
            Fernet(self.app_encryption_key.encode())
        except (ValueError, TypeError) as exc:
            raise ValueError("APP_ENCRYPTION_KEY에 올바른 Fernet 키를 설정해 주세요.") from exc
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
