from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from app.modules.auth.models import Session, User, UserProfile


def find_user_by_email(db: DBSession, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def find_user(db: DBSession, user_id: UUID) -> User | None:
    return db.scalar(select(User).where(User.id == user_id))


def find_session(db: DBSession, token_hash: str) -> Session | None:
    return db.scalar(select(Session).where(Session.token_hash == token_hash))


def delete_session(db: DBSession, token_hash: str) -> None:
    db.execute(delete(Session).where(Session.token_hash == token_hash))


def find_profile(db: DBSession, user_id: UUID) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def add(db: DBSession, entity) -> None:
    db.add(entity)
    db.flush()
