from datetime import date
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, field_error
from app.core.schemas import Page, PageParams
from app.core.time import now_utc, today_kst
from app.integrations.llm.structured import StructuredLLM
from app.modules.learn import repository, rules
from app.modules.learn.models import Post
from app.modules.learn.repository import AdminFilter, PostFilter
from app.modules.learn.schemas import (
    KINDS,
    MAX_BODY,
    MAX_SUMMARY,
    MAX_TAG,
    MAX_TAGS,
    MAX_TERM,
    MAX_TITLE,
    AdminPost,
    AiDraftRequest,
    Draft,
    DraftOutput,
    GlossaryItem,
    GlossaryList,
    KindProgress,
    LearnProgress,
    PostCreate,
    PostDetail,
    PostPatch,
    PostSummary,
    ProgressByKind,
)

RELATED_LIMIT = 3
SEARCH_LIMIT_MAX = 50
AUTO_SLUG_ATTEMPTS = 5
AI_DRAFT_TASK = "learn.ai_draft"

KIND_LABEL = {"article": "글", "video": "영상 설명", "glossary": "용어 설명"}
LEVEL_LABEL = {"beginner": "입문", "basic": "기초", "intermediate": "중급"}

AI_DRAFT_SYSTEM = """\
너는 주식을 처음 배우는 사람(주린이)을 위한 학습 게시판의 초안을 쓰는 편집자다.
다음 규칙을 지켜 요청한 종류·난이도·주제의 초안을 JSON으로 만든다.

- 초등학교 고학년도 이해할 수 있는 쉬운 한국어 문장으로 쓴다. 어려운 말은 바로 풀어 쓴다.
- 일상의 비유 하나와 간단한 숫자 예시 하나를 넣는다.
- 투자를 권하지 않는다. 특정 종목·상품을 사거나 팔라고 하지 않고, 수익을 장담하지 않는다.
- 세법 한도, 세율, 금리처럼 시점에 따라 바뀌는 수치는 넣지 않는다.
  꼭 필요하면 기준 시점을 함께 밝힌다.
- body_md는 Markdown이고 `##` 소제목을 2~4개 둔다. HTML 태그는 쓰지 않는다.
- title은 100자, summary는 한 문장으로 200자를 넘기지 않는다.
- tags는 짧은 한국어 낱말 1~5개다(각 20자 이내).
- 종류가 용어 설명이면 term에 용어 이름을 넣고, 아니면 term은 null이다.
"""


# ── 에러 ────────────────────────────────────────────────────────────


def post_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "게시물을 찾을 수 없습니다.")


def duplicate_slug() -> AppError:
    return AppError(409, "CONFLICT", "이미 쓰고 있는 슬러그입니다.")


def duplicate_term() -> AppError:
    return AppError(409, "CONFLICT", "이미 등록된 용어입니다.")


# ── 변환 ────────────────────────────────────────────────────────────


def to_summary(post: Post, *, bookmarked: bool = False, read: bool = False) -> PostSummary:
    return PostSummary(
        id=post.id,
        kind=post.kind,
        slug=post.slug,
        title=post.title,
        summary=post.summary,
        term=post.term,
        level=post.level,
        tags=list(post.tags),
        video_id=post.video_id,
        ai_assisted=post.ai_assisted,
        published_at=post.published_at,
        bookmarked=bookmarked,
        read=read,
    )


def summaries_for(db: Session, user_id: UUID, posts: list[Post]) -> list[PostSummary]:
    ids = [post.id for post in posts]
    bookmarked = repository.bookmarked_ids(db, user_id, ids)
    read = repository.read_ids(db, user_id, ids)
    return [
        to_summary(post, bookmarked=post.id in bookmarked, read=post.id in read) for post in posts
    ]


# ── 사용자용 ─────────────────────────────────────────────────────────


def list_posts(db: Session, user_id: UUID, flt: PostFilter, page: PageParams) -> Page[PostSummary]:
    total = repository.count_published(db, flt)
    posts = repository.list_published(
        db, flt, offset=(page.page - 1) * page.page_size, limit=page.page_size
    )
    return Page[PostSummary](
        items=summaries_for(db, user_id, posts),
        page=page.page,
        page_size=page.page_size,
        total=total,
    )


def related_posts(db: Session, post: Post) -> list[Post]:
    """태그가 많이 겹치는 순 → 공개일 최신 순으로 최대 3개"""
    tags = set(post.tags)
    candidates = repository.related_candidates(db, post)
    # 후보는 이미 공개일 최신 순이고 정렬은 안정적이다.
    candidates.sort(key=lambda other: -len(tags & set(other.tags)))
    return candidates[:RELATED_LIMIT]


