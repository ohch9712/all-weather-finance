import json
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
import respx
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError

from app.integrations.brokers import kiwoom, toss
from app.integrations.brokers.errors import BrokerError, UnsupportedBroker
from app.integrations.brokers.mock import MockBroker
from app.modules.market import service
from app.modules.market.models import Stock, StockSnapshot


@pytest.fixture
def etf_seed(db):
    db.execute(delete(StockSnapshot))
    db.execute(delete(Stock))
    db.commit()
    broker = MockBroker()
    assert service.refresh_stocks(db, broker) == 90
    assert service.refresh_snapshot(db, broker, date(2026, 10, 16))["success"] == 90
    return broker


def test_mock_etf_identifiers_metrics_and_determinism():
    broker = MockBroker()
    rows = broker.list_etfs()
    assert rows == MockBroker().list_etfs() and len(rows) == 10
    assert len({r.code for r in rows}) == 10
    assert all(r.kind == "etf" and r.market == "KOSPI" for r in rows)
    assert len(broker.list_stocks("KOSPI")) == 50
    assert len(broker.list_stocks("KOSDAQ")) == 30
    for row in rows:
        f = broker.get_fundamentals(row.code)
        assert f == MockBroker().get_fundamentals(row.code)
        assert f.price > 0 and f.volume > 0
        assert all(
            getattr(f, name) is None
            for name in ("per", "pbr", "roe", "eps", "bps", "foreign_ratio")
        )


def test_etf_api_filter_detail_status_and_public_service(auth_client, db, etf_seed):
    response = auth_client.get("/api/market/stocks?q=KODEX&kind=etf&limit=50")
    assert response.status_code == 200
    rows = response.json()["items"]
    assert len(rows) == 10 and all(r["kind"] == "etf" for r in rows)
    assert not auth_client.get("/api/market/stocks?q=KODEX&kind=stock").json()["items"]
    assert not auth_client.get("/api/market/stocks?q=KODEX&kind=etf&market=KOSDAQ").json()["items"]
    assert (
        auth_client.get("/api/market/stocks?q=005930&kind=stock").json()["items"][0]["kind"]
        == "stock"
    )
    assert len(service.search_stocks(db, "KODEX", kind="etf")) == 10
    assert not service.search_stocks(db, "KODEX", kind="stock")
    assert len(service.search_stocks(db, "KODEX")) == 10
    for invalid in ("bond", "ETF", ""):
        error = auth_client.get("/api/market/stocks", params={"kind": invalid})
        assert error.status_code == 422
        assert error.json()["error"]["code"] == "VALIDATION_ERROR"
        assert error.json()["error"]["details"][0]["field"] == "kind"
    detail = auth_client.get("/api/market/stocks/069500").json()
    assert detail["kind"] == "etf" and detail["quote"]["price"]
    for name in ("per", "pbr", "roe", "eps", "bps", "foreignRatio"):
        assert detail["snapshot"][name] is None
    assert auth_client.get("/api/market/snapshot/status").json()["count"] == 90
    snapshot = service.list_snapshot_rows(db)
    assert len([r for r in snapshot.rows if r.kind == "etf"]) == 10
    assert len([r for r in snapshot.rows if r.kind == "stock"]) == 80


def test_refresh_without_etf_capability_preserves_etfs(db, etf_seed):
    class StocksOnly(MockBroker):
        capabilities = MockBroker.capabilities - {"ETF_LIST"}

        def list_etfs(self):
            pytest.fail("ETF_LIST가 없으면 ETF 목록을 호출하면 안 됩니다.")

        def list_stocks(self, market):
            return [r for r in super().list_stocks(market) if r.code != "005930"]

    assert service.refresh_stocks(db, StocksOnly()) == 79
    assert db.get(Stock, "005930").listed is False
    assert all(db.get(Stock, row.code).listed for row in etf_seed.list_etfs())
    assert db.scalar(select(func.count()).select_from(Stock).where(Stock.kind == "etf")) == 10


def test_failed_etf_list_preserves_existing_catalog_and_kind_delisting(db, etf_seed):
    class Failed(MockBroker):
        def list_etfs(self):
            raise BrokerError("BROKER_UNAVAILABLE")

    with pytest.raises(BrokerError):
        service.refresh_stocks(db, Failed())
    assert all(db.get(Stock, row.code).listed for row in etf_seed.list_etfs())

    class Removed(MockBroker):
        def list_etfs(self):
            return [r for r in super().list_etfs() if r.code != "069500"]

    assert service.refresh_stocks(db, Removed()) == 89
    assert db.get(Stock, "069500").listed is False
    assert db.get(Stock, "005930").listed is True
    assert service.refresh_stocks(db, etf_seed) == 90
    assert db.get(Stock, "069500").listed is True


