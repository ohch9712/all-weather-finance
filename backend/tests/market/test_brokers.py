import json
import socket
import threading
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
import respx
from websockets.sync.server import serve

from app.integrations.brokers import kiwoom, toss
from app.integrations.brokers.errors import BrokerError
from app.integrations.brokers.mock import MockBroker
from app.integrations.brokers.ratelimit import TokenBucket, group_rate, request_with_retry


@pytest.fixture(autouse=True)
def immediate_buckets(monkeypatch):
    immediate = SimpleNamespace(acquire=lambda: None)
    monkeypatch.setattr(kiwoom, "BUCKET", immediate)
    monkeypatch.setattr(toss, "BUCKETS", {name: immediate for name in toss.BUCKETS})


def test_mock_all_methods_are_deterministic():
    a, b = MockBroker(), MockBroker()
    assert len(a.capabilities) == 8
    assert len(a.list_stocks("KOSPI")) == 50
    assert len(a.list_stocks("KOSDAQ")) == 30
    for method, args in [
        ("list_stocks", ("KOSPI",)),
        ("list_etfs", ()),
        ("get_fundamentals", ("005930",)),
        ("get_quotes", (["005930", "000660"],)),
        ("get_daily_candles", ("005930", date(2026, 1, 1), date(2026, 1, 10))),
        ("get_holdings", ()),
        ("get_executions", (date(2026, 1, 1), date(2026, 12, 31))),
        ("list_conditions", ()),
        ("run_condition", ("0",)),
        ("run_condition", ("1",)),
    ]:
        assert getattr(a, method)(*args) == getattr(b, method)(*args)
    assert len(a.get_holdings().holdings) == 5
    assert a.get_holdings().cash_krw == 5000000
    assert len(a.get_executions(date(2026, 1, 1), date(2026, 12, 31))) == 20
    assert a.get_quotes(["005930"])[0].price == a.get_fundamentals("005930").price


def test_token_bucket_and_opening_limit():
    clock = [0.0]
    sleeps = []

    def sleep(delay):
        sleeps.append(delay)
        clock[0] += delay

    bucket = TokenBucket(4, clock=lambda: clock[0], sleep=sleep)
    for _ in range(5):
        bucket.acquire()
    assert clock[0] == 1
    assert sleeps == [0.25] * 4
    assert group_rate("ORDER_INFO", datetime(2026, 10, 16, 0, 5, tzinfo=UTC)) == 3
    assert group_rate("ORDER_INFO", datetime(2026, 10, 16, 0, 10, tzinfo=UTC)) == 6


@respx.mock(assert_all_mocked=True, using="httpx")
def test_retry_after_backoff_and_exhaustion(respx_mock):
    route = respx_mock.get("https://broker.example/quotes").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "5"}),
            httpx.Response(429),
            httpx.Response(429),
            httpx.Response(429),
        ]
    )
    sleeps = []
    with httpx.Client(timeout=10) as client:
        with pytest.raises(BrokerError, match="호출 한도") as exc:
            request_with_retry(
                client,
                "GET",
                "https://broker.example/quotes",
                SimpleNamespace(acquire=lambda: None),
                sleep=sleeps.append,
            )
    assert exc.value.code == "BROKER_RATE_LIMITED"
    assert route.call_count == 4
    assert sleeps == [5, 2, 4]


