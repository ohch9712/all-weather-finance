"""스펙 22 4절 규칙 사례, 6절·20절·21절 종합 사례, 5.6·5.9 포함 조건과 문구, 10절 공개 함수."""

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.estate.schemas import PriorGift, Recipient
from app.modules.estate.service import calc_deduction_status, replay_gift_deductions
from app.modules.succession.calculations import (
    acquisition_tax,
    calculate_plans,
    capital_gains,
    gift_acquisition_code,
    life_expectancy,
    topic,
)
from app.modules.succession.schemas import AssetInput, SuccessionInput
from tests.succession.cases import CASE_A, CASE_B, CASE_C, CASE_D, case

D0 = date(2026, 10, 21)


def near(actual: int, expected: int, tolerance: int = 1_000) -> bool:
    """성장률이 들어간 금액은 ±1,000원까지 허용한다(스펙 6절)."""
    return abs(actual - expected) <= tolerance


def run(data: dict):
    return calculate_plans(SuccessionInput.model_validate(data))


def by_key(result):
    return {plan.key: plan for plan in result.plans}


# ── 4.1 기대여명 ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("role", "age", "health", "table", "applied", "years"),
    [
        ("father", 75, "normal", "12.0", "12.0", 12),
        ("mother", 72, "good", "17.5", "19.3", 19),
        ("mother", 85, "poor", "8.0", "5.6", 6),
        ("father", 101, "care", "1.9", "0.8", 1),
        ("father", 63, None, "21.2", "21.2", 21),
    ],
)
def test_life_expectancy_cases(role, age, health, table, applied, years):
    info = life_expectancy(role, age, health)
    assert (str(info.table_life_expectancy), str(info.life_expectancy), info.years_assumed) == (
        table,
        applied,
        years,
    )


def test_life_expectancy_override_and_factors():
    info = life_expectancy("father", 75, "poor", Decimal("3.5"))
    assert (str(info.health_factor), str(info.life_expectancy), info.years_assumed) == (
        "0.7",
        "3.5",
        4,
    )
    assert str(life_expectancy("mother", 40, None).health_factor) == "1.0"
    assert str(life_expectancy("mother", 110, "care").table_life_expectancy) == "2.3"


# ── 4.2 취득세 ──────────────────────────────────────────────────────


def asset(**kwargs) -> AssetInput:
    return AssetInput(**{"id": "x", "kind": "house", "label": "집", "value": 0, **kwargs})


def test_acquisition_tax_cases():
    ratio = Decimal("70")
    rental = asset(value=700_000_000, official_price=480_000_000, regulated=True)
    assert gift_acquisition_code(rental, 2, ratio) == "gift_heavy"
    assert acquisition_tax(700_000_000, "gift_heavy", rental) == 86_800_000
    assert gift_acquisition_code(rental, 1, ratio) == "gift"
    assert acquisition_tax(700_000_000, "gift", rental) == 26_600_000
    big = asset(value=1_500_000_000, regulated=True, over85=True)
    assert gift_acquisition_code(big, 2, ratio) == "gift_heavy"
    assert acquisition_tax(1_500_000_000, "gift_heavy", big) == 201_000_000
    assert acquisition_tax(480_000_000, "inherit_first_home", rental) == 4_608_000
    assert acquisition_tax(480_000_000, "inherit", rental) == 14_208_000
    assert acquisition_tax(1_050_000_000, "inherit", big) == 33_180_000
    land = asset(kind="land", value=300_000_000)
    assert gift_acquisition_code(land, 2, ratio) == "gift"
    assert acquisition_tax(300_000_000, "gift", land) == 12_000_000
    assert acquisition_tax(200_000_000, "inherit", land) == 6_320_000
    # 조정대상지역이 아니거나 공시가격 3억 원 미만이면 중과하지 않는다.
    assert gift_acquisition_code(
        asset(value=700_000_000, official_price=480_000_000), 2, ratio
    ) == ("gift")
    cheap = asset(value=400_000_000, official_price=299_999_999, regulated=True)
    assert gift_acquisition_code(cheap, 3, ratio) == "gift"


# ── 4.3 양도소득세 ────────────────────────────────────────────────────


def sale(house_count: int, basic: bool = True, **kwargs):
    return capital_gains(asset(**kwargs), D0, house_count, basic)


@pytest.mark.parametrize(
    ("house_count", "basic", "kwargs", "expected"),
    [
        (
            1,
            True,
            dict(
                value=1_500_000_000,
                acquired_on=date(2000, 5, 1),
                acquisition_cost=300_000_000,
                resided_years=26,
            ),
            ("one_house_high", 240_000_000, 192_000_000, 45_500_000, 5_565_000, 6_121_500),
        ),
        (
            1,
            True,
            dict(
                value=1_000_000_000,
                acquired_on=date(2000, 5, 1),
                acquisition_cost=300_000_000,
                resided_years=26,
            ),
            ("exempt", 0, 0, 0, 0, 0),
        ),
        (
            2,
            True,
            dict(
                value=700_000_000,
                regulated=True,
                acquired_on=date(2015, 3, 1),
                acquisition_cost=400_000_000,
            ),
            ("heavy_20", 300_000_000, 0, 297_500_000, 152_610_000, 167_871_000),
        ),
        (
            2,
            True,
            dict(value=700_000_000, acquired_on=date(2015, 3, 1), acquisition_cost=400_000_000),
            ("general", 300_000_000, 66_000_000, 231_500_000, 68_030_000, 74_833_000),
        ),
        (
            2,
            False,
            dict(
                kind="land",
                value=300_000_000,
                acquired_on=date(2010, 6, 1),
                acquisition_cost=100_000_000,
                non_business_land=True,
            ),
            ("non_business_land", 200_000_000, 60_000_000, 140_000_000, 47_560_000, 52_316_000),
        ),
        (
            2,
            True,
            dict(value=500_000_000, acquired_on=date(2025, 12, 1), acquisition_cost=450_000_000),
            ("general", 50_000_000, 0, 47_500_000, 33_250_000, 36_575_000),
        ),
    ],
)
def test_capital_gains_cases(house_count, basic, kwargs, expected):
    result = sale(house_count, basic, **kwargs)
    assert (
        result.case,
        result.taxable_gain,
        result.long_term_deduction,
        result.tax_base,
        result.income_tax,
        result.total,
    ) == expected
    assert result.local_income_tax == result.income_tax // 10


