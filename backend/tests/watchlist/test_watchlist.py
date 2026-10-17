import inspect
import threading
import time
from datetime import date
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.modules.auth.models import User
from app.modules.market import service as market_service
from app.modules.watchlist import repository as watchlist_repo
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


class FailingBroker(CountingBroker):
    def get_quotes(self, codes):
        self.quote_calls.append(list(codes))
        raise BrokerError("BROKER_UNAVAILABLE")


class EmptyBroker(CountingBroker):
    """시세를 하나도 돌려주지 않는다(제공자 미지원·상장폐지 등)."""

    def get_quotes(self, codes):
        self.quote_calls.append(list(codes))
        return []


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


@pytest.fixture
def market_calls(monkeypatch):
    """watchlist가 부르는 08 공개 함수 호출을 기록한다. 목록·담기는 상세 조회를 부르지 않는다."""
    calls = {"get_quotes": [], "get_stock_detail": []}
    real_get_quotes = market_service.get_quotes

    def get_quotes(codes):
        calls["get_quotes"].append(list(codes))
        return real_get_quotes(codes)

    def get_stock_detail(db, code):
        calls["get_stock_detail"].append(code)
        return None

    monkeypatch.setattr(market_service, "get_quotes", get_quotes)
    monkeypatch.setattr(market_service, "get_stock_detail", get_stock_detail)
    return calls


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


def test_list_fetches_quotes_once_for_all_items(
    auth_client, seeded, broker, monkeypatch, market_calls
):
    codes = ["005930", "000660", "035420", "069500"]
    for code in codes:
        assert add(auth_client, code).status_code == 201

    fresh = CountingBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: fresh)
    market_calls["get_quotes"].clear()
    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    # 종목마다 따로 부르지 않고 한 번에 가져온다. 종목 정보·지표는 스냅샷에서 읽는다.
    assert market_calls == {"get_quotes": [codes], "get_stock_detail": []}
    assert fresh.quote_calls == [codes]
    assert all(item["quote"] for item in r.json()["items"])
    # 30초 캐시 안에서는 증권사를 다시 부르지 않는다.
    assert auth_client.get("/api/watchlist").status_code == 200
    assert fresh.quote_calls == [codes]


def test_empty_quotes_do_not_trigger_per_stock_calls(
    auth_client, seeded, monkeypatch, market_calls
):
    empty = EmptyBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: empty)
    codes = ["005930", "000660", "035420", "069500"]
    for code in codes:
        assert add(auth_client, code).status_code == 201
    market_calls["get_quotes"].clear()
    empty.quote_calls.clear()

    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    # 시세가 비어도 목록 한 번에 get_quotes 1회, 증권사 호출 1회, 상세 조회 0회다.
    assert market_calls == {"get_quotes": [codes], "get_stock_detail": []}
    assert empty.quote_calls == [codes]
    items = r.json()["items"]
    assert [i["quote"] for i in items] == [None] * 4
    assert items[0]["name"] == "삼성전자" and items[0]["metrics"]["per"] == "31.86"
    assert items[3]["kind"] == "etf" and items[3]["metrics"]["per"] is None


def test_broker_error_returns_null_quote_without_detail_calls(
    auth_client, seeded, monkeypatch, market_calls
):
    failing = FailingBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: failing)
    codes = ["005930", "069500"]
    for code in codes:
        assert add(auth_client, code).status_code == 201
    market_calls["get_quotes"].clear()
    failing.quote_calls.clear()

    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    assert market_calls == {"get_quotes": [codes], "get_stock_detail": []}
    # 08 get_quotes가 일괄 실패를 잡아 코드별로 다시 조회하는 것은 08 설계다.
    # watchlist는 그 위에 더 부르지 않는다.
    assert failing.quote_calls[0] == codes
    assert all(len(call) == 1 for call in failing.quote_calls[1:])
    assert len(failing.quote_calls) <= 1 + len(codes)
    items = r.json()["items"]
    assert [i["quote"] for i in items] == [None, None]
    assert items[0]["metrics"]["per"] == "31.86" and items[0]["name"] == "삼성전자"


def test_get_quotes_raising_broker_error_returns_null_quote(
    auth_client, seeded, broker, monkeypatch
):
    assert add(auth_client, "005930").status_code == 201
    calls = []

    def failing_get_quotes(codes):
        calls.append(list(codes))
        raise BrokerError("BROKER_UNAVAILABLE")

    monkeypatch.setattr(market_service, "get_quotes", failing_get_quotes)
    r = auth_client.get("/api/watchlist")
    assert r.status_code == 200
    assert calls == [["005930"]]
    assert r.json()["items"][0]["quote"] is None
    assert r.json()["items"][0]["metrics"]["pbr"] == "0.74"


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


