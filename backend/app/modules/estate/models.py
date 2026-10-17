"""가족과 증여 기록. 계산한 공제·세액은 저장하지 않는다."""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class FamilyMember(Base):
    __tablename__ = "family_members"
    __table_args__ = (
        CheckConstraint(
            "relation in ('spouse','child','grandchild','parent','other_relative')", name="relation"
        ),
        CheckConstraint("cardinality(child_birth_dates) <= 10", name="child_birth_dates"),
        Index("ix_family_members_user_id", "user_id"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    relation: Mapped[str] = mapped_column(String(16))
    display_name: Mapped[str] = mapped_column(String(20))
    birth_date: Mapped[date | None] = mapped_column(Date)
    married_on: Mapped[date | None] = mapped_column(Date)
    child_birth_dates: Mapped[list[date]] = mapped_column(ARRAY(Date), default=list)
    parent_deceased: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class GiftRecord(Base):
    __tablename__ = "gift_records"
    __table_args__ = (
        CheckConstraint(
            "donor_group in ('parents','grandparents','spouse',"
            "'children','relative','non_relative')",
            name="donor_group",
        ),
        CheckConstraint(
            "deduction_category in ('lineal_ascendant','spouse',"
            "'lineal_descendant','other_relative','none')",
            name="deduction_category",
        ),
        CheckConstraint(
            "asset_type in ('cash','listed_stock','real_estate','other')", name="asset_type"
        ),
        CheckConstraint("amount > 0 and amount <= 1000000000000", name="amount"),
        CheckConstraint("appraisal_fee >= 0 and tax_paid >= 0", name="expenses"),
        Index(
            "ix_gift_records_user_id_recipient_id_gifted_on", "user_id", "recipient_id", "gifted_on"
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    recipient_id: Mapped[UUID] = mapped_column(ForeignKey("family_members.id", ondelete="CASCADE"))
    donor_group: Mapped[str] = mapped_column(String(16))
    deduction_category: Mapped[str] = mapped_column(String(20))
    gifted_on: Mapped[date] = mapped_column(Date)
    asset_type: Mapped[str] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(BigInteger)
    appraisal_fee: Mapped[int] = mapped_column(BigInteger, default=0)
    marriage_birth_claimed: Mapped[bool] = mapped_column(Boolean, default=False)
    tax_paid: Mapped[int] = mapped_column(BigInteger, default=0)
    filed: Mapped[bool] = mapped_column(Boolean, default=False)
    memo: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
