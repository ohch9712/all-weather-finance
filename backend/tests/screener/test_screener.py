import base64
import json
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.core.errors import AppError
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.integrations.llm.fake import FakeStructuredLLM
from app.modules.market import service as market_service
from app.modules.market.service import SnapshotRow, SnapshotSet
from app.modules.screener import repository, service
from app.modules.screener.schemas import Condition, ScreenFilter

# 백엔드·프론트가 함께 쓰는 URL 인코딩 고정값(12절 검증 체크리스트 4)
GOLDEN = json.loads(
    (Path(__file__).resolve().parents[3] / "frontend/tests/screener/encoding.json").read_text(
        encoding="utf-8"
    )
)


@pytest.fixture
def snapshots(monkeypatch):
    broker = MockBroker()
    stocks = broker.list_stocks("KOSPI") + broker.list_stocks("KOSDAQ") + broker.list_etfs()
    rows = [
        SnapshotRow(
            **asdict(broker.get_fundamentals(stock.code)),
            as_of=date(2026, 10, 16),
            created_at=datetime(2026, 10, 16, tzinfo=UTC),
            source="mock",
            name=stock.name,
            market=stock.market,
            sector=stock.sector,
            kind=stock.kind,
        )
        for stock in stocks
    ]
    result = SnapshotSet(date(2026, 10, 16), "mock", rows)
    monkeypatch.setattr(service, "list_snapshot_rows", lambda db: result)
    return result


@pytest.mark.parametrize(
    "op,value,end,expected",
    [
        ("gt", "10", None, False),
        ("gte", "10", None, True),
        ("lt", "10", None, False),
        ("lte", "10", None, True),
        ("between", "10", "20", True),
        ("between", "0", "10", True),
        ("between", "11", "20", False),
    ],
)
def test_operators(op, value, end, expected):
    condition = Condition(field="per", op=op, value=value, value_to=end)
    assert service._matches(Decimal(10), condition) is expected


@pytest.mark.parametrize(
    "payload",
    [
        {"conditions": [{"field": "sql", "op": "gt", "value": "1"}]},
        {"conditions": [{"field": "per", "op": "eq", "value": "1"}]},
        {"conditions": [{"field": "per", "op": "between", "value": "1"}]},
        {"conditions": [{"field": "per", "op": "between", "value": "2", "valueTo": "1"}]},
        {"conditions": [{"field": "per", "op": "gt", "value": "1", "valueTo": "2"}]},
        {"conditions": [{"field": "per", "op": "gt", "value": "1", "sql": "x"}]},
        {"conditions": [{"field": "per", "op": "gt", "value": "1"}] * 11},
        {"limit": 0},
        {"limit": 101},
        {"kinds": []},
        {"kinds": ["etf", "etf"]},
        {"conditions": [{"field": "per", "op": "gt", "value": "NaN"}]},
    ],
)
def test_invalid_filter(payload):
    with pytest.raises(ValidationError):
        ScreenFilter.model_validate(payload)


def test_filtering_and_examples(snapshots):
    filters = [
        {
            "markets": ["KOSPI"],
            "conditions": [
                {
                    "field": "marketCap",
                    "op": "between",
                    "value": "1000000000000",
                    "valueTo": "10000000000000",
                },
                {"field": "per", "op": "gt", "value": "0"},
                {"field": "per", "op": "lte", "value": "10"},
            ],
        },
        {
            "markets": ["KOSDAQ"],
            "conditions": [{"field": "tradingValue", "op": "gte", "value": "100000000000"}],
        },
        {
            "conditions": [
                {"field": "roe", "op": "gte", "value": "15"},
                {"field": "pbr", "op": "gt", "value": "0"},
                {"field": "pbr", "op": "lte", "value": "1"},
            ]
        },
        {"conditions": [{"field": "changeRate", "op": "gt", "value": "3"}]},
    ]
    for payload, expected in zip(filters, [4, 27, 5, 14], strict=True):
        result = service.run_screen(None, ScreenFilter.model_validate(payload))
        assert result.total == expected
        assert all(item.kind == "stock" for item in result.items)
    row = snapshots.rows[0]
    result = service.run_screen(None, ScreenFilter(markets=[row.market], sectors=[row.sector]))
    assert all(item.market == row.market and item.sector == row.sector for item in result.items)


