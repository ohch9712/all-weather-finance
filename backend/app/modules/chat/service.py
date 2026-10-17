"""챗봇 대화 도메인 로직(스펙 09 5.5·5.7·8절)."""

from collections.abc import Iterator
from datetime import datetime, time, timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.schemas import Page, PageParams
from app.core.time import KST, today_kst
from app.integrations.llm.status import ScopeStatus, get_ai_status
from app.modules.chat import repository
from app.modules.chat.agent import SseEvent, run_turn
from app.modules.chat.models import DEFAULT_TITLE, ChatConversation, ChatMessage
from app.modules.chat.providers.base import (
    ChatProvider,
    display_parts,
    question_text,
    tool_result_errors,
)
from app.modules.chat.schemas import (
    ChatStatus,
    ConversationDetail,
    ConversationOut,
    DisplayMessage,
    ToolCallView,
)
from app.modules.chat.tools.registry import ToolContext, find_tool

MAX_CONVERSATION_ROWS = 200

# architecture 9.1.3 DisabledLLM과 같은 문장
PROVIDER_OFF_MESSAGE = "AI 기능이 꺼져 있습니다. 서버에 로컬 AI(Ollama)나 Gemini를 설정해야 합니다."
PROVIDER_CHANGED_MESSAGE = "AI 설정이 바뀌어 이 대화는 이어 갈 수 없어요. 새 대화를 시작해 주세요."
TOO_LONG_MESSAGE = "대화가 길어졌어요. 새 대화를 시작해 주세요."
LIMIT_MESSAGE = "오늘 대화 한도를 다 썼어요. 내일 다시 이용해 주세요."
NOT_FOUND_MESSAGE = "대화를 찾을 수 없습니다."


def provider_off() -> AppError:
    return AppError(503, "LLM_UNAVAILABLE", PROVIDER_OFF_MESSAGE)


def _today_bounds() -> tuple[datetime, datetime]:
    start = datetime.combine(today_kst(), time.min, tzinfo=KST)
    return start, start + timedelta(days=1)


def used_today(db: Session, user_id: UUID) -> int:
    return repository.count_questions(db, user_id, *_today_bounds())


def get_status(db: Session, user_id: UUID) -> ChatStatus:
    personal = get_ai_status().personal
    return ChatStatus(
        enabled=personal.enabled,
        provider=personal.provider,
        location=personal.location,
        model=personal.model,
        daily_limit=get_settings().chat_daily_message_limit,
        used_today=used_today(db, user_id),
    )


def _can_continue(conversation: ChatConversation, personal: ScopeStatus) -> bool:
    return (
        personal.enabled
        and conversation.provider == personal.provider
        and conversation.model == personal.model
    )


def _out(conversation: ChatConversation, personal: ScopeStatus) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        title=conversation.title,
        provider=conversation.provider,
        model=conversation.model,
        can_continue=_can_continue(conversation, personal),
        last_message_at=conversation.last_message_at,
        created_at=conversation.created_at,
    )


def _get_owned(db: Session, user_id: UUID, conversation_id: UUID) -> ChatConversation:
    conversation = repository.find_conversation(db, user_id, conversation_id)
    if conversation is None:
        raise AppError(404, "NOT_FOUND", NOT_FOUND_MESSAGE)
    return conversation


def create_conversation(db: Session, user_id: UUID, title: str | None) -> ConversationOut:
    personal = get_ai_status().personal
    if not personal.enabled or personal.provider is None or personal.model is None:
        raise provider_off()
    conversation = ChatConversation(
        user_id=user_id,
        title=title or DEFAULT_TITLE,
        provider=personal.provider,
        model=personal.model,
    )
    db.add(conversation)
    db.commit()
    return _out(conversation, personal)


