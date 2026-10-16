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
        # Uvicorn 접근 포매터는 메시지 틀과 5개 인자를 그대로 사용한다.
        if record.name == "uvicorn.access":
            return True
        message = record.getMessage()
        masked_message = mask(message)
        # password=%s처럼 서식을 적용해야 드러나는 비밀값만 최종 문자열에서 가린다.
        if masked_message != message:
            record.msg = masked_message
            record.args = ()
        return True


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            if not any(isinstance(item, SecretMaskingFilter) for item in handler.filters):
                handler.addFilter(SecretMaskingFilter())