def test_null_counts_etfs_and_sort(snapshots, monkeypatch):
    missing = service.run_screen(
        None, ScreenFilter(kinds=["etf"], conditions=[Condition(field="per", op="lte", value=10)])
    )
    assert missing.total == 0
    assert missing.excluded_for_missing_data == 10
    base = snapshots.rows[0]
    rows = [
        replace(base, code="3", market_cap=None),
        replace(base, code="2", market_cap=10),
        replace(base, code="1", market_cap=10),
        replace(base, code="4", market_cap=20),
    ]
    monkeypatch.setattr(
        service, "list_snapshot_rows", lambda db: SnapshotSet(base.as_of, "mock", rows)
    )
    for direction, expected in [("asc", ["1", "2", "4", "3"]), ("desc", ["4", "1", "2", "3"])]:
        result = service.run_screen(
            None, ScreenFilter(sort={"field": "marketCap", "direction": direction}, limit=4)
        )
        assert [item.code for item in result.items] == expected
    result = service.run_screen(None, ScreenFilter(limit=1))
    assert result.total == 4 and len(result.items) == 1
    assert (
        service.field_value(
            replace(base, price=Decimal(95), high_52w=Decimal(100)), "high52wGapRate"
        )
        == -5
    )
    assert (
        service.field_value(
            replace(base, price=Decimal(105), low_52w=Decimal(100)), "low52wGapRate"
        )
        == 5
    )
    assert service.field_value(replace(base, low_52w=Decimal(0)), "low52wGapRate") is None


def test_parse_and_errors(auth_client, fake_llm):
    fake_llm.register(
        "screener.parse",
        lambda req: {
            "filter": {
                "kinds": ["etf"],
                "conditions": [{"field": "changeRate", "op": "gte", "value": "3"}],
            },
            "explanation": "ETF 상승률 조건",
            "unsupported": [{"text": "배당", "reason": "지원하지 않아요"}],
        },
    )
    result = auth_client.post("/api/screener/parse", json={"query": " ETF 상승 "})
    assert result.status_code == 200, result.text
    assert result.json()["chips"][0]["label"] == "ETF"
    assert result.json()["filter"]["conditions"][0]["value"] == "3"
    assert fake_llm.calls[0].data_class == "general"
    assert service.get_filter_guide() in fake_llm.calls[0].system
    assert fake_llm.calls[0].content[0].text == "ETF 상승"
    fake_llm.register(
        "screener.parse",
        lambda req: {"filter": {"limit": 101}, "explanation": "", "unsupported": []},
    )
    invalid = auth_client.post("/api/screener/parse", json={"query": "test"})
    assert invalid.status_code == 503
    assert invalid.json()["error"]["code"] == "LLM_UNAVAILABLE"

    def refuse(req):
        raise AppError(422, "LLM_REFUSED", "AI가 거절했어요.")

    fake_llm.register("screener.parse", refuse)
    assert (
        auth_client.post("/api/screener/parse", json={"query": "test"}).json()["error"]["code"]
        == "LLM_REFUSED"
    )
    fake_llm.set_enabled("screener.parse", False)
    assert auth_client.post("/api/screener/parse", json={"query": "test"}).status_code == 503
    assert auth_client.post("/api/screener/parse", json={"query": "   "}).status_code == 422
    with pytest.raises(AppError) as error:
        service.parse_query(FakeStructuredLLM(), " ")
    assert error.value.details[0].field == "query"


