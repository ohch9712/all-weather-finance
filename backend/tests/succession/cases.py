"""스펙 22 6절·20절·21절 검증용 종합 사례 입력(JSON 계약 그대로)."""

import copy

CASE_A = {
    "baseDate": "2026-10-21",
    "parents": [
        {
            "role": "father",
            "alive": True,
            "age": 75,
            "health": "normal",
            "lifeExpectancyYears": None,
        },
        {"role": "mother", "alive": True, "age": 72, "health": "good", "lifeExpectancyYears": None},
    ],
    "ownerRole": "father",
    "monthlyLivingCost": 3_000_000,
    "monthlyIncome": 1_000_000,
    "parentsHouseCount": 2,
    "assets": [
        {"id": "a1", "kind": "cash", "label": "현금 예금", "value": 800_000_000},
        {
            "id": "a2",
            "kind": "house",
            "label": "부모님 집",
            "value": 1_500_000_000,
            "officialPrice": 1_050_000_000,
            "region": "서울",
            "regulated": True,
            "over85": True,
            "loan": 0,
            "acquiredOn": "2000-05-01",
            "acquisitionCost": 300_000_000,
            "residedYears": 26,
            "regulatedAtAcquisition": False,
            "parentsLiveHere": True,
            "nonBusinessLand": False,
        },
        {
            "id": "a3",
            "kind": "house",
            "label": "임대 아파트",
            "value": 700_000_000,
            "officialPrice": 480_000_000,
            "region": "경기",
            "regulated": True,
            "over85": False,
            "loan": 200_000_000,
            "acquiredOn": "2015-03-01",
            "acquisitionCost": 400_000_000,
            "residedYears": 0,
            "regulatedAtAcquisition": False,
            "parentsLiveHere": False,
            "nonBusinessLand": False,
        },
        {
            "id": "a4",
            "kind": "land",
            "label": "토지",
            "value": 300_000_000,
            "officialPrice": 200_000_000,
            "region": None,
            "loan": 0,
            "acquiredOn": "2010-06-01",
            "acquisitionCost": 100_000_000,
            "nonBusinessLand": True,
        },
    ],
    "children": [
        {
            "id": "c1",
            "displayName": "나",
            "isSelf": True,
            "age": 45,
            "houseCount": 1,
            "pastGifts": [
                {
                    "giftedOn": "2019-05-01",
                    "donorGroup": "parents",
                    "amount": 50_000_000,
                    "taxPaid": 0,
                }
            ],
        },
        {"id": "c2", "displayName": "동생", "isSelf": False, "age": 42, "houseCount": 0},
    ],
    "assumptions": {
        "annualGrowthRate": "3",
        "costInflationRate": "2",
        "careMonthlyCost": 2_000_000,
        "careYears": 2,
        "officialPriceRatio": "70",
        # 21절: 사례 A는 두 비율을 100으로 두어 6·19·20절 값이 그대로다.
        "survivorLivingRatio": "100",
        "survivorIncomeRatio": "100",
    },
}

CASE_B = {
    "baseDate": "2026-10-21",
    "parents": [
        {"role": "father", "alive": False},
        {"role": "mother", "alive": True, "age": 85, "health": "poor"},
    ],
    "ownerRole": "mother",
    "monthlyLivingCost": 2_500_000,
    "monthlyIncome": 500_000,
    "parentsHouseCount": 1,
    "assets": [
        {"id": "a1", "kind": "cash", "label": "현금", "value": 100_000_000},
        {
            "id": "a2",
            "kind": "house",
            "label": "어머니 집",
            "value": 500_000_000,
            "officialPrice": None,
            "regulated": False,
            "over85": False,
            "acquiredOn": "1998-04-01",
            "acquisitionCost": 120_000_000,
            "residedYears": 28,
            "parentsLiveHere": True,
        },
    ],
    "children": [
        {"id": "c1", "displayName": "나", "isSelf": True, "age": 58, "houseCount": 1},
        {"id": "c2", "displayName": "누나", "age": 60, "houseCount": 2},
    ],
    "assumptions": {"annualGrowthRate": "0", "costInflationRate": "0"},
}


def case(base: dict, **changes) -> dict:
    data = copy.deepcopy(base)
    data.update(changes)
    return data


# 20절 사례 C: 사례 A에서 월 수입만 4,000,000(남는 수입 0년차 12,000,000).
CASE_C = case(CASE_A, monthlyIncome=4_000_000)

# 21절 사례 D: 사례 A에서 두 비율만 기본값(61·60).
CASE_D = case(
    CASE_A,
    assumptions={**CASE_A["assumptions"], "survivorLivingRatio": "61", "survivorIncomeRatio": "60"},
)
