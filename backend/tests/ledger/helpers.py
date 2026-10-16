JSON_HEADERS = {"Content-Type": "application/json"}


def send_delete(client, path: str):
    """상태를 바꾸는 요청은 본문이 없어도 JSON 형식이어야 한다(require_json)."""
    return client.delete(path, headers=JSON_HEADERS)


def category_ids(client) -> dict[tuple[str, str], str]:
    """{(kind, name): id} — 기본 카테고리와 내 카테고리"""
    response = client.get("/api/ledger/categories")
    assert response.status_code == 200, response.text
    return {(item["kind"], item["name"]): item["id"] for item in response.json()["items"]}


def add_entry(client, category: str | None = None, **fields) -> dict:
    """내역을 만들고 응답 본문을 돌려준다. category는 카테고리 이름(종류는 fields의 kind)."""
    kind = fields.get("kind", "expense")
    if category is None:
        category = "식비" if kind == "expense" else "급여"
    body = {
        "kind": kind,
        "occurredOn": "2026-10-15",
        "amount": 12000,
        "categoryId": category_ids(client)[(kind, category)],
        **fields,
    }
    response = client.post("/api/ledger/entries", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def error_of(response, status: int) -> dict:
    assert response.status_code == status, response.text
    return response.json()["error"]
