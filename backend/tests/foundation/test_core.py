import base64
import logging

import pytest
from cryptography.fernet import InvalidToken
from fastapi import FastAPI
from fastapi.testclient import TestClient
from freezegun import freeze_time
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_str, encrypt_str, mask_tail
from app.core.errors import AppError, field_error, register_error_handlers
from app.core.format import format_krw, format_krw_compact
from app.core.logging import SecretMaskingFilter
from app.core.schemas import ErrorDetail
from app.core.time import now_utc, today_kst


def test_crypto():
    token = encrypt_str("계좌정보 테스트")
    assert token != "계좌정보 테스트"
    assert decrypt_str(token) == "계좌정보 테스트"
    with pytest.raises(InvalidToken):
        decrypt_str("invalid")
    assert mask_tail("1234567890") == "******7890"
    assert mask_tail("123") == "123"
    assert mask_tail("123", keep=0) == "***"
    with pytest.raises(ValueError):
        mask_tail("123", -1)


@pytest.mark.parametrize("key", ["", "invalid", base64.urlsafe_b64encode(b"short").decode()])
def test_invalid_encryption_key(key):
    with pytest.raises(ValidationError, match="APP_ENCRYPTION_KEY"):
        Settings(app_encryption_key=key)


def test_settings_database_url():
    config = Settings(
        database_url="postgresql://user@localhost/db",
        migration_database_url="postgres://user@localhost/other",
    )
    assert config.database_url == "postgresql+psycopg://user@localhost/db"
    assert config.migration_database_url == "postgresql+psycopg://user@localhost/other"
    for field in ["llm_general_provider", "llm_personal_provider"]:
        with pytest.raises(ValidationError):
            Settings(**{field: "anthropic"})


@pytest.mark.parametrize(
    "value,expected", [(1234000, "1,234,000원"), (-5000, "-5,000원"), (0, "0원")]
)
def test_format_krw(value, expected):
    assert format_krw(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        (100000000, "1억원"),
        (123400000, "1.2억원"),
        (2710264056, "27.1억원"),
        (56700000, "5,670만원"),
        (12345678, "1,235만원"),
        (99995000, "1억원"),
        (15000, "2만원"),
        (9999, "9,999원"),
        (0, "0원"),
    ],
)
def test_format_compact(value, expected):
    assert format_krw_compact(value) == expected
    if value:
        assert format_krw_compact(-value) == "-" + expected


def test_time_kst_midnight():
    with freeze_time("2026-10-16T15:00:00Z"):
        assert now_utc().isoformat() == "2026-10-16T15:00:00+00:00"
        assert today_kst().isoformat() == "2026-10-17"


@pytest.mark.parametrize(
    "key",
    [
        "app_key",
        "appkey",
        "app_secret",
        "secretkey",
        "secret",
        "token",
        "password",
        "account_no",
        "authorization",
    ],
)
def test_secret_masking(key):
    filter_ = SecretMaskingFilter()
    for message, args in [
        (f"{key}=private-value", ()),
        (f'{{"{key}": "private-value"}}', ()),
        (f"{{'{key}': 'private-value'}}", ()),
        (f"{key}=%s", ("private-value",)),
        ("%s", ({key: "private-value", "nested": {key: "private-value"}},)),
    ]:
        record = logging.LogRecord("test", logging.INFO, "", 0, message, args, None)
        assert filter_.filter(record)
        assert "private-value" not in record.getMessage()
        assert "***" in record.getMessage()


def test_settings_no_real_api_keys():
    assert get_settings().gemini_api_key == ""


def test_masking_multiword_password():
    record = logging.LogRecord(
        "test", logging.INFO, "", 0, "password=%s", ("first second third",), None
    )
    SecretMaskingFilter().filter(record)
    assert record.getMessage() == "password=***"


def test_settings_validation_does_not_print_secrets():
    with pytest.raises(ValidationError) as exc:
        Settings(app_encryption_key="invalid", gemini_api_key="fake-sensitive-value")
    assert "fake-sensitive-value" not in str(exc.value)


def test_app_error_details():
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/field")
    def raise_field():
        raise field_error("items.0.amount", "0보다 큰 금액을 입력해 주세요.")

    @app.get("/details")
    def raise_details():
        raise AppError(
            409, "CONFLICT", "이미 있습니다.", [ErrorDetail(field="code", message="중복")]
        )

    @app.get("/plain")
    def raise_plain():
        raise AppError(409, "CONFLICT", "이미 있습니다.")

    client = TestClient(app)
    assert client.get("/field").status_code == 422
    assert client.get("/field").json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "입력값을 확인해 주세요.",
            "details": [{"field": "items.0.amount", "message": "0보다 큰 금액을 입력해 주세요."}],
        }
    }
    assert client.get("/details").json()["error"]["details"] == [
        {"field": "code", "message": "중복"}
    ]
    assert client.get("/plain").json()["error"]["details"] == []


def test_validation_messages_are_korean():
    from pydantic import BaseModel, EmailStr, field_validator

    class Body(BaseModel):
        email: EmailStr
        nickname: str

        @field_validator("nickname")
        @classmethod
        def check_nickname(cls, value):
            if value == "bad":
                raise ValueError("닉네임을 확인해 주세요.")
            if value == "english":
                raise ValueError("library default message")
            return value

    app = FastAPI()
    register_error_handlers(app)

    @app.post("/body")
    def create(body: Body):
        return {}

    client = TestClient(app)
    details = client.post("/body", json={"email": "user@example.test", "nickname": "ok"}).json()[
        "error"
    ]["details"]
    assert details == [{"field": "email", "message": "올바른 이메일 주소를 입력해 주세요."}]
    details = client.post("/body", json={"email": "a@b.com", "nickname": "bad"}).json()["error"][
        "details"
    ]
    assert details == [{"field": "nickname", "message": "닉네임을 확인해 주세요."}]
    details = client.post("/body", json={"email": "a@b.com", "nickname": "english"}).json()[
        "error"
    ]["details"]
    assert details == [{"field": "nickname", "message": "형식이 올바르지 않습니다."}]
