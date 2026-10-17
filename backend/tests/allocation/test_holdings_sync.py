"""잔고 동기화·분류·호출자 트랜잭션·사용자 격리 회귀 테스트."""

from dataclasses import replace
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from freezegun import freeze_time

from app.core.domain import AssetClass
from app.core.errors import AppError
from app.integrations.brokers.base import BrokerHolding
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.modules.allocation import service
from app.modules.allocation.classify import CLASSIFICATION_RULES, classify_holding
from tests.allocation.helpers import add_holding, assess

BASE = "/api/allocation/holdings"


def connection(client, *, verify=True, label="동기화 테스트"):
    response = client.post(
        "/api/market/connections",
        json={
            "provider": "mock",
            "environment": "mock",
            "label": label,
            "appKey": "sample-key",
            "appSecret": "sample-secret",
        },
    )
    assert response.status_code == 201, response.text
    cid = response.json()["id"]
    if verify:
        assert (
            client.post(f"/api/market/connections/{cid}/verify", json={}).json()["status"]
            == "active"
        )
    return cid


def sync(client, cid):
    return client.post(f"{BASE}/sync", json={"connectionId": cid})


@pytest.mark.parametrize(
    "name,asset_class,keyword",
    [
        ("KODEX 200", "stock", None),
        ("TIGER 미국채10년선물", "bond", "국채"),
        ("ACE KRX금현물", "gold", "금현물"),
        ("KODEX CD금리액티브", "cash", "CD금리"),
        ("TIGER 리츠부동산인프라", "other", "리츠"),
        ("sofr BOND GOLD REIT", "cash", "SOFR"),
        ("Bond Gold", "bond", "BOND"),
        ("gold reit", "gold", "GOLD"),
        ("금융 은행", "stock", None),
    ],
)
def test_classification(name, asset_class, keyword):
    assert classify_holding(name) == (AssetClass(asset_class), keyword)


def test_every_keyword_and_no_single_character():
    for asset_class, keywords in CLASSIFICATION_RULES:
        for keyword in keywords:
            assert len(keyword) > 1
            assert classify_holding(keyword.lower())[0] == asset_class


@freeze_time("2026-10-17T01:00:00Z")
def test_mock_sync_idempotent_and_changes_score(auth_client):
    assess(auth_client)
    add_holding(auth_client, "gold", 10_000_000)
    before = auth_client.get("/api/allocation/report").json()
    cid = connection(auth_client)
    first = sync(auth_client, cid)
    assert first.status_code == 200, first.text
    assert first.json() == {
        "created": 6,
        "updated": 0,
        "removed": 0,
        "skipped": [],
        "syncedAt": "2026-10-17T01:00:00Z",
    }
    rows = auth_client.get(BASE).json()["items"]
    assert len(rows) == 7
    synced = [row for row in rows if row["connectionId"] == cid]
    assert all(row["source"] == "mock" and not row["classOverride"] for row in synced)
    cash = next(row for row in synced if row["name"].startswith("예수금"))
    assert cash["assetClass"] == "cash" and cash["amount"] == 5_000_000
    after = auth_client.get("/api/allocation/report").json()
    assert after["score"] != before["score"]
    assert after["totalAmount"] > before["totalAmount"]
    second = sync(auth_client, cid).json()
    assert (second["created"], second["updated"], second["removed"]) == (0, 6, 0)
    assert auth_client.get(BASE).json()["items"] == rows
    assert len(auth_client.get("/api/allocation/scores").json()["items"]) == 1


def test_removed_foreign_skipped_no_cash_and_connection_scope(auth_client, monkeypatch):
    cid = connection(auth_client)
    other_cid = connection(auth_client, label="다른 연결")
    sync(auth_client, cid)
    sync(auth_client, other_cid)
    manual = add_holding(auth_client, "cash", 123)
    original = MockBroker().get_holdings()
    foreign = BrokerHolding(
        code="AAPL",
        name="Apple",
        market="US",
        quantity=Decimal(1),
        avg_price=None,
        eval_amount=None,
        currency="USD",
    )
    renamed = replace(original.holdings[0], name="가" * 60, eval_amount=4321)
    monkeypatch.setattr(
        MockBroker,
        "get_holdings",
        lambda self: replace(original, holdings=[renamed, foreign], cash_krw=None),
    )
    result = sync(auth_client, cid).json()
    assert result["created"] == 0 and result["updated"] == 1 and result["removed"] == 5
    assert result["skipped"] == [
        {"name": "Apple", "reason": "원화 평가금액이 없어 건너뛰었습니다."}
    ]
    rows = auth_client.get(BASE).json()["items"]
    assert len([row for row in rows if row["connectionId"] == other_cid]) == 6
    assert next(row for row in rows if row["id"] == manual["id"])["amount"] == 123
    kept = next(row for row in rows if row["connectionId"] == cid)
    assert kept["name"] == "가" * 50 and kept["amount"] == 4321