def kiwoom_token(respx_mock):
    return respx_mock.post("https://mockapi.kiwoom.com/oauth2/token").respond(
        200, json={"token": "test-token", "expires_dt": "20261017180000", "return_code": 0}
    )


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_parsing_pagination_and_token_refresh(respx_mock, monkeypatch):
    clock = [datetime(2026, 10, 17, 0, 0, tzinfo=UTC)]
    monkeypatch.setattr(kiwoom, "now_utc", lambda: clock[0])
    token = kiwoom_token(respx_mock)
    calls = []

    def response(request):
        calls.append(request)
        if request.headers["api-id"] == "ka10099":
            if json.loads(request.content)["mrkt_tp"] == "8":
                return httpx.Response(200, json={"return_code": 0, "list": []})
            if request.headers["next-key"] == "next":
                return httpx.Response(
                    200,
                    json={
                        "return_code": 0,
                        "list": [{"code": "000660", "name": "SK하이닉스", "upName": "반도체"}],
                    },
                )
            return httpx.Response(
                200,
                headers={"cont-yn": "Y", "next-key": "next"},
                json={
                    "return_code": 0,
                    "list": [{"code": "005930", "name": "삼성전자", "upName": "반도체"}],
                },
            )
        return httpx.Response(
            200,
            json={
                "return_code": 0,
                "cur_prc": "-071200",
                "pred_pre": "-800",
                "flu_rt": "-1.11",
                "trde_qty": "+001234",
                "mac": "4250000",
                "per": "12.40",
                "pbr": "1.30",
                "roe": "10.50",
                "250hgst": "+88800",
                "250lwst": "-58000",
            },
        )

    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/stkinfo").mock(side_effect=response)
    broker = kiwoom.KiwoomBroker("test-app", "test-secret")
    assert len(broker.list_stocks("KOSPI")) == 2
    assert json.loads(calls[0].content) == {"mrkt_tp": "0"}
    info = broker.get_fundamentals("005930")
    assert info.price == Decimal("71200")
    assert info.change_rate == Decimal("-1.11")
    assert info.market_cap == 425000000000000
    assert info.high_52w == 88800 and info.low_52w == 58000
    assert info.volume == 1234 and info.eps is None
    assert broker.get_quotes(["005930"])[0].change == -800
    assert token.call_count == 1
    clock[0] = datetime(2026, 10, 17, 8, 56, tzinfo=UTC)
    broker.get_token()
    assert token.call_count == 2


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"return_code": 8010}, "BROKER_IP_NOT_ALLOWED"),
        ({"return_code": 3, "return_msg": "실패 [8010:IP 오류]"}, "BROKER_IP_NOT_ALLOWED"),
        ({"return_code": 8001}, "BROKER_AUTH_FAILED"),
        ({"return_code": 1700}, "BROKER_RATE_LIMITED"),
        ({"return_code": 8104}, "BROKER_NOT_SUPPORTED"),
        ({"return_code": 1999}, "BROKER_UNAVAILABLE"),
    ],
)
@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_errors(respx_mock, payload, code):
    respx_mock.post("https://mockapi.kiwoom.com/oauth2/token").respond(200, json=payload)
    with pytest.raises(BrokerError) as exc:
        kiwoom.KiwoomBroker("test-app", "test-secret").get_token()
    assert exc.value.code == code
    assert "test-secret" not in str(exc.value)


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_candles_and_holdings(respx_mock, monkeypatch):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)
    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/chart").respond(
        200,
        json={
            "return_code": 0,
            "stk_dt_pole_chart_qry": [
                {
                    "dt": "20261016",
                    "open_pric": "-70000",
                    "high_pric": "+72000",
                    "low_pric": "-69000",
                    "cur_prc": "+71000",
                    "trde_qty": "100",
                },
            ],
        },
    )
    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").respond(
        200,
        json={
            "return_code": 0,
            "acnt_evlt_remn_indv_tot": [
                {
                    "stk_cd": "A005930",
                    "stk_nm": "삼성전자",
                    "rmnd_qty": "00010",
                    "pur_pric": "65000",
                    "evlt_amt": "710000",
                },
            ],
        },
    )
    broker = kiwoom.KiwoomBroker("test-app", "test-secret")
    candle = broker.get_daily_candles("005930", date(2026, 10, 1), date(2026, 10, 16))[0]
    assert candle.open == 70000 and candle.low == 69000
    holding = broker.get_holdings().holdings[0]
    assert holding.code == "005930" and holding.eval_amount == 710000


