"""부모님 건강 상태(민감정보)가 접근 로그에 남지 않게 한다(스펙 22 7절)."""

import logging
import re

# GET /api/succession/life-expectancy?...&health=normal 의 health 값을 가린다.
HEALTH_QUERY = re.compile(r"(/api/succession/life-expectancy\?[^\s]*?\bhealth=)[^&\s]*")


class HealthQueryFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                HEALTH_QUERY.sub(r"\1***", arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        if isinstance(record.msg, str):
            record.msg = HEALTH_QUERY.sub(r"\1***", record.msg)
        return True


def install_access_log_filter() -> None:
    """uvicorn 접근 로그 로거에 한 번만 붙인다."""
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, HealthQueryFilter) for item in access.filters):
        access.addFilter(HealthQueryFilter())