def test_capital_gains_heavy_30_and_one_house_residence_rule():
    heavy = sale(
        3,
        value=700_000_000,
        regulated=True,
        acquired_on=date(2015, 3, 1),
        acquisition_cost=400_000_000,
    )
    # 297,500,000 × (38% + 30%) − 19,940,000
    assert (heavy.case, heavy.income_tax) == ("heavy_30", 182_360_000)
    # 취득 당시 조정대상지역이면 거주 2년이 있어야 비과세다.
    lived_short = sale(
        1,
        value=900_000_000,
        regulated_at_acquisition=True,
        acquired_on=date(2020, 1, 1),
        acquisition_cost=600_000_000,
        resided_years=1,
    )
    assert lived_short.case == "general" and lived_short.total > 0
    lived = sale(
        1,
        value=900_000_000,
        regulated_at_acquisition=True,
        acquired_on=date(2020, 1, 1),
        acquisition_cost=600_000_000,
        resided_years=2,
    )
    assert (lived.case, lived.total, lived.net_proceeds) == ("exempt", 0, 900_000_000)


# ── 6절 사례 A ──────────────────────────────────────────────────────


def test_case_a_funding_timeline_and_assignment():
    result = run(CASE_A)
    assert (result.horizon_date, result.spouse_alive_at_horizon) == (date(2038, 10, 21), True)
    father, mother = result.parents
    assert (str(father.life_expectancy), father.years_assumed, father.is_owner) == (
        "12.0",
        12,
        True,
    )
    assert (father.expected_until, father.care_from) == (date(2038, 10, 21), date(2036, 10, 21))
    assert (str(mother.table_life_expectancy), str(mother.life_expectancy)) == ("17.5", "19.3")
    assert (mother.years_assumed, mother.is_owner) == (19, False)
    funding = result.funding
    costs = funding.costs
    assert len(costs) == 19
    # 20절: 표시용 생활비·수입과 필요 금액(생활비 부족분 + 간병비).
    assert (costs[0].living, costs[0].income, costs[0].care, costs[0].total, costs[0].on) == (
        36_000_000,
        12_000_000,
        0,
        24_000_000,
        D0,
    )
    assert costs[10].living - costs[10].income == costs[10].care == 29_255_866
    assert costs[10].total == 58_511_732
    assert [row.year for row in costs if row.care] == [10, 11, 17, 18]
    # 월 생활비 ≥ 월 수입이면 20절 전과 원 단위까지 같다.
    assert funding.survivor_need == 294_166_954
    assert funding.reserve_present_value == 522_664_859
    assert funding.cash_assets == 800_000_000
    assert funding.transferable_now == 277_335_141
    assert funding.shortfall == 0
    # 21절: 아버지 12년 뒤부터 한 분만 계신다(비율 100이라 값은 그대로).
    assert funding.single_from == date(2038, 10, 21)
    assert [(a.asset_id, a.child_id) for a in result.assignments] == [
        ("a2", "c2"),
        ("a3", "c1"),
        ("a4", "c1"),
    ]


CASE_A_TABLE = [
    # key, 증여세, 취득세, 양도세, 상속세, 합계(낸 금액), 상속 시점 기준 세금,
    # 부모님에게 남는 재산(지금), 자녀에게 남는 금액(T). 19절 순위(상속 시점 기준 세금 순).
    (
        "realestate_gift_cash_staged",
        232_800_000,
        113_175_161,
        0,
        420_589_229,
        766_564_390,
        907_861_575,
        2_050_000_000,
        2_852_916_387,
    ),
    (
        "realestate_gift_now",
        232_800_000,
        113_175_161,
        0,
        436_850_083,
        782_825_244,
        924_122_429,
        2_100_000_000,
        2_836_655_533,
    ),
    (
        "cash_lump_now",
        25_802_264,
        43_650_289,
        0,
        866_960_875,
        936_413_428,
        947_407_960,
        2_822_664_860,
        2_813_370_000,
    ),
    (
        "realestate_sell_cash_now",
        110_525_583,
        14_375_161,
        220_187_000,
        498_930_084,
        844_017_828,
        984_936_877,
        2_300_000_000,
        2_690_619_621,
    ),
    (
        "cash_staged_spread",
        16_983_300,
        43_650_289,
        0,
        931_159_988,
        991_793_577,
        995_968_196,
        2_961_332_430,
        2_764_809_762,
    ),
    (
        "cash_staged_deduction",
        0,
        43_650_289,
        0,
        973_918_867,
        1_017_569_156,
        1_017_569_156,
        3_050_000_000,
        2_743_208_806,
    ),
    (
        "inherit_only",
        0,
        43_650_289,
        0,
        990_179_721,
        1_033_830_010,
        1_033_830_010,
        3_100_000_000,
        2_726_947_952,
    ),
]


