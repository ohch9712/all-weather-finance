import subprocess
import sys

import pytest
from sqlalchemy import func, select

from app.modules.learn import seed
from app.modules.learn.models import Post

# 스펙 07 7절 목록
GLOSSARY_SLUGS = {
    "stock",
    "bond",
    "etf",
    "index-fund",
    "dividend",
    "dividend-yield",
    "market-cap",
    "per",
    "pbr",
    "roe",
    "eps",
    "deposit",
    "quote",
    "market-order",
    "limit-order",
    "price-limit",
    "kospi",
    "kosdaq",
    "diversification",
    "asset-allocation",
    "rebalancing",
    "compound-interest",
    "inflation",
    "base-rate",
    "exchange-rate",
    "stop-loss",
    "averaging-down",
    "leveraged-etf",
    "isa",
    "pension-savings",
}
ARTICLE_SLUGS = {
    "before-first-account": "주식 계좌를 만들기 전에 알아둘 것",
    "why-age-based-allocation": "나이에 따라 자산배분이 달라지는 이유",
    "start-with-etf": "ETF로 시작하는 분산투자",
    "compare-with-per-pbr": "PER·PBR로 종목을 비교하는 법",
    "why-trading-journal": "매매일지를 써야 하는 이유",
}


def all_posts(db) -> list[Post]:
    return list(db.scalars(select(Post).order_by(Post.slug)))


def test_seed_files_match_spec_list():
    entries = seed.load_seed_entries()
    assert len(entries) == 35
    assert {e.slug for e in entries if e.kind == "glossary"} == GLOSSARY_SLUGS
    assert {e.slug: e.title for e in entries if e.kind == "article"} == ARTICLE_SLUGS
    for entry in entries:
        assert entry.kind in ("glossary", "article")
        assert entry.summary and entry.body_md.strip()
        assert entry.body_md.count("\n## ") + entry.body_md.startswith("## ") >= 2
        assert "<" not in entry.body_md, f"{entry.slug}: 원시 HTML을 쓰지 않는다"
        if entry.kind == "glossary":
            assert entry.term
        else:
            assert entry.term is None


def test_seed_is_idempotent_and_publishes_everything(db):
    first = seed.seed_posts(db)
    assert (first.created, first.updated, first.unchanged) == (35, 0, 0)
    published_at = {post.slug: post.published_at for post in all_posts(db)}

    second = seed.seed_posts(db)
    assert (second.created, second.updated, second.unchanged) == (0, 0, 35)

    posts = all_posts(db)
    assert len(posts) == 35
    assert db.scalar(select(func.count(Post.id))) == 35
    assert all(post.published and post.published_at is not None for post in posts)
    assert all(post.author_id is None and not post.ai_assisted for post in posts)
    assert {post.slug: post.published_at for post in posts} == published_at
    assert sum(post.kind == "glossary" for post in posts) == 30
    assert sum(post.kind == "article" for post in posts) == 5


def test_seed_restores_changed_and_unpublished_posts(db):
    seed.seed_posts(db)
    post = db.scalar(select(Post).where(Post.slug == "per"))
    original_title = post.title
    post.title = "바뀐 제목"
    post.published = False
    db.commit()

    result = seed.seed_posts(db)
    assert (result.created, result.updated, result.unchanged) == (0, 1, 34)
    db.refresh(post)
    assert post.title == original_title and post.published


def test_parse_seed_file_rejects_bad_front_matter(tmp_path):
    bad = tmp_path / "bad.md"
    bad.write_text(
        "---\nkind: glossary\nslug: Bad Slug\ntitle: t\nsummary: s\nlevel: beginner\n---\n본문\n"
    )
    with pytest.raises(ValueError):
        seed.parse_seed_file(bad)
    missing_term = tmp_path / "term.md"
    missing_term.write_text("---\nkind: glossary\nslug: t\ntitle: t\nsummary: s\n---\n본문\n")
    with pytest.raises(ValueError):
        seed.parse_seed_file(missing_term)
    no_front = tmp_path / "plain.md"
    no_front.write_text("본문만 있음\n")
    with pytest.raises(ValueError):
        seed.parse_seed_file(no_front)


def test_seed_command_resolves_user_foreign_key_standalone():
    """시드 명령처럼 앱 없이 불러와도 posts.author_id → users FK가 풀린다."""
    code = (
        "from app.modules.learn import seed; seed.load_all_models(); "
        "from app.modules.learn.models import Post; "
        "print([fk.column.table.name for fk in Post.__table__.foreign_keys])"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, check=True
    )
    assert result.stdout.strip() == "['users']"
