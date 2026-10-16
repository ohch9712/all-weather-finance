"""보유 자산 CRUD·일괄 생성·자산 합계(스펙 02 7.6, 8절 get_asset_breakdown)."""

from uuid import UUID, uuid4

import pytest

from app.core.domain import AssetClass
from app.modules.allocation import service
from app.modules.auth.models import User
from tests.allocation.helpers import add_holding, assess, error_fields, score_rows

HOLDING_KEYS = [
    "id",
    "name",
    "assetClass",
    "amount",
    "includeInAllocation",
    "source",
    "memo",
    "createdAt",
    "updatedAt",
]


def user_id(db, email: str) -> UUID:
    return db.query(User).filter(User.email == email).one().id


def test_holding_crud(auth_client):
    assert auth_client.get("/api/allocation/holdings").json() == {"items": []}
    created = auth_client.post(
        "/api/allocation/holdings",
        json={
            "name": "  비상금 통장  ",
            "assetClass": "cash",
            "amount": 5_000_000,
            "includeInAllocation": True,
            "memo": None,
        },
    )
    assert created.status_code == 201
    holding = created.json()
    assert list(holding) == HOLDING_KEYS
    assert holding["name"] == "비상금 통장"
    assert holding["source"] == "manual"
    assert holding["createdAt"].endswith("Z")

    second = add_holding(auth_client, "stock", 10_000_000, name="국내주식")
    items = auth_client.get("/api/allocation/holdings").json()["items"]
    assert [item["id"] for item in items] == [holding["id"], second["id"]]

    patched = auth_client.patch(
        f"/api/allocation/holdings/{holding['id']}",
        json={"amount": 7_000_000, "memo": "파킹통장"},
    )
    assert patched.status_code == 200
    assert patched.json()["amount"] == 7_000_000
    assert patched.json()["memo"] == "파킹통장"
    assert patched.json()["name"] == "비상금 통장"
    assert patched.json()["assetClass"] == "cash"

    cleared = auth_client.patch(
        f"/api/allocation/holdings/{holding['id']}",
        json={"memo": None, "includeInAllocation": False, "assetClass": "other"},
    )
    assert cleared.json()["memo"] is None
    assert cleared.json()["includeInAllocation"] is False
    assert cleared.json()["assetClass"] == "other"
    assert cleared.json()["amount"] == 7_000_000

    deleted = auth_client.request(
        "DELETE",
        f"/api/allocation/holdings/{holding['id']}",
        headers={"Content-Type": "application/json"},
    )
    assert deleted.status_code == 204
    assert deleted.content == b""
    items = auth_client.get("/api/allocation/holdings").json()["items"]
    assert [item["id"] for item in items] == [second["id"]]


def test_holding_defaults(auth_client):
    response = auth_client.post(
        "/api/allocation/holdings", json={"name": "금 ETF", "assetClass": "gold", "amount": 0}
    )
    assert response.status_code == 201
    assert response.json()["includeInAllocation"] is True
    assert response.json()["memo"] is None


@pytest.mark.parametrize(
    "payload,field,message",
    [
        ({"name": "   "}, "name", "이름은 1~50자로 입력해 주세요."),
        ({"name": "가" * 51}, "name", "이름은 1~50자로 입력해 주세요."),
        ({"name": 3}, "name", "형식이 올바르지 않습니다."),
        ({"assetClass": "crypto"}, "assetClass", "형식이 올바르지 않습니다."),
        ({"amount": -1}, "amount", "허용 범위를 벗어났습니다."),
        ({"amount": 1_000_000_000_001}, "amount", "허용 범위를 벗어났습니다."),
        ({"amount": 1.5}, "amount", "형식이 올바르지 않습니다."),
        ({"amount": "1000"}, "amount", "형식이 올바르지 않습니다."),
        ({"memo": "가" * 201}, "memo", "메모는 200자 이내로 입력해 주세요."),
        ({"includeInAllocation": "yes"}, "includeInAllocation", "형식이 올바르지 않습니다."),
    ],
)
def test_holding_validation(auth_client, payload, field, message):
    body = {"name": "자산", "assetClass": "cash", "amount": 1000, **payload}
    response = auth_client.post("/api/allocation/holdings", json=body)
    assert response.status_code == 422
    assert error_fields(response) == [(field, message)]
    holding = add_holding(auth_client, "cash", 1000)
    response = auth_client.patch(f"/api/allocation/holdings/{holding['id']}", json=payload)
    assert response.status_code == 422
    assert error_fields(response) == [(field, message)]


def test_holding_limits_accepted(auth_client):
    holding = add_holding(auth_client, "stock", 1_000_000_000_000, name="가" * 50, memo="메" * 200)
    assert holding["amount"] == 1_000_000_000_000


