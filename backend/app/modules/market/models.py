from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class Stock(Base):
    __tablename__ = "stocks"
    __table_args__ = (
        CheckConstraint(
            "market in ('KOSPI','KOSDAQ','KONEX','NASDAQ','NYSE','AMEX','OTHER')", name="market"
        ),
        CheckConstraint("source in ('mock','kiwoom','toss')", name="source"),
        Index("ix_stocks_name", "name"),
    )
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    market: Mapped[str] = mapped_column(String(8))
    name: Mapped[str] = mapped_column(String(100))
    sector: Mapped[str | None] = mapped_column(String(50))
    listed: Mapped[bool] = mapped_column(server_default=text("true"))
    source: Mapped[str] = mapped_column(String(8))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class StockSnapshot(Base):
    __tablename__ = "stock_snapshots"
    __table_args__ = (Index("ix_stock_snapshots_as_of", "as_of"),)
    as_of: Mapped[date] = mapped_column(Date, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 4))
    change_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    volume: Mapped[int | None] = mapped_column(BigInteger)
    trading_value: Mapped[int | None] = mapped_column(BigInteger)
    market_cap: Mapped[int | None] = mapped_column(BigInteger)
    per: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    pbr: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    roe: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    eps: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    bps: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    foreign_ratio: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    high_52w: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    low_52w: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    source: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class BrokerConnection(Base):
    __tablename__ = "broker_connections"
    __table_args__ = (
        CheckConstraint("provider in ('mock','kiwoom','toss')", name="provider"),
        CheckConstraint("environment in ('real','mock')", name="environment"),
        CheckConstraint("status in ('unverified','active','error')", name="status"),
        UniqueConstraint("user_id", "label", name="uq_broker_connections_user_label"),
        Index("ix_broker_connections_user_id", "user_id"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(8))
    environment: Mapped[str] = mapped_column(String(4))
    label: Mapped[str] = mapped_column(String(30))
    app_key_enc: Mapped[str] = mapped_column(Text)
    app_secret_enc: Mapped[str] = mapped_column(Text)
    account_no_enc: Mapped[str | None] = mapped_column(Text)
    app_key_masked: Mapped[str | None] = mapped_column(String(30))
    account_no_masked: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(12), server_default="unverified")
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
