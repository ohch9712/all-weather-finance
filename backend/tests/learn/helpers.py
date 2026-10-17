from datetime import UTC, datetime

from app.modules.learn.models import Post

JSON_HEADERS = {"Content-Type": "application/json"}


def make_post(db, slug: str, **fields) -> Post:
    """테스트용 게시물을 바로 저장한다. 기본은 공개된 글이다."""
    kind = fields.pop("kind", "article")
    values = {
        "kind": kind,
        "slug": slug,
        "title": fields.pop("title", f"{slug} 제목"),
        "summary": fields.pop("summary", f"{slug} 요약"),
        "body_md": fields.pop("body_md", "본문"),
        "level": fields.pop("level", "beginner"),
        "tags": fields.pop("tags", []),
        "published": fields.pop("published", True),
        "published_at": fields.pop("published_at", datetime(2026, 10, 1, tzinfo=UTC)),
    }
    if kind == "glossary":
        values["term"] = fields.pop("term", slug.upper())
    if kind == "video":
        values["video_url"] = fields.pop("video_url", "https://youtu.be/dQw4w9WgXcQ")
        values["video_id"] = fields.pop("video_id", "dQw4w9WgXcQ")
    post = Post(**values, **fields)
    db.add(post)
    db.commit()
    return post


def post_json(client, path: str, body: dict | None = None):
    """상태를 바꾸는 요청은 본문이 없어도 JSON 형식이어야 한다(require_json)."""
    if body is None:
        return client.post(path, headers=JSON_HEADERS)
    return client.post(path, json=body)


def send_delete(client, path: str):
    return client.delete(path, headers=JSON_HEADERS)


def error_of(response, status: int) -> dict:
    assert response.status_code == status, response.text
    return response.json()["error"]


def slugs_of(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [item["slug"] for item in response.json()["items"]]
