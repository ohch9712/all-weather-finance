"""공개 서비스: 순수 계산 진입점과 사용자 범위의 가족·기록 관리."""

from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import ValidationError
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.core.errors import AppError, field_error
from app.core.time import today_kst
from app.modules.estate import repository
from app.modules.estate.calculations import (
    CATEGORIES,
    age_on,
    calc_gift_tax,
    calc_inheritance_tax,
    compare_estate_plans,
    deduction_status,
    prior_inheritance,
    replay_gifts,
    simulate_gift_plan,
    validate_group,
)
from app.modules.estate.models import FamilyMember, GiftRecord
from app.modules.estate.rules.kr_2024_01_01 import RULES_2024_01_01 as RULES
from app.modules.estate.schemas import (
    CompareAssets,
    CompareMember,
    DeductionStatus,
    EstateCompareInput,
    GiftCreate,
    GiftInfo,
    GiftTaxInput,
    GiftTaxRequest,
    GiftUpdate,
    InheritancePrefill,
    MemberCreate,
    MemberInfo,
    MemberUpdate,
    PrefillAssets,
    PrefillMember,
    PriorGift,
    Recipient,
)

__all__ = [
    "calc_gift_tax",
    "calc_inheritance_tax",
    "compare_estate_plans",
    "simulate_gift_plan",
    "get_deduction_status",
    "list_members",
    "build_compare_input",
]


def _member(db: Session, user_id: UUID, member_id: UUID) -> FamilyMember:
    member = repository.find_member(db, user_id, member_id)
    if member is None:
        raise AppError(404, "NOT_FOUND", "가족을 찾을 수 없습니다.")
    return member


def _gift(db: Session, user_id: UUID, gift_id: UUID) -> GiftRecord:
    gift = repository.find_gift(db, user_id, gift_id)
    if gift is None:
        raise AppError(404, "NOT_FOUND", "증여 기록을 찾을 수 없습니다.")
    return gift


def member_recipient(db: Session, user_id: UUID, member_id: UUID) -> Recipient:
    return Recipient.model_validate(_member(db, user_id, member_id))


