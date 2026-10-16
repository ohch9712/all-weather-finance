from uuid import uuid4

import pytest
from freezegun import freeze_time

from tests.ledger.helpers import add_entry, category_ids, error_of

ENTRY_FIELDS = {
    "id",
    "kind",
    "occurredOn",
    "amount",
    "categoryId",
    "categoryName",
    "merchant",
    "paymentMethod",
    "memo",
    "source",
    "createdAt",
    "updatedAt",
}


def test_entry_crud(auth_client):
    food = category_ids(auth_client)[("expense", "식비")]
    response = auth_client.post(
        "/api/ledger/entries",
        json={
            "kind": "expense",
            "occurredOn": "2026-10-15",
            "amount": 12000,
            "categoryId": food,
            "merchant": " 김밥천국 ",
            "paymentMethod": "card",
            "memo": None,
        },
    )
    assert response.status_code == 201
    created = response.json()
    assert set(created) == ENTRY_FIELDS
    assert created["amount"] == 12000 and isinstance(created["amount"], int)
    assert created["merchant"] == "김밥천국"
    assert (created["categoryId"], created["categoryName"]) == (food, "식비")
    assert (created["paymentMethod"], created["memo"], created["source"]) == (
        "card",
        None,
        "manual",
    )
    assert created["createdAt"].endswith("Z") and created["updatedAt"].endswith("Z")

    path = f"/api/ledger/entries/{created['id']}"
    assert auth_client.get(path).json() == created

    response = auth_client.patch(path, json={"amount": 15000, "memo": "점심", "merchant": None})
    assert response.status_code == 200
    updated = response.json()
    assert (updated["amount"], updated["memo"], updated["merchant"]) == (15000, "점심", None)
    assert updated["occurredOn"] == "2026-10-15" and updated["categoryName"] == "식비"

    salary = category_ids(auth_client)[("income", "급여")]
    response = auth_client.patch(path, json={"kind": "income", "categoryId": salary})
    assert (response.json()["kind"], response.json()["categoryName"]) == ("income", "급여")

    assert auth_client.delete(path).status_code == 204
    assert error_of(auth_client.get(path), 404) == {
        "code": "NOT_FOUND",
        "message": "내역을 찾을 수 없습니다.",
        "details": [],
    }


def test_payment_method_defaults_to_other(auth_client):
    entry = add_entry(auth_client)
    assert entry["paymentMethod"] == "other"
    assert entry["merchant"] is None and entry["memo"] is None


@freeze_time("2026-10-16T03:00:00Z")
@pytest.mark.parametrize(
    "overrides,field",
    [
        ({"amount": 0}, "amount"),
        ({"amount": -100}, "amount"),
        ({"amount": 1_000_000_000_001}, "amount"),
        ({"amount": 1200.5}, "amount"),
        ({"amount": "12000"}, "amount"),
        ({"occurredOn": "1999-12-31"}, "occurredOn"),
        ({"occurredOn": "2027-10-18"}, "occurredOn"),  # 오늘+367일
        ({"occurredOn": "2026-13-01"}, "occurredOn"),
        ({"kind": "transfer"}, "kind"),
        ({"paymentMethod": "point"}, "paymentMethod"),
        ({"merchant": "가" * 101}, "merchant"),
        ({"memo": "가" * 201}, "memo"),
    ],
)
def test_entry_validation(auth_client, overrides, field):
    body = {
        "kind": "expense",
        "occurredOn": "2026-10-15",
        "amount": 12000,
        "categoryId": category_ids(auth_client)[("expense", "식비")],
        **overrides,
    }
    error = error_of(auth_client.post("/api/ledger/entries", json=body), 422)
    assert error["code"] == "VALIDATION_ERROR"
    assert [d["field"] for d in error["details"]] == [field]


@freeze_time("2026-10-16T03:00:00Z")
@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": 1},
        {"amount": 1_000_000_000_000},
        {"occurredOn": "2000-01-01"},
        {"occurredOn": "2027-10-17"},  # 오늘+366일
        {"merchant": "가" * 100, "memo": "가" * 200},
    ],
)
def test_entry_validation_boundaries(auth_client, overrides):
    add_entry(auth_client, **overrides)