def test_case_a_plan_table_rank_and_tier():
    result = run(CASE_A)
    assert [plan.key for plan in result.plans] == [row[0] for row in CASE_A_TABLE]
    assert [plan.rank for plan in result.plans] == list(range(1, 8))
    assert [plan.tier for plan in result.plans] == ["best", "runner_up", "runner_up"] + [
        "other"
    ] * 4
    assert result.excluded == []
    for plan, row in zip(result.plans, CASE_A_TABLE, strict=True):
        taxes = plan.taxes
        actual = (
            taxes.gift_tax,
            taxes.acquisition_tax,
            taxes.capital_gains_tax,
            taxes.inheritance_tax,
            taxes.total,
            taxes.total_at_horizon,
            plan.parents_remaining_now,
            plan.children_receive_at_horizon,
        )
        # 20절: 6절·19절 값과 원 단위까지 같다.
        assert actual == row[1:], (plan.key, actual)
        assert taxes.total == (
            taxes.gift_tax + taxes.acquisition_tax + taxes.capital_gains_tax + taxes.inheritance_tax
        )
        assert plan.parents_reserve == 522_664_859


def test_case_a_total_at_horizon_formula():
    """19절: 증여 항목·매각은 낸 날부터 T까지 불리고, 상속 취득세·상속세는 그대로 더한다."""
    result = run(CASE_A)
    horizon = result.horizon_date

    def grown(amount: int, on: date) -> int:
        days = Decimal((horizon - on).days)
        return int(amount * Decimal("1.03") ** (days / 365))

    for plan in result.plans:
        expected = (
            sum(
                grown(t.gift_tax + t.acquisition_tax, t.on)
                for t in plan.transfers
                if t.method in ("gift", "sale_gift")
            )
            + sum(grown(s.total, D0) for s in plan.sales)
            + sum(t.acquisition_tax for t in plan.transfers if t.method == "inherit")
            + plan.taxes.inheritance_tax
        )
        assert plan.taxes.total_at_horizon == expected, plan.key
    plans = by_key(result)
    # 지금 내는 세금이 없는 방안은 낸 금액 합계와 같다.
    for key in ("cash_staged_deduction", "inherit_only"):
        assert plans[key].taxes.total_at_horizon == plans[key].taxes.total


def test_case_a_zero_growth_total_at_horizon_equals_total():
    assumptions = {**CASE_A["assumptions"], "annualGrowthRate": "0"}
    result = run(case(CASE_A, assumptions=assumptions))
    assert len(result.plans) == 7
    for plan in result.plans:
        assert plan.taxes.total_at_horizon == plan.taxes.total, plan.key
    assert (
        result.notes[2]
        == "지금 내는 세금은 상속 시점까지 연 0%로 불려 상속세와 더해 순위를 매겼어요."
    )


def test_case_a_same_day_gift_split_and_acquisition():
    plan = by_key(run(CASE_A))["realestate_gift_now"]
    gifts = [t for t in plan.transfers if t.method == "gift"]
    assert [(t.child_id, t.asset_id, t.amount, t.gift_tax) for t in gifts] == [
        ("c1", "a3", 700_000_000, 162_960_000),
        ("c1", "a4", 300_000_000, 69_840_000),
    ]
    assert [(t.acquisition_tax, t.acquisition_tax_code) for t in gifts] == [
        (86_800_000, "gift_heavy"),
        (12_000_000, "gift"),
    ]
    inherits = [t for t in plan.transfers if t.method == "inherit"]
    house = inherits[0]
    assert (house.child_id, house.asset_id, house.on) == ("c2", "a2", date(2038, 10, 21))
    assert (house.acquisition_tax, house.acquisition_tax_code) == (14_375_161, "inherit_first_home")
    cash = inherits[-1]
    assert (cash.child_id, cash.asset_id, cash.asset_kind) == (None, None, "cash")
    assert cash.amount == plan.inheritance.financial_assets - plan.inheritance.spouse_share
    impacts = {i.child_id: i for i in plan.child_impacts}
    assert (impacts["c1"].house_count_before, impacts["c1"].house_count_after) == (1, 2)
    assert [f.code for f in impacts["c1"].flags] == [
        "gift_heavy_acquisition",
        "one_house_exemption_risk",
        "multi_home_sale_surcharge",
        "carryover_basis",
    ]
    assert (impacts["c2"].house_count_before, impacts["c2"].house_count_after) == (0, 1)
    assert [f.code for f in impacts["c2"].flags] == ["inherit_first_home"]
    assert impacts["c2"].flags[0].message == (
        "무주택 상태에서 상속받는 첫 주택이라 취득세 특례(0.8%)가 적용돼요."
    )


def test_case_a_sale_plan():
    plan = by_key(run(CASE_A))["realestate_sell_cash_now"]
    assert [(s.asset_id, s.case, s.total, s.net_proceeds) for s in plan.sales] == [
        ("a3", "heavy_20", 167_871_000, 332_129_000),
        ("a4", "non_business_land", 52_316_000, 247_684_000),
    ]
    gifts = [t for t in plan.transfers if t.method == "sale_gift"]
    assert [(t.child_id, t.asset_id, t.asset_kind, t.amount) for t in gifts] == [
        ("c1", "a3", "cash", 332_129_000),
        ("c1", "a4", "cash", 247_684_000),
    ]
    assert sum(t.gift_tax for t in gifts) == 110_525_583
    assert plan.inheritance.debts == 0


def test_case_a_staged_deduction_and_inheritance_steps():
    plans = by_key(run(CASE_A))
    staged = plans["cash_staged_deduction"]
    assert [(t.on, t.child_id, t.amount, t.gift_tax) for t in staged.transfers[:3]] == [
        (date(2026, 10, 21), "c2", 50_000_000, 0),
        (date(2036, 10, 22), "c1", 50_000_000, 0),
        (date(2036, 10, 22), "c2", 50_000_000, 0),
    ]
    assert staged.inheritance.prior_gifts_added == 100_000_000
    inherit = plans["inherit_only"].inheritance
    assert near(inherit.financial_assets, 689_676_627)
    assert near(inherit.real_estate, 3_565_268_289)
    assert inherit.debts == 200_000_000
    assert near(inherit.taxable_value, 4_049_944_916)
    assert near(inherit.applied_deduction, 1_097_935_325)
    assert near(inherit.tax_base, 2_952_009_591)
    inherit_rows = [t for t in plans["inherit_only"].transfers if t.asset_id]
    assert [(t.asset_id, t.acquisition_tax_code) for t in inherit_rows] == [
        ("a2", "inherit_first_home"),
        ("a3", "inherit"),
        ("a4", "inherit"),
    ]
    for row, expected in zip(inherit_rows, (14_375_161, 20_262_132, 9_012_996), strict=True):
        assert near(row.acquisition_tax, expected)
    best = plans["realestate_gift_cash_staged"].inheritance
    assert (best.spouse_share, best.prior_gifts_added) == (294_166_954, 100_000_000)
    assert near(best.taxable_value, 2_546_450_828)


