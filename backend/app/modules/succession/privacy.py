"""부모님 건강 상태(민감정보)가 접근 로그에 남지 않게 한다(스펙 22 7절).

디코딩한 경로가 /api/succession/로 시작하는 요청은 '?' 뒤 쿼리 문자열 전체를 ***로 바꿔 기록한다.
키 중복(health=a&health=b), URL 인코딩된 키(%68ealth), 대소문자, ';' 구분처럼 서버가 어떻게
해석하든 쿼리 내용 자체를 남기지 않는다. 다른 경로의 접근 로그는 그대로 둔다.
"""

import logging
import re
from urllib.parse import unquote

PREFIX = "/api/succession/"
MASK = "***"
# 메시지 문자열 안의 '경로?쿼리' 토큰. 경로는 '/'(인코딩하면 %2F)로 시작하고,
# 쿼리는 다음 공백 전까지 본다.
PATH_QUERY = re.compile(r"(?P<path>[/%][^\s\"'?]*)\?\S*")


def _is_succession(path: str) -> bool:
    return unquote(path).startswith(PREFIX)


def _mask_token(match: re.Match[str]) -> str:
    path = match["path"]
    return f"{path}?{MASK}" if _is_succession(path) else match[0]


def mask_query(text: str) -> str:
    """접근 로그 인자의 full_path(경로?쿼리)나 메시지 문자열에서 이 모듈 경로의 쿼리를 가린다."""
    path, separator, _ = text.partition("?")
    if separator and _is_succession(path):
        return f"{path}?{MASK}"
    return PATH_QUERY.sub(_mask_token, text)


class HealthQueryFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # uvicorn 접근 포매터는 인자 5개
        # (client_addr, method, full_path, http_version, status_code)를 그대로 풀어 쓰므로
        # 인자 단위로 가리고 개수를 유지한다.
        if isinstance(record.args, tuple):
            record.args = tuple(
                mask_query(arg) if isinstance(arg, str) else arg for arg in record.args
            )
        # 메시지 틀(record.msg)에 경로·쿼리가 들어 있는 기록은 서식을 적용한 최종 문자열에서 가린다.
        try:
            message = record.getMessage()
        except (TypeError, ValueError):
            message = str(record.msg)
        masked = mask_query(message)
        if masked != message:
            record.msg, record.args = masked, ()
        return True


def install_access_log_filter() -> None:
    """uvicorn 접근 로그 로거에 한 번만 붙인다."""
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, HealthQueryFilter) for item in access.filters):
        access.addFilter(HealthQueryFilter())
