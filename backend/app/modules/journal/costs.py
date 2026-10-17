"""사용자 설정이 없을 때 쓰는 키움증권 기준 기본 요율(%)."""

from decimal import Decimal

DEFAULT_RATES = {
    "krx_commission_rate": Decimal("0.015"),
    "krx_sell_tax_rate": Decimal("0.20"),
    "us_commission_rate": Decimal("0.25"),
}
