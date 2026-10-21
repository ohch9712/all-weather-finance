"""상속·증여(과제) 입력. 부모님 건강 상태는 동의한 경우에만 health_enc에 암호화해 둔다."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class SuccessionCase(Base):
    __tablename__ = "succession_cases"
    __table_args__ = (
        CheckConstraint(
            "health_enc IS NULL OR sensitive_consent_at IS NOT NULL", name="health_consent"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    # 8.1 입력에서 부모님 health를 모두 null로 바꾼 값
    data: Mapped[dict] = mapped_column(JSONB)
    health_enc: Mapped[str | None] = mapped_column(Text)
    sensitive_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
