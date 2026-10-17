from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.estate.models import FamilyMember, GiftRecord


def list_members(db: Session, user_id: UUID) -> list[FamilyMember]:
    return list(
        db.scalars(
            select(FamilyMember)
            .where(FamilyMember.user_id == user_id)
            .order_by(FamilyMember.created_at, FamilyMember.id)
        )
    )


def find_member(db: Session, user_id: UUID, member_id: UUID) -> FamilyMember | None:
    return db.scalar(
        select(FamilyMember).where(FamilyMember.user_id == user_id, FamilyMember.id == member_id)
    )


def list_gifts(db: Session, user_id: UUID, recipient_id: UUID | None = None) -> list[GiftRecord]:
    query = select(GiftRecord).where(GiftRecord.user_id == user_id)
    if recipient_id is not None:
        query = query.where(GiftRecord.recipient_id == recipient_id)
    return list(
        db.scalars(query.order_by(GiftRecord.gifted_on, GiftRecord.created_at, GiftRecord.id))
    )


def find_gift(db: Session, user_id: UUID, gift_id: UUID) -> GiftRecord | None:
    return db.scalar(
        select(GiftRecord).where(GiftRecord.user_id == user_id, GiftRecord.id == gift_id)
    )


def save(db: Session, row: FamilyMember | GiftRecord) -> None:
    db.add(row)
    db.flush()


def remove(db: Session, row: FamilyMember | GiftRecord) -> None:
    db.delete(row)
    db.flush()
