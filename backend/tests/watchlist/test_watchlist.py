import inspect
from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.core.errors import AppError
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.modules.market import service as market_service
from app.modules.watchlist import service
from app.modules.watchlist.models import WatchlistItem

ITEM_KEYS = {
    "id",
    "code",
    "name",
    "market",
    "sector",
    "kind",
    "groupName",
    "memo",
    "sortOrder",
    "quote",
    "metrics",
    "source",
    "createdAt",
}


class CountingBroker(MockBroker):
    """증권사 시세 호출을 기록한다.

    인스턴스마다 시세 캐시 키가 달라 다른 테스트의 캐시와 섞이지 않는다.
    """

    def __init__(self):
        super().__init__()
        self.quote_calls: list[list[str]] = []

    def get_quotes(self, codes):
        self.quote_calls.append(list(codes))
        return super().get_quotes(codes)


class FailingBroker(MockBroker):
    def get_quotes(self, codes):
        raise BrokerError("BROKER_UNAVAILABLE")


@pytest.fixture
def seeded(db):
    # 08 종목 마스터와 스냅샷을 Mock 고정 데이터로 채운다(테스트 트랜잭션 안에서만).
    db.execute(text("DELETE FROM stock_snapshots"))
    db.execute(text("DELETE FROM stocks"))
    db.commit()
    broker = MockBroker()
    market_service.refresh_stocks(db, broker)
    assert market_service.refresh_snapshot(db, broker, date(2026, 10, 16))["success"] == 90


@pytest.fixture
def broker(monkeypatch):
    instance = CountingBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: instance)
    return instance


def user_id(client) -> UUID:
    return UUID(client.get("/api/auth/me").json()["user"]["id"])


def add(client, code, **body):
    return client.post("/api/watchlist", json={"code": code, **body})


def delete(client, item_id):
    # 상태를 바꾸는 요청은 JSON 형식만 받는다(require_json).
    return client.delete(f"/api/watchlist/{item_id}", headers={"content-type": "application/json"})


def error(response):
    return response.json()["error"]


def test_add_returns_view_with_quote_metrics_and_kind(auth_client, seeded, broker):
    r = add(auth_client, "005930")
    assert r.status_code == 201, r.text
    data = r.json()
    assert set(data) == ITEM_KEYS
    assert data["code"] == "005930" and data["name"] == "삼성전자"
    assert data["market"] == "KOSPI" and data["sector"] and data["kind"] == "stock"
    assert data["groupName"] == "기본" and data["memo"] is None and data["sortOrder"] == 0
    assert data["source"] == "mock" and data["createdAt"]
    assert set(data["quote"]) == {"price", "change", "changeRate", "asOf"}
    assert data["quote"]["price"] == "102800" and isinstance(data["quote"]["change"], str)
    assert data["quote"]["changeRate"] == -1.21
    assert data["metrics"] == {"per": "31.86", "pbr": "0.74", "marketCap": 1275600000000}

    etf = add(auth_client, "069500", groupName="ETF", memo="  지수 추종  ")
    assert etf.status_code == 201, etf.text
    etf_data = etf.json()
    assert etf_data["kind"] == "etf" and etf_data["groupName"] == "ETF"
    assert etf_data["memo"] == "지수 추종"
    assert etf_data["metrics"] == {"per": None, "pbr": None, "marketCap": 927900000000}
    assert etf_data["quote"]["price"] == "47140"


def test_list_orders_by_group_sort_order_and_filters(auth_client, seeded, broker):
    for code in ("005930", "000660", "035420"):
        assert add(auth_client, code).status_code == 201
    assert add(auth_client, "069500", groupName="배당주").status_code == 201
    assert add(auth_client, "005380", groupName="가치주").status_code == 201

    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"items", "groups", "source"}
    assert body["source"] == "mock"
    assert body["groups"] == ["가치주", "기본", "배당주"]
    assert [(i["groupName"], i["code"], i["sortOrder"]) for i in body["items"]] == [
        ("가치주", "005380", 0),
        ("기본", "005930", 0),
        ("기본", "000660", 1),
        ("기본", "035420", 2),
        ("배당주", "069500", 0),
    ]
    assert all(set(item) == ITEM_KEYS for item in body["items"])

    filtered = auth_client.get("/api/watchlist", params={"group": "배당주"}).json()
    assert [i["code"] for i in filtered["items"]] == ["069500"]
    assert filtered["groups"] == ["가치주", "기본", "배당주"]
    # 빈 group은 전체다.
    assert len(auth_client.get("/api/watchlist?group=").json()["items"]) == 5
    empty = auth_client.get("/api/watchlist", params={"group": "없는그룹"}).json()
    assert empty["items"] == [] and empty["source"] == "mock"


