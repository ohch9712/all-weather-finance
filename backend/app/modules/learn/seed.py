"""학습 게시판 시드: `uv run python -m app.modules.learn.seed`

`seed_data/*.md`(앞머리 YAML: kind, slug, title, summary, term, level, tags)를 읽어 slug 기준으로
만들거나 고치고 공개한다. 여러 번 실행해도 결과가 같다.
"""

from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.time import now_utc
from app.modules.learn import repository, rules
from app.modules.learn.models import Post
from app.modules.learn.schemas import PostCreate

SEED_DIR = Path(__file__).parent / "seed_data"
FRONT_MATTER_FIELDS = {"kind", "slug", "title", "summary", "term", "level", "tags"}


@dataclass(frozen=True)
class SeedEntry:
    kind: str
    slug: str
    title: str
    summary: str
    term: str | None
    level: str
    tags: list[str]
    body_md: str


@dataclass(frozen=True)
class SeedResult:
    created: int
    updated: int
    unchanged: int


def parse_seed_file(path: Path) -> SeedEntry:
    text = path.read_text(encoding="utf-8")
    _, separator, rest = text.partition("---\n")
    front, separator2, body = rest.partition("\n---\n")
    if not text.startswith("---\n") or not separator or not separator2:
        raise ValueError(f"{path.name}: 앞머리(---)를 찾을 수 없습니다.")
    meta = yaml.safe_load(front) or {}
    if not isinstance(meta, dict) or set(meta) - FRONT_MATTER_FIELDS:
        raise ValueError(f"{path.name}: 앞머리 항목을 확인해 주세요.")
    try:
        data = PostCreate.model_validate({**meta, "body_md": body.strip() + "\n"})
    except ValidationError as exc:
        raise ValueError(f"{path.name}: {exc}") from exc
    if data.kind == "video":
        raise ValueError(f"{path.name}: 영상은 시드하지 않습니다.")
    if data.slug is None or not rules.is_valid_slug(data.slug):
        raise ValueError(f"{path.name}: slug를 확인해 주세요.")
    if data.kind == "glossary" and not data.term:
        raise ValueError(f"{path.name}: 용어에는 term이 필요합니다.")
    return SeedEntry(
        kind=data.kind,
        slug=data.slug,
        title=data.title,
        summary=data.summary,
        term=data.term if data.kind == "glossary" else None,
        level=data.level,
        tags=data.tags,
        body_md=data.body_md,
    )


def load_seed_entries(seed_dir: Path = SEED_DIR) -> list[SeedEntry]:
    entries = [parse_seed_file(path) for path in sorted(seed_dir.glob("*.md"))]
    slugs = [entry.slug for entry in entries]
    if len(set(slugs)) != len(slugs):
        raise ValueError("시드 slug가 겹칩니다.")
    return entries


def seed_posts(db: Session, entries: list[SeedEntry] | None = None) -> SeedResult:
    """slug 기준 upsert 후 공개한다. 한 트랜잭션이다."""
    entries = load_seed_entries() if entries is None else entries
    created = updated = unchanged = 0
    published_at = now_utc()
    try:
        for entry in entries:
            values = {
                "kind": entry.kind,
                "title": entry.title,
                "summary": entry.summary,
                "body_md": entry.body_md,
                "term": entry.term,
                "video_url": None,
                "video_id": None,
                "level": entry.level,
                "tags": entry.tags,
                "published": True,
            }
            post = repository.find_by_slug(db, entry.slug)
            if post is None:
                repository.add(
                    db,
                    Post(slug=entry.slug, published_at=published_at, ai_assisted=False, **values),
                )
                created += 1
                continue
            changed = {key: value for key, value in values.items() if getattr(post, key) != value}
            if post.published_at is None:
                changed["published_at"] = published_at
            if not changed:
                unchanged += 1
                continue
            for key, value in changed.items():
                setattr(post, key, value)
            db.flush()
            updated += 1
        db.commit()
    except Exception:
        db.rollback()
        raise
    return SeedResult(created=created, updated=updated, unchanged=unchanged)


def load_all_models() -> None:
    """단독 실행할 때도 FK 대상(users) 메타데이터가 있도록 전 모듈 모델을 불러온다."""
    import app.db.models  # noqa: F401


def main() -> int:
    from app.db.session import SessionLocal

    load_all_models()
    with SessionLocal() as db:
        result = seed_posts(db)
    print(
        f"학습 게시판 시드: 새로 만듦 {result.created}개, 고침 {result.updated}개, "
        f"그대로 {result.unchanged}개"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
