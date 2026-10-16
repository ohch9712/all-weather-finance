from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from pydantic import EmailStr, Field, field_serializer, field_validator
from pydantic_core import PydanticCustomError

from app.core.domain import AgeBand
from app.core.schemas import CamelModel
from app.core.time import today_kst


class LoginRequest(CamelModel):
    email: Annotated[EmailStr, Field(max_length=254)]
    password: Annotated[str, Field(strict=True, min_length=8, max_length=128)]

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class SignupRequest(LoginRequest):
    password_confirm: str = Field(strict=True)

    @field_validator("password_confirm")
    @classmethod
    def passwords_match(cls, value, info):
        if "password" in info.data and value != info.data["password"]:
            raise PydanticCustomError("password_confirmation", "비밀번호가 일치하지 않습니다.")
        return value


class UserOut(CamelModel):
    id: UUID
    email: str
    role: str
    created_at: datetime

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


class ProfileOut(CamelModel):
    birth_year: int | None
    nickname: str | None
    age: int | None
    age_band: AgeBand | None


class ProfileUpdate(CamelModel):
    birth_year: int = Field(strict=True)
    nickname: str | None = None

    @field_validator("birth_year")
    @classmethod
    def validate_birth_year(cls, value):
        if not 1920 <= value <= today_kst().year - 10:
            raise ValueError("출생연도를 확인해 주세요.")
        return value

    @field_validator("nickname")
    @classmethod
    def normalize_nickname(cls, value):
        normalized = value.strip() if value is not None else None
        if normalized and len(normalized) > 20:
            raise ValueError("닉네임은 20자 이내로 입력해 주세요.")
        return normalized or None


class AuthPayload(CamelModel):
    user: UserOut
    profile: ProfileOut
