import re
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.modules.learn import service
from app.modules.learn.models import Bookmark
from tests.learn.helpers import error_of, make_post, post_json, send_delete

ADMIN_FIELDS = {
    "id",
    "kind",
    "slug",
    "title",
    "summary",
    "bodyMd",
    "term",
    "videoUrl",
    "videoId",
    "level",
    "tags",
    "published",
    "publishedAt",
    "aiAssisted",
    "authorId",
    "createdAt",
    "updatedAt",
}
BASE = "/api/learn/admin/posts"


def article(**fields) -> dict:
    return {"kind": "article", "title": "제목", "summary": "요약", **fields}


def create(client, body: dict) -> dict:
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def admin_id(client) -> str:
    return client.get("/api/auth/me").json()["user"]["id"]


def test_admin_routes_are_forbidden_for_users(auth_client, client, db):
    post = make_post(db, "per")
    requests = [
        ("get", BASE, None),
        ("post", BASE, article()),
        ("get", f"{BASE}/{post.id}", None),
        ("patch", f"{BASE}/{post.id}", {"title": "바꿈"}),
        ("delete", f"{BASE}/{post.id}", None),
        ("post", "/api/learn/admin/ai-draft", {"kind": "glossary", "topic": "PBR"}),
    ]
    for method, path, body in requests:
        kwargs = (
            {"json": body}
            if body is not None
            else {"headers": {"Content-Type": "application/json"}}
        )
        response = getattr(auth_client, method)(path, **kwargs)
        assert error_of(response, 403)["code"] == "FORBIDDEN", (method, path)
        response = getattr(client, method)(path, **kwargs)
        assert error_of(response, 401)["code"] == "UNAUTHENTICATED", (method, path)
    # 막힌 요청은 아무것도 바꾸지 않는다.
    assert auth_client.get("/api/learn/posts/per").json()["title"] == "per 제목"


def test_create_article_with_auto_slug(admin_client):
    body = create(
        admin_client,
        article(
            slug="  ",
            title=" 첫 글 ",
            bodyMd="## 소제목\n본문",
            tags=[" 기초 ", "기초", "", "지표"],
            level="basic",
        ),
    )
    assert set(body) == ADMIN_FIELDS
    assert re.fullmatch(r"p-[0-9a-f]{8}", body["slug"])
    assert (body["title"], body["summary"], body["bodyMd"]) == ("첫 글", "요약", "## 소제목\n본문")
    assert (body["tags"], body["level"]) == (["기초", "지표"], "basic")
    assert (body["published"], body["publishedAt"], body["aiAssisted"]) == (False, None, False)
    assert (body["term"], body["videoUrl"], body["videoId"]) == (None, None, None)
    assert body["authorId"] == admin_id(admin_client)
    assert body["createdAt"].endswith("Z") and body["updatedAt"].endswith("Z")

    assert admin_client.get(f"{BASE}/{body['id']}").json() == body
    # 비공개 게시물은 사용자 목록·상세에 보이지 않는다.
    assert admin_client.get("/api/learn/posts").json()["total"] == 0
    assert admin_client.get(f"/api/learn/posts/{body['slug']}").status_code == 404

    missing_slug = create(admin_client, article())
    assert re.fullmatch(r"p-[0-9a-f]{8}", missing_slug["slug"])
    assert missing_slug["slug"] != body["slug"]


def test_create_published_sets_published_at(admin_client):
    body = create(admin_client, article(slug="hello", published=True, aiAssisted=True))
    assert body["published"] is True and body["aiAssisted"] is True
    assert body["publishedAt"].endswith("Z")
    assert admin_client.get("/api/learn/posts/hello").status_code == 200


@pytest.mark.parametrize(
    "slug", ["Upper", "under_score", "-dash", "공백 슬러그", "a" * 81, "glossary"]
)
def test_invalid_slug_is_422(admin_client, slug):
    error = error_of(admin_client.post(BASE, json=article(slug=slug)), 422)
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"][0]["field"] == "slug"


