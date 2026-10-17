from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from app.modules.learn import repository, service
from app.modules.learn.models import PostRead
from tests.learn.helpers import error_of, make_post, post_json, send_delete, slugs_of

SUMMARY_FIELDS = {
    "id",
    "kind",
    "slug",
    "title",
    "summary",
    "term",
    "level",
    "tags",
    "videoId",
    "aiAssisted",
    "publishedAt",
    "bookmarked",
    "read",
}


def at(day: int) -> datetime:
    return datetime(2026, 10, day, tzinfo=UTC)


def test_requires_login(client, db):
    post = make_post(db, "per")
    for path in (
        "/api/learn/posts",
        "/api/learn/posts/per",
        "/api/learn/glossary",
        "/api/learn/today",
        "/api/learn/progress",
    ):
        assert error_of(client.get(path), 401)["code"] == "UNAUTHENTICATED"
    assert post_json(client, f"/api/learn/posts/{post.id}/bookmark").status_code == 401
    assert post_json(client, f"/api/learn/posts/{post.id}/read").status_code == 401


def test_list_shape_hides_unpublished_and_paginates(auth_client, db):
    for index in range(14):
        make_post(db, f"post-{index:02d}", published_at=at(index + 1))
    make_post(db, "draft", published=False, published_at=None)

    response = auth_client.get("/api/learn/posts")
    assert response.status_code == 200
    body = response.json()
    assert (body["page"], body["pageSize"], body["total"]) == (1, 12, 14)
    assert len(body["items"]) == 12
    first = body["items"][0]
    assert set(first) == SUMMARY_FIELDS
    assert first["slug"] == "post-13"  # 공개일 최신 순
    assert first["publishedAt"] == "2026-10-14T00:00:00Z"
    assert (first["bookmarked"], first["read"], first["videoId"]) == (False, False, None)

    page2 = auth_client.get("/api/learn/posts?page=2&pageSize=12").json()
    assert slugs_of_page(page2) == ["post-01", "post-00"]
    assert "draft" not in slugs_of(auth_client.get("/api/learn/posts?pageSize=100"))

    assert error_of(auth_client.get("/api/learn/posts?pageSize=101"), 422)["code"] == (
        "VALIDATION_ERROR"
    )
    assert error_of(auth_client.get("/api/learn/posts?page=0"), 422)["code"] == "VALIDATION_ERROR"


def slugs_of_page(body: dict) -> list[str]:
    return [item["slug"] for item in body["items"]]


def test_filters_kind_level_tag(auth_client, db):
    make_post(db, "art-basic", level="basic", tags=["지표"], published_at=at(3))
    make_post(db, "art-beginner", tags=["기초", "지표"], published_at=at(2))
    make_post(db, "term-per", kind="glossary", term="PER", level="basic", tags=["지표"])
    make_post(db, "video-1", kind="video", tags=["기초"], published_at=at(5))

    assert slugs_of(auth_client.get("/api/learn/posts?kind=glossary")) == ["term-per"]
    assert slugs_of(auth_client.get("/api/learn/posts?kind=video")) == ["video-1"]
    assert slugs_of(auth_client.get("/api/learn/posts?level=basic")) == ["art-basic", "term-per"]
    assert slugs_of(auth_client.get("/api/learn/posts?tag=기초")) == ["video-1", "art-beginner"]
    assert slugs_of(auth_client.get("/api/learn/posts?kind=article&tag=지표&level=beginner")) == [
        "art-beginner"
    ]
    # 화면이 보내는 빈 필터는 조건 없음이다.
    assert len(slugs_of(auth_client.get("/api/learn/posts?kind=&level=&tag=&q="))) == 4

    video = auth_client.get("/api/learn/posts?kind=video").json()["items"][0]
    assert video["videoId"] == "dQw4w9WgXcQ"

    error = error_of(auth_client.get("/api/learn/posts?kind=news"), 422)
    assert error["details"][0]["field"] == "kind"
    error = error_of(auth_client.get("/api/learn/posts?level=expert"), 422)
    assert error["details"][0]["field"] == "level"


def test_search_matches_fields_and_ranks_title_term_first(auth_client, db):
    make_post(db, "per", kind="glossary", term="PER", title="PER(주가수익비율)", published_at=at(1))
    make_post(db, "compare", title="per·pbr 비교법", published_at=at(2))
    make_post(db, "body-only", body_md="여기서 PER을 설명해요", published_at=at(9))
    make_post(db, "summary-only", summary="PER 이야기", published_at=at(8))
    make_post(db, "other", title="채권", published_at=at(10))
    make_post(db, "hidden", title="PER 비공개", published=False)

    assert slugs_of(auth_client.get("/api/learn/posts?q=Per")) == [
        "per",
        "compare",
        "body-only",
        "summary-only",
    ]
    # LIKE 특수문자는 글자 그대로 찾는다.
    make_post(db, "percent", title="수익률 100%", published_at=at(4))
    assert slugs_of(auth_client.get("/api/learn/posts?q=%25")) == ["percent"]
    assert slugs_of(auth_client.get("/api/learn/posts?q=_")) == []


