from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.succession.models import SuccessionCase


def find_case(db: Session, user_id: UUID) -> SuccessionCase | None:
    return db.scalar(select(SuccessionCase).where(SuccessionCase.user_id == user_id))


def save(db: Session, row: SuccessionCase) -> None:
    db.add(row)
    db.flush()


def remove(db: Session, row: SuccessionCase) -> None:
    db.delete(row)
    db.flush()
