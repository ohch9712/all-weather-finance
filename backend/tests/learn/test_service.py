import inspect
from datetime import UTC, date, datetime
from uuid import UUID

from app.modules.learn import repository, service
from app.modules.learn.schemas import LearnProgress, PostSummary
from tests.learn.helpers import make_post


def test_public_signatures_match_architecture():
    assert str(inspect.signature(service.search_posts)) == (
        "(db: sqlalchemy.orm.session.Session, query: str, *, kind: str | None = None, "
        "limit: int = 5) -> list[app.modules.learn.schemas.PostSummary]"
    )
    assert str(inspect.signature(service.get_term_of_the_day)) == (
        "(db: sqlalchemy.orm.session.Session, day: datetime.date) "
        "-> app.modules.learn.schemas.PostSummary | None"
    )
    assert str(inspect.signature(service.get_progress)) == (
        "(db: sqlalchemy.orm.session.Session, user_id: uuid.UUID) "
        "-> app.modules.learn.schemas.LearnProgress"
    )


def test_search_posts_returns_published_matches_without_user_flags(db):
    make_post(db, "per", kind="glossary", term="PER", title="PER(주가수익비율)")
    make_post(db, "compare", title="PER·PBR 비교", published_at=datetime(2026, 10, 5, tzinfo=UTC))
    make_post(
        db, "mention", summary="per를 본문에서 다룸", published_at=datetime(2026, 10, 9, tzinfo=UTC)
    )
    make_post(db, "hidden", kind="glossary", term="PER2", title="PER 숨김", published=False)

    results = service.search_posts(db, "per")
    assert all(isinstance(item, PostSummary) for item in results)
    # 제목·용어가 같은 것 → 제목·용어에 들어 있는 것 → 그 밖, 같은 순위는 공개일 최신 순
    assert [item.slug for item in results] == ["per", "compare", "mention"]
    assert not any(item.bookmarked or item.read for item in results)

    assert [item.slug for item in service.search_posts(db, "PER", kind="glossary")] == ["per"]
    assert len(service.search_posts(db, "per", limit=1)) == 1


def test_get_term_of_the_day(db):
    assert service.get_term_of_the_day(db, date(2026, 10, 17)) is None
    for slug in ("c-term", "a-term", "b-term"):
        make_post(db, slug, kind="glossary", term=slug)
    make_post(db, "z-hidden", kind="glossary", term="hidden", published=False)
    make_post(db, "article", kind="article")

    day = date(2026, 10, 17)
    expected = ["a-term", "b-term", "c-term"][day.toordinal() % 3]
    today = service.get_term_of_the_day(db, day)
    assert isinstance(today, PostSummary) and today.slug == expected
    assert service.get_term_of_the_day(db, day).slug == expected
    following = ["a-term", "b-term", "c-term"][(day.toordinal() + 1) % 3]
    assert service.get_term_of_the_day(db, date(2026, 10, 18)).slug == following


def test_get_progress_counts_published_only(db, auth_client):
    user_id = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    article = make_post(db, "a1")
    make_post(db, "a2")
    term = make_post(db, "t1", kind="glossary")
    make_post(db, "v1", kind="video")
    hidden = make_post(db, "hidden", published=False)
    for post in (article, term, hidden):
        repository.mark_read(db, user_id, post.id)
    db.commit()

    progress = service.get_progress(db, user_id)
    assert isinstance(progress, LearnProgress)
    # 비공개 게시물의 읽음 기록은 진도에 넣지 않는다.
    assert progress.model_dump(by_alias=True) == {
        "readCount": 2,
        "publishedCount": 4,
        "byKind": {
            "article": {"read": 1, "published": 2},
            "video": {"read": 0, "published": 1},
            "glossary": {"read": 1, "published": 1},
        },
    }
