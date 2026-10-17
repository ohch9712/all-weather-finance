from datetime import date, datetime
from decimal import Decimal

import pytest

from app.core.time import KST
from app.modules.imports.converters import convert_value
from app.modules.imports.registry import RowValidationError, TargetField


@pytest.mark.parametrize(
    "value",
    [
        "2026-10-16",
        "2026.10.16",
        "2026/10/16",
        "20261016",
        "26.10.16",
        "2026-10-16 13:45:00",
        "46311",
    ],
)
def test_dates(value):
    assert convert_value(value, TargetField("date", "날짜", "date", True, ())) == date(2026, 10, 16)


@pytest.mark.parametrize(
    "value", ["2026-10-16", "2026.10.16", "2026/10/16", "20261016", "26.10.16"]
)
@pytest.mark.parametrize("suffix", ["", " 13:45", " 13:45:00"])
def test_datetimes(value, suffix):
    expected = datetime(2026, 10, 16, 13 if suffix else 0, 45 if suffix else 0, tzinfo=KST)
    assert (
        convert_value(value + suffix, TargetField("time", "시각", "datetime", True, ())) == expected
    )


@pytest.mark.parametrize(
    "value,expected",
    [
        ("12,000", 12000),
        ("12000원", 12000),
        ("₩12,000", 12000),
        ("-12,000", -12000),
        ("(12,000)", -12000),
        ("12,000-", -12000),
        ("1.2E+4", 12000),
    ],
)
def test_amounts(value, expected):
    assert convert_value(value, TargetField("amount", "금액", "amount", True, ())) == expected


def test_decimal_text_enum(demo_kind):
    assert convert_value(
        "1,234.5600", TargetField("price", "가격", "decimal", True, ())
    ) == Decimal("1234.5600")
    assert convert_value(" a  b\n c ", TargetField("title", "제목", "text", True, ())) == "a b c"
    assert convert_value("  ", demo_kind.fields[3]) is None
    assert convert_value(" 식 비 ", demo_kind.fields[3]) == "food"
    assert convert_value("FOOD", demo_kind.fields[3]) == "food"


@pytest.mark.parametrize(
    "type_,value,message",
    [
        ("date", "틀림", "날짜 형식이 아닙니다."),
        ("amount", "1.5", "금액 형식이 아닙니다."),
        ("decimal", "NaN", "금액 형식이 아닙니다."),
        ("decimal", "Infinity", "금액 형식이 아닙니다."),
        ("enum", "모름", "알 수 없는 값입니다."),
        ("text", " ", "필수 값이 비었습니다."),
    ],
)
def test_invalid(type_, value, message):
    with pytest.raises(RowValidationError) as exc:
        convert_value(value, TargetField("value", "값", type_, True, ()))
    assert (exc.value.field, exc.value.message) == ("value", message)
