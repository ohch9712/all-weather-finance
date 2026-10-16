"""리포트·점수 스냅샷·점수 이력·추천 API(스펙 02 5.3~5.6, 7.7, 7.8, 7.10)."""

import pytest
from freezegun import freeze_time
from sqlalchemy import select

from app.modules.allocation.models import AllocationScore
from tests.allocation.helpers import (
    add_goal,
    add_holding,
    assess,
    put_situation,
    score_rows,
    signup,
)

TODAY = "2026-10-16T03:00:00Z"  # KST 2026-10-16 12:00
EMPTY_REPORT = {
    "score": None,
    "grade": None,
    "scoreDelta": None,
    "scoredOn": None,
    "classes": None,
}
CLASS_KEYS = [
    "assetClass",
    "actualAmount",
    "actualWeight",
    "targetWeight",
    "targetAmount",
    "diffAmount",
]


def report(client):
    response = client.get("/api/allocation/report")
    assert response.status_code == 200, response.text
    return response.json()


def test_report_statuses(app):
    with signup(app, "status@example.com") as client:
        add_holding(client, "cash", 1_000_000)
        assert report(client) == {
            "status": "needs_profile",
            "ageBand": None,
            "riskProfile": None,
            "totalAmount": 1_000_000,
            "excludedAmount": 0,
            **EMPTY_REPORT,
        }
        assert client.put("/api/profile", json={"birthYear": 1994}).status_code == 200
        body = report(client)
        assert body["status"] == "needs_assessment"
        assert body["ageBand"] == "30s"
        assert body["riskProfile"] is None
        [holding] = client.get("/api/allocation/holdings").json()["items"]
        client.request(
            "DELETE",
            f"/api/allocation/holdings/{holding['id']}",
            headers={"Content-Type": "application/json"},
        )
        assess(client)
        assert report(client) == {
            "status": "needs_holdings",
            "ageBand": "30s",
            "riskProfile": "neutral",
            "totalAmount": 0,
            "excludedAmount": 0,
            **EMPTY_REPORT,
        }


def test_needs_holdings_when_only_excluded_or_zero(auth_client, db):
    assess(auth_client)
    add_holding(auth_client, "other", 300_000_000, include=False)
    add_holding(auth_client, "stock", 0)
    body = report(auth_client)
    assert body["status"] == "needs_holdings"
    assert body["totalAmount"] == 0
    assert body["excludedAmount"] == 300_000_000
    assert score_rows(db) == 0


@freeze_time(TODAY, tick=True)
def test_report_case_1(auth_client):
    assess(auth_client)
    add_holding(auth_client, "stock", 50_000_000)
    add_holding(auth_client, "bond", 30_000_000)
    add_holding(auth_client, "cash", 20_000_000)
    body = report(auth_client)
    assert list(body) == [
        "status",
        "ageBand",
        "riskProfile",
        "totalAmount",
        "excludedAmount",
        "score",
        "grade",
        "scoreDelta",
        "scoredOn",
        "classes",
    ]
    assert body["status"] == "ready"
    assert (body["score"], body["grade"], body["scoreDelta"]) == (80, "A", None)
    assert body["scoredOn"] == "2026-10-16"
    assert [list(item) for item in body["classes"]] == [CLASS_KEYS] * 5
    assert body["classes"] == [
        {
            "assetClass": "stock",
            "actualAmount": 50_000_000,
            "actualWeight": 50.0,
            "targetWeight": 65.0,
            "targetAmount": 65_000_000,
            "diffAmount": 15_000_000,
        },
        {
            "assetClass": "bond",
            "actualAmount": 30_000_000,
            "actualWeight": 30.0,
            "targetWeight": 25.0,
            "targetAmount": 25_000_000,
            "diffAmount": -5_000_000,
        },
        {
            "assetClass": "gold",
            "actualAmount": 0,
            "actualWeight": 0.0,
            "targetWeight": 5.0,
            "targetAmount": 5_000_000,
            "diffAmount": 5_000_000,
        },
        {
            "assetClass": "cash",
            "actualAmount": 20_000_000,
            "actualWeight": 20.0,
            "targetWeight": 5.0,
            "targetAmount": 5_000_000,
            "diffAmount": -15_000_000,
        },
        {
            "assetClass": "other",
            "actualAmount": 0,
            "actualWeight": 0.0,
            "targetWeight": 0.0,
            "targetAmount": 0,
            "diffAmount": 0,
        },
    ]


