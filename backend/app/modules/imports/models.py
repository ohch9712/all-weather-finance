from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class ImportJob(Base):
    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint("status in ('parsed','mapped','committed')", name="status"),
        CheckConstraint("file_type in ('csv','xlsx','xls','html')", name="file_type"),
        CheckConstraint(
            "mapping_source in ('preset','synonym','llm','user')", name="mapping_source"
        ),
        Index("ix_import_jobs_user_created", "user_id", text("created_at desc")),
        Index("ix_import_jobs_expires_at", "expires_at"),
    )
    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(12), default="parsed")
    file_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(8))
    sheet_names: Mapped[list] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    sheet_name: Mapped[str | None] = mapped_column(String(100))
    header_row: Mapped[int]
    columns: Mapped[list] = mapped_column(JSONB)
    rows: Mapped[list] = mapped_column(JSONB)
    skipped_row_count: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    mapping: Mapped[dict] = mapped_column(JSONB)
    mapping_source: Mapped[str] = mapped_column(String(8))
    warnings: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    result: Mapped[dict | None] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, server_default=func.now()
    )
