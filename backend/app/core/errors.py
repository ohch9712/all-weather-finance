import logging
import re

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic.alias_generators import to_camel
from starlette.exceptions import HTTPException

from app.core.config import get_settings
from app.core.schemas import ErrorBody, ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)
_HANGUL = re.compile(r"[가-힣]")


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or []


def field_error(field: str, message: str) -> AppError:
    """필드 하나의 422 VALIDATION_ERROR. field는 camelCase 키나 위치(예: items.0.amount)다."""
    return AppError(
        422,
        "VALIDATION_ERROR",
        "입력값을 확인해 주세요.",
        [ErrorDetail(field=field, message=message)],
    )


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: list[ErrorDetail] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, details=details or []))
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(by_alias=True),
        headers=headers,
    )


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message, exc.details)


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    details = []
    for error in exc.errors():
        location = error.get("loc", ())
        kind = error["type"]
        field = (
            "body"
            if kind == "json_invalid" or not location or location == ("body",)
            else to_camel(str(location[-1]))
        )
        if kind == "missing":
            message = "필수 항목입니다."
        elif kind in {"string_too_short", "string_too_long"}:
            message = "길이를 확인해 주세요."
        elif kind in {"greater_than", "greater_than_equal", "less_than", "less_than_equal"}:
            message = "허용 범위를 벗어났습니다."
        elif kind in {"value_error", "password_confirmation"}:
            message = error["msg"].removeprefix("Value error, ")
            # 라이브러리의 영어 기본 문구는 보내지 않는다. 모듈의 한국어 문구만 통과한다.
            if not _HANGUL.search(message):
                message = (
                    "올바른 이메일 주소를 입력해 주세요."
                    if "email address" in message
                    else "형식이 올바르지 않습니다."
                )
        else:
            message = "형식이 올바르지 않습니다."
        details.append(ErrorDetail(field=field, message=message))
    return error_response(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", details)


async def http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    code, message = {
        404: ("NOT_FOUND", "요청한 경로를 찾을 수 없습니다."),
        405: ("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다."),
        500: ("INTERNAL_ERROR", "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."),
    }.get(exc.status_code, ("HTTP_ERROR", str(exc.detail)))
    return error_response(exc.status_code, code, message, headers=exc.headers)


async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("처리되지 않은 서버 오류: %s", type(exc).__name__)
    response = error_response(
        500, "INTERNAL_ERROR", "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    )
    # Starlette의 최상위 500 핸들러는 CORS 미들웨어 바깥에서 응답을 만든다.
    origin = request.headers.get("origin")
    if origin == get_settings().frontend_origin:
        response.headers["access-control-allow-origin"] = origin
        response.headers["access-control-allow-credentials"] = "true"
        response.headers.add_vary_header("Origin")
    return response


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(Exception, internal_error_handler)
