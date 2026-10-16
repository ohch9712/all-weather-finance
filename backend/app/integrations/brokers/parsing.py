from decimal import Decimal, InvalidOperation
from functools import wraps

from app.integrations.brokers.errors import BrokerError


def decimal_value(value, *, absolute=False) -> Decimal | None:
    if value is None or str(value).strip() in {"", "-", "--"}:
        return None
    number = Decimal(str(value).strip().replace(",", ""))
    if not number.is_finite():
        raise ValueError("숫자 형식이 올바르지 않습니다.")
    return abs(number) if absolute else number


def integer_value(value, *, scale=1) -> int | None:
    number = decimal_value(value)
    return int(number * scale) if number is not None else None


def parsed_response(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except (ValueError, TypeError, KeyError, InvalidOperation):
            raise BrokerError("BROKER_UNAVAILABLE") from None

    return wrapped
