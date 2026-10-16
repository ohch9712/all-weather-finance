from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from app.modules.journal import service
from app.modules.journal.models import Trade


def trade(side="buy", quantity="10", price="70000", fee="0", tax="0", day=1, **kwargs):
    values = dict(
        id=uuid4(),
        user_id=uuid4(),
        traded_at=datetime(2026, 9, day, tzinfo=UTC),
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
        updated_at=datetime(2026, 10, 1, tzinfo=UTC),
        time_known=True,
        market="KRX",
        symbol_code="005930",
        symbol_name="삼성전자",
        currency="KRW",
        side=side,
        quantity=Decimal(quantity),
        price=Decimal(price),
        fee=Decimal(fee),
        tax=Decimal(tax),
        source="manual",
    )
    values.update(kwargs)
    return Trade(**values)


def example():
    return [
        trade(fee="100"),
        trade(price="80000", fee="100", day=2),
        trade("sell", "5", "90000", "100", "810", day=3),
        trade("sell", "20", "60000", day=4),
    ]


def test_spec_four_steps(monkeypatch):
    trades = example()
    expected = [
        ("10", "700100", "0", False),
        ("20", "1500200", "0", False),
        ("15", "1125150", "74040", False),
        ("0", "0", "-151110", True),
    ]
    for index, (quantity, basis, pnl, oversold) in enumerate(expected, 1):
        monkeypatch.setattr(service.repo, "all_trades", lambda *args, index=index: trades[:index])
        position = service.get_positions(None, None, include_closed=True)[0]
        assert (
            position.quantity,
            position.cost_basis,
            position.realized_pnl,
            position.has_oversold,
        ) == (quantity, basis, pnl, oversold)
        assert position.trade_count == index
    _, results = service.calculate(trades)
    assert [item.pnl for item in results] == [None, None, Decimal("74040"), Decimal("-225150")]
    assert [item.oversold for item in results] == [False, False, False, True]
    assert service.get_positions(None, None) == []


def test_stats_full_history_then_period(monkeypatch):
    trades = example()
    monkeypatch.setattr(service.repo, "all_trades", lambda *args: trades)
    stats = service.get_trade_stats(None, None)
    summary = stats.by_currency[0]
    assert summary.realized_pnl == "-151110"
    assert (summary.win_count, summary.loss_count, summary.sell_count, summary.win_rate) == (
        1,
        1,
        2,
        50,
    )
    assert (summary.avg_win, summary.avg_loss) == ("74040", "-225150")
    assert summary.best_trade.trade_id == trades[2].id
    assert summary.worst_trade.trade_id == trades[3].id
    assert stats.monthly[0].realized_pnl == "-151110"
    assert [item.realized_pnl for item in stats.daily] == ["74040", "-225150"]
    assert stats.by_symbol[0].realized_pnl == "-151110"
    filtered = service.get_trade_stats(None, None, date(2026, 9, 3), date(2026, 9, 3))
    assert filtered.by_currency[0].realized_pnl == "74040"
    assert filtered.by_currency[0].win_rate == 100
    assert len(filtered.daily) == 1


def test_usd_precision_market_currency_separation_and_latest_name(monkeypatch):
    trades = [
        trade(),
        trade(quantity="0.5", price="10.01", market="US", currency="USD", symbol_name="미국 종목"),
        trade("sell", "0.25", "10.04", day=2, market="US", currency="USD", symbol_name="새 이름"),
    ]
    monkeypatch.setattr(service.repo, "all_trades", lambda *args: trades)
    positions = service.get_positions(None, None)
    assert len(positions) == 2
    usd = next(item for item in positions if item.currency == "USD")
    assert (usd.quantity, usd.avg_cost, usd.cost_basis, usd.realized_pnl) == (
        "0.25",
        "10.01",
        "2.50",
        "0.01",
    )
    assert usd.symbol_name == "새 이름"
    stats = service.get_trade_stats(None, None)
    assert len(stats.by_currency) == 2
    assert next(item for item in stats.by_currency if item.currency == "USD").realized_pnl == "0.01"
    assert service.money(Decimal("-1.005"), "USD") == "-1.01"
    assert service.money(Decimal("0.5"), "KRW") == "1"


def test_no_sells_zero_pnl_and_sell_without_holdings(monkeypatch):
    trades = [trade()]
    monkeypatch.setattr(service.repo, "all_trades", lambda *args: trades)
    stats = service.get_trade_stats(None, None)
    assert stats.by_currency[0].win_rate is None
    assert stats.by_currency[0].sell_count == 0
    trades += [trade("sell", "1", "70000", day=2), trade("sell", "1", "70001", day=3)]
    stats = service.get_trade_stats(None, None)
    assert (
        stats.by_currency[0].win_count,
        stats.by_currency[0].loss_count,
        stats.by_currency[0].win_rate,
    ) == (1, 0, 100)
    no_holdings = [trade("sell")]
    _, results = service.calculate(no_holdings)
    assert results[0].pnl is None and results[0].oversold


def test_kst_day_and_round_at_end(monkeypatch):
    trades = [
        trade(quantity="3", price="1", market="US", currency="USD"),
        trade("sell", "1", "1.004", day=2, market="US", currency="USD"),
        trade(
            "sell",
            "1",
            "1.004",
            day=3,
            market="US",
            currency="USD",
            traded_at=datetime(2026, 9, 2, 15, tzinfo=UTC),
        ),
    ]
    monkeypatch.setattr(service.repo, "all_trades", lambda *args: trades)
    stats = service.get_trade_stats(None, None)
    assert stats.by_currency[0].realized_pnl == "0.01"
    assert [item.date for item in stats.daily] == [date(2026, 9, 2), date(2026, 9, 3)]
    assert [item.realized_pnl for item in stats.daily] == ["0.00", "0.00"]


def test_same_day_unknown_time_created_order():
    first = trade(time_known=False)
    second = trade(
        "sell", "1", "80000", time_known=False, created_at=first.created_at + timedelta(seconds=1)
    )
    _, results = service.calculate([first, second])
    assert results[1].pnl == Decimal("10000")
