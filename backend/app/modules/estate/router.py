from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.core.errors import field_error
from app.core.time import today_kst
from app.modules.estate import service
from app.modules.estate.rules import get_active_rules
from app.modules.estate.schemas import (
    CompareRequest,
    DeductionStatus,
    EstateCompareResult,
    GiftCreate,
    GiftInfo,
    GiftList,
    GiftPlanInput,
    GiftPlanRequest,
    GiftPlanResult,
    GiftTaxRequest,
    GiftTaxResult,
    GiftUpdate,
    InheritancePrefill,
    InheritanceTaxInput,
    InheritanceTaxResult,
    MemberCreate,
    MemberInfo,
    MemberList,
    MemberUpdate,
    RulesInfo,
)

router = APIRouter(prefix="/estate", tags=["estate"])
JSON = [Depends(require_json)]


@router.get("/members", response_model=MemberList)
def members(db: DBSession, user: CurrentUser):
    return MemberList(items=service.list_members(db, user.id))


@router.post("/members", response_model=MemberInfo, status_code=201, dependencies=JSON)
def add_member(data: MemberCreate, db: DBSession, user: CurrentUser):
    return service.create_member(db, user.id, data)


@router.patch("/members/{member_id}", response_model=MemberInfo, dependencies=JSON)
def edit_member(member_id: UUID, data: MemberUpdate, db: DBSession, user: CurrentUser):
    return service.update_member(db, user.id, member_id, data)


@router.delete("/members/{member_id}", status_code=204, dependencies=JSON)
def remove_member(member_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_member(db, user.id, member_id)
    return Response(status_code=204)


@router.get("/gifts", response_model=GiftList)
def gifts(
    db: DBSession,
    user: CurrentUser,
    recipient_id: Annotated[UUID | None, Query(alias="recipientId")] = None,
):
    return GiftList(items=service.list_gifts(db, user.id, recipient_id))


@router.post("/gifts", response_model=GiftInfo, status_code=201, dependencies=JSON)
def add_gift(data: GiftCreate, db: DBSession, user: CurrentUser):
    return service.create_gift(db, user.id, data)


@router.patch("/gifts/{gift_id}", response_model=GiftInfo, dependencies=JSON)
def edit_gift(gift_id: UUID, data: GiftUpdate, db: DBSession, user: CurrentUser):
    return service.update_gift(db, user.id, gift_id, data)


@router.delete("/gifts/{gift_id}", status_code=204, dependencies=JSON)
def remove_gift(gift_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_gift(db, user.id, gift_id)
    return Response(status_code=204)


@router.get("/members/{member_id}/deductions", response_model=DeductionStatus)
def deductions(
    member_id: UUID,
    db: DBSession,
    user: CurrentUser,
    as_of: Annotated[date | None, Query(alias="asOf")] = None,
):
    return service.get_deduction_status(db, user.id, member_id, as_of or today_kst())


@router.post("/calc/gift-tax", response_model=GiftTaxResult, dependencies=JSON)
def gift_tax(data: GiftTaxRequest, db: DBSession, user: CurrentUser):
    return service.calc_gift_tax(service.resolve_gift_input(db, user.id, data))


@router.get("/inheritance/prefill", response_model=InheritancePrefill)
def prefill(db: DBSession, user: CurrentUser):
    return service.inheritance_prefill(db, user.id)


@router.post("/calc/inheritance-tax", response_model=InheritanceTaxResult, dependencies=JSON)
def inheritance_tax(data: InheritanceTaxInput, user: CurrentUser):
    return service.calc_inheritance_tax(data)


@router.post("/simulate/gift-plan", response_model=GiftPlanResult, dependencies=JSON)
def gift_plan(data: GiftPlanRequest, db: DBSession, user: CurrentUser):
    if (data.member_id is None) == (data.birth_date is None):
        raise field_error("memberId", "가족 또는 생년월일 중 하나를 입력해 주세요.")
    recipient = service.member_recipient(db, user.id, data.member_id) if data.member_id else None
    birth = recipient.birth_date if recipient else data.birth_date
    if birth is None:
        raise field_error("birthDate", "생년월일이 필요합니다.")
    return service.simulate_gift_plan(
        GiftPlanInput(
            birth_date=birth,
            start_date=data.start_date or today_kst(),
            recipient=recipient,
            prior_gifts=service.prior_gifts(db, user.id, data.member_id) if data.member_id else [],
            **data.model_dump(
                include={
                    "target_age",
                    "annual_return_rate",
                    "donor_group",
                    "expected_marriage_date",
                }
            ),
        )
    )


@router.post("/compare", response_model=EstateCompareResult, dependencies=JSON)
def compare(data: CompareRequest, db: DBSession, user: CurrentUser):
    req = service.build_compare_input(
        db,
        user.id,
        base_date=data.base_date or today_kst(),
        horizon_years=data.horizon_years,
        growth_rate=data.annual_growth_rate,
        lump_sum_per_child=data.lump_sum_per_child,
        assets=data.assets,
    )
    if data.spouse_alive is not None:
        req = req.model_copy(update={"spouse_alive": data.spouse_alive})
    return service.compare_estate_plans(req)


@router.get("/rules", response_model=RulesInfo)
def rules(user: CurrentUser):
    active = get_active_rules(today_kst())
    return {
        "version": active.version,
        "effectiveFrom": active.effective_from,
        "sources": [{"label": label, "url": url} for label, url in active.sources],
        "giftDeductions": {
            "spouse": active.spouse_gift,
            "linealAscendantAdult": active.adult_gift,
            "linealAscendantMinor": active.minor_gift,
            "linealDescendant": active.adult_gift,
            "otherRelative": active.relative_gift,
            "marriageBirth": active.marriage_birth,
        },
        "brackets": [
            {"upTo": b.up_to, "rate": str(b.rate), "progressiveDeduction": b.progressive_deduction}
            for b in active.brackets
        ],
    }
