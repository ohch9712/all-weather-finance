"""SSE 응답 본문(스펙 09 8.1).

에이전트 루프는 동기 코드(SQLAlchemy 동기 세션, SDK 동기 호출)라 전용 스레드에서 돌리고,
이벤트 루프 쪽은 큐를 기다리며 15초마다 `: ping` 주석을 보낸다.
클라이언트 연결이 끊기면 스레드에 멈춤을 알리고, 스레드는 다음 이벤트 경계에서
루프 제너레이터를 닫는다(진행 중인 라운드는 저장하지 않는다).
요청 DB 세션이 닫히기 전에 스레드가 끝나도록 기다린다.
"""

import asyncio
import json
import logging
import threading
import time
from collections.abc import AsyncIterator, Iterator

import anyio

from app.modules.chat.agent import SseEvent, error_event

logger = logging.getLogger(__name__)

PING_INTERVAL_SECONDS = 15.0
PING = ": ping\n\n"
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
INTERNAL_ERROR_MESSAGE = "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."

_DONE = object()


def format_event(event: SseEvent) -> str:
    return f"event: {event.event}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


async def sse_body(events: Iterator[SseEvent], *, on_error=None) -> AsyncIterator[str]:
    """`events`를 스레드에서 돌려 SSE 문자열로 내보낸다. `on_error`는 예외 뒤 정리(롤백)용이다."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()

    def put(item) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, item)
        except RuntimeError:
            pass  # 이벤트 루프가 이미 닫혔다(응답이 끝났다).

    def produce() -> None:
        try:
            for event in events:
                if stop.is_set():
                    break
                put(event)
        except Exception:
            logger.exception("챗봇 응답 처리 중 오류")
            if on_error is not None:
                on_error()
            put(error_event("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE))
        finally:
            close = getattr(events, "close", None)
            if close is not None:
                try:
                    close()  # 진행 중인 라운드를 버린다.
                except Exception:
                    logger.exception("챗봇 응답 정리 중 오류")
            put(_DONE)

    worker = threading.Thread(target=produce, name="chat-turn", daemon=True)
    worker.start()
    next_ping = time.monotonic() + PING_INTERVAL_SECONDS
    try:
        while True:
            try:
                item = await asyncio.wait_for(
                    queue.get(), timeout=max(0.0, next_ping - time.monotonic())
                )
            except TimeoutError:
                next_ping += PING_INTERVAL_SECONDS
                yield PING
                continue
            if item is _DONE:
                break
            yield format_event(item)
    finally:
        stop.set()
        with anyio.CancelScope(shield=True):
            await anyio.to_thread.run_sync(worker.join)
