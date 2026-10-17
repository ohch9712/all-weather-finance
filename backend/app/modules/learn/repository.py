from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import Select, case, delete, desc, exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import now_utc
from app.modules.learn.models import Bookmark, Post, PostRead

# 관련 게시물 후보는 최근 공개분에서만 고른다(겹치는 태그 수는 서비스가 센다).
RELATED_CANDIDATE_LIMIT = 200


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _contains(column, q: str):
    return column.ilike(f"%{escape_like(q)}%", escape="\\")


def search_condition(q: str):
    """제목·용어·요약·본문 부분 일치(대소문자 무시)"""
    return or_(
        _contains(Post.title, q),
        _contains(Post.term, q),
        _contains(Post.summary, q),
        _contains(Post.body_md, q),
    )


def match_rank(q: str):
    """제목·용어가 검색어와 같으면 0, 제목·용어에 들어 있으면 1, 그 밖(요약·본문)은 2"""
    lowered = func.lower(literal(q))
    return case(
        (or_(func.lower(Post.title) == lowered, func.lower(Post.term) == lowered), 0),
        (or_(_contains(Post.title, q), _contains(Post.term, q)), 1),
        else_=2,
    )


def newest_first() -> tuple:
    return desc(Post.published_at).nulls_last(), Post.slug


# ── 사용자용(공개 게시물) ─────────────────────────────────────────────


@dataclass(frozen=True)
class PostFilter:
    kind: str | None = None
    level: str | None = None
    tag: str | None = None
    q: str | None = None
    bookmarked_by: UUID | None = None


def _published(query: Select, flt: PostFilter) -> Select:
    query = query.where(Post.published.is_(True))
    if flt.kind is not None:
        query = query.where(Post.kind == flt.kind)
    if flt.level is not None:
        query = query.where(Post.level == flt.level)
    if flt.tag is not None:
        query = query.where(Post.tags.any(flt.tag))
    if flt.q:
        query = query.where(search_condition(flt.q))
    if flt.bookmarked_by is not None:
        query = query.where(
            exists().where(Bookmark.post_id == Post.id, Bookmark.user_id == flt.bookmarked_by)
        )
    return query


def count_published(db: Session, flt: PostFilter) -> int:
    return db.scalar(_published(select(func.count(Post.id)), flt)) or 0


def list_published(db: Session, flt: PostFilter, *, offset: int, limit: int) -> list[Post]:
    order = (match_rank(flt.q), *newest_first()) if flt.q else newest_first()
    return list(
        db.scalars(_published(select(Post), flt).order_by(*order).offset(offset).limit(limit))
    )


def find_published_by_slug(db: Session, slug: str) -> Post | None:
    return db.scalar(select(Post).where(Post.slug == slug, Post.published.is_(True)))


def find_published(db: Session, post_id: UUID) -> Post | None:
    return db.scalar(select(Post).where(Post.id == post_id, Post.published.is_(True)))


def related_candidates(db: Session, post: Post) -> list[Post]:
    if not post.tags:
        return []
    return list(
        db.scalars(
            select(Post)
            .where(Post.published.is_(True), Post.id != post.id, Post.tags.overlap(post.tags))
            .order_by(*newest_first())
            .limit(RELATED_CANDIDATE_LIMIT)
        )
    )


def list_glossary(db: Session, q: str | None) -> list[Post]:
    return list(db.scalars(_published(select(Post), PostFilter(kind="glossary", q=q))))


def count_published_terms(db: Session) -> int:
    return count_published(db, PostFilter(kind="glossary"))


def published_term_at(db: Session, index: int) -> Post | None:
    """공개 용어를 slug 순으로 정렬했을 때 index번째"""
    return db.scalar(
        _published(select(Post), PostFilter(kind="glossary"))
        .order_by(Post.slug)
        .offset(index)
        .limit(1)
    )


def published_counts(db: Session) -> dict[str, int]:
    rows = db.execute(
        select(Post.kind, func.count(Post.id)).where(Post.published.is_(True)).group_by(Post.kind)
    )
    return {kind: count for kind, count in rows}