def test_case_a_reasons():
    plans = by_key(run(CASE_A))
    assert plans["realestate_gift_cash_staged"].reasons == [
        "상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(907,861,575원).",
        "부동산을 지금 넘기고, 남는 현금은 10년마다 공제 한도만큼 넘겨요.",
        "상속 가정 시점(2038-10-21) 전 10년 안에 한 증여 100,000,000원은 상속재산에 다시 더해져요.",
        "부모님이 주택을 2채 이상 가지고 계셔서 조정대상지역 주택 증여 취득세가 12%로 무거워져요.",
    ]
    assert plans["realestate_gift_now"].reasons == [
        "상속 시점 기준 세금 합계가 최선안보다 16,260,854원 많아요.",
        "부동산을 지금 넘겨 앞으로 오를 가격만큼 상속재산이 줄어요. "
        "대신 자녀가 증여세와 취득세 331,600,000원을 내요.",
        "부모님이 주택을 2채 이상 가지고 계셔서 조정대상지역 주택 증여 취득세가 12%로 무거워져요.",
    ]
    assert plans["realestate_sell_cash_now"].reasons[1] == (
        "부동산을 팔아 현금으로 넘겨요. 부모님이 양도소득세 220,187,000원을 내요."
    )
    assert plans["cash_lump_now"].reasons[1:] == [
        "이전 가능액을 지금 넘겨 앞으로 늘어날 가치가 상속재산에서 빠져요."
    ]
    assert plans["cash_staged_spread"].reasons[1] == (
        "이전 가능액을 2번에 나눠 넘겨 한 번에 높은 세율 구간이 적용되지 않게 해요."
    )
    assert plans["cash_staged_deduction"].reasons[1] == (
        "10년마다 자녀 1명당 5천만 원 공제 한도 안에서만 넘겨 증여세가 0원이에요."
    )
    assert (
        plans["inherit_only"]
        .reasons[1]
        .startswith("지금은 재산을 넘기지 않아 부모님 재산이 그대로 남고, 상속 때 공제 1,097,93")
    )
    assert plans["inherit_only"].reasons[1].endswith("원을 받아요.")
    assert len(plans["inherit_only"].reasons) == 2


def test_case_a_first_reasons_follow_total_at_horizon():
    result = run(CASE_A)
    differences = [
        "16,260,854원",
        "39,546,385원",
        "77,075,302원",
        "88,106,621원",
        "109,707,581원",
        "125,968,435원",
    ]
    assert [plan.reasons[0] for plan in result.plans] == [
        "상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(907,861,575원).",
        *(f"상속 시점 기준 세금 합계가 최선안보다 {d} 많아요." for d in differences),
    ]


CARE_LINE = (
    "간병비는 부모님마다 예상 시점 전 마지막 2년에 들어간다고 봐요. 건강 상태가 "
    "'요양·간병 중'인 분은 지금부터 예상 시점까지 들어가요."
)


def test_case_a_notes_assumptions_sources():
    result = run(CASE_A)
    assert result.notes == [
        "기대여명은 2024년 생명표 평균에 건강 상태 가정을 곱한 값이에요. 실제와 다를 수 있어요.",
        "재산은 연 3%, 생활비·수입·간병비는 연 2%씩 늘어난다고 가정했어요.",
        "지금 내는 세금은 상속 시점까지 연 3%로 불려 상속세와 더해 순위를 매겼어요.",
        "실행 전에 세무전문가에게 입력 정보와 결과를 검토받으세요.",
    ]
    assert "부동산 가격은 입력한 시가를 쓰고, 공시가격을 비우면 시가의 70%로 봐요." in (
        result.assumptions
    )
    assert "장례비는 최소 공제(500만 원)만 반영해요." in result.assumptions
    lines = result.assumptions
    timing = (
        "증여세·증여 취득세·양도세는 증여하거나 판 날, 상속세·상속 취득세는 상속 가정 "
        "시점에 낸다고 봐요."
    )
    assert lines.index(timing) == lines.index("양도세 기본공제 250만 원은 한 번만 적용해요.") + 1
    surplus = (
        "월 수입이 월 생활비보다 많으면 남는 수입으로 간병비를 먼저 메우고, 그래도 남는 "
        "돈은 현금으로 쌓지 않는다고 봐요."
    )
    cash_first = "생활·간병비는 부모님 현금에서 쓰고, 모자라도 부동산을 팔지 않는다고 봐요."
    # 21절: 현금 줄 다음에 가구·간병 두 줄, 그다음 남는 수입 줄.
    start = lines.index(cash_first)
    assert lines[start + 1 : start + 3] == [
        "월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 "
        "월 생활비를 100%, 월 수입을 100%로 계산해요.",
        CARE_LINE,
    ]
    assert lines.index(surplus) == start + 3
    assert result.rule_version == "KR-2026.05.10"
    assert any("law.go.kr" in source.url for source in result.sources)
    assert [(s.label, s.url) for s in result.sources][-2:] == [
        ("보건복지부, 기준 중위소득", "https://www.mohw.go.kr/menu.es?mid=a10708010900"),
        ("국민연금공단, 유족연금", "https://www.nps.or.kr/pnsinfo/ntpsklg/getOHAF0072M0.do"),
    ]