def test_list_fetches_quotes_once_for_all_items(auth_client, seeded, broker, monkeypatch):
    codes = ["005930", "000660", "035420", "069500"]
    for code in codes:
        assert add(auth_client, code).status_code == 201

    fresh = CountingBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: fresh)
    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    # 종목마다 따로 부르지 않고 한 번에 가져온다. 상세 조회는 같은 클라이언트 캐시를 쓴다.
    assert fresh.quote_calls == [codes]
    assert all(item["quote"] for item in r.json()["items"])
    # 30초 캐시 안에서는 증권사를 다시 부르지 않는다.
    assert auth_client.get("/api/watchlist").status_code == 200
    assert fresh.quote_calls == [codes]


def test_quote_failure_returns_null_quote(auth_client, seeded, broker, monkeypatch):
    assert add(auth_client, "005930").status_code == 201
    assert add(auth_client, "069500").status_code == 201
    failing = FailingBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: failing)
    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["quote"] for i in items] == [None, None]
    assert items[0]["metrics"]["per"] == "31.86"
    assert items[0]["name"] == "삼성전자"


def test_add_errors(auth_client, seeded, broker, db):
    assert add(auth_client, "005930").status_code == 201

    duplicate = add(auth_client, "005930", groupName="다른그룹")
    assert duplicate.status_code == 409
    assert error(duplicate)["code"] == "CONFLICT"
    assert error(duplicate)["message"] == "이미 관심종목에 있습니다."

    missing = add(auth_client, "999999")
    assert missing.status_code == 404
    assert error(missing) == {
        "code": "NOT_FOUND",
        "message": "종목을 찾을 수 없습니다.",
        "details": [],
    }

    for body, field in (
        ({"code": "000660", "groupName": "   "}, "groupName"),
        ({"code": "000660", "groupName": "가" * 21}, "groupName"),
        ({"code": "000660", "memo": "메" * 201}, "memo"),
        ({"code": "   "}, "code"),
        ({"code": ""}, "code"),
        ({}, "code"),
    ):
        r = auth_client.post("/api/watchlist", json=body)
        assert r.status_code == 422, (body, r.text)
        assert error(r)["code"] == "VALIDATION_ERROR"
        assert error(r)["details"][0]["field"] == field

    not_json = auth_client.post(
        "/api/watchlist", content="code=000660", headers={"content-type": "text/plain"}
    )
    assert not_json.status_code == 422


def test_add_limit_is_100(auth_client, seeded, broker, db):
    owner = user_id(auth_client)
    db.add_all(
        WatchlistItem(user_id=owner, stock_code=f"X{n:04}", group_name="기본", sort_order=n)
        for n in range(99)
    )
    db.commit()
    assert add(auth_client, "005930").status_code == 201
    over = add(auth_client, "000660")
    assert over.status_code == 409
    assert error(over)["code"] == "CONFLICT"
    assert error(over)["message"] == "관심종목은 100개까지 담을 수 있습니다."


def test_update_group_and_memo(auth_client, other_auth_client, seeded, broker):
    first = add(auth_client, "005930").json()
    add(auth_client, "069500", groupName="배당주")

    moved = auth_client.patch(
        f"/api/watchlist/{first['id']}", json={"groupName": "배당주", "memo": "실적 발표 확인"}
    )
    assert moved.status_code == 200, moved.text
    data = moved.json()
    assert set(data) == ITEM_KEYS
    assert data["groupName"] == "배당주" and data["memo"] == "실적 발표 확인"
    # 옮긴 그룹의 맨 뒤로 간다.
    assert data["sortOrder"] == 1

    memo_only = auth_client.patch(f"/api/watchlist/{first['id']}", json={"memo": None})
    assert memo_only.status_code == 200
    assert memo_only.json()["memo"] is None and memo_only.json()["groupName"] == "배당주"
    assert auth_client.get("/api/watchlist").json()["groups"] == ["배당주"]

    bad = auth_client.patch(f"/api/watchlist/{first['id']}", json={"groupName": None})
    assert bad.status_code == 422 and error(bad)["details"][0]["field"] == "groupName"
    long_memo = auth_client.patch(f"/api/watchlist/{first['id']}", json={"memo": "메" * 201})
    assert long_memo.status_code == 422 and error(long_memo)["details"][0]["field"] == "memo"

    assert auth_client.patch(f"/api/watchlist/{uuid4()}", json={"memo": "x"}).status_code == 404
    other = other_auth_client.patch(f"/api/watchlist/{first['id']}", json={"memo": "남의 메모"})
    assert other.status_code == 404 and error(other)["code"] == "NOT_FOUND"
    assert auth_client.get("/api/watchlist").json()["items"][1]["memo"] is None


