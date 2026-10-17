"""상황과 목표 API(스펙 02 5.7, 7.9)."""

from uuid import uuid4

import pytest
from freezegun import freeze_time

from tests.allocation.helpers import add_goal, assess, error_fields, put_situation

TODAY = "2026-10-16T03:00:00Z"
JSON = {"Content-Type": "application/json"}
GOAL_KEYS = [
    "id",
    "goalType",
    "title",
    "targetAmount",
    "targetDate",
    "horizon",
    "createdAt",
    "updatedAt",
]


def test_situation_get_and_put(auth_client, other_auth_client):
    assert auth_client.get("/api/allocation/situation").json() == {"situation": None}
    saved = put_situation(auth_client, 2_000_000)
    assert list(saved) == [
        "monthlyExpense",
        "dependents",
        "consumerDebt",
        "emergencyMonths",
        "emergencyTarget",
        "updatedAt",
    ]
    assert (saved["emergencyMonths"], saved["emergencyTarget"]) == (3, 6_000_000)
    assert saved["updatedAt"].endswith("Z")
    assert auth_client.get("/api/allocation/situation").json() == {"situation": saved}

    updated = put_situation(auth_client, 3_000_000, dependents=1, consumer_debt=5_000_000)
    assert (updated["emergencyMonths"], updated["emergencyTarget"]) == (6, 18_000_000)
    assert updated["consumerDebt"] == 5_000_000
    assert other_auth_client.get("/api/allocation/situation").json() == {"situation": None}


def test_situation_defaults(auth_client):
    response = auth_client.put("/api/allocation/situation", json={"monthlyExpense": 0})
    assert response.status_code == 200
    assert (response.json()["dependents"], response.json()["consumerDebt"]) == (0, 0)


@pytest.mark.parametrize(
    "income,dependents,months",
    [(3, 0, 3), (4, 0, 3), (1, 0, 6), (2, 0, 6), (3, 1, 6), (None, 0, 3), (None, 2, 6)],
)
def test_emergency_months_from_latest_assessment(auth_client, income, dependents, months):
    if income is not None:
        assess(auth_client, income=income)
    saved = put_situation(auth_client, 1_000_000, dependents=dependents)
    assert saved["emergencyMonths"] == months
    assert saved["emergencyTarget"] == 1_000_000 * months
    body = auth_client.get("/api/allocation/situation").json()["situation"]
    assert body["emergencyMonths"] == months


def test_emergency_months_follow_new_assessment(auth_client):
    assess(auth_client, income=3)
    assert put_situation(auth_client, 1_000_000)["emergencyMonths"] == 3
    assess(auth_client, income=1)
    assert auth_client.get("/api/allocation/situation").json()["situation"]["emergencyMonths"] == 6


@pytest.mark.parametrize(
    "payload,field",
    [
        ({"monthlyExpense": -1}, "monthlyExpense"),
        ({"monthlyExpense": 100_000_001}, "monthlyExpense"),
        ({"monthlyExpense": 1_000_000, "dependents": 11}, "dependents"),
        ({"monthlyExpense": 1_000_000, "dependents": -1}, "dependents"),
        ({"monthlyExpense": 1_000_000, "consumerDebt": 1_000_000_000_001}, "consumerDebt"),
        ({"monthlyExpense": "100"}, "monthlyExpense"),
        ({}, "monthlyExpense"),
    ],
)
def test_situation_validation(auth_client, payload, field):
    response = auth_client.put("/api/allocation/situation", json=payload)
    assert response.status_code == 422
    assert [item[0] for item in error_fields(response)] == [field]
    assert auth_client.get("/api/allocation/situation").json() == {"situation": None}


def test_situation_limits_accepted(auth_client):
    saved = put_situation(auth_client, 100_000_000, dependents=10, consumer_debt=1_000_000_000_000)
    assert saved["emergencyTarget"] == 600_000_000


