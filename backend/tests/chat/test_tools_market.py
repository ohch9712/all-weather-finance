"""종목·조건검색·관심종목 도구(스펙 15 4절·4.1·5절)."""

import base64
import json

from app.modules.chat.tools import screener as screener_tool
from app.modules.market import service as market_service
from app.modules.screener import service as screener_service
from app.modules.screener.schemas import ScreenFilter
from app.modules.watchlist import service as watchlist_service
from tests.chat.tool_helpers import Spy, run, tool_ctx

STOCK_LIST_KEYS = {"type", "title", "asOf", "source", "items", "href"}
STOCK_ITEM_KEYS = {"code", "name", "price", "changeRate", "extra"}


def decode(encoded: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))


# ── search_stocks ───────────────────────────────────────────────────


def test_search_stocks_master_card(auth_client, db, market, monkeypatch):
    spy = Spy(monkeypatch, market_service, "search_stocks")
    ctx = tool_ctx(db)
    result = run(ctx, "search_stocks", {"query": " 삼성 "})
    assert spy.calls == [((db, "삼성"), {"limit": 10})]
    items = result.content["items"]
    assert {
        "code": "005930",
        "name": "삼성전자",
        "market": "KOSPI",
        "kind": "stock",
    }.items() <= next(item for item in items if item["code"] == "005930").items()
    assert [item["code"] for item in items] == [
        item.code for item in market_service.search_stocks(db, "삼성", limit=10)
    ]
    card = result.card
    assert set(card) == STOCK_LIST_KEYS
    assert card["type"] == "stock_list" and card["source"] == "master"
    assert card["asOf"] is None and card["href"] is None
    first = card["items"][0]
    assert set(first) == STOCK_ITEM_KEYS
    assert (first["price"], first["changeRate"]) == (None, None)
    assert first["extra"] == "코스피"


def test_search_stocks_etf_extra_and_empty(auth_client, db, market):
    result = run(tool_ctx(db), "search_stocks", {"query": "KODEX 200"})
    assert result.card["items"][0]["extra"] == "코스피 · ETF"
    empty = run(tool_ctx(db), "search_stocks", {"query": "없는종목이름"})
    assert empty.content["items"] == [] and empty.card is None


def test_search_stocks_input_validation(auth_client, db, market):
    for arguments in ({}, {"query": "  "}, {"query": "삼성", "limit": 5}):
        result = run(tool_ctx(db), "search_stocks", arguments)
        assert result.is_error and "INVALID_INPUT" in result.content


# ── get_stock_detail ────────────────────────────────────────────────


def test_stock_detail_card(auth_client, db, market, monkeypatch):
    spy = Spy(monkeypatch, market_service, "get_stock_detail")
    result = run(tool_ctx(db), "get_stock_detail", {"code": "005930"})
    assert spy.calls == [((db, "005930"), {})]
    detail = market_service.get_stock_detail(db, "005930")
    content = result.content
    assert content["quote"]["price"] == 102_800
    assert content["snapshot"]["per"] == float(detail.snapshot.per)
    assert content["summary"] == "삼성전자(005930)의 현재가는 102,800원(-1.21%)입니다."
    card = result.card
    assert set(card) == {"type", "code", "name", "price", "changeRate", "metrics", "source", "href"}
    assert card["type"] == "stock" and card["source"] == "mock"
    assert (card["price"], card["changeRate"]) == ("102,800원", "-1.21%")
    assert card["href"] == "/stocks/005930"
    labels = [metric["label"] for metric in card["metrics"]]
    assert labels[:3] == ["PER", "PBR", "ROE"]
    per = next(metric["value"] for metric in card["metrics"] if metric["label"] == "PER")
    assert per == f"{detail.snapshot.per:.2f}배"
    assert all(isinstance(metric["value"], str) for metric in card["metrics"])


def test_stock_detail_not_found_is_status(auth_client, db, market):
    result = run(tool_ctx(db), "get_stock_detail", {"code": "999999"})
    assert not result.is_error
    assert result.content["status"] == "not_found"
    assert result.card is None


# ── screen_stocks ───────────────────────────────────────────────────

FILTER = {
    "markets": ["KOSPI"],
    "kinds": None,
    "sectors": None,
    "conditions": [
        {"field": "per", "op": "gt", "value": "0", "valueTo": None},
        {"field": "per", "op": "lte", "value": 15, "valueTo": None},
    ],
    "sort": None,
    "limit": 30,
}


