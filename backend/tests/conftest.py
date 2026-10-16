from collections.abc import Iterator
import os

# 테스트 전용 공개 고정 키이며 실제 자격증명이 아니다.
os.environ["APP_ENV"] = "test"
os.environ["APP_ENCRYPTION_KEY"] = "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
os.environ["LLM_GENERAL_PROVIDER"] = "disabled"
os.environ["LLM_PERSONAL_PROVIDER"] = "disabled"
os.environ["GEMINI_API_KEY"] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402
import requests  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, delete  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.api.deps import get_db  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.integrations.llm.deps import get_structured_llm  # noqa: E402
from app.integrations.llm.fake import FakeStructuredLLM  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.auth.models import User  # noqa: E402
from app.modules.auth.service import make_admin  # noqa: E402


@pytest.fixture(autouse=True)
def forbid_external_http(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("테스트에서 실제 외부 HTTP 호출은 금지됩니다.")
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", blocked)
    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", blocked)


@pytest.fixture(scope="session")
def test_engine():
    engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db(test_engine) -> Iterator[Session]:
    with test_engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(delete(User))
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            try:
                yield session
            finally:
                session.close()
                transaction.rollback()


@pytest.fixture
def app(db):
    application = create_app()
    def override_db():
        yield db
    application.dependency_overrides[get_db] = override_db
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as instance:
        yield instance


def authenticated_client(app, email):
    instance = TestClient(app, raise_server_exceptions=False)
    response = instance.post("/api/auth/signup", json={"email": email, "password": "test-password", "passwordConfirm": "test-password"})
    assert response.status_code == 201, response.text
    assert instance.put("/api/profile", json={"birthYear": 1994}).status_code == 200
    return instance


@pytest.fixture
def auth_client(app):
    with authenticated_client(app, "first@example.com") as instance:
        yield instance


@pytest.fixture
def other_auth_client(app):
    with authenticated_client(app, "second@example.com") as instance:
        yield instance


@pytest.fixture
def admin_client(app, db):
    with authenticated_client(app, "admin@example.com") as instance:
        assert make_admin(db, "admin@example.com")
        yield instance


@pytest.fixture
def fake_llm(app):
    fake = FakeStructuredLLM()
    app.dependency_overrides[get_structured_llm] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_structured_llm, None)