@pytest.mark.parametrize("field", ["name", "assetClass", "amount", "includeInAllocation"])
def test_holding_patch_rejects_null(auth_client, field):
    holding = add_holding(auth_client, "cash", 1000)
    response = auth_client.patch(f"/api/allocation/holdings/{holding['id']}", json={field: None})
    assert response.status_code == 422


def test_holding_other_user_404(auth_client, other_auth_client):
    holding = add_holding(auth_client, "cash", 1000)
    path = f"/api/allocation/holdings/{holding['id']}"
    for response in [
        other_auth_client.patch(path, json={"amount": 1}),
        other_auth_client.request("DELETE", path, headers={"Content-Type": "application/json"}),
        auth_client.patch(f"/api/allocation/holdings/{uuid4()}", json={"amount": 1}),
        auth_client.request(
            "DELETE",
            f"/api/allocation/holdings/{uuid4()}",
            headers={"Content-Type": "application/json"},
        ),
    ]:
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    assert other_auth_client.get("/api/allocation/holdings").json() == {"items": []}
    assert auth_client.get("/api/allocation/holdings").json()["items"][0]["amount"] == 1000


def bulk_item(index: int, **overrides):
    return {
        "name": f"자산 {index}",
        "assetClass": "cash",
        "amount": 1000 * (index + 1),
        "includeInAllocation": True,
        "memo": None,
        **overrides,
    }


def test_bulk_create_keeps_request_order(auth_client, db, monkeypatch):
    assess(auth_client)
    calls = []
    original = service.get_allocation_report
    monkeypatch.setattr(
        service, "get_allocation_report", lambda *args: calls.append(1) or original(*args)
    )
    items = [bulk_item(index) for index in range(20)]
    response = auth_client.post("/api/allocation/holdings/bulk", json={"items": items})
    assert response.status_code == 201
    created = response.json()["items"]
    assert [item["name"] for item in created] == [f"자산 {index}" for index in range(20)]
    assert all(list(item) == HOLDING_KEYS for item in created)
    listed = auth_client.get("/api/allocation/holdings").json()["items"]
    assert [item["id"] for item in listed] == [item["id"] for item in created]
    assert calls == [1]  # 스냅샷 갱신은 한 번
    assert score_rows(db) == 1


def test_bulk_create_all_or_nothing(auth_client):
    items = [bulk_item(0), bulk_item(1, amount=-5), bulk_item(2, name=" ", assetClass="coin")]
    response = auth_client.post("/api/allocation/holdings/bulk", json={"items": items})
    assert response.status_code == 422
    assert error_fields(response) == [
        ("items.1.amount", "허용 범위를 벗어났습니다."),
        ("items.2.name", "이름은 1~50자로 입력해 주세요."),
        ("items.2.assetClass", "형식이 올바르지 않습니다."),
    ]
    assert auth_client.get("/api/allocation/holdings").json() == {"items": []}

    missing = auth_client.post(
        "/api/allocation/holdings/bulk", json={"items": [{"name": "현금"}, "문자열"]}
    )
    assert missing.status_code == 422
    assert error_fields(missing) == [
        ("items.0.assetClass", "필수 항목입니다."),
        ("items.0.amount", "필수 항목입니다."),
        ("items.1", "형식이 올바르지 않습니다."),
    ]


@pytest.mark.parametrize("count", [0, 21])
def test_bulk_create_count_limits(auth_client, count):
    items = [bulk_item(index) for index in range(count)]
    response = auth_client.post("/api/allocation/holdings/bulk", json={"items": items})
    assert response.status_code == 422
    assert error_fields(response) == [("items", "자산은 한 번에 1~20개까지 입력할 수 있어요.")]
    assert auth_client.get("/api/allocation/holdings").json() == {"items": []}


def test_get_asset_breakdown(auth_client, other_auth_client, db):
    add_holding(auth_client, "stock", 26_000_000)
    add_holding(auth_client, "stock", 4_000_000)
    add_holding(auth_client, "cash", 20_000_000)
    add_holding(auth_client, "bond", 0)
    add_holding(auth_client, "other", 300_000_000, name="실거주 주택", include=False)
    add_holding(other_auth_client, "gold", 9_999)
    result = service.get_asset_breakdown(db, user_id(db, "first@example.com"))
    assert result == service.AssetBreakdown(
        included_by_class={
            AssetClass.STOCK: 30_000_000,
            AssetClass.BOND: 0,
            AssetClass.GOLD: 0,
            AssetClass.CASH: 20_000_000,
            AssetClass.OTHER: 0,
        },
        included_total=50_000_000,
        excluded_total=300_000_000,
    )
    empty = service.get_asset_breakdown(db, uuid4())
    assert list(empty.included_by_class) == list(AssetClass)
    assert empty.included_total == 0
    assert empty.excluded_total == 0
