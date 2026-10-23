"""스펙 22 8절 API 계약, 저장·민감정보 동의, 사용자 격리."""

import json
import logging

import pytest
from freezegun import freeze_time
from sqlalchemy import select

from app.core.crypto import decrypt_str
from app.modules.succession.models import SuccessionCase
from tests.succession.cases import CASE_A, CASE_B, CASE_D, case

BASE = "/api/succession"


def detail(response) -> tuple[str, str]:
    body = response.json()["error"]
    assert (response.status_code, body["code"]) == (422, "VALIDATION_ERROR"), response.text
    return body["details"][0]["field"], body["details"][0]["message"]


def delete(client, path: str):
    return client.delete(f"{BASE}{path}", headers={"content-type": "application/json"})


def stored(db, client) -> SuccessionCase:
    user_id = client.get("/api/auth/me").json()["user"]["id"]
    db.expire_all()
    return db.scalar(select(SuccessionCase).where(SuccessionCase.user_id == user_id))


def test_requires_login(client):
    assert client.get(f"{BASE}/case").status_code == 401
    assert client.post(f"{BASE}/plans", json=CASE_A).status_code == 401


def test_plans_contract_case_a(auth_client):
    response = auth_client.post(f"{BASE}/plans", json=CASE_A)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "baseDate",
        "horizonDate",
        "spouseAliveAtHorizon",
        "ruleVersion",
        "parents",
        "funding",
        "assignments",
        "plans",
        "excluded",
        "notes",
        "assumptions",
        "sources",
    }
    assert (body["baseDate"], body["horizonDate"], body["ruleVersion"]) == (
        "2026-10-21",
        "2038-10-21",
        "KR-2026.05.10",
    )
    assert body["parents"][0] == {
        "role": "father",
        "age": 75,
        "tableLifeExpectancy": "12.0",
        "healthFactor": "1.0",
        "lifeExpectancy": "12.0",
        "yearsAssumed": 12,
        "expectedUntil": "2038-10-21",
        "careFrom": "2036-10-21",
        "isOwner": True,
    }
    funding = body["funding"]
    assert set(funding) == {
        "costs",
        "survivorNeed",
        "reservePresentValue",
        "cashAssets",
        "transferableNow",
        "shortfall",
        "singleFrom",
    }
    assert funding["singleFrom"] == "2038-10-21"
    assert funding["costs"][0] == {
        "year": 0,
        "on": "2026-10-21",
        "living": 36_000_000,
        "care": 0,
        "income": 12_000_000,
        "total": 24_000_000,
    }
    assert body["assignments"][0] == {"assetId": "a2", "childId": "c2"}
    best = body["plans"][0]
    assert set(best) == {
        "key",
        "label",
        "rank",
        "tier",
        "transfers",
        "sales",
        "inheritance",
        "taxes",
        "parentsRemainingNow",
        "parentsReserve",
        "childrenReceiveAtHorizon",
        "childImpacts",
        "reasons",
    }
    assert [(p["key"], p["tier"]) for p in body["plans"][:4]] == [
        ("realestate_gift_cash_staged", "best"),
        ("realestate_gift_now", "runner_up"),
        ("cash_lump_now", "runner_up"),
        ("realestate_sell_cash_now", "other"),
    ]
    assert best["reasons"][0] == (
        "상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(907,861,575원)."
    )
    assert (best["key"], best["rank"], best["tier"], best["sales"]) == (
        "realestate_gift_cash_staged",
        1,
        "best",
        [],
    )
    assert best["label"] == "부동산 증여 + 현금 10년 공제 한도 증여"
    assert best["transfers"][0] == {
        "on": "2026-10-21",
        "method": "gift",
        "childId": "c1",
        "assetId": "a3",
        "assetLabel": "임대 아파트",
        "assetKind": "house",
        "amount": 700_000_000,
        "giftTax": 162_960_000,
        "acquisitionTax": 86_800_000,
        "acquisitionTaxCode": "gift_heavy",
    }
    assert set(best["inheritance"]) == {
        "on",
        "financialAssets",
        "realEstate",
        "debts",
        "spouseShare",
        "priorGiftsAdded",
        "taxableValue",
        "appliedDeduction",
        "taxBase",
        "payableTax",
    }
    assert best["taxes"] == {
        "giftTax": 232_800_000,
        "acquisitionTax": 113_175_161,
        "capitalGainsTax": 0,
        "inheritanceTax": 420_589_229,
        "total": 766_564_390,
        "totalAtHorizon": 907_861_575,
    }
    impact = best["childImpacts"][0]
    assert set(impact) == {"childId", "houseCountBefore", "houseCountAfter", "flags"}
    assert set(impact["flags"][0]) == {"code", "message"}
    sale_plan = next(p for p in body["plans"] if p["key"] == "realestate_sell_cash_now")
    assert sale_plan["sales"][0] == {
        "assetId": "a3",
        "label": "임대 아파트",
        "price": 700_000_000,
        "acquisitionCost": 400_000_000,
        "holdingYears": 11,
        "case": "heavy_20",
        "gain": 300_000_000,
        "taxableGain": 300_000_000,
        "longTermDeduction": 0,
        "taxBase": 297_500_000,
        "incomeTax": 152_610_000,
        "localIncomeTax": 15_261_000,
        "total": 167_871_000,
        "netProceeds": 332_129_000,
    }
    assert body["excluded"] == []
    assert set(body["sources"][0]) == {"label", "url"}


