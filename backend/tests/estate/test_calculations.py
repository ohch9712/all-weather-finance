from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.errors import AppError
from app.modules.estate.calculations import (
    add_years,
    deduction_status,
    replay_gifts,
)
from app.modules.estate.rules import get_active_rules
from app.modules.estate.schemas import (
    CompareAssets,
    CompareMember,
    EstateCompareInput,
    GiftPlanInput,
    GiftTaxInput,
    InheritanceChild,
    InheritanceTaxInput,
    PriorGift,
    Recipient,
)
from app.modules.estate.service import (
    calc_gift_tax,
    calc_inheritance_tax,
    compare_estate_plans,
    simulate_gift_plan,
)

DAY = date(2026, 10, 16)
ADULT = Recipient(birth_date=date(1996, 5, 1))
MINOR = Recipient(birth_date=date(2010, 3, 1))


@pytest.mark.parametrize(
    "recipient,group,amount,prior,claim,expected",
    [
        (ADULT, "parents", 50_000_000, [], False, (0, 0, 0, 0, 0)),
        (ADULT, "parents", 100_000_000, [], False, (50_000_000, 5_000_000, 0, 150_000, 4_850_000)),
        (
            ADULT,
            "parents",
            300_000_000,
            [],
            False,
            (250_000_000, 40_000_000, 0, 1_200_000, 38_800_000),
        ),
        (MINOR, "parents", 30_000_000, [], False, (10_000_000, 1_000_000, 0, 30_000, 970_000)),
        (
            ADULT,
            "grandparents",
            100_000_000,
            [],
            False,
            (50_000_000, 5_000_000, 1_500_000, 195_000, 6_305_000),
        ),
        (
            Recipient(relation="spouse"),
            "spouse",
            700_000_000,
            [],
            False,
            (100_000_000, 10_000_000, 0, 300_000, 9_700_000),
        ),
        (
            ADULT,
            "parents",
            50_000_000,
            [PriorGift(gifted_on=date(2024, 10, 16), donor_group="parents", amount=30_000_000)],
            False,
            (30_000_000, 3_000_000, 0, 90_000, 2_910_000),
        ),
        (
            ADULT.model_copy(update={"married_on": date(2026, 5, 16)}),
            "parents",
            150_000_000,
            [],
            True,
            (0, 0, 0, 0, 0),
        ),
        (ADULT, "parents", 50_400_000, [], False, (400_000, 0, 0, 0, 0)),
        (
            ADULT,
            "parents",
            100_000_000,
            [
                PriorGift(
                    gifted_on=date(2024, 10, 16), donor_group="grandparents", amount=20_000_000
                )
            ],
            False,
            (70_000_000, 7_000_000, 0, 210_000, 6_790_000),
        ),
    ],
)
def test_gift_examples(recipient, group, amount, prior, claim, expected):
    result = calc_gift_tax(
        GiftTaxInput(
            recipient=recipient,
            donor_group=group,
            gifted_on=DAY,
            amount=amount,
            prior_gifts=prior,
            claim_marriage_birth=claim,
        )
    )
    assert (
        result.tax_base,
        result.calculated_tax,
        result.surcharge,
        result.filing_credit,
        result.payable_tax,
    ) == expected
    assert [s.key for s in result.steps] == [
        "giftAmount",
        "aggregatedPrior",
        "taxableValue",
        "deduction",
        "marriageBirthDeduction",
        "appraisalFee",
        "taxBase",
        "calculatedTax",
        "surcharge",
        "priorTaxCredit",
        "filingCredit",
        "payableTax",
    ]
    assert all(s.note for s in result.steps)


def test_replay_example():
    gifts = [
        PriorGift(gifted_on=date(2016, 5, 1), donor_group="parents", amount=20_000_000),
        PriorGift(gifted_on=date(2024, 2, 1), donor_group="grandparents", amount=10_000_000),
    ]
    replayed = replay_gifts(MINOR, gifts)
    assert [r.deduction for r in replayed] == [20_000_000, 0]
    assert replayed[1].estimated_tax == 1_261_000
    status = deduction_status(MINOR, gifts, DAY)
    assert (status.age, status.is_minor, status.adult_on) == (16, True, date(2029, 3, 1))
    assert (status.pools[0].limit, status.pools[0].used_within10y, status.pools[0].available) == (
        20_000_000,
        0,
        20_000_000,
    )


