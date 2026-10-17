import json
from collections.abc import Callable
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.core.config import Settings
from app.integrations.brokers.mock import MockBroker
from app.integrations.llm import status
from app.modules.auth.models import User
from app.modules.chat import service
from app.modules.chat.models import ChatMessage
from app.modules.chat.providers.base import get_chat_provider
from app.modules.chat.tools import registry
from app.modules.chat.tools.registry import ToolSpec
from app.modules.market import service as market_service
from tests.chat.fakes import FakeChatProvider, FakeRound

MODEL = "gemma4:12b"
SNAPSHOT_DAY = date(2026, 10, 16)

# 09 기본 도구 2개 + 15 모듈 데이터 도구 16개(이름순, 스펙 15 8절)
ALL_TOOL_NAMES = [
    "add_to_watchlist",
    "compare_estate_plans",
    "estimate_gift_tax",
    "get_allocation_report",
    "get_gift_deductions",
    "get_my_profile",
    "get_positions",
    "get_recommendation",
    "get_risk_profile",
    "get_spending_summary",
    "get_stock_detail",
    "get_today",
    "get_trade_stats",
    "get_watchlist",
    "plan_gifts",
    "screen_stocks",
    "search_learning",
    "search_stocks",
]


@pytest.fixture
def chat_settings(monkeypatch) -> Settings:
    """personal 공급자를 로컬 Ollama로 켠 설정. 테스트가 값을 바꿔 공급자 전환을 흉내 낸다."""
    settings = Settings(
        llm_personal_provider="ollama",
        llm_general_provider="disabled",
        ollama_model=MODEL,
        gemini_model="gemini-3.8-flash",
        gemini_api_key="",
        gemini_billing_enabled=False,
        chat_daily_message_limit=100,
    )
    monkeypatch.setattr(status, "get_settings", lambda: settings)
    monkeypatch.setattr(service, "get_settings", lambda: settings)
    return settings


def enable_gemini(settings: Settings) -> None:
    """결제가 연결된 Gemini 키로 personal 공급자를 바꾼다."""
    settings.llm_personal_provider = "gemini"
    settings.gemini_api_key = "fake-key"
    settings.gemini_billing_enabled = True


@pytest.fixture
def use_provider(app, chat_settings) -> Callable[..., FakeChatProvider]:
    """가짜 공급자를 get_chat_provider 의존성에 끼운다."""

    def install(rounds: list[FakeRound], *, name: str = "ollama", model: str = MODEL):
        provider = FakeChatProvider(rounds, name=name, model=model)
        app.dependency_overrides[get_chat_provider] = lambda: provider
        return provider

    yield install
    app.dependency_overrides.pop(get_chat_provider, None)


@pytest.fixture
def temp_tool():
    """테스트 동안만 도구를 등록한다."""
    added: list[str] = []

    def register(spec: ToolSpec) -> ToolSpec:
        registry.register_tool(spec)
        added.append(spec.name)
        return spec

    yield register
    for name in added:
        registry._TOOLS.pop(name, None)


def parse_sse(body: str) -> tuple[list[tuple[str, dict]], int]:
    """SSE 본문 → (이벤트 목록, ping 수)"""
    events: list[tuple[str, dict]] = []
    pings = 0
    assert body.endswith("\n\n"), body
    for block in body.split("\n\n")[:-1]:
        if block == ": ping":
            pings += 1
            continue
        lines = block.split("\n")
        assert len(lines) == 2, block
        assert lines[0].startswith("event: ") and lines[1].startswith("data: "), block
        events.append((lines[0][len("event: ") :], json.loads(lines[1][len("data: ") :])))
    return events, pings


def create_conversation(client, **body) -> dict:
    response = client.post("/api/chat/conversations", json=body or None)
    assert response.status_code == 201, response.text
    return response.json()


def send(client, conversation_id: str, content: str = "내 나이대 알려줘"):
    return client.post(
        f"/api/chat/conversations/{conversation_id}/messages", json={"content": content}
    )


def send_events(client, conversation_id: str, content: str = "내 나이대 알려줘"):
    response = send(client, conversation_id, content)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events, _ = parse_sse(response.text)
    return events


def names(events) -> list[str]:
    return [name for name, _ in events]


def rows(db, conversation_id) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.seq)
        ).all()
    )


def user_by_email(db, email: str = "first@example.com") -> User:
    return db.scalar(select(User).where(User.email == email))


@pytest.fixture
def market(db, monkeypatch) -> MockBroker:
    """08 종목 마스터·스냅샷을 Mock 고정 데이터로 채우고 운영자 클라이언트를 Mock으로 고정한다.

    인스턴스마다 시세 캐시 키가 달라 다른 테스트의 캐시와 섞이지 않는다.
    """
    db.execute(text("DELETE FROM stock_snapshots"))
    db.execute(text("DELETE FROM stocks"))
    db.commit()
    broker = MockBroker()
    market_service.refresh_stocks(db, broker)
    assert market_service.refresh_snapshot(db, broker, SNAPSHOT_DAY)["success"] > 0
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: broker)
    return broker


@pytest.fixture
def empty_market(db, monkeypatch) -> MockBroker:
    """종목도 스냅샷도 없는 상태"""
    db.execute(text("DELETE FROM stock_snapshots"))
    db.execute(text("DELETE FROM stocks"))
    db.commit()
    broker = MockBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: broker)
    return broker


@pytest.fixture
def bare_client(app):
    """출생연도를 입력하지 않은 세 번째 사용자"""
    with TestClient(app, raise_server_exceptions=False) as instance:
        response = instance.post(
            "/api/auth/signup",
            json={
                "email": "third@example.com",
                "password": "test-password",
                "passwordConfirm": "test-password",
            },
        )
        assert response.status_code == 201, response.text
        yield instance