def get_post_detail(db: Session, user_id: UUID, slug: str) -> PostDetail:
    post = repository.find_published_by_slug(db, slug)
    if post is None:
        raise post_not_found()
    summary = summaries_for(db, user_id, [post])[0]
    return PostDetail(
        **summary.model_dump(),
        body_md=post.body_md,
        video_url=post.video_url,
        related=summaries_for(db, user_id, related_posts(db, post)),
    )


def _published_post(db: Session, post_id: UUID) -> Post:
    post = repository.find_published(db, post_id)
    if post is None:
        raise post_not_found()
    return post


def add_bookmark(db: Session, user_id: UUID, post_id: UUID) -> None:
    _published_post(db, post_id)
    repository.add_bookmark(db, user_id, post_id)
    db.commit()


def remove_bookmark(db: Session, user_id: UUID, post_id: UUID) -> None:
    _published_post(db, post_id)
    repository.remove_bookmark(db, user_id, post_id)
    db.commit()


def mark_read(db: Session, user_id: UUID, post_id: UUID) -> None:
    _published_post(db, post_id)
    repository.mark_read(db, user_id, post_id)
    db.commit()


def list_glossary(
    db: Session, user_id: UUID, *, q: str | None = None, initial: str | None = None
) -> GlossaryList:
    posts = repository.list_glossary(db, q)
    read = repository.read_ids(db, user_id, [post.id for post in posts])
    items = []
    for post in posts:
        term = post.term or post.title
        item_initial = rules.initial_of(term)
        if initial is not None and item_initial != initial:
            continue
        items.append(
            GlossaryItem(
                id=post.id,
                slug=post.slug,
                term=term,
                summary=post.summary,
                initial=item_initial,
                read=post.id in read,
            )
        )
    items.sort(key=lambda item: rules.glossary_sort_key(item.term))
    return GlossaryList(items=items)


def get_today_for_user(db: Session, user_id: UUID) -> PostSummary | None:
    post = _term_of_the_day(db, today_kst())
    return summaries_for(db, user_id, [post])[0] if post is not None else None


def _term_of_the_day(db: Session, day: date) -> Post | None:
    count = repository.count_published_terms(db)
    if count == 0:
        return None
    return repository.published_term_at(db, rules.term_of_the_day_index(day, count))


# ── 다른 모듈용 공개 함수(architecture 8절) ────────────────────────────


def search_posts(
    db: Session, query: str, *, kind: str | None = None, limit: int = 5
) -> list[PostSummary]:
    """공개 게시물 검색. 챗봇(15)이 용어 설명 근거로 쓴다. bookmarked·read는 False다."""
    if kind is not None and kind not in KINDS:
        raise ValueError(f"알 수 없는 게시물 종류입니다: {kind}")
    limit = max(1, min(limit, SEARCH_LIMIT_MAX))
    flt = PostFilter(kind=kind, q=query.strip() or None)
    return [to_summary(post) for post in repository.list_published(db, flt, offset=0, limit=limit)]


def get_term_of_the_day(db: Session, day: date) -> PostSummary | None:
    """공개 용어를 slug 순으로 정렬해 `day.toordinal() % 개수`번째. 없으면 None"""
    post = _term_of_the_day(db, day)
    return to_summary(post) if post is not None else None


def get_progress(db: Session, user_id: UUID) -> LearnProgress:
    published = repository.published_counts(db)
    read = repository.read_counts(db, user_id)
    by_kind = {
        kind: KindProgress(read=read.get(kind, 0), published=published.get(kind, 0))
        for kind in KINDS
    }
    return LearnProgress(
        read_count=sum(item.read for item in by_kind.values()),
        published_count=sum(item.published for item in by_kind.values()),
        by_kind=ProgressByKind(**by_kind),
    )


# ── 관리자용 ─────────────────────────────────────────────────────────


def list_admin_posts(db: Session, flt: AdminFilter, page: PageParams) -> Page[AdminPost]:
    total = repository.count_admin(db, flt)
    posts = repository.list_admin(
        db, flt, offset=(page.page - 1) * page.page_size, limit=page.page_size
    )
    return Page[AdminPost](
        items=[AdminPost.model_validate(post) for post in posts],
        page=page.page,
        page_size=page.page_size,
        total=total,
    )


def get_admin_post(db: Session, post_id: UUID) -> Post:
    post = repository.find_post(db, post_id)
    if post is None:
        raise post_not_found()
    return post