@pytest.mark.parametrize("missing", ["kind", "occurredOn", "amount", "categoryId"])
def test_entry_required_fields(auth_client, missing):
    body = {
        "kind": "expense",
        "occurredOn": "2026-10-15",
        "amount": 12000,
        "categoryId": category_ids(auth_client)[("expense", "식비")],
    }
    del body[missing]
    error = error_of(auth_client.post("/api/ledger/entries", json=body), 422)
    assert error["details"] == [{"field": missing, "message": "필수 항목입니다."}]


def test_category_must_match_kind_and_be_visible(auth_client, other_auth_client):
    ids = category_ids(auth_client)
    others = other_auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "남의 카테고리"}
    ).json()["id"]
    expected = [{"field": "categoryId", "message": "카테고리를 확인해 주세요."}]
    for kind, category_id in [
        ("expense", ids[("income", "급여")]),  # 종류가 다른 카테고리
        ("income", ids[("expense", "식비")]),
        ("expense", others),  # 남의 카테고리
        ("expense", str(uuid4())),  # 없는 카테고리
    ]:
        body = {"kind": kind, "occurredOn": "2026-10-15", "amount": 1000, "categoryId": category_id}
        error = error_of(auth_client.post("/api/ledger/entries", json=body), 422)
        assert error == {
            "code": "VALIDATION_ERROR",
            "message": "입력값을 확인해 주세요.",
            "details": expected,
        }


def test_patch_validation(auth_client, other_auth_client):
    entry = add_entry(auth_client)
    path = f"/api/ledger/entries/{entry['id']}"
    # 종류만 바꾸면 지금 카테고리(식비)와 종류가 달라진다.
    error = error_of(auth_client.patch(path, json={"kind": "income"}), 422)
    assert error["details"] == [{"field": "categoryId", "message": "카테고리를 확인해 주세요."}]
    others = other_auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "남의 카테고리"}
    ).json()["id"]
    assert error_of(auth_client.patch(path, json={"categoryId": others}), 422)
    for body, field in [
        ({"amount": None}, "amount"),
        ({"amount": 0}, "amount"),
        ({"kind": None}, "kind"),
        ({"occurredOn": "1999-01-01"}, "occurredOn"),
        ({"paymentMethod": None}, "paymentMethod"),
    ]:
        error = error_of(auth_client.patch(path, json=body), 422)
        assert [d["field"] for d in error["details"]] == [field]
    # 실패한 요청은 아무것도 바꾸지 않는다.
    assert auth_client.get(path).json() == entry
    # 빈 본문은 그대로 돌려준다.
    assert auth_client.patch(path, json={}).json() == entry


def test_other_users_entry_is_not_found(auth_client, other_auth_client):
    entry = add_entry(auth_client, merchant="비밀")
    path = f"/api/ledger/entries/{entry['id']}"
    for response in (
        other_auth_client.get(path),
        other_auth_client.patch(path, json={"amount": 1}),
        other_auth_client.delete(path),
        auth_client.get(f"/api/ledger/entries/{uuid4()}"),
        auth_client.patch(f"/api/ledger/entries/{uuid4()}", json={"amount": 1}),
        auth_client.delete(f"/api/ledger/entries/{uuid4()}"),
    ):
        assert error_of(response, 404)["code"] == "NOT_FOUND"
    assert other_auth_client.get("/api/ledger/entries?month=2026-10").json()["total"] == 0
    assert auth_client.get(path).json() == entry


def test_entries_require_auth(client):
    for method, path in [
        ("get", "/api/ledger/entries"),
        ("get", f"/api/ledger/entries/{uuid4()}"),
        ("get", "/api/ledger/summary"),
        ("get", "/api/ledger/trend"),
    ]:
        assert error_of(getattr(client, method)(path), 401)["code"] == "UNAUTHENTICATED"
    response = client.post("/api/ledger/entries", json={})
    assert error_of(response, 401)["code"] == "UNAUTHENTICATED"


# ── 목록 ────────────────────────────────────────────────────────────


def seed_month(client):
    """2026년 9·10월 내역. 생성 순서가 createdAt 순서다."""
    add_entry(client, occurredOn="2026-09-30", amount=5000, merchant="스타벅스")
    add_entry(client, occurredOn="2026-10-01", amount=8000, merchant="STARBUCKS 강남")
    add_entry(client, "교통", occurredOn="2026-10-01", amount=1500, memo="버스")
    add_entry(client, kind="income", occurredOn="2026-10-25", amount=3_000_000, memo="10월 급여")
    add_entry(client, "카페·간식", occurredOn="2026-10-31", amount=4500, memo="starbucks 라떼")
    add_entry(client, occurredOn="2026-11-01", amount=9000, merchant="스타벅스")
    add_entry(client, occurredOn="2026-10-10", amount=7000, merchant="100% 김밥")


