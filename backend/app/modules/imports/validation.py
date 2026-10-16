from typing import NoReturn

from fastapi.exceptions import RequestValidationError


def invalid(field: str, message: str) -> NoReturn:
    raise RequestValidationError(
        [{"type": "value_error", "loc": ("body", field), "msg": f"Value error, {message}"}]
    )