# ── 6절 사례 B ──────────────────────────────────────────────────────


def test_case_b_shortfall_and_excluded():
    result = run(CASE_B)
    assert result.horizon_date == date(2032, 10, 21)
    assert (str(result.parents[0].life_expectancy), result.parents[0].years_assumed) == ("5.6", 6)
    assert result.spouse_alive_at_horizon is False
    funding = result.funding
    assert (funding.reserve_present_value, funding.transferable_now, funding.shortfall) == (
        192_000_000,
        -92_000_000,
        92_000_000,
    )
    first = funding.costs[0]
    assert (first.living, first.income, first.care, first.total) == (
        30_000_000,
        6_000_000,
        0,
        24_000_000,
    )
    assert sum(row.living - row.income for row in funding.costs) == 24_000_000 * 6
    assert sum(row.care for row in funding.costs) == 24_000_000 * 2
    assert [row.total for row in funding.costs] == [24_000_000] * 4 + [48_000_000] * 2
    assert [plan.key for plan in result.plans] == ["inherit_only"]
    assert [(e.key, e.reason) for e in result.excluded] == [
        ("cash_staged_deduction", "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요."),
        ("cash_staged_spread", "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요."),
        ("cash_lump_now", "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요."),
        ("realestate_gift_now", "증여할 부동산이 없어요(부모님이 사시는 집은 빼요)."),
        ("realestate_sell_cash_now", "증여할 부동산이 없어요(부모님이 사시는 집은 빼요)."),
        ("realestate_gift_cash_staged", "증여할 부동산이 없어요(부모님이 사시는 집은 빼요)."),
    ]
    assert result.excluded[0].label == "현금을 10년마다 공제 한도만큼 증여"
    plan = result.plans[0]
    assert [(a.asset_id, a.child_id) for a in result.assignments] == [("a2", "c1")]
    house = plan.transfers[0]
    assert (house.acquisition_tax, house.acquisition_tax_code) == (10_360_000, "inherit")
    assert (plan.inheritance.taxable_value, plan.inheritance.payable_tax) == (495_000_000, 0)
    assert (plan.taxes.total, plan.parents_remaining_now, plan.children_receive_at_horizon) == (
        10_360_000,
        600_000_000,
        489_640_000,
    )
    assert plan.taxes.total_at_horizon == 10_360_000
    assert (plan.rank, plan.tier) == (1, "best")
    assert plan.reasons[0] == (
        "상속 시점(2032-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(10,360,000원)."
    )
    assert result.notes[1] == "재산은 연 0%, 생활비·수입·간병비는 연 0%씩 늘어난다고 가정했어요."
    # 21절: 한 분만 계셔서 기본 비율이어도 값이 그대로이고 singleFrom은 없다.
    assert funding.single_from is None
    assert "월 생활비·월 수입은 지금 계신 한 분 기준으로 봐요." in result.assumptions
    assert CARE_LINE in result.assumptions


# ── 20절 사례 C(남는 수입으로 간병비 메우기) ──────────────────────────────

CASE_C_COSTS = [
    # 연차, 생활비, 수입, 간병비, 필요 금액
    (0, 36_000_000, 48_000_000, 0, 0),
    (10, 43_883_799, 58_511_732, 29_255_866, 14_627_933),
    (11, 44_761_475, 59_681_966, 29_840_983, 14_920_492),
    (17, 50_408_691, 67_211_588, 33_605_794, 16_802_897),
    (18, 51_416_864, 68_555_818, 34_277_909, 17_138_955),
]

CASE_C_TABLE = [
    # key, 세금 합계(낸 금액), 상속 시점 기준 세금,
    # 부모님에게 남는 재산(지금), 자녀에게 남는 금액(T). 20절 순위.
    ("cash_lump_now", 934_684_869, 984_659_180, 2_345_458_522, 3_456_666_227),
    ("realestate_gift_cash_staged", 897_032_446, 1_038_329_631, 2_050_000_000, 3_402_995_778),
    ("realestate_gift_now", 913_293_300, 1_054_590_485, 2_100_000_000, 3_386_734_924),
    ("cash_staged_spread", 1_060_069_783, 1_082_481_218, 2_722_729_262, 3_358_844_189),
    ("realestate_sell_cash_now", 983_021_804, 1_123_940_853, 2_300_000_000, 3_232_163_092),
    ("cash_staged_deduction", 1_171_933_943, 1_171_933_943, 3_050_000_000, 3_269_391_466),
    ("inherit_only", 1_192_260_011, 1_192_260_011, 3_100_000_000, 3_249_065_398),
]


def test_case_c_surplus_income_covers_care():
    funding = run(CASE_C).funding
    rows = {row.year: row for row in funding.costs}
    assert len(funding.costs) == 19
    assert [
        (row.year, row.living, row.income, row.care, row.total)
        for row in (rows[year] for year, *_ in CASE_C_COSTS)
    ] == CASE_C_COSTS
    # 남는 수입은 0년차 12,000,000(이후 연 2%). 필요 금액은 간병 기간에만 있다.
    assert rows[0].income - rows[0].living == 12_000_000
    assert [row.year for row in funding.costs if row.total] == [10, 11, 17, 18]
    assert (
        funding.survivor_need,
        funding.reserve_present_value,
        funding.transferable_now,
        funding.shortfall,
    ) == (33_941_852, 45_458_522, 754_541_478, 0)
    assert funding.single_from == date(2038, 10, 21)