def test_reorder_requires_all_ids_of_group(auth_client, other_auth_client, seeded, broker):
    ids = [add(auth_client, code).json()["id"] for code in ("005930", "000660", "035420")]
    other_group = add(auth_client, "069500", groupName="ETF").json()["id"]

    r = auth_client.put(
        "/api/watchlist/order", json={"groupName": "기본", "ids": list(reversed(ids))}
    )
    assert r.status_code == 204 and r.content == b""
    items = auth_client.get("/api/watchlist?group=기본").json()["items"]
    assert [i["id"] for i in items] == list(reversed(ids))
    assert [i["sortOrder"] for i in items] == [0, 1, 2]

    other_id = add(other_auth_client, "005930").json()["id"]
    for bad_ids in (
        ids[:2],
        [*ids, ids[0]],
        [*ids, other_group],
        [*ids[:2], other_id],
        [*ids, str(uuid4())],
    ):
        bad = auth_client.put("/api/watchlist/order", json={"groupName": "기본", "ids": bad_ids})
        assert bad.status_code == 422, bad_ids
        assert error(bad)["details"] == [
            {"field": "ids", "message": error(bad)["details"][0]["message"]}
        ]
    # 실패한 요청은 순서를 바꾸지 않는다.
    assert [i["id"] for i in auth_client.get("/api/watchlist?group=기본").json()["items"]] == list(
        reversed(ids)
    )
    # 다른 사용자는 내 그룹 순서를 바꿀 수 없다.
    assert (
        other_auth_client.put(
            "/api/watchlist/order", json={"groupName": "기본", "ids": ids}
        ).status_code
        == 422
    )


def test_delete_and_isolation(auth_client, other_auth_client, seeded, broker):
    mine = add(auth_client, "005930").json()
    theirs = add(other_auth_client, "005930").json()
    assert theirs["id"] != mine["id"]

    assert [i["id"] for i in other_auth_client.get("/api/watchlist").json()["items"]] == [
        theirs["id"]
    ]
    assert delete(other_auth_client, mine["id"]).status_code == 404
    assert len(auth_client.get("/api/watchlist").json()["items"]) == 1

    r = delete(auth_client, mine["id"])
    assert r.status_code == 204 and r.content == b""
    assert auth_client.get("/api/watchlist").json() == {
        "items": [],
        "groups": [],
        "source": "mock",
    }
    again = delete(auth_client, mine["id"])
    assert again.status_code == 404 and error(again)["code"] == "NOT_FOUND"
    assert len(other_auth_client.get("/api/watchlist").json()["items"]) == 1


def test_requires_authentication(client):
    assert client.get("/api/watchlist").status_code == 401
    assert client.post("/api/watchlist", json={"code": "005930"}).status_code == 401
    assert (
        client.put("/api/watchlist/order", json={"groupName": "기본", "ids": []}).status_code == 401
    )
    assert client.patch(f"/api/watchlist/{uuid4()}", json={}).status_code == 401
    assert delete(client, uuid4()).status_code == 401


def test_delisted_stock_stays_listed_with_code_as_name(auth_client, seeded, broker, db):
    item = add(auth_client, "005930").json()
    db.execute(text("UPDATE stocks SET listed = false WHERE code = '005930'"))
    db.commit()
    rows = auth_client.get("/api/watchlist").json()["items"]
    assert [(r["id"], r["name"], r["market"], r["metrics"]) for r in rows] == [
        (item["id"], "005930", None, None)
    ]
    assert delete(auth_client, item["id"]).status_code == 204


def test_service_functions_match_contract(auth_client, other_auth_client, seeded, broker, db):
    assert str(inspect.signature(service.list_items)) == (
        "(db, user_id, *, group: str | None = None)"
        " -> list[app.modules.watchlist.schemas.WatchlistItemView]"
    )
    assert str(inspect.signature(service.add_item)) == (
        "(db, user_id, code: str, *, group_name: str = '기본', memo: str | None = None)"
        " -> app.modules.watchlist.schemas.WatchlistItemView"
    )
    owner = user_id(auth_client)
    view = service.add_item(db, owner, "005930", group_name="배당주", memo="챗봇이 담음")
    assert view.code == "005930" and view.group_name == "배당주" and view.memo == "챗봇이 담음"
    service.add_item(db, owner, "000660")
    assert [v.code for v in service.list_items(db, owner)] == ["000660", "005930"]
    assert [v.code for v in service.list_items(db, owner, group="배당주")] == ["005930"]
    assert service.list_items(db, user_id(other_auth_client)) == []

    with pytest.raises(AppError) as conflict:
        service.add_item(db, owner, "005930")
    assert (conflict.value.status_code, conflict.value.code) == (409, "CONFLICT")
    with pytest.raises(AppError) as missing:
        service.add_item(db, owner, "nope")
    assert (missing.value.status_code, missing.value.code) == (404, "NOT_FOUND")
