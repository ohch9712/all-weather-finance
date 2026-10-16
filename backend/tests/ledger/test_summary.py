from datetime import date
from uuid import UUID

import pytest
from freezegun import freeze_time

from app.modules.ledger.service import MonthlySummary, get_monthly_summary
from tests.ledger.helpers import add_entry, category_ids, error_of


def seed(client):
    """스펙 03 5.3 예시 값: 10월 수입 350만·지출 182만, 9월 지출 201만"""
    # 10월 지출 1,820,000
    add_entry(client, "주거·관리비", occurredOn="2026-10-01", amount=800_000, merchant="관리사무소")
    add_entry(client, "교통", occurredOn="2026-10-01", amount=100_000)  # 사용처 없음
    for day in range(2, 10):
        add_entry(client, occurredOn=f"2026-10-0{day}", amount=12_000, merchant="김밥천국")
    add_entry(client, occurredOn="2026-10-31", amount=300_000, merchant="마트")
    add_entry(client, occurredOn="2026-10-20", amount=100_000, merchant="빵집")
    add_entry(client, occurredOn="2026-10-11", amount=12_000, merchant="편의점")
    add_entry(client, occurredOn="2026-10-12", amount=12_000, merchant="편의점")
    add_entry(client, "쇼핑", occurredOn="2026-10-15", amount=200_000, merchant="쿠팡")
    add_entry(client, "쇼핑", occurredOn="2026-10-16", amount=200_000, merchant="쿠팡")
    # 10월 수입 3,500,000(수입의 사용처는 상위 사용처에 넣지 않는다)
    add_entry(client, kind="income", occurredOn="2026-10-25", amount=3_000_000, merchant="회사")
    add_entry(client, "상여", kind="income", occurredOn="2026-10-25", amount=500_000)
    # 9월(전월): 수입 3,500,000, 지출 2,010,000
    add_entry(client, kind="income", occurredOn="2026-09-25", amount=3_000_000)
    add_entry(client, "상여", kind="income", occurredOn="2026-09-01", amount=500_000)
    add_entry(client, occurredOn="2026-09-30", amount=2_010_000, merchant="마트")
    # 범위 밖
    add_entry(client, occurredOn="2026-11-01", amount=999_000, merchant="관리사무소")
    add_entry(client, kind="income", occurredOn="2026-08-31", amount=1_000)


def summary(client, month: str) -> dict:
    response = client.get(f"/api/ledger/summary?month={month}")
    assert response.status_code == 200, response.text
    return response.json()


def test_monthly_summary(auth_client, other_auth_client):
    seed(auth_client)
    add_entry(other_auth_client, occurredOn="2026-10-10", amount=55_555, merchant="김밥천국")
    ids = category_ids(auth_client)
    result = summary(auth_client, "2026-10")

    assert {k: result[k] for k in ("month", "incomeTotal", "expenseTotal", "net")} == {
        "month": "2026-10",
        "incomeTotal": 3_500_000,
        "expenseTotal": 1_820_000,
        "net": 1_680_000,
    }
    assert result["previous"] == {
        "month": "2026-09",
        "incomeTotal": 3_500_000,
        "expenseTotal": 2_010_000,
    }
    assert result["expenseChangeRate"] == -9.45

    assert result["byCategory"] == [
        {
            "categoryId": ids[("expense", name)],
            "name": name,
            "kind": "expense",
            "amount": amount,
            "ratio": ratio,
        }
        for name, amount, ratio in [
            ("주거·관리비", 800_000, 43.96),
            ("식비", 520_000, 28.57),
            ("쇼핑", 400_000, 21.98),
            ("교통", 100_000, 5.49),
        ]
    ] + [
        {
            "categoryId": ids[("income", name)],
            "name": name,
            "kind": "income",
            "amount": amount,
            "ratio": ratio,
        }
        for name, amount, ratio in [("급여", 3_000_000, 85.71), ("상여", 500_000, 14.29)]
    ]

    daily = result["daily"]
    assert len(daily) == 31
    assert daily[0] == {"date": "2026-10-01", "income": 0, "expense": 900_000}
    assert daily[1] == {"date": "2026-10-02", "income": 0, "expense": 12_000}
    assert daily[24] == {"date": "2026-10-25", "income": 3_500_000, "expense": 0}
    assert daily[29] == {"date": "2026-10-30", "income": 0, "expense": 0}
    assert daily[30] == {"date": "2026-10-31", "income": 0, "expense": 300_000}
    assert sum(d["expense"] for d in daily) == 1_820_000

    assert result["topMerchants"] == [
        {"merchant": "관리사무소", "amount": 800_000, "count": 1},
        {"merchant": "쿠팡", "amount": 400_000, "count": 2},
        {"merchant": "마트", "amount": 300_000, "count": 1},
        {"merchant": "빵집", "amount": 100_000, "count": 1},
        {"merchant": "김밥천국", "amount": 96_000, "count": 8},
    ]


