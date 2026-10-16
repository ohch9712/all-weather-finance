from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, SmallInteger, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('user','admin')", name="role"),)
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16), server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=now_utc
    )


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserProfile(Base):
    __tablename__ = "user_profiles"
    __table_args__ = (CheckConstraint("birth_year between 1900 and 2100", name="birth_year"),)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    birth_year: Mapped[int | None] = mapped_column(SmallInteger)
    nickname: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=now_utc
    )