def test_detail_fields_related_and_hidden(auth_client, db):
    main = make_post(
        db,
        "main",
        tags=["지표", "가치평가"],
        body_md="## 소제목\n본문",
        ai_assisted=True,
        published_at=at(1),
    )
    make_post(db, "two-tags", tags=["가치평가", "지표"], published_at=at(2))
    make_post(db, "one-tag-new", tags=["지표"], published_at=at(9))
    make_post(db, "one-tag-old", tags=["가치평가"], published_at=at(3))
    make_post(db, "one-tag-oldest", tags=["지표"], published_at=at(1))
    make_post(db, "no-overlap", tags=["채권"], published_at=at(10))
    make_post(db, "hidden-overlap", tags=["지표", "가치평가"], published=False)

    response = auth_client.get("/api/learn/posts/main")
    assert response.status_code == 200
    detail = response.json()
    assert set(detail) == SUMMARY_FIELDS | {"bodyMd", "videoUrl", "related"}
    assert detail["id"] == str(main.id)
    assert (detail["bodyMd"], detail["videoUrl"], detail["aiAssisted"]) == (
        "## 소제목\n본문",
        None,
        True,
    )
    # 겹치는 태그가 많은 순 → 공개일 최신 순, 최대 3개, 자기 자신·비공개 제외
    assert [item["slug"] for item in detail["related"]] == [
        "two-tags",
        "one-tag-new",
        "one-tag-old",
    ]
    assert set(detail["related"][0]) == SUMMARY_FIELDS

    assert error_of(auth_client.get("/api/learn/posts/hidden-overlap"), 404)["code"] == (
        "NOT_FOUND"
    )
    assert error_of(auth_client.get("/api/learn/posts/nothing"), 404)["code"] == "NOT_FOUND"