def test_run_contract(auth_client, snapshots, monkeypatch):
    response = auth_client.post("/api/screener/run", json={"filter": {"kinds": ["etf"]}})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 10 and body["source"] == "mock"
    assert body["asOf"] == "2026-10-16"
    item = body["items"][0]
    assert set(item) == {
        "code",
        "name",
        "market",
        "sector",
        "kind",
        "price",
        "changeRate",
        "marketCap",
        "per",
        "pbr",
        "roe",
        "tradingValue",
    }
    assert item["per"] is None and isinstance(item["price"], str)
    assert isinstance(item["marketCap"], int)
    monkeypatch.setattr(service, "list_snapshot_rows", lambda db: SnapshotSet(None, None, []))
    assert auth_client.post("/api/screener/run", json={"filter": {}}).json() == {
        "asOf": None,
        "source": None,
        "total": 0,
        "excludedForMissingData": 0,
        "items": [],
        "universeCount": None,
    }


def test_saved_crud_limits_and_isolation(auth_client, other_auth_client):
    payload = {"name": "검색 0", "queryText": "ETF", "filter": {"kinds": ["etf"]}}
    created = auth_client.post("/api/screener/saved", json=payload)
    assert created.status_code == 201, created.text
    screen_id = created.json()["id"]
    assert auth_client.post("/api/screener/saved", json=payload).status_code == 409
    assert other_auth_client.get("/api/screener/saved").json() == {"items": []}
    assert (
        other_auth_client.delete(
            f"/api/screener/saved/{screen_id}", headers={"Content-Type": "application/json"}
        ).status_code
        == 404
    )
    for index in range(1, 20):
        assert (
            auth_client.post(
                "/api/screener/saved", json={**payload, "name": f"검색 {index}"}
            ).status_code
            == 201
        )
    assert (
        auth_client.post("/api/screener/saved", json={**payload, "name": "초과"}).status_code == 409
    )
    assert len(auth_client.get("/api/screener/saved").json()["items"]) == 20
    assert (
        auth_client.delete(
            f"/api/screener/saved/{screen_id}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert (
        auth_client.delete(
            f"/api/screener/saved/{screen_id}", headers={"Content-Type": "application/json"}
        ).status_code
        == 404
    )


def test_broker_conditions(auth_client, other_auth_client, snapshots, monkeypatch):
    monkeypatch.setattr(service, "get_market_data_client", lambda: MockBroker())
    result = auth_client.get("/api/screener/broker-conditions")
    assert result.status_code == 200 and len(result.json()["items"]) == 2
    run = auth_client.post(
        "/api/screener/broker-conditions/run", json={"seq": "0", "connectionId": None}
    )
    assert run.status_code == 200 and run.json()["source"] == "mock"
    assert all(Decimal(item["per"]) < 10 for item in run.json()["items"])
    connection = auth_client.post(
        "/api/market/connections",
        json={
            "provider": "mock",
            "environment": "mock",
            "label": "조건검색 샘플",
            "appKey": "dummy",
            "appSecret": "dummy",
        },
    )
    assert connection.status_code == 201, connection.text
    connection_id = connection.json()["id"]
    assert (
        other_auth_client.get(
            f"/api/screener/broker-conditions?connectionId={connection_id}"
        ).status_code
        == 404
    )
    assert (
        other_auth_client.post(
            "/api/screener/broker-conditions/run", json={"seq": "0", "connectionId": connection_id}
        ).status_code
        == 404
    )

    class Unsupported:
        provider = "mock"
        capabilities = frozenset()

    monkeypatch.setattr(service, "get_market_data_client", Unsupported)
    assert auth_client.get("/api/screener/broker-conditions").status_code == 501
    assert (
        auth_client.post("/api/screener/broker-conditions/run", json={"seq": "0"}).json()["error"][
            "code"
        ]
        == "BROKER_NOT_SUPPORTED"
    )

    class Failing(MockBroker):
        def list_conditions(self):
            raise BrokerError("BROKER_UNAVAILABLE")

    monkeypatch.setattr(service, "get_market_data_client", Failing)
    assert auth_client.get("/api/screener/broker-conditions").status_code == 502

    class Unknown(MockBroker):
        def run_condition(self, seq):
            return ["unknown", "unknown"]

    monkeypatch.setattr(service, "get_market_data_client", Unknown)
    assert (
        auth_client.post("/api/screener/broker-conditions/run", json={"seq": "0"}).json()["items"][
            0
        ]["price"]
        is None
    )


@pytest.mark.parametrize("provider", ["kiwoom", "toss"])
@pytest.mark.parametrize("capabilities", [frozenset({"CONDITIONS"}), frozenset()])
def test_operator_conditions_require_user_connection(
    auth_client, monkeypatch, provider, capabilities
):
    operator = Mock(provider=provider, capabilities=capabilities)
    monkeypatch.setattr(service, "get_market_data_client", lambda: operator)
    responses = [
        auth_client.get("/api/screener/broker-conditions"),
        auth_client.post("/api/screener/broker-conditions/run", json={"seq": "0"}),
        auth_client.post(
            "/api/screener/broker-conditions/run", json={"seq": "0", "connectionId": None}
        ),
    ]
    for response in responses:
        assert response.status_code == 422, response.text
        assert response.json()["error"] == {
            "code": "VALIDATION_ERROR",
            "message": "입력값을 확인해 주세요.",
            "details": [
                {"field": "connectionId", "message": "내 키움 증권사 연결을 선택해 주세요."}
            ],
        }
    operator.list_conditions.assert_not_called()
    operator.run_condition.assert_not_called()


def test_conditions_use_selected_user_connection(auth_client, snapshots, monkeypatch):
    connection_id = uuid4()
    user_client = Mock(wraps=MockBroker(), provider="kiwoom")
    user_client.capabilities = frozenset({"CONDITIONS"})
    get_user = Mock(return_value=user_client)
    get_operator = Mock(side_effect=AssertionError("운영자 클라이언트 접근 금지"))
    monkeypatch.setattr(service, "get_user_broker_client", get_user)
    monkeypatch.setattr(service, "get_market_data_client", get_operator)
    response = auth_client.get(f"/api/screener/broker-conditions?connectionId={connection_id}")
    assert response.status_code == 200 and response.json()["source"] == "kiwoom"
    response = auth_client.post(
        "/api/screener/broker-conditions/run",
        json={"seq": "0", "connectionId": str(connection_id)},
    )
    assert response.status_code == 200 and response.json()["source"] == "kiwoom_condition"
    assert response.json()["total"] > 0
    user_id = auth_client.get("/api/auth/me").json()["user"]["id"]
    assert get_user.call_count == 2
    for call in get_user.call_args_list:
        assert str(call.args[1]) == user_id and call.args[2] == connection_id
    user_client.list_conditions.assert_called_once_with()
    user_client.run_condition.assert_called_once_with("0")
    get_operator.assert_not_called()


def test_encoding():
    screen_filter = ScreenFilter(
        sectors=["반도체"],
        kinds=["stock", "etf"],
        conditions=[Condition(field="per", op="between", value="1.00", value_to="10.50")],
    )
    encoded = service.encode_filter(screen_filter)
    assert "=" not in encoded and "+" not in encoded and "/" not in encoded
    decoded = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert decoded["conditions"][0] == {
        "field": "per",
        "op": "between",
        "value": "1.00",
        "valueTo": "10.50",
    }
    assert (decoded["universe"], decoded["watchlistGroup"]) == ("all", None)
    assert ScreenFilter.model_validate(decoded) == screen_filter
    assert service.make_chips(screen_filter)[0].label == "주식·ETF"


def _decode(encoded):
    return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))


