import logging
from datetime import date
from types import SimpleNamespace
from urllib.parse import parse_qs
from uuid import UUID, uuid4

import httpx
import pytest
import respx
from sqlalchemy import delete, func, select

from app.core.config import get_settings
from app.core.crypto import decrypt_str
from app.core.errors import AppError
from app.integrations.brokers import toss
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.modules.market import jobs, service
from app.modules.market.models import BrokerConnection, Stock, StockSnapshot


@pytest.fixture
def seeded(db):
    db.execute(delete(StockSnapshot))
    db.execute(delete(Stock))
    db.commit()
    broker = MockBroker()
    service.refresh_stocks(db, broker)
    result = service.refresh_snapshot(db, broker, date(2026, 10, 16))
    assert result["success"] == 90
    return broker


def connection_data(**changes):
    return dict(
        provider="mock",
        environment="mock",
        label="샘플 연결",
        appKey="test-application-key",
        appSecret="test-secret-value",
        accountNo="test-account-1234",
        **changes,
    )


def test_stock_api_search_detail_and_validation(auth_client, db, seeded):
    r = auth_client.get("/api/market/stocks", params={"q": "삼성"})
    assert r.status_code == 200
    assert r.json()["source"] == "mock"
    assert r.json()["items"][0]["name"].startswith("삼성")
    assert auth_client.get("/api/market/stocks?q=005930").json()["items"][0]["code"] == "005930"
    assert not auth_client.get("/api/market/stocks?q=005930&market=KOSDAQ").json()["items"]
    assert not auth_client.get("/api/market/stocks?q=%25").json()["items"]
    assert auth_client.get("/api/market/stocks?limit=51").status_code == 422
    detail = auth_client.get("/api/market/stocks/005930")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["name"] == "삼성전자" and data["snapshot"]["asOf"] == "2026-10-16"
    assert isinstance(data["snapshot"]["price"], str)
    assert isinstance(data["snapshot"]["changeRate"], float)
    assert isinstance(data["snapshot"]["marketCap"], int)
    assert data["snapshot"]["high52w"] and data["quote"]["source"] == "mock"
    assert auth_client.get("/api/market/stocks/missing").status_code == 404
    quotes = auth_client.get("/api/market/quotes?codes=005930,000660").json()
    assert len(quotes["items"]) == 2
    assert isinstance(quotes["items"][0]["price"], str)
    assert (
        auth_client.get(
            "/api/market/quotes", params={"codes": ",".join(["005930"] * 51)}
        ).status_code
        == 422
    )
    assert auth_client.get("/api/market/quotes?codes=").status_code == 422
    assert auth_client.get("/api/market/quotes?codes=005930,").status_code == 422
    assert (
        auth_client.get("/api/market/stocks/005930/candles?from=2026-01-01&to=2026-01-10").json()[
            "source"
        ]
        == "mock"
    )
    assert (
        auth_client.get(
            "/api/market/stocks/005930/candles?from=2025-01-01&to=2026-10-16"
        ).status_code
        == 422
    )
    assert (
        auth_client.get(
            "/api/market/stocks/005930/candles?from=2026-10-16&to=2026-01-01"
        ).status_code
        == 422
    )
    status = auth_client.get("/api/market/snapshot/status").json()
    assert status == {"asOf": "2026-10-16", "count": 90, "source": "mock"}


def test_search_ranking_and_snapshot_join(db, seeded):
    db.add_all(
        [
            Stock(code="삼성", name="가나다", market="KOSPI", sector=None, source="mock"),
            Stock(code="custom", name="가나다삼성", market="KOSPI", sector=None, source="mock"),
        ]
    )
    db.commit()
    rows = service.search_stocks(db, "삼성", limit=50)
    assert rows[0].code == "삼성"
    assert rows[-1].name == "가나다삼성"
    service.refresh_snapshot(db, seeded, date(2026, 10, 17), limit=2)
    latest = service.list_snapshot_rows(db)
    assert latest.as_of == date(2026, 10, 17) and len(latest.rows) == 2
    assert (
        latest.rows[0].name
        and latest.rows[0].sector
        and latest.rows[0].market in {"KOSPI", "KOSDAQ"}
    )
    assert len(service.list_snapshot_rows(db, date(2026, 10, 16)).rows) == 90


