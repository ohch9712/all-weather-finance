"""공식 OpenAPI 1.2.24: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
issueOAuth2Token, getAccounts, listStocks, getStocks, getPrices, getCandles, getHoldings.
확인되지 않은 재무지표·개별 체결은 추측하지 않는다.
"""

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta

import httpx

from app.core.time import KST, now_utc
from app.integrations.brokers.base import (
    BrokerHolding,
    Candle,
    Fundamentals,
    HoldingsSnapshot,
    Quote,
    StockInfo,
)
from app.integrations.brokers.errors import BrokerError, UnsupportedBroker
from app.integrations.brokers.parsing import decimal_value as dec
from app.integrations.brokers.parsing import integer_value as integer
from app.integrations.brokers.parsing import parsed_response
from app.integrations.brokers.ratelimit import TokenBucket, request_with_retry

# OpenAPI 1.2.24는 그룹명만 명시한다. 명시적 한도가 없는 그룹은 작업 계약의
# 시세 15회·계좌 1회로 제한하며, AUTH/CHART는 5/20회를 사용한다.
BUCKETS = {
    name: TokenBucket(rate)
    for name, rate in {
        "AUTH": 5,
        "MARKET_DATA": 15,
        "MARKET_DATA_CHART": 20,
        "STOCK": 15,
        "STOCK_ALL": 15,
        "ASSET": 1,
        "ACCOUNT": 1,
    }.items()
}


@dataclass(frozen=True)
class TossAccount:
    # 계좌번호 원문은 어댑터 밖으로 내보내지 않고 끝 4자리만 둔다.
    seq: str
    account_type: str
    account_no_last4: str


