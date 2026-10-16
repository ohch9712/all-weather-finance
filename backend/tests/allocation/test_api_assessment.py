"""설문·진단·권장 배분표 API(스펙 02 7.1~7.5)."""

import pytest
from freezegun import freeze_time

from app.modules.allocation import rules
from tests.allocation.helpers import answers, assess, error_fields, signup

PATHS = [
    ("GET", "/api/allocation/survey"),
    ("POST", "/api/allocation/risk-assessments"),
    ("GET", "/api/allocation/risk-assessments/latest"),
    ("GET", "/api/allocation/target"),
    ("GET", "/api/allocation/targets/table"),
    ("GET", "/api/allocation/recommendation"),
    ("GET", "/api/allocation/report"),
    ("GET", "/api/allocation/scores"),
    ("GET", "/api/allocation/holdings"),
    ("POST", "/api/allocation/holdings"),
    ("POST", "/api/allocation/holdings/bulk"),
    ("GET", "/api/allocation/situation"),
    ("PUT", "/api/allocation/situation"),
    ("GET", "/api/allocation/goals"),
    ("POST", "/api/allocation/goals"),
]


@pytest.mark.parametrize("method,path", PATHS)
def test_requires_authentication(client, method, path):
    response = client.request(method, path, json={})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


def test_survey(auth_client):
    response = auth_client.get("/api/allocation/survey")
    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["version", "questions"]
    assert body["version"] == 1
    assert [question["id"] for question in body["questions"]] == [
        "horizon",
        "experience",
        "knowledge",
        "income",
        "investmentRatio",
        "lossTolerance",
    ]
    first = body["questions"][0]
    assert first == {
        "id": "horizon",
        "text": "이 돈을 얼마 동안 투자할 수 있나요?",
        "options": [
            {"value": 1, "label": "6개월 미만"},
            {"value": 2, "label": "6개월 ~ 1년"},
            {"value": 3, "label": "1년 ~ 3년"},
            {"value": 4, "label": "3년 ~ 5년"},
            {"value": 5, "label": "5년 이상"},
        ],
    }
    for question, rule in zip(body["questions"], rules.SURVEY_QUESTIONS, strict=True):
        assert question["text"] == rule.text
        assert [option["label"] for option in question["options"]] == list(rule.options)


def test_create_and_latest_assessment(auth_client):
    assert auth_client.get("/api/allocation/risk-assessments/latest").json() == {"assessment": None}
    created = assess(auth_client)
    assert list(created) == ["id", "score", "riskProfile", "createdAt"]
    assert created["score"] == 57.8
    assert created["riskProfile"] == "neutral"
    assert created["createdAt"].endswith("Z")

    active = {
        "horizon": 5,
        "experience": 5,
        "knowledge": 4,
        "income": 4,
        "investmentRatio": 5,
        "lossTolerance": 1,
    }
    later = assess(auth_client, **active)
    assert later["score"] == 73.3
    assert later["riskProfile"] == "active"

    latest = auth_client.get("/api/allocation/risk-assessments/latest").json()["assessment"]
    assert list(latest) == ["id", "score", "riskProfile", "answers", "createdAt"]
    assert latest["id"] == later["id"]
    assert latest["answers"] == active


def test_assessment_isolated_per_user(auth_client, other_auth_client):
    assess(auth_client)
    assert other_auth_client.get("/api/allocation/risk-assessments/latest").json() == {
        "assessment": None
    }


CHOICE = "선택지를 다시 골라 주세요."


@pytest.mark.parametrize(
    "payload,fields",
    [
        ({"horizon": 6}, [("horizon", CHOICE)]),
        ({"horizon": 0}, [("horizon", CHOICE)]),
        ({"knowledge": 5}, [("knowledge", CHOICE)]),
        ({"income": True}, [("income", CHOICE)]),
        ({"lossTolerance": "3"}, [("lossTolerance", CHOICE)]),
        ({"lossTolerance": 2.5}, [("lossTolerance", CHOICE)]),
        ({"horizon": 9, "income": 0}, [("horizon", CHOICE), ("income", CHOICE)]),
    ],
)
def test_assessment_invalid_values(auth_client, payload, fields):
    response = auth_client.post(
        "/api/allocation/risk-assessments",
        json={"surveyVersion": 1, "answers": answers(**payload)},
    )
    assert response.status_code == 422
    assert error_fields(response) == fields


def test_assessment_missing_and_unknown_keys(auth_client):
    values = answers()
    del values["experience"]
    response = auth_client.post(
        "/api/allocation/risk-assessments", json={"surveyVersion": 1, "answers": values}
    )
    assert response.status_code == 422
    assert error_fields(response) == [("experience", CHOICE)]

    response = auth_client.post(
        "/api/allocation/risk-assessments",
        json={"surveyVersion": 1, "answers": {**answers(), "age": 3}},
    )
    assert response.status_code == 422
    assert error_fields(response) == [("age", CHOICE)]
    assert auth_client.get("/api/allocation/risk-assessments/latest").json() == {"assessment": None}


def test_assessment_survey_version(auth_client):
    response = auth_client.post(
        "/api/allocation/risk-assessments", json={"surveyVersion": 2, "answers": answers()}
    )
    assert response.status_code == 422
    assert error_fields(response) == [("surveyVersion", "설문이 바뀌었습니다. 새로고침해 주세요.")]


def test_assessment_requires_json(auth_client):
    response = auth_client.post(
        "/api/allocation/risk-assessments",
        content="surveyVersion=1",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 422


def test_target_conflicts(app):
    with signup(app, "noprofile@example.com") as client:
        response = client.get("/api/allocation/target")
        assert response.status_code == 409
        assert response.json()["error"] == {
            "code": "PROFILE_INCOMPLETE",
            "message": "출생연도를 먼저 입력해 주세요.",
            "details": [],
        }
    with signup(app, "noassessment@example.com", birth_year=1994) as client:
        response = client.get("/api/allocation/target")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "RISK_PROFILE_REQUIRED"
        assert response.json()["error"]["message"] == "투자성향 진단을 먼저 해 주세요."


@freeze_time("2026-10-16T03:00:00Z", tick=True)
def test_target(auth_client):
    assess(auth_client)
    response = auth_client.get("/api/allocation/target")
    assert response.status_code == 200
    assert response.json() == {
        "ageBand": "30s",
        "riskProfile": "neutral",
        "weights": {"stock": 65, "bond": 25, "gold": 5, "cash": 5, "other": 0},
        "riskyWeight": 65,
        "explanation": "30대 위험중립형: 위험자산 비중 = 100 − 35 + 0 = 65%",
    }


def test_target_table(auth_client):
    response = auth_client.get("/api/allocation/targets/table")
    assert response.status_code == 200
    rows = response.json()["rows"]
    assert [row["ageBand"] for row in rows] == ["20s", "30s", "40s", "50s", "60s"]
    for row in rows:
        assert [cell["riskProfile"] for cell in row["cells"]] == [
            "stable",
            "stable_seeking",
            "neutral",
            "active",
            "aggressive",
        ]
        for cell in row["cells"]:
            assert list(cell["weights"]) == ["stock", "bond", "gold", "cash", "other"]
    assert rows[0]["cells"][4]["weights"] == {
        "stock": 80,
        "bond": 0,
        "gold": 5,
        "cash": 5,
        "other": 10,
    }
    assert rows[4]["cells"][0]["weights"] == {
        "stock": 10,
        "bond": 65,
        "gold": 10,
        "cash": 15,
        "other": 0,
    }
