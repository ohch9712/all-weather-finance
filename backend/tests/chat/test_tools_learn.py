"""학습 콘텐츠 도구(스펙 15 4절·5절): search_learning."""

from app.modules.learn import service as learn_service
from tests.chat.tool_helpers import Spy, run, tool_ctx


def publish(admin_client, slug: str, title: str, summary: str, **fields) -> None:
    response = admin_client.post(
        "/api/learn/admin/posts",
        json={
            "kind": "glossary",
            "slug": slug,
            "title": title,
            "summary": summary,
            "bodyMd": "본문",
            "term": title,
            "published": True,
            **fields,
        },
    )
    assert response.status_code == 201, response.text


def test_search_learning_links(admin_client, auth_client, db, monkeypatch):
    publish(admin_client, "per-zz15", "PER 주가수익비율 zz15", "주가를 주당순이익으로 나눈 값")
    spy = Spy(monkeypatch, learn_service, "search_posts")
    result = run(tool_ctx(db), "search_learning", {"query": "zz15"})
    # 사용자 없이 부른다(북마크·읽음 표시 없음).
    assert spy.calls == [((db, "zz15"), {"limit": 5})]
    post = result.content["posts"][0]
    assert post["title"] == "PER 주가수익비율 zz15"
    assert post["href"] == "/learn/per-zz15"
    assert "bookmarked" not in post and "read" not in post
    card = result.card
    assert card == {
        "type": "link_list",
        "title": "'zz15' 학습 자료",
        "links": [
            {
                "title": "PER 주가수익비율 zz15",
                "description": "주가를 주당순이익으로 나눈 값",
                "href": "/learn/per-zz15",
            }
        ],
    }


def test_search_learning_hides_unpublished_and_empty(admin_client, auth_client, db):
    publish(admin_client, "draft-zz15", "초안 zz15", "공개 전", published=False)
    result = run(tool_ctx(db), "search_learning", {"query": "zz15"})
    assert result.content["status"] == "no_results"
    assert result.card is None


def test_search_learning_input_validation(auth_client, db):
    for arguments in ({}, {"query": ""}, {"query": "PER", "kind": "glossary"}):
        result = run(tool_ctx(db), "search_learning", arguments)
        assert result.is_error and "INVALID_INPUT" in result.content