def test_override_read_only_delete_and_recreate(auth_client, monkeypatch):
    cid = connection(auth_client)
    sync(auth_client, cid)
    row = next(row for row in auth_client.get(BASE).json()["items"] if row["assetClass"] == "stock")
    path = f"{BASE}/{row['id']}"
    assert auth_client.patch(path, json={"assetClass": "stock"}).json()["classOverride"] is False
    changed = auth_client.patch(
        path, json={"assetClass": "other", "includeInAllocation": False, "memo": "직접 분류"}
    )
    assert changed.json()["classOverride"] is True
    for body in ({"amount": 0}, {"name": "직접 수정"}):
        blocked = auth_client.patch(path, json=body)
        assert blocked.status_code == 409
        assert blocked.json()["error"]["code"] == "CONFLICT"
    snapshot = MockBroker().get_holdings()
    monkeypatch.setattr(
        MockBroker,
        "get_holdings",
        lambda self: replace(
            snapshot,
            holdings=[replace(item, name="GOLD", eval_amount=100) for item in snapshot.holdings],
        ),
    )
    sync(auth_client, cid)
    refreshed = next(
        item for item in auth_client.get(BASE).json()["items"] if item["id"] == row["id"]
    )
    assert refreshed["assetClass"] == "other" and refreshed["classOverride"] is True
    assert refreshed["name"] == "GOLD" and refreshed["amount"] == 100
    assert refreshed["includeInAllocation"] is False and refreshed["memo"] == "직접 분류"
    assert (
        auth_client.request(
            "DELETE", path, headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert sync(auth_client, cid).json()["created"] == 1


def test_connection_and_synced_holding_isolation(auth_client, other_auth_client):
    cid = connection(auth_client)
    assert sync(other_auth_client, cid).status_code == 404
    assert sync(auth_client, str(uuid4())).status_code == 404
    sync(auth_client, cid)
    row = auth_client.get(BASE).json()["items"][0]
    path = f"{BASE}/{row['id']}"
    assert other_auth_client.patch(path, json={"assetClass": "gold"}).status_code == 404
    assert (
        other_auth_client.request(
            "DELETE", path, headers={"Content-Type": "application/json"}
        ).status_code
        == 404
    )
    assert other_auth_client.get(BASE).json() == {"items": []}


def test_inactive_connection(auth_client):
    assert sync(auth_client, connection(auth_client, verify=False)).status_code == 409


@pytest.mark.parametrize(
    "code,status",
    [
        ("BROKER_NOT_SUPPORTED", 501),
        ("BROKER_IP_NOT_ALLOWED", 502),
        ("BROKER_RATE_LIMITED", 503),
        ("BROKER_UNAVAILABLE", 502),
        ("BROKER_AUTH_FAILED", 502),
    ],
)
def test_broker_error_translation_preserves_holdings(auth_client, monkeypatch, code, status):
    cid = connection(auth_client)
    sync(auth_client, cid)
    before = auth_client.get(BASE).json()

    def fail(self):
        raise BrokerError(code)

    monkeypatch.setattr(MockBroker, "get_holdings", fail)
    result = sync(auth_client, cid)
    assert result.status_code == status
    assert result.json()["error"]["code"] == code
    assert auth_client.get(BASE).json() == before


def test_codef_flush_only_and_rollback(auth_client, db, monkeypatch):
    uid = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    cid = uuid4()
    assess(auth_client)
    commits = []
    monkeypatch.setattr(db, "commit", lambda: commits.append(True))
    with db.begin_nested() as transaction:
        result = service.upsert_synced_holdings(
            db,
            uid,
            source="codef",
            connection_id=cid,
            items=[service.SyncedHolding("masked-ref", "연결 계좌", 1000, AssetClass.CASH)],
        )
        assert result.created == 1
        assert service.get_asset_breakdown(db, uid).included_total == 1000
        assert service.list_scores(db, uid, 180).items
        transaction.rollback()
    assert service.list_holdings(db, uid).items == []
    assert service.list_scores(db, uid, 180).items == []
    assert commits == []


@pytest.mark.parametrize("amount", [-1, 1.2, True, "123"])
def test_invalid_sync_amount_atomic(auth_client, db, amount):
    uid = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    with pytest.raises(AppError) as error:
        service.upsert_synced_holdings(
            db,
            uid,
            source="codef",
            connection_id=uuid4(),
            items=[
                service.SyncedHolding("valid", "유효 자산", 1),
                service.SyncedHolding("invalid", "잘못된 자산", amount),
            ],
        )
    assert error.value.status_code == 422
    assert error.value.details[0].field == "items.1.amount"
    assert service.list_holdings(db, uid).items == []