def test_stock_without_snapshot_uses_master_or_code(auth_client, seeded, broker, db):
    gone = add(auth_client, "005930").json()
    plain = add(auth_client, "000660").json()
    # 000660은 최신 스냅샷이 없어 종목 마스터(search_stocks 정확 일치)로 채우고 지표는 null이다.
    db.execute(text("DELETE FROM stock_snapshots WHERE code IN ('005930', '000660')"))
    # 005930은 스냅샷도 없고 마스터에서도 빠져(상장폐지) 코드를 이름으로 쓴다.
    db.execute(text("UPDATE stocks SET listed = false WHERE code = '005930'"))
    db.commit()
    rows = {r["id"]: r for r in auth_client.get("/api/watchlist").json()["items"]}
    assert (rows[gone["id"]]["name"], rows[gone["id"]]["market"], rows[gone["id"]]["metrics"]) == (
        "005930",
        None,
        None,
    )
    assert rows[gone["id"]]["kind"] == "stock" and rows[gone["id"]]["source"] == "mock"
    sk = rows[plain["id"]]
    assert (sk["name"], sk["market"], sk["kind"], sk["metrics"]) == (
        "SK하이닉스",
        "KOSPI",
        "stock",
        None,
    )
    assert sk["quote"]["price"]
    assert delete(auth_client, gone["id"]).status_code == 204
    # 마스터에서 빠진 종목은 새로 담을 수 없다.
    assert add(auth_client, "005930").status_code == 404


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


def test_concurrent_adds_never_exceed_limit(test_engine, monkeypatch):
    """99개인 사용자가 서로 다른 종목을 동시에 담아도 정확히 100개에서 멈춘다.

    별도 연결·스레드에서 실제로 커밋해야 하므로 테스트 트랜잭션(db 픽스처)을 쓰지 않고,
    끝나면 만든 사용자를 지운다(관심종목은 CASCADE로 함께 지워진다).
    08 종목 데이터는 DB에 커밋하지 않도록 공개 함수를 가짜로 바꾼다.
    """

    def search_stocks(db, query, *, limit=20, kind=None):
        return [
            SimpleNamespace(
                code=query, name=f"종목{query}", market="KOSPI", sector=None, kind="stock"
            )
        ]

    monkeypatch.setattr(market_service, "search_stocks", search_stocks)
    monkeypatch.setattr(
        market_service, "list_snapshot_rows", lambda db, as_of=None: SimpleNamespace(rows=[])
    )
    monkeypatch.setattr(market_service, "get_quotes", lambda codes: [])
    real_count = watchlist_repo.count_items

    def slow_count(db, user_id):
        # 개수 확인과 삽입 사이를 넓혀, 잠금이 없으면 경합이 반드시 드러나게 한다.
        value = real_count(db, user_id)
        time.sleep(0.2)
        return value

    monkeypatch.setattr(watchlist_repo, "count_items", slow_count)

    with Session(test_engine) as setup:
        user = User(email=f"watchlist-race-{uuid4()}@example.com", password_hash="unused")
        setup.add(user)
        setup.flush()
        owner = user.id
        setup.add_all(
            WatchlistItem(user_id=owner, stock_code=f"F{n:04}", sort_order=n) for n in range(99)
        )
        setup.commit()

    codes = [f"R{n:04}" for n in range(8)]
    barrier = threading.Barrier(len(codes))
    results: dict[str, object] = {}

    def worker(code):
        with Session(test_engine) as session:
            barrier.wait()
            try:
                service.add_item(session, owner, code)
                results[code] = "created"
            except AppError as exc:
                results[code] = (exc.status_code, exc.code)

    try:
        threads = [threading.Thread(target=worker, args=(code,)) for code in codes]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert sorted(results) == sorted(codes)
        assert list(results.values()).count("created") == 1
        assert sorted(v for v in results.values() if v != "created") == [(409, "CONFLICT")] * 7
        with Session(test_engine) as check:
            total = check.scalar(
                select(func.count())
                .select_from(WatchlistItem)
                .where(WatchlistItem.user_id == owner)
            )
        assert total == 100
    finally:
        with Session(test_engine) as cleanup:
            cleanup.execute(sql_delete(User).where(User.id == owner))
            cleanup.commit()
