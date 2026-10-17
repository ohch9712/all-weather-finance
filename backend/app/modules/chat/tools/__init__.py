"""도구 모듈을 import해 레지스트리에 등록한다.

09 기본 도구 2개와 15의 모듈 데이터 도구 16개다. 도구 목록은 이름순으로 고정된다(registry).
"""

from app.modules.chat.tools import (  # noqa: F401
    allocation,
    basic,
    estate,
    journal,
    learn,
    ledger,
    market,
    screener,
    watchlist,
)
