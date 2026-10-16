"""공식 스펙: https://github.com/Kiwoom-Securities/Kiwoom-REST-API
kiwoom/_data/kiwoom_api_spec.json (au10001, ka10099, ka10001, ka10081,
kt00018, ka10171, ka10172와 error_codes), kiwoom/core/ws_client.py.
"""

import json
import re
import threading
from datetime import date, datetime, timedelta

import httpx
from websockets.exceptions import WebSocketException
from websockets.sync.client import connect

from app.core.time import KST, now_utc
from app.integrations.brokers.base import (
    BrokerHolding,
    Candle,
    ConditionInfo,
    Fundamentals,
    HoldingsSnapshot,
    Market,
    Quote,
    StockInfo,
)
from app.integrations.brokers.errors import BrokerError, UnsupportedBroker
from app.integrations.brokers.parsing import decimal_value as dec
from app.integrations.brokers.parsing import integer_value as integer
from app.integrations.brokers.parsing import parsed_response
from app.integrations.brokers.ratelimit import TokenBucket, request_with_retry

# 작업 계약의 보수적인 초당 4회. 클라이언트가 달라도 같은 프로세스의 호출을 제한한다.
BUCKET = TokenBucket(4)


def check_result(data):
    code = str(data.get("return_code", 0))
    if code == "0":
        return
    embedded = re.search(r"(?:\[|CODE=)(\d{4})", str(data.get("return_msg", "")))
    if embedded:
        code = embedded.group(1)
    if code == "8010":
        raise BrokerError("BROKER_IP_NOT_ALLOWED")
    if code in {"1700", "1701", "1702"}:
        raise BrokerError("BROKER_RATE_LIMITED")
    if code in {"8104", "8200"}:
        raise BrokerError("BROKER_NOT_SUPPORTED")
    if code.startswith("8") or code in {"1513", "1514", "1515", "1516"}:
        raise BrokerError("BROKER_AUTH_FAILED")
    raise BrokerError("BROKER_UNAVAILABLE")


def krx_code(value):
    value = str(value)
    return value[1:] if len(value) == 7 and value[0] in "AJQ" else value


