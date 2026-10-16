import logging
import re

SECRET_KEYS = frozenset(
    {
        "app_key",
        "appkey",
        "app_secret",
        "secretkey",
        "secret",
        "token",
        "password",
        "account_no",
        "authorization",
    }
)
KEY_PATTERN = "|".join(sorted(SECRET_KEYS, key=len, reverse=True))
SECRET_PATTERN = re.compile(
    rf"(?i)(\b(?:{KEY_PATTERN})\b[\"']?\s*[:=]\s*)(?:\"[^\"]*\"|'[^']*'|[^\n,;&}}]+)"
)


def mask(value):
    if isinstance(value, dict):
        return {
            key: "***" if str(key).lower() in SECRET_KEYS else mask(item)
            for key, item in value.items()
        }
    if isinstance(value, (tuple, list)):
        return type(value)(mask(item) for item in value)
    if isinstance(value, str):
        return SECRET_PATTERN.sub(r"\1***", value)
    return value


class SecretMaskingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.args = mask(record.args)
        record.msg = mask(record.getMessage())
        record.args = ()
        return True


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(item, SecretMaskingFilter) for item in handler.filters):
                handler.addFilter(SecretMaskingFilter())
