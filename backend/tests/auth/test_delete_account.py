import json
from datetime import UTC, date, datetime, timedelta
from urllib.parse import unquote
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, insert, select

import app.db.models  # noqa: F401  모든 모듈의 테이블을 메타데이터에 올린다.
from app.core.config import get_settings
from app.core.crypto import encrypt_str
from app.core.security import hash_password
from app.db.base import Base
from app.modules.auth.models import User, UserProfile
from app.modules.auth.service import make_admin
from tests.auth.conftest import CODEF_DELETE_URL, codef_response

PASSWORD = "test-password"
WRONG_MESSAGE = "비밀번호가 맞지 않습니다."
CODEF_MESSAGE = (
    "CODEF 연결을 지우지 못했습니다. 데이터 자동 수집 화면에서 연결을 먼저 삭제해 주세요."
)
TABLES = Base.metadata.tables
# users.id를 참조하는 모든 테이블. 새 사용자 테이블이 생기면 아래 seed에 행을 더해야 한다.
USER_TABLES = {
    table.name
    for table in TABLES.values()
    if any(fk.column.table.name == "users" for fk in table.foreign_keys)
}


def delete_me(client, body=None, **kwargs):
    return client.request(
        "DELETE", "/api/auth/me", json={"password": PASSWORD} if body is None else body, **kwargs
    )


def me_id(client) -> UUID:
    return UUID(client.get("/api/auth/me").json()["user"]["id"])


def add(db, table_name, /, **values):
    table = TABLES[table_name]
    if "id" in table.c and "id" not in values:
        values["id"] = uuid4()
    db.execute(insert(table).values(**values))
    return values.get("id")


def seed(db, owner: UUID, tag: str, post_id: UUID) -> set[str]:
    """한 사용자의 모든 사용자 테이블에 행을 하나 이상 만든다. 만든 테이블 이름을 돌려준다."""
    now = datetime(2026, 10, 1, tzinfo=UTC)
    day = date(2026, 10, 1)
    add(
        db,
        "risk_assessments",
        user_id=owner,
        survey_version=1,
        answers={},
        score=50,
        risk_profile="neutral",
    )
    add(db, "holdings", user_id=owner, name="예금", asset_class="cash", amount=1000)
    add(
        db,
        "allocation_scores",
        user_id=owner,
        scored_on=day,
        score=80,
        grade="A",
        total_amount=1000,
        actual_weights={},
        target_weights={},
        age_band="30s",
        risk_profile="neutral",
    )
    add(db, "allocation_situations", user_id=owner, monthly_expense=1000)
    add(
        db,
        "financial_goals",
        user_id=owner,
        goal_type="home",
        title="집",
        target_amount=1000,
        target_date=date(2030, 1, 1),
    )
    # 사용자 분류를 쓰는 가계부 내역(ledger_entries.category_id는 RESTRICT)도 함께 지워져야 한다.
    category = add(db, "ledger_categories", user_id=owner, kind="expense", name=f"분류 {tag}")
    add(
        db,
        "ledger_entries",
        user_id=owner,
        kind="expense",
        occurred_on=day,
        amount=1000,
        category_id=category,
    )
    add(
        db,
        "ledger_merchant_rules",
        user_id=owner,
        merchant_key=f"가맹점{tag}",
        category_id=category,
    )
    add(
        db,
        "import_jobs",
        user_id=owner,
        kind="ledger",
        file_name="표.csv",
        file_type="csv",
        header_row=0,
        columns=[],
        rows=[],
        mapping={},
        mapping_source="user",
        expires_at=now + timedelta(days=1),
    )
    trade = add(
        db,
        "trades",
        user_id=owner,
        traded_at=now,
        market="KRX",
        symbol_code="005930",
        symbol_name="삼성전자",
        side="buy",
        quantity=1,
        price=1000,
        currency="KRW",
    )
    add(
        db,
        "trade_cost_settings",
        user_id=owner,
        krx_commission_rate=0,
        krx_sell_tax_rate=0,
        us_commission_rate=0,
    )
    add(db, "trade_notes", user_id=owner, trade_id=trade, noted_on=day, kind="memo", content="메모")
    member = add(db, "family_members", user_id=owner, relation="child", display_name="자녀")
    add(
        db,
        "gift_records",
        user_id=owner,
        recipient_id=member,
        donor_group="parents",
        deduction_category="lineal_ascendant",
        gifted_on=day,
        asset_type="cash",
        amount=1000,
    )
    add(db, "bookmarks", user_id=owner, post_id=post_id)
    add(db, "post_reads", user_id=owner, post_id=post_id)
    add(
        db,
        "broker_connections",
        user_id=owner,
        provider="mock",
        environment="mock",
        label=f"연결 {tag}",
        app_key_enc="test-enc",
        app_secret_enc="test-enc",
    )
    conversation = add(
        db, "chat_conversations", user_id=owner, provider="ollama", model="test-model"
    )
    add(
        db,
        "chat_messages",
        conversation_id=conversation,
        user_id=owner,
        seq=1,
        turn_id=uuid4(),
        role="user",
        kind="question",
        content=[],
    )
    add(db, "watchlist_items", user_id=owner, stock_code="005930")
    add(db, "saved_screens", user_id=owner, name="조건", filter={})
    account = add(
        db,
        "connector_accounts",
        user_id=owner,
        provider="codef",
        kind="card",
        organization="0306",
        label="카드",
        connected_id_enc=encrypt_str(f"test-connected-{tag}"),
        created_at=now,
    )
    add(
        db,
        "connector_syncs",
        user_id=owner,
        account_id=account,
        kind="card_approvals",
        status="succeeded",
    )
    db.flush()
    # 가입이 만든 sessions·user_profiles를 더한다.
    return {
        "risk_assessments",
        "holdings",
        "allocation_scores",
        "allocation_situations",
        "financial_goals",
        "ledger_categories",
        "ledger_entries",
        "ledger_merchant_rules",
        "import_jobs",
        "trades",
        "trade_cost_settings",
        "trade_notes",
        "family_members",
        "gift_records",
        "bookmarks",
        "post_reads",
        "broker_connections",
        "chat_conversations",
        "chat_messages",
        "watchlist_items",
        "saved_screens",
        "connector_accounts",
        "connector_syncs",
        "sessions",
        "user_profiles",
    }


