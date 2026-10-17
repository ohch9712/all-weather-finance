"""상속·증여 도구(스펙 15 4절·4.1·5절).

get_gift_deductions, estimate_gift_tax, compare_estate_plans, plan_gifts, memberName 찾기
"""

from datetime import date
from decimal import Decimal

import pytest

from app.modules.chat.tools import estate as estate_tool
from app.modules.estate import service as estate_service
from app.modules.estate.schemas import EstateCompareInput, GiftPlanRequest, GiftTaxRequest
from tests.chat.tool_helpers import TODAY, Spy, add_gift, add_holding, add_member, run, tool_ctx

TAX_CARD_KEYS = {"type", "title", "steps", "payableTax", "href"}


def money(value: int) -> str:
    return f"{value:,}원"


# ── memberName 찾기 ──────────────────────────────────────────────────


def test_member_name_ignores_spaces(auth_client, db):
    add_member(auth_client, "첫째")
    result = run(tool_ctx(db), "get_gift_deductions", {"memberName": " 첫 째 "})
    assert [entry["name"] for entry in result.content["members"]] == ["첫째"]


def test_member_name_not_found_returns_candidates(auth_client, db):
    add_member(auth_client, "첫째")
    add_member(auth_client, "배우자", relation="spouse")
    result = run(tool_ctx(db), "estimate_gift_tax", {"memberName": "막내", "amount": 1000})
    assert not result.is_error
    assert result.content["status"] == "member_not_found"
    ages = {m.display_name: m.age for m in estate_service.list_members(db, tool_ctx(db).user.id)}
    candidates = sorted(result.content["candidates"], key=lambda item: item["name"])
    assert candidates == [
        {"name": "배우자", "relation": "spouse", "relationLabel": "배우자", "age": None},
        {"name": "첫째", "relation": "child", "relationLabel": "자녀", "age": ages["첫째"]},
    ]
    assert isinstance(ages["첫째"], int)
    assert result.card is None


def test_member_name_ambiguous_returns_matches(auth_client, db):
    add_member(auth_client, "첫째")
    add_member(auth_client, "첫 째", birthDate="2002-01-01")
    result = run(tool_ctx(db), "plan_gifts", {"memberName": "첫째"})
    assert result.content["status"] == "member_ambiguous"
    assert sorted(c["name"] for c in result.content["candidates"]) == ["첫 째", "첫째"]
    # 후보에 가족 ID를 넣지 않는다.
    assert all(
        set(c) == {"name", "relation", "relationLabel", "age"} for c in result.content["candidates"]
    )


def test_other_users_members_are_not_found(auth_client, other_auth_client, db):
    add_member(other_auth_client, "첫째")
    for name, arguments in [
        ("get_gift_deductions", {"memberName": "첫째"}),
        ("estimate_gift_tax", {"memberName": "첫째", "amount": 1000}),
        ("plan_gifts", {"memberName": "첫째"}),
    ]:
        result = run(tool_ctx(db), name, arguments)
        assert result.content["status"] == "no_members", name
    add_member(auth_client, "둘째")
    result = run(tool_ctx(db), "get_gift_deductions", {"memberName": "첫째"})
    assert result.content["status"] == "member_not_found"
    assert [c["name"] for c in result.content["candidates"]] == ["둘째"]


# ── get_gift_deductions ─────────────────────────────────────────────


def test_gift_deductions_all_members(auth_client, db, monkeypatch):
    first = add_member(auth_client, "첫째")
    add_member(auth_client, "배우자", relation="spouse")
    add_gift(auth_client, first["id"], 30_000_000, "2025-01-10")
    list_spy = Spy(monkeypatch, estate_service, "list_members")
    status_spy = Spy(monkeypatch, estate_service, "get_deduction_status")
    ctx = tool_ctx(db)
    result = run(ctx, "get_gift_deductions", {"memberName": None})
    assert list_spy.calls == [((db, ctx.user.id), {})]
    assert [call[0][3] for call in status_spy.calls] == [TODAY, TODAY]

    status = estate_service.get_deduction_status(db, ctx.user.id, first["id"], TODAY)
    entry = next(item for item in result.content["members"] if item["name"] == "첫째")
    pool = entry["pools"][0]
    assert pool["category"] == "lineal_ascendant" and pool["categoryLabel"] == "직계존속"
    assert pool["usedWithin10y"] == status.pools[0].used_within10y == 30_000_000
    assert pool["available"] == status.pools[0].available
    assert "id" not in entry and "memberId" not in entry

    card = result.card
    assert card["type"] == "table" and card["href"] == "/estate?tab=deductions"
    assert card["title"] == "증여재산공제 현황 (2026.10.17 기준)"
    row = next(row for row in card["rows"] if row["member"] == "첫째")
    assert row == {
        "member": "첫째",
        "category": "직계존속",
        "limit": money(status.pools[0].limit),
        "used": "30,000,000원",
        "available": money(status.pools[0].available),
        "resetOn": "2035.01.11",
    }
    assert [column["key"] for column in card["columns"]] == list(row)


