import base64
import json
from urllib.parse import quote

import httpx
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import get_settings
from app.modules.connectors.service import get_codef_connector

CODEF_DELETE_URL = "https://sandbox.codef.io/v1/account/delete"


def codef_response(data=None, code="CF-00000", **result):
    # CODEF 응답 형식(스펙 17 4절): JSON을 URL 인코딩한 본문
    return httpx.Response(
        200,
        text=quote(
            json.dumps({"result": {"code": code, **result}, "data": data}, ensure_ascii=False)
        ),
    )


@pytest.fixture
def codef_keys(monkeypatch):
    # 테스트 프로세스에서 만든 가짜 키다. 실제 CODEF 자격증명이 아니다.
    settings = get_settings()
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    monkeypatch.setattr(settings, "codef_client_id", "test-client")
    monkeypatch.setattr(settings, "codef_client_secret", "test-secret")
    monkeypatch.setattr(settings, "codef_public_key", base64.b64encode(public).decode())
    monkeypatch.setattr(settings, "codef_env", "sandbox")
    get_codef_connector.cache_clear()
    yield settings
    get_codef_connector.cache_clear()


@pytest.fixture
def codef_http(codef_keys):
    with respx.mock(assert_all_mocked=True, assert_all_called=False, using="httpx") as mock:
        mock.route(host="testserver").pass_through()
        mock.post("https://oauth.codef.io/oauth/token").respond(
            200, json={"access_token": "test-token", "expires_in": 604800}
        )
        mock.post(CODEF_DELETE_URL).mock(return_value=codef_response({"errorList": []}))
        yield mock