@freeze_time(TODAY, tick=True)
def test_goal_crud(auth_client):
    assert auth_client.get("/api/allocation/goals").json() == {"items": []}
    response = auth_client.post(
        "/api/allocation/goals",
        json={
            "goalType": "home",
            "title": "  우리 집  ",
            "targetAmount": 20_000_000,
            "targetDate": "2028-10-16",
        },
    )
    assert response.status_code == 201
    goal = response.json()
    assert list(goal) == GOAL_KEYS
    assert (goal["title"], goal["horizon"]) == ("우리 집", "within_3y")

    patched = auth_client.patch(
        f"/api/allocation/goals/{goal['id']}",
        json={"targetAmount": 30_000_000, "targetDate": "2027-01-31"},
    )
    assert patched.status_code == 200
    assert patched.json()["targetAmount"] == 30_000_000
    assert patched.json()["horizon"] == "within_1y"
    assert patched.json()["title"] == "우리 집"

    renamed = auth_client.patch(
        f"/api/allocation/goals/{goal['id']}", json={"goalType": "car", "title": "   "}
    )
    assert renamed.json()["goalType"] == "car"
    assert renamed.json()["title"] == "차량 구입"

    nulled = auth_client.patch(
        f"/api/allocation/goals/{goal['id']}", json={"goalType": "education", "title": None}
    )
    assert nulled.json()["title"] == "자녀 교육"

    kept = auth_client.patch(f"/api/allocation/goals/{goal['id']}", json={"goalType": "other"})
    assert kept.json()["title"] == "자녀 교육"

    deleted = auth_client.request("DELETE", f"/api/allocation/goals/{goal['id']}", headers=JSON)
    assert deleted.status_code == 204
    assert auth_client.get("/api/allocation/goals").json() == {"items": []}


@freeze_time(TODAY, tick=True)
@pytest.mark.parametrize(
    "goal_type,label",
    [
        ("retirement", "노후 준비"),
        ("home", "내 집 마련"),
        ("education", "자녀 교육"),
        ("marriage", "결혼 자금"),
        ("car", "차량 구입"),
        ("lump_sum", "목돈 마련"),
        ("other", "기타 목표"),
    ],
)
def test_goal_default_titles(auth_client, goal_type, label):
    assert add_goal(auth_client, goal_type, 1, "2030-01-01")["title"] == label
    assert add_goal(auth_client, goal_type, 1, "2030-01-01", title="")["title"] == label


@freeze_time(TODAY, tick=True)
def test_goal_list_order(auth_client):
    later = add_goal(auth_client, "car", 1, "2027-03-01", title="두 번째")
    earlier = add_goal(auth_client, "car", 1, "2027-03-01", title="첫 번째")
    first = add_goal(auth_client, "home", 1, "2027-01-01", title="날짜 먼저")
    items = auth_client.get("/api/allocation/goals").json()["items"]
    assert [item["id"] for item in items] == [first["id"], later["id"], earlier["id"]]


@freeze_time(TODAY, tick=True)
@pytest.mark.parametrize(
    "target,horizon",
    [
        ("2026-10-17", "within_1y"),
        ("2027-10-16", "within_1y"),
        ("2027-10-17", "within_3y"),
        ("2029-10-16", "within_3y"),
        ("2029-10-17", "long_term"),
        ("2076-10-16", "long_term"),
    ],
)
def test_goal_horizon_boundaries(auth_client, target, horizon):
    assert add_goal(auth_client, "lump_sum", 1_000_000, target)["horizon"] == horizon


def test_goal_horizon_follows_today(auth_client):
    with freeze_time(TODAY, tick=True):
        goal = add_goal(auth_client, "car", 1_000_000, "2029-10-17")
        assert goal["horizon"] == "long_term"
    with freeze_time("2026-10-17T03:00:00Z", tick=True):
        items = auth_client.get("/api/allocation/goals").json()["items"]
        assert items[0]["horizon"] == "within_3y"


DATE_MESSAGE = "목표일은 내일부터 50년 안으로 골라 주세요."


