"""자산배분 도구(스펙 15 4절·4.1·5절).

get_allocation_report, get_recommendation, get_risk_profile
"""

from app.core.domain import ASSET_CLASS_LABEL
from app.modules.allocation import service as allocation_service
from tests.chat.tool_helpers import Spy, add_holding, assess, run, tool_ctx

ASSET_ORDER = ["stock", "bond", "gold", "cash", "other"]


def ready_user(client):
    assess(client)
    add_holding(client, "stock", 6_000_000)
    add_holding(client, "bond", 3_000_000)
    add_holding(client, "cash", 1_000_000)


# ── get_allocation_report ────────────────────────────────────────────


def test_report_ready_content_and_card(auth_client, db, monkeypatch):
    ready_user(auth_client)
    spy = Spy(monkeypatch, allocation_service, "get_allocation_report")
    ctx = tool_ctx(db)
    result = run(ctx, "get_allocation_report")
    assert not result.is_error
    assert spy.calls == [((db, ctx.user.id), {})]

    report = allocation_service.get_allocation_report(db, ctx.user.id)
    content = result.content
    assert content["status"] == "ready"
    assert content["score"] == report.score and content["grade"] == report.grade
    assert content["summary"] == f"배분 일치 점수는 {report.score}점({report.grade}등급)입니다."
    assert content["totalAmount"] == 10_000_000
    assert content["ageBandLabel"] == "30대"
    # 숫자는 형식화하지 않는다(원 정수, 비중 숫자).
    first = content["classes"][0]
    assert first["assetClass"] == "stock" and first["label"] == "주식"
    assert first["actualAmount"] == 6_000_000
    assert isinstance(first["actualWeight"], float | int)

    card = result.card
    assert set(card) == {"type", "status", "score", "grade", "classes", "href"}
    assert card["type"] == "allocation" and card["href"] == "/allocation"
    assert (card["status"], card["score"], card["grade"]) == ("ready", report.score, report.grade)
    assert [item["assetClass"] for item in card["classes"]] == ASSET_ORDER
    for item, source in zip(card["classes"], report.classes, strict=True):
        assert set(item) == {"assetClass", "label", "actualWeight", "targetWeight"}
        assert item["label"] == ASSET_CLASS_LABEL[source.asset_class]
        assert item["actualWeight"] == source.actual_weight
        assert item["targetWeight"] == source.target_weight


def test_report_status_without_assessment_and_holdings(auth_client, db):
    result = run(tool_ctx(db), "get_allocation_report")
    assert result.content["status"] == "needs_assessment"
    assert "투자성향 진단" in result.content["summary"]
    assert result.card["status"] == "needs_assessment"
    assert result.card["classes"] == [] and result.card["score"] is None

    assess(auth_client)
    result = run(tool_ctx(db), "get_allocation_report")
    assert result.content["status"] == "needs_holdings"
    assert "보유 자산" in result.content["summary"]
    assert result.card["classes"] == []


def test_report_status_without_birth_year(bare_client, db):
    result = run(tool_ctx(db, "third@example.com"), "get_allocation_report")
    assert result.content["status"] == "needs_profile"
    assert "출생연도" in result.content["summary"]
    assert result.card["status"] == "needs_profile"


def test_report_does_not_mix_other_user(auth_client, other_auth_client, db):
    ready_user(other_auth_client)
    result = run(tool_ctx(db), "get_allocation_report")
    assert result.content["status"] == "needs_assessment"
    assert result.content["totalAmount"] == 0


# ── get_recommendation ──────────────────────────────────────────────


