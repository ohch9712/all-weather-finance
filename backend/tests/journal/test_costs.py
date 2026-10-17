from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.modules.journal.service import estimate_trade_costs

RATES = {"krxCommissionRate": "0.015", "krxSellTaxRate": "0.20", "usCommissionRate": "0.25"}
TRADE = {
    "tradedOn": "2026-09-01",
    "market": "KRX",
    "symbolCode": "005930",
    "symbolName": "삼성전자",
    "side": "sell",
    "quantity": "10",
    "price": "70000",
    "currency": "KRW",
}


def estimate(client, **patch):
    params = {
        "market": "KRX",
        "side": "sell",
        "quantity": "10",
        "price": "70000",
        "symbolCode": "005930",
        **patch,
    }
    return client.get(
        "/api/journal/cost-estimate",
        params={key: value for key, value in params.items() if value is not None},
    )


def test_settings_defaults_save_reset_and_isolation(auth_client, other_auth_client):
    defaults = auth_client.get("/api/journal/cost-settings").json()
    assert defaults == {**RATES, "isDefault": True, "updatedAt": None}
    response = auth_client.put(
        "/api/journal/cost-settings", json={**RATES, "krxCommissionRate": "1.1234"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["krxCommissionRate"] == "1.1234"
    assert not response.json()["isDefault"] and response.json()["updatedAt"]
    assert auth_client.get("/api/journal/cost-settings").json() == response.json()
    assert other_auth_client.get("/api/journal/cost-settings").json() == defaults
    other_auth_client.put("/api/journal/cost-settings", json={**RATES, "usCommissionRate": "0"})
    assert auth_client.get("/api/journal/cost-settings").json()["usCommissionRate"] == "0.2500"
    assert (
        auth_client.delete(
            "/api/journal/cost-settings", headers={"Content-Type": "application/json"}
        ).json()
        == defaults
    )
    assert (
        other_auth_client.get("/api/journal/cost-settings").json()["usCommissionRate"] == "0.0000"
    )
    assert (
        auth_client.delete(
            "/api/journal/cost-settings", headers={"Content-Type": "application/json"}
        ).json()
        == defaults
    )


@pytest.mark.parametrize("field", list(RATES))
@pytest.mark.parametrize("value", ["-0.1", "5.0001", "0.00001", "NaN", "Infinity", "bad", None])
def test_rate_validation(auth_client, field, value):
    response = auth_client.put("/api/journal/cost-settings", json={**RATES, field: value})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["details"][0]["field"] == field


@pytest.mark.parametrize("value", ["0", "5", "0.1234"])
def test_rate_boundaries(auth_client, value):
    assert (
        auth_client.put("/api/journal/cost-settings", json=dict.fromkeys(RATES, value)).status_code
        == 200
    )


@pytest.mark.parametrize(
    ("market", "side", "price", "etf", "fee", "tax"),
    [
        ("KRX", "buy", "70000", False, "105", "0"),
        ("KRX", "sell", "70000", False, "105", "1400"),
        ("KRX", "sell", "70000", True, "105", "0"),
        ("KRX", "sell", "70001", False, "105", "1400"),
        ("US", "buy", "150.37", False, "3.75", "0.00"),
        ("US", "sell", "150.37", False, "3.75", "0.00"),
    ],
)
def test_cost_calculation(db, market, side, price, etf, fee, tax):
    from uuid import uuid4

    costs = estimate_trade_costs(
        db,
        uuid4(),
        market=market,
        side=side,
        quantity=Decimal(10),
        price=Decimal(price),
        is_etf=etf,
    )
    assert costs.fee == Decimal(fee) and costs.tax == Decimal(tax)


@pytest.mark.parametrize(
    ("items", "symbol", "market", "expected"),
    [
        ([SimpleNamespace(code="069500", kind="etf")], "069500", "KRX", True),
        ([SimpleNamespace(code="069501", kind="etf")], "069500", "KRX", False),
        ([SimpleNamespace(code="005930", kind="stock")], "005930", "KRX", False),
        ([], "unknown", "KRX", False),
        ([], None, "KRX", False),
        ([SimpleNamespace(code="AAPL", kind="etf")], "AAPL", "US", False),
    ],
)
def test_estimate_etf_search_only(auth_client, monkeypatch, items, symbol, market, expected):
    calls = []

    def search(db, query, *, limit):
        calls.append((query, limit))
        return items

    def forbidden(*args, **kwargs):
        pytest.fail("추정에서 시세 조회를 하면 안 됩니다.")

    monkeypatch.setattr("app.modules.market.service.search_stocks", search)
    monkeypatch.setattr("app.modules.market.service.get_stock_detail", forbidden)
    response = estimate(auth_client, symbolCode=symbol, market=market)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["isEtf"] is expected
    assert Decimal(body["tax"]) == (0 if expected or market == "US" else 1400)
    assert calls == ([(symbol, 1)] if symbol and market == "KRX" else [])


@pytest.mark.parametrize(
    "patch",
    [{"quantity": "0"}, {"price": "0"}, {"quantity": "-1"}, {"market": "OTHER"}, {"side": "bad"}],
)
def test_estimate_validation(auth_client, patch):
    assert estimate(auth_client, **patch).status_code == 422


def test_custom_rates_future_only_and_patch(auth_client):
    first = auth_client.post("/api/journal/trades", json=TRADE).json()
    assert (first["fee"], first["tax"], first["costEstimated"]) == ("105", "1400", True)
    auth_client.put(
        "/api/journal/cost-settings",
        json={**RATES, "krxCommissionRate": "1", "krxSellTaxRate": "0"},
    )
    assert estimate(auth_client).json()["fee"] == "7000"
    next_trade = auth_client.post("/api/journal/trades", json=TRADE).json()
    assert (next_trade["fee"], next_trade["tax"]) == ("7000", "0")
    url = f"/api/journal/trades/{first['id']}"
    detail = auth_client.get(url).json()["trade"]
    assert (detail["fee"], detail["tax"], detail["costEstimated"]) == ("105", "1400", True)
    assert auth_client.patch(url, json={"symbolName": "새 이름"}).json()["costEstimated"]
    assert auth_client.patch(url, json={"price": "71000"}).json()["fee"] == "105"
    assert auth_client.patch(url, json={"fee": "0"}).json()["costEstimated"] is False


@pytest.mark.parametrize(
    ("patch", "fee", "tax", "estimated"),
    [
        ({"fee": "0", "tax": "0"}, "0", "0", False),
        ({"fee": "7"}, "7", "1400", True),
        ({"tax": "8"}, "105", "8", True),
        ({"market": "OTHER"}, "0", "0", False),
    ],
)
def test_creation_preserves_explicit_costs(auth_client, patch, fee, tax, estimated):
    response = auth_client.post("/api/journal/trades", json={**TRADE, **patch})
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["fee"], body["tax"], body["costEstimated"]) == (fee, tax, estimated)


def test_create_etf_and_tax_patch(auth_client, monkeypatch):
    monkeypatch.setattr(
        "app.modules.market.service.search_stocks",
        lambda *a, **kw: [SimpleNamespace(code="069500", kind="etf")],
    )
    body = auth_client.post("/api/journal/trades", json={**TRADE, "symbolCode": "069500"}).json()
    assert body["tax"] == "0" and body["costEstimated"]
    assert (
        auth_client.patch(f"/api/journal/trades/{body['id']}", json={"tax": "10"}).json()[
            "costEstimated"
        ]
        is False
    )


def test_cost_auth_required(client):
    assert client.get("/api/journal/cost-settings").status_code == 401
    assert client.put("/api/journal/cost-settings", json=RATES).status_code == 401
    assert (
        client.delete(
            "/api/journal/cost-settings", headers={"Content-Type": "application/json"}
        ).status_code
        == 401
    )
    assert estimate(client).status_code == 401