def test_duplicate_slug_is_409(admin_client, db):
    make_post(db, "taken")
    assert error_of(admin_client.post(BASE, json=article(slug="taken")), 409)["code"] == "CONFLICT"
    other = create(admin_client, article(slug="mine"))
    response = admin_client.patch(f"{BASE}/{other['id']}", json={"slug": "taken"})
    assert error_of(response, 409)["code"] == "CONFLICT"
    assert admin_client.get(f"{BASE}/{other['id']}").json()["slug"] == "mine"


def test_glossary_requires_unique_term(admin_client, db):
    error = error_of(admin_client.post(BASE, json=article(kind="glossary", slug="pbr")), 422)
    assert error["details"][0]["field"] == "term"

    body = create(admin_client, article(kind="glossary", slug="pbr", term=" PBR "))
    assert body["term"] == "PBR"

    response = admin_client.post(BASE, json=article(kind="glossary", slug="pbr-2", term="PBR"))
    assert error_of(response, 409)["code"] == "CONFLICT"
    # 글은 용어 칸을 쓰지 않으므로 같은 값이어도 겹치지 않는다.
    assert create(admin_client, article(slug="pbr-article", term="PBR"))["term"] is None

    second = create(admin_client, article(kind="glossary", slug="per", term="PER"))
    response = admin_client.patch(f"{BASE}/{second['id']}", json={"term": "PBR"})
    assert error_of(response, 409)["code"] == "CONFLICT"
    response = admin_client.patch(f"{BASE}/{second['id']}", json={"term": None})
    assert error_of(response, 422)["details"][0]["field"] == "term"
    assert admin_client.get(f"{BASE}/{second['id']}").json()["term"] == "PER"


@pytest.mark.parametrize(
    ("url", "video_id"),
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/a-b_c-d_e-f", "a-b_c-d_e-f"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ],
)
def test_video_url_formats(admin_client, url, video_id):
    body = create(admin_client, article(kind="video", videoUrl=url, published=True))
    assert (body["videoUrl"], body["videoId"]) == (url, video_id)
    summary = admin_client.get("/api/learn/posts?kind=video").json()["items"][0]
    assert summary["videoId"] == video_id


@pytest.mark.parametrize(
    "url",
    [
        "https://vimeo.com/123456789",
        "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=short",
        "javascript:alert(1)",
    ],
)
def test_video_url_rejects_other_hosts(admin_client, url):
    error = error_of(admin_client.post(BASE, json=article(kind="video", videoUrl=url)), 422)
    assert error["details"] == [
        {"field": "videoUrl", "message": "YouTube 링크만 등록할 수 있습니다."}
    ]


def test_video_requires_url(admin_client):
    error = error_of(admin_client.post(BASE, json=article(kind="video")), 422)
    assert error["details"][0]["field"] == "videoUrl"


def test_body_and_field_limits(admin_client):
    long_body = article(bodyMd="가" * 20_001)
    assert error_of(admin_client.post(BASE, json=long_body), 422)["details"][0]["field"] == "bodyMd"
    assert create(admin_client, article(bodyMd="가" * 20_000))["bodyMd"] == "가" * 20_000
    too_many = article(tags=[f"태그{index}" for index in range(11)])
    assert error_of(admin_client.post(BASE, json=too_many), 422)["details"][0]["field"] == "tags"
    long_tag = article(tags=["가" * 21])
    assert error_of(admin_client.post(BASE, json=long_tag), 422)["code"] == "VALIDATION_ERROR"
    for field, value in (("title", "가" * 101), ("summary", "가" * 201), ("title", " ")):
        response = admin_client.post(BASE, json=article(**{field: value}))
        assert error_of(response, 422)["details"][0]["field"] == field
    bad_kind = admin_client.post(BASE, json=article(kind="news"))
    assert error_of(bad_kind, 422)["details"][0]["field"] == "kind"


