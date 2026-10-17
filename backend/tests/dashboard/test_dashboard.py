"""홈 대시보드 `GET /api/dashboard/summary`(스펙 16)."""

from datetime import date

import pytest
from freezegun import freeze_time
from sqlalchemy import text

from app.core.errors import AppError
from app.integrations.brokers.mock import MockBroker
from app.integrations.llm import status as llm_status
from app.integrations.llm.status import AiStatus, ScopeStatus
from app.modules.allocation import service as allocation_service
from app.modules.journal import service as journal_service
from app.modules.ledger import service as ledger_service
from app.modules.market import service as market_service
from app.modules.watchlist import service as watchlist_service

URL = "/api/dashboard/summary"
NOW = "2026-10-16T03:00:00Z"  # KST 2026-10-16 12:00

SUMMARY_KEYS = {
    "greetingName",
    "allocation",
    "ledger",
    "journal",
    "watchlist",
    "estate",
    "learn",
    "chat",
    "checklist",
    "errors",
}
EMPTY_CHECKLIST = [
    {
        "key": "risk_assessment",
        "label": "투자성향 진단하기",
        "done": False,
        "href": "/allocation/survey",
    },
    {
        "key": "situation",
        "label": "목표·상황 입력하기",
        "done": False,
        "href": "/allocation/situation",
    },
    {"key": "holdings", "label": "보유 자산 입력하기", "done": False, "href": "/allocation/assets"},
    {"key": "ledger_entry", "label": "가계부 첫 기록 남기기", "done": False, "href": "/ledger"},
    {"key": "watchlist", "label": "관심종목 담기", "done": False, "href": "/stocks/watchlist"},
]
NEUTRAL_ANSWERS = {
    "horizon": 3,
    "experience": 4,
    "knowledge": 3,
    "income": 3,
    "investmentRatio": 3,
    "lossTolerance": 3,
}
WATCH_CODES = ["005930", "000660", "005380", "000270", "035420", "035720"]


@pytest.fixture(autouse=True)
def empty_posts(db):
    """개발용 학습 시드가 워크트리 DB에 있어도 빈 게시판에서 시작한다(트랜잭션째 롤백된다)."""
    db.execute(text("DELETE FROM posts"))
    db.flush()


@pytest.fixture
def seeded_market(db, monkeypatch):
    """08 종목 마스터·스냅샷을 Mock 고정 데이터로 채우고 시세도 Mock으로 받는다."""
    db.execute(text("DELETE FROM stock_snapshots"))
    db.execute(text("DELETE FROM stocks"))
    db.commit()
    broker = MockBroker()
    monkeypatch.setattr(market_service, "get_market_data_client", lambda: broker)
    market_service.refresh_stocks(db, broker)
    assert market_service.refresh_snapshot(db, broker, date(2026, 10, 16))["success"] == 90


