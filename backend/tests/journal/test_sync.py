import json
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select

from app.core.errors import AppError
from app.integrations.brokers import kiwoom
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.modules.journal import service
from app.modules.journal.models import Trade
from app.modules.market import service as market

PERIOD = {"from": "2026-09-01", "to": "2026-10-16"}


def connection(client, provider="mock", verify=True):
    response = client.post(
        "/api/market/connections",
        json={
            "provider": provider,
            "environment": "real" if provider == "toss" else "mock",
            "label": "테스트 연결",
            "appKey": "fake",
            "appSecret": "fake",
        },
    )
    assert response.status_code == 201, response.text
    result = response.json()
    if verify:
        assert (
            client.post(f"/api/market/connections/{result['id']}/verify", json={}).json()["status"]
            == "active"
        )
    return result["id"]


def sync(client, connection_id, **period):
    return client.post(
        "/api/journal/sync", json={"connectionId": connection_id, **PERIOD, **period}
    )


def test_mock_sync_idempotent_status_isolation(auth_client, other_auth_client):
    cid = connection(auth_client)
    first = sync(auth_client, cid)
    assert first.status_code == 200, first.text
    assert first.json()["inserted"] == 20
    assert first.json()["costEstimated"] == 0
    second = sync(auth_client, cid).json()
    assert (second["inserted"], second["updated"], second["unchanged"]) == (0, 0, 20)
    assert second["costEstimated"] == 0
    trades = auth_client.get("/api/journal/trades?pageSize=100").json()["items"]
    assert len(trades) == 20
    assert all(t["source"] == "mock" and t["broker"] is None for t in trades)
    status = auth_client.get("/api/journal/sync/status").json()["items"][0]
    assert status["connectionId"] == cid and status["tradeCount"] == 20 and status["lastSyncedAt"]
    assert sync(other_auth_client, cid).status_code == 404
    assert other_auth_client.get("/api/journal/sync/status").json() == {"items": []}
    assert other_auth_client.get(f"/api/journal/trades/{trades[0]['id']}").status_code == 404


def test_no_time_manual_duplicate_one_to_one_and_updated(auth_client, monkeypatch):
    cid = connection(auth_client)
    execution = MockBroker().get_executions(date(2026, 9, 1), date(2026, 10, 16))[0]
    rows = [execution, replace(execution, external_id="another-fill")]
    monkeypatch.setattr(
        market,
        "get_user_broker_client",
        lambda *args: SimpleNamespace(get_executions=lambda *args: rows),
    )
    manual = auth_client.post(
        "/api/journal/trades",
        json={
            "tradedOn": execution.executed_at.date().isoformat(),
            "symbolCode": execution.code,
            "symbolName": execution.name,
            "market": "KRX",
            "currency": "KRW",
            "side": execution.side,
            "quantity": str(execution.quantity),
            "price": str(execution.price),
        },
    )
    assert manual.status_code == 201
    result = sync(auth_client, cid).json()
    assert result["inserted"] == 1 and result["skippedDuplicates"] == 1
    result = sync(auth_client, cid).json()
    assert result["inserted"] == 0 and result["unchanged"] == 1 and result["skippedDuplicates"] == 1
    rows[1] = replace(rows[1], price=rows[1].price + 100)
    result = sync(auth_client, cid).json()
    assert result["updated"] == 1 and result["inserted"] == 0


def test_inactive_and_unsupported(auth_client, monkeypatch):
    cid = connection(auth_client, verify=False)
    response = sync(auth_client, cid)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BROKER_NOT_CONNECTED"
    monkeypatch.setattr(
        market,
        "get_user_broker_client",
        lambda *args: SimpleNamespace(
            get_executions=lambda *args: (_ for _ in ()).throw(BrokerError("BROKER_NOT_SUPPORTED"))
        ),
    )
    assert sync(auth_client, cid).status_code == 501


@pytest.mark.parametrize(
    "period,field",
    [
        ({"from": "2026-01-01", "to": "2026-10-16"}, "from"),
        ({"from": "2026-10-16", "to": "2026-10-15"}, "from"),
        ({"to": "2099-01-01"}, "to"),
    ],
)
def test_period_validation(auth_client, period, field):
    response = sync(auth_client, "00000000-0000-0000-0000-000000000001", **period)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field


