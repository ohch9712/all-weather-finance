from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain import AgeBand
from app.core.errors import AppError
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from app.core.time import now_utc, today_kst
from app.modules.auth import repository
from app.modules.auth.models import Session as AuthSession
from app.modules.auth.models import User, UserProfile
from app.modules.auth.schemas import AuthPayload, ProfileOut, ProfileUpdate, SignupRequest, UserOut


@dataclass(frozen=True)
class ProfileInfo:
    birth_year: int | None
    age: int | None
    age_band: AgeBand | None
    nickname: str | None


def compute_age_band(birth_year: int, today: date) -> AgeBand:
    age = today.year - birth_year
    return AgeBand(f"{min(60, max(20, age // 10 * 10))}s")


def get_profile(db: Session, user_id: UUID) -> ProfileInfo:
    profile = repository.find_profile(db, user_id)
    if profile is None:
        raise AppError(404, "NOT_FOUND", "프로필을 찾을 수 없습니다.")
    today = today_kst()
    year = profile.birth_year
    return ProfileInfo(
        year,
        today.year - year if year is not None else None,
        compute_age_band(year, today) if year is not None else None,
        profile.nickname,
    )


def auth_payload(db: Session, user: User) -> AuthPayload:
    return AuthPayload(
        user=UserOut.model_validate(user),
        profile=ProfileOut.model_validate(get_profile(db, user.id)),
    )


def create_session(db: Session, user: User, old_token: str | None) -> str:
    if old_token:
        repository.delete_session(db, hash_token(old_token))
    token = new_session_token()
    repository.add(
        db,
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=now_utc() + timedelta(seconds=get_settings().session_ttl_seconds),
        ),
    )
    return token


def signup(db: Session, data: SignupRequest, old_token: str | None) -> tuple[AuthPayload, str]:
    if repository.find_user_by_email(db, str(data.email)):
        raise AppError(409, "EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.")
    try:
        user = User(email=str(data.email), password_hash=hash_password(data.password))
        repository.add(db, user)
        repository.add(db, UserProfile(user_id=user.id))
        token = create_session(db, user, old_token)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.") from exc
    return auth_payload(db, user), token


def login(db: Session, email: str, password: str, old_token: str | None) -> tuple[AuthPayload, str]:
    user = repository.find_user_by_email(db, email)
    valid = verify_password(password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not valid:
        raise AppError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.")
    token = create_session(db, user, old_token)
    db.commit()
    return auth_payload(db, user), token


def logout(db: Session, token: str | None) -> None:
    if token:
        repository.delete_session(db, hash_token(token))
        db.commit()


def authenticate(db: Session, token: str | None) -> User:
    session = repository.find_session(db, hash_token(token)) if token else None
    if session and session.expires_at <= now_utc():
        repository.delete_session(db, session.token_hash)
        db.commit()
        session = None
    user = repository.find_user(db, session.user_id) if session else None
    if not user:
        raise AppError(401, "UNAUTHENTICATED", "로그인이 필요합니다.")
    return user


def update_profile(db: Session, user_id: UUID, data: ProfileUpdate) -> ProfileInfo:
    profile = repository.find_profile(db, user_id)
    if profile is None:
        raise AppError(404, "NOT_FOUND", "프로필을 찾을 수 없습니다.")
    profile.birth_year = data.birth_year
    profile.nickname = data.nickname
    db.commit()
    return get_profile(db, user_id)


def make_admin(db: Session, email: str) -> bool:
    user = repository.find_user_by_email(db, email.strip().lower())
    if user is None:
        return False
    user.role = "admin"
    db.commit()
    return True