def test_case_c_plan_table_rank_and_tier():
    result = run(CASE_C)
    assert result.excluded == []
    assert [plan.key for plan in result.plans] == [row[0] for row in CASE_C_TABLE]
    assert [plan.rank for plan in result.plans] == list(range(1, 8))
    assert [plan.tier for plan in result.plans] == ["best", "runner_up", "runner_up"] + [
        "other"
    ] * 4
    for plan, row in zip(result.plans, CASE_C_TABLE, strict=True):
        actual = (
            plan.taxes.total,
            plan.taxes.total_at_horizon,
            plan.parents_remaining_now,
            plan.children_receive_at_horizon,
        )
        assert actual == row[1:], (plan.key, actual)
        assert plan.parents_reserve == 45_458_522


@pytest.mark.parametrize(
    "data",
    [
        CASE_A,
        CASE_B,
        CASE_C,
        case(CASE_A, monthlyIncome=3_000_000),
        case(CASE_A, monthlyIncome=3_500_000),
        case(CASE_B, monthlyIncome=3_000_000),
        case(CASE_A, monthlyLivingCost=0, monthlyIncome=0),
        CASE_D,
        case(CASE_D, monthlyIncome=4_000_000),
        # 두 분일 때는 부족하고 한 분만 계신 해에는 수입이 남는다.
        case(
            CASE_D,
            monthlyIncome=2_900_000,
            assumptions={**CASE_D["assumptions"], "survivorIncomeRatio": "100"},
        ),
    ],
    ids=[
        "A",
        "B",
        "C",
        "A-equal",
        "A-small-surplus",
        "B-surplus",
        "A-zero",
        "D",
        "D-surplus",
        "D-single-surplus",
    ],
)
def test_cost_total_matches_display_columns(data):
    """20절·21절: 모든 해에서 필요 금액 = max(0, 생활비 + 간병비 − 수입)."""
    for row in run(data).funding.costs:
        assert row.total == max(0, row.living + row.care - row.income), row.year
        assert min(row.living, row.income, row.care, row.total) >= 0


def test_large_income_needs_no_reserve():
    result = run(case(CASE_A, monthlyIncome=100_000_000))
    funding = result.funding
    assert all(row.total == 0 for row in funding.costs)
    assert (funding.survivor_need, funding.reserve_present_value) == (0, 0)
    assert funding.transferable_now == funding.cash_assets == 800_000_000


# ── 21절 사례 D(한 분만 계신 뒤 생활비·수입) ──────────────────────────────

CASE_D_COSTS = [
    # 연차, 날짜, 생활비, 수입, 간병비, 필요 금액
    (0, date(2026, 10, 21), 36_000_000, 12_000_000, 0, 24_000_000),
    (11, date(2037, 10, 21), 44_761_474, 14_920_491, 29_840_983, 59_681_966),
    (12, date(2038, 10, 21), 27_850_588, 9_131_340, 0, 18_719_248),
    (16, date(2042, 10, 21), 30_146_374, 9_884_057, 0, 20_262_317),
    (17, date(2043, 10, 21), 30_749_301, 10_081_738, 33_605_794, 54_273_357),
    (18, date(2044, 10, 21), 31_364_286, 10_283_372, 34_277_909, 55_358_823),
]

CASE_D_TABLE = [
    # key, 세금 합계(낸 금액), 상속 시점 기준 세금,
    # 부모님에게 남는 재산(지금), 자녀에게 남는 금액(T). 21절 순위.
    ("realestate_gift_cash_staged", 766_564_390, 907_861_575, 2_050_000_000, 2_940_035_441),
    ("realestate_gift_now", 782_825_244, 924_122_429, 2_100_000_000, 2_923_774_587),
    ("cash_lump_now", 918_388_613, 933_964_636, 2_761_576_150, 2_913_932_378),
    ("realestate_sell_cash_now", 844_017_828, 984_936_877, 2_300_000_000, 2_777_738_675),
    ("cash_staged_spread", 982_031_288, 987_710_606, 2_930_788_076, 2_860_186_407),
    ("cash_staged_deduction", 1_017_569_156, 1_017_569_156, 3_050_000_000, 2_830_327_860),
    ("inherit_only", 1_033_830_010, 1_033_830_010, 3_100_000_000, 2_814_067_006),
]


def test_case_d_survivor_costs():
    funding = run(CASE_D).funding
    rows = {row.year: row for row in funding.costs}
    assert len(funding.costs) == 19
    assert funding.single_from == date(2038, 10, 21)
    assert [
        (row.year, row.on, row.living, row.income, row.care, row.total)
        for row in (rows[year] for year, *_ in CASE_D_COSTS)
    ] == CASE_D_COSTS
    # 12년차부터 월 생활비 1,830,000, 월 수입 600,000(물가 반영 전 연 금액).
    assert all(row.living == row.income + row.total - row.care for row in funding.costs)
    assert (
        funding.survivor_need,
        funding.reserve_present_value,
        funding.transferable_now,
        funding.shortfall,
    ) == (207_047_900, 461_576_150, 338_423_850, 0)
    # 한 분만 계시기 전(11년차까지)은 사례 A와 같다.
    before = run(CASE_A).funding.costs[:12]
    assert funding.costs[:12] == before