def test_encoding_matches_frontend_golden():
    # 프론트 encodeFilter와 같은 고정값(frontend/tests/screener/encoding.json)
    screen_filter = ScreenFilter.model_validate(GOLDEN["filter"])
    assert service.encode_filter(screen_filter) == GOLDEN["encoded"]
    assert _decode(GOLDEN["encoded"]) == GOLDEN["canonical"]
    # 범위 필드가 없는 예전 링크는 전체 종목 검색으로 읽히고, 다시 만들면 기본값이 붙는다.
    legacy = GOLDEN["legacy"]
    assert "universe" not in _decode(legacy["encoded"])
    old = ScreenFilter.model_validate(_decode(legacy["encoded"]))
    assert old.universe == "all" and old.watchlist_group is None
    assert old.model_dump(mode="json", by_alias=True) == legacy["canonical"]
    assert service.encode_filter(old) == legacy["reencoded"]


def test_authentication(client):
    for path in ["saved", "broker-conditions"]:
        assert client.get(f"/api/screener/{path}").status_code == 401
    for path, payload in [
        ("parse", {"query": "test"}),
        ("run", {"filter": {}}),
        ("saved", {"name": "test", "filter": {}}),
        ("broker-conditions/run", {"seq": "0"}),
    ]:
        assert client.post(f"/api/screener/{path}", json=payload).status_code == 401
    assert (
        client.delete(
            f"/api/screener/saved/{uuid4()}", headers={"Content-Type": "application/json"}
        ).status_code
        == 401
    )


