import threading
import time
from collections.abc import Callable
from datetime import datetime
from email.utils import parsedate_to_datetime

import httpx

from app.core.time import KST, now_utc
from app.integrations.brokers.errors import BrokerError


class TokenBucket:
    def __init__(
        self, rate: float, *, clock: Callable = time.monotonic, sleep: Callable = time.sleep
    ):
        self.rate = rate
        self.tokens = 1.0
        self.clock = clock
        self.sleep = sleep
        self.updated = clock()
        self.lock = threading.Lock()

    def acquire(self):
        with self.lock:
            while True:
                current = self.clock()
                self.tokens = min(1.0, self.tokens + (current - self.updated) * self.rate)
                self.updated = current
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                self.sleep((1 - self.tokens) / self.rate)


TOSS_RATES = {"AUTH": 5, "MARKET_DATA": 15, "MARKET_DATA_CHART": 20, "ACCOUNT": 1, "ORDER_INFO": 6}


def group_rate(group: str, at: datetime | None = None) -> int:
    local = (at or now_utc()).astimezone(KST)
    if group == "ORDER_INFO" and local.hour == 9 and local.minute < 10:
        return 3
    return TOSS_RATES[group]


def request_with_retry(
    client: httpx.Client,
    method: str,
    url: str,
    bucket: TokenBucket,
    *,
    sleep: Callable = time.sleep,
    **kwargs,
) -> httpx.Response:
    try:
        for attempt in range(4):
            bucket.acquire()
            response = client.request(method, url, **kwargs)
            if response.status_code != 429:
                return response
            if attempt == 3:
                break
            header = response.headers.get("Retry-After", "0")
            try:
                delay = float(header)
            except ValueError:
                try:
                    delay = (parsedate_to_datetime(header) - now_utc()).total_seconds()
                except (ValueError, TypeError):
                    delay = 0
            sleep(max(2**attempt, delay))
    except httpx.HTTPError:
        raise BrokerError("BROKER_UNAVAILABLE") from None
    raise BrokerError("BROKER_RATE_LIMITED")