def test_gift_deductions_without_members(auth_client, db):
    result = run(tool_ctx(db), "get_gift_deductions", {"memberName": None})
    assert result.content["status"] == "no_members"
    assert result.card is None


# ── estimate_gift_tax ───────────────────────────────────────────────


def test_estimate_gift_tax_for_member_uses_records(auth_client, db, monkeypatch):
    first = add_member(auth_client, "첫째")
    add_gift(auth_client, first["id"], 30_000_000, "2025-01-10")
    resolve = Spy(monkeypatch, estate_service, "resolve_gift_input")
    calc = Spy(monkeypatch, estate_service, "calc_gift_tax")
    ctx = tool_ctx(db)
    result = run(ctx, "estimate_gift_tax", {"memberName": "첫째", "amount": 100_000_000})

    (args, _) = resolve.calls[0]
    assert args[:2] == (db, ctx.user.id)
    request = args[2]
    assert isinstance(request, GiftTaxRequest)
    assert str(request.member_id) == first["id"] and request.recipient is None
    assert (request.donor_group, request.gifted_on, request.amount) == (
        "parents",
        TODAY,
        100_000_000,
    )
    assert len(calc.calls) == 1
    expected = estate_service.calc_gift_tax(
        estate_service.resolve_gift_input(db, ctx.user.id, request)
    )

    content = result.content
    assert content["payableTax"] == expected.payable_tax
    assert content["priorGiftCount"] == 1
    assert content["recipient"]["name"] == "첫째"
    assert [step["label"] for step in content["steps"]] == [step.label for step in expected.steps]
    assert content["assumptions"] == expected.assumptions
    assert "참고용 추정" in content["summary"]

    card = result.card
    assert set(card) == TAX_CARD_KEYS
    assert card["type"] == "gift_tax" and card["href"] == "/estate?tab=gift-tax"
    assert card["title"] == "첫째 증여세 계산"
    assert card["payableTax"] == money(expected.payable_tax)
    assert card["steps"] == [
        {"label": step.label, "amount": money(step.amount), "note": step.note}
        for step in expected.steps
    ]


def test_estimate_gift_tax_direct_recipient(auth_client, db, monkeypatch):
    resolve = Spy(monkeypatch, estate_service, "resolve_gift_input")
    result = run(
        tool_ctx(db),
        "estimate_gift_tax",
        {
            "memberName": None,
            "relation": "child",
            "birthDate": "2010-05-05",
            "donorGroup": "parents",
            "amount": 50_000_000,
            "giftedOn": "2026-09-01",
        },
    )
    request = resolve.calls[0][0][2]
    assert request.member_id is None
    assert request.recipient.relation == "child"
    assert request.recipient.birth_date == date(2010, 5, 5)
    assert request.gifted_on == date(2026, 9, 1)
    assert result.content["recipient"] == {
        "name": None,
        "relation": "child",
        "relationLabel": "자녀",
        "birthDate": "2010-05-05",
    }
    assert result.card["title"] == "자녀 증여세 계산"


@pytest.mark.parametrize(
    ("arguments", "field", "message"),
    [
        (
            {"relation": "spouse", "donorGroup": "parents", "amount": 1000},
            "donorGroup",
            "이 가족에게 맞지 않는 증여자입니다.",
        ),
        (
            {
                "relation": "child",
                "birthDate": "2000-01-01",
                "amount": 1000,
                "giftedOn": "2023-12-31",
            },
            "giftedOn",
            "2024년 1월 1일 이후 증여만 계산할 수 있어요.",
        ),
        (
            {"relation": "child", "amount": 1000},
            "birthDate",
            "직계존속 공제를 계산하려면 생년월일이 필요합니다.",
        ),
    ],
)
def test_estimate_gift_tax_validation_errors_are_status(auth_client, db, arguments, field, message):
    result = run(tool_ctx(db), "estimate_gift_tax", arguments)
    assert not result.is_error
    assert result.content == {
        "status": "invalid_input",
        "message": "입력값을 확인해 주세요.",
        "details": [{"field": field, "message": message}],
    }
    assert result.card is None