def listing(client, query: str) -> dict:
    response = client.get(f"/api/ledger/entries?{query}")
    assert response.status_code == 200, response.text
    return response.json()


def test_list_filters_and_order(auth_client):
    seed_month(auth_client)
    page = listing(auth_client, "month=2026-10")
    assert (page["page"], page["pageSize"], page["total"]) == (1, 20, 5)
    # occurredOn desc → createdAt desc
    assert [(e["occurredOn"], e["amount"]) for e in page["items"]] == [
        ("2026-10-31", 4500),
        ("2026-10-25", 3_000_000),
        ("2026-10-10", 7000),
        ("2026-10-01", 1500),
        ("2026-10-01", 8000),
    ]
    assert listing(auth_client, "month=2026-09")["total"] == 1
    assert listing(auth_client, "month=2026-11")["total"] == 1

    income = listing(auth_client, "month=2026-10&kind=income")
    assert [e["amount"] for e in income["items"]] == [3_000_000]
    assert listing(auth_client, "month=2026-10&kind=expense")["total"] == 4

    transport = category_ids(auth_client)[("expense", "교통")]
    by_category = listing(auth_client, f"month=2026-10&categoryId={transport}")
    assert [e["memo"] for e in by_category["items"]] == ["버스"]

    # 사용처·메모 부분 일치, 대소문자 무시
    found = listing(auth_client, "month=2026-10&q=StarBucks")
    assert [e["amount"] for e in found["items"]] == [4500, 8000]
    assert listing(auth_client, "month=2026-10&q=%20%20급여%20")["total"] == 1
    # LIKE 특수문자는 글자 그대로 찾는다.
    assert [e["amount"] for e in listing(auth_client, "month=2026-10&q=100%25")["items"]] == [7000]
    assert listing(auth_client, "month=2026-10&q=_")["total"] == 0

    # 빈 필터 값은 조건 없음
    assert listing(auth_client, "month=2026-10&kind=&categoryId=&q=")["total"] == 5


def test_list_pagination(auth_client):
    seed_month(auth_client)
    first = listing(auth_client, "month=2026-10&page=1&pageSize=2")
    second = listing(auth_client, "month=2026-10&page=2&pageSize=2")
    third = listing(auth_client, "month=2026-10&page=3&pageSize=2")
    beyond = listing(auth_client, "month=2026-10&page=4&pageSize=2")
    assert [len(p["items"]) for p in (first, second, third, beyond)] == [2, 2, 1, 0]
    assert {p["total"] for p in (first, second, third, beyond)} == {5}
    assert (second["page"], second["pageSize"]) == (2, 2)
    ids = [e["id"] for p in (first, second, third) for e in p["items"]]
    assert ids == [e["id"] for e in listing(auth_client, "month=2026-10")["items"]]


def test_list_defaults_to_current_kst_month(auth_client):
    # 세션 만료를 피하려고 고정 시각은 과거로 둔다.
    add_entry(auth_client, occurredOn="2026-09-30", amount=1000)
    add_entry(auth_client, occurredOn="2026-10-01", amount=2000)
    with freeze_time("2026-09-30T14:59:59Z"):  # KST 9월 30일 23:59
        assert [e["amount"] for e in listing(auth_client, "")["items"]] == [1000]
    with freeze_time("2026-09-30T15:00:00Z"):  # KST 10월 1일 00:00
        assert [e["amount"] for e in listing(auth_client, "month=")["items"]] == [2000]


@pytest.mark.parametrize(
    "query,field",
    [
        ("month=2026-13", "month"),
        ("month=2026-1", "month"),
        ("month=202610", "month"),
        ("month=0000-01", "month"),
        ("kind=transfer", "kind"),
        ("categoryId=abc", "categoryId"),
        ("page=0", "page"),
        ("pageSize=101", "pageSize"),
        (f"q={'가' * 101}", "q"),
    ],
)
def test_list_query_validation(auth_client, query, field):
    error = error_of(auth_client.get(f"/api/ledger/entries?{query}"), 422)
    assert error["code"] == "VALIDATION_ERROR"
    assert [d["field"] for d in error["details"]] == [field]
