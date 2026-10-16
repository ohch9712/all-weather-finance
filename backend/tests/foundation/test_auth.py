from datetime import date
from uuid import UUID, uuid4

import pytest
from freezegun import freeze_time
from sqlalchemy import func, select

from app.api.deps import AdminUser, PageQuery
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.security import hash_token, verify_password
from app.modules.auth import cli, service
from app.modules.auth.models import Session, User, UserProfile


def signup(client, **overrides):
    return client.post(
        "/api/auth/signup",
        json={
            "email": "Potato@Example.com",
            "password": "gamja1234",
            "passwordConfirm": "gamja1234",
            **overrides,
        },
    )


def test_signup_cookie_normalization_and_storage(client, db):
    response = signup(client, email="  Potato@Example.com  ")
    assert response.status_code == 201
    payload = response.json()
    assert payload["user"]["email"] == "potato@example.com"
    assert payload["user"]["role"] == "user"
    assert payload["user"]["createdAt"].endswith("Z")
    assert payload["profile"] == {"birthYear": None, "nickname": None, "age": None, "ageBand": None}
    cookie = response.headers["set-cookie"]
    for part in ("HttpOnly", "SameSite=lax", "Path=/", "Max-Age=604800"):
        assert part in cookie
    token = client.cookies[get_settings().session_cookie_name]
    user = db.get(User, UUID(payload["user"]["id"]))
    assert user.password_hash != "gamja1234"
    assert verify_password("gamja1234", user.password_hash)
    session = db.scalar(select(Session))
    assert session.token_hash == hash_token(token)
    assert session.token_hash != token
    assert db.get(UserProfile, user.id) is not None
    assert client.get("/api/auth/me").json() == payload
    assert signup(client).status_code == 409
    assert signup(client).json()["error"]["code"] == "EMAIL_ALREADY_EXISTS"


@pytest.mark.parametrize(
    "overrides,field",
    [
        ({"email": "bad"}, "email"),
        ({"password": "short"}, "password"),
        ({"password": "x" * 129}, "password"),
        ({"passwordConfirm": "different"}, "passwordConfirm"),
        ({"passwordConfirm": ""}, "passwordConfirm"),
    ],
)
def test_signup_validation(client, overrides, field):
    response = signup(client, **overrides)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["message"] == "입력값을 확인해 주세요."
    assert error["details"][0]["field"] == field
    if field == "passwordConfirm":
        assert error["details"][0]["message"] == "비밀번호가 일치하지 않습니다."
    if field == "password":
        assert len(error["details"]) == 1


def test_login_replaces_session_and_same_failure(client, db):
    signup(client)
    old_token = client.cookies[get_settings().session_cookie_name]
    response = client.post(
        "/api/auth/login", json={"email": " POTATO@example.com ", "password": "gamja1234"}
    )
    assert response.status_code == 200
    assert db.scalar(select(func.count()).select_from(Session)) == 1
    assert db.scalar(select(Session).where(Session.token_hash == hash_token(old_token))) is None
    failures = [
        client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
        for email in ["potato@example.com", "missing@example.com"]
    ]
    assert [result.status_code for result in failures] == [401, 401]
    assert failures[0].json() == failures[1].json()
    assert failures[0].json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_logout_deletes_session_and_cookie(auth_client, db):
    assert auth_client.post("/api/auth/logout", json={}).status_code == 204
    assert db.scalar(select(func.count()).select_from(Session)) == 0
    assert auth_client.get("/api/auth/me").status_code == 401
    assert auth_client.post("/api/auth/logout", json={}).status_code == 204


def test_session_expiry_is_fixed(client, db):
    with freeze_time("2026-10-16T00:00:00Z"):
        signup(client)
        token = client.cookies[get_settings().session_cookie_name]
    with freeze_time("2026-10-22T23:59:59Z"):
        assert client.get("/api/auth/me").status_code == 200
    with freeze_time("2026-10-23T00:00:00Z"):
        # 브라우저의 쿠키 만료와 별개로 서버의 만료 행 삭제를 확인한다.
        assert (
            client.get("/api/auth/me", headers={"Cookie": f"finance_session={token}"}).status_code
            == 401
        )
    assert db.scalar(select(func.count()).select_from(Session)) == 0


