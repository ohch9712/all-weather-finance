from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_serializer, field_validator

from app.core.schemas import CamelModel

Kind = Literal["article", "video", "glossary"]
Level = Literal["beginner", "basic", "intermediate"]

KINDS: tuple[Kind, ...] = ("article", "video", "glossary")
LEVELS: tuple[Level, ...] = ("beginner", "basic", "intermediate")

MAX_TITLE = 100
MAX_SUMMARY = 200
MAX_BODY = 20_000
MAX_TERM = 50
MAX_SLUG = 80
MAX_TAGS = 10
MAX_TAG = 20
MAX_VIDEO_URL = 500
MAX_TOPIC = 100


def to_utc_text(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def strip_text(value):
    return value.strip() if isinstance(value, str) else value


def strip_or_none(value):
    if isinstance(value, str):
        return value.strip() or None
    return value


# ── 사용자용 응답 ─────────────────────────────────────────────────────


class PostSummary(CamelModel):
    id: UUID
    kind: Kind
    slug: str
    title: str
    summary: str
    term: str | None
    level: Level
    tags: list[str]
    video_id: str | None
    ai_assisted: bool
    published_at: datetime | None
    bookmarked: bool = False
    read: bool = False

    @field_serializer("published_at")
    def serialize_published_at(self, value: datetime | None) -> str | None:
        return to_utc_text(value) if value is not None else None


class PostDetail(PostSummary):
    body_md: str
    video_url: str | None
    related: list[PostSummary]


class GlossaryItem(CamelModel):
    id: UUID
    slug: str
    term: str
    summary: str
    initial: str
    read: bool


class GlossaryList(CamelModel):
    items: list[GlossaryItem]


class TodayOut(CamelModel):
    post: PostSummary | None


class KindProgress(CamelModel):
    read: int
    published: int


class ProgressByKind(CamelModel):
    article: KindProgress
    video: KindProgress
    glossary: KindProgress


class LearnProgress(CamelModel):
    read_count: int
    published_count: int
    by_kind: ProgressByKind


# ── 관리자용 ──────────────────────────────────────────────────────────


class AdminPost(CamelModel):
    id: UUID
    kind: Kind
    slug: str
    title: str
    summary: str
    body_md: str
    term: str | None
    video_url: str | None
    video_id: str | None
    level: Level
    tags: list[str]
    published: bool
    published_at: datetime | None
    ai_assisted: bool
    author_id: UUID | None
    created_at: datetime
    updated_at: datetime

    @field_serializer("published_at", "created_at", "updated_at")
    def serialize_timestamp(self, value: datetime | None) -> str | None:
        return to_utc_text(value) if value is not None else None


Title = Annotated[str, Field(min_length=1, max_length=MAX_TITLE)]
Summary = Annotated[str, Field(min_length=1, max_length=MAX_SUMMARY)]
Body = Annotated[str, Field(max_length=MAX_BODY)]
Tag = Annotated[str, Field(min_length=1, max_length=MAX_TAG)]
Tags = Annotated[list[Tag], Field(max_length=MAX_TAGS)]
Term = Annotated[str | None, Field(max_length=MAX_TERM)]
VideoUrl = Annotated[str | None, Field(max_length=MAX_VIDEO_URL)]
Slug = Annotated[str | None, Field(max_length=MAX_SLUG)]


def clean_tags(value):
    """앞뒤 공백을 지우고 빈 값·중복을 뺀다(순서 유지)."""
    if not isinstance(value, list):
        return value
    cleaned: list = []
    for item in value:
        item = item.strip() if isinstance(item, str) else item
        if item == "" or item in cleaned:
            continue
        cleaned.append(item)
    return cleaned


class PostCreate(CamelModel):
    kind: Kind
    slug: Slug = None
    title: Title
    summary: Summary
    body_md: Body = ""
    term: Term = None
    video_url: VideoUrl = None
    level: Level = "beginner"
    tags: Tags = Field(default_factory=list)
    published: bool = False
    ai_assisted: bool = False

    @field_validator("title", "summary", mode="before")
    @classmethod
    def strip_required(cls, value):
        return strip_text(value)

    @field_validator("slug", "term", "video_url", mode="before")
    @classmethod
    def strip_optional(cls, value):
        return strip_or_none(value)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        return clean_tags(value)


class PostPatch(CamelModel):
    """보낸 필드만 바꾼다. `slug`를 비우면 새 자동 슬러그를 만든다."""

    kind: Kind | None = None
    slug: Slug = None
    title: Title | None = None
    summary: Summary | None = None
    body_md: Body | None = None
    term: Term = None
    video_url: VideoUrl = None
    level: Level | None = None
    tags: Tags | None = None
    published: bool | None = None
    ai_assisted: bool | None = None

    @field_validator(
        "kind",
        "title",
        "summary",
        "body_md",
        "level",
        "tags",
        "published",
        "ai_assisted",
        mode="before",
    )
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError("필수 항목입니다.")
        return value

    @field_validator("title", "summary", mode="before")
    @classmethod
    def strip_required(cls, value):
        return strip_text(value)

    @field_validator("slug", "term", "video_url", mode="before")
    @classmethod
    def strip_optional(cls, value):
        return strip_or_none(value)

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value):
        return clean_tags(value)


class AiDraftRequest(CamelModel):
    kind: Kind
    topic: Annotated[str, Field(min_length=1, max_length=MAX_TOPIC)]
    level: Level = "beginner"

    @field_validator("topic", mode="before")
    @classmethod
    def strip_topic(cls, value):
        return strip_text(value)


class DraftOutput(BaseModel):
    """AI 초안 구조화 출력. 길이 제한은 받은 뒤 서비스가 맞춘다(스키마 변환이 제한을 지운다)."""

    title: str = Field(description="게시물 제목. 100자 이내")
    summary: str = Field(description="목록과 용어 사전에 보일 한 문장 요약. 200자 이내")
    term: str | None = Field(description="용어 게시물이면 용어 이름(50자 이내), 아니면 null")
    body_md: str = Field(description="Markdown 본문. ## 소제목 2~4개")
    tags: list[str] = Field(description="짧은 한국어 태그 1~5개. 각 20자 이내")


class Draft(CamelModel):
    title: str
    summary: str
    term: str | None
    body_md: str
    tags: list[str]