@freeze_time(TODAY, tick=True)
@pytest.mark.parametrize(
    "payload,field,message",
    [
        ({"targetDate": "2026-10-16"}, "targetDate", DATE_MESSAGE),
        ({"targetDate": "2026-01-01"}, "targetDate", DATE_MESSAGE),
        ({"targetDate": "2076-10-17"}, "targetDate", DATE_MESSAGE),
        ({"targetDate": "2026-13-01"}, "targetDate", "형식이 올바르지 않습니다."),
        ({"targetAmount": 0}, "targetAmount", "허용 범위를 벗어났습니다."),
        ({"targetAmount": 1_000_000_000_001}, "targetAmount", "허용 범위를 벗어났습니다."),
        ({"targetAmount": "100"}, "targetAmount", "형식이 올바르지 않습니다."),
        ({"title": "가" * 31}, "title", "이름은 30자 이내로 입력해 주세요."),
        ({"goalType": "travel"}, "goalType", "형식이 올바르지 않습니다."),
    ],
)
def test_goal_validation(auth_client, payload, field, message):
    body = {"goalType": "home", "targetAmount": 1_000_000, "targetDate": "2028-01-01", **payload}
    response = auth_client.post("/api/allocation/goals", json=body)
    assert response.status_code == 422
    assert error_fields(response) == [(field, message)]
    goal = add_goal(auth_client, "home", 1_000_000, "2028-01-01")
    response = auth_client.patch(f"/api/allocation/goals/{goal['id']}", json=payload)
    assert response.status_code == 422
    assert error_fields(response) == [(field, message)]


@freeze_time(TODAY, tick=True)
def test_goal_limits_accepted(auth_client):
    goal = add_goal(auth_client, "other", 1_000_000_000_000, "2076-10-16", title="가" * 30)
    assert goal["targetAmount"] == 1_000_000_000_000
    assert goal["title"] == "가" * 30


@freeze_time("2028-02-29T03:00:00Z", tick=True)
def test_goal_date_limit_on_leap_day(app):
    from tests.allocation.helpers import signup

    with signup(app, "leap@example.com", birth_year=1994) as client:
        assert add_goal(client, "home", 1, "2078-02-28")["horizon"] == "long_term"
        response = client.post(
            "/api/allocation/goals",
            json={"goalType": "home", "targetAmount": 1, "targetDate": "2078-03-01"},
        )
        assert response.status_code == 422
        assert add_goal(client, "car", 1, "2029-02-28")["horizon"] == "within_1y"
        assert add_goal(client, "car", 1, "2029-03-01")["horizon"] == "within_3y"


@freeze_time(TODAY, tick=True)
def test_eleventh_goal_rejected(auth_client):
    for index in range(10):
        add_goal(auth_client, "other", 1_000 + index, "2030-01-01")
    response = auth_client.post(
        "/api/allocation/goals",
        json={"goalType": "car", "targetAmount": 1_000, "targetDate": "2030-01-01"},
    )
    assert response.status_code == 422
    assert error_fields(response) == [("goals", "목표는 10개까지 만들 수 있어요.")]
    assert len(auth_client.get("/api/allocation/goals").json()["items"]) == 10


@freeze_time(TODAY, tick=True)
def test_goal_other_user_404(auth_client, other_auth_client):
    goal = add_goal(auth_client, "home", 1_000_000, "2028-01-01")
    path = f"/api/allocation/goals/{goal['id']}"
    for response in [
        other_auth_client.patch(path, json={"targetAmount": 1}),
        other_auth_client.request("DELETE", path, headers=JSON),
        auth_client.patch(f"/api/allocation/goals/{uuid4()}", json={"targetAmount": 1}),
        auth_client.request("DELETE", f"/api/allocation/goals/{uuid4()}", headers=JSON),
    ]:
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOT_FOUND"
    assert other_auth_client.get("/api/allocation/goals").json() == {"items": []}
    assert auth_client.get("/api/allocation/goals").json()["items"][0]["targetAmount"] == 1_000_000
    # 다른 사용자의 목표 10개는 내 개수에 들어가지 않는다
    for _ in range(10):
        add_goal(other_auth_client, "car", 1, "2030-01-01")
    assert add_goal(auth_client, "car", 1, "2030-01-01")["goalType"] == "car"
