from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import now_utc
from app.db.base import Base


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint("kind in ('article','video','glossary')", name="kind"),
        CheckConstraint("level in ('beginner','basic','intermediate')", name="level"),
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug"),
        CheckConstraint("char_length(body_md) <= 20000", name="body_md"),
        CheckConstraint("coalesce(array_length(tags, 1), 0) <= 10", name="tags"),
        CheckConstraint("kind <> 'glossary' or term is not null", name="term"),
        CheckConstraint("kind <> 'video' or video_url is not null", name="video_url"),
        # 용어끼리만 중복을 막는다.
        Index("uq_posts_term", "term", unique=True, postgresql_where=text("kind = 'glossary'")),
        Index(
            "ix_posts_kind_published_published_at", "kind", "published", text("published_at desc")
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))
    kind: Mapped[str] = mapped_column(String(10))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(100))
    summary: Mapped[str] = mapped_column(String(200))
    body_md: Mapped[str] = mapped_column(Text, default="", server_default="")
    term: Mapped[str | None] = mapped_column(String(50))
    video_url: Mapped[str | None] = mapped_column(Text)
    video_id: Mapped[str | None] = mapped_column(String(20))
    level: Mapped[str] = mapped_column(String(12))
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), default=list, server_default=text("'{}'")
    )
    published: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ai_assisted: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # 시드 게시물은 작성자가 없다.
    author_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now(), onupdate=now_utc
    )


class Bookmark(Base):
    __tablename__ = "bookmarks"
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    post_id: Mapped[UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )


class PostRead(Base):
    __tablename__ = "post_reads"
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    post_id: Mapped[UUID] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, server_default=func.now()
    )
