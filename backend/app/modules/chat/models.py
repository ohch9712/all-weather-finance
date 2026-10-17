"""chat ORM 모델(스펙 09 4절)."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base

DEFAULT_TITLE = "새 대화"


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (
        CheckConstraint("provider in ('gemini','ollama')", name="provider"),
        Index(
            "ix_chat_conversations_user_id_last_message_at",
            "user_id",
            text("last_message_at desc"),
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(100), server_default=DEFAULT_TITLE)
    # 대화를 만들 때의 personal 공급자·모델. 지금 설정과 다르면 이어 쓸 수 없다(5.5).
    provider: Mapped[str] = mapped_column(String(10))
    model: Mapped[str] = mapped_column(String(60))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), onupdate=now_utc
    )


class ChatMessage(Base):
    """대화 기록 행. 추가만 하고 고치지 않는다(append-only)."""

    __tablename__ = "chat_messages"
    __table_args__ = (
        CheckConstraint("role in ('user','assistant')", name="role"),
        CheckConstraint("kind in ('question','response','tool_results')", name="kind"),
        CheckConstraint(
            "stop_reason is null or stop_reason in ('end','tool_use','max_tokens')",
            name="stop_reason",
        ),
        UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conversation_id_seq"),
        Index("ix_chat_messages_user_id_created_at", "user_id", "created_at"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    conversation_id: Mapped[UUID] = mapped_column(
        ForeignKey("chat_conversations.id", ondelete="CASCADE")
    )
    # 하루 상한 계산용(5.7)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    turn_id: Mapped[UUID]
    role: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(12))
    # 공급자 원본 항목 배열(스펙 5절). 다음 요청에 그대로 다시 보낸다.
    content: Mapped[list] = mapped_column(JSONB)
    text_preview: Mapped[str] = mapped_column(String(500), server_default="")
    cards: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    model: Mapped[str | None] = mapped_column(String(60))
    stop_reason: Mapped[str | None] = mapped_column(String(20))
    usage: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