def test_kind_database_default_and_constraints(db):
    values = {"code": "kind-default", "name": "기본값 확인", "market": "KOSPI", "source": "mock"}
    db.execute(
        text(
            "INSERT INTO stocks (code, name, market, source, updated_at) "
            "VALUES (:code, :name, :market, :source, now())"
        ),
        values,
    )
    assert db.get(Stock, "kind-default").kind == "stock"
    for kind in ("bond", None):
        with pytest.raises(IntegrityError), db.begin_nested():
            db.execute(
                text("UPDATE stocks SET kind=:kind WHERE code=:code"),
                {"kind": kind, "code": "kind-default"},
            )


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_etf_catalog_pagination_market_and_metrics(respx_mock, monkeypatch):
    clock = [datetime(2026, 10, 17, tzinfo=UTC)]
    monkeypatch.setattr(kiwoom, "now_utc", lambda: clock[0])
    monkeypatch.setattr(kiwoom.BUCKET, "acquire", lambda: None)
    respx_mock.post("https://mockapi.kiwoom.com/oauth2/token").respond(
        200, json={"token": "test-token", "expires_dt": "20261019180000", "return_code": 0}
    )

    def catalog(request):
        assert request.headers["api-id"] == "ka10099"
        assert json.loads(request.content) == {"mrkt_tp": "8"}
        if request.headers["next-key"] == "next":
            return httpx.Response(
                200,
                json={
                    "list": [
                        {
                            "code": "229200",
                            "name": "ETF 예시",
                            "marketCode": "10",
                            "upName": "지수",
                        },
                        {"code": "skip_NX", "name": "제외"},
                    ]
                },
            )
        return httpx.Response(
            200,
            headers={"cont-yn": "Y", "next-key": "next"},
            json={
                "list": [
                    {"code": "069500", "name": "KODEX 200"},
                    {"code": "379800", "name": "KODEX 미국S&P500", "marketName": "코스피"},
                ]
            },
        )

    listing = respx_mock.post("https://mockapi.kiwoom.com/api/dostk/stkinfo").mock(
        side_effect=catalog
    )

    def prices(request):
        assert request.headers["api-id"] == "ka40004"
        assert json.loads(request.content) == {
            "txon_type": "0",
            "navpre": "0",
            "mngmcomp": "0000",
            "txon_yn": "0",
            "trace_idex": "0",
            "stex_tp": "1",
        }
        return httpx.Response(
            200,
            json={
                "etfall_mrpr": [
                    {
                        "stk_cd": "069500",
                        "close_pric": "-24,200",
                        "pre_rt": "-1.25",
                        "pred_pre": "-300",
                        "trde_qty": "1,234",
                    },
                    {"stk_cd": "379800", "close_pric": "+23000", "pre_rt": "", "trde_qty": "0"},
                ]
            },
        )

    route = respx_mock.post("https://mockapi.kiwoom.com/api/dostk/etf").mock(side_effect=prices)
    broker = kiwoom.KiwoomBroker("test-app", "test-secret")
    assert "ETF_LIST" in broker.capabilities
    # 목록 갱신을 먼저 실행하지 않아도 독립 지표 조회에서 ETF를 식별한다.
    info = broker.get_fundamentals("069500")
    assert info.price == Decimal("24200") and info.change_rate == Decimal("-1.25")
    assert info.volume == 1234
    assert all(
        getattr(info, name) is None
        for name in (
            "market_cap",
            "trading_value",
            "per",
            "pbr",
            "roe",
            "eps",
            "bps",
            "foreign_ratio",
            "high_52w",
            "low_52w",
        )
    )
    quote = broker.get_quotes(["069500", "379800"])
    assert quote[0].change == -300 and quote[0].price == 24200
    assert quote[1].change_rate is None and quote[1].volume == 0
    assert route.call_count == 1 and listing.call_count == 2
    rows = broker.list_etfs()
    assert [r.market for r in rows] == ["KOSPI", "KOSPI", "KOSDAQ"]
    assert all(r.kind == "etf" for r in rows)
    with pytest.raises(BrokerError) as exc:
        broker.get_fundamentals("229200")
    assert exc.value.code == "BROKER_UNAVAILABLE"
    clock[0] += timedelta(seconds=31)
    broker.get_quotes(["069500"])
    assert route.call_count == 2


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_etf_filter_and_stock_filter(respx_mock, monkeypatch):
    for bucket in toss.BUCKETS.values():
        monkeypatch.setattr(bucket, "acquire", lambda: None)
    respx_mock.post("https://openapi.tossinvest.com/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )

    def listing(request):
        params = request.url.params
        assert params["market"] in {"KOSPI", "KOSDAQ"}
        if params["securityType"] == "ETF":
            rows = [{"symbol": "069500", "name": "KODEX 200", "securityType": "ETF"}]
            return httpx.Response(200, json={"result": rows if params["market"] == "KOSPI" else []})
        assert params["securityType"] == "STOCK"
        return httpx.Response(200, json={"result": [{"symbol": "005930", "name": "삼성전자"}]})

    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/stocks/all").mock(
        side_effect=listing
    )
    broker = toss.TossBroker("test-app", "test-secret")
    assert "ETF_LIST" in broker.capabilities
    assert broker.list_etfs()[0].kind == "etf"
    assert broker.list_stocks("KOSPI")[0].kind == "stock"
    assert route.call_count == 3
    with pytest.raises(BrokerError) as exc:
        UnsupportedBroker().list_etfs()
    assert exc.value.code == "BROKER_NOT_SUPPORTED"
