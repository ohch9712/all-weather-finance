"""공급자 중립 에이전트 루프(스펙 09 5.4).

기록 행은 추가만 한다. 대화(chat_conversations)의 제목·시각만 고친다.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.time import now_utc
from app.integrations.llm.tasks import get_task
from app.modules.chat import repository
from app.modules.chat.models import DEFAULT_TITLE, ChatConversation, ChatMessage
from app.modules.chat.prompts import SYSTEM_PROMPT
from app.modules.chat.providers.base import (
    NO_RESPONSE_MESSAGE,
    ChatProvider,
    ProviderUnavailable,
    RoundResult,
    TextDelta,
    ToolCall,
    ToolExecResult,
    empty_usage,
    interrupted_content,
    invalid_input_content,
    stored_tool_calls,
    to_json,
    tool_failed_content,
)
from app.modules.chat.tools.registry import ToolContext, find_tool, get_registered_tools

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 8
TITLE_LENGTH = 30
PREVIEW_LENGTH = 500

REFUSED_MESSAGE = "이 질문에는 답할 수 없어요. 다른 방식으로 물어봐 주세요."
TOO_LONG_MESSAGE = "응답이 너무 길어 중단됐어요. 질문을 나눠 주세요."
TOO_MANY_TOOLS_MESSAGE = "도구 호출이 너무 많아 멈췄어요."
UNKNOWN_TOOL_SUMMARY = "등록되지 않은 도구입니다."


@dataclass(frozen=True)
class SseEvent:
    event: str
    data: dict


@dataclass(frozen=True)
class ToolRun:
    result: ToolExecResult
    card: dict | None


def error_event(code: str, message: str) -> SseEvent:
    return SseEvent("error", {"code": code, "message": message})


def _usage(usage: dict | None) -> dict:
    base = empty_usage()
    for key in base:
        base[key] = int((usage or {}).get(key) or 0)
    return base


class TurnWriter:
    """한 턴의 행을 seq 순서대로 추가하고 바로 커밋한다(이미 저장한 행은 오류가 나도 남는다)."""

    def __init__(self, db: Session, conversation: ChatConversation, turn_id: UUID):
        self.db = db
        self.conversation = conversation
        self.turn_id = turn_id
        self.seq = repository.next_seq(db, conversation.id)

    def add(self, *, turn_id: UUID | None = None, **fields) -> ChatMessage:
        now = now_utc()
        message = ChatMessage(
            conversation_id=self.conversation.id,
            user_id=self.conversation.user_id,
            seq=self.seq,
            turn_id=turn_id or self.turn_id,
            created_at=now,
            **fields,
        )
        self.seq += 1
        self.db.add(message)
        self.conversation.last_message_at = now
        self.db.commit()
        return message


def load_history(writer: TurnWriter, provider: ChatProvider) -> list[dict]:
    """저장 행의 content를 seq 순서로 이어 붙인다. 아래 두 규칙만 예외다(5.4)."""
    rows = repository.list_messages(writer.db, writer.conversation.id)
    history: list[dict] = []
    for index, row in enumerate(rows):
        following = rows[index + 1] if index + 1 < len(rows) else None
        # 규칙 1: 바로 뒤에 response 행이 없는 질문(거절·연결 오류·중단)은 기록에서 뺀다.
        # 행은 그대로 둔다.
        if row.kind == "question" and (following is None or following.kind != "response"):
            continue
        history.extend(row.content)
    last = rows[-1] if rows else None
    if last is not None and last.kind == "response":
        calls = stored_tool_calls(writer.conversation.provider, last.content)
        if calls:
            # 규칙 2: 도구 실행 중 끊긴 호출에 오류 결과 행을 새로 추가한다.
            # 기존 행은 고치지 않는다.
            items = provider.tool_result_items(
                [ToolExecResult(call, interrupted_content(), True) for call in calls]
            )
            writer.add(turn_id=last.turn_id, role="user", kind="tool_results", content=items)
            history.extend(items)
    return history


def _summarize(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ())) or "input"
        parts.append(f"{location}: {error.get('msg', '')}")
    return "; ".join(parts)[:PREVIEW_LENGTH]


def execute_tool(ctx: ToolContext, call: ToolCall) -> ToolRun:
    """입력을 도구의 Pydantic 모델로 다시 검증한 뒤 실행한다. 실패는 is_error 결과로 돌려준다."""
    spec = find_tool(call.name)
    if spec is None:
        return ToolRun(
            ToolExecResult(call, invalid_input_content(UNKNOWN_TOOL_SUMMARY), True), None
        )
    try:
        params = spec.input_model.model_validate(call.arguments)
    except ValidationError as exc:
        return ToolRun(ToolExecResult(call, invalid_input_content(_summarize(exc)), True), None)
    # 도구가 DB 오류를 내도 대화 저장은 이어 가도록 savepoint 안에서 실행한다.
    # 컨텍스트 매니저(`with begin_nested()`)는 쓰지 않는다. 그 안에서는 commit 뒤 쿼리가
    # InvalidRequestError가 되는데, 12의 add_item(add_to_watchlist)처럼 함수 안에서 commit하고
    # 이어서 조회하는 공개 함수가 있기 때문이다(SQLAlchemy 2.0: 안쪽 commit은 바깥까지 커밋하고
    # savepoint를 닫는다). TurnWriter가 행마다 커밋하므로 도구 실행 전에는 미커밋 변경이 없다.
    savepoint = ctx.db.begin_nested()
    try:
        output = spec.handler(ctx, params)
    except Exception:
        # 내부 메시지는 사용자·모델에 보이지 않는다. 로그에만 남긴다.
        logger.exception("챗봇 도구 실행 오류: %s", call.name)
        if savepoint.is_active:
            savepoint.rollback()
        else:
            # 도구가 이미 커밋해 savepoint가 닫혔다. 그 뒤의 변경만 버리고 세션을 정리한다.
            ctx.db.rollback()
        return ToolRun(ToolExecResult(call, tool_failed_content(), True), None)
    if savepoint.is_active:
        savepoint.commit()
    content = output.content if isinstance(output.content, str) else to_json(output.content)
    return ToolRun(ToolExecResult(call, content, False), _safe_card(output.card))


def _internal_href(href: object) -> bool:
    return isinstance(href, str) and href.startswith("/") and not href.startswith("//")


def _safe_card(card: dict | None) -> dict | None:
    """카드의 링크는 앱 내부 경로("/"로 시작)만 허용한다(스펙 09 7절, 15 5절)."""
    if not isinstance(card, dict) or not isinstance(card.get("type"), str):
        return None
    # link 카드는 href가 필수다. 다른 카드는 href가 있으면(null 제외) 내부 경로여야 한다.
    if card["type"] == "link" or card.get("href") is not None:
        if not _internal_href(card.get("href")):
            return None
    if card["type"] == "link_list":
        links = card.get("links")
        if not isinstance(links, list):
            return None
        safe = [
            link for link in links if isinstance(link, dict) and _internal_href(link.get("href"))
        ]
        if not safe:
            return None
        if len(safe) != len(links):
            card = {**card, "links": safe}
    return card


def run_turn(
    ctx: ToolContext,
    provider: ChatProvider,
    conversation: ChatConversation,
    question_text: str,
) -> Iterator[SseEvent]:
    """질문 하나를 처리하며 SSE 이벤트를 차례로 내보낸다.

    제너레이터가 중간에 닫히면(연결 끊김) 진행 중인 라운드는 저장하지 않는다.
    """
    task = get_task("chat.agent")
    writer = TurnWriter(ctx.db, conversation, uuid4())
    history = load_history(writer, provider)
    question = provider.user_items(question_text)
    if writer.seq == 0 and conversation.title == DEFAULT_TITLE:
        conversation.title = question_text[:TITLE_LENGTH]
    question_row = writer.add(
        role="user",
        kind="question",
        content=question,
        text_preview=question_text[:PREVIEW_LENGTH],
    )
    yield SseEvent(
        "message_start",
        {
            "conversationId": str(conversation.id),
            "turnId": str(writer.turn_id),
            "questionMessageId": str(question_row.id),
            "provider": provider.name,
            "model": provider.model,
        },
    )
    history = [*history, *question]
    tools = get_registered_tools()
    turn_cards: list[dict] = []
    try:
        for round_no in range(MAX_TOOL_ROUNDS + 1):
            result: RoundResult | None = None
            for event in provider.run_round(
                system=SYSTEM_PROMPT,
                history=history,
                tools=tools,
                effort=task.effort,
                max_tokens=task.max_tokens,
            ):
                if isinstance(event, TextDelta):
                    if event.text:
                        yield SseEvent("text_delta", {"text": event.text})
                else:
                    result = event
            if result is None:
                raise ProviderUnavailable(NO_RESPONSE_MESSAGE)
            if result.stop == "refused":
                yield error_event("LLM_REFUSED", REFUSED_MESSAGE)
                return
            last_round = round_no == MAX_TOOL_ROUNDS
            # 카드는 이 턴의 마지막 응답 행에만 담는다(행을 나중에 고치지 않는다).
            final = result.stop != "tool_use" or last_round
            usage = _usage(result.usage)
            response_row = writer.add(
                role="assistant",
                kind="response",
                content=result.items,
                text_preview=result.text[:PREVIEW_LENGTH],
                cards=list(turn_cards) if final else [],
                model=result.model,
                stop_reason=result.stop,
                usage=usage,
            )
            history.extend(result.items)
            if result.stop == "max_tokens":
                yield error_event("LLM_UNAVAILABLE", TOO_LONG_MESSAGE)
                return
            if result.stop == "end":
                break
            if last_round:
                yield error_event("LLM_UNAVAILABLE", TOO_MANY_TOOLS_MESSAGE)
                return
            results = []
            for call in result.tool_calls:  # 순서대로 실행(동시 실행 안 함)
                spec = find_tool(call.name)
                yield SseEvent(
                    "tool_start",
                    {
                        "toolUseId": call.id,
                        "name": call.name,
                        "label": spec.label if spec else call.name,
                    },
                )
                run = execute_tool(ctx, call)
                results.append(run.result)
                if run.card is not None:
                    turn_cards.append(run.card)
                yield SseEvent(
                    "tool_end",
                    {
                        "toolUseId": call.id,
                        "name": call.name,
                        "ok": not run.result.is_error,
                        "card": run.card,
                    },
                )
            items = provider.tool_result_items(results)
            if items:
                writer.add(role="user", kind="tool_results", content=items)
                history.extend(items)
    except ProviderUnavailable as exc:
        yield error_event("LLM_UNAVAILABLE", str(exc) or NO_RESPONSE_MESSAGE)
        return
    yield SseEvent(
        "message_end",
        {
            "messageId": str(response_row.id),
            "stopReason": result.stop,
            "model": result.model,
            "usage": usage,
        },
    )