def test_kiwoom_condition_local_websocket(monkeypatch):
    received = []

    def handler(ws):
        login = json.loads(ws.recv())
        received.append(login)
        ws.send(json.dumps({"trnm": "PING", "data": "keep"}))
        received.append(json.loads(ws.recv()))
        ws.send(json.dumps({"trnm": "LOGIN", "return_code": 0}))
        listing = json.loads(ws.recv())
        received.append(listing)
        ws.send(json.dumps({"trnm": "CNSRLST", "return_code": 0, "data": [["0", "저PER"]]}))
        try:
            req = json.loads(ws.recv())
            received.append(req)
            ws.send(
                json.dumps({"trnm": "CNSRREQ", "return_code": 0, "data": [{"9001": "A005930"}]})
            )
        except Exception:
            pass

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    with serve(handler, sock=sock) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        broker = kiwoom.KiwoomBroker(
            "test-app", "test-secret", websocket_url=f"ws://127.0.0.1:{sock.getsockname()[1]}"
        )
        monkeypatch.setattr(broker, "get_token", lambda: "test-token")
        assert broker.list_conditions()[0].name == "저PER"
        assert broker.run_condition("0") == ["005930"]
        server.shutdown()
        thread.join(timeout=2)
    assert {"trnm": "PING", "data": "keep"} in received
    assert any(r.get("search_type") == "0" and r.get("stex_tp") == "K" for r in received)


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_token_form_account_header_and_foreign_amount(respx_mock):
    token = respx_mock.post("https://openapi.tossinvest.com/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    holdings = respx_mock.get("https://openapi.tossinvest.com/api/v1/holdings").respond(
        200,
        json={
            "result": {
                "items": [
                    {
                        "symbol": "005930",
                        "name": "삼성전자",
                        "quantity": "10",
                        "averagePurchasePrice": "65000",
                        "marketValue": {"amount": "710000"},
                        "currency": "KRW",
                    },
                    {
                        "symbol": "AAPL",
                        "name": "애플",
                        "quantity": "1.5",
                        "averagePurchasePrice": "150.25",
                        "marketValue": {"amount": "300.75"},
                        "currency": "USD",
                    },
                ]
            }
        },
    )
    broker = toss.TossBroker("test-client", "test-secret", "1")
    result = broker.get_holdings()
    assert result.holdings[0].eval_amount == 710000
    assert result.holdings[1].eval_amount is None
    assert result.holdings[1].quantity == Decimal("1.5")
    assert result.cash_krw is None
    assert holdings.calls[0].request.headers["X-Tossinvest-Account"] == "1"
    assert "application/x-www-form-urlencoded" in token.calls[0].request.headers["content-type"]
    assert b"grant_type=client_credentials" in token.calls[0].request.content
    broker.get_token()
    assert token.call_count == 1
    with pytest.raises(BrokerError) as exc:
        broker.list_conditions()
    assert exc.value.as_app_error().status_code == 501


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_market_data_and_candle_pagination(respx_mock):
    respx_mock.post("https://openapi.tossinvest.com/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    respx_mock.get("https://openapi.tossinvest.com/api/v1/stocks/all").respond(
        200, json={"result": [{"symbol": "005930", "name": "삼성전자"}]}
    )
    respx_mock.get("https://openapi.tossinvest.com/api/v1/prices").respond(
        200,
        json={
            "result": [
                {"symbol": "005930", "lastPrice": "72000", "timestamp": "2026-10-16T09:30:00+09:00"}
            ]
        },
    )
    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/candles").mock(
        side_effect=[
            httpx.Response(
                200,
                json={
                    "result": {
                        "candles": [
                            {
                                "timestamp": "2026-10-16T00:00:00+09:00",
                                "openPrice": "70000",
                                "highPrice": "73000",
                                "lowPrice": "69000",
                                "closePrice": "72000",
                                "volume": "100",
                            }
                        ],
                        "nextBefore": "2026-10-15T00:00:00+09:00",
                    }
                },
            ),
            httpx.Response(
                200,
                json={
                    "result": {
                        "candles": [
                            {
                                "timestamp": "2026-10-15T00:00:00+09:00",
                                "openPrice": "70000",
                                "highPrice": "73000",
                                "lowPrice": "69000",
                                "closePrice": "72000",
                                "volume": "100",
                            }
                        ],
                        "nextBefore": None,
                    }
                },
            ),
        ]
    )
    broker = toss.TossBroker("test-client", "test-secret")
    assert broker.list_stocks("KOSPI")[0].market == "KOSPI"
    f = broker.get_fundamentals("005930")
    assert f.price == 72000 and f.per is None and f.roe is None
    assert len(broker.get_daily_candles("005930", date(2026, 10, 1), date(2026, 10, 16))) == 2
    assert route.call_count == 2
    assert route.calls[1].request.url.params["before"] == "2026-10-15T00:00:00+09:00"


@pytest.mark.parametrize(
    ("status", "code"),
    [(401, "BROKER_AUTH_FAILED"), (403, "BROKER_IP_NOT_ALLOWED"), (500, "BROKER_UNAVAILABLE")],
)
@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_errors(respx_mock, status, code):
    respx_mock.post("https://openapi.tossinvest.com/oauth2/token").respond(status, json={})
    with pytest.raises(BrokerError) as exc:
        toss.TossBroker("test-client", "test-secret").get_token()
    assert exc.value.code == code


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_list_accounts_without_account_header_and_last4(respx_mock):
    respx_mock.post("https://openapi.tossinvest.com/oauth2/token").respond(
        200, json={"access_token": "test-token", "expires_in": 86400}
    )
    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/accounts").respond(
        200,
        json={
            "result": [
                {"accountNo": "12345678901", "accountSeq": 1, "accountType": "BROKERAGE"},
                {"accountNo": "98765432109", "accountSeq": 2, "accountType": "PENSION_SAVINGS"},
            ]
        },
    )
    accounts = toss.TossBroker("test-client", "test-secret").list_accounts()
    assert accounts == [
        toss.TossAccount("1", "BROKERAGE", "8901"),
        toss.TossAccount("2", "PENSION_SAVINGS", "2109"),
    ]
    assert "12345678901" not in repr(accounts)
    request = route.calls[0].request
    assert "X-Tossinvest-Account" not in request.headers
    assert request.headers["Authorization"] == "Bearer test-token"