@pytest.mark.parametrize(
    "spouse,ages,financial,real,funeral,expected",
    [
        (True, [35, 32], 300_000_000, 700_000_000, 10_000_000, (990_000_000, 990_000_000, 0, 0, 0)),
        (
            True,
            [35, 32],
            500_000_000,
            2_500_000_000,
            10_000_000,
            (2_990_000_000, 1_885_714_285, 1_104_285_715, 281_714_286, 273_262_858),
        ),
        (
            False,
            [35],
            100_000_000,
            700_000_000,
            3_000_000,
            (795_000_000, 520_000_000, 275_000_000, 45_000_000, 43_650_000),
        ),
        (True, [], 0, 700_000_000, 0, (695_000_000, 695_000_000, 0, 0, 0)),
        (
            False,
            [10],
            200_000_000,
            1_300_000_000,
            0,
            (1_495_000_000, 540_000_000, 955_000_000, 226_500_000, 219_705_000),
        ),
    ],
)
def test_inheritance_examples(spouse, ages, financial, real, funeral, expected):
    result = calc_inheritance_tax(
        InheritanceTaxInput(
            spouse_alive=spouse,
            children=[InheritanceChild(age=a) for a in ages],
            financial_assets=financial,
            real_estate=real,
            funeral_expense=funeral,
        )
    )
    assert (
        result.taxable_value,
        result.applied_deduction,
        result.tax_base,
        result.calculated_tax,
        result.payable_tax,
    ) == expected
    if not ages:
        assert result.lump_sum_deduction == 0


def test_gift_plan_example():
    result = simulate_gift_plan(
        GiftPlanInput(
            birth_date=date(2026, 1, 1),
            start_date=DAY,
            target_age=30,
            annual_return_rate=Decimal("5"),
        )
    )
    assert result.end_date == date(2056, 12, 31)
    assert [(g.gift_on, g.age, g.amount) for g in result.schedule] == [
        (date(2026, 10, 16), 0, 20_000_000),
        (date(2036, 10, 17), 10, 20_000_000),
        (date(2046, 10, 18), 20, 50_000_000),
        (date(2056, 10, 19), 30, 50_000_000),
    ]
    assert (result.total_gifted, result.total_tax) == (140_000_000, 0)
    assert abs(result.future_value - 273_828_999) <= 100
    assert (result.lump_sum.tax_base, result.lump_sum.payable_tax) == (90_000_000, 8_730_000)


def member(name, birth, relation="child", prior=None):
    return CompareMember(
        id=uuid4(), display_name=name, birth_date=birth, relation=relation, prior_gifts=prior or []
    )


def compare_input(**kwargs):
    return EstateCompareInput(
        base_date=DAY,
        assets=CompareAssets(financial_assets=600_000_000, real_estate=900_000_000, other_assets=0),
        spouse_alive=True,
        members=[
            member("첫째", date(1991, 3, 1)),
            member("둘째", date(1994, 7, 15)),
            member("손주", date(2020, 5, 5), "grandchild"),
        ],
        **kwargs,
    )


def assert_scenarios(result, expected):
    # 스펙 8.1 표 열 순서: 증여세 합계, T 상속재산, 상속세, 총 세금, 증여 자산 T 가치,
    # 증여세 T 가치, 상속 시점 기준 총 세금, 가족에게 남는 금액
    assert [s.key for s in result.scenarios] == [key for key, _ in expected]
    for actual, (_, values) in zip(result.scenarios, expected, strict=True):
        for value, want in zip(
            (
                actual.gift_tax_total,
                actual.estate_at_horizon,
                actual.inheritance_tax,
                actual.total_tax,
                actual.gifts_value_at_horizon,
                actual.gift_tax_at_horizon,
                actual.total_tax_at_horizon,
                actual.family_receives,
            ),
            values,
            strict=True,
        ):
            assert abs(value - want) <= 1000
        assert actual.total_tax_at_horizon == actual.gift_tax_at_horizon + actual.inheritance_tax
        assert actual.family_receives == (
            actual.estate_at_horizon
            - actual.inheritance_tax
            + actual.gifts_value_at_horizon
            - actual.gift_tax_at_horizon
        )


