from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select, text

from app.core.time import today_kst
from app.modules.journal.models import Trade

PAYLOAD = {
    "tradedOn": "2026-09-01",
    "market": "KRX",
    "symbolCode": "005930",
    "symbolName": "삼성전자",
    "side": "buy",
    "quantity": "10",
    "price": "70000",
    "currency": "KRW",
    "fee": "100",
    "tax": "0",
}
NOTE = {
    "notedOn": "2026-09-01",
    "kind": "plan",
    "content": "장기 투자 계획",
    "tags": [" 장기 ", "장기", "계획"],
    "emotion": "calm",
}


def create(client, **patch):
    response = client.post("/api/journal/trades", json={**PAYLOAD, **patch})
    assert response.status_code == 201, response.text
    return response.json()


def test_trade_crud_filters_and_unknown_time(auth_client):
    trade = create(auth_client, symbolCode="aapl")
    assert trade["symbolCode"] == "AAPL"
    assert trade["tradedTime"] is None and trade["timeKnown"] is False
    assert trade["tradedAt"] == "2026-09-01T00:00:00Z"
    assert trade["source"] == "manual"
    assert trade["quantity"] == "10" and trade["price"] == "70000"
    id = trade["id"]
    response = auth_client.patch(
        f"/api/journal/trades/{id}", json={"tradedTime": "14:23", "price": "80000"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["tradedTime"] == "14:23"
    assert response.json()["price"] == "80000"
    detail = auth_client.get(f"/api/journal/trades/{id}").json()
    assert detail["realizedPnl"] is None and not detail["oversold"]
    assert (
        auth_client.get(
            "/api/journal/trades?symbol=삼성&from=2026-09-01&to=2026-09-01&pageSize=1"
        ).json()["total"]
        == 1
    )
    assert auth_client.get("/api/journal/trades?side=sell").json()["total"] == 0
    assert auth_client.get("/api/journal/trades?symbol=absent").json()["total"] == 0
    assert auth_client.get("/api/journal/trades?pageSize=101").status_code == 422
    assert (
        auth_client.delete(
            f"/api/journal/trades/{id}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.get(f"/api/journal/trades/{id}").status_code == 404


@pytest.mark.parametrize(
    ("patch", "field"),
    [
        ({"currency": "USD"}, "currency"),
        ({"quantity": "0"}, "quantity"),
        ({"price": "0"}, "price"),
        ({"fee": "-1"}, "fee"),
        ({"tradedOn": "1999-12-31"}, "tradedOn"),
        ({"tradedTime": "25:00"}, "tradedTime"),
        ({"symbolCode": "<bad>"}, "symbolCode"),
        ({"quantity": "0.1234567"}, "quantity"),
    ],
)
def test_validation(auth_client, patch, field):
    response = auth_client.post("/api/journal/trades", json={**PAYLOAD, **patch})
    assert response.status_code == 422, response.text
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["details"][0]["field"] == field
    if field == "currency":
        assert body["details"][0]["message"] == "시장과 통화가 맞지 않습니다."


def test_future_date_and_patch_validation(auth_client):
    response = auth_client.post(
        "/api/journal/trades",
        json={**PAYLOAD, "tradedOn": (today_kst() + timedelta(days=1)).isoformat()},
    )
    assert response.status_code == 422
    trade = create(auth_client)
    response = auth_client.patch(f"/api/journal/trades/{trade['id']}", json={"market": "US"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "currency"


def test_notes_crud_trade_delete_set_null(auth_client):
    trade = create(auth_client)
    response = auth_client.post(
        "/api/journal/notes", json={**NOTE, "tradeId": trade["id"], "symbolCode": "aapl"}
    )
    assert response.status_code == 201, response.text
    note = response.json()
    assert note["tags"] == ["장기", "계획"] and note["symbolCode"] == "AAPL"
    id = note["id"]
    assert len(auth_client.get(f"/api/journal/trades/{trade['id']}").json()["notes"]) == 1
    assert (
        auth_client.get(
            f"/api/journal/notes?tradeId={trade['id']}&kind=plan&from=2026-09-01&to=2026-09-01"
        ).json()["total"]
        == 1
    )
    response = auth_client.patch(
        f"/api/journal/notes/{id}", json={"content": "복기 완료", "kind": "review"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["content"] == "복기 완료"
    assert (
        auth_client.delete(
            f"/api/journal/trades/{trade['id']}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.get("/api/journal/notes").json()["items"][0]["tradeId"] is None
    assert (
        auth_client.delete(
            f"/api/journal/notes/{id}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert (
        auth_client.patch(f"/api/journal/notes/{id}", json={"content": "없음"}).status_code == 404
    )


def test_user_isolation(auth_client, other_auth_client):
    trade = create(auth_client)
    note = auth_client.post("/api/journal/notes", json={**NOTE, "tradeId": trade["id"]}).json()
    for method in ["get", "patch", "delete"]:
        kwargs = (
            {"json": {}} if method == "patch" else {"headers": {"Content-Type": "application/json"}}
        )
        response = getattr(other_auth_client, method)(
            f"/api/journal/trades/{trade['id']}", **kwargs
        )
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    for method in ["patch", "delete"]:
        kwargs = (
            {"json": {}} if method == "patch" else {"headers": {"Content-Type": "application/json"}}
        )
        assert (
            getattr(other_auth_client, method)(
                f"/api/journal/notes/{note['id']}", **kwargs
            ).status_code
            == 404
        )
    for method, path in [
        ("post", "/api/journal/notes"),
        ("patch", f"/api/journal/notes/{note['id']}"),
    ]:
        client = other_auth_client if method == "post" else auth_client
        target = trade["id"] if method == "post" else create(other_auth_client)["id"]
        response = getattr(client, method)(path, json={**NOTE, "tradeId": target})
        assert response.status_code == 422
        assert response.json()["error"]["details"][0]["field"] == "tradeId"
    assert other_auth_client.get("/api/journal/notes").json()["total"] == 0
    assert other_auth_client.get("/api/journal/positions").json()["items"][0]["tradeCount"] == 1
    assert other_auth_client.get(f"/api/journal/notes?tradeId={trade['id']}").status_code == 404


@pytest.mark.parametrize(
    "patch",
    [
        {"tags": [" "]},
        {"tags": [str(i) for i in range(11)]},
        {"tags": ["a" * 21]},
        {"content": ""},
        {"content": "x" * 5001},
        {"tradeId": str(uuid4())},
    ],
)
def test_note_validation(auth_client, patch):
    response = auth_client.post("/api/journal/notes", json={**NOTE, **patch})
    assert response.status_code == 422, response.text


def test_spec_calculation_through_api(auth_client):
    create(auth_client)
    create(auth_client, tradedOn="2026-09-02", price="80000")
    third = create(
        auth_client,
        tradedOn="2026-09-03",
        side="sell",
        quantity="5",
        price="90000",
        fee="100",
        tax="810",
    )
    positions = auth_client.get("/api/journal/positions").json()["items"]
    assert (
        positions[0]["quantity"],
        positions[0]["costBasis"],
        positions[0]["avgCost"],
        positions[0]["realizedPnl"],
    ) == ("15", "1125150", "75010", "74040")
    assert auth_client.get(f"/api/journal/trades/{third['id']}").json()["realizedPnl"] == "74040"
    fourth = create(
        auth_client, tradedOn="2026-09-04", side="sell", quantity="20", price="60000", fee="0"
    )
    detail = auth_client.get(f"/api/journal/trades/{fourth['id']}").json()
    assert detail["realizedPnl"] == "-225150" and detail["oversold"]
    assert auth_client.get("/api/journal/positions").json()["items"] == []
    assert auth_client.get("/api/journal/positions?includeClosed=true").json()["items"][0][
        "hasOversold"
    ]
    summary = auth_client.get("/api/journal/stats").json()["byCurrency"][0]
    assert (summary["realizedPnl"], summary["winRate"], summary["sellCount"]) == ("-151110", 50, 2)
    filtered = auth_client.get("/api/journal/stats?from=2026-09-03&to=2026-09-03").json()
    assert filtered["byCurrency"][0]["realizedPnl"] == "74040"


def test_same_day_order_is_created_at_then_id(auth_client, db):
    first = create(auth_client)
    second = create(auth_client, side="sell", quantity="1", price="80000", fee="0")
    assert auth_client.get(f"/api/journal/trades/{second['id']}").json()["realizedPnl"] == "9990"
    rows = list(db.scalars(select(Trade).order_by(Trade.created_at)))
    assert str(rows[0].id) == first["id"]


def test_partial_unique_index_and_currency_format(auth_client, db):
    usd = create(
        auth_client,
        market="US",
        currency="USD",
        price="10.005",
        quantity="0.123456",
        fee="0.001",
        symbolCode="aapl",
    )
    assert (usd["price"], usd["fee"], usd["quantity"]) == ("10.01", "0.00", "0.123456")
    # 부분 수정 시 응답 반올림 값이 DB 원본을 덮어쓰지 않는다.
    assert (
        auth_client.patch(
            f"/api/journal/trades/{usd['id']}", json={"symbolName": "애플"}
        ).status_code
        == 200
    )
    assert db.scalar(select(Trade.price).where(Trade.id == usd["id"])) == Decimal("10.005")
    index = db.execute(
        text("SELECT indexdef FROM pg_indexes WHERE indexname='uq_trades_user_dedup'")
    ).scalar_one()
    assert "UNIQUE" in index and "dedup_hash IS NOT NULL" in index


def test_auth_required(client):
    for path in ["trades", "notes", "positions", "stats"]:
        assert client.get(f"/api/journal/{path}").status_code == 401