def test_case_d_plan_table_reasons_and_assumptions():
    result = run(CASE_D)
    assert result.excluded == []
    assert [plan.key for plan in result.plans] == [row[0] for row in CASE_D_TABLE]
    assert [plan.tier for plan in result.plans] == ["best", "runner_up", "runner_up"] + [
        "other"
    ] * 4
    for plan, row in zip(result.plans, CASE_D_TABLE, strict=True):
        actual = (
            plan.taxes.total,
            plan.taxes.total_at_horizon,
            plan.parents_remaining_now,
            plan.children_receive_at_horizon,
        )
        assert actual == row[1:], (plan.key, actual)
        assert plan.parents_reserve == 461_576_150
    differences = [
        "16,260,854원",
        "26,103,061원",
        "77,075,302원",
        "79,849,031원",
        "109,707,581원",
        "125,968,435원",
    ]
    assert [plan.reasons[0] for plan in result.plans] == [
        "상속 시점(2038-10-21) 기준으로 맞춘 세금 합계가 가장 적어요(907,861,575원).",
        *(f"상속 시점 기준 세금 합계가 최선안보다 {d} 많아요." for d in differences),
    ]
    # S가 배우자공제 최소 5억 원보다 작아, 증여액이 A에 따라 바뀌지 않는 방안의 상속세는
    # 비율 100일 때와 같고 자녀에게 남는 금액만 늘어난다.
    case_a = by_key(run(CASE_A))
    plans = by_key(result)
    for key in [
        "realestate_gift_cash_staged",
        "realestate_gift_now",
        "realestate_sell_cash_now",
        "cash_staged_deduction",
        "inherit_only",
    ]:
        assert plans[key].taxes == case_a[key].taxes, key
        assert plans[key].children_receive_at_horizon > case_a[key].children_receive_at_horizon
    lines = result.assumptions
    start = lines.index("생활·간병비는 부모님 현금에서 쓰고, 모자라도 부동산을 팔지 않는다고 봐요.")
    assert lines[start + 1 : start + 3] == [
        "월 생활비·월 수입은 두 분 합계로 보고, 한 분만 계시게 되는 2038-10-21부터는 "
        "월 생활비를 61%, 월 수입을 60%로 계산해요.",
        CARE_LINE,
    ]


def test_missing_survivor_ratios_use_defaults():
    """저장된 입력에 두 비율이 없으면 기본값(61·60)으로 계산한다(사례 D와 같다)."""
    legacy = {
        key: value
        for key, value in CASE_A["assumptions"].items()
        if key not in ("survivorLivingRatio", "survivorIncomeRatio")
    }
    data = SuccessionInput.model_validate(case(CASE_A, assumptions=legacy))
    assert (data.assumptions.survivor_living_ratio, data.assumptions.survivor_income_ratio) == (
        Decimal("61"),
        Decimal("60"),
    )
    assert calculate_plans(data).funding == run(CASE_D).funding


def test_same_expected_dates_have_no_single_years():
    # 어머니 기대여명을 아버지와 같은 12년으로 고치면 한 분만 계신 기간이 없다.
    same = case(CASE_D)
    same["parents"][1]["lifeExpectancyYears"] = "12.0"
    result = run(same)
    assert result.funding.single_from is None
    assert result.spouse_alive_at_horizon is False
    assert len(result.funding.costs) == 12
    # 비율을 바꿔도 생활비·수입이 그대로다.
    full = case(same, assumptions=CASE_A["assumptions"])
    assert run(full).funding.costs == result.funding.costs
    assert (
        "월 생활비·월 수입은 두 분 합계로 봐요. 두 분의 예상 시점이 같아 한 분만 계신 기간은 "
        "없어요." in result.assumptions
    )


def test_care_years_zero_assumption_line():
    result = run(case(CASE_D, assumptions={**CASE_D["assumptions"], "careYears": 0}))
    assert all(row.care == 0 for row in result.funding.costs)
    assert (
        "간병비는 건강 상태가 '요양·간병 중'인 분만 지금부터 예상 시점까지 들어간다고 봐요."
        in result.assumptions
    )
    assert CARE_LINE not in result.assumptions


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("survivorLivingRatio", "9.99"),
        ("survivorLivingRatio", "100.01"),
        ("survivorLivingRatio", "61.123"),
        ("survivorIncomeRatio", "-1"),
        ("survivorIncomeRatio", "100.5"),
    ],
)
def test_survivor_ratio_range(field, value):
    with pytest.raises(ValidationError):
        SuccessionInput.model_validate(
            case(CASE_A, assumptions={**CASE_A["assumptions"], field: value})
        )


def test_survivor_ratio_bounds_are_allowed():
    for living, income in [("10", "0"), ("100", "100"), ("55.25", "0.5")]:
        assumptions = {
            **CASE_A["assumptions"],
            "survivorLivingRatio": living,
            "survivorIncomeRatio": income,
        }
        run(case(CASE_A, assumptions=assumptions))


# ── 5.6 포함 조건과 제외 이유 ─────────────────────────────────────────


def flat(**changes) -> dict:
    """성장률·물가 0%, 아버지 85세(6년), 간병 없음, 생활비 연 1,200만 원인 단순 사례."""
    data = {
        "baseDate": "2026-10-21",
        "parents": [{"role": "father", "alive": True, "age": 85, "health": "normal"}],
        "ownerRole": "father",
        "monthlyLivingCost": 1_000_000,
        "monthlyIncome": 0,
        "parentsHouseCount": 1,
        "assets": [{"id": "cash", "kind": "cash", "label": "예금", "value": 172_000_000}],
        "children": [{"id": "c1", "displayName": "나", "age": 50}],
        "assumptions": {"annualGrowthRate": "0", "costInflationRate": "0", "careYears": 0},
    }
    data.update(changes)
    return data


def test_deduction_used_up_excludes_staged_deduction():
    gift = {"giftedOn": "2025-01-01", "donorGroup": "parents", "amount": 50_000_000}
    result = run(flat(children=[{"id": "c1", "displayName": "나", "age": 50, "pastGifts": [gift]}]))
    assert result.funding.transferable_now == 100_000_000
    assert [(e.key, e.reason) for e in result.excluded][0] == (
        "cash_staged_deduction",
        "자녀의 증여재산공제가 이미 모두 쓰여 공제 한도 안에서 넘길 금액이 없어요.",
    )
    keys = {plan.key for plan in result.plans}
    assert {"cash_staged_spread", "cash_lump_now"} <= keys