def setup_case_2(client):
    assess(client)
    put_situation(client, 2_000_000)
    add_goal(client, "home", 20_000_000, "2028-10-16")
    add_goal(client, "retirement", 500_000_000, "2056-10-16")
    add_holding(client, "stock", 26_000_000)
    add_holding(client, "bond", 6_000_000)
    add_holding(client, "cash", 20_000_000)
    add_holding(client, "other", 300_000_000, name="실거주 주택", include=False)


@freeze_time(TODAY, tick=True)
def test_report_uses_goal_aware_target(auth_client, db):
    setup_case_2(auth_client)
    body = report(auth_client)
    assert (body["status"], body["score"], body["grade"]) == ("ready", 58, "D")
    assert body["totalAmount"] == 52_000_000
    assert body["excludedAmount"] == 300_000_000
    stock = body["classes"][0]
    assert stock == {
        "assetClass": "stock",
        "actualAmount": 26_000_000,
        "actualWeight": 50.0,
        "targetWeight": 32.5,
        "targetAmount": 16_900_000,
        "diffAmount": -9_100_000,
    }
    assert [item["targetWeight"] for item in body["classes"]] == [32.5, 50.96, 2.5, 14.04, 0.0]
    assert [item["actualWeight"] for item in body["classes"]] == [50.0, 11.54, 0.0, 38.46, 0.0]
    assert sum(item["targetAmount"] for item in body["classes"]) == 52_000_000

    row = db.scalar(select(AllocationScore))
    assert (row.score, row.grade, row.total_amount, row.age_band, row.risk_profile) == (
        58,
        "D",
        52_000_000,
        "30s",
        "neutral",
    )
    assert row.target_weights == {
        "stock": 32.5,
        "bond": 50.96,
        "gold": 2.5,
        "cash": 14.04,
        "other": 0.0,
    }
    assert row.actual_weights == {
        "stock": 50.0,
        "bond": 11.54,
        "gold": 0.0,
        "cash": 38.46,
        "other": 0.0,
    }