def count(db, name, owner):
    table = TABLES[name]
    column = table.c.author_id if name == "posts" else table.c.user_id
    return db.scalar(select(func.count()).select_from(table).where(column == owner))


def test_delete_removes_every_user_row_and_keeps_others(
    auth_client, other_auth_client, db, codef_http
):
    owner, other = me_id(auth_client), me_id(other_auth_client)
    posts = {
        user: add(
            db,
            "posts",
            kind="article",
            slug=f"test-post-{n}",
            title="글",
            summary="요약",
            level="beginner",
            author_id=user,
        )
        for n, user in enumerate([owner, other])
    }
    seeded = seed(db, owner, "a", posts[other]) | seed(db, other, "b", posts[owner])
    # 사용자 테이블이 모두 채워졌는지 먼저 확인한다(posts는 author_id SET NULL).
    assert seeded | {"posts"} == USER_TABLES
    for name in USER_TABLES:
        assert count(db, name, owner) >= 1, name
    before = {name: count(db, name, other) for name in USER_TABLES}

    response = delete_me(auth_client)

    assert response.status_code == 204, response.text
    assert response.content == b""
    db.expire_all()
    assert db.get(User, owner) is None
    for name in USER_TABLES:
        assert count(db, name, owner) == 0, name
        assert count(db, name, other) == before[name], name
    # 탈퇴한 사용자가 쓴 글은 남고 작성자만 비운다. 남의 북마크도 그대로다.
    post_table = TABLES["posts"]
    assert db.scalar(select(post_table.c.author_id).where(post_table.c.id == posts[owner])) is None
    assert db.scalar(select(post_table.c.author_id).where(post_table.c.id == posts[other])) == other
    # CODEF에는 탈퇴한 사용자의 연결만 지운다.
    sent = [
        json.loads(unquote(call.request.content.decode()))["connectedId"]
        for call in codef_http.calls
        if call.request.url == CODEF_DELETE_URL
    ]
    assert sent == ["test-connected-a"]
    assert other_auth_client.get("/api/auth/me").status_code == 200


def test_delete_clears_cookie_and_session(auth_client, db):
    name = get_settings().session_cookie_name
    response = delete_me(auth_client)
    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{name}=")
    for part in ("Max-Age=0", "HttpOnly", "Path=/", "SameSite=lax"):
        assert part in cookie
    assert auth_client.get("/api/auth/me").status_code == 401
    assert db.scalar(select(func.count()).select_from(TABLES["sessions"])) == 0
    login = auth_client.post(
        "/api/auth/login", json={"email": "first@example.com", "password": PASSWORD}
    )
    assert login.status_code == 401
    # 같은 이메일로 다시 가입할 수 있다.
    again = auth_client.post(
        "/api/auth/signup",
        json={"email": "first@example.com", "password": PASSWORD, "passwordConfirm": PASSWORD},
    )
    assert again.status_code == 201


@pytest.mark.parametrize(
    "body",
    [
        {"password": "wrong-password"},
        {"password": ""},
        {},
        {"password": "x" * 129},
    ],
)
def test_wrong_or_missing_password_is_422(auth_client, db, body, caplog):
    response = delete_me(auth_client, body)
    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "입력값을 확인해 주세요.",
            "details": [{"field": "password", "message": WRONG_MESSAGE}],
        }
    }
    assert auth_client.get("/api/auth/me").status_code == 200
    assert "set-cookie" not in response.headers
    if body.get("password"):
        assert body["password"] not in response.text + caplog.text