def _resolve_slug(db: Session, slug: str | None, exclude_id: UUID | None) -> str:
    if slug is None:
        for _ in range(AUTO_SLUG_ATTEMPTS):
            candidate = rules.auto_slug()
            if not repository.slug_taken(db, candidate):
                return candidate
        raise duplicate_slug()
    if not rules.is_valid_slug(slug):
        raise field_error("slug", "영문 소문자·숫자·하이픈으로 입력해 주세요.")
    if repository.slug_taken(db, slug, exclude_id):
        raise duplicate_slug()
    return slug


def _check_kind_fields(db: Session, values: dict, exclude_id: UUID | None) -> dict:
    """종류에 맞게 용어·영상 칸을 검증한다. 다른 종류의 칸은 비운다."""
    kind = values["kind"]
    term = values.get("term")
    video_url = values.get("video_url")
    video_id = None
    if kind == "glossary":
        if not term:
            raise field_error("term", "용어를 입력해 주세요.")
        if repository.term_taken(db, term, exclude_id):
            raise duplicate_term()
    else:
        term = None
    if kind == "video":
        if not video_url:
            raise field_error("videoUrl", "YouTube 링크를 입력해 주세요.")
        video_id = rules.parse_youtube_id(video_url)
        if video_id is None:
            raise field_error("videoUrl", "YouTube 링크만 등록할 수 있습니다.")
    else:
        video_url = None
    return {"term": term, "video_url": video_url, "video_id": video_id}


def _save(db: Session, post: Post) -> Post:
    try:
        repository.add(db, post)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # 검사와 저장 사이에 다른 요청이 같은 슬러그·용어를 저장한 경우
        raise AppError(409, "CONFLICT", "이미 있는 슬러그나 용어입니다.") from exc
    return post


def create_post(db: Session, author_id: UUID, data: PostCreate) -> Post:
    values = data.model_dump()
    values["slug"] = _resolve_slug(db, data.slug, None)
    values.update(_check_kind_fields(db, values, None))
    post = Post(**values, author_id=author_id)
    # 처음 공개할 때 공개 시각을 채운다.
    post.published_at = now_utc() if post.published else None
    return _save(db, post)


EDITABLE_FIELDS = (
    "kind",
    "slug",
    "title",
    "summary",
    "body_md",
    "term",
    "video_url",
    "level",
    "tags",
    "published",
    "ai_assisted",
)


def update_post(db: Session, post_id: UUID, data: PostPatch) -> Post:
    """검증을 모두 마친 뒤에 반영한다(실패하면 게시물이 바뀌지 않는다)."""
    post = get_admin_post(db, post_id)
    changes = data.model_dump(exclude_unset=True)
    values = {field: getattr(post, field) for field in EDITABLE_FIELDS} | changes
    if "slug" in changes and changes["slug"] != post.slug:
        values["slug"] = _resolve_slug(db, changes["slug"], post.id)
    else:
        values["slug"] = post.slug
    values.update(_check_kind_fields(db, values, post.id))
    for field, value in values.items():
        setattr(post, field, value)
    # 처음 공개할 때만 공개 시각을 채운다(비공개로 돌려도 지우지 않는다).
    if post.published and post.published_at is None:
        post.published_at = now_utc()
    return _save(db, post)


def delete_post(db: Session, post_id: UUID) -> None:
    post = get_admin_post(db, post_id)
    repository.remove(db, post)
    db.commit()


def _clip(value: str, limit: int) -> str:
    return value.strip()[:limit].strip()


def make_ai_draft(llm: StructuredLLM, data: AiDraftRequest) -> Draft:
    """AI 초안(저장하지 않는다). 받은 값은 입력 제한에 맞게 자른다."""
    content = (
        f"종류: {KIND_LABEL[data.kind]}\n난이도: {LEVEL_LABEL[data.level]}\n주제: {data.topic}"
    )
    output = llm.generate(
        task=AI_DRAFT_TASK, system=AI_DRAFT_SYSTEM, content=content, output=DraftOutput
    )
    tags: list[str] = []
    for tag in output.tags:
        tag = _clip(tag, MAX_TAG)
        if tag and tag not in tags:
            tags.append(tag)
    term = _clip(output.term or "", MAX_TERM) if data.kind == "glossary" else ""
    return Draft(
        title=_clip(output.title, MAX_TITLE),
        summary=_clip(output.summary, MAX_SUMMARY),
        term=term or None,
        body_md=output.body_md.strip()[:MAX_BODY],
        tags=tags[:MAX_TAGS],
    )