def summary(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200, response.text
    data = response.json()
    assert set(data) == SUMMARY_KEYS
    return data


def checklist_done(data: dict) -> dict[str, bool]:
    return {item["key"]: item["done"] for item in data["checklist"]}


def ok(response, status: int = 201) -> dict:
    assert response.status_code == status, response.text
    return response.json() if response.content else {}


def assess(client) -> None:
    ok(
        client.post(
            "/api/allocation/risk-assessments",
            json={"surveyVersion": 1, "answers": NEUTRAL_ANSWERS},
        )
    )


def add_holding(client, asset_class: str, amount: int, include: bool = True) -> None:
    ok(
        client.post(
            "/api/allocation/holdings",
            json={
                "name": f"{asset_class} 자산",
                "assetClass": asset_class,
                "amount": amount,
                "includeInAllocation": include,
                "memo": None,
            },
        )
    )


def put_situation(client, monthly_expense: int = 2_000_000) -> None:
    ok(
        client.put(
            "/api/allocation/situation",
            json={"monthlyExpense": monthly_expense, "dependents": 0, "consumerDebt": 0},
        ),
        200,
    )


def add_goal(client) -> None:
    ok(
        client.post(
            "/api/allocation/goals",
            json={
                "goalType": "home",
                "title": "내 집 마련",
                "targetAmount": 20_000_000,
                "targetDate": "2028-10-01",
            },
        )
    )


def ledger_categories(client) -> dict[tuple[str, str], str]:
    items = ok(client.get("/api/ledger/categories"), 200)["items"]
    return {(item["kind"], item["name"]): item["id"] for item in items}


def add_entry(client, categories, kind: str, name: str, amount: int, day: str) -> None:
    ok(
        client.post(
            "/api/ledger/entries",
            json={
                "kind": kind,
                "occurredOn": day,
                "amount": amount,
                "categoryId": categories[(kind, name)],
            },
        )
    )


def add_trade(client, code: str, name: str, side: str, quantity: str, price: str, day: str):
    ok(
        client.post(
            "/api/journal/trades",
            json={
                "tradedOn": day,
                "market": "KRX",
                "symbolCode": code,
                "symbolName": name,
                "side": side,
                "quantity": quantity,
                "price": price,
                "currency": "KRW",
                "fee": "0",
                "tax": "0",
            },
        )
    )


def add_member(client, relation: str, name: str, birth_date: str) -> dict:
    return ok(
        client.post(
            "/api/estate/members",
            json={"relation": relation, "displayName": name, "birthDate": birth_date},
        )
    )


def add_glossary(admin_client, slug: str, term: str) -> dict:
    return ok(
        admin_client.post(
            "/api/learn/admin/posts",
            json={
                "kind": "glossary",
                "slug": slug,
                "title": term,
                "summary": f"{term} 한 줄 정의",
                "bodyMd": "본문",
                "term": term,
                "published": True,
            },
        )
    )


def ai_status(enabled: bool, location: str | None) -> AiStatus:
    off = ScopeStatus(enabled=False, provider=None, location=None, model=None, reason=None)
    personal = ScopeStatus(
        enabled=enabled,
        provider="ollama" if location == "local" else "gemini" if location else None,
        location=location,
        model="test-model" if location else None,
        reason=None if enabled else "not_configured",
    )
    return AiStatus(general=off, personal=personal)


# ── 새 사용자 ────────────────────────────────────────────────────────────


def test_requires_login(client):
    response = client.get(URL)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


@freeze_time(NOW)
def test_new_user_sees_empty_sections_and_open_checklist(auth_client):
    data = summary(auth_client)
    assert data == {
        "greetingName": "first",
        "allocation": {
            "status": "needs_assessment",
            "score": None,
            "grade": None,
            "scoreDelta": None,
            "classes": None,
            "topDirection": None,
        },
        "ledger": {
            "month": "2026-10",
            "incomeTotal": 0,
            "expenseTotal": 0,
            "expenseChangeRate": None,
            "topCategories": [],
        },
        "journal": {"monthRealizedPnl": [], "winRate": None, "openPositionCount": 0},
        "watchlist": {"items": [], "source": None},
        "estate": {"members": []},
        "learn": {"today": None, "readCount": 0, "publishedCount": 0},
        "chat": {"enabled": False, "location": None},
        "checklist": EMPTY_CHECKLIST,
        "errors": [],
    }


@freeze_time(NOW)
def test_greeting_uses_nickname(auth_client):
    ok(auth_client.put("/api/profile", json={"birthYear": 1994, "nickname": "감자"}), 200)
    assert summary(auth_client)["greetingName"] == "감자"


# ── 상황·목표 입력 뒤 ────────────────────────────────────────────────────


def first_direction(client) -> dict:
    directions = ok(client.get("/api/allocation/recommendation"), 200)["directions"]
    top = sorted(directions, key=lambda item: item["priority"])[0]
    return {key: top[key] for key in ("kind", "title", "body", "href")}


@freeze_time(NOW)
def test_assessment_sets_top_direction_and_situation_completes(auth_client):
    assess(auth_client)
    data = summary(auth_client)
    assert data["allocation"]["status"] == "needs_holdings"
    assert data["allocation"]["classes"] is None
    assert data["allocation"]["topDirection"] == first_direction(auth_client)
    assert checklist_done(data) == {
        "risk_assessment": True,
        "situation": False,
        "holdings": False,
        "ledger_entry": False,
        "watchlist": False,
    }

    put_situation(auth_client)
    data = summary(auth_client)
    assert checklist_done(data)["situation"] is True
    assert data["allocation"]["topDirection"] == first_direction(auth_client)


@freeze_time(NOW)
def test_goal_alone_completes_situation(auth_client):
    add_goal(auth_client)
    data = summary(auth_client)
    assert checklist_done(data)["situation"] is True
    # 진단 전이면 먼저 할 일이 없다.
    assert data["allocation"]["topDirection"] is None


@freeze_time(NOW)
def test_excluded_holding_and_old_ledger_entry_complete_checklist(auth_client):
    add_holding(auth_client, "other", 300_000_000, include=False)
    categories = ledger_categories(auth_client)
    # 이번 달을 포함한 최근 12개월 안이면 완료다.
    add_entry(auth_client, categories, "expense", "식비", 10_000, "2025-11-03")
    done = checklist_done(summary(auth_client))
    assert done["holdings"] is True and done["ledger_entry"] is True


# ── 데이터가 있는 사용자 ────────────────────────────────────────────────


def populate(client, admin_client) -> None:
    ok(client.put("/api/profile", json={"birthYear": 1994, "nickname": "감자"}), 200)
    assess(client)
    add_holding(client, "stock", 30_000_000)
    add_holding(client, "bond", 10_000_000)
    add_holding(client, "cash", 10_000_000)
    add_holding(client, "other", 100_000_000, include=False)
    put_situation(client)
    add_goal(client)

    categories = ledger_categories(client)
    add_entry(client, categories, "income", "급여", 3_500_000, "2026-10-01")
    add_entry(client, categories, "expense", "식비", 520_000, "2026-10-02")
    add_entry(client, categories, "expense", "쇼핑", 300_000, "2026-10-03")
    add_entry(client, categories, "expense", "교통", 100_000, "2026-10-04")
    add_entry(client, categories, "expense", "통신", 50_000, "2026-10-05")
    add_entry(client, categories, "expense", "식비", 1_000_000, "2026-09-10")

    add_trade(client, "005930", "삼성전자", "buy", "10", "70000", "2026-10-01")
    add_trade(client, "005930", "삼성전자", "sell", "5", "80000", "2026-10-10")
    add_trade(client, "000660", "SK하이닉스", "buy", "10", "100000", "2026-09-01")
    add_trade(client, "000660", "SK하이닉스", "sell", "10", "90000", "2026-10-12")
    # 지난달 매도는 이번 달 성과에 들어가지 않는다.
    add_trade(client, "035720", "카카오", "buy", "10", "50000", "2026-09-01")
    add_trade(client, "035720", "카카오", "sell", "10", "60000", "2026-09-15")

    for code in WATCH_CODES:
        ok(client.post("/api/watchlist", json={"code": code}))

    child = add_member(client, "child", "첫째", "2010-03-01")
    ok(
        client.post(
            "/api/estate/gifts",
            json={
                "recipientId": child["id"],
                "giftedOn": "2024-02-01",
                "donorGroup": "parents",
                "amount": 20_000_000,
            },
        )
    )
    add_member(client, "spouse", "배우자", "1994-05-05")
    add_member(client, "child", "둘째", "1996-07-15")
    add_member(client, "grandchild", "손주", "2020-01-01")
    add_member(client, "child", "셋째", "2015-01-01")

    add_glossary(admin_client, "per", "PER")
    read = add_glossary(admin_client, "pbr", "PBR")
    ok(
        client.post(
            f"/api/learn/posts/{read['id']}/read", headers={"Content-Type": "application/json"}
        ),
        204,
    )


@freeze_time(NOW)
def test_populated_user_sections(auth_client, admin_client, seeded_market, monkeypatch):
    monkeypatch.setattr(llm_status, "get_ai_status", lambda: ai_status(True, "local"))
    populate(auth_client, admin_client)

    data = summary(auth_client)
    assert data["errors"] == []
    assert data["greetingName"] == "감자"

    allocation = data["allocation"]
    report = ok(auth_client.get("/api/allocation/report"), 200)
    assert allocation["status"] == "ready"
    assert (allocation["score"], allocation["grade"]) == (report["score"], report["grade"])
    assert allocation["scoreDelta"] is None  # 어제 점수가 없다
    assert allocation["classes"] == [
        {key: item[key] for key in ("assetClass", "actualWeight", "targetWeight")}
        for item in report["classes"]
    ]
    assert [item["assetClass"] for item in allocation["classes"]] == [
        "stock",
        "bond",
        "gold",
        "cash",
        "other",
    ]
    assert allocation["topDirection"] == first_direction(auth_client)

    assert data["ledger"] == {
        "month": "2026-10",
        "incomeTotal": 3_500_000,
        "expenseTotal": 970_000,
        "expenseChangeRate": -3.0,
        "topCategories": [
            {"name": "식비", "amount": 520_000, "ratio": 53.61},
            {"name": "쇼핑", "amount": 300_000, "ratio": 30.93},
            {"name": "교통", "amount": 100_000, "ratio": 10.31},
        ],
    }

    stats = ok(
        auth_client.get("/api/journal/stats", params={"from": "2026-10-01", "to": "2026-10-16"}),
        200,
    )
    assert data["journal"] == {
        "monthRealizedPnl": [
            {"currency": item["currency"], "realizedPnl": item["realizedPnl"]}
            for item in stats["byCurrency"]
        ],
        "winRate": 50.0,
        "openPositionCount": 1,
    }
    # 이번 달 매도만: 삼성전자 +50,000, SK하이닉스 -100,000(9월 카카오 +100,000은 빠진다)
    assert data["journal"]["monthRealizedPnl"] == [{"currency": "KRW", "realizedPnl": "-50000"}]

    listed = ok(auth_client.get("/api/watchlist"), 200)["items"]
    assert data["watchlist"]["source"] == "mock"
    assert data["watchlist"]["items"] == [
        {
            "code": item["code"],
            "name": item["name"],
            "price": item["quote"]["price"],
            "changeRate": item["quote"]["changeRate"],
        }
        for item in listed[:5]
    ]
    samsung = next(item for item in data["watchlist"]["items"] if item["code"] == "005930")
    assert samsung == {"code": "005930", "name": "삼성전자", "price": "102800", "changeRate": -1.21}

    members = ok(auth_client.get("/api/estate/members"), 200)["items"]
    expected = [item for item in members if item["relation"] in {"child", "grandchild"}][:3]
    assert [item["memberId"] for item in data["estate"]["members"]] == [
        item["id"] for item in expected
    ]
    by_name = {item["displayName"]: item for item in data["estate"]["members"]}
    assert "배우자" not in by_name
    if "첫째" in by_name:
        # 미성년 자녀 공제 2천만원을 2024-02-01에 모두 썼다. 10년 뒤 다음 날 회복한다.
        assert by_name["첫째"]["available"] == 0
        assert by_name["첫째"]["nextResetOn"] == "2034-02-02"
    if "둘째" in by_name:
        assert by_name["둘째"]["available"] == 50_000_000
        assert by_name["둘째"]["nextResetOn"] is None

    today = ok(auth_client.get("/api/learn/today"), 200)["post"]
    # 홈은 공개 함수 get_term_of_the_day를 쓰므로 사용자별 읽음·북마크 표시는 기본값이다.
    personal = {"read", "bookmarked"}
    assert {k: v for k, v in data["learn"]["today"].items() if k not in personal} == {
        k: v for k, v in today.items() if k not in personal
    }
    assert data["learn"]["today"]["kind"] == "glossary"
    assert (data["learn"]["readCount"], data["learn"]["publishedCount"]) == (1, 2)

    assert data["chat"] == {"enabled": True, "location": "local"}
    assert all(checklist_done(data).values())


def test_estate_member_values(auth_client):
    with freeze_time(NOW):
        child = add_member(auth_client, "child", "첫째", "2010-03-01")
        ok(
            auth_client.post(
                "/api/estate/gifts",
                json={
                    "recipientId": child["id"],
                    "giftedOn": "2024-02-01",
                    "donorGroup": "parents",
                    "amount": 20_000_000,
                },
            )
        )
        add_member(auth_client, "spouse", "배우자", "1994-05-05")
        data = summary(auth_client)
    assert data["estate"] == {
        "members": [
            {
                "memberId": child["id"],
                "displayName": "첫째",
                "available": 0,
                "nextResetOn": "2034-02-02",
            }
        ]
    }


def test_score_snapshot_is_committed_and_delta_follows(auth_client, db):
    with freeze_time("2026-10-15T03:00:00Z"):
        assess(auth_client)
        add_holding(auth_client, "stock", 50_000_000)  # 보유 자산 저장이 10-15 스냅샷을 남긴다
        first = summary(auth_client)["allocation"]
        assert first["status"] == "ready" and first["scoreDelta"] is None
    with freeze_time(NOW):
        # 10-16에는 홈만 연다. 홈이 오늘 스냅샷을 upsert하고 커밋한다.
        second = summary(auth_client)["allocation"]
        db.rollback()  # 커밋되지 않은 변경이었다면 여기서 사라진다
        scores = ok(auth_client.get("/api/allocation/scores", params={"days": 30}), 200)["items"]
    assert [item["scoredOn"] for item in scores] == ["2026-10-15", "2026-10-16"]
    assert second["scoreDelta"] == second["score"] - first["score"] == 0


# ── 섹션 실패 격리 ───────────────────────────────────────────────────────


@freeze_time(NOW)
def test_failing_section_is_null_and_reported(auth_client, monkeypatch):
    def unavailable(*args, **kwargs):
        raise AppError(502, "BROKER_UNAVAILABLE", "증권사 정보를 받지 못했습니다.")

    def broken(*args, **kwargs):
        raise RuntimeError("예상하지 못한 오류")

    monkeypatch.setattr(watchlist_service, "list_items", unavailable)
    monkeypatch.setattr(ledger_service, "get_monthly_summary", broken)
    data = summary(auth_client)

    assert data["watchlist"] is None and data["ledger"] is None
    assert data["errors"] == [
        {"section": "ledger", "code": "INTERNAL_ERROR"},
        {"section": "watchlist", "code": "BROKER_UNAVAILABLE"},
        {"section": "checklist", "code": "BROKER_UNAVAILABLE"},
    ]
    # 나머지 카드는 그대로 보인다.
    assert data["allocation"]["status"] == "needs_assessment"
    assert data["journal"] == {"monthRealizedPnl": [], "winRate": None, "openPositionCount": 0}
    assert data["estate"] == {"members": []}
    assert data["learn"]["readCount"] == 0
    assert checklist_done(data)["watchlist"] is False


@freeze_time(NOW)
def test_database_error_rolls_back_only_that_section(auth_client, db, monkeypatch):
    assess(auth_client)
    add_holding(auth_client, "stock", 50_000_000)

    def bad_sql(db_session, *args, **kwargs):
        db_session.execute(text("SELECT 1 / 0"))

    monkeypatch.setattr(journal_service, "get_trade_stats", bad_sql)
    data = summary(auth_client)

    assert data["journal"] is None
    assert data["errors"] == [{"section": "journal", "code": "INTERNAL_ERROR"}]
    # DB 오류 뒤의 섹션도 정상이고, 앞 섹션의 점수 스냅샷은 커밋된다.
    assert data["allocation"]["status"] == "ready"
    assert data["watchlist"] == {"items": [], "source": None}
    assert data["learn"] == {"today": None, "readCount": 0, "publishedCount": 0}
    assert checklist_done(data)["holdings"] is True
    db.rollback()
    scores = ok(auth_client.get("/api/allocation/scores", params={"days": 30}), 200)["items"]
    assert [item["scoredOn"] for item in scores] == ["2026-10-16"]


@freeze_time(NOW)
def test_failing_checklist_check_marks_item_open(auth_client, monkeypatch):
    assess(auth_client)

    def broken(*args, **kwargs):
        raise AppError(404, "NOT_FOUND", "없음")

    monkeypatch.setattr(allocation_service, "get_latest_risk_profile", broken)
    data = summary(auth_client)
    assert checklist_done(data)["risk_assessment"] is False
    assert data["errors"] == [{"section": "checklist", "code": "NOT_FOUND"}]
    # 체크리스트 판정 실패는 배분 카드에 영향이 없다.
    assert data["allocation"]["status"] == "needs_holdings"


@freeze_time(NOW)
def test_chat_status(auth_client, monkeypatch):
    monkeypatch.setattr(llm_status, "get_ai_status", lambda: ai_status(True, "cloud"))
    assert summary(auth_client)["chat"] == {"enabled": True, "location": "cloud"}

    def broken():
        raise RuntimeError("설정 오류")

    monkeypatch.setattr(llm_status, "get_ai_status", broken)
    data = summary(auth_client)
    assert data["chat"] == {"enabled": False, "location": None}
    assert data["errors"] == [{"section": "chat", "code": "INTERNAL_ERROR"}]


# ── 사용자 격리 ─────────────────────────────────────────────────────────


@freeze_time(NOW)
def test_other_user_data_is_not_mixed(auth_client, other_auth_client, admin_client, seeded_market):
    populate(auth_client, admin_client)
    mine = summary(auth_client)
    assert all(checklist_done(mine).values())

    other = summary(other_auth_client)
    assert other["greetingName"] == "second"
    assert other["allocation"]["status"] == "needs_assessment"
    assert other["allocation"]["topDirection"] is None
    assert other["ledger"]["incomeTotal"] == 0 and other["ledger"]["topCategories"] == []
    assert other["journal"] == {"monthRealizedPnl": [], "winRate": None, "openPositionCount": 0}
    assert other["watchlist"] == {"items": [], "source": None}
    assert other["estate"] == {"members": []}
    # 학습 글은 공용이고 읽음 기록만 사용자별이다.
    assert other["learn"]["readCount"] == 0 and other["learn"]["publishedCount"] == 2
    assert other["checklist"] == EMPTY_CHECKLIST
    assert other["errors"] == []

    # 다른 사용자의 조회가 내 결과를 바꾸지 않는다.
    assert summary(auth_client) == mine
