import base64
import json
from dataclasses import asdict, replace
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.integrations.llm.fake import FakeStructuredLLM
from app.modules.market.service import SnapshotRow, SnapshotSet
from app.modules.screener import service
from app.modules.screener.schemas import Condition, ScreenFilter


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
        provider = "kiwoom"
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
    assert ScreenFilter.model_validate(decoded) == screen_filter
    assert service.make_chips(screen_filter)[0].label == "주식·ETF"


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