def test_patch_publish_keeps_first_published_at(admin_client):
    body = create(admin_client, article(slug="draft"))
    path = f"{BASE}/{body['id']}"

    published = admin_client.patch(path, json={"published": True}).json()
    assert published["published"] is True and published["publishedAt"] is not None
    first_published_at = published["publishedAt"]

    hidden = admin_client.patch(path, json={"published": False}).json()
    assert (hidden["published"], hidden["publishedAt"]) == (False, first_published_at)
    again = admin_client.patch(path, json={"published": True}).json()
    assert again["publishedAt"] == first_published_at

    renamed = admin_client.patch(path, json={"title": "새 제목", "tags": ["기초"]}).json()
    assert (renamed["title"], renamed["tags"], renamed["slug"]) == ("새 제목", ["기초"], "draft")

    auto = admin_client.patch(path, json={"slug": None}).json()
    assert re.fullmatch(r"p-[0-9a-f]{8}", auto["slug"])

    error = error_of(admin_client.patch(path, json={"title": None}), 422)
    assert error["details"][0]["field"] == "title"


def test_patch_kind_change_validates_and_clears_fields(admin_client):
    body = create(
        admin_client, article(kind="video", slug="clip", videoUrl="https://youtu.be/dQw4w9WgXcQ")
    )
    path = f"{BASE}/{body['id']}"
    error = error_of(admin_client.patch(path, json={"kind": "glossary"}), 422)
    assert error["details"][0]["field"] == "term"
    unchanged = admin_client.get(path).json()
    assert (unchanged["kind"], unchanged["videoId"]) == ("video", "dQw4w9WgXcQ")

    changed = admin_client.patch(path, json={"kind": "glossary", "term": "클립"}).json()
    assert (changed["kind"], changed["term"], changed["videoUrl"], changed["videoId"]) == (
        "glossary",
        "클립",
        None,
        None,
    )
    error = error_of(
        admin_client.patch(path, json={"kind": "video", "videoUrl": "https://vimeo.com/1"}), 422
    )
    assert error["details"][0]["field"] == "videoUrl"


def test_admin_list_filters_include_unpublished(admin_client, db):
    make_post(db, "pub-article", title="공개 글")
    make_post(db, "draft-term", kind="glossary", term="초안", published=False, published_at=None)
    make_post(db, "pub-video", kind="video", title="영상")

    response = admin_client.get(BASE)
    assert response.status_code == 200
    body = response.json()
    assert (body["page"], body["pageSize"], body["total"]) == (1, 12, 3)
    assert set(body["items"][0]) == ADMIN_FIELDS

    def slugs(query: str) -> set[str]:
        result = admin_client.get(f"{BASE}?{query}")
        assert result.status_code == 200, result.text
        return {item["slug"] for item in result.json()["items"]}

    assert slugs("published=false") == {"draft-term"}
    assert slugs("published=true") == {"pub-article", "pub-video"}
    assert slugs("published=&kind=&q=") == {"pub-article", "draft-term", "pub-video"}
    assert slugs("kind=glossary") == {"draft-term"}
    assert slugs("q=공개") == {"pub-article"}
    assert slugs("q=pub-vid") == {"pub-video"}
    assert error_of(admin_client.get(f"{BASE}?published=maybe"), 422)["details"][0]["field"] == (
        "published"
    )


def test_get_and_delete(admin_client, auth_client, db):
    post = make_post(db, "bye")
    assert post_json(auth_client, f"/api/learn/posts/{post.id}/bookmark").status_code == 204

    assert send_delete(admin_client, f"{BASE}/{post.id}").status_code == 204
    assert error_of(admin_client.get(f"{BASE}/{post.id}"), 404)["code"] == "NOT_FOUND"
    assert send_delete(admin_client, f"{BASE}/{post.id}").status_code == 404
    assert admin_client.patch(f"{BASE}/{uuid4()}", json={"title": "x"}).status_code == 404
    # 북마크도 함께 지워진다(ON DELETE CASCADE).
    assert db.query(Bookmark).count() == 0