def test_plans_case_d_survivor_ratios(auth_client):
    body = auth_client.post(f"{BASE}/plans", json=CASE_D).json()
    funding = body["funding"]
    assert (funding["singleFrom"], funding["reservePresentValue"]) == ("2038-10-21", 461_576_150)
    assert funding["costs"][12] == {
        "year": 12,
        "on": "2038-10-21",
        "living": 27_850_588,
        "care": 0,
        "income": 9_131_340,
        "total": 18_719_248,
    }
    assert body["notes"][1] == "재산은 연 3%, 생활비·수입·간병비는 연 2%씩 늘어난다고 가정했어요."
    assert (
        "월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 "
        "월 생활비를 61%, 월 수입을 60%로 계산해요."
    ) in body["assumptions"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("survivorLivingRatio", "9.99"),
        ("survivorLivingRatio", "101"),
        ("survivorLivingRatio", "61.005"),
        ("survivorIncomeRatio", "-0.01"),
        ("survivorIncomeRatio", "100.01"),
    ],
)
def test_survivor_ratio_out_of_range_422(auth_client, field, value):
    data = case(CASE_A, assumptions={**CASE_A["assumptions"], field: value})
    # 공통 422 형식(architecture 4.1)은 위치의 마지막 키를 field로 쓴다.
    assert detail(auth_client.post(f"{BASE}/plans", json=data))[0] == field
    response = auth_client.put(f"{BASE}/case", json={"case": data, "sensitiveConsent": False})
    assert detail(response)[0] == field


def test_plans_case_b_and_default_base_date(auth_client):
    body = auth_client.post(f"{BASE}/plans", json=CASE_B).json()
    assert body["funding"]["shortfall"] == 92_000_000
    assert body["funding"]["singleFrom"] is None
    assert [p["key"] for p in body["plans"]] == ["inherit_only"]
    assert body["plans"][0]["taxes"]["totalAtHorizon"] == body["plans"][0]["taxes"]["total"]
    assert body["plans"][0]["taxes"]["totalAtHorizon"] == 10_360_000
    assert len(body["excluded"]) == 6
    assert set(body["excluded"][0]) == {"key", "label", "reason"}
    with freeze_time("2026-10-20T16:00:00Z"):  # KST 2026-10-21 01:00
        body = auth_client.post(f"{BASE}/plans", json=case(CASE_B, baseDate=None)).json()
    assert body["baseDate"] == "2026-10-21"


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        (
            {"parents": [{"role": "father", "alive": False}, {"role": "mother", "alive": False}]},
            "parents",
            "살아 계신 부모님을 한 분 이상 입력해 주세요.",
        ),
        ({"ownerRole": "father"}, "ownerRole", "재산 명의자는 살아 계신 부모님이어야 해요."),
        ({"parentsHouseCount": 0}, "parentsHouseCount", "입력한 주택 수보다 적을 수 없어요."),
        ({"baseDate": "2026-05-09"}, "baseDate", "2026년 5월 10일 이후 기준일만 계산할 수 있어요."),
    ],
)
def test_validation_422(auth_client, changes, field, message):
    response = auth_client.post(f"{BASE}/plans", json=case(CASE_B, **changes))
    assert detail(response) == (field, message)


