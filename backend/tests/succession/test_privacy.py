"""스펙 22 7절: 부모님 건강 상태가 접근 로그·422 응답·예외 로그에 남지 않는다."""

import logging
import traceback

import pytest
from fastapi.testclient import TestClient
from uvicorn.config import LOGGING_CONFIG
from uvicorn.logging import AccessFormatter

from app.modules.succession import service
from app.modules.succession.privacy import HealthQueryFilter, install_access_log_filter
from tests.succession.cases import CASE_A, case

BASE = "/api/succession"
CLIENT = "127.0.0.1:5000"
# uvicorn httptools·h11 프로토콜이 접근 로그에 넘기는 메시지 틀(인자 5개)
ACCESS_MSG = '%s - "%s %s HTTP/%s" %d'
HEALTH_VALUES = ("good", "normal", "poor", "care")
MARKER = "zz-health-marker"
POOR_QUERY = {"role": "father", "age": 75, "health": "poor"}


def access_record(full_path: str) -> logging.LogRecord:
    args = (CLIENT, "GET", full_path, "1.1", 200)
    return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, ACCESS_MSG, args, None)


def uvicorn_line(record: logging.LogRecord) -> str:
    fmt = LOGGING_CONFIG["formatters"]["access"]["fmt"]
    return AccessFormatter(fmt, use_colors=False).format(record)


def server_log(caplog) -> str:
    # 테스트 클라이언트(httpx)의 요청 로그는 서버 로그가 아니므로 뺀다.
    formatter = logging.Formatter("%(name)s %(message)s")
    return "\n".join(
        formatter.format(record)
        for record in caplog.records
        if not record.name.startswith(("httpx", "httpcore"))
    )


@pytest.mark.parametrize(
    "full_path",
    [
        f"{BASE}/life-expectancy?role=mother&age=72&health=good",
        # 같은 키를 두 번 보내면 서버는 마지막 값(poor)을 쓴다.
        f"{BASE}/life-expectancy?role=father&age=75&health=normal&health=poor",
        f"{BASE}/life-expectancy?role=father&age=75&%68ealth=care",
        f"{BASE}/life-expectancy?role=father&age=75&health=%63are",
        f"{BASE}/life-expectancy?ROLE=father;Age=75;HeAlTh=poor",
        f"{BASE}/case?health=normal",
        "/api/%73uccession/life-expectancy?health=good",
    ],
)
def test_access_log_masks_whole_succession_query(full_path):
    record = access_record(full_path)
    assert HealthQueryFilter().filter(record)
    path = full_path.partition("?")[0]
    assert record.msg == ACCESS_MSG
    assert record.args == (CLIENT, "GET", f"{path}?***", "1.1", 200)
    line = uvicorn_line(record)
    assert line.endswith(f'{CLIENT} - "GET {path}?*** HTTP/1.1" 200 OK')
    assert not any(value in line for value in HEALTH_VALUES)


@pytest.mark.parametrize(
    "full_path",
    [
        f"{BASE}/life-expectancy",
        f"{BASE}/rules",
        "/api/estate/rules?health=good",
        "/api/successions/rules?health=good",
        f"/api/estate/rules?next={BASE}/life-expectancy?health=good",
    ],
)
def test_access_log_keeps_paths_without_succession_query(full_path):
    record = access_record(full_path)
    assert HealthQueryFilter().filter(record)
    assert (record.msg, record.args) == (ACCESS_MSG, (CLIENT, "GET", full_path, "1.1", 200))
    assert uvicorn_line(record).endswith(f'"GET {full_path} HTTP/1.1" 200 OK')