def test_previous_month_without_expense_gives_null_rate(auth_client):
    seed(auth_client)
    result = summary(auth_client, "2026-09")
    assert (result["incomeTotal"], result["expenseTotal"], result["net"]) == (
        3_500_000,
        2_010_000,
        1_490_000,
    )
    # 8월은 수입만 있다.
    assert result["previous"] == {"month": "2026-08", "incomeTotal": 1_000, "expenseTotal": 0}
    assert result["expenseChangeRate"] is None
    assert len(result["daily"]) == 30


def test_summary_of_next_month_and_increase_rate(auth_client):
    seed(auth_client)
    result = summary(auth_client, "2026-11")
    # (999,000 − 1,820,000) ÷ 1,820,000 × 100 = −45.1098…
    assert result["expenseChangeRate"] == -45.11
    assert result["previous"]["expenseTotal"] == 1_820_000
    add_entry(auth_client, occurredOn="2026-11-30", amount=1_000_000)
    # (1,999,000 − 1,820,000) ÷ 1,820,000 × 100 = 9.835…
    assert summary(auth_client, "2026-11")["expenseChangeRate"] == 9.84


def test_empty_month_and_february(auth_client):
    result = summary(auth_client, "2026-02")
    assert result == {
        "month": "2026-02",
        "incomeTotal": 0,
        "expenseTotal": 0,
        "net": 0,
        "previous": {"month": "2026-01", "incomeTotal": 0, "expenseTotal": 0},
        "expenseChangeRate": None,
        "byCategory": [],
        "daily": [
            {"date": f"2026-02-{day:02d}", "income": 0, "expense": 0} for day in range(1, 29)
        ],
        "topMerchants": [],
    }
    assert len(summary(auth_client, "2028-02")["daily"]) == 29
    assert summary(auth_client, "2026-01")["previous"]["month"] == "2025-12"


def test_negative_net(auth_client):
    add_entry(auth_client, occurredOn="2026-10-05", amount=50_000)
    add_entry(auth_client, kind="income", occurredOn="2026-10-06", amount=20_000)
    assert summary(auth_client, "2026-10")["net"] == -30_000


def test_summary_defaults_and_validation(auth_client):
    add_entry(auth_client, occurredOn="2026-09-15", amount=1_000)
    with freeze_time("2026-09-20T00:00:00Z"):
        assert auth_client.get("/api/ledger/summary").json()["month"] == "2026-09"
        assert auth_client.get("/api/ledger/summary?month=").json()["expenseTotal"] == 1_000
    error = error_of(auth_client.get("/api/ledger/summary?month=2026-00"), 422)
    assert error["details"][0]["field"] == "month"


def test_get_monthly_summary_service(db, auth_client):
    seed(auth_client)
    user_id = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    result = get_monthly_summary(db, user_id, date(2026, 10, 1))
    assert isinstance(result, MonthlySummary)
    assert result.model_dump(by_alias=True, mode="json") == summary(auth_client, "2026-10")
    # 그 달의 다른 날을 넘겨도 그 달로 본다.
    assert get_monthly_summary(db, user_id, date(2026, 10, 17)) == result


# ── 추이 ────────────────────────────────────────────────────────────


@freeze_time("2026-10-16T03:00:00Z")
def test_trend(auth_client, other_auth_client):
    seed(auth_client)
    add_entry(other_auth_client, occurredOn="2026-10-10", amount=55_555)
    response = auth_client.get("/api/ledger/trend?months=3")
    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {"month": "2026-08", "incomeTotal": 1_000, "expenseTotal": 0},
            {"month": "2026-09", "incomeTotal": 3_500_000, "expenseTotal": 2_010_000},
            {"month": "2026-10", "incomeTotal": 3_500_000, "expenseTotal": 1_820_000},
        ]
    }
    items = auth_client.get("/api/ledger/trend").json()["items"]
    assert [i["month"] for i in items] == [
        "2026-05",
        "2026-06",
        "2026-07",
        "2026-08",
        "2026-09",
        "2026-10",
    ]
    assert items[0] == {"month": "2026-05", "incomeTotal": 0, "expenseTotal": 0}
    assert len(auth_client.get("/api/ledger/trend?months=24").json()["items"]) == 24
    assert len(auth_client.get("/api/ledger/trend?months=1").json()["items"]) == 1


@freeze_time("2026-02-10T00:00:00Z")
def test_trend_crosses_year(auth_client):
    months = [i["month"] for i in auth_client.get("/api/ledger/trend?months=3").json()["items"]]
    assert months == ["2025-12", "2026-01", "2026-02"]


@pytest.mark.parametrize("query", ["months=0", "months=25", "months=abc"])
def test_trend_validation(auth_client, query):
    error = error_of(auth_client.get(f"/api/ledger/trend?{query}"), 422)
    assert error["details"][0]["field"] == "months"