def test_broker_missing_snapshot_uses_master(auth_client, monkeypatch):
    from types import SimpleNamespace

    class Known(MockBroker):
        def run_condition(self, seq):
            return ["known"]

    monkeypatch.setattr(service, "get_market_data_client", Known)
    monkeypatch.setattr(service, "list_snapshot_rows", lambda db: SnapshotSet(None, None, []))
    monkeypatch.setattr(
        service,
        "search_stocks",
        lambda db, query, limit: [
            SimpleNamespace(
                code="known", name="종목 마스터 이름", market="KOSPI", sector=None, kind="etf"
            )
        ],
    )
    response = auth_client.post("/api/screener/broker-conditions/run", json={"seq": "0"})
    item = response.json()["items"][0]
    assert item["name"] == "종목 마스터 이름" and item["kind"] == "etf"
    assert item["price"] is None


# ── 관심종목 범위(4.0) ──────────────────────────────────────────────


@pytest.fixture
def market_db(db, monkeypatch):
    """08 종목 마스터·스냅샷을 Mock 고정 데이터로 DB에 채운다(관심종목 담기도 이 데이터를 쓴다)."""
    db.execute(text("DELETE FROM stock_snapshots"))
    db.execute(text("DELETE FROM stocks"))
    db.commit()
    broker = MockBroker()
    market_service.refresh_stocks(db, broker)
    assert market_service.refresh_snapshot(db, broker, date(2026, 10, 16))["success"] > 0
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: broker)
    return broker


def watch(client, code, group="기본"):
    response = client.post("/api/watchlist", json={"code": code, "groupName": group, "memo": None})
    assert response.status_code == 201, response.text


def run_api(client, **screen_filter):
    response = client.post("/api/screener/run", json={"filter": screen_filter})
    assert response.status_code == 200, response.text
    return response.json()


def codes(body):
    return {item["code"] for item in body["items"]}


def test_watchlist_scope_uses_only_my_items(auth_client, other_auth_client, market_db):
    watch(auth_client, "005930")
    watch(auth_client, "000660", "반도체")
    watch(auth_client, "069500", "ETF")
    watch(other_auth_client, "035420")
    watch(other_auth_client, "005380", "반도체")

    mine = run_api(auth_client, universe="watchlist")
    # kinds가 없으면 관심종목의 ETF도 본다. 다른 사용자 관심종목은 섞이지 않는다.
    assert codes(mine) == {"005930", "000660", "069500"}
    assert mine["universeCount"] == 3 and mine["total"] == 3
    other = run_api(other_auth_client, universe="watchlist")
    assert codes(other) == {"035420", "005380"} and other["universeCount"] == 2

    group = run_api(auth_client, universe="watchlist", watchlistGroup=" 반도체 ")
    assert codes(group) == {"000660"} and group["universeCount"] == 1
    etf = run_api(auth_client, universe="watchlist", watchlistGroup="ETF")
    assert codes(etf) == {"069500"} and etf["items"][0]["kind"] == "etf"
    missing = run_api(auth_client, universe="watchlist", watchlistGroup="없는 그룹")
    assert missing["universeCount"] == 0 and missing["total"] == 0 and missing["items"] == []

    stocks = run_api(auth_client, universe="watchlist", kinds=["stock"])
    assert codes(stocks) == {"005930", "000660"} and stocks["universeCount"] == 3
    only_etf = run_api(auth_client, universe="watchlist", kinds=["etf"], limit=1)
    assert codes(only_etf) == {"069500"}

    # 조건·시장·정렬 규칙은 전체 범위와 같다(PER이 없는 ETF는 누락 수로 센다).
    expected = run_api(
        auth_client,
        conditions=[{"field": "per", "op": "gt", "value": "0"}],
        kinds=["stock", "etf"],
        limit=100,
    )
    scoped = run_api(
        auth_client, universe="watchlist", conditions=[{"field": "per", "op": "gt", "value": "0"}]
    )
    assert codes(scoped) == codes(expected) & {"005930", "000660"}
    assert scoped["excludedForMissingData"] == 1
    kospi = run_api(
        auth_client,
        universe="watchlist",
        markets=["KOSPI"],
        sort={"field": "price", "direction": "asc"},
    )
    prices = [Decimal(item["price"]) for item in kospi["items"]]
    assert prices == sorted(prices)

    everything = run_api(auth_client)
    assert everything["universeCount"] is None
    assert all(item["kind"] == "stock" for item in everything["items"])
    assert everything["total"] == 80