def toss_token_sequence(respx_mock):
    """발급할 때마다 새 토큰을 주는 토큰 경로. 토스처럼 마지막 토큰만 유효하다고 본다."""
    issued = []

    def issue(request):
        issued.append(f"test-token-{len(issued) + 1}")
        return httpx.Response(200, json={"access_token": issued[-1], "expires_in": 86400})

    route = respx_mock.post("https://openapi.tossinvest.com/oauth2/token").mock(side_effect=issue)
    return route, issued


REVOKED = {"error": {"code": "token-revoked", "message": "새로 발급된 토큰으로 대체되었습니다."}}


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_cached_token_revoked_reissues_once(respx_mock):
    token, issued = toss_token_sequence(respx_mock)

    def holdings(request):
        if request.headers["Authorization"] != f"Bearer {issued[-1]}":
            return httpx.Response(401, json=REVOKED)
        return httpx.Response(200, json={"result": {"items": []}})

    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/holdings").mock(
        side_effect=holdings
    )
    broker = toss.TossBroker("test-client", "test-secret", "1")
    assert broker.get_holdings().holdings == []
    # 같은 키로 다른 클라이언트가 토큰을 받아 캐시 토큰이 무효가 된다.
    toss.TossBroker("test-client", "test-secret").get_token()
    assert broker.token == "test-token-1" and issued[-1] == "test-token-2"
    assert broker.get_holdings().holdings == []
    assert token.call_count == 3 and route.call_count == 3
    sent = [call.request.headers["Authorization"] for call in route.calls]
    assert sent == ["Bearer test-token-1", "Bearer test-token-1", "Bearer test-token-3"]
    assert all(call.request.headers["X-Tossinvest-Account"] == "1" for call in route.calls)
    assert broker.token == "test-token-3"
    # 새 토큰은 다시 캐시해 쓴다.
    broker.get_holdings()
    assert token.call_count == 3 and route.call_count == 4


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_reissued_token_still_401_fails_after_one_retry(respx_mock):
    token, _ = toss_token_sequence(respx_mock)
    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/holdings").respond(
        401, json=REVOKED
    )
    broker = toss.TossBroker("test-client", "test-secret", "1")
    broker.get_token()
    with pytest.raises(BrokerError) as exc:
        broker.get_holdings()
    assert exc.value.code == "BROKER_AUTH_FAILED"
    assert token.call_count == 2 and route.call_count == 2


@respx.mock(assert_all_mocked=True, using="httpx")
def test_toss_fresh_token_401_is_not_retried(respx_mock):
    token, _ = toss_token_sequence(respx_mock)
    route = respx_mock.get("https://openapi.tossinvest.com/api/v1/accounts").respond(
        401, json=REVOKED
    )
    with pytest.raises(BrokerError) as exc:
        toss.TossBroker("test-client", "test-secret").list_accounts()
    assert exc.value.code == "BROKER_AUTH_FAILED"
    assert token.call_count == 1 and route.call_count == 1


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_executions_dates_side_and_cost_defaults(respx_mock, monkeypatch):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)
    requests = []

    def response(request):
        assert request.headers["api-id"] == "kt00009"
        body = json.loads(request.content)
        requests.append(body)
        rows = []
        if body["ord_dt"] == "20261016":
            rows = [
                {
                    "ord_no": "0000001",
                    "cntr_no": body["sell_tp"],
                    "stk_cd": "A005930",
                    "stk_nm": "삼성전자",
                    "cntr_qty": "0000000002",
                    "cntr_uv": "-0000071000",
                    "cntr_tm": "13:07:47",
                }
            ]
        return httpx.Response(200, json={"return_code": 0, "acnt_ord_cntr_prst_array": rows})

    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").mock(side_effect=response)
    broker = kiwoom.KiwoomBroker("test-app", "test-secret")
    assert "EXECUTIONS" in broker.capabilities
    rows = broker.get_executions(date(2026, 10, 15), date(2026, 10, 16))
    assert len(rows) == 2 and len(requests) == 4
    assert {row.side for row in rows} == {"buy", "sell"}
    assert len({row.external_id for row in rows}) == 2
    assert all(
        row.price == 71000 and row.quantity == 2 and row.fee is None and row.tax is None
        for row in rows
    )
    assert rows[0].executed_at == datetime(2026, 10, 16, 4, 7, 47, tzinfo=UTC)
    assert all(r["qry_tp"] == "1" and r["dmst_stex_tp"] == "KRX" for r in requests)


