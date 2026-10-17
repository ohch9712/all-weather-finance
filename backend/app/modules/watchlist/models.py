from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    __table_args__ = (
        UniqueConstraint("user_id", "stock_code", name="uq_watchlist_items_user_code"),
        Index("ix_watchlist_items_user_group_order", "user_id", "group_name", "sort_order"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # 08 stocks 코드 값만 저장한다(FK 없음).
    stock_code: Mapped[str] = mapped_column(String(20))
    group_name: Mapped[str] = mapped_column(String(20), server_default="기본")
    memo: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc
    )
