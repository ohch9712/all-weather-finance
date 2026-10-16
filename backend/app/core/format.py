from decimal import ROUND_HALF_UP, Decimal


def format_krw(value: int) -> str:
    return f"{value:,}원"


def format_krw_compact(value: int) -> str:
    amount = abs(value)
    sign = "-" if value < 0 else ""
    if amount >= 100_000_000:
        rounded = (Decimal(amount) / 100_000_000).quantize(Decimal("0.1"), ROUND_HALF_UP)
        return f"{sign}{format(rounded, 'f').removesuffix('.0')}억원"
    if amount >= 10_000:
        rounded = int((Decimal(amount) / 10_000).quantize(Decimal("1"), ROUND_HALF_UP))
        return f"{sign}1억원" if rounded == 10_000 else f"{sign}{rounded:,}만원"
    return format_krw(value)
