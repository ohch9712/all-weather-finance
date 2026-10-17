from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from freezegun import freeze_time

from app.modules.estate import service

BASE = "/api/estate"


def create_member(client, **kwargs):
    result = client.post(
        f"{BASE}/members",
        json={"relation": "child", "displayName": "첫째", "birthDate": "1994-07-15", **kwargs},
    )
    assert result.status_code == 201, result.text
    return result.json()


@freeze_time("2026-10-16T03:00:00Z")
def test_member_gift_crud_replay_and_cascade(auth_client, other_auth_client):
    member = create_member(auth_client, birthDate="2010-03-01")
    assert (member["age"], member["isMinor"]) == (16, True)
    assert (
        auth_client.patch(f"{BASE}/members/{member['id']}", json={"displayName": "별칭"}).json()[
            "displayName"
        ]
        == "별칭"
    )
    gifts = []
    for day, group, amount in [
        ("2016-05-01", "parents", 20_000_000),
        ("2024-02-01", "grandparents", 10_000_000),
    ]:
        response = auth_client.post(
            f"{BASE}/gifts",
            json={
                "recipientId": member["id"],
                "giftedOn": day,
                "donorGroup": group,
                "amount": amount,
            },
        )
        assert response.status_code == 201, response.text
        gifts.append(response.json())
    assert gifts[1]["computedDeduction"] == 0
    assert gifts[1]["estimatedTax"] == 1_261_000
    assert (
        auth_client.get(f"{BASE}/members/{member['id']}/deductions?asOf=2026-10-16").json()[
            "pools"
        ][0]["available"]
        == 20_000_000
    )
    for method, path, payload in [
        ("get", f"/members/{member['id']}/deductions", None),
        ("patch", f"/members/{member['id']}", {"displayName": "도용"}),
        ("delete", f"/members/{member['id']}", None),
        ("get", f"/gifts?recipientId={member['id']}", None),
        ("patch", f"/gifts/{gifts[0]['id']}", {"amount": 1}),
        ("delete", f"/gifts/{gifts[0]['id']}", None),
        (
            "post",
            "/gifts",
            {
                "recipientId": member["id"],
                "giftedOn": "2025-01-01",
                "donorGroup": "parents",
                "amount": 1,
            },
        ),
        (
            "post",
            "/calc/gift-tax",
            {"memberId": member["id"], "giftedOn": "2026-10-16", "amount": 1},
        ),
        ("post", "/simulate/gift-plan", {"memberId": member["id"]}),
    ]:
        response = other_auth_client.request(
            method, BASE + path, json=payload, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 404, response.text
        assert response.json()["error"]["code"] == "NOT_FOUND"
    assert other_auth_client.get(f"{BASE}/members").json() == {"items": []}
    assert (
        auth_client.patch(
            f"{BASE}/gifts/{gifts[0]['id']}",
            json={"amount": 10_000_000, "taxPaid": 12, "filed": True},
        ).status_code
        == 200
    )
    assert (
        auth_client.delete(
            f"{BASE}/gifts/{gifts[1]['id']}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert (
        auth_client.delete(
            f"{BASE}/members/{member['id']}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.get(f"{BASE}/gifts").json() == {"items": []}


@freeze_time("2026-10-16T03:00:00Z")
def test_validation_and_calculators(auth_client, client):
    assert client.get(f"{BASE}/rules").status_code == 401
    assert (
        auth_client.post(
            f"{BASE}/members", json={"relation": "child", "displayName": "자녀"}
        ).json()["error"]["details"][0]["field"]
        == "birthDate"
    )
    member = create_member(auth_client)
    for patch, field in [
        ({"donorGroup": "spouse"}, "donorGroup"),
        ({"giftedOn": "2027-01-01"}, "giftedOn"),
        ({"giftedOn": "1990-01-01"}, "giftedOn"),
        ({"amount": 1_000_000_000_001}, "amount"),
    ]:
        response = auth_client.post(
            f"{BASE}/gifts",
            json={
                "recipientId": member["id"],
                "giftedOn": "2026-10-16",
                "donorGroup": "parents",
                "amount": 100_000_000,
                **patch,
            },
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"][0]["field"] == field
    gift_tax = auth_client.post(
        f"{BASE}/calc/gift-tax",
        json={
            "memberId": member["id"],
            "donorGroup": "parents",
            "giftedOn": "2026-10-16",
            "amount": 100_000_000,
        },
    )
    assert gift_tax.status_code == 200, gift_tax.text
    assert gift_tax.json()["payableTax"] == 4_850_000
    assert (
        auth_client.post(f"{BASE}/calc/inheritance-tax", json={}).json()["error"]["details"][0][
            "field"
        ]
        == "children"
    )
    plan = auth_client.post(
        f"{BASE}/simulate/gift-plan",
        json={"birthDate": "2026-01-01", "startDate": "2026-10-16", "annualReturnRate": "5"},
    )
    assert plan.status_code == 200, plan.text
    assert plan.json()["totalGifted"] == 140_000_000
    rules = auth_client.get(f"{BASE}/rules").json()
    assert rules["brackets"][0]["rate"] == "0.10"


@freeze_time("2026-10-16T03:00:00Z")
def test_prefill_actual_allocation_and_compare(auth_client, db):
    # 실제 공개 함수를 경유하도록 자산도 API로 입력한다.
    for asset_class, amount, include in [
        ("stock", 100_000_000, True),
        ("cash", 200_000_000, True),
        ("other", 30_000_000, True),
        ("other", 500_000_000, False),
    ]:
        response = auth_client.post(
            "/api/allocation/holdings",
            json={
                "name": "자산",
                "assetClass": asset_class,
                "amount": amount,
                "includeInAllocation": include,
            },
        )
        assert response.status_code == 201, response.text
    create_member(auth_client)
    prefill = auth_client.get(f"{BASE}/inheritance/prefill").json()
    assert prefill["assets"] == {
        "financialAssets": 300_000_000,
        "realEstate": 500_000_000,
        "otherAssets": 30_000_000,
    }
    response = auth_client.post(
        f"{BASE}/compare",
        json={"horizonYears": 5, "annualGrowthRate": "0", "lumpSumPerChild": 100_000_000},
    )
    assert response.status_code == 200, response.text
    assert response.json()["recommendedKey"] == "inherit_only"
    user_id = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    resolved = service.build_compare_input(
        db,
        user_id,
        base_date=date(2026, 10, 16),
        horizon_years=5,
        growth_rate=Decimal("0"),
        lump_sum_per_child=100_000_000,
    )
    assert resolved.assets.financial_assets == 300_000_000


@pytest.mark.parametrize("kind", ["missing", "attribute"])
def test_prefill_fallback(auth_client, monkeypatch, kind):
    from app.modules.allocation import service as allocation

    if kind == "missing":
        monkeypatch.delattr(allocation, "get_asset_breakdown")
    else:
        monkeypatch.setattr(allocation, "get_asset_breakdown", lambda *args: object())
    create_member(auth_client)
    assert auth_client.get(f"{BASE}/inheritance/prefill").json()["assets"] is None
    response = auth_client.post(f"{BASE}/compare", json={})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0] == {
        "field": "assets",
        "message": "재산 금액을 입력해 주세요.",
    }


@freeze_time("2026-10-16T03:00:00Z")
def test_pre_effective_calculation_and_null_patch_are_field_errors(auth_client):
    member = create_member(auth_client)
    response = auth_client.post(
        f"{BASE}/calc/gift-tax",
        json={
            "memberId": member["id"],
            "giftedOn": "2023-12-31",
            "amount": 100000000,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"] == [
        {
            "field": "giftedOn",
            "message": "2024년 1월 1일 이후 증여만 계산할 수 있어요.",
        }
    ]
    response = auth_client.patch(f"{BASE}/members/{member['id']}", json={"relation": None})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "relation"


@pytest.mark.parametrize(
    "non_heir_gifts, taxable_value, payable_tax",
    [(0, 895_000_000, 50_585_500), (20_000_000, 915_000_000, 54_465_500)],
)
def test_inheritance_request_uses_lowercase_year_aliases(
    auth_client, non_heir_gifts, taxable_value, payable_tax
):
    response = auth_client.post(
        f"{BASE}/calc/inheritance-tax",
        json={
            "financialAssets": 300_000_000,
            "realEstate": 500_000_000,
            "spouseAlive": False,
            "children": [{"age": 35}],
            "priorGiftsToHeirs10y": 100_000_000,
            "priorGiftsToNonHeirs5y": non_heir_gifts,
            "priorGiftDeductions": 50_000_000,
            "priorGiftTaxPaid": 4_850_000,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["taxableValue"] == taxable_value
    assert response.json()["payableTax"] == payable_tax


@freeze_time("2026-10-16T03:00:00Z")
def test_deductions_and_prefill_json_keys_preserve_lowercase_years(auth_client):
    child = create_member(auth_client)
    grandchild = create_member(
        auth_client, relation="grandchild", displayName="손주", birthDate="2020-05-05"
    )
    for member, group, amount, paid in [
        (child, "parents", 100_000_000, 4_850_000),
        (grandchild, "grandparents", 20_000_000, 0),
    ]:
        response = auth_client.post(
            f"{BASE}/gifts",
            json={
                "recipientId": member["id"],
                "giftedOn": "2026-09-01",
                "donorGroup": group,
                "amount": amount,
                "taxPaid": paid,
            },
        )
        assert response.status_code == 201, response.text
    response = auth_client.get(f"{BASE}/members/{child['id']}/deductions?asOf=2026-10-16")
    assert response.status_code == 200, response.text
    pool = response.json()["pools"][0]
    assert set(pool) == {"category", "limit", "usedWithin10y", "available", "nextResetOn"}
    assert pool["usedWithin10y"] == 50_000_000
    assert pool["available"] == 0

    response = auth_client.get(f"{BASE}/inheritance/prefill")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "priorGiftsToHeirs10Y" not in payload
    assert "priorGiftsToNonHeirs5Y" not in payload
    assert payload["priorGiftsToHeirs10y"] == 100_000_000
    assert payload["priorGiftsToNonHeirs5y"] == 20_000_000
    assert payload["priorGiftDeductions"] == 70_000_000
    assert payload["priorGiftTaxPaid"] == 4_850_000
