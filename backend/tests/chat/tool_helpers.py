"""15 도구 테스트 도우미. 다른 모듈 데이터는 그 모듈의 API로 만든다(내부 코드를 쓰지 않는다)."""

import json
from dataclasses import dataclass
from datetime import date

from app.modules.chat.agent import execute_tool
from app.modules.chat.providers.base import ToolCall
from app.modules.chat.tools.registry import ToolContext
from tests.chat.conftest import user_by_email

TODAY = date(2026, 10, 17)
JSON_HEADERS = {"Content-Type": "application/json"}


@dataclass
class Result:
    content: object  # 모델에 보낸 JSON을 다시 읽은 값
    raw: str
    card: dict | None
    is_error: bool


def tool_ctx(db, email: str = "first@example.com", today: date = TODAY) -> ToolContext:
    return ToolContext(db=db, user=user_by_email(db, email), today=today)


def run(ctx: ToolContext, name: str, arguments: dict | None = None) -> Result:
    """09 루프와 같은 경로(입력 재검증 → savepoint 안 실행 → JSON 직렬화)로 도구를 부른다."""
    run_result = execute_tool(
        ctx, ToolCall(id=f"call-{name}", name=name, arguments=arguments or {})
    )
    raw = run_result.result.content
    return Result(json.loads(raw), raw, run_result.card, run_result.result.is_error)


class Spy:
    """모듈 함수 호출 인자를 기록하고 실제 함수를 부른다."""

    def __init__(self, monkeypatch, module, name: str):
        self.calls: list[tuple[tuple, dict]] = []
        real = getattr(module, name)

        def wrapper(*args, **kwargs):
            self.calls.append((args, kwargs))
            return real(*args, **kwargs)

        monkeypatch.setattr(module, name, wrapper)


# ── 자산배분(02 API) ────────────────────────────────────────────────


def assess(client, **overrides) -> None:
    answers = {
        "horizon": 3,
        "experience": 4,
        "knowledge": 3,
        "income": 3,
        "investmentRatio": 3,
        "lossTolerance": 3,
        **overrides,
    }
    response = client.post(
        "/api/allocation/risk-assessments", json={"surveyVersion": 1, "answers": answers}
    )
    assert response.status_code == 201, response.text


def add_holding(client, asset_class: str, amount: int, *, include: bool = True) -> None:
    response = client.post(
        "/api/allocation/holdings",
        json={
            "name": f"{asset_class} 자산",
            "assetClass": asset_class,
            "amount": amount,
            "includeInAllocation": include,
            "memo": None,
        },
    )
    assert response.status_code == 201, response.text


# ── 가계부(03 API) ──────────────────────────────────────────────────


def add_entry(client, kind: str, category: str, amount: int, occurred_on: str, **fields) -> None:
    categories = client.get("/api/ledger/categories").json()["items"]
    category_id = next(
        item["id"] for item in categories if item["kind"] == kind and item["name"] == category
    )
    response = client.post(
        "/api/ledger/entries",
        json={
            "kind": kind,
            "occurredOn": occurred_on,
            "amount": amount,
            "categoryId": category_id,
            **fields,
        },
    )
    assert response.status_code == 201, response.text


# ── 매매일지(05 API) ────────────────────────────────────────────────


def add_trade(client, side: str, quantity: str, price: str, traded_on: str, **fields) -> None:
    body = {
        "tradedOn": traded_on,
        "market": "KRX",
        "symbolCode": "005930",
        "symbolName": "삼성전자",
        "side": side,
        "quantity": quantity,
        "price": price,
        "currency": "KRW",
        "fee": "0",
        "tax": "0",
        **fields,
    }
    response = client.post("/api/journal/trades", json=body)
    assert response.status_code == 201, response.text


# ── 상속·증여(06 API) ───────────────────────────────────────────────


def add_member(client, display_name: str, relation: str = "child", **fields) -> dict:
    body = {"relation": relation, "displayName": display_name, **fields}
    if relation in {"child", "grandchild"}:
        body.setdefault("birthDate", "2000-03-01")
    response = client.post("/api/estate/members", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def add_gift(client, member_id: str, amount: int, gifted_on: str, **fields) -> None:
    response = client.post(
        "/api/estate/gifts",
        json={
            "recipientId": member_id,
            "giftedOn": gifted_on,
            "donorGroup": "parents",
            "amount": amount,
            **fields,
        },
    )
    assert response.status_code == 201, response.text
