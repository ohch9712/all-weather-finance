import logging

import pytest
from uvicorn.logging import AccessFormatter

from app.core.logging import SecretMaskingFilter


@pytest.mark.parametrize("path", ["/api/x?token=abc", "/api/health"])
def test_access_formatter_preserves_arguments(path):
    message = '%s - "%s %s HTTP/%s" %d'
    args = ("127.0.0.1:12345", "GET", path, "1.1", 200)
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, message, args, None)
    filter_ = SecretMaskingFilter()

    assert filter_.filter(record)
    assert filter_.filter(record)
    assert record.msg == message
    assert type(record.args) is tuple
    assert len(record.args) == 5
    assert tuple(type(item) for item in record.args) == tuple(type(item) for item in args)
    assert record.args[:2] == args[:2]
    assert record.args[3:] == args[3:]
    masked_path = "/api/x?token=***" if "token=" in path else path
    assert record.args[2] == masked_path

    formatter = AccessFormatter(
        '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
        use_colors=False,
    )
    assert formatter.format(record) == (
        f'INFO:     127.0.0.1:12345 - "GET {masked_path} HTTP/1.1" 200 OK'
    )


@pytest.mark.parametrize(
    ("message", "args", "expected"),
    [
        ("password=%s", ("x",), "password=***"),
        ("token=%s", ("x",), "token=***"),
        ("password=%(value)s", ({"value": "x"},), "password=***"),
        ("token=%(token)s", ({"token": "x"},), "token=***"),
        (
            "%s",
            ({"password": "x", "nested": {"token": "x"}},),
            "{'password': ***, 'nested': {'token': ***}}",
        ),
        ("password=fake-value, count=%d", (3,), "password=***, count=3"),
        ("token=%s, progress=%d%%", ("x", 100), "token=***, progress=100%"),
    ],
)
def test_formatted_secret_messages(message, args, expected):
    record = logging.LogRecord("test", logging.INFO, "", 0, message, args, None)
    filter_ = SecretMaskingFilter()

    assert filter_.filter(record)
    assert filter_.filter(record)
    assert logging.Formatter("%(message)s").format(record) == expected


@pytest.mark.parametrize(
    ("message", "args", "expected_args", "expected"),
    [
        ("count=%d, status=%s", (3, "ok"), (3, "ok"), "count=3, status=ok"),
        ("count=%(count)d", ({"count": 3},), {"count": 3}, "count=3"),
        ("value=%s, count=%d", ("token=x", 3), ("token=***", 3), "value=token=***, count=3"),
        ("완료", (), (), "완료"),
    ],
)
def test_messages_keep_format_and_argument_shape(message, args, expected_args, expected):
    record = logging.LogRecord("test", logging.INFO, "", 0, message, args, None)
    original_args_type = type(record.args)
    original_args_length = len(record.args)

    assert SecretMaskingFilter().filter(record)
    assert record.msg == message
    assert type(record.args) is original_args_type
    assert len(record.args) == original_args_length
    assert record.args == expected_args
    assert logging.Formatter("%(message)s").format(record) == expected