def test_watchlist_scope_empty_and_snapshot_missing(auth_client, market_db, monkeypatch):
    empty = run_api(auth_client, universe="watchlist")
    assert empty == {
        "asOf": "2026-10-16",
        "source": "mock",
        "total": 0,
        "excludedForMissingData": 0,
        "items": [],
        "universeCount": 0,
    }
    watch(auth_client, "005930")
    monkeypatch.setattr(service, "list_snapshot_rows", lambda db: SnapshotSet(None, None, []))
    body = run_api(auth_client, universe="watchlist")
    # 범위 종목 중 스냅샷에 없는 코드는 결과에 나오지 않고 따로 세지 않는다.
    assert body["asOf"] is None and body["items"] == [] and body["universeCount"] == 1


@pytest.mark.parametrize(
    "payload,field,message",
    [
        (
            {"watchlistGroup": "배당주"},
            "watchlistGroup",
            "관심종목 범위에서만 그룹을 고를 수 있습니다.",
        ),
        (
            {"universe": "all", "watchlistGroup": "배당주"},
            "watchlistGroup",
            "관심종목 범위에서만 그룹을 고를 수 있습니다.",
        ),
        ({"universe": "watchlist", "watchlistGroup": "   "}, "watchlistGroup", None),
        ({"universe": "watchlist", "watchlistGroup": "가" * 21}, "watchlistGroup", None),
        ({"universe": "mine"}, "universe", None),
    ],
)
def test_scope_validation(auth_client, payload, field, message):
    response = auth_client.post("/api/screener/run", json={"filter": payload})
    assert response.status_code == 422, response.text
    details = response.json()["error"]["details"]
    assert [detail["field"] for detail in details] == [field]
    if message:
        assert details[0]["message"] == message


def test_scope_service_rules(db):
    assert ScreenFilter(universe="watchlist", watchlist_group=" 가 ").watchlist_group == "가"
    assert ScreenFilter(universe="watchlist", watchlist_group="가" * 20).watchlist_group
    with pytest.raises(AppError) as error:
        service.run_screen(db, ScreenFilter(universe="watchlist"))
    assert error.value.status_code == 422
    assert error.value.details[0].field == "universe"
    assert error.value.details[0].message == "관심종목 범위는 로그인한 사용자만 쓸 수 있습니다."
    # 기존 호출(user_id 없음)은 전체 범위에서 그대로 동작한다.
    assert service.run_screen(db, ScreenFilter()).universe_count is None


def test_scope_chips():
    labels = [
        chip.label
        for chip in service.make_chips(
            ScreenFilter(universe="watchlist", watchlist_group="배당주", kinds=["etf"])
        )
    ]
    assert labels == ["관심종목: 배당주", "ETF"]
    assert service.make_chips(ScreenFilter(universe="watchlist"))[0].label == "관심종목"
    assert [chip.label for chip in service.make_chips(ScreenFilter())] == []