def test_access_log_masks_message_string():
    def record(msg: str, args: tuple) -> logging.LogRecord:
        return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, msg, args, None)

    query = "role=father&age=75&health=normal&health=poor"
    whole = record(f'{CLIENT} - "GET {BASE}/life-expectancy?{query} HTTP/1.1" 200', ())
    # 쿼리 안에 서식 자리가 있으면 서식을 적용한 최종 문자열에서 가린다.
    template = record(f"GET {BASE}/life-expectancy?%s=%s", ("%68ealth", "care"))
    other = record("GET /api/estate/rules?health=%s", ("good",))
    for item in (whole, template, other):
        assert HealthQueryFilter().filter(item)
    assert whole.getMessage() == f'{CLIENT} - "GET {BASE}/life-expectancy?*** HTTP/1.1" 200'
    assert (template.getMessage(), template.args) == (f"GET {BASE}/life-expectancy?***", ())
    assert (other.getMessage(), other.args) == ("GET /api/estate/rules?health=good", ("good",))


def test_filter_installed_once_on_uvicorn_access_logger(caplog):
    install_access_log_filter()
    install_access_log_filter()
    access = logging.getLogger("uvicorn.access")
    assert sum(isinstance(item, HealthQueryFilter) for item in access.filters) == 1
    query = "role=father&age=75&%68ealth=care"
    with caplog.at_level(logging.INFO, logger="uvicorn.access"):
        access.info(ACCESS_MSG, CLIENT, "GET", f"{BASE}/life-expectancy?{query}", "1.1", 200)
        access.info(ACCESS_MSG, CLIENT, "GET", "/api/estate/rules?x=good", "1.1", 200)
    messages = [record.getMessage() for record in caplog.records]
    assert messages == [
        f'{CLIENT} - "GET {BASE}/life-expectancy?*** HTTP/1.1" 200',
        f'{CLIENT} - "GET /api/estate/rules?x=good HTTP/1.1" 200',
    ]


def test_invalid_health_422_keeps_value_out_of_response_and_logs(auth_client, caplog):
    caplog.set_level(logging.DEBUG)
    parents = [dict(CASE_A["parents"][0], health=MARKER), CASE_A["parents"][1]]
    bad = case(CASE_A, parents=parents)
    responses = [
        auth_client.get(f"{BASE}/life-expectancy?role=father&age=75&health={MARKER}"),
        auth_client.get(f"{BASE}/life-expectancy?role=father&age=75&health=poor&health={MARKER}"),
        auth_client.post(f"{BASE}/plans", json=bad),
        auth_client.put(f"{BASE}/case", json={"case": bad, "sensitiveConsent": True}),
    ]
    for response in responses:
        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"] == [
            {"field": "health", "message": "형식이 올바르지 않습니다."}
        ]
        assert MARKER not in response.text
    assert MARKER not in server_log(caplog)


def test_unexpected_error_logs_have_no_health(app, auth_client, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)

    def fail(*args):
        raise RuntimeError("계산 중 예기치 못한 오류")

    monkeypatch.setattr(service, "calculate_plans", fail)
    monkeypatch.setattr("app.modules.succession.router.life_expectancy", fail)
    # 테스트 쪽 소스 줄도 트레이스백에 찍히므로 값은 상수로 넘긴다.
    requests = [
        lambda client: client.post(f"{BASE}/plans", json=CASE_A),
        lambda client: client.get(f"{BASE}/life-expectancy", params=POOR_QUERY),
    ]
    raising = TestClient(app, cookies=auth_client.cookies)
    for send in requests:
        assert send(auth_client).json()["error"]["code"] == "INTERNAL_ERROR"
        # Starlette는 500 응답 뒤 예외를 다시 던지고, uvicorn은 이를 아래처럼 error 로그로 남긴다.
        with pytest.raises(RuntimeError) as error:
            send(raising)
        logging.getLogger("uvicorn.error").error(
            "Exception in ASGI application\n", exc_info=error.value
        )
        assert "Traceback" in "".join(traceback.format_exception(error.value))
    log = server_log(caplog)
    assert "처리되지 않은 서버 오류: RuntimeError" in log
    assert "Exception in ASGI application" in log
    # CASE_A의 건강 상태(normal, good)와 쿼리의 poor가 어떤 서버 로그에도 없다.
    assert not any(value in log for value in ("normal", "good", "poor"))