def draft_handler(request):
    return {
        "title": "  PBR(주가순자산비율)  ",
        "summary": "주가가 순자산의 몇 배인지 보는 지표",
        "term": "PBR",
        "body_md": "## 한마디로\nPBR은 ...\n\n## 숫자 예시\n...",
        "tags": ["지표", "지표", " 가치평가 ", "가" * 30, *[f"t{i}" for i in range(12)]],
    }


def test_ai_draft_uses_general_task_and_returns_draft(admin_client, fake_llm):
    fake_llm.register("learn.ai_draft", draft_handler)
    response = admin_client.post(
        "/api/learn/admin/ai-draft", json={"kind": "glossary", "topic": " PBR ", "level": "basic"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "title": "PBR(주가순자산비율)",
        "summary": "주가가 순자산의 몇 배인지 보는 지표",
        "term": "PBR",
        "bodyMd": "## 한마디로\nPBR은 ...\n\n## 숫자 예시\n...",
        "tags": ["지표", "가치평가", "가" * 20, "t0", "t1", "t2", "t3", "t4", "t5", "t6"],
    }
    assert len(fake_llm.calls) == 1
    call = fake_llm.calls[0]
    assert (call.task, call.data_class, call.output_name) == (
        "learn.ai_draft",
        "general",
        "DraftOutput",
    )
    assert call.system == service.AI_DRAFT_SYSTEM
    for rule in ("쉬운 한국어", "비유", "투자를 권하지 않는다", "기준 시점", "소제목을 2~4개"):
        assert rule in call.system
    assert call.content[0].text == "종류: 용어 설명\n난이도: 기초\n주제: PBR"
    # 초안은 저장하지 않는다.
    assert admin_client.get(BASE).json()["total"] == 0


def test_ai_draft_clears_term_for_articles_and_clips_lengths(admin_client, fake_llm):
    fake_llm.register(
        "learn.ai_draft",
        lambda request: {
            "title": "가" * 150,
            "summary": "나" * 300,
            "term": "있으면 안 됨",
            "body_md": "다" * 25_000,
            "tags": [],
        },
    )
    response = admin_client.post(
        "/api/learn/admin/ai-draft", json={"kind": "article", "topic": "ETF 고르기"}
    )
    body = response.json()
    assert (len(body["title"]), len(body["summary"]), len(body["bodyMd"])) == (100, 200, 20_000)
    assert body["term"] is None and body["tags"] == []
    assert fake_llm.calls[0].content[0].text == "종류: 글\n난이도: 입문\n주제: ETF 고르기"


def test_ai_draft_validation_and_disabled(admin_client, fake_llm):
    for body, field in (
        ({"kind": "glossary", "topic": ""}, "topic"),
        ({"kind": "glossary", "topic": "가" * 101}, "topic"),
        ({"kind": "news", "topic": "PBR"}, "kind"),
        ({"kind": "glossary", "topic": "PBR", "level": "expert"}, "level"),
    ):
        response = admin_client.post("/api/learn/admin/ai-draft", json=body)
        assert error_of(response, 422)["details"][0]["field"] == field
    fake_llm.set_enabled("learn.ai_draft", False)
    response = admin_client.post("/api/learn/admin/ai-draft", json={"kind": "video", "topic": "x"})
    assert error_of(response, 503)["code"] == "LLM_UNAVAILABLE"
    assert fake_llm.calls == []


def test_ai_draft_without_provider_is_503(admin_client):
    # 테스트 환경은 LLM_GENERAL_PROVIDER=disabled이므로 실제 공급자를 부르지 않고 503이다.
    response = admin_client.post(
        "/api/learn/admin/ai-draft", json={"kind": "glossary", "topic": "PBR"}
    )
    assert error_of(response, 503)["code"] == "LLM_UNAVAILABLE"


def test_published_at_serialized_as_utc(admin_client, db):
    make_post(db, "fixed", published_at=datetime(2026, 10, 16, 3, 21, 45, tzinfo=UTC))
    item = admin_client.get(BASE).json()["items"][0]
    assert item["publishedAt"] == "2026-10-16T03:21:45Z"