@pytest.mark.parametrize("password", ["x" * 33, "가" * 64, "x" * 128, "😀" * 128])
def test_legacy_long_password_can_delete(client, db, password):
    # 가입은 8~32자로 줄었지만(스펙 01 7.3) 이전 규칙(8~128자)으로 가입한 계정도 탈퇴할 수 있다.
    user = User(email="legacy@example.com", password_hash=hash_password(password))
    db.add(user)
    db.flush()
    db.add(UserProfile(user_id=user.id))
    db.commit()
    login = client.post(
        "/api/auth/login", json={"email": "legacy@example.com", "password": password}
    )
    assert login.status_code == 200, login.text
    assert delete_me(client, {"password": password[:-1] + "!"}).status_code == 422
    response = delete_me(client, {"password": password})
    assert response.status_code == 204
    db.expire_all()
    assert db.get(User, user.id) is None
    assert client.get("/api/auth/me").status_code == 401


def test_password_must_be_string_and_json(auth_client):
    response = delete_me(auth_client, {"password": 12345678})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "password"
    response = auth_client.request(
        "DELETE",
        "/api/auth/me",
        content=f"password={PASSWORD}",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 422
    assert auth_client.get("/api/auth/me").status_code == 200


def test_unauthenticated_is_401(client):
    response = delete_me(client)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_last_admin_cannot_delete(admin_client, auth_client, db):
    response = delete_me(admin_client)
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "CONFLICT",
        "message": "마지막 관리자 계정은 삭제할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.",
        "details": [],
    }
    assert admin_client.get("/api/auth/me").status_code == 200
    # 비밀번호가 틀리면 관리자 확인보다 먼저 422다.
    assert delete_me(admin_client, {"password": "wrong-password"}).status_code == 422
    # 다른 관리자가 있으면 삭제할 수 있다.
    assert make_admin(db, "first@example.com")
    assert delete_me(admin_client).status_code == 204
    assert admin_client.get("/api/auth/me").status_code == 401
    # 남은 관리자는 이제 마지막 관리자다.
    assert delete_me(auth_client).status_code == 409


def add_codef_account(db, owner, n, organization):
    return add(
        db,
        "connector_accounts",
        user_id=owner,
        provider="codef",
        kind="card",
        organization=organization,
        label=f"카드 {n}",
        connected_id_enc=encrypt_str(f"test-connected-{n}"),
        created_at=datetime(2026, 10, 1, n, tzinfo=UTC),
    )


def accounts_of(db, owner):
    table = TABLES["connector_accounts"]
    return set(db.scalars(select(table.c.id).where(table.c.user_id == owner)).all())


def test_codef_failure_keeps_user(auth_client, db, codef_http, caplog):
    owner = me_id(auth_client)
    first = add_codef_account(db, owner, 1, "0306")
    second = add_codef_account(db, owner, 2, "0301")
    db.flush()

    def fail_second(request):
        connected_id = json.loads(unquote(request.content.decode()))["connectedId"]
        if connected_id == "test-connected-2":
            return codef_response(code="CF-03002", message="sensitive-remote-message")
        return codef_response({"errorList": []})

    route = codef_http.post(CODEF_DELETE_URL).mock(side_effect=fail_second)
    response = delete_me(auth_client)
    assert response.status_code == 409
    assert response.json()["error"] == {"code": "CONFLICT", "message": CODEF_MESSAGE, "details": []}
    assert "set-cookie" not in response.headers
    db.expire_all()
    # 사용자는 남고, 먼저 CODEF에서 지운 첫 연결은 지워진 채로 남는다.
    assert db.get(User, owner) is not None
    assert auth_client.get("/api/auth/me").status_code == 200
    assert accounts_of(db, owner) == {second}
    assert first not in accounts_of(db, owner)
    for value in [PASSWORD, "test-connected", "sensitive-remote"]:
        assert value not in response.text + caplog.text

    # 다시 시도하면 남은 연결만 지우고 계정을 삭제한다.
    route.mock(return_value=codef_response({"errorList": []}))
    before = route.calls.call_count
    assert delete_me(auth_client).status_code == 204
    retried = [
        json.loads(unquote(call.request.content.decode()))["connectedId"]
        for call in route.calls[before:]
    ]
    assert retried == ["test-connected-2"]
    db.expire_all()
    assert db.get(User, owner) is None
    assert sum(call.request.url.host not in {"testserver"} for call in codef_http.calls) == 4


def test_codef_missing_keys_keeps_user(auth_client, db, monkeypatch):
    owner = me_id(auth_client)
    account = add_codef_account(db, owner, 1, "0306")
    db.flush()
    # 키가 없으면 CODEF를 부르지 않는다. 외부 HTTP는 루트 conftest가 막는다.
    monkeypatch.setattr(get_settings(), "codef_client_id", "")
    from app.modules.connectors.service import get_codef_connector

    get_codef_connector.cache_clear()
    response = delete_me(auth_client)
    get_codef_connector.cache_clear()
    assert response.status_code == 409
    assert response.json()["error"]["message"] == CODEF_MESSAGE
    db.expire_all()
    assert db.get(User, owner) is not None
    assert accounts_of(db, owner) == {account}


def test_password_not_logged_on_success(auth_client, caplog):
    caplog.set_level("DEBUG")
    response = delete_me(auth_client)
    assert response.status_code == 204
    assert PASSWORD not in caplog.text + response.text