def test_estimate_gift_tax_input_validation(auth_client, db):
    for arguments in (
        {"amount": 0},
        {"amount": "1억"},
        {"amount": 1000, "donorGroup": "friend"},
        {"amount": 1000, "member_name": "첫째"},
        {},
    ):
        result = run(tool_ctx(db), "estimate_gift_tax", arguments)
        assert result.is_error and "INVALID_INPUT" in result.content, arguments


# ── compare_estate_plans ────────────────────────────────────────────


def test_compare_defaults_match_estate():
    fields = EstateCompareInput.model_fields
    assert estate_tool.DEFAULT_HORIZON_YEARS == fields["horizon_years"].default
    assert estate_tool.DEFAULT_GROWTH_RATE == fields["annual_growth_rate"].default
    assert estate_tool.DEFAULT_LUMP_SUM_PER_CHILD == fields["lump_sum_per_child"].default
    plan = GiftPlanRequest.model_fields
    assert estate_tool.DEFAULT_TARGET_AGE == plan["target_age"].default
    assert estate_tool.DEFAULT_RETURN_RATE == plan["annual_return_rate"].default


def test_compare_without_assets_is_status(auth_client, other_auth_client, db):
    add_member(auth_client, "첫째")
    add_holding(other_auth_client, "cash", 500_000_000)  # 다른 사용자 자산은 섞이지 않는다
    result = run(tool_ctx(db), "compare_estate_plans", {})
    assert not result.is_error
    assert result.content == {
        "status": "assets_required",
        "message": "자산배분에 자산을 입력하거나 상속·증여 화면에서 재산을 입력해 주세요",
    }
    assert result.card is None


def test_compare_without_family_is_invalid_input(auth_client, db):
    add_holding(auth_client, "cash", 500_000_000)
    result = run(tool_ctx(db), "compare_estate_plans", {})
    assert result.content["status"] == "invalid_input"
    assert result.content["details"] == [
        {"field": "children", "message": "자녀나 배우자를 먼저 가족에 등록해 주세요."}
    ]


def test_compare_card_and_defaults(auth_client, db, monkeypatch):
    add_holding(auth_client, "cash", 800_000_000)
    add_holding(auth_client, "other", 300_000_000, include=False)
    add_member(auth_client, "첫째")
    add_member(auth_client, "배우자", relation="spouse")
    build = Spy(monkeypatch, estate_service, "build_compare_input")
    compare = Spy(monkeypatch, estate_service, "compare_estate_plans")
    ctx = tool_ctx(db)
    result = run(ctx, "compare_estate_plans", {})
    (args, kwargs) = build.calls[0]
    assert args == (db, ctx.user.id)
    assert kwargs == {
        "base_date": TODAY,
        "horizon_years": 20,
        "growth_rate": Decimal("3"),
        "lump_sum_per_child": 100_000_000,
    }
    compare_input = compare.calls[0][0][0]
    expected = estate_service.compare_estate_plans(compare_input)

    content = result.content
    assert content["assets"]["financialAssets"] == 800_000_000
    assert content["assets"]["realEstate"] == 300_000_000
    assert content["recommendedKey"] == expected.recommended_key
    assert [s["key"] for s in content["scenarios"]] == [s.key for s in expected.scenarios]
    assert content["notes"] == expected.notes and content["assumptions"] == expected.assumptions
    assert "세무 전문가" in content["summary"]

    card = result.card
    assert set(card) == {"type", "title", "horizonDate", "rows", "href"}
    assert card["type"] == "comparison" and card["href"] == "/estate?tab=compare"
    assert card["horizonDate"] == "2046.10.17"
    assert card["rows"] == [
        {
            "key": scenario.key,
            "label": scenario.label,
            "totalTax": money(scenario.total_tax),
            "familyReceives": money(scenario.family_receives),
            "recommended": scenario.key == expected.recommended_key,
        }
        for scenario in expected.scenarios
    ]
    assert sum(row["recommended"] for row in card["rows"]) == 1


def test_compare_custom_arguments(auth_client, db, monkeypatch):
    add_holding(auth_client, "cash", 800_000_000)
    add_member(auth_client, "첫째")
    build = Spy(monkeypatch, estate_service, "build_compare_input")
    result = run(
        tool_ctx(db),
        "compare_estate_plans",
        {"horizonYears": 10, "annualGrowthRate": "2.5", "lumpSumPerChild": 50_000_000},
    )
    assert not result.is_error
    kwargs = build.calls[0][1]
    assert (kwargs["horizon_years"], kwargs["growth_rate"], kwargs["lump_sum_per_child"]) == (
        10,
        Decimal("2.5"),
        50_000_000,
    )
    assert result.card["horizonDate"] == "2036.10.17"