def test_validation_422_children_and_format(auth_client):
    two_selves = case(CASE_B)
    two_selves["children"][1]["isSelf"] = True
    assert detail(auth_client.post(f"{BASE}/plans", json=two_selves)) == (
        "children",
        "본인은 한 명만 고를 수 있어요.",
    )
    young = case(CASE_A)
    young["parents"][0]["age"] = 39
    assert detail(auth_client.post(f"{BASE}/plans", json=young))[0] == "parents.0.age"
    future = case(CASE_A)
    future["children"][0]["pastGifts"][0]["giftedOn"] = "2026-10-22"
    assert detail(auth_client.post(f"{BASE}/plans", json=future))[0] == (
        "children.0.pastGifts.0.giftedOn"
    )
    for broken in [
        case(CASE_A, assets=[]),
        case(CASE_A, ownerRole="uncle"),
        case(CASE_A, monthlyLivingCost="3000000"),
        case(CASE_A, monthlyIncome=100_000_001),
    ]:
        response = auth_client.post(f"{BASE}/plans", json=broken)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    region = case(CASE_A)
    region["assets"][1]["region"] = "도쿄"
    assert auth_client.post(f"{BASE}/plans", json=region).status_code == 422
    child = case(CASE_A)
    child["children"][0]["age"] = 18
    assert detail(auth_client.post(f"{BASE}/plans", json=child))[0] == "age"
    plain = auth_client.post(f"{BASE}/plans", content="x", headers={"content-type": "text/plain"})
    assert plain.status_code == 422


def test_life_expectancy_endpoint(auth_client):
    response = auth_client.get(f"{BASE}/life-expectancy?role=father&age=75&health=normal")
    assert response.json() == {
        "tableLifeExpectancy": "12.0",
        "healthFactor": "1.0",
        "lifeExpectancy": "12.0",
        "yearsAssumed": 12,
        "source": "국가데이터처 2024년 생명표",
    }
    good = auth_client.get(f"{BASE}/life-expectancy?role=mother&age=72&health=good").json()
    assert (good["lifeExpectancy"], good["yearsAssumed"]) == ("19.3", 19)
    assert auth_client.get(f"{BASE}/life-expectancy?role=father&age=63").json()[
        "lifeExpectancy"
    ] == ("21.2")
    for query in ["role=father&age=39", "role=uncle&age=60", "role=mother&age=70&health=bad"]:
        assert auth_client.get(f"{BASE}/life-expectancy?{query}").status_code == 422


def test_rules_endpoint(auth_client):
    body = auth_client.get(f"{BASE}/rules").json()
    assert (body["version"], body["effectiveFrom"]) == ("KR-2026.05.10", "2026-05-10")
    assert body["lifeTable"][0] == {"age": 40, "father": "41.9", "mother": "47.4"}
    assert body["lifeTable"][-1] == {"age": 100, "father": "1.9", "mother": "2.3"}
    assert body["healthFactors"] == {"good": "1.1", "normal": "1.0", "poor": "0.7", "care": "0.4"}
    rates = {rate["code"]: rate for rate in body["acquisitionRates"]}
    assert rates["gift_heavy"]["acquisitionRate"] == "0.12"
    assert rates["inherit_first_home"]["ruralRate"] == "0"
    assert body["capitalGainsBrackets"][-1] == {
        "upTo": None,
        "rate": "0.45",
        "progressiveDeduction": 65_940_000,
    }
    assert body["defaults"] == {
        "annualGrowthRate": "3",
        "costInflationRate": "2",
        "careMonthlyCost": 2_000_000,
        "careYears": 2,
        "officialPriceRatio": "70",
        "survivorLivingRatio": "61",
        "survivorIncomeRatio": "60",
    }
    assert {"label", "url"} == set(body["sources"][0])
    assert {source["label"] for source in body["sources"]} >= {
        "보건복지부, 기준 중위소득",
        "국민연금공단, 유족연금",
    }


@freeze_time("2026-10-21T03:00:00Z")
def test_save_with_consent_encrypts_health(auth_client, db, caplog):
    caplog.set_level(logging.DEBUG)
    assert auth_client.get(f"{BASE}/case").json() == {
        "case": None,
        "sensitiveConsentAt": None,
        "updatedAt": None,
    }
    response = auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sensitiveConsentAt"] == "2026-10-21T03:00:00Z"
    assert [p["health"] for p in body["case"]["parents"]] == ["normal", "good"]
    row = stored(db, auth_client)
    assert [p["health"] for p in row.data["parents"]] == [None, None]
    assert "normal" not in json.dumps(row.data) and "good" not in json.dumps(row.data)
    assert row.health_enc and "normal" not in row.health_enc and "good" not in row.health_enc
    assert json.loads(decrypt_str(row.health_enc)) == {"father": "normal", "mother": "good"}
    assert not any(
        "normal" in record.getMessage() or "good" in record.getMessage()
        for record in caplog.records
    )
    restored = auth_client.get(f"{BASE}/case").json()
    assert restored["case"]["parents"][1]["health"] == "good"
    assert restored["case"]["assets"][1]["acquiredOn"] == "2000-05-01"
    assert restored["case"]["assumptions"]["annualGrowthRate"] == "3"
    assert restored["updatedAt"] == "2026-10-21T03:00:00Z"
    # 다시 동의해 저장해도 처음 동의 시각을 유지한다.
    with freeze_time("2026-10-22T03:00:00Z"):
        again = auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    assert again.json()["sensitiveConsentAt"] == "2026-10-21T03:00:00Z"
    assert again.json()["updatedAt"] == "2026-10-22T03:00:00Z"