class TossBroker(UnsupportedBroker):
    provider = "toss"
    capabilities = frozenset(
        {"STOCK_LIST", "ETF_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS"}
    )
    base_url = "https://openapi.tossinvest.com"

    def __init__(self, app_key, app_secret, account_no=None, *, client=None):
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_no = account_no
        self.client = client or httpx.Client(timeout=10)
        self.token = None
        self.expires_at = now_utc()
        self.token_lock = threading.Lock()

    def _read(self, response):
        if response.status_code == 401:
            raise BrokerError("BROKER_AUTH_FAILED")
        if response.status_code == 403:
            raise BrokerError("BROKER_IP_NOT_ALLOWED")
        if response.is_error:
            raise BrokerError("BROKER_UNAVAILABLE")
        data = response.json()
        if data.get("error"):
            raise BrokerError("BROKER_UNAVAILABLE")
        return data

    @parsed_response
    def get_token(self):
        return self._token()[0]

    def _token(self):
        """(토큰, 캐시에서 꺼냈는지)를 돌려준다."""
        # OAuth2: form-urlencoded, expires_in(초), 동일 client 재발급 시 이전 토큰 무효화.
        with self.token_lock:
            if self.token and self.expires_at - timedelta(minutes=5) > now_utc():
                return self.token, True
            response = request_with_retry(
                self.client,
                "POST",
                self.base_url + "/oauth2/token",
                BUCKETS["AUTH"],
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.app_key,
                    "client_secret": self.app_secret,
                },
            )
            data = self._read(response)
            self.token = data["access_token"]
            self.expires_at = now_utc() + timedelta(seconds=int(data["expires_in"]))
            return self.token, False

    def _discard_token(self, token):
        # 다른 스레드가 이미 새 토큰을 받았으면 그 토큰은 버리지 않는다.
        with self.token_lock:
            if self.token == token:
                self.token = None

    @parsed_response
    def _get(self, path, group, params=None, *, account=False):
        headers = {}
        if account:
            if not self.account_no:
                raise BrokerError("BROKER_AUTH_FAILED")
            # AccountSeq: 계좌번호 원문이 아니라 /accounts의 accountSeq 값이다.
            headers["X-Tossinvest-Account"] = self.account_no

        def send(token):
            return request_with_retry(
                self.client,
                "GET",
                self.base_url + path,
                BUCKETS[group],
                headers={**headers, "Authorization": f"Bearer {token}"},
                params=params,
            )

        token, cached = self._token()
        response = send(token)
        if response.status_code == 401 and cached:
            # client당 유효 토큰은 1개이고 재발급하면 이전 토큰은 즉시 무효가 된다
            # (issueOAuth2Token 설명, Unauthorized 예시 token-revoked). 같은 키로 다른
            # 클라이언트가 토큰을 받았을 수 있으므로 한 번만 새로 받아 같은 요청을 다시 보낸다.
            # 새 토큰으로도 401이면 _read가 BROKER_AUTH_FAILED로 바꾼다.
            self._discard_token(token)
            token, _ = self._token()
            response = send(token)
        return self._read(response)["result"]

    @parsed_response
    def list_accounts(self):
        # getAccounts(GET /api/v1/accounts): 계좌 헤더 없이 토큰만 보낸다. 한도 그룹 ACCOUNT.
        # result[]의 accountNo(문자열)·accountSeq(int64)·accountType. 지금은 BROKERAGE만 오지만
        # 명세가 알 수 없는 enum 값을 허용하라고 하므로 accountType은 그대로 둔다.
        return [
            TossAccount(
                str(int(r["accountSeq"])),
                str(r["accountType"]),
                str(r["accountNo"]).replace("-", "")[-4:],
            )
            for r in self._get("/api/v1/accounts", "ACCOUNT")
        ]

    @parsed_response
    def list_stocks(self, market):
        if market not in {"KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "AMEX"}:
            raise BrokerError("BROKER_NOT_SUPPORTED")
        return [
            StockInfo(r["symbol"], r["name"], market, None)
            for r in self._get(
                "/api/v1/stocks/all", "STOCK_ALL", {"market": market, "securityType": "STOCK"}
            )
        ]

    @parsed_response
    def list_etfs(self):
        # OpenAPI 1.2.24 listStocks: securityType=ETF, ListedStock.symbol/name을 읽는다.
        # https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
        return [
            StockInfo(r["symbol"], r["name"], market, None, "etf")
            for market in ("KOSPI", "KOSDAQ")
            for r in self._get(
                "/api/v1/stocks/all", "STOCK_ALL", {"market": market, "securityType": "ETF"}
            )
        ]

    @parsed_response
    def get_quotes(self, codes):
        # PriceResponse는 lastPrice/timestamp만 제공한다. 등락·거래량은 None.
        return [
            Quote(
                r["symbol"],
                dec(r["lastPrice"]),
                None,
                None,
                None,
                datetime.fromisoformat(r["timestamp"]),
            )
            for r in self._get("/api/v1/prices", "MARKET_DATA", {"symbols": ",".join(codes)})
        ]

    @parsed_response
    def get_fundamentals(self, code):
        # PER/PBR/ROE/52주 가격 등은 공식 응답에 없으므로 None.
        quotes = self.get_quotes([code])
        if not quotes:
            raise BrokerError("BROKER_UNAVAILABLE")
        return Fundamentals(
            code,
            quotes[0].price,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )

    @parsed_response
    def get_daily_candles(self, code, start, end):
        # getCandles: before inclusive, nextBefore를 그대로 전달하고 날짜 중복을 제거한다.
        before = datetime.combine(end, datetime.max.time(), tzinfo=KST).isoformat()
        candles = {}
        seen = set()
        while True:
            result = self._get(
                "/api/v1/candles",
                "MARKET_DATA_CHART",
                {"symbol": code, "interval": "1d", "count": 200, "before": before},
            )
            rows = result["candles"]
            for r in rows:
                day = datetime.fromisoformat(r["timestamp"]).astimezone(KST).date()
                if start <= day <= end:
                    candles[day] = Candle(
                        day,
                        dec(r["openPrice"]),
                        dec(r["highPrice"]),
                        dec(r["lowPrice"]),
                        dec(r["closePrice"]),
                        integer(r["volume"]),
                    )
            before = result.get("nextBefore")
            if (
                not before
                or not rows
                or min(datetime.fromisoformat(r["timestamp"]).astimezone(KST).date() for r in rows)
                <= start
            ):
                break
            if before in seen:
                raise BrokerError("BROKER_UNAVAILABLE")
            seen.add(before)
        return sorted(candles.values(), key=lambda c: c.day)

    @parsed_response
    def get_holdings(self):
        # HoldingsOverview: marketValue.amount는 표시 통화 금액이다.
        # USD 보유에는 원화 환산 필드가 없어 eval_amount=None으로 돌려준다.
        rows = self._get("/api/v1/holdings", "ASSET", account=True)["items"]
        return HoldingsSnapshot(
            [
                BrokerHolding(
                    r["symbol"],
                    r["name"],
                    "OTHER",
                    dec(r["quantity"]),
                    dec(r.get("averagePurchasePrice")),
                    integer(r["marketValue"]["amount"]) if r["currency"] == "KRW" else None,
                    r["currency"],
                )
                for r in rows
            ],
            None,
            now_utc(),
        )