@pytest.mark.parametrize(
    "arguments",
    [{"annualGrowthRate": "abc"}, {"annualGrowthRate": "11"}, {"horizonYears": 41}, {"x": 1}],
)
def test_compare_input_validation(auth_client, db, arguments):
    result = run(tool_ctx(db), "compare_estate_plans", arguments)
    assert result.is_error and "INVALID_INPUT" in result.content


# ── plan_gifts ──────────────────────────────────────────────────────


def test_plan_gifts_for_member(auth_client, db, monkeypatch):
    child = add_member(auth_client, "둘째", birthDate="2020-05-05")
    add_gift(auth_client, child["id"], 10_000_000, "2025-02-01")
    recipient = Spy(monkeypatch, estate_service, "member_recipient")
    prior = Spy(monkeypatch, estate_service, "prior_gifts")
    simulate = Spy(monkeypatch, estate_service, "simulate_gift_plan")
    ctx = tool_ctx(db)
    result = run(
        ctx, "plan_gifts", {"memberName": "둘째", "targetAge": 25, "annualReturnRate": "5"}
    )
    assert [str(call[0][2]) for call in recipient.calls] == [child["id"]]
    assert [str(call[0][2]) for call in prior.calls] == [child["id"]]
    plan_input = simulate.calls[0][0][0]
    assert plan_input.birth_date == date(2020, 5, 5)
    assert plan_input.start_date == TODAY
    assert plan_input.target_age == 25
    assert plan_input.annual_return_rate == Decimal("5")
    assert plan_input.donor_group == "parents"
    assert plan_input.recipient.relation == "child"
    assert len(plan_input.prior_gifts) == 1
    expected = estate_service.simulate_gift_plan(plan_input)

    content = result.content
    assert content["totalGifted"] == expected.total_gifted
    assert content["totalTax"] == expected.total_tax
    assert len(content["schedule"]) == len(expected.schedule)
    assert content["assumptions"] == expected.assumptions

    card = result.card
    assert card["type"] == "table" and card["href"] == "/estate?tab=plan"
    assert card["title"] == "둘째 분산 증여 플랜"
    assert card["rows"][0] == {
        "giftOn": expected.schedule[0].gift_on.strftime("%Y.%m.%d"),
        "age": f"{expected.schedule[0].age}세",
        "amount": money(expected.schedule[0].amount),
        "deduction": "기본 공제",
        "tax": money(expected.schedule[0].tax),
    }
    assert money(expected.lump_sum.payable_tax) in card["footnote"]


def test_plan_gifts_by_birth_date_and_defaults(auth_client, db, monkeypatch):
    simulate = Spy(monkeypatch, estate_service, "simulate_gift_plan")
    result = run(tool_ctx(db), "plan_gifts", {"birthDate": "2018-01-01"})
    assert not result.is_error
    plan_input = simulate.calls[0][0][0]
    assert plan_input.recipient is None and plan_input.prior_gifts == []
    assert (plan_input.target_age, plan_input.annual_return_rate) == (30, Decimal("4"))
    assert result.card["title"] == "수증자 분산 증여 플랜"


def test_plan_gifts_grandchild_uses_grandparents(auth_client, db, monkeypatch):
    add_member(auth_client, "손주", relation="grandchild", birthDate="2022-01-01")
    simulate = Spy(monkeypatch, estate_service, "simulate_gift_plan")
    run(tool_ctx(db), "plan_gifts", {"memberName": "손주"})
    assert simulate.calls[0][0][0].donor_group == "grandparents"


def test_plan_gifts_requires_one_of_member_or_birth_date(auth_client, db):
    add_member(auth_client, "둘째", birthDate="2020-05-05")
    expected = {
        "status": "invalid_input",
        "message": "입력값을 확인해 주세요.",
        "details": [
            {"field": "memberId", "message": "가족 또는 생년월일 중 하나를 입력해 주세요."}
        ],
    }
    assert run(tool_ctx(db), "plan_gifts", {}).content == expected
    both = run(tool_ctx(db), "plan_gifts", {"memberName": "둘째", "birthDate": "2020-05-05"})
    assert both.content == expected


def test_plan_gifts_input_validation(auth_client, db):
    for arguments in ({"birthDate": "2018-01-01", "targetAge": 18}, {"annualReturnRate": "21"}):
        result = run(tool_ctx(db), "plan_gifts", arguments)
        assert result.is_error and "INVALID_INPUT" in result.content
