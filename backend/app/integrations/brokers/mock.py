import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from app.integrations.brokers.base import (
    BrokerHolding,
    Candle,
    ConditionInfo,
    Execution,
    Fundamentals,
    HoldingsSnapshot,
    Market,
    Quote,
    StockInfo,
)
from app.integrations.brokers.errors import BrokerError

AS_OF = datetime(2026, 10, 16, 6, 30, tzinfo=UTC)


class MockBroker:
    provider = "mock"
    capabilities = frozenset(
        {"STOCK_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS", "EXECUTIONS", "CONDITIONS"}
    )

    def __init__(self):
        self.rows = json.loads((Path(__file__).parent / "fixtures/mock_stocks.json").read_text())
        self.by_code = {row["code"]: row for row in self.rows}

    def list_stocks(self, market: Market) -> list[StockInfo]:
        return [
            StockInfo(r["code"], r["name"], r["market"], r["sector"])
            for r in self.rows
            if r["market"] == market
        ]

    def get_fundamentals(self, code: str) -> Fundamentals:
        if code not in self.by_code:
            raise BrokerError("BROKER_UNAVAILABLE")
        r = self.by_code[code]
        return Fundamentals(
            **{
                k: r[k] if k in {"code", "volume", "trading_value", "market_cap"} else Decimal(r[k])
                for k in Fundamentals.__dataclass_fields__
            }
        )

    def get_quotes(self, codes: list[str]) -> list[Quote]:
        return [
            Quote(code, f.price, Decimal("0"), f.change_rate, f.volume, AS_OF)
            for code in codes
            if code in self.by_code
            for f in [self.get_fundamentals(code)]
        ]

    def get_daily_candles(self, code: str, start: date, end: date) -> list[Candle]:
        f = self.get_fundamentals(code)
        return [
            Candle(day, f.price, f.price + 100, f.price - 100, f.price, f.volume)
            for n in range((end - start).days + 1)
            if (day := start + timedelta(days=n)).weekday() < 5
        ]

    def get_holdings(self) -> HoldingsSnapshot:
        return HoldingsSnapshot(
            [
                BrokerHolding(
                    r["code"],
                    r["name"],
                    r["market"],
                    Decimal("10"),
                    Decimal(r["price"]) - 100,
                    int(Decimal(r["price"]) * 10),
                    "KRW",
                )
                for r in self.rows[:5]
            ],
            5000000,
            AS_OF,
        )

    def get_executions(self, start: date, end: date) -> list[Execution]:
        return [
            Execution(
                f"mock-{n:03}",
                at,
                r["code"],
                r["name"],
                r["market"],
                "buy" if n % 2 == 0 else "sell",
                Decimal("1"),
                Decimal(r["price"]),
                Decimal("100"),
                Decimal("0"),
                "KRW",
            )
            for n in range(20)
            for r in [self.rows[n % 5]]
            if start <= (at := AS_OF - timedelta(days=n)).date() <= end
        ]

    def list_conditions(self) -> list[ConditionInfo]:
        return [ConditionInfo("0", "샘플 저PER"), ConditionInfo("1", "샘플 대형주")]

    def run_condition(self, seq: str) -> list[str]:
        if seq not in {"0", "1"}:
            return []
        return (
            [r["code"] for r in self.rows if Decimal(r["per"]) < 10]
            if seq == "0"
            else [r["code"] for r in self.rows if r["market_cap"] >= 2000000000000]
        )
