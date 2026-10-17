"""CODEF의 조회 전용 HTTP·RSA 경계. 응답 원문과 사용자 인증정보는 기록하지 않는다."""

import base64
import json
import re
from datetime import timedelta
from threading import Lock
from urllib.parse import quote, unquote_plus

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from app.core.config import Settings
from app.core.errors import AppError
from app.core.time import now_utc

# 출처: https://developer.codef.io/common-guide/rest-api
# https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/properties.py
# https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/connector.py
# https://github.com/codef-io/easycodefpy/blob/master/easycodefpy/util.py
DOMAINS = {
    "sandbox": "https://sandbox.codef.io",
    "development": "https://development.codef.io",
    "production": "https://api.codef.io",
}
TOKEN_URL = "https://oauth.codef.io/oauth/token"


class CodefError(AppError):
    def __init__(self, result_code: object = None):
        super().__init__(
            502,
            "CONNECTOR_FAILED",
            "CODEF에서 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        )
        # 외부 메시지는 개인정보를 포함할 수 있다. 확인된 결과 코드 형식만 보존한다.
        self.result_code = (
            result_code
            if isinstance(result_code, str) and re.fullmatch(r"CF-\d{5}", result_code)
            else "CONNECTOR_FAILED"
        )


def encrypt_password(public_key: str, password: str) -> str:
    # 출처: https://developer.codef.io/common-guide/connected-id/register
    try:
        key = serialization.load_der_public_key(base64.b64decode(public_key, validate=True))
        if not isinstance(key, rsa.RSAPublicKey):
            raise ValueError
        return base64.b64encode(key.encrypt(password.encode(), padding.PKCS1v15())).decode()
    except (ValueError, TypeError):
        raise CodefError() from None


class CodefClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._token: str | None = None
        self._expires_at = now_utc()
        self._lock = Lock()

    def is_available(self) -> bool:
        return bool(
            self.settings.codef_client_id
            and self.settings.codef_client_secret
            and self.settings.codef_public_key
        )

    def _access_token(self, client: httpx.Client, *, force: bool = False) -> str:
        with self._lock:
            if not force and self._token and now_utc() < self._expires_at - timedelta(hours=1):
                return self._token
            response = client.post(
                TOKEN_URL,
                auth=(self.settings.codef_client_id, self.settings.codef_client_secret),
                data={"grant_type": "client_credentials", "scope": "read"},
            )
            if response.status_code != 200:
                raise CodefError()
            data = response.json()
            token = data.get("access_token")
            if not isinstance(token, str) or not token:
                raise CodefError()
            self._token = token
            self._expires_at = now_utc() + timedelta(seconds=int(data.get("expires_in", 604800)))
            return token

    def request(self, path: str, body: dict):
        if not self.is_available():
            raise AppError(409, "CONFLICT", "CODEF 키가 설정되지 않았습니다.")
        try:
            with httpx.Client(timeout=30) as client:
                token = self._access_token(client)
                for attempt in range(2):
                    response = client.post(
                        DOMAINS[self.settings.codef_env] + path,
                        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                        content=quote(json.dumps(body, ensure_ascii=False)),
                    )
                    if response.status_code == 401 and attempt == 0:
                        token = self._access_token(client, force=True)
                        continue
                    if response.status_code != 200:
                        raise CodefError()
                    data = json.loads(unquote_plus(response.text))
                    code = data.get("result", {}).get("code")
                    if code != "CF-00000":
                        raise CodefError(code)
                    return data.get("data")
        except CodefError:
            raise
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, KeyError, OverflowError):
            raise CodefError() from None
