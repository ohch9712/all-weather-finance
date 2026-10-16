from typing import NoReturn

from app.core.errors import field_error


def invalid(field: str, message: str) -> NoReturn:
    raise field_error(field, message)
