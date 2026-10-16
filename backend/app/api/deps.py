from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.schemas import PageParams
from app.db.session import SessionLocal
from app.modules.auth.models import User
from app.modules.auth.service import authenticate


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


DBSession = Annotated[Session, Depends(get_db)]


def get_current_user(request: Request, db: DBSession) -> User:
    return authenticate(db, request.cookies.get(get_settings().session_cookie_name))


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_admin_user(user: CurrentUser) -> User:
    if user.role != "admin":
        raise AppError(403, "FORBIDDEN", "관리자 권한이 필요합니다.")
    return user


AdminUser = Annotated[User, Depends(get_admin_user)]


async def require_json(request: Request) -> None:
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "application/json"
    ):
        from fastapi.exceptions import RequestValidationError

        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body",),
                    "msg": "Value error, 형식이 올바르지 않습니다.",
                }
            ]
        )


def get_page_params(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 20,
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


PageQuery = Annotated[PageParams, Depends(get_page_params)]
