from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.api.deps import CurrentUser, DBSession, PageQuery, require_json
from app.core.schemas import Page
from app.modules.chat import service
from app.modules.chat.providers.base import ChatProvider, get_chat_provider
from app.modules.chat.schemas import (
    ChatStatus,
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
    MessageCreate,
)
from app.modules.chat.sse import SSE_HEADERS, sse_body

router = APIRouter(prefix="/chat", tags=["chat"])

ProviderDep = Annotated[ChatProvider | None, Depends(get_chat_provider)]


async def conversation_body(request: Request) -> ConversationCreate:
    """본문 없음 또는 `{"title": "..."}`. 본문이 있으면 JSON이어야 한다."""
    raw = await request.body()
    if not raw.strip():
        return ConversationCreate()
    await require_json(request)
    try:
        return ConversationCreate.model_validate_json(raw)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False)) from exc


@router.get("/status", response_model=ChatStatus)
def chat_status(db: DBSession, user: CurrentUser):
    return service.get_status(db, user.id)


@router.get("/conversations", response_model=Page[ConversationOut])
def list_conversations(db: DBSession, user: CurrentUser, page: PageQuery):
    return service.list_conversations(db, user.id, page)


@router.post("/conversations", status_code=201, response_model=ConversationOut)
def create_conversation(
    data: Annotated[ConversationCreate, Depends(conversation_body)],
    db: DBSession,
    user: CurrentUser,
):
    return service.create_conversation(db, user.id, data.title)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: UUID, db: DBSession, user: CurrentUser):
    return service.get_conversation_detail(db, user.id, conversation_id)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_conversation(db, user.id, conversation_id)
    return Response(status_code=204)


@router.post(
    "/conversations/{conversation_id}/messages",
    dependencies=[Depends(require_json)],
    response_class=StreamingResponse,
)
def send_message(
    conversation_id: UUID,
    data: MessageCreate,
    db: DBSession,
    user: CurrentUser,
    provider: ProviderDep,
):
    # 404·503·409·429는 여기서 JSON으로 끝난다. SSE는 확인을 모두 통과한 뒤에만 연다.
    events = service.start_turn(db, user, conversation_id, provider, data.content)
    return StreamingResponse(
        sse_body(events, on_error=db.rollback),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
