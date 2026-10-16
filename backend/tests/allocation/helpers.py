"""allocation API 테스트 도우미."""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.allocation.models import AllocationScore

# 5.1 사례 3: 57.8점 위험중립형, income 3
NEUTRAL_ANSWERS = {
    "horizon": 3,
    "experience": 4,
    "knowledge": 3,
    "income": 3,
    "investmentRatio": 3,
    "lossTolerance": 3,
}


def answers(**overrides: int) -> dict[str, int]:
    return {**NEUTRAL_ANSWERS, **overrides}


def assess(client: TestClient, **overrides: int) -> dict[str, Any]:
    response = client.post(
        "/api/allocation/risk-assessments",
        json={"surveyVersion": 1, "answers": answers(**overrides)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_holding(
    client: TestClient,
    asset_class: str,
    amount: int,
    *,
    name: str | None = None,
    include: bool = True,
    memo: str | None = None,
) -> dict[str, Any]:
    response = client.post(
        "/api/allocation/holdings",
        json={
            "name": name or f"{asset_class} 자산",
            "assetClass": asset_class,
            "amount": amount,
            "includeInAllocation": include,
            "memo": memo,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def put_situation(
    client: TestClient, monthly_expense: int, dependents: int = 0, consumer_debt: int = 0
) -> dict[str, Any]:
    response = client.put(
        "/api/allocation/situation",
        json={
            "monthlyExpense": monthly_expense,
            "dependents": dependents,
            "consumerDebt": consumer_debt,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def add_goal(
    client: TestClient, goal_type: str, amount: int, target_date: str, title: str | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "goalType": goal_type,
        "targetAmount": amount,
        "targetDate": target_date,
    }
    if title is not None:
        body["title"] = title
    response = client.post("/api/allocation/goals", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def signup(app, email: str, birth_year: int | None = None) -> TestClient:
    """출생연도를 고를 수 있는 로그인 클라이언트(None이면 프로필 미입력)"""
    instance = TestClient(app, raise_server_exceptions=False)
    response = instance.post(
        "/api/auth/signup",
        json={"email": email, "password": "test-password", "passwordConfirm": "test-password"},
    )
    assert response.status_code == 201, response.text
    if birth_year is not None:
        assert instance.put("/api/profile", json={"birthYear": birth_year}).status_code == 200
    return instance


def score_rows(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(AllocationScore))


def error_fields(response) -> list[tuple[str, str]]:
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    return [(item["field"], item["message"]) for item in body["details"]]