def test_screen_stocks_runs_filter_and_links(auth_client, db, market, monkeypatch):
    spy = Spy(monkeypatch, screener_service, "run_screen")
    ctx = tool_ctx(db)
    result = run(ctx, "screen_stocks", {"filter": FILTER})
    (args, kwargs) = spy.calls[0]
    assert args[0] is db and kwargs == {}
    assert args[1] == ScreenFilter.model_validate(FILTER)
    screen = screener_service.run_screen(db, ScreenFilter.model_validate(FILTER))
    assert screen.total > 0

    content = result.content
    assert content["total"] == screen.total
    assert content["asOf"] == "2026-10-16" and content["source"] == "mock"
    assert content["shownCount"] == min(10, len(screen.items))
    assert [item["code"] for item in content["items"]] == [item.code for item in screen.items][:10]

    card = result.card
    assert set(card) == STOCK_LIST_KEYS
    assert card["title"] == f"조건검색 결과 {screen.total}개"
    assert card["asOf"] == "2026.10.16" and card["source"] == "mock"
    assert card["href"].startswith("/stocks/screener?f=")
    encoded = card["href"].removeprefix("/stocks/screener?f=")
    assert encoded == screener_service.encode_filter(ScreenFilter.model_validate(FILTER))
    assert decode(encoded)["markets"] == ["KOSPI"]
    first = card["items"][0]
    assert set(first) == STOCK_ITEM_KEYS
    assert first["price"].endswith("원") and first["changeRate"].endswith("%")
    assert first["extra"].startswith("코스피 · PER ")


def test_screen_stocks_without_snapshot_is_status(auth_client, db, empty_market):
    result = run(tool_ctx(db), "screen_stocks", {"filter": FILTER})
    assert not result.is_error
    assert result.content["status"] == "no_snapshot"
    assert result.card is None


def test_screen_stocks_filter_is_validated(auth_client, db, market):
    bad = {**FILTER, "conditions": [{"field": "dividend", "op": "gt", "value": 1, "valueTo": None}]}
    for arguments in ({"filter": bad}, {"filter": {**FILTER, "extra": 1}}, {}):
        result = run(tool_ctx(db), "screen_stocks", arguments)
        assert result.is_error and "INVALID_INPUT" in result.content


def test_screen_description_includes_filter_guide():
    from app.modules.chat.tools.registry import find_tool

    description = find_tool("screen_stocks").description
    assert screener_service.get_filter_guide() in description
    assert screener_tool.DESCRIPTION == description


# ── get_watchlist / add_to_watchlist ────────────────────────────────


def watch_count(client) -> int:
    return len(client.get("/api/watchlist").json()["items"])


def test_add_to_watchlist_writes_and_links(auth_client, db, market, monkeypatch):
    spy = Spy(monkeypatch, watchlist_service, "add_item")
    ctx = tool_ctx(db)
    result = run(ctx, "add_to_watchlist", {"code": "005930"})
    assert spy.calls == [((db, ctx.user.id, "005930"), {})]
    assert result.content["summary"] == "삼성전자(005930) 종목을 관심종목 '기본' 그룹에 담았습니다."
    assert result.card == {
        "type": "link",
        "title": "관심종목에 담았어요: 삼성전자",
        "description": "'기본' 그룹 · 관심종목 화면에서 확인하세요.",
        "href": "/stocks/watchlist",
    }
    assert watch_count(auth_client) == 1
    assert [item["code"] for item in auth_client.get("/api/watchlist").json()["items"]] == [
        "005930"
    ]


def test_add_to_watchlist_conflict_and_not_found_are_status(auth_client, db, market):
    ctx = tool_ctx(db)
    run(ctx, "add_to_watchlist", {"code": "005930"})
    again = run(ctx, "add_to_watchlist", {"code": "005930"})
    assert not again.is_error
    assert again.content == {"status": "conflict", "message": "이미 관심종목에 있습니다."}
    missing = run(ctx, "add_to_watchlist", {"code": "999999"})
    assert missing.content == {"status": "not_found", "message": "종목을 찾을 수 없습니다."}
    assert again.card is None and missing.card is None
    assert watch_count(auth_client) == 1
    # 실패 경로의 커밋·롤백 뒤에도 세션을 계속 쓸 수 있다.
    assert run(ctx, "add_to_watchlist", {"code": "000660"}).content["code"] == "000660"
    assert watch_count(auth_client) == 2


def test_get_watchlist_card(auth_client, other_auth_client, db, market, monkeypatch):
    run(tool_ctx(db), "add_to_watchlist", {"code": "005930"})
    run(tool_ctx(db, "second@example.com"), "add_to_watchlist", {"code": "000660"})
    spy = Spy(monkeypatch, watchlist_service, "list_items")
    ctx = tool_ctx(db)
    result = run(ctx, "get_watchlist")
    assert spy.calls == [((db, ctx.user.id), {})]
    assert [item["code"] for item in result.content["items"]] == ["005930"]
    assert result.content["items"][0]["quote"]["price"] == 102_800
    card = result.card
    assert set(card) == STOCK_LIST_KEYS
    assert card["source"] == "mock" and card["href"] == "/stocks/watchlist"
    assert card["items"] == [
        {
            "code": "005930",
            "name": "삼성전자",
            "price": "102,800원",
            "changeRate": "-1.21%",
            "extra": "기본",
        }
    ]


def test_get_watchlist_empty_is_status(auth_client, db, market):
    result = run(tool_ctx(db), "get_watchlist")
    assert result.content["status"] == "empty"
    assert result.card is None