def test_parse_watchlist_scope_without_sending_watchlist(auth_client, fake_llm, market_db):
    watch(auth_client, "005930", "배당주")
    fake_llm.register(
        "screener.parse",
        lambda req: {
            "filter": {
                "universe": "watchlist",
                "watchlistGroup": "배당주",
                "conditions": [{"field": "per", "op": "lte", "value": "10"}],
            },
            "explanation": "배당주 그룹 관심종목 중 PER 10 이하",
            "unsupported": [],
        },
    )
    query = "배당주 그룹 관심종목 중 PER 10 이하"
    response = auth_client.post("/api/screener/parse", json={"query": query})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filter"]["universe"] == "watchlist"
    assert body["filter"]["watchlistGroup"] == "배당주"
    assert [chip["label"] for chip in body["chips"]] == ["관심종목: 배당주", "PER ≤ 10배"]
    call = fake_llm.calls[0]
    assert 'universe "watchlist"' in call.system and "watchlistGroup" in call.system
    assert service.get_filter_guide() in call.system
    # 관심종목 내용(종목 코드·이름)은 LLM에 보내지 않는다. 사용자 문장만 간다.
    assert [part.text for part in call.content] == [query]
    sent = call.system + "".join(part.text for part in call.content)
    assert "005930" not in sent and "삼성전자" not in sent

    fake_llm.register(
        "screener.parse",
        lambda req: {
            "filter": {"universe": "watchlist"},
            "explanation": "관심종목 전체",
            "unsupported": [],
        },
    )
    body = auth_client.post("/api/screener/parse", json={"query": "내 관심종목 중"}).json()
    assert (body["filter"]["universe"], body["filter"]["watchlistGroup"]) == ("watchlist", None)
    assert body["chips"] == [{"label": "관심종목"}]
    # 범위를 말하지 않은 예전 출력은 전체 범위다.
    fake_llm.register(
        "screener.parse",
        lambda req: {"filter": {"kinds": ["etf"]}, "explanation": "ETF", "unsupported": []},
    )
    body = auth_client.post("/api/screener/parse", json={"query": "ETF"}).json()
    assert (body["filter"]["universe"], body["filter"]["watchlistGroup"]) == ("all", None)
    # 전체 범위에 그룹을 붙인 출력은 필터 검증 실패(503)다.
    fake_llm.register(
        "screener.parse",
        lambda req: {
            "filter": {"universe": "all", "watchlistGroup": "배당주"},
            "explanation": "",
            "unsupported": [],
        },
    )
    invalid = auth_client.post("/api/screener/parse", json={"query": "배당주 그룹"})
    assert invalid.status_code == 503 and invalid.json()["error"]["code"] == "LLM_UNAVAILABLE"


def test_saved_screens_keep_scope_and_read_legacy(auth_client, db):
    user_id = auth_client.get("/api/auth/me").json()["user"]["id"]
    # 범위 필드가 생기기 전에 저장한 검색(jsonb에 키 없음)
    repository.create_saved(
        db,
        user_id=user_id,
        name="예전 검색",
        query_text=None,
        filter={"markets": ["KOSPI"], "conditions": [], "limit": 30},
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    db.commit()
    scoped = {"universe": "watchlist", "watchlistGroup": " 배당주 ", "kinds": None}
    created = auth_client.post(
        "/api/screener/saved", json={"name": "배당 관심", "queryText": None, "filter": scoped}
    )
    assert created.status_code == 201, created.text
    assert created.json()["filter"]["watchlistGroup"] == "배당주"
    items = {item["name"]: item for item in auth_client.get("/api/screener/saved").json()["items"]}
    assert items["예전 검색"]["filter"]["universe"] == "all"
    assert items["예전 검색"]["filter"]["watchlistGroup"] is None
    assert items["배당 관심"]["filter"]["universe"] == "watchlist"
    assert items["배당 관심"]["filter"]["watchlistGroup"] == "배당주"
    invalid = auth_client.post(
        "/api/screener/saved",
        json={"name": "잘못", "filter": {"watchlistGroup": "배당주"}},
    )
    assert invalid.status_code == 422