def test_compare_example_one():
    result = compare_estate_plans(compare_input())
    assert_scenarios(
        result,
        [
            (
                "inherit_only",
                (0, 2_710_264_056, 187_323_195, 187_323_195, 0, 0, 187_323_195, 2_522_940_861),
            ),
            (
                "staged_children",
                (
                    0,
                    2_395_177_266,
                    165_000_438,
                    165_000_438,
                    315_086_790,
                    0,
                    165_000_438,
                    2_545_263_618,
                ),
            ),
            (
                "lump_sum_now",
                (
                    9_700_000,
                    2_348_895_516,
                    143_369_471,
                    153_069_471,
                    361_368_540,
                    17_526_374,
                    160_895_845,
                    2_549_368_211,
                ),
            ),
            (
                "staged_grandchildren",
                (
                    0,
                    2_647_246_698,
                    176_844_308,
                    176_844_308,
                    63_017_358,
                    0,
                    176_844_308,
                    2_533_419_748,
                ),
            ),
        ],
    )
    assert result.recommended_key == "lump_sum_now"
    assert [(g.amount, g.gift_tax) for g in result.scenarios[2].gifts] == [
        (100_000_000, 4_850_000),
        (100_000_000, 4_850_000),
    ]
    assert (
        "증여할 때 낸 증여세도 상속 시점까지 연 3%로 불려 총 세금과 가족에게 남는 금액에 "
        "반영했어요." in result.notes
    )
    assert [g.gift_on for g in result.scenarios[1].gifts] == [
        DAY,
        DAY,
        date(2036, 10, 17),
        date(2036, 10, 17),
    ]
    assert abs(result.scenarios[1].inheritance.taxable_value - 2_490_177_266) <= 1000


def test_compare_example_two():
    req = compare_input(horizon_years=5, annual_growth_rate=Decimal("0")).model_copy(
        update={
            "assets": CompareAssets(
                financial_assets=300_000_000, real_estate=500_000_000, other_assets=0
            ),
            "spouse_alive": False,
            "members": [member("자녀", date(1994, 7, 15))],
        }
    )
    result = compare_estate_plans(req)
    assert [
        (s.gift_tax_total, s.estate_at_horizon, s.inheritance_tax, s.total_tax, s.family_receives)
        for s in result.scenarios
    ] == [
        (0, 800_000_000, 35_890_000, 35_890_000, 764_110_000),
        (0, 750_000_000, 37_830_000, 37_830_000, 762_170_000),
        (4_850_000, 700_000_000, 35_065_500, 39_915_500, 760_084_500),
    ]
    assert result.recommended_key == "inherit_only"
    # 증가율 0%면 증여세를 불려도 낸 금액과 같다(17절).
    for s in result.scenarios:
        assert s.gift_tax_at_horizon == s.gift_tax_total
        assert s.total_tax_at_horizon == s.total_tax


def test_compare_example_three_gift_tax_timing():
    result = compare_estate_plans(compare_input(horizon_years=40, lump_sum_per_child=500_000_000))
    assert result.horizon_date == date(2066, 10, 16)
    lump = result.scenarios[2]
    assert [(g.display_name, g.gift_on, g.amount, g.gift_tax) for g in lump.gifts] == [
        ("첫째", DAY, 500_000_000, 77_600_000),
        ("둘째", DAY, 100_000_000, 4_850_000),
    ]
    # 증여세 합계, 증여세 T 가치, 상속세, 총 세금, 상속 시점 기준 총 세금, 가족에게 남는 금액
    expected = [
        ("inherit_only", (0, 0, 656_999_477, 656_999_477, 656_999_477, 4_240_021_360)),
        ("staged_children", (0, 0, 483_098_314, 483_098_314, 483_098_314, 4_413_922_523)),
        (
            "lump_sum_now",
            (82_450_000, 269_172_911, 300_303_687, 382_753_687, 569_476_598, 4_327_544_239),
        ),
        (
            "staged_grandchildren",
            (0, 0, 596_830_580, 596_830_580, 596_830_580, 4_300_190_257),
        ),
    ]
    assert [s.key for s in result.scenarios] == [key for key, _ in expected]
    for actual, (_, values) in zip(result.scenarios, expected, strict=True):
        for value, want in zip(
            (
                actual.gift_tax_total,
                actual.gift_tax_at_horizon,
                actual.inheritance_tax,
                actual.total_tax,
                actual.total_tax_at_horizon,
                actual.family_receives,
            ),
            values,
            strict=True,
        ):
            assert abs(value - want) <= 1000
    assert result.recommended_key == "staged_children"