def list_conversations(db: Session, user_id: UUID, page: PageParams) -> Page[ConversationOut]:
    personal = get_ai_status().personal
    items, total = repository.list_conversations(
        db, user_id, offset=(page.page - 1) * page.page_size, limit=page.page_size
    )
    return Page(
        items=[_out(item, personal) for item in items],
        page=page.page,
        page_size=page.page_size,
        total=total,
    )


def _tool_label(name: str) -> str:
    spec = find_tool(name)
    return spec.label if spec else name


def build_display_messages(provider: str, rows: list[ChatMessage]) -> list[DisplayMessage]:
    """question 행은 하나씩, 한 턴의 response 행들은 assistant 하나로 합친다(스펙 8절)."""
    turns: dict[UUID, list[ChatMessage]] = {}
    for row in rows:
        turns.setdefault(row.turn_id, []).append(row)
    messages: list[DisplayMessage] = []
    for turn_id, turn_rows in turns.items():
        for row in turn_rows:
            if row.kind == "question":
                messages.append(
                    DisplayMessage(
                        id=row.id,
                        turn_id=turn_id,
                        role="user",
                        text=question_text(provider, row.content),
                        tool_calls=[],
                        cards=[],
                        created_at=row.created_at,
                    )
                )
        responses = [row for row in turn_rows if row.kind == "response"]
        if not responses:
            continue
        texts: list[str] = []
        tool_calls: list[ToolCallView] = []
        for index, row in enumerate(turn_rows):
            if row.kind != "response":
                continue
            text, names = display_parts(provider, row.content)
            if text:
                texts.append(text)
            following = next(
                (r for r in turn_rows[index + 1 :] if r.kind in ("response", "tool_results")),
                None,
            )
            results = following.content if following and following.kind == "tool_results" else []
            errors = tool_result_errors(provider, row.content, results)
            tool_calls.extend(
                ToolCallView(name=name, label=_tool_label(name), ok=error is False)
                for name, error in zip(names, errors, strict=False)
            )
        last = responses[-1]
        messages.append(
            DisplayMessage(
                id=last.id,
                turn_id=turn_id,
                role="assistant",
                text="\n\n".join(texts),
                tool_calls=tool_calls,
                cards=list(last.cards or []),
                created_at=last.created_at,
            )
        )
    return messages


def get_conversation_detail(
    db: Session, user_id: UUID, conversation_id: UUID
) -> ConversationDetail:
    conversation = _get_owned(db, user_id, conversation_id)
    rows = repository.list_messages(db, conversation.id)
    return ConversationDetail(
        conversation=_out(conversation, get_ai_status().personal),
        messages=build_display_messages(conversation.provider, rows),
    )


def delete_conversation(db: Session, user_id: UUID, conversation_id: UUID) -> None:
    conversation = _get_owned(db, user_id, conversation_id)
    db.delete(conversation)
    db.commit()


def start_turn(
    db: Session,
    user,
    conversation_id: UUID,
    provider: ChatProvider | None,
    content: str,
) -> Iterator[SseEvent]:
    """SSE를 열기 전에 확인할 오류(404·503·409·429)를 JSON으로 먼저 던진다.

    통과하면 이벤트 제너레이터를 돌려준다(반복을 시작해야 저장이 시작된다).
    """
    conversation = _get_owned(db, user.id, conversation_id)
    if provider is None:
        raise provider_off()
    if conversation.provider != provider.name or conversation.model != provider.model:
        raise AppError(409, "CHAT_PROVIDER_CHANGED", PROVIDER_CHANGED_MESSAGE)
    if repository.count_messages(db, conversation.id) > MAX_CONVERSATION_ROWS:
        raise AppError(409, "CONFLICT", TOO_LONG_MESSAGE)
    if used_today(db, user.id) >= get_settings().chat_daily_message_limit:
        raise AppError(429, "CHAT_LIMIT_EXCEEDED", LIMIT_MESSAGE)
    ctx = ToolContext(db=db, user=user, today=today_kst())
    return run_turn(ctx, provider, conversation, content)
