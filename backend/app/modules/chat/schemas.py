from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.core.schemas import CamelModel

MAX_CONTENT_LENGTH = 4000


class ConversationCreate(CamelModel):
    title: str | None = Field(default=None, max_length=100)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class MessageCreate(CamelModel):
    content: str

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value) <= MAX_CONTENT_LENGTH:
            raise ValueError(f"질문은 1~{MAX_CONTENT_LENGTH:,}자로 입력해 주세요.")
        return value


class ConversationOut(CamelModel):
    id: UUID
    title: str
    provider: Literal["gemini", "ollama"]
    model: str
    can_continue: bool
    last_message_at: datetime | None
    created_at: datetime


class ToolCallView(CamelModel):
    name: str
    label: str
    ok: bool


class DisplayMessage(CamelModel):
    """턴 단위로 합친 화면용 메시지(스펙 8절)"""

    id: UUID
    turn_id: UUID
    role: Literal["user", "assistant"]
    text: str
    tool_calls: list[ToolCallView]
    cards: list[dict]
    created_at: datetime


class ConversationDetail(CamelModel):
    conversation: ConversationOut
    messages: list[DisplayMessage]


class ChatStatus(CamelModel):
    enabled: bool
    provider: Literal["gemini", "ollama"] | None
    location: Literal["cloud", "local"] | None
    model: str | None
    daily_limit: int
    used_today: int
