from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.chat.models import ChatConversation, ChatMessage


def find_conversation(db: Session, user_id: UUID, conversation_id: UUID) -> ChatConversation | None:
    return db.scalar(
        select(ChatConversation).where(
            ChatConversation.id == conversation_id, ChatConversation.user_id == user_id
        )
    )


def list_conversations(
    db: Session, user_id: UUID, *, offset: int, limit: int
) -> tuple[list[ChatConversation], int]:
    total = db.scalar(
        select(func.count())
        .select_from(ChatConversation)
        .where(ChatConversation.user_id == user_id)
    )
    # 최근 대화 순. 아직 메시지가 없는 새 대화는 만든 시각으로 줄 세운다.
    items = db.scalars(
        select(ChatConversation)
        .where(ChatConversation.user_id == user_id)
        .order_by(
            func.coalesce(ChatConversation.last_message_at, ChatConversation.created_at).desc(),
            ChatConversation.created_at.desc(),
            ChatConversation.id,
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return list(items), total or 0


def list_messages(db: Session, conversation_id: UUID) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.seq)
        ).all()
    )


def count_messages(db: Session, conversation_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
        )
        or 0
    )


def next_seq(db: Session, conversation_id: UUID) -> int:
    last = db.scalar(
        select(func.max(ChatMessage.seq)).where(ChatMessage.conversation_id == conversation_id)
    )
    return 0 if last is None else last + 1


def count_questions(db: Session, user_id: UUID, start: datetime, end: datetime) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(
                ChatMessage.user_id == user_id,
                ChatMessage.kind == "question",
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
            )
        )
        or 0
    )