@freeze_time(TODAY, tick=True)
def test_situation_and_goal_changes_update_snapshot(auth_client, db):
    assess(auth_client)
    add_holding(auth_client, "stock", 26_000_000)
    add_holding(auth_client, "bond", 6_000_000)
    add_holding(auth_client, "cash", 20_000_000)

    def current_score():
        return db.scalar(select(AllocationScore.score).execution_options(populate_existing=True))

    before = current_score()
    put_situation(auth_client, 2_000_000)
    after_situation = current_score()
    goal = add_goal(auth_client, "home", 20_000_000, "2028-10-16")
    after_goal = current_score()
    assert after_goal == 58
    assert len({before, after_situation, after_goal}) == 3
    response = auth_client.request(
        "DELETE",
        f"/api/allocation/goals/{goal['id']}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 204
    assert current_score() == after_situation
    assert score_rows(db) == 1


def test_snapshot_one_row_per_day_and_delta(auth_client, db):
    with freeze_time("2026-10-14T03:00:00Z", tick=True):
        assess(auth_client)
        holding = add_holding(auth_client, "stock", 50_000_000)
        add_holding(auth_client, "bond", 30_000_000)
        add_holding(auth_client, "cash", 20_000_000)  # 80점
        assert report(auth_client)["scoreDelta"] is None
        assert score_rows(db) == 1

    with freeze_time("2026-10-15T03:00:00Z", tick=True):
        path = f"/api/allocation/holdings/{holding['id']}"
        auth_client.patch(path, json={"amount": 60_000_000})
        auth_client.patch(path, json={"amount": 65_000_000})
        body = report(auth_client)
        assert body["scoredOn"] == "2026-10-15"
        rows = db.scalars(
            select(AllocationScore)
            .order_by(AllocationScore.scored_on)
            .execution_options(populate_existing=True)
        ).all()
        assert [(row.scored_on.isoformat(), row.score) for row in rows] == [
            ("2026-10-14", 80),
            ("2026-10-15", body["score"]),
        ]
        assert body["scoreDelta"] == body["score"] - 80

    with freeze_time("2026-10-17T03:00:00Z", tick=True):
        auth_client.patch(f"/api/allocation/holdings/{holding['id']}", json={"amount": 50_000_000})
        body = report(auth_client)
        assert body["score"] == 80
        # 바로 앞 스냅샷(10-15) 기준, 그 앞날(10-14)은 보지 않는다
        assert body["scoreDelta"] == 80 - rows[1].score
        assert score_rows(db) == 3


def test_snapshot_kst_day_boundary(auth_client, db):
    with freeze_time("2026-10-16T14:59:59Z"):
        assess(auth_client)
        add_holding(auth_client, "cash", 1_000_000)
        assert report(auth_client)["scoredOn"] == "2026-10-16"
    with freeze_time("2026-10-16T15:00:00Z"):
        assert report(auth_client)["scoredOn"] == "2026-10-17"
    assert score_rows(db) == 2


def test_scores_history(auth_client, other_auth_client):
    with freeze_time("2026-02-01T03:00:00Z", tick=True):
        assess(auth_client)
        holding = add_holding(auth_client, "stock", 50_000_000)
        add_holding(auth_client, "cash", 50_000_000)
    for day, amount in [
        ("2026-03-01", 60_000_000),
        ("2026-09-01", 70_000_000),
        ("2026-10-15", 80_000_000),
    ]:
        with freeze_time(f"{day}T03:00:00Z", tick=True):
            auth_client.patch(f"/api/allocation/holdings/{holding['id']}", json={"amount": amount})

    def days_of(query: str) -> list[str]:
        response = auth_client.get(f"/api/allocation/scores{query}")
        assert response.status_code == 200
        return [item["scoredOn"] for item in response.json()["items"]]

    with freeze_time("2026-10-16T03:00:00Z", tick=True):
        items = auth_client.get("/api/allocation/scores").json()["items"]
        assert list(items[0]) == ["scoredOn", "score", "grade"]
        assert days_of("") == ["2026-09-01", "2026-10-15"]  # 기본 180일: 2026-04-20부터
        assert days_of("?days=730") == ["2026-02-01", "2026-03-01", "2026-09-01", "2026-10-15"]
        assert days_of("?days=2") == ["2026-10-15"]
        assert days_of("?days=1") == []
        assert other_auth_client.get("/api/allocation/scores").json() == {"items": []}


@pytest.mark.parametrize("days", ["0", "731", "abc"])
def test_scores_days_validation(auth_client, days):
    response = auth_client.get(f"/api/allocation/scores?days={days}")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# ── 7.10 추천 ────────────────────────────────────────────────────────────


def test_recommendation_statuses(app):
    with signup(app, "rec@example.com") as client:
        body = client.get("/api/allocation/recommendation").json()
        assert body["status"] == "needs_profile"
        assert body["directions"] == [] and body["reasons"] == []
        assert body["layering"] is None and body["targetWeights"] is None
        client.put("/api/profile", json={"birthYear": 1994})
        body = client.get("/api/allocation/recommendation").json()
        assert body["status"] == "needs_assessment"
        assert body["answerContributions"] == [] and body["assetClassNotes"] == []
        assess(client)
        body = client.get("/api/allocation/recommendation").json()
        assert body["status"] == "ready"
        assert body["layering"] == "needs_holdings"
        assert body["targetAmounts"] is None
        assert body["targetWeights"] == {
            "stock": 65.0,
            "bond": 25.0,
            "gold": 5.0,
            "cash": 5.0,
            "other": 0.0,
        }
        assert body["layers"] == {"emergency": None, "shortTermGoals": [], "longTermAmount": None}
        assert [item["kind"] for item in body["directions"]] == [
            "input_situation",
            "input_holdings",
        ]


@freeze_time(TODAY, tick=True)
def test_recommendation_case_2_and_no_side_effect(auth_client, db):
    setup_case_2(auth_client)
    rows_before = score_rows(db)
    snapshot = db.scalar(select(AllocationScore.updated_at))
    response = auth_client.get("/api/allocation/recommendation")
    assert response.status_code == 200
    body = response.json()
    assert list(body) == [
        "status",
        "layering",
        "ageBand",
        "riskProfile",
        "riskScore",
        "riskProfileSummary",
        "risky",
        "baseWeights",
        "totalAmount",
        "layers",
        "targetAmounts",
        "targetWeights",
        "directions",
        "reasons",
        "assetClassNotes",
        "answerContributions",
    ]
    assert body["status"] == "ready"
    assert body["layering"] == "applied"
    assert (body["ageBand"], body["riskProfile"], body["riskScore"]) == ("30s", "neutral", 57.8)
    assert body["riskProfileSummary"] == "수익과 위험의 균형을 원해요."
    assert body["risky"] == {"start": 65, "adjustment": 0, "final": 65, "clamped": False}
    assert body["baseWeights"] == {"stock": 65, "bond": 25, "gold": 5, "cash": 5, "other": 0}
    assert body["totalAmount"] == 52_000_000
    assert body["layers"]["emergency"] == {
        "monthlyExpense": 2_000_000,
        "months": 3,
        "targetAmount": 6_000_000,
        "allocatedAmount": 6_000_000,
    }
    [goal] = body["layers"]["shortTermGoals"]
    assert list(goal) == [
        "goalId",
        "title",
        "targetDate",
        "horizon",
        "targetAmount",
        "allocatedAmount",
        "assetClass",
    ]
    assert (goal["title"], goal["targetDate"], goal["horizon"], goal["assetClass"]) == (
        "내 집 마련",
        "2028-10-16",
        "within_3y",
        "bond",
    )
    assert body["layers"]["longTermAmount"] == 26_000_000
    assert body["targetAmounts"] == {
        "stock": 16_900_000,
        "bond": 26_500_000,
        "gold": 1_300_000,
        "cash": 7_300_000,
        "other": 0,
    }
    assert body["targetWeights"] == {
        "stock": 32.5,
        "bond": 50.96,
        "gold": 2.5,
        "cash": 14.04,
        "other": 0.0,
    }
    first = body["directions"][0]
    assert first == {
        "kind": "reserve_short_term_goal",
        "priority": 3,
        "title": "'내 집 마련' 자금은 안전하게",
        "body": (
            "2028년 10월에 쓸 2,000만원은 값이 크게 흔들리지 않는 채권으로 모아 두는 것을 권해요."
        ),
        "amount": 20_000_000,
        "assetClass": "bond",
        "href": "/allocation/recommendation/detail",
    }
    assert [item["kind"] for item in body["directions"]] == [
        "reserve_short_term_goal",
        "rebalance",
        "rebalance",
        "long_term_goal",
    ]
    assert [item["code"] for item in body["reasons"]] == [
        "age_band",
        "risk_profile",
        "emergency_fund",
        "short_term_goals",
        "long_term_mix",
    ]
    assert body["assetClassNotes"][0]["weight"] == 32.5
    assert body["answerContributions"][0] == {
        "questionId": "horizon",
        "question": "이 돈을 얼마 동안 투자할 수 있나요?",
        "answerLabel": "1년 ~ 3년",
        "points": 10.0,
        "maxPoints": 20.0,
    }
    # 추천 API는 스냅샷을 쓰지 않는다
    assert score_rows(db) == rows_before
    assert db.scalar(select(AllocationScore.updated_at)) == snapshot


def test_recommendation_other_user_isolated(auth_client, other_auth_client):
    setup_case_2(auth_client)
    assess(other_auth_client)
    body = other_auth_client.get("/api/allocation/recommendation").json()
    assert body["totalAmount"] == 0
    assert body["layers"]["emergency"] is None
    assert body["layers"]["shortTermGoals"] == []