def test_profile_and_isolation(auth_client, other_auth_client, db):
    with freeze_time("2026-10-16"):
        response = auth_client.put("/api/profile", json={"birthYear": 1994, "nickname": "  감자  "})
        assert response.json() == {
            "birthYear": 1994,
            "nickname": "감자",
            "age": 32,
            "ageBand": "30s",
        }
        assert auth_client.get("/api/profile").json() == response.json()
        assert other_auth_client.get("/api/profile").json()["nickname"] is None
        assert (
            auth_client.put("/api/profile", json={"birthYear": 1994, "nickname": "  "}).json()[
                "nickname"
            ]
            is None
        )
    # 사용자 ID를 받는 프로필 경로는 제공하지 않는다. 남의 UUID 경로도 404다.
    other_id = other_auth_client.get("/api/auth/me").json()["user"]["id"]
    assert auth_client.get(f"/api/profile/{other_id}").status_code == 404
    assert auth_client.put(f"/api/profile/{other_id}", json={"birthYear": 2000}).status_code == 404
    with pytest.raises(AppError) as exc:
        service.get_profile(db, uuid4())
    assert exc.value.status_code == 404


@pytest.mark.parametrize(
    "data",
    [
        {},
        {"birthYear": 1919},
        {"birthYear": 2017},
        {"birthYear": 1994.5},
        {"birthYear": "1994"},
        {"birthYear": 1994, "nickname": "가" * 21},
    ],
)
def test_profile_validation(auth_client, data):
    with freeze_time("2026-10-16"):
        assert auth_client.put("/api/profile", json=data).status_code == 422


@pytest.mark.parametrize(
    "age,expected",
    [
        (9, "20s"),
        (29, "20s"),
        (30, "30s"),
        (39, "30s"),
        (40, "40s"),
        (49, "40s"),
        (50, "50s"),
        (59, "50s"),
        (60, "60s"),
        (100, "60s"),
    ],
)
def test_age_band(age, expected):
    assert service.compute_age_band(2026 - age, date(2026, 10, 16)) == expected


def test_admin_dependency_and_cli(app, auth_client, admin_client, db, monkeypatch, capsys):
    @app.get("/api/test-admin")
    def admin_route(user: AdminUser):
        return {"role": user.role}

    assert auth_client.get("/api/test-admin").status_code == 403
    assert admin_client.get("/api/test-admin").json() == {"role": "admin"}
    # CLI도 같은 트랜잭션을 쓰도록 세션 팩토리만 바꾼다.
    from contextlib import nullcontext

    monkeypatch.setattr(cli, "SessionLocal", lambda: nullcontext(db))
    assert cli.main(["make-admin", " FIRST@example.com "]) == 0
    assert auth_client.get("/api/test-admin").status_code == 200
    assert cli.main(["make-admin", "missing@example.com"]) == 1
    assert "사용자를 찾을 수 없습니다." in capsys.readouterr().out


def test_errors_cors_and_page_query(app, client):
    @app.get("/api/test-crash")
    def crash():
        raise RuntimeError("비공개 원문")

    @app.get("/api/test-pages")
    def pages(params: PageQuery):
        return params

    for path in ["/api/auth/me", "/api/profile", "/api/ai/status"]:
        assert client.get(path).status_code == 401
    assert client.get("/absent").json()["error"]["code"] == "NOT_FOUND"
    assert client.post("/api/health").json()["error"]["code"] == "METHOD_NOT_ALLOWED"
    response = client.get("/api/test-crash", headers={"Origin": get_settings().frontend_origin})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "비공개 원문" not in response.text
    assert response.headers["access-control-allow-origin"] == get_settings().frontend_origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert client.get("/api/test-pages").json() == {"page": 1, "pageSize": 20}
    assert client.get("/api/test-pages?pageSize=101").status_code == 422
    response = client.options(
        "/api/health",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "HTTP_ERROR"


@pytest.mark.parametrize(
    "headers,content",
    [
        ({}, "{}"),
        ({"Content-Type": "text/plain"}, "{}"),
        ({"Content-Type": "application/json"}, "not-json"),
    ],
)
def test_json_required(client, headers, content):
    response = client.post("/api/auth/signup", headers=headers, content=content)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body"


def test_health_and_openapi(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    schema = client.get("/openapi.json").json()
    assert {tag["name"] for tag in schema["tags"]} == {
        "auth",
        "profile",
        "health",
        "ai",
        "allocation",
        "ledger",
        "imports",
        "journal",
        "estate",
        "learn",
        "market",
        "chat",
        "watchlist",
        "screener",
        "dashboard",
        "connectors",
    }
