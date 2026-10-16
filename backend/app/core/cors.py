from starlette.datastructures import Headers
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.core.errors import error_response


class JsonCORSMiddleware(CORSMiddleware):
    def preflight_response(self, request_headers: Headers) -> Response:
        response = super().preflight_response(request_headers)
        if response.status_code < 400:
            return response
        # CORS 자체가 만든 400도 애플리케이션의 공통 JSON 에러 계약을 따른다.
        headers = {
            key: value
            for key, value in response.headers.items()
            if key not in {"content-type", "content-length"}
        }
        return error_response(
            400, "HTTP_ERROR", "허용되지 않은 교차 출처 요청입니다.", headers=headers
        )