class KiwoomBroker(UnsupportedBroker):
    provider = "kiwoom"
    capabilities = frozenset(
        {"STOCK_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS", "CONDITIONS"}
    )

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        environment="mock",
        account_no=None,
        *,
        client=None,
        websocket_url=None,
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_no = account_no
        self.base_url = (
            "https://api.kiwoom.com" if environment == "real" else "https://mockapi.kiwoom.com"
        )
        self.websocket_url = (
            websocket_url
            or self.base_url.replace("https://", "wss://") + ":10000/api/dostk/websocket"
        )
        self.client = client or httpx.Client(timeout=10)
        self.token = None
        self.expires_at = now_utc()
        self.token_lock = threading.Lock()

    @parsed_response
    def get_token(self):
        # au10001: expires_dt는 한국 시각 YYYYMMDDHHMMSS다.
        with self.token_lock:
            if self.token and self.expires_at - timedelta(minutes=5) > now_utc():
                return self.token
            response = request_with_retry(
                self.client,
                "POST",
                self.base_url + "/oauth2/token",
                BUCKET,
                headers={"api-id": "au10001"},
                json={
                    "grant_type": "client_credentials",
                    "appkey": self.app_key,
                    "secretkey": self.app_secret,
                },
            )
            data = self._read(response)
            self.token = data["token"]
            self.expires_at = datetime.strptime(data["expires_dt"], "%Y%m%d%H%M%S").replace(
                tzinfo=KST
            )
            return self.token

    def _read(self, response):
        if response.status_code == 401:
            raise BrokerError("BROKER_AUTH_FAILED")
        if response.status_code == 403:
            raise BrokerError("BROKER_IP_NOT_ALLOWED")
        if response.is_error:
            raise BrokerError("BROKER_UNAVAILABLE")
        data = response.json()
        check_result(data)
        return data

    @parsed_response
    def _pages(self, api_id, path, body, array_key):
        token = self.get_token()
        next_key = ""
        seen = set()
        while True:
            response = request_with_retry(
                self.client,
                "POST",
                self.base_url + path,
                BUCKET,
                headers={
                    "api-id": api_id,
                    "authorization": f"Bearer {token}",
                    "cont-yn": "Y" if next_key else "N",
                    "next-key": next_key,
                },
                json=body,
            )
            data = self._read(response)
            yield data if array_key is None else data.get(array_key, [])
            if response.headers.get("cont-yn") != "Y":
                break
            next_key = response.headers.get("next-key", "")
            if not next_key or next_key in seen:
                raise BrokerError("BROKER_UNAVAILABLE")
            seen.add(next_key)

    @parsed_response
    def list_stocks(self, market: Market):
        # ka10099: list.code/name/upName, 시장 0=KOSPI, 10=KOSDAQ, 50=KONEX.
        markets = {"KOSPI": "0", "KOSDAQ": "10", "KONEX": "50"}
        if market not in markets:
            raise BrokerError("BROKER_NOT_SUPPORTED")
        return [
            StockInfo(r["code"], r["name"], market, r.get("upName") or None)
            for page in self._pages(
                "ka10099", "/api/dostk/stkinfo", {"mrkt_tp": markets[market]}, "list"
            )
            for r in page
            if "_" not in r["code"]
        ]

    def _basic(self, code):
        return next(self._pages("ka10001", "/api/dostk/stkinfo", {"stk_cd": code}, None))

    @parsed_response
    def get_fundamentals(self, code):
        # ka10001: mac 단위 억원, 250hgst/250lwst 단위 원. 거래대금은 제공하지 않는다.
        r = self._basic(code)
        return Fundamentals(
            code,
            dec(r["cur_prc"], absolute=True),
            dec(r.get("flu_rt")),
            integer(r.get("trde_qty")),
            None,
            integer(r.get("mac"), scale=100000000),
            dec(r.get("per")),
            dec(r.get("pbr")),
            dec(r.get("roe")),
            dec(r.get("eps")),
            dec(r.get("bps")),
            dec(r.get("for_exh_rt")),
            dec(r.get("250hgst"), absolute=True),
            dec(r.get("250lwst"), absolute=True),
        )

    @parsed_response
    def get_quotes(self, codes):
        result = []
        for code in codes:
            r = self._basic(code)
            result.append(
                Quote(
                    code,
                    dec(r["cur_prc"], absolute=True),
                    dec(r.get("pred_pre")),
                    dec(r.get("flu_rt")),
                    integer(r.get("trde_qty")),
                    now_utc(),
                )
            )
        return result

    @parsed_response
    def get_daily_candles(self, code, start: date, end: date):
        # ka10081: stk_dt_pole_chart_qry, 수정주가 1, KRX 접미사 없는 코드만 사용한다.
        candles = {}
        for page in self._pages(
            "ka10081",
            "/api/dostk/chart",
            {"stk_cd": code, "base_dt": end.strftime("%Y%m%d"), "upd_stkpc_tp": "1"},
            "stk_dt_pole_chart_qry",
        ):
            for r in page:
                day = datetime.strptime(r["dt"], "%Y%m%d").date()
                if start <= day <= end:
                    candles[day] = Candle(
                        day,
                        dec(r["open_pric"], absolute=True),
                        dec(r["high_pric"], absolute=True),
                        dec(r["low_pric"], absolute=True),
                        dec(r["cur_prc"], absolute=True),
                        integer(r["trde_qty"]),
                    )
            if page and min(r["dt"] for r in page) <= start.strftime("%Y%m%d"):
                break
        return sorted(candles.values(), key=lambda c: c.day)

    @parsed_response
    def get_holdings(self):
        # kt00018: 토큰에 연결된 계좌의 국내 잔고. 예수금 필드가 없으므로 cash_krw=None.
        result = []
        for page in self._pages(
            "kt00018",
            "/api/dostk/acnt",
            {"qry_tp": "1", "dmst_stex_tp": "KRX"},
            "acnt_evlt_remn_indv_tot",
        ):
            for r in page:
                result.append(
                    BrokerHolding(
                        krx_code(r["stk_cd"]),
                        r["stk_nm"],
                        "OTHER",
                        dec(r["rmnd_qty"]),
                        dec(r.get("pur_pric")),
                        integer(r["evlt_amt"]),
                        "KRW",
                    )
                )
        return HoldingsSnapshot(result, None, now_utc())

    # ka10076은 주문시간·누적 체결량만 제공해 안정적인 개별 체결 ID/시각을 만들 수 없다.
    # 검증하지 않은 체결 내역은 상속한 BROKER_NOT_SUPPORTED로 유지한다.

    def _receive(self, ws, trnm):
        while True:
            data = json.loads(ws.recv(timeout=10))
            if data.get("trnm") == "PING":
                ws.send(json.dumps(data))
                continue
            check_result(data)
            if data.get("trnm") == trnm:
                return data

    @parsed_response
    def _condition(self, seq=None):
        # ka10171/ka10172: LOGIN → CNSRLST → CNSRREQ(단발 0, KRX K), PING 그대로 응답.
        try:
            BUCKET.acquire()
            with connect(self.websocket_url, open_timeout=10, close_timeout=2, proxy=None) as ws:
                ws.send(json.dumps({"trnm": "LOGIN", "token": self.get_token()}))
                self._receive(ws, "LOGIN")
                ws.send(json.dumps({"trnm": "CNSRLST"}))
                listing = self._receive(ws, "CNSRLST")
                if seq is None:
                    return [
                        ConditionInfo(str(r[0]), r[1])
                        if isinstance(r, list)
                        else ConditionInfo(str(r["seq"]), r["name"])
                        for r in listing.get("data", [])
                    ]
                codes = []
                payload = {
                    "trnm": "CNSRREQ",
                    "seq": seq,
                    "search_type": "0",
                    "stex_tp": "K",
                    "cont_yn": "N",
                    "next_key": "",
                }
                seen = set()
                while True:
                    BUCKET.acquire()
                    ws.send(json.dumps(payload))
                    data = self._receive(ws, "CNSRREQ")
                    codes.extend(krx_code(r["9001"]) for r in data.get("data", []))
                    if data.get("cont_yn") != "Y":
                        return list(dict.fromkeys(codes))
                    key = data.get("next_key", "")
                    if not key or key in seen:
                        raise BrokerError("BROKER_UNAVAILABLE")
                    seen.add(key)
                    payload.update(cont_yn="Y", next_key=key)
        except (OSError, TimeoutError, WebSocketException):
            raise BrokerError("BROKER_UNAVAILABLE") from None

    def list_conditions(self):
        return self._condition()

    def run_condition(self, seq):
        return self._condition(seq)