def test_recommendation_passes_sentences_unchanged(auth_client, db, monkeypatch):
    ready_user(auth_client)
    auth_client.put(
        "/api/allocation/situation",
        json={"monthlyExpense": 2_000_000, "dependents": 0, "consumerDebt": 0},
    )
    spy = Spy(monkeypatch, allocation_service, "get_recommendation")
    ctx = tool_ctx(db)
    result = run(ctx, "get_recommendation")
    assert spy.calls == [((db, ctx.user.id), {})]
    recommendation = allocation_service.get_recommendation(db, ctx.user.id)
    directions = sorted(recommendation.directions, key=lambda item: item.priority)
    assert directions, "방향이 하나 이상 있어야 한다"

    content = result.content
    assert content["status"] == "ready"
    # 방향·이유 문장을 바꾸지 않고 그대로 전달한다(검증 체크리스트 7).
    assert [(d["title"], d["body"], d["amount"]) for d in content["directions"]] == [
        (d.title, d.body, d.amount) for d in directions
    ]
    assert [(r["title"], r["body"]) for r in content["reasons"]] == [
        (r.title, r.body) for r in recommendation.reasons
    ]
    assert content["riskProfileSummary"] == recommendation.risk_profile_summary
    assert content["targetWeights"] == recommendation.target_weights.model_dump()

    card = result.card
    assert set(card) == {"type", "title", "items", "href"}
    assert card["type"] == "directions"
    assert card["href"] == "/allocation/recommendation/detail"
    assert len(card["items"]) == min(3, len(directions))
    for item, direction in zip(card["items"], directions, strict=False):
        assert set(item) == {"title", "body", "amount"}
        assert (item["title"], item["body"]) == (direction.title, direction.body)
        expected = None if direction.amount is None else f"{direction.amount:,}원"
        assert item["amount"] == expected


def test_recommendation_status_without_assessment(auth_client, other_auth_client, db):
    ready_user(other_auth_client)
    result = run(tool_ctx(db), "get_recommendation")
    assert result.content["status"] == "needs_assessment"
    assert "투자성향 진단" in result.content["summary"]
    assert result.card is None


def test_recommendation_status_without_birth_year(bare_client, db):
    result = run(tool_ctx(db, "third@example.com"), "get_recommendation")
    assert result.content["status"] == "needs_profile"
    assert result.card is None


# ── get_risk_profile ────────────────────────────────────────────────


def test_risk_profile_ready(auth_client, db, monkeypatch):
    assess(auth_client)
    latest = Spy(monkeypatch, allocation_service, "get_latest_risk_profile")
    target_spy = Spy(monkeypatch, allocation_service, "get_target_allocation")
    ctx = tool_ctx(db)
    result = run(ctx, "get_risk_profile")
    assert latest.calls == [((db, ctx.user.id), {})]
    assert target_spy.calls == [((db, ctx.user.id), {})]
    info = allocation_service.get_latest_risk_profile(db, ctx.user.id)
    target = allocation_service.get_target_allocation(db, ctx.user.id)

    content = result.content
    assert content["riskProfile"] == info.risk_profile.value
    assert content["ageBand"] == "30s"
    assert content["baseWeights"] == {key.value: value for key, value in target.weights.items()}
    assert "status" not in content

    card = result.card
    assert card["type"] == "key_value" and card["title"] == "내 투자성향"
    labels = [item["label"] for item in card["items"]]
    assert labels[:4] == ["투자성향", "진단 점수", "진단일", "나이대"]
    assert "주식 기본 비중" in labels
    assert all(isinstance(item["value"], str) for item in card["items"])


def test_risk_profile_required_is_status(auth_client, other_auth_client, db):
    assess(other_auth_client)
    result = run(tool_ctx(db), "get_risk_profile")
    assert not result.is_error
    assert result.content == {
        "status": "risk_profile_required",
        "message": "투자성향 진단을 먼저 해 주세요.",
    }
    assert result.card is None


def test_profile_incomplete_is_status_with_profile(bare_client, db):
    assess(bare_client)
    result = run(tool_ctx(db, "third@example.com"), "get_risk_profile")
    assert result.content["status"] == "profile_incomplete"
    assert result.content["message"] == "출생연도를 먼저 입력해 주세요."
    assert result.content["riskProfile"]
    assert result.card["type"] == "key_value"
    assert {"label": "기본 배분", "value": "출생연도 입력 후 확인"} in result.card["items"]


def test_report_snapshot_is_kept_after_tool(auth_client, db):
    """ready면 02가 남긴 오늘 점수 스냅샷이 savepoint 밖에서도 남는다(다음 행 커밋에 포함)."""
    ready_user(auth_client)
    run(tool_ctx(db), "get_allocation_report")
    scores = auth_client.get("/api/allocation/scores?days=30").json()["items"]
    assert len(scores) == 1