def test_zero_transferable_and_real_estate_rules():
    land = {"id": "land", "kind": "land", "label": "땅", "value": 100_000_000}
    result = run(
        flat(assets=[{"id": "cash", "kind": "cash", "label": "예금", "value": 72_000_000}, land])
    )
    assert result.funding.transferable_now == 0
    reasons = {e.key: e.reason for e in result.excluded}
    assert (
        reasons["cash_staged_deduction"]
        == reasons["cash_lump_now"]
        == ("생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요.")
    )
    assert reasons["realestate_gift_cash_staged"] == (
        "생활비·간병비를 떼어 두면 지금 넘길 현금이 없어요."
    )
    assert reasons["realestate_sell_cash_now"] == (
        "취득일·취득가액을 넣은 부동산이 없어 매각안을 계산하지 못했어요."
    )
    assert "realestate_gift_now" in {plan.key for plan in result.plans}


def test_negative_transferable_blocks_real_estate_gift_but_not_sale():
    land = {
        "id": "land",
        "kind": "land",
        "label": "땅",
        "value": 100_000_000,
        "acquiredOn": "2010-01-01",
        "acquisitionCost": 50_000_000,
    }
    result = run(
        flat(assets=[{"id": "cash", "kind": "cash", "label": "예금", "value": 10_000_000}, land])
    )
    assert result.funding.shortfall == 62_000_000
    reasons = {e.key: e.reason for e in result.excluded}
    message = "생활비·간병비가 현금보다 많아 부동산을 지금 넘기기 어려워요."
    assert reasons["realestate_gift_now"] == reasons["realestate_gift_cash_staged"] == message
    plans = by_key(result)
    sale = plans["realestate_sell_cash_now"]
    # 한도 = 현금 + 순 매각대금 − 필요 자금. 남은 한도만큼만 증여한다.
    limit = 10_000_000 + sale.sales[0].net_proceeds - 72_000_000
    assert [t.amount for t in sale.transfers if t.method == "sale_gift"] == [limit]


def test_unsold_notes_use_topic_particle():
    sold = {
        "id": "s",
        "kind": "land",
        "label": "임야",
        "value": 100_000_000,
        "acquiredOn": "2010-01-01",
        "acquisitionCost": 50_000_000,
    }
    assets = [{"id": "cash", "kind": "cash", "label": "예금", "value": 300_000_000}, sold]
    for index, label in enumerate(["상가", "땅", "B"]):
        assets.append({"id": f"u{index}", "kind": "land", "label": label, "value": 10_000_000})
    result = run(flat(assets=assets))
    assert result.notes[4:] == [
        "취득 정보가 없는 상가는 팔지 않고 계산했어요.",
        "취득 정보가 없는 땅은 팔지 않고 계산했어요.",
        "취득 정보가 없는 B은(는) 팔지 않고 계산했어요.",
    ]
    sale = by_key(result)["realestate_sell_cash_now"]
    assert [s.asset_id for s in sale.sales] == ["s"]
    assert {t.asset_id for t in sale.transfers if t.method == "inherit" and t.asset_id} == {
        "u0",
        "u1",
        "u2",
    }
    assert (topic("아파트"), topic("집")) == ("아파트는", "집은")


def test_care_health_spans_whole_life_and_survivor():
    data = flat(
        parents=[
            {"role": "father", "alive": True, "age": 85, "health": "normal"},
            {"role": "mother", "alive": True, "age": 80, "health": "care"},
        ]
    )
    result = run(data)
    # 어머니 80세 요양 중: 10.9 × 0.4 = 4.4 → 4년 < 아버지 6년이라 배우자는 생존하지 않는다.
    assert result.spouse_alive_at_horizon is False
    assert [row.care for row in result.funding.costs][:4] == [24_000_000] * 4
    assert result.parents[1].care_from == D0
    assert result.funding.survivor_need == 0


def test_validation_errors():
    def error(data):
        with pytest.raises(AppError) as info:
            run(data)
        return info.value.details[0].field, info.value.details[0].message

    assert error(case(CASE_A, baseDate="2026-05-09")) == (
        "baseDate",
        "2026년 5월 10일 이후 기준일만 계산할 수 있어요.",
    )
    assert error(case(CASE_B, ownerRole="father")) == (
        "ownerRole",
        "재산 명의자는 살아 계신 부모님이어야 해요.",
    )
    duplicated = case(CASE_A)
    duplicated["assets"][3]["id"] = "a1"
    assert error(duplicated)[0] == "assets.3.id"


# ── 10절 06 공개 함수 ───────────────────────────────────────────────


def test_estate_public_deduction_functions():
    recipient = Recipient(relation="child", birth_date=date(2010, 3, 1))
    gifts = [
        PriorGift(gifted_on=date(2024, 2, 1), donor_group="grandparents", amount=10_000_000),
        PriorGift(gifted_on=date(2016, 5, 1), donor_group="parents", amount=20_000_000),
    ]
    replayed = replay_gift_deductions(recipient, gifts)
    assert [(gift.gifted_on, deduction) for gift, deduction in replayed] == [
        (date(2016, 5, 1), 20_000_000),
        (date(2024, 2, 1), 0),
    ]
    status = calc_deduction_status(recipient, gifts, date(2026, 10, 16))
    pool = next(p for p in status.pools if p.category == "lineal_ascendant")
    assert (status.age, status.is_minor, status.adult_on) == (16, True, date(2029, 3, 1))
    assert (pool.limit, pool.used_within10y, pool.available) == (20_000_000, 0, 20_000_000)
    # 같은 날 기록은 입력 순서를 지킨다.
    same_day = [
        PriorGift(gifted_on=date(2026, 1, 1), donor_group="parents", amount=15_000_000),
        PriorGift(gifted_on=date(2026, 1, 1), donor_group="parents", amount=10_000_000),
    ]
    assert [d for _, d in replay_gift_deductions(recipient, same_day)] == [15_000_000, 5_000_000]