@freeze_time("2026-10-21T03:00:00Z")
def test_save_without_consent_and_withdraw(auth_client, db):
    assert delete(auth_client, "/case/sensitive").status_code == 404
    assert delete(auth_client, "/case/sensitive").json()["error"]["code"] == "NOT_FOUND"
    auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    body = auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": False}).json()
    assert body["sensitiveConsentAt"] is None
    assert [p["health"] for p in body["case"]["parents"]] == [None, None]
    row = stored(db, auth_client)
    assert (row.health_enc, row.sensitive_consent_at) == (None, None)
    auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    assert stored(db, auth_client).health_enc is not None
    withdrawn = delete(auth_client, "/case/sensitive")
    assert withdrawn.status_code == 200
    assert withdrawn.json()["sensitiveConsentAt"] is None
    assert withdrawn.json()["case"]["parents"][0]["health"] is None
    row = stored(db, auth_client)
    assert (row.health_enc, row.sensitive_consent_at) == (None, None)
    assert row.data["monthlyLivingCost"] == 3_000_000


def test_saved_case_without_survivor_ratios_uses_defaults(auth_client, db):
    """21절 전에 저장한 입력(두 비율 없음)은 기본값 61·60으로 불러오고 계산한다."""
    auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": False})
    row = stored(db, auth_client)
    legacy = json.loads(json.dumps(row.data))
    del legacy["assumptions"]["survivorLivingRatio"]
    del legacy["assumptions"]["survivorIncomeRatio"]
    row.data = legacy
    db.commit()
    assert "survivorLivingRatio" not in stored(db, auth_client).data["assumptions"]
    loaded = auth_client.get(f"{BASE}/case").json()["case"]
    assumptions = loaded["assumptions"]
    assert (assumptions["survivorLivingRatio"], assumptions["survivorIncomeRatio"]) == ("61", "60")
    loaded["parents"] = CASE_A["parents"]
    body = auth_client.post(f"{BASE}/plans", json=loaded).json()
    assert body["funding"]["reservePresentValue"] == 461_576_150


def test_save_validates_and_keeps_null_base_date(auth_client):
    response = auth_client.put(
        f"{BASE}/case", json={"case": case(CASE_B, ownerRole="father"), "sensitiveConsent": False}
    )
    assert detail(response) == ("ownerRole", "재산 명의자는 살아 계신 부모님이어야 해요.")
    saved = auth_client.put(
        f"{BASE}/case", json={"case": case(CASE_B, baseDate=None), "sensitiveConsent": False}
    ).json()
    assert saved["case"]["baseDate"] is None


def test_delete_case_and_isolation(auth_client, other_auth_client, db):
    assert delete(auth_client, "/case").status_code == 204
    auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    other = other_auth_client.get(f"{BASE}/case").json()
    assert other == {"case": None, "sensitiveConsentAt": None, "updatedAt": None}
    assert delete(other_auth_client, "/case/sensitive").status_code == 404
    assert delete(other_auth_client, "/case").status_code == 204
    assert auth_client.get(f"{BASE}/case").json()["case"] is not None
    assert delete(auth_client, "/case").status_code == 204
    assert auth_client.get(f"{BASE}/case").json()["case"] is None
    assert stored(db, auth_client) is None


def test_account_deletion_cascades(auth_client, db):
    auth_client.put(f"{BASE}/case", json={"case": CASE_A, "sensitiveConsent": True})
    user_id = auth_client.get("/api/auth/me").json()["user"]["id"]
    response = auth_client.request("DELETE", "/api/auth/me", json={"password": "test-password"})
    assert response.status_code == 204, response.text
    db.expire_all()
    assert db.scalar(select(SuccessionCase).where(SuccessionCase.user_id == user_id)) is None


def test_table_constraints(auth_client, db):
    from sqlalchemy.exc import IntegrityError

    auth_client.put(f"{BASE}/case", json={"case": CASE_B, "sensitiveConsent": False})
    row = stored(db, auth_client)
    for extra in [
        SuccessionCase(user_id=row.user_id, data={}),
        SuccessionCase(user_id=row.user_id, data={}, health_enc="x", sensitive_consent_at=None),
    ]:
        nested = db.begin_nested()
        db.add(extra)
        with pytest.raises(IntegrityError):
            db.flush()
        nested.rollback()
    nested = db.begin_nested()
    row.health_enc = "x"
    with pytest.raises(IntegrityError):
        db.flush()
    nested.rollback()