def test_kiwoom_missing_costs_market_conversion_and_etf(auth_client, db, respx_mock, monkeypatch):
    cid = connection(auth_client)
    broker = kiwoom.KiwoomBroker(
        "fake-app",
        "fake-secret",
        client=httpx.Client(transport=httpx.MockTransport(respx_mock.handler)),
    )
    broker.token = "test-token"
    broker.expires_at = datetime(2099, 1, 1, tzinfo=UTC)
    monkeypatch.setattr(kiwoom.BUCKET, "acquire", lambda: None)
    monkeypatch.setattr(market, "get_user_broker_client", lambda *args: broker)
    monkeypatch.setattr(
        market,
        "list_connections",
        lambda *args: [SimpleNamespace(id=UUID(cid), provider="kiwoom", label="키움")],
    )

    def response(request):
        assert request.headers["api-id"] == "kt00009"
        body = json.loads(request.content)
        rows = (
            [
                {
                    "ord_no": "1",
                    "cntr_no": "1",
                    "stk_cd": "A005930",
                    "stk_nm": "삼성전자",
                    "cntr_qty": "2",
                    "cntr_uv": "71000",
                    "cntr_tm": "13:07:47",
                }
            ]
            if body["sell_tp"] == "1"
            else []
        )
        return httpx.Response(200, json={"return_code": 0, "acnt_ord_cntr_prst_array": rows})

    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").mock(side_effect=response)
    first = sync(auth_client, cid, **{"from": "2026-10-16", "to": "2026-10-16"})
    assert first.status_code == 200, first.text
    assert first.json()["costEstimated"] == 1
    trade = auth_client.get("/api/journal/trades").json()["items"][0]
    assert trade["market"] == "KRX" and trade["source"] == "kiwoom"
    assert trade["costEstimated"] and trade["fee"] == "21" and trade["tax"] == "284"
    assert trade["tradedAt"].endswith("04:07:47Z")
    monkeypatch.setattr(service, "is_domestic_etf", lambda *args: True)
    result = sync(auth_client, cid, **{"from": "2026-10-16", "to": "2026-10-16"}).json()
    assert result["updated"] == 1
    assert result["costEstimated"] == 1
    assert auth_client.get("/api/journal/trades").json()["items"][0]["tax"] == "0"
    stored = db.scalar(select(Trade).where(Trade.connection_id == UUID(cid)))
    assert stored.external_id == "20261016:1:1" and stored.synced_at


def test_transaction_rollback(auth_client, db, monkeypatch):
    cid = connection(auth_client)
    original = service.repo.add_trade
    calls = []

    def fail(db, values):
        if calls:
            raise AppError(502, "BROKER_UNAVAILABLE", "테스트 오류")
        calls.append(1)
        return original(db, values)

    monkeypatch.setattr(service.repo, "add_trade", fail)
    assert sync(auth_client, cid).status_code == 502
    assert auth_client.get("/api/journal/trades").json()["total"] == 0


def test_quotes_formula_disabled_missing_and_failure(auth_client, monkeypatch):
    auth_client.post(
        "/api/journal/trades",
        json={
            "tradedOn": "2026-10-01",
            "market": "KRX",
            "symbolCode": "005930",
            "symbolName": "삼성전자",
            "side": "buy",
            "quantity": "2",
            "price": "10000",
            "currency": "KRW",
            "fee": "100",
            "tax": "0",
        },
    )
    calls = []

    def quotes(codes):
        calls.append(codes)
        return [SimpleNamespace(code="005930", price=Decimal(12000), source="mock")]

    monkeypatch.setattr(market, "get_quotes", quotes)
    item = auth_client.get("/api/journal/positions").json()["items"][0]
    assert (
        item["currentPrice"],
        item["evalAmount"],
        item["unrealizedPnl"],
        item["unrealizedPnlRate"],
        item["quoteSource"],
    ) == ("12000", "24000", "3900", 19.4, "mock")
    calls.clear()
    assert (
        auth_client.get("/api/journal/positions?withQuotes=false").json()["items"][0][
            "currentPrice"
        ]
        is None
    )
    assert not calls
    monkeypatch.setattr(market, "get_quotes", lambda codes: [])
    assert auth_client.get("/api/journal/positions").json()["items"][0]["evalAmount"] is None

    def failed(codes):
        raise BrokerError("BROKER_UNAVAILABLE")

    monkeypatch.setattr(market, "get_quotes", failed)
    item = auth_client.get("/api/journal/positions").json()["items"][0]
    assert item["unrealizedPnl"] is None and item["costBasis"] == "20100"
