from uuid import UUID

from sqlalchemy import delete, func, select
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


def count_other_admins(db: DBSession, user_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(User).where(User.role == "admin", User.id != user_id)
        )
        or 0
    )


def delete_user(db: DBSession, user_id: UUID) -> None:
    # 다른 사용자 테이블은 FK ON DELETE CASCADE(posts.author_id는 SET NULL)로 함께 정리된다.
    db.execute(delete(User).where(User.id == user_id))


def find_profile(db: DBSession, user_id: UUID) -> UserProfile | None:
    return db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))


def add(db: DBSession, entity) -> None:
    db.add(entity)
    db.flush()
