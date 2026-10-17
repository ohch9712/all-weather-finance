from uuid import uuid4

import pytest
from sqlalchemy import select

from app.modules.ledger import repository
from app.modules.ledger.models import LedgerCategory
from tests.ledger.helpers import add_entry, category_ids, error_of, send_delete

EXPENSE_DEFAULTS = [
    "식비",
    "카페·간식",
    "교통",
    "주거·관리비",
    "통신",
    "쇼핑",
    "생활용품",
    "의료·건강",
    "교육",
    "문화·여가",
    "여행",
    "경조사·선물",
    "보험",
    "세금·공과금",
    "금융·수수료",
    "기타 지출",
]
INCOME_DEFAULTS = ["급여", "상여", "부수입", "금융수입", "용돈·지원", "기타 수입"]


def test_default_categories_seeded_and_visible_to_everyone(db, auth_client, other_auth_client):
    rows = db.scalars(
        select(LedgerCategory)
        .where(LedgerCategory.user_id.is_(None))
        .order_by(LedgerCategory.kind, LedgerCategory.sort_order)
    ).all()
    assert len(rows) == 22
    assert [r.name for r in rows if r.kind == "expense"] == EXPENSE_DEFAULTS
    assert [r.name for r in rows if r.kind == "income"] == INCOME_DEFAULTS

    for client in (auth_client, other_auth_client):
        response = client.get("/api/ledger/categories")
        assert response.status_code == 200
        items = response.json()["items"]
        assert [i["name"] for i in items] == EXPENSE_DEFAULTS + INCOME_DEFAULTS
        assert all(i["isDefault"] for i in items)
        assert set(items[0]) == {"id", "kind", "name", "isDefault", "sortOrder"}
        assert items[0]["sortOrder"] < items[1]["sortOrder"]


def test_create_category_and_order(auth_client):
    response = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "  반려동물 "}
    )
    assert response.status_code == 201
    created = response.json()
    assert created == {
        "id": created["id"],
        "kind": "expense",
        "name": "반려동물",
        "isDefault": False,
        "sortOrder": 0,
    }
    auth_client.post("/api/ledger/categories", json={"kind": "expense", "name": "구독"})
    auth_client.post("/api/ledger/categories", json={"kind": "income", "name": "중고 판매"})
    names = [i["name"] for i in auth_client.get("/api/ledger/categories").json()["items"]]
    # 종류 → 기본 먼저 → sort_order → 이름
    assert names == EXPENSE_DEFAULTS + ["구독", "반려동물"] + INCOME_DEFAULTS + ["중고 판매"]


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "expense", "name": "식비"},  # 기본 카테고리와 같은 이름
        {"kind": "income", "name": "기타 수입"},
        {"kind": "expense", "name": "반려동물"},  # 내 카테고리와 같은 이름
        {"kind": "expense", "name": " 반려동물  "},
    ],
)
def test_create_category_conflict(auth_client, body):
    auth_client.post("/api/ledger/categories", json={"kind": "expense", "name": "반려동물"})
    error = error_of(auth_client.post("/api/ledger/categories", json=body), 409)
    assert error == {"code": "CONFLICT", "message": "이미 있는 카테고리입니다.", "details": []}


def test_same_name_allowed_for_other_kind_and_other_user(auth_client, other_auth_client):
    body = {"kind": "income", "name": "식비"}
    assert auth_client.post("/api/ledger/categories", json=body).status_code == 201
    assert other_auth_client.post("/api/ledger/categories", json=body).status_code == 201


@pytest.mark.parametrize(
    "body,field",
    [
        ({"kind": "expense", "name": ""}, "name"),
        ({"kind": "expense", "name": "   "}, "name"),
        ({"kind": "expense", "name": "가" * 21}, "name"),
        ({"kind": "expense"}, "name"),
        ({"kind": "transfer", "name": "이체"}, "kind"),
    ],
)
def test_create_category_validation(auth_client, body, field):
    error = error_of(auth_client.post("/api/ledger/categories", json=body), 422)
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["field"] == field


def test_twenty_character_name_allowed(auth_client):
    body = {"kind": "expense", "name": "가" * 20}
    assert auth_client.post("/api/ledger/categories", json=body).status_code == 201


def test_rename_category(auth_client):
    created = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "반려동물"}
    ).json()
    path = f"/api/ledger/categories/{created['id']}"
    response = auth_client.patch(path, json={"name": "반려견"})
    assert response.status_code == 200
    assert response.json() == {**created, "name": "반려견"}
    # 자기 이름 그대로는 충돌이 아니다.
    assert auth_client.patch(path, json={"name": "반려견"}).status_code == 200
    error = error_of(auth_client.patch(path, json={"name": "교통"}), 409)
    assert error["message"] == "이미 있는 카테고리입니다."
    assert error_of(auth_client.patch(path, json={"name": " "}), 422)["details"][0] == {
        "field": "name",
        "message": "길이를 확인해 주세요.",
    }