def member_info(row: FamilyMember) -> MemberInfo:
    age = age_on(row.birth_date, today_kst())
    return MemberInfo(
        **MemberCreate.model_validate(row).model_dump(),
        id=row.id,
        age=age,
        is_minor=None if age is None else age < RULES.minor_age,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_members(db: Session, user_id: UUID) -> list[MemberInfo]:
    return [member_info(row) for row in repository.list_members(db, user_id)]


def _validate_merged(model, values):
    try:
        return model.model_validate(values)
    except ValidationError as exc:
        error = exc.errors()[0]
        raise field_error(to_camel(str(error["loc"][0])), "입력값을 확인해 주세요.") from None


def _validate_member(data: MemberCreate) -> None:
    if data.relation in {"child", "grandchild"} and data.birth_date is None:
        raise field_error("birthDate", "자녀·손자녀의 생년월일은 필수입니다.")
    if data.birth_date and data.birth_date > today_kst():
        raise field_error("birthDate", "생년월일은 오늘 이하여야 합니다.")
    if data.parent_deceased and data.relation != "grandchild":
        raise field_error("parentDeceased", "부모 사망 여부는 손자녀에게만 적용합니다.")


def create_member(db: Session, user_id: UUID, data: MemberCreate) -> MemberInfo:
    _validate_member(data)
    row = FamilyMember(user_id=user_id, **data.model_dump())
    repository.save(db, row)
    db.commit()
    return member_info(row)


def update_member(db: Session, user_id: UUID, member_id: UUID, data: MemberUpdate) -> MemberInfo:
    row = _member(db, user_id, member_id)
    merged = _validate_merged(
        MemberCreate,
        {**MemberCreate.model_validate(row).model_dump(), **data.model_dump(exclude_unset=True)},
    )
    _validate_member(merged)
    for gift in repository.list_gifts(db, user_id, member_id):
        _validate_gift(merged, GiftCreate.model_validate(gift))
    for key, value in merged.model_dump().items():
        setattr(row, key, value)
    repository.save(db, row)
    db.commit()
    return member_info(row)


def delete_member(db: Session, user_id: UUID, member_id: UUID) -> None:
    repository.remove(db, _member(db, user_id, member_id))
    db.commit()


def prior_gifts(db: Session, user_id: UUID, member_id: UUID) -> list[PriorGift]:
    _member(db, user_id, member_id)
    return [PriorGift.model_validate(row) for row in repository.list_gifts(db, user_id, member_id)]


def _validate_gift(recipient: Recipient, data: GiftCreate) -> None:
    validate_group(recipient, data.donor_group)
    if data.gifted_on > today_kst() or (
        recipient.birth_date and data.gifted_on < recipient.birth_date
    ):
        raise field_error("giftedOn", "증여일은 수증자 생년월일 이후·오늘 이하로 입력해 주세요.")


def list_gifts(db: Session, user_id: UUID, recipient_id: UUID | None = None) -> list[GiftInfo]:
    if recipient_id:
        _member(db, user_id, recipient_id)
    rows = repository.list_gifts(db, user_id, recipient_id)
    computed = {}
    for member_id in {row.recipient_id for row in rows}:
        member = member_recipient(db, user_id, member_id)
        history = repository.list_gifts(db, user_id, member_id)
        replay = replay_gifts(member, [PriorGift.model_validate(row) for row in history])
        computed.update({row.id: result for row, result in zip(history, replay, strict=True)})
    return [
        GiftInfo(
            **GiftCreate.model_validate(row).model_dump(),
            id=row.id,
            user_id=row.user_id,
            deduction_category=row.deduction_category,
            computed_deduction=computed[row.id].deduction,
            computed_marriage_birth_deduction=computed[row.id].marriage_birth_deduction,
            estimated_tax=computed[row.id].estimated_tax,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def create_gift(db: Session, user_id: UUID, data: GiftCreate) -> GiftInfo:
    _validate_gift(member_recipient(db, user_id, data.recipient_id), data)
    row = GiftRecord(
        user_id=user_id, **data.model_dump(), deduction_category=CATEGORIES[data.donor_group]
    )
    repository.save(db, row)
    db.commit()
    return next(g for g in list_gifts(db, user_id, data.recipient_id) if g.id == row.id)


def update_gift(db: Session, user_id: UUID, gift_id: UUID, data: GiftUpdate) -> GiftInfo:
    row = _gift(db, user_id, gift_id)
    merged = _validate_merged(
        GiftCreate,
        {**GiftCreate.model_validate(row).model_dump(), **data.model_dump(exclude_unset=True)},
    )
    _validate_gift(member_recipient(db, user_id, merged.recipient_id), merged)
    for key, value in merged.model_dump().items():
        setattr(row, key, value)
    row.deduction_category = CATEGORIES[merged.donor_group]
    repository.save(db, row)
    db.commit()
    return next(g for g in list_gifts(db, user_id, merged.recipient_id) if g.id == gift_id)


def delete_gift(db: Session, user_id: UUID, gift_id: UUID) -> None:
    repository.remove(db, _gift(db, user_id, gift_id))
    db.commit()


def get_deduction_status(
    db: Session, user_id: UUID, member_id: UUID, as_of: date
) -> DeductionStatus:
    return deduction_status(
        member_recipient(db, user_id, member_id), prior_gifts(db, user_id, member_id), as_of
    )


def resolve_gift_input(db: Session, user_id: UUID, req: GiftTaxRequest) -> GiftTaxInput:
    if (req.member_id is None) == (req.recipient is None):
        raise field_error("memberId", "가족 또는 직접 입력 중 하나를 선택해 주세요.")
    recipient = member_recipient(db, user_id, req.member_id) if req.member_id else req.recipient
    records = (
        prior_gifts(db, user_id, req.member_id)
        if req.member_id and req.use_records
        else req.prior_gifts
        if not req.member_id
        else []
    )
    return GiftTaxInput(
        recipient=recipient,
        prior_gifts=records,
        **req.model_dump(
            include={"donor_group", "gifted_on", "amount", "appraisal_fee", "claim_marriage_birth"}
        ),
    )


def _prefill_assets(db: Session, user_id: UUID) -> PrefillAssets | None:
    try:
        from app.modules.allocation.service import get_asset_breakdown

        breakdown = get_asset_breakdown(db, user_id)
        included = breakdown.included_by_class
        return PrefillAssets(
            financial_assets=sum(included[key] for key in ("stock", "bond", "gold", "cash")),
            other_assets=included["other"],
            real_estate=breakdown.excluded_total,
        )
    except (ImportError, AttributeError):
        return None


def _compare_members(db: Session, user_id: UUID) -> list[CompareMember]:
    return [
        CompareMember(
            **Recipient.model_validate(m).model_dump(),
            id=m.id,
            display_name=m.display_name,
            prior_gifts=prior_gifts(db, user_id, m.id),
        )
        for m in repository.list_members(db, user_id)
    ]


def inheritance_prefill(db: Session, user_id: UUID) -> InheritancePrefill:
    members = _compare_members(db, user_id)
    return InheritancePrefill(
        assets=_prefill_assets(db, user_id),
        spouse=any(m.relation == "spouse" for m in members),
        children=[
            PrefillMember(
                member_id=m.id, display_name=m.display_name, age=age_on(m.birth_date, today_kst())
            )
            for m in members
            if m.relation == "child"
        ],
        grandchildren=[
            PrefillMember(
                member_id=m.id, display_name=m.display_name, age=age_on(m.birth_date, today_kst())
            )
            for m in members
            if m.relation == "grandchild"
        ],
        **prior_inheritance(members, {m.id: m.prior_gifts for m in members}, today_kst()),
    )


def build_compare_input(
    db: Session,
    user_id: UUID,
    *,
    base_date: date,
    horizon_years: int,
    growth_rate: Decimal,
    lump_sum_per_child: int,
    assets: CompareAssets | None = None,
) -> EstateCompareInput:
    members = _compare_members(db, user_id)
    if assets is None:
        prefill = _prefill_assets(db, user_id)
        if prefill is None:
            raise field_error("assets", "재산 금액을 입력해 주세요.")
        assets = CompareAssets(**prefill.model_dump(), debts=0)
    return EstateCompareInput(
        base_date=base_date,
        horizon_years=horizon_years,
        annual_growth_rate=growth_rate,
        assets=assets,
        spouse_alive=any(m.relation == "spouse" for m in members),
        members=members,
        lump_sum_per_child=lump_sum_per_child,
    )
