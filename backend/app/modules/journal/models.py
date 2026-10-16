from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        CheckConstraint("market in ('KRX','US','OTHER')", name="market"),
        CheckConstraint("side in ('buy','sell')", name="side"),
        CheckConstraint("currency in ('KRW','USD')", name="currency"),
        CheckConstraint("quantity > 0", name="quantity"),
        CheckConstraint("price > 0", name="price"),
        CheckConstraint("fee >= 0", name="fee"),
        CheckConstraint("tax >= 0", name="tax"),
        CheckConstraint("broker in ('kiwoom','toss','other')", name="broker"),
        CheckConstraint("source in ('manual','import','kiwoom','toss')", name="source"),
        Index("ix_trades_user_traded", "user_id", "traded_at"),
        Index("ix_trades_user_symbol", "user_id", "symbol_code"),
        Index(
            "uq_trades_user_dedup",
            "user_id",
            "dedup_hash",
            unique=True,
            postgresql_where=text("dedup_hash IS NOT NULL"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    traded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    time_known: Mapped[bool] = mapped_column(server_default=text("true"))
    market: Mapped[str] = mapped_column(String(8))
    symbol_code: Mapped[str] = mapped_column(String(20))
    symbol_name: Mapped[str] = mapped_column(String(100))
    side: Mapped[str] = mapped_column(String(4))
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    price: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    currency: Mapped[str] = mapped_column(String(3))
    fee: Mapped[Decimal] = mapped_column(Numeric(20, 6), server_default="0")
    tax: Mapped[Decimal] = mapped_column(Numeric(20, 6), server_default="0")
    broker: Mapped[str | None] = mapped_column(String(10))
    account_label: Mapped[str | None] = mapped_column(String(30))
    source: Mapped[str] = mapped_column(String(8), server_default="manual")
    dedup_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )


class TradeNote(Base):
    __tablename__ = "trade_notes"
    __table_args__ = (
        CheckConstraint("kind in ('plan','review','memo')", name="kind"),
        CheckConstraint("char_length(content) between 1 and 5000", name="content"),
        CheckConstraint("cardinality(tags) <= 10", name="tags"),
        CheckConstraint(
            "emotion in ('confident','calm','anxious','impulsive','greedy','fearful','regret')",
            name="emotion",
        ),
        Index("ix_trade_notes_user_noted", "user_id", text("noted_on DESC")),
        Index("ix_trade_notes_user_trade", "user_id", "trade_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    trade_id: Mapped[UUID | None] = mapped_column(ForeignKey("trades.id", ondelete="SET NULL"))
    symbol_code: Mapped[str | None] = mapped_column(String(20))
    noted_on: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(8))
    content: Mapped[str] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(20)), server_default=text("'{}'"))
    emotion: Mapped[str | None] = mapped_column(String(12))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