def test_default_category_cannot_be_changed(auth_client):
    default_id = category_ids(auth_client)[("expense", "식비")]
    path = f"/api/ledger/categories/{default_id}"
    message = "기본 카테고리는 수정하거나 삭제할 수 없습니다."
    for response in (auth_client.patch(path, json={"name": "밥"}), send_delete(auth_client, path)):
        assert error_of(response, 409) == {"code": "CONFLICT", "message": message, "details": []}
    assert ("expense", "식비") in category_ids(auth_client)


def test_delete_category_moves_entries_to_fallback(auth_client):
    pet = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "반려동물"}
    ).json()
    side = auth_client.post(
        "/api/ledger/categories", json={"kind": "income", "name": "강연"}
    ).json()
    pet_entry = add_entry(auth_client, "반려동물", merchant="동물병원")
    side_entry = add_entry(auth_client, "강연", kind="income", amount=300000)
    other_entry = add_entry(auth_client, "식비")

    assert send_delete(auth_client, f"/api/ledger/categories/{pet['id']}").status_code == 204
    assert send_delete(auth_client, f"/api/ledger/categories/{side['id']}").status_code == 204

    ids = category_ids(auth_client)
    assert ("expense", "반려동물") not in ids and ("income", "강연") not in ids
    moved = auth_client.get(f"/api/ledger/entries/{pet_entry['id']}").json()
    assert (moved["categoryId"], moved["categoryName"]) == (
        ids[("expense", "기타 지출")],
        "기타 지출",
    )
    moved = auth_client.get(f"/api/ledger/entries/{side_entry['id']}").json()
    assert (moved["categoryId"], moved["categoryName"]) == (
        ids[("income", "기타 수입")],
        "기타 수입",
    )
    untouched = auth_client.get(f"/api/ledger/entries/{other_entry['id']}").json()
    assert untouched["categoryName"] == "식비"
    # 지운 카테고리는 다시 지울 수 없다.
    assert error_of(send_delete(auth_client, f"/api/ledger/categories/{pet['id']}"), 404)


def test_delete_category_is_one_transaction(auth_client, monkeypatch):
    pet = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "반려동물"}
    ).json()
    entry = add_entry(auth_client, "반려동물")

    def broken_remove(db, entity):
        raise RuntimeError("삭제 실패")

    monkeypatch.setattr(repository, "remove", broken_remove)
    assert send_delete(auth_client, f"/api/ledger/categories/{pet['id']}").status_code == 500
    monkeypatch.undo()
    # 옮기기도 함께 되돌아간다.
    assert (
        auth_client.get(f"/api/ledger/entries/{entry['id']}").json()["categoryName"] == "반려동물"
    )
    assert ("expense", "반려동물") in category_ids(auth_client)


def test_other_users_category_is_not_found(auth_client, other_auth_client):
    mine = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "반려동물"}
    ).json()
    path = f"/api/ledger/categories/{mine['id']}"
    assert ("expense", "반려동물") not in category_ids(other_auth_client)
    for response in (
        other_auth_client.patch(path, json={"name": "남의 것"}),
        send_delete(other_auth_client, path),
        auth_client.patch(f"/api/ledger/categories/{uuid4()}", json={"name": "없음"}),
        send_delete(auth_client, f"/api/ledger/categories/{uuid4()}"),
    ):
        assert error_of(response, 404)["code"] == "NOT_FOUND"
    assert auth_client.get("/api/ledger/categories").status_code == 200
    assert ("expense", "반려동물") in category_ids(auth_client)


def test_categories_require_auth_and_json(client, auth_client):
    assert error_of(client.get("/api/ledger/categories"), 401)["code"] == "UNAUTHENTICATED"
    response = auth_client.post(
        "/api/ledger/categories",
        content='{"kind": "expense", "name": "반려동물"}',
        headers={"Content-Type": "text/plain"},
    )
    assert error_of(response, 422)["code"] == "VALIDATION_ERROR"
    mine = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "반려동물"}
    ).json()
    # 본문 없는 DELETE도 JSON 형식을 요구한다.
    response = auth_client.delete(f"/api/ledger/categories/{mine['id']}")
    assert error_of(response, 422)["details"][0]["field"] == "body"
    assert ("expense", "반려동물") in category_ids(auth_client)
