from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain import AgeBand
from app.core.errors import AppError, field_error
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
from app.modules.auth.schemas import (
    LOGIN_PASSWORD_MAX_LENGTH,
    AuthPayload,
    ProfileOut,
    ProfileUpdate,
    SignupRequest,
    UserOut,
)

# 만 14세 미만은 가입·이용할 수 없다(스펙 19 4.2). 나이는 기준연도 − 출생연도다.
MIN_AGE = 14
# 회원 탈퇴 비밀번호 확인이 받는 최대 길이(로그인과 같은 128자). 가입은 32자로 줄었지만
# (스펙 01 7.3) 이전 규칙(8~128자)으로 가입한 계정도 확인해야 한다. 이보다 길면 맞을 수
# 없으므로 해시 검증 없이 거절한다.
MAX_PASSWORD_LENGTH = LOGIN_PASSWORD_MAX_LENGTH


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
    if data.birth_year is not None and today_kst().year - data.birth_year < MIN_AGE:
        raise field_error("birthYear", "만 14세 이상만 이용할 수 있습니다.")
    profile.birth_year = data.birth_year
    profile.nickname = data.nickname
    db.commit()
    return get_profile(db, user_id)


def delete_account(db: Session, user: User, password: str) -> None:
    """비밀번호를 확인한 뒤 계정과 모든 사용자 데이터를 지운다(스펙 19 4절).

    비밀번호는 로그·예외·응답에 남기지 않는다. CODEF 연결은 users 행보다 먼저 CODEF에서 지운다.
    """
    if (
        not password
        or len(password) > MAX_PASSWORD_LENGTH
        or not verify_password(password, user.password_hash)
    ):
        raise field_error("password", "비밀번호가 맞지 않습니다.")
    if user.role == "admin" and repository.count_other_admins(db, user.id) == 0:
        raise AppError(
            409,
            "CONFLICT",
            "마지막 관리자 계정은 삭제할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.",
        )
    # connectors가 allocation을 거쳐 이 모듈을 import하므로 순환 import를 피해 여기서 불러온다.
    from app.modules.connectors import service as connectors

    connectors.delete_all_accounts(db, user.id)
    repository.delete_user(db, user.id)
    db.commit()


def make_admin(db: Session, email: str) -> bool:
    user = repository.find_user_by_email(db, email.strip().lower())
    if user is None:
        return False
    user.role = "admin"
    db.commit()
    return True