def test_quote_failure_dependency_override_and_cache(auth_client, app, db, seeded, monkeypatch):
    class Failing(MockBroker):
        def get_quotes(self, codes):
            raise BrokerError("BROKER_UNAVAILABLE")

    app.dependency_overrides[service.get_market_data_client] = lambda: Failing()
    data = auth_client.get("/api/market/stocks/005930").json()
    assert data["quote"] is None and data["snapshot"] is not None
    app.dependency_overrides.clear()
    clock = [0]
    monkeypatch.setattr(service, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    class Counting(MockBroker):
        calls = 0

        def get_quotes(self, codes):
            self.calls += 1
            return super().get_quotes(codes)

    client = Counting()
    service._quote_cache.clear()
    monkeypatch.setattr(service, "get_market_data_client", lambda: client)
    assert service.get_quotes(["005930"]) == service.get_quotes(["005930"])
    assert client.calls == 1
    clock[0] = 31
    service.get_quotes(["005930"])
    assert client.calls == 2


def test_failed_quote_codes_are_omitted(monkeypatch):
    class Partial(MockBroker):
        def get_quotes(self, codes):
            if "missing" in codes:
                raise BrokerError("BROKER_UNAVAILABLE")
            return super().get_quotes(codes)

    monkeypatch.setattr(service, "get_market_data_client", lambda: Partial())
    assert [q.code for q in service.get_quotes(["missing", "005930"])] == ["005930"]


def test_connections_crud_encryption_isolation(auth_client, other_auth_client, db):
    values = connection_data()
    r = auth_client.post("/api/market/connections", json=values)
    assert r.status_code == 201, r.text
    body = r.json()
    cid = body["id"]
    assert body["status"] == "unverified"
    assert body["appKeyMasked"] == "****-key" and body["accountNoMasked"] == "****1234"
    assert (
        values["appKey"] not in r.text
        and values["appSecret"] not in r.text
        and values["accountNo"] not in r.text
    )
    row = db.get(BrokerConnection, UUID(cid))
    assert row.app_key_enc != values["appKey"] and decrypt_str(row.app_key_enc) == values["appKey"]
    assert decrypt_str(row.app_secret_enc) == values["appSecret"]
    assert decrypt_str(row.account_no_enc) == values["accountNo"]
    assert auth_client.post("/api/market/connections", json=values).status_code == 409
    assert not other_auth_client.get("/api/market/connections").json()["items"]
    for other in (other_auth_client,):
        assert other.post(f"/api/market/connections/{cid}/verify", json={}).status_code == 404
        assert (
            other.delete(
                f"/api/market/connections/{cid}", headers={"Content-Type": "application/json"}
            ).status_code
            == 404
        )
    with pytest.raises(AppError) as exc:
        service.get_user_broker_client(db, row.user_id, UUID(cid))
    assert exc.value.code == "BROKER_NOT_CONNECTED"
    assert (
        auth_client.post(f"/api/market/connections/{cid}/verify", json={}).json()["status"]
        == "active"
    )
    broker = service.get_user_broker_client(db, row.user_id, UUID(cid))
    assert len(broker.get_holdings().holdings) == 5
    assert (
        auth_client.delete(
            f"/api/market/connections/{cid}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.post(f"/api/market/connections/{cid}/verify", json={}).status_code == 404
    with pytest.raises(AppError) as exc:
        service.get_user_broker_client(db, row.user_id, UUID(cid))
    assert exc.value.status_code == 404


def test_connection_validation_failure_and_mask_length(auth_client, monkeypatch):
    settings = get_settings()
    r = auth_client.post(
        "/api/market/connections",
        json={**connection_data(), "provider": "toss", "environment": "mock"},
    )
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "environment"
    monkeypatch.setattr(settings, "app_env", "production")
    r = auth_client.post("/api/market/connections", json=connection_data())
    assert r.status_code == 422 and r.json()["error"]["details"][0]["field"] == "provider"
    monkeypatch.setattr(settings, "app_env", "test")
    for field in ("appKey", "appSecret"):
        assert (
            auth_client.post(
                "/api/market/connections", json={**connection_data(), field: ""}
            ).status_code
            == 422
        )
    r = auth_client.post("/api/market/connections", json={**connection_data(), "appKey": "x" * 200})
    assert r.status_code == 201 and len(r.json()["appKeyMasked"]) <= 30

    class Failing(MockBroker):
        def get_holdings(self):
            raise BrokerError("BROKER_IP_NOT_ALLOWED")

    monkeypatch.setattr(service, "_connection_client", lambda row: Failing())
    verify = auth_client.post(f"/api/market/connections/{r.json()['id']}/verify", json={})
    assert verify.status_code == 200
    assert (
        verify.json()["status"] == "error"
        and verify.json()["lastErrorCode"] == "BROKER_IP_NOT_ALLOWED"
    )
    assert verify.json()["lastVerifiedAt"]


@respx.mock(assert_all_mocked=True, using="httpx")
def test_egress_ip_cached_and_failure(respx_mock, auth_client):
    respx_mock.route(host="testserver").pass_through()
    service.get_egress_ip.cache_clear()
    route = respx_mock.get("https://api.ipify.org").respond(200, json={"ip": "203.0.113.7"})
    for _ in range(2):
        assert auth_client.get("/api/market/connections/egress-ip").json() == {"ip": "203.0.113.7"}
    assert route.call_count == 1
    service.get_egress_ip.cache_clear()
    route.respond(500)
    assert auth_client.get("/api/market/connections/egress-ip").json() == {"ip": None}
    service.get_egress_ip.cache_clear()


TOSS = "https://openapi.tossinvest.com"
TOSS_KEYS = {"appKey": "test-toss-key-abcd", "appSecret": "test-toss-secret-wxyz"}
TOSS_ACCOUNTS = "/api/market/connections/toss-accounts"
REVOKED = {"error": {"code": "token-revoked", "message": "새로 발급된 토큰으로 대체되었습니다."}}


@pytest.fixture
def toss_http(monkeypatch):
    immediate = SimpleNamespace(acquire=lambda: None)
    monkeypatch.setattr(toss, "BUCKETS", {name: immediate for name in toss.BUCKETS})
    service._make_client.cache_clear()
    with respx.mock(assert_all_mocked=True, assert_all_called=False, using="httpx") as mock:
        mock.route(host="testserver").pass_through()
        yield mock
    service._make_client.cache_clear()


def test_toss_accounts_last4_only_and_keys_not_kept(auth_client, db, toss_http, caplog):
    caplog.set_level(logging.DEBUG)
    token = toss_http.post(TOSS + "/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    accounts = toss_http.get(TOSS + "/api/v1/accounts").respond(
        200,
        json={
            "result": [{"accountNo": "12345678901", "accountSeq": 1, "accountType": "BROKERAGE"}]
        },
    )
    r = auth_client.post(TOSS_ACCOUNTS, json=TOSS_KEYS)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "items": [{"accountSeq": "1", "accountType": "BROKERAGE", "accountNoLast4": "8901"}]
    }
    assert "12345678901" not in r.text
    sent = parse_qs(token.calls[0].request.content.decode())
    assert sent["client_id"] == [TOSS_KEYS["appKey"]]
    assert sent["client_secret"] == [TOSS_KEYS["appSecret"]]
    assert "X-Tossinvest-Account" not in accounts.calls[0].request.headers
    # 키는 저장하지 않는다: 연결 행도, 연결 클라이언트 캐시도 남지 않는다.
    assert db.scalar(select(func.count()).select_from(BrokerConnection)) == 0
    assert service._make_client.cache_info().currsize == 0
    for value in TOSS_KEYS.values():
        assert value not in r.text + caplog.text

    accounts.respond(200, json={"result": []})
    assert auth_client.post(TOSS_ACCOUNTS, json=TOSS_KEYS).json() == {"items": []}


@pytest.mark.parametrize("where", ["token", "accounts"])
@pytest.mark.parametrize(
    ("status", "code"), [(403, "BROKER_IP_NOT_ALLOWED"), (401, "BROKER_AUTH_FAILED")]
)
def test_toss_accounts_broker_errors(auth_client, toss_http, where, status, code):
    token = toss_http.post(TOSS + "/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    accounts = toss_http.get(TOSS + "/api/v1/accounts").respond(200, json={"result": []})
    (token if where == "token" else accounts).respond(
        status, json={"error": {"code": "test-error", "message": "테스트 오류"}}
    )
    r = auth_client.post(TOSS_ACCOUNTS, json=TOSS_KEYS)
    assert r.status_code == 502 and r.json()["error"]["code"] == code
    assert token.call_count == 1 and accounts.call_count == (where == "accounts")


def test_toss_accounts_validation_and_auth(client, auth_client, toss_http):
    token = toss_http.post(TOSS + "/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    for field in ("appKey", "appSecret"):
        for value in ("", "   "):
            r = auth_client.post(TOSS_ACCOUNTS, json={**TOSS_KEYS, field: value})
            assert r.status_code == 422, r.text
            assert r.json()["error"]["details"][0]["field"] == field
    assert auth_client.post(TOSS_ACCOUNTS, json={"appKey": "test-key"}).status_code == 422
    assert (
        auth_client.post(TOSS_ACCOUNTS, json={**TOSS_KEYS, "appKey": "x" * 201}).status_code == 422
    )
    assert (
        auth_client.post(
            TOSS_ACCOUNTS, content="appKey=a", headers={"Content-Type": "text/plain"}
        ).status_code
        == 422
    )
    assert client.post(TOSS_ACCOUNTS, json=TOSS_KEYS).status_code == 401
    assert token.call_count == 0


def test_toss_accounts_then_connection_reissues_revoked_token(auth_client, toss_http):
    # 토스처럼 마지막으로 발급한 토큰만 유효하게 둔다.
    issued = []

    def issue(request):
        issued.append(f"test-token-{len(issued) + 1}")
        return httpx.Response(200, json={"access_token": issued[-1], "expires_in": 86400})

    def latest_only(payload):
        def handler(request):
            if request.headers["Authorization"] != f"Bearer {issued[-1]}":
                return httpx.Response(401, json=REVOKED)
            return httpx.Response(200, json=payload)

        return handler

    toss_http.post(TOSS + "/oauth2/token").mock(side_effect=issue)
    account = {"accountNo": "12345678901", "accountSeq": 7, "accountType": "BROKERAGE"}
    toss_http.get(TOSS + "/api/v1/accounts").mock(side_effect=latest_only({"result": [account]}))
    holdings = toss_http.get(TOSS + "/api/v1/holdings").mock(
        side_effect=latest_only({"result": {"items": []}})
    )
    seq = auth_client.post(TOSS_ACCOUNTS, json=TOSS_KEYS).json()["items"][0]["accountSeq"]
    created = auth_client.post(
        "/api/market/connections",
        json={
            "provider": "toss",
            "environment": "real",
            "label": "토스",
            **TOSS_KEYS,
            "accountNo": seq,
        },
    )
    assert created.status_code == 201, created.text
    verify = f"/api/market/connections/{created.json()['id']}/verify"
    assert auth_client.post(verify, json={}).json()["status"] == "active"
    # 같은 키로 계좌를 다시 불러오면 연결 클라이언트에 캐시된 토큰이 무효가 된다.
    assert auth_client.post(TOSS_ACCOUNTS, json=TOSS_KEYS).status_code == 200
    again = auth_client.post(verify, json={}).json()
    assert again["status"] == "active" and again["lastErrorCode"] is None
    sent = [call.request.headers["Authorization"] for call in holdings.calls]
    assert sent == ["Bearer test-token-2", "Bearer test-token-2", "Bearer test-token-4"]
    assert {call.request.headers["X-Tossinvest-Account"] for call in holdings.calls} == {"7"}


def test_auth_required_and_nonexistent_ids(client, auth_client):
    for path in (
        "stocks",
        "quotes?codes=005930",
        "connections",
        "snapshot/status",
        "connections/egress-ip",
    ):
        assert client.get("/api/market/" + path).status_code == 401
    assert auth_client.post(f"/api/market/connections/{uuid4()}/verify", json={}).status_code == 404


def test_batch_resume_delisting_failure_rate_pruning(db, seeded):
    result = service.refresh_snapshot(db, seeded, date(2026, 10, 16), resume=True)
    assert result == {"success": 0, "failed": 0, "skipped": 90, "exit_code": 0}

    class Removed(MockBroker):
        def list_stocks(self, market):
            return [r for r in super().list_stocks(market) if r.code != "005930"]

    service.refresh_stocks(db, Removed())
    assert db.get(Stock, "005930").listed is False
    service.refresh_stocks(db, seeded)

    class Failing(MockBroker):
        def get_fundamentals(self, code):
            raise BrokerError("BROKER_UNAVAILABLE")

    assert service.refresh_snapshot(db, Failing(), date(2026, 10, 17), limit=10)["exit_code"] == 1

    class TenPercent(MockBroker):
        calls = 0

        def get_fundamentals(self, code):
            self.calls += 1
            if self.calls == 1:
                raise BrokerError("BROKER_UNAVAILABLE")
            return super().get_fundamentals(code)

    result = service.refresh_snapshot(db, TenPercent(), date(2026, 10, 17), limit=10)
    assert result["success"] == 9 and result["exit_code"] == 0
    assert service.prune_snapshots(db, date(2026, 10, 17)) == 90


def test_seed_mock_cli(db, monkeypatch):
    class Context:
        def __enter__(self):
            return db

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(jobs, "SessionLocal", Context)
    db.execute(delete(StockSnapshot))
    db.execute(delete(Stock))
    db.commit()
    assert jobs.main(["seed-mock"]) == 0
    assert db.scalar(select(func.count()).select_from(Stock)) == 90
    assert db.scalar(select(func.count()).select_from(StockSnapshot)) == 90
    assert jobs.main(["refresh-snapshot", "--provider", "mock", "--resume"]) == 0
    assert jobs.main(["prune-snapshots", "--keep-days", "30"]) == 0