def test_video_detail_has_url(auth_client, db):
    make_post(db, "video", kind="video", video_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    detail = auth_client.get("/api/learn/posts/video").json()
    assert detail["videoUrl"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert detail["videoId"] == "dQw4w9WgXcQ"
    assert detail["related"] == []


def test_bookmark_is_idempotent(auth_client, db):
    post = make_post(db, "per")
    path = f"/api/learn/posts/{post.id}/bookmark"
    assert post_json(auth_client, path).status_code == 204
    assert post_json(auth_client, path).status_code == 204
    item = auth_client.get("/api/learn/posts").json()["items"][0]
    assert item["bookmarked"] is True
    assert slugs_of(auth_client.get("/api/learn/posts?bookmarked=true")) == ["per"]
    assert auth_client.get("/api/learn/posts/per").json()["bookmarked"] is True

    assert send_delete(auth_client, path).status_code == 204
    assert send_delete(auth_client, path).status_code == 204
    assert auth_client.get("/api/learn/posts").json()["items"][0]["bookmarked"] is False
    assert slugs_of(auth_client.get("/api/learn/posts?bookmarked=true")) == []


def test_read_is_idempotent_upsert(auth_client, db, monkeypatch):
    post = make_post(db, "per")
    path = f"/api/learn/posts/{post.id}/read"
    monkeypatch.setattr(repository, "now_utc", lambda: datetime(2026, 10, 16, 1, tzinfo=UTC))
    assert post_json(auth_client, path).status_code == 204
    monkeypatch.setattr(repository, "now_utc", lambda: datetime(2026, 10, 17, 1, tzinfo=UTC))
    assert post_json(auth_client, path).status_code == 204
    reads = db.query(PostRead).filter(PostRead.post_id == post.id).all()
    assert len(reads) == 1
    assert reads[0].read_at == datetime(2026, 10, 17, 1, tzinfo=UTC)
    assert auth_client.get("/api/learn/posts").json()["items"][0]["read"] is True
    assert auth_client.get("/api/learn/progress").json()["readCount"] == 1


@pytest.mark.parametrize("action", ["bookmark", "read"])
def test_actions_on_hidden_or_missing_post_are_404(auth_client, db, action):
    hidden = make_post(db, "hidden", published=False)
    assert error_of(post_json(auth_client, f"/api/learn/posts/{hidden.id}/{action}"), 404)[
        "code"
    ] == ("NOT_FOUND")
    assert post_json(auth_client, f"/api/learn/posts/{uuid4()}/{action}").status_code == 404
    assert post_json(auth_client, f"/api/learn/posts/not-a-uuid/{action}").status_code == 422
    if action == "bookmark":
        assert send_delete(auth_client, f"/api/learn/posts/{hidden.id}/bookmark").status_code == 404


def test_state_changes_require_json(auth_client, db):
    post = make_post(db, "per")
    response = auth_client.post(f"/api/learn/posts/{post.id}/bookmark")
    assert error_of(response, 422)["code"] == "VALIDATION_ERROR"


def test_bookmarks_and_reads_are_private(auth_client, other_auth_client, db):
    post = make_post(db, "per", kind="glossary", term="PER")
    assert post_json(auth_client, f"/api/learn/posts/{post.id}/bookmark").status_code == 204
    assert post_json(auth_client, f"/api/learn/posts/{post.id}/read").status_code == 204

    mine = auth_client.get("/api/learn/posts").json()["items"][0]
    assert (mine["bookmarked"], mine["read"]) == (True, True)

    theirs = other_auth_client.get("/api/learn/posts").json()["items"][0]
    assert (theirs["bookmarked"], theirs["read"]) == (False, False)
    assert slugs_of(other_auth_client.get("/api/learn/posts?bookmarked=true")) == []
    detail = other_auth_client.get("/api/learn/posts/per").json()
    assert (detail["bookmarked"], detail["read"]) == (False, False)
    assert other_auth_client.get("/api/learn/glossary").json()["items"][0]["read"] is False
    assert other_auth_client.get("/api/learn/progress").json()["readCount"] == 0

    # 다른 사용자가 북마크를 지워도 내 북마크는 그대로다.
    assert send_delete(other_auth_client, f"/api/learn/posts/{post.id}/bookmark").status_code == (
        204
    )
    assert auth_client.get("/api/learn/posts?bookmarked=true").json()["total"] == 1


def test_glossary_sorted_filtered_by_initial_and_query(auth_client, db):
    for slug, term, summary in (
        ("per", "PER", "주가수익비율"),
        ("stock", "주식", "회사의 조각"),
        ("bond", "채권", "빌려준 증서"),
        ("ssal", "쌍봉", "쌍자음 시험"),
        ("etf", "ETF", "상장지수펀드"),
        ("x3", "3배", "숫자로 시작"),
        ("dividend", "배당", "이익 나눔"),
    ):
        make_post(db, slug, kind="glossary", term=term, summary=summary)
    make_post(db, "article", kind="article", title="주식 글")
    make_post(db, "hidden", kind="glossary", term="감춤", published=False)

    response = auth_client.get("/api/learn/glossary")
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["term"] for item in items] == ["배당", "쌍봉", "주식", "채권", "ETF", "PER", "3배"]
    assert set(items[0]) == {"id", "slug", "term", "summary", "initial", "read"}
    assert [item["initial"] for item in items] == ["ㅂ", "ㅅ", "ㅈ", "ㅊ", "E", "P", "#"]

    def terms(query: str) -> list[str]:
        result = auth_client.get(f"/api/learn/glossary?{query}")
        assert result.status_code == 200, result.text
        return [item["term"] for item in result.json()["items"]]

    assert terms("initial=ㅅ") == ["쌍봉"]
    assert terms("initial=e") == ["ETF"]
    assert terms("initial=%23") == ["3배"]
    assert terms("initial=ㄱ") == []
    assert terms("q=펀드") == ["ETF"]
    assert terms("q=per&initial=P") == ["PER"]
    assert terms("initial=&q=") == ["배당", "쌍봉", "주식", "채권", "ETF", "PER", "3배"]

    for bad in ("ㄲ", "1", "가"):
        error = error_of(auth_client.get(f"/api/learn/glossary?initial={bad}"), 422)
        assert error["details"][0]["field"] == "initial"


def test_today_and_progress(auth_client, db, monkeypatch):
    assert auth_client.get("/api/learn/today").json() == {"post": None}
    empty = auth_client.get("/api/learn/progress").json()
    assert empty == {
        "readCount": 0,
        "publishedCount": 0,
        "byKind": {
            "article": {"read": 0, "published": 0},
            "video": {"read": 0, "published": 0},
            "glossary": {"read": 0, "published": 0},
        },
    }

    terms = [make_post(db, slug, kind="glossary", term=slug) for slug in ("b-two", "a-one", "c-3")]
    make_post(db, "art")
    monkeypatch.setattr(service, "today_kst", lambda: date(2026, 10, 17))
    today = auth_client.get("/api/learn/today").json()["post"]
    ordered = ["a-one", "b-two", "c-3"]
    assert today["slug"] == ordered[date(2026, 10, 17).toordinal() % 3]
    assert set(today) == SUMMARY_FIELDS

    target = next(post for post in terms if post.slug == today["slug"])
    assert post_json(auth_client, f"/api/learn/posts/{target.id}/read").status_code == 204
    assert auth_client.get("/api/learn/today").json()["post"]["read"] is True

    progress = auth_client.get("/api/learn/progress").json()
    assert progress["readCount"] == 1 and progress["publishedCount"] == 4
    assert progress["byKind"]["glossary"] == {"read": 1, "published": 3}
    assert progress["byKind"]["article"] == {"read": 0, "published": 1}
