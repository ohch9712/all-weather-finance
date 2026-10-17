"""allocation ORM 모델(스펙 02 6절, revision allocation_0001)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base

RISK_PROFILE_CHECK = "risk_profile in ('stable','stable_seeking','neutral','active','aggressive')"
ASSET_CLASS_CHECK = "asset_class in ('stock','bond','gold','cash','other')"
SOURCE_CHECK = "source in ('manual','kiwoom','toss','codef','mock')"
GRADE_CHECK = "grade in ('S','A','B','C','D')"
GOAL_TYPE_CHECK = (
    "goal_type in ('retirement','home','education','marriage','car','lump_sum','other')"
)


def _user_fk() -> Any:
    return ForeignKey("users.id", ondelete="CASCADE")


# created_at은 파이썬 시각으로 넣는다. 한 트랜잭션 안에서도 생성 순서가 시각에 남는다.
def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=now_utc, server_default=func.now())


def _updated_at() -> Mapped[datetime]:
    return mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, server_default=func.now()
    )


class RiskAssessment(Base):
    __tablename__ = "risk_assessments"
    __table_args__ = (
        CheckConstraint("score >= 0 and score <= 100", name="score"),
        CheckConstraint(RISK_PROFILE_CHECK, name="risk_profile"),
        Index("ix_risk_assessments_user_id_created_at", "user_id", text("created_at desc")),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(_user_fk())
    survey_version: Mapped[int] = mapped_column(SmallInteger)
    answers: Mapped[dict[str, int]] = mapped_column(JSONB)
    score: Mapped[Decimal] = mapped_column(Numeric(4, 1))
    risk_profile: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = _created_at()


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (
        CheckConstraint(ASSET_CLASS_CHECK, name="asset_class"),
        CheckConstraint("amount >= 0", name="amount"),
        CheckConstraint(SOURCE_CHECK, name="source"),
        Index(
            "uq_holdings_user_connection_external_ref",
            "user_id",
            "connection_id",
            "external_ref",
            unique=True,
            postgresql_where=text("external_ref IS NOT NULL"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(_user_fk(), index=True)
    name: Mapped[str] = mapped_column(String(50))
    asset_class: Mapped[str] = mapped_column(String(8))
    amount: Mapped[int] = mapped_column(BigInteger)
    include_in_allocation: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("true")
    )
    source: Mapped[str] = mapped_column(String(16), default="manual", server_default="manual")
    external_ref: Mapped[str | None] = mapped_column(String(64))
    connection_id: Mapped[UUID | None] = mapped_column()
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    class_override: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    memo: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class AllocationScore(Base):
    __tablename__ = "allocation_scores"
    __table_args__ = (
        UniqueConstraint("user_id", "scored_on"),
        CheckConstraint("score >= 0 and score <= 100", name="score"),
        CheckConstraint(GRADE_CHECK, name="grade"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(_user_fk())
    scored_on: Mapped[date] = mapped_column(Date)
    score: Mapped[int] = mapped_column(SmallInteger)
    grade: Mapped[str] = mapped_column(String(1))
    total_amount: Mapped[int] = mapped_column(BigInteger)
    actual_weights: Mapped[dict[str, float]] = mapped_column(JSONB)
    target_weights: Mapped[dict[str, float]] = mapped_column(JSONB)
    age_band: Mapped[str] = mapped_column(String(4))
    risk_profile: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class AllocationSituation(Base):
    __tablename__ = "allocation_situations"
    __table_args__ = (
        CheckConstraint(
            "monthly_expense >= 0 and monthly_expense <= 100000000", name="monthly_expense"
        ),
        CheckConstraint("dependents >= 0 and dependents <= 10", name="dependents"),
        CheckConstraint(
            "consumer_debt >= 0 and consumer_debt <= 1000000000000", name="consumer_debt"
        ),
    )
    user_id: Mapped[UUID] = mapped_column(_user_fk(), primary_key=True)
    monthly_expense: Mapped[int] = mapped_column(BigInteger)
    dependents: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    consumer_debt: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class FinancialGoal(Base):
    __tablename__ = "financial_goals"
    __table_args__ = (
        CheckConstraint(GOAL_TYPE_CHECK, name="goal_type"),
        CheckConstraint(
            "target_amount >= 1 and target_amount <= 1000000000000", name="target_amount"
        ),
        Index("ix_financial_goals_user_id_target_date", "user_id", "target_date"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(_user_fk())
    goal_type: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(30))
    target_amount: Mapped[int] = mapped_column(BigInteger)
    target_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
