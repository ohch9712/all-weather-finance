from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import now_utc
from app.db.base import Base


class LedgerCategory(Base):
    __tablename__ = "ledger_categories"
    __table_args__ = (
        CheckConstraint("kind in ('income','expense')", name="kind"),
        Index(
            "uq_ledger_categories_default_kind_name",
            "kind",
            "name",
            unique=True,
            postgresql_where=text("user_id is null"),
        ),
        Index(
            "uq_ledger_categories_user_kind_name",
            "user_id",
            "kind",
            "name",
            unique=True,
            postgresql_where=text("user_id is not null"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    # NULL이면 모든 사용자에게 보이는 기본 카테고리다.
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))
    name: Mapped[str] = mapped_column(String(20))
    sort_order: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def is_default(self) -> bool:
        return self.user_id is None


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("kind in ('income','expense')", name="kind"),
        CheckConstraint("amount > 0", name="amount"),
        CheckConstraint(
            "payment_method in ('card','cash','transfer','other')", name="payment_method"
        ),
        CheckConstraint("source in ('manual','import','codef')", name="source"),
        Index("ix_ledger_entries_user_id_occurred_on", "user_id", text("occurred_on desc")),
        Index(
            "uq_ledger_entries_user_id_dedup_hash",
            "user_id",
            "dedup_hash",
            unique=True,
            postgresql_where=text("dedup_hash is not null"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(8))
    occurred_on: Mapped[date] = mapped_column(Date)
    amount: Mapped[int] = mapped_column(BigInteger)
    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("ledger_categories.id", ondelete="RESTRICT")
    )
    merchant: Mapped[str | None] = mapped_column(String(100))
    payment_method: Mapped[str] = mapped_column(String(10), server_default="other")
    memo: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(8), server_default="manual")
    # 10(카드 명세서)·17(CODEF)이 채우는 중복 방지 키
    dedup_hash: Mapped[str | None] = mapped_column(String(64))
    # 한 트랜잭션 안에서도 입력 순서가 남도록 애플리케이션 시각을 기본값으로 쓴다.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), onupdate=now_utc
    )

    category: Mapped[LedgerCategory] = relationship(lazy="joined")

    @property
    def category_name(self) -> str:
        return self.category.name