@pytest.mark.parametrize("return_code", [20, "20"])
@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_executions_all_days_no_data(respx_mock, monkeypatch, return_code):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)
    route = respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").respond(
        200,
        headers={"cont-yn": "Y", "next-key": "unused"},
        json={"return_code": return_code, "return_msg": "[2000](조회:관련자료가없습니다)"},
    )
    broker = kiwoom.KiwoomBroker("test-app", "test-secret")
    assert broker.get_executions(date(2026, 9, 17), date(2026, 10, 16)) == []
    assert route.call_count == 60
    requests = [json.loads(call.request.content) for call in route.calls]
    assert len({body["ord_dt"] for body in requests}) == 30
    assert {body["sell_tp"] for body in requests} == {"1", "2"}
    assert all(call.request.headers["next-key"] == "" for call in route.calls)


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_executions_keep_fills_among_no_data_days(respx_mock, monkeypatch):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)

    def response(request):
        body = json.loads(request.content)
        if (
            body["ord_dt"] == "20261015"
            and body["sell_tp"] == "2"
            and not request.headers["next-key"]
        ):
            return httpx.Response(
                200,
                headers={"cont-yn": "Y", "next-key": "after-fill"},
                json={
                    "return_code": 0,
                    "acnt_ord_cntr_prst_array": [
                        {
                            "ord_no": "1",
                            "cntr_no": "2",
                            "stk_cd": "A005930",
                            "stk_nm": "삼성전자",
                            "cntr_qty": "2",
                            "cntr_uv": "71000",
                            "cntr_tm": "13:07:47",
                        }
                    ],
                },
            )
        return httpx.Response(
            200,
            headers={"cont-yn": "Y", "next-key": "unused"},
            json={"return_code": 20, "return_msg": "[2000](조회:관련자료가없습니다)"},
        )

    route = respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").mock(side_effect=response)
    rows = kiwoom.KiwoomBroker("test-app", "test-secret").get_executions(
        date(2026, 10, 14), date(2026, 10, 16)
    )
    assert len(rows) == 1
    assert rows[0].external_id == "20261015:1:2" and rows[0].side == "buy"
    assert rows[0].price == 71000 and rows[0].quantity == 2
    assert route.call_count == 7
    assert sum(call.request.headers["next-key"] == "after-fill" for call in route.calls) == 1


@pytest.mark.parametrize(
    ("status", "return_code", "message"),
    [
        (200, 20, "[2000](조회:처리할 수 없습니다)"),
        (200, 21, "[2000](조회:관련자료가없습니다)"),
        (500, 20, "[2000](조회:관련자료가없습니다)"),
    ],
)
@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_executions_other_errors_still_fail(
    respx_mock, monkeypatch, status, return_code, message
):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)
    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").respond(
        status, json={"return_code": return_code, "return_msg": message}
    )
    with pytest.raises(BrokerError) as exc:
        kiwoom.KiwoomBroker("test-app", "test-secret").get_executions(
            date(2026, 10, 16), date(2026, 10, 16)
        )
    assert exc.value.code == "BROKER_UNAVAILABLE"


@respx.mock(assert_all_mocked=True, using="httpx")
def test_kiwoom_holdings_no_data_still_fails(respx_mock, monkeypatch):
    monkeypatch.setattr(kiwoom, "now_utc", lambda: datetime(2026, 10, 16, tzinfo=UTC))
    kiwoom_token(respx_mock)

    def response(request):
        assert request.headers["api-id"] == "kt00018"
        return httpx.Response(
            200, json={"return_code": 20, "return_msg": "[2000](조회:관련자료가없습니다)"}
        )

    respx_mock.post("https://mockapi.kiwoom.com/api/dostk/acnt").mock(side_effect=response)
    with pytest.raises(BrokerError) as exc:
        kiwoom.KiwoomBroker("test-app", "test-secret").get_holdings()
    assert exc.value.code == "BROKER_UNAVAILABLE"