def read_counts(db: Session, user_id: UUID) -> dict[str, int]:
    rows = db.execute(
        select(Post.kind, func.count(Post.id))
        .join(PostRead, PostRead.post_id == Post.id)
        .where(PostRead.user_id == user_id, Post.published.is_(True))
        .group_by(Post.kind)
    )
    return {kind: count for kind, count in rows}


# ── 북마크·읽음 ───────────────────────────────────────────────────────


def bookmarked_ids(db: Session, user_id: UUID, post_ids: Iterable[UUID]) -> set[UUID]:
    ids = list(post_ids)
    if not ids:
        return set()
    return set(
        db.scalars(
            select(Bookmark.post_id).where(Bookmark.user_id == user_id, Bookmark.post_id.in_(ids))
        )
    )


def read_ids(db: Session, user_id: UUID, post_ids: Iterable[UUID]) -> set[UUID]:
    ids = list(post_ids)
    if not ids:
        return set()
    return set(
        db.scalars(
            select(PostRead.post_id).where(PostRead.user_id == user_id, PostRead.post_id.in_(ids))
        )
    )


def add_bookmark(db: Session, user_id: UUID, post_id: UUID) -> None:
    db.execute(
        insert(Bookmark)
        .values(user_id=user_id, post_id=post_id, created_at=now_utc())
        .on_conflict_do_nothing(index_elements=["user_id", "post_id"])
    )


def remove_bookmark(db: Session, user_id: UUID, post_id: UUID) -> None:
    db.execute(delete(Bookmark).where(Bookmark.user_id == user_id, Bookmark.post_id == post_id))


def mark_read(db: Session, user_id: UUID, post_id: UUID) -> None:
    statement = insert(PostRead).values(user_id=user_id, post_id=post_id, read_at=now_utc())
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["user_id", "post_id"],
            set_={"read_at": statement.excluded.read_at},
        )
    )


# ── 관리자용(비공개 포함) ─────────────────────────────────────────────


@dataclass(frozen=True)
class AdminFilter:
    published: bool | None = None
    kind: str | None = None
    q: str | None = None


def _admin_filtered(query: Select, flt: AdminFilter) -> Select:
    if flt.published is not None:
        query = query.where(Post.published.is_(flt.published))
    if flt.kind is not None:
        query = query.where(Post.kind == flt.kind)
    if flt.q:
        query = query.where(or_(search_condition(flt.q), _contains(Post.slug, flt.q)))
    return query


def count_admin(db: Session, flt: AdminFilter) -> int:
    return db.scalar(_admin_filtered(select(func.count(Post.id)), flt)) or 0


def list_admin(db: Session, flt: AdminFilter, *, offset: int, limit: int) -> list[Post]:
    return list(
        db.scalars(
            _admin_filtered(select(Post), flt)
            .order_by(desc(Post.updated_at), Post.slug)
            .offset(offset)
            .limit(limit)
        )
    )


def find_post(db: Session, post_id: UUID) -> Post | None:
    return db.get(Post, post_id)


def find_by_slug(db: Session, slug: str) -> Post | None:
    return db.scalar(select(Post).where(Post.slug == slug))


def slug_taken(db: Session, slug: str, exclude_id: UUID | None = None) -> bool:
    query = select(Post.id).where(Post.slug == slug)
    if exclude_id is not None:
        query = query.where(Post.id != exclude_id)
    return db.scalar(query.limit(1)) is not None


def term_taken(db: Session, term: str, exclude_id: UUID | None = None) -> bool:
    query = select(Post.id).where(Post.kind == "glossary", Post.term == term)
    if exclude_id is not None:
        query = query.where(Post.id != exclude_id)
    return db.scalar(query.limit(1)) is not None


def add(db: Session, entity) -> None:
    db.add(entity)
    db.flush()


def remove(db: Session, entity) -> None:
    db.delete(entity)
    db.flush()
