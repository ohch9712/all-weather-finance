import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from app.core.time import KST
from app.modules.imports.registry import RowValidationError, TargetField


def normalize(value: str) -> str:
    return re.sub(r"[\s()（）*:]", "", value).lower()


def text(value: str) -> str | None:
    return re.sub(r"\s+", " ", value).strip() or None


def parse_datetime(value: str) -> datetime:
    if re.fullmatch(r"\d{5}", value) and 20000 <= int(value) <= 80000:
        return datetime(1899, 12, 30, tzinfo=KST) + timedelta(days=int(value))
    for pattern in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d", "%Y%m%d", "%y.%m.%d"):
        for suffix in ("", " %H:%M", " %H:%M:%S"):
            try:
                return datetime.strptime(value, pattern + suffix).replace(tzinfo=KST)
            except ValueError:
                pass
    raise ValueError("날짜 형식이 아닙니다.")


def convert_value(value: str, field: TargetField) -> date | datetime | int | Decimal | str | None:
    value = text(value)
    if value is None:
        if field.required:
            raise RowValidationError(field.key, "필수 값이 비었습니다.")
        return None
    try:
        if field.type == "text":
            return value
        if field.type in ("date", "datetime"):
            parsed = parse_datetime(value)
            return parsed.date() if field.type == "date" else parsed
        if field.type in ("amount", "decimal"):
            number = value.replace(",", "")
            if field.type == "amount":
                number = re.sub(r"[₩원\s]", "", number)
                if number.startswith("(") and number.endswith(")"):
                    number = "-" + number[1:-1]
                elif number.endswith("-"):
                    number = "-" + number[:-1]
            parsed_number = Decimal(number)
            if not parsed_number.is_finite():
                raise ValueError
            if field.type == "decimal":
                return parsed_number
            if parsed_number != parsed_number.to_integral_value():
                raise ValueError
            return int(parsed_number)
        for key, synonyms in (field.enum_values or {}).items():
            if normalize(value) in {normalize(v) for v in (key, *synonyms)}:
                return key
        raise ValueError
    except (ValueError, InvalidOperation, OverflowError) as exc:
        message = {
            "date": "날짜 형식이 아닙니다.",
            "datetime": "날짜 형식이 아닙니다.",
            "amount": "금액 형식이 아닙니다.",
            "decimal": "금액 형식이 아닙니다.",
        }.get(field.type, "알 수 없는 값입니다.")
        raise RowValidationError(field.key, message) from exc
