from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class ConnectorAccount(Base):
    __tablename__ = "connector_accounts"
    __table_args__ = (
        CheckConstraint("provider = 'codef'", name="provider"),
        CheckConstraint("kind in ('card','bank')", name="kind"),
        UniqueConstraint(
            "user_id",
            "provider",
            "kind",
            "organization",
            name="uq_connector_accounts_user_provider_kind_org",
        ),
        Index("ix_connector_accounts_user_id", "user_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(8))
    kind: Mapped[str] = mapped_column(String(4))
    organization: Mapped[str] = mapped_column(String(8))
    label: Mapped[str] = mapped_column(String(30))
    connected_id_enc: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class ConnectorSync(Base):
    __tablename__ = "connector_syncs"
    __table_args__ = (
        CheckConstraint("kind in ('card_approvals','bank_balances')", name="kind"),
        CheckConstraint("status in ('running','succeeded','failed')", name="status"),
        Index("ix_connector_syncs_user_account_started", "user_id", "account_id", "started_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("connector_accounts.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(10))
    range_start: Mapped[date | None] = mapped_column(Date)
    range_end: Mapped[date | None] = mapped_column(Date)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    summary: Mapped[dict | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(40))
