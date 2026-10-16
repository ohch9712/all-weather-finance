import base64
import logging

import pytest
from cryptography.fernet import InvalidToken
from freezegun import freeze_time
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_str, encrypt_str, mask_tail
from app.core.format import format_krw, format_krw_compact
from app.core.logging import SecretMaskingFilter
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
