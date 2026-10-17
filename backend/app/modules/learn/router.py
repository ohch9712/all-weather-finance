from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import AdminUser, CurrentUser, DBSession, require_json
from app.core.errors import AppError, field_error
from app.core.schemas import Page, PageParams
from app.integrations.llm.deps import StructuredLLMDep
from app.modules.learn import rules, service
from app.modules.learn.repository import AdminFilter, PostFilter
from app.modules.learn.schemas import (
    KINDS,
    LEVELS,
    AdminPost,
    AiDraftRequest,
    Draft,
    GlossaryList,
    LearnProgress,
    PostCreate,
    PostDetail,
    PostPatch,
    PostSummary,
    TodayOut,
)

router = APIRouter(prefix="/learn", tags=["learn"])

QUERY_MAX = 100


def query_error(field: str) -> AppError:
    return field_error(field, "형식이 올바르지 않습니다.")


def choice(value: str | None, allowed: tuple[str, ...], field: str) -> str | None:
    """화면은 빈 필터를 `kind=`처럼 보내므로 빈 값은 조건 없음으로 본다."""
    if not value:
        return None
    if value not in allowed:
        raise query_error(field)
    return value


def clean_query(value: str | None) -> str | None:
    return (value or "").strip() or None


def get_page(
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 12,
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


PageQuery = Annotated[PageParams, Depends(get_page)]


def get_post_filter(
    user: CurrentUser,
    kind: Annotated[str | None, Query()] = None,
    level: Annotated[str | None, Query()] = None,
    tag: Annotated[str | None, Query(max_length=QUERY_MAX)] = None,
    q: Annotated[str | None, Query(max_length=QUERY_MAX)] = None,
    bookmarked: Annotated[bool, Query()] = False,
) -> PostFilter:
    return PostFilter(
        kind=choice(kind, KINDS, "kind"),
        level=choice(level, LEVELS, "level"),
        tag=clean_query(tag),
        q=clean_query(q),
        bookmarked_by=user.id if bookmarked else None,
    )


def get_initial(initial: Annotated[str | None, Query(max_length=1)] = None) -> str | None:
    if not initial:
        return None
    value = initial.upper()
    if value not in rules.INITIALS:
        raise query_error("initial")
    return value


def get_admin_filter(
    published: Annotated[str | None, Query()] = None,
    kind: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=QUERY_MAX)] = None,
) -> AdminFilter:
    if published in (None, ""):
        published_value = None
    elif published in ("true", "false"):
        published_value = published == "true"
    else:
        raise query_error("published")
    return AdminFilter(
        published=published_value, kind=choice(kind, KINDS, "kind"), q=clean_query(q)
    )


# ── 사용자용(공개 게시물만) ───────────────────────────────────────────


@router.get("/posts", response_model=Page[PostSummary])
def list_posts(
    db: DBSession,
    user: CurrentUser,
    flt: Annotated[PostFilter, Depends(get_post_filter)],
    page: PageQuery,
):
    return service.list_posts(db, user.id, flt, page)


@router.get("/posts/{slug}", response_model=PostDetail)
def get_post(slug: str, db: DBSession, user: CurrentUser):
    return service.get_post_detail(db, user.id, slug)


@router.post("/posts/{post_id}/bookmark", status_code=204, dependencies=[Depends(require_json)])
def add_bookmark(post_id: UUID, db: DBSession, user: CurrentUser):
    service.add_bookmark(db, user.id, post_id)
    return Response(status_code=204)


@router.delete("/posts/{post_id}/bookmark", status_code=204, dependencies=[Depends(require_json)])
def remove_bookmark(post_id: UUID, db: DBSession, user: CurrentUser):
    service.remove_bookmark(db, user.id, post_id)
    return Response(status_code=204)


@router.post("/posts/{post_id}/read", status_code=204, dependencies=[Depends(require_json)])
def mark_read(post_id: UUID, db: DBSession, user: CurrentUser):
    service.mark_read(db, user.id, post_id)
    return Response(status_code=204)


@router.get("/glossary", response_model=GlossaryList)
def list_glossary(
    db: DBSession,
    user: CurrentUser,
    initial: Annotated[str | None, Depends(get_initial)],
    q: Annotated[str | None, Query(max_length=QUERY_MAX)] = None,
):
    return service.list_glossary(db, user.id, q=clean_query(q), initial=initial)


@router.get("/today", response_model=TodayOut)
def get_today(db: DBSession, user: CurrentUser):
    return TodayOut(post=service.get_today_for_user(db, user.id))


@router.get("/progress", response_model=LearnProgress)
def get_progress(db: DBSession, user: CurrentUser):
    return service.get_progress(db, user.id)


# ── 관리자용 ─────────────────────────────────────────────────────────


@router.get("/admin/posts", response_model=Page[AdminPost])
def list_admin_posts(
    db: DBSession,
    admin: AdminUser,
    flt: Annotated[AdminFilter, Depends(get_admin_filter)],
    page: PageQuery,
):
    return service.list_admin_posts(db, flt, page)


@router.post(
    "/admin/posts", status_code=201, response_model=AdminPost, dependencies=[Depends(require_json)]
)
def create_post(data: PostCreate, db: DBSession, admin: AdminUser):
    return service.create_post(db, admin.id, data)


@router.get("/admin/posts/{post_id}", response_model=AdminPost)
def get_admin_post(post_id: UUID, db: DBSession, admin: AdminUser):
    return service.get_admin_post(db, post_id)


@router.patch(
    "/admin/posts/{post_id}", response_model=AdminPost, dependencies=[Depends(require_json)]
)
def update_post(post_id: UUID, data: PostPatch, db: DBSession, admin: AdminUser):
    return service.update_post(db, post_id, data)


@router.delete("/admin/posts/{post_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_post(post_id: UUID, db: DBSession, admin: AdminUser):
    service.delete_post(db, post_id)
    return Response(status_code=204)


@router.post("/admin/ai-draft", response_model=Draft, dependencies=[Depends(require_json)])
def make_ai_draft(data: AiDraftRequest, admin: AdminUser, llm: StructuredLLMDep):
    return service.make_ai_draft(llm, data)