def test_compare_conditions_budget_prior_and_tie():
    req = compare_input().model_copy(
        update={
            "members": [],
            "assets": CompareAssets(financial_assets=0, real_estate=0, other_assets=0),
        }
    )
    assert len(compare_estate_plans(req).scenarios) == 1
    req = req.model_copy(
        update={"members": [member("날짜 없음", None), member("자녀", date(1990, 1, 1))]}
    )
    result = compare_estate_plans(req)
    assert result.recommended_key == "inherit_only"
    assert "생년월일이 없는 가족 1명은 계산에서 뺐어요." in result.notes
    req = compare_input().model_copy(
        update={
            "assets": CompareAssets(financial_assets=35_000_000, real_estate=0, other_assets=0),
            "members": [
                member(
                    "자녀",
                    date(1990, 1, 1),
                    prior=[
                        PriorGift(
                            gifted_on=date(2025, 1, 1),
                            donor_group="grandparents",
                            amount=30_000_000,
                        )
                    ],
                )
            ],
        }
    )
    result = compare_estate_plans(req)
    assert result.scenarios[1].gifts[0].amount == 20_000_000
    assert all(s.total_gifted <= 35_000_000 for s in result.scenarios)
    with pytest.raises(AppError):
        compare_estate_plans(req.model_copy(update={"spouse_alive": False, "members": []}))


@pytest.mark.parametrize("amount,aggregated", [(9_999_999, 0), (10_000_000, 10_000_000)])
def test_aggregation_boundary(amount, aggregated):
    req = GiftTaxInput(
        recipient=ADULT,
        gifted_on=DAY,
        amount=60_000_000,
        prior_gifts=[
            PriorGift(gifted_on=DAY - timedelta(days=1), donor_group="parents", amount=amount)
        ],
    )
    assert calc_gift_tax(req).taxable_value == 60_000_000 + aggregated


def test_age_marriage_minimum_surcharge_and_credit_boundaries():
    birthday = date(2029, 3, 1)
    assert deduction_status(MINOR, [], birthday - timedelta(days=1)).pools[0].limit == 20_000_000
    assert deduction_status(MINOR, [], birthday).pools[0].limit == 50_000_000
    married = ADULT.model_copy(update={"married_on": DAY})
    for day in (add_years(DAY, -2), add_years(DAY, 2)):
        assert (
            calc_gift_tax(
                GiftTaxInput(
                    recipient=married, gifted_on=day, amount=150_000_000, claim_marriage_birth=True
                )
            ).payable_tax
            == 0
        )
    for day in (add_years(DAY, -2) - timedelta(days=1), add_years(DAY, 2) + timedelta(days=1)):
        assert (
            calc_gift_tax(
                GiftTaxInput(
                    recipient=married, gifted_on=day, amount=150_000_000, claim_marriage_birth=True
                )
            ).marriage_birth_deduction
            == 0
        )
    assert (
        calc_gift_tax(GiftTaxInput(recipient=ADULT, gifted_on=DAY, amount=50_500_000)).payable_tax
        == 48_500
    )
    req = GiftTaxInput(
        recipient=MINOR, gifted_on=DAY, amount=2_000_000_001, donor_group="grandparents"
    )
    r = calc_gift_tax(req)
    assert r.surcharge == int(Decimal(r.calculated_tax) * Decimal("0.4"))
    assert (
        calc_gift_tax(
            req.model_copy(update={"recipient": MINOR.model_copy(update={"parent_deceased": True})})
        ).surcharge
        == 0
    )
    inherited = calc_inheritance_tax(
        InheritanceTaxInput(
            financial_assets=100_000_000,
            children=[InheritanceChild(age=30)],
            prior_gifts_to_heirs10y=500_000_000,
            prior_gift_deductions=50_000_000,
        )
    )
    assert inherited.applied_deduction == inherited.deduction_limit == 145_000_000
    with pytest.raises(AppError):
        get_active_rules(date(2023, 12, 31))


def test_plan_uses_existing_records_and_marriage():
    req = GiftPlanInput(
        birth_date=date(2000, 1, 1),
        start_date=DAY,
        target_age=40,
        expected_marriage_date=date(2027, 1, 1),
        prior_gifts=[
            PriorGift(gifted_on=date(2020, 1, 1), donor_group="parents", amount=50_000_000)
        ],
    )
    result = simulate_gift_plan(req)
    assert result.schedule[0].deduction_type == "marriage"
    assert result.schedule[1].gift_on == date(2030, 1, 2)
