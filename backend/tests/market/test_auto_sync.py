from contextlib import nullcontext
from dataclasses import replace
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from freezegun import freeze_time
from sqlalchemy import inspect, text

from app.core.errors import AppError
from app.integrations.brokers.mock import MockBroker
from app.modules.allocation import service as allocation
from app.modules.journal import service as journal
from app.modules.market import jobs, service
from app.modules.market.models import BrokerConnection

TODAY = date(2026, 10, 19)


def create(client, provider="kiwoom", label="자동 연결", enabled=True):
    response = client.post(
        "/api/market/connections",
        json={
            "provider": provider,
            "environment": "real" if provider == "toss" else "mock",
            "label": label,
            "appKey": "fake-auto-key-sensitive",
            "appSecret": "fake-auto-secret-sensitive",
            "accountNo": "fake-auto-account-sensitive",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    if enabled and provider != "mock":
        response = client.patch(f"/api/market/connections/{data['id']}", json={"autoSync": True})
        assert response.status_code == 200
    return UUID(data["id"])


def row(db, cid):
    db.expire_all()
    return db.get(BrokerConnection, cid)


def test_defaults_patch_disable_preserves_result(auth_client, db):
    cid = create(auth_client, enabled=False)
    original = row(db, cid)
    assert original.auto_sync is False
    assert original.last_auto_sync_at is None
    columns = {c["name"]: c for c in inspect(db.bind).get_columns("broker_connections")}
    assert columns["auto_sync"]["nullable"] is False
    assert columns["auto_sync"]["default"] == "false"
    for name in ("last_auto_sync_at", "last_auto_sync_status", "last_auto_sync_error_code"):
        assert columns[name]["nullable"] is True
    keys = original.app_key_enc, original.app_secret_enc, original.account_no_enc
    response = auth_client.patch(f"/api/market/connections/{cid}", json={"autoSync": True})
    assert response.status_code == 200
    assert response.json()["autoSync"] is True
    for name in ("lastAutoSyncAt", "lastAutoSyncStatus", "lastAutoSyncErrorCode"):
        assert response.json()[name] is None
    at = datetime(2026, 10, 19, 11, 30, tzinfo=UTC)
    original.last_auto_sync_at = at
    original.last_auto_sync_status = "partial"
    original.last_auto_sync_error_code = "BROKER_AUTH_FAILED"
    db.commit()
    response = auth_client.patch(f"/api/market/connections/{cid}", json={"autoSync": False})
    data = response.json()
    assert response.status_code == 200 and data["autoSync"] is False
    assert data["lastAutoSyncAt"] == "2026-10-19T11:30:00Z"
    assert data["lastAutoSyncStatus"] == "partial"
    assert data["lastAutoSyncErrorCode"] == "BROKER_AUTH_FAILED"
    assert keys == (original.app_key_enc, original.app_secret_enc, original.account_no_enc)
    assert data["status"] == "unverified" and data["lastErrorCode"] is None
    assert auth_client.get("/api/market/connections").json()["items"][0] == data


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"autoSync": True, "label": "변경"},
        {"autoSync": "true"},
        {"autoSync": 1},
        {"autoSync": None},
        {"auto_sync": True},
    ],
)
def test_patch_strict_body(auth_client, body):
    cid = create(auth_client, enabled=False)
    assert auth_client.patch(f"/api/market/connections/{cid}", json=body).status_code == 422


def test_patch_mock_json_auth_and_isolation(auth_client, other_auth_client, client, db):
    cid = create(auth_client)
    url = f"/api/market/connections/{cid}"
    assert other_auth_client.patch(url, json={"autoSync": False}).status_code == 404
    assert client.patch(url, json={"autoSync": True}).status_code == 401
    assert (
        auth_client.patch(f"/api/market/connections/{uuid4()}", json={"autoSync": True}).status_code
        == 404
    )
    assert (
        auth_client.patch(
            url, content='{"autoSync":true}', headers={"Content-Type": "text/plain"}
        ).status_code
        == 422
    )
    assert row(db, cid).auto_sync is True
    sample = create(auth_client, provider="mock", label="샘플 연결")
    for value in (True, False):
        result = auth_client.patch(f"/api/market/connections/{sample}", json={"autoSync": value})
        assert result.status_code == 422
        assert result.json()["error"]["details"] == [
            {"field": "autoSync", "message": "샘플 연결은 자동 동기화를 쓸 수 없습니다."}
        ]


@pytest.fixture
def steps(monkeypatch):
    calls = []
    monkeypatch.setattr(
        service,
        "get_user_broker_client",
        lambda *args: SimpleNamespace(capabilities={"HOLDINGS", "EXECUTIONS"}),
    )
    monkeypatch.setattr(
        allocation, "sync_holdings", lambda db, uid, cid: calls.append(("holdings", uid, cid))
    )
    monkeypatch.setattr(
        journal,
        "sync_connection_trades",
        lambda db, uid, cid, start, end: calls.append(("trades", uid, cid, start, end)),
    )
    return calls


@freeze_time("2026-10-19 11:30:00")
def test_batch_selection_order_cli_and_period(
    auth_client, other_auth_client, db, monkeypatch, steps, capsys
):
    first = create(auth_client)
    second = create(other_auth_client, provider="toss")
    disabled = create(auth_client, label="꺼진 연결", enabled=False)
    sample = create(auth_client, provider="mock", label="샘플")
    db.get(BrokerConnection, sample).auto_sync = True
    db.get(BrokerConnection, first).created_at = datetime(2026, 10, 18, tzinfo=UTC)
    db.commit()
    monkeypatch.setattr(jobs, "SessionLocal", lambda: nullcontext(db))
    assert jobs.main(["auto-sync", "--today", TODAY.isoformat()]) == 0
    assert [call[2] for call in steps] == [first, first, second, second]
    assert steps[1][3:] == (date(2026, 10, 13), TODAY)
    assert steps[0][1] != steps[2][1]
    for cid in (first, second):
        result = row(db, cid)
        assert result.last_auto_sync_status == "ok"
        assert result.last_auto_sync_at == datetime(2026, 10, 19, 11, 30, tzinfo=UTC)
        assert result.last_auto_sync_error_code is None
        assert result.status == "unverified" and result.last_error_code is None
    assert row(db, disabled).last_auto_sync_at is None
    assert row(db, sample).last_auto_sync_at is None
    assert (
        capsys.readouterr().out == f"auto-sync {first} ok -\nauto-sync {second} ok -\n"
        "auto-sync done total=2 ok=2 partial=0 failed=0\n"
    )


@pytest.mark.parametrize(
    "failures,expected,code",
    [
        ({"holdings"}, "partial", "BROKER_AUTH_FAILED"),
        ({"trades"}, "partial", "BROKER_UNAVAILABLE"),
        ({"holdings", "trades"}, "failed", "BROKER_AUTH_FAILED"),
    ],
)
def test_step_rollback_continues_and_preserves_verification(
    auth_client, db, monkeypatch, steps, failures, expected, code
):
    cid = create(auth_client)
    original = db.get(BrokerConnection, cid)
    original.status = "error"
    original.last_error_code = "BROKER_IP_NOT_ALLOWED"
    db.commit()
    called = []

    def run(stage):
        def execute(db, uid, target, **kwargs):
            called.append(stage)
            if stage in failures:
                db.get(BrokerConnection, target).label = "롤백할 변경"
                db.flush()
                raise AppError(
                    502,
                    "BROKER_AUTH_FAILED" if stage == "holdings" else "BROKER_UNAVAILABLE",
                    "가짜 비밀 메시지",
                )
            assert db.get(BrokerConnection, target).label == "자동 연결"

        return execute

    monkeypatch.setattr(allocation, "sync_holdings", run("holdings"))
    monkeypatch.setattr(journal, "sync_connection_trades", run("trades"))
    jobs.auto_sync(db, TODAY)
    assert called == ["holdings", "trades"]
    result = row(db, cid)
    assert (result.last_auto_sync_status, result.last_auto_sync_error_code) == (expected, code)
    assert result.status == "error" and result.last_error_code == "BROKER_IP_NOT_ALLOWED"
    assert result.label == "자동 연결"


@pytest.mark.parametrize(
    "exception,code",
    [
        (AppError(409, "BROKER_NOT_CONNECTED", "연결 필요"), "BROKER_NOT_CONNECTED"),
        (RuntimeError("fake-auto-secret-sensitive"), "INTERNAL_ERROR"),
    ],
)
def test_client_failure_and_next_connection(
    auth_client, db, monkeypatch, steps, capsys, caplog, exception, code
):
    first = create(auth_client)
    second = create(auth_client, label="다음 연결")

    def get_client(db, uid, cid):
        if cid == first:
            raise exception
        return SimpleNamespace(capabilities={"HOLDINGS", "EXECUTIONS"})

    monkeypatch.setattr(service, "get_user_broker_client", get_client)
    jobs.auto_sync(db, TODAY)
    assert row(db, first).last_auto_sync_status == "failed"
    assert row(db, first).last_auto_sync_error_code == code
    assert row(db, second).last_auto_sync_status == "ok"
    assert [c[2] for c in steps] == [second, second]
    output = capsys.readouterr().out + caplog.text
    for secret in (
        "fake-auto-key-sensitive",
        "fake-auto-secret-sensitive",
        "fake-auto-account-sensitive",
        "가짜 비밀 메시지",
    ):
        assert secret not in output


def test_unexpected_step_exception_does_not_stop_next_step(
    auth_client, db, monkeypatch, steps, caplog
):
    cid = create(auth_client)

    def fail(*args):
        raise ValueError("가짜 비밀 메시지")

    monkeypatch.setattr(allocation, "sync_holdings", fail)
    jobs.auto_sync(db, TODAY)
    assert [call[0] for call in steps] == ["trades"]
    assert row(db, cid).last_auto_sync_status == "partial"
    assert row(db, cid).last_auto_sync_error_code == "INTERNAL_ERROR"
    assert "가짜 비밀 메시지" not in caplog.text


@pytest.mark.parametrize(
    "capabilities,stages", [({"HOLDINGS"}, ["holdings"]), ({"EXECUTIONS"}, ["trades"]), (set(), [])]
)
def test_capabilities(auth_client, db, monkeypatch, steps, capabilities, stages):
    cid = create(auth_client)
    monkeypatch.setattr(
        service, "get_user_broker_client", lambda *args: SimpleNamespace(capabilities=capabilities)
    )
    jobs.auto_sync(db, TODAY)
    assert [c[0] for c in steps] == stages
    assert row(db, cid).last_auto_sync_status == "ok"


def test_batch_failure_exit_and_safe_log(monkeypatch, caplog):
    def fail():
        raise RuntimeError("fake-auto-secret-sensitive")

    monkeypatch.setattr(jobs, "SessionLocal", fail)
    assert jobs.main(["auto-sync"]) == 1
    assert "RuntimeError" in caplog.text and "fake-auto-secret-sensitive" not in caplog.text


@freeze_time("2026-10-19 11:30:00")
def test_real_services_idempotent_wrapper_same_as_manual_and_user_isolation(
    auth_client, other_auth_client, db, monkeypatch
):
    cid = create(auth_client)
    other = create(other_auth_client, label="다른 사용자", enabled=False)
    db.get(BrokerConnection, cid).status = "active"
    db.commit()

    class FakeBroker(MockBroker):
        provider = "kiwoom"
        version = 0

        def get_executions(self, start, end):
            return [
                replace(e, price=e.price + self.version) for e in super().get_executions(start, end)
            ]

    broker = FakeBroker()
    monkeypatch.setattr(service, "_make_client", lambda *args: broker)
    uid = db.get(BrokerConnection, cid).user_id
    # 공개 래퍼의 삽입·갱신·변화 없음이 실제 수동 엔드포인트와 같다.
    result = journal.sync_connection_trades(db, uid, cid, TODAY.replace(day=13), TODAY)
    assert result.inserted > 0
    manual = auth_client.post(
        "/api/journal/sync",
        json={"connectionId": str(cid), "from": "2026-10-13", "to": "2026-10-19"},
    )
    assert manual.status_code == 200 and manual.json()["unchanged"] == result.inserted
    broker.version = 1
    updated = journal.sync_connection_trades(db, uid, cid, TODAY.replace(day=13), TODAY)
    assert updated.updated == result.inserted
    unchanged = journal.sync_connection_trades(db, uid, cid, TODAY.replace(day=13), TODAY)
    assert unchanged.unchanged == result.inserted
    jobs.auto_sync(db, TODAY)
    trades = auth_client.get("/api/journal/trades").json()["total"]
    holdings = auth_client.get("/api/allocation/holdings").json()["items"]
    assert trades == result.inserted and len(holdings) == 6
    jobs.auto_sync(db, TODAY)
    assert auth_client.get("/api/journal/trades").json()["total"] == trades
    assert len(auth_client.get("/api/allocation/holdings").json()["items"]) == len(holdings)
    assert other_auth_client.get("/api/journal/trades").json()["total"] == 0
    assert other_auth_client.get("/api/allocation/holdings").json()["items"] == []
    assert row(db, other).last_auto_sync_at is None
    assert row(db, cid).last_auto_sync_status == "ok"


def test_database_constraint(db):
    constraints = inspect(db.bind).get_check_constraints("broker_connections")
    assert any(
        "last_auto_sync_status" in c["name"]
        and all(s in c["sqltext"] for s in ("ok", "partial", "failed"))
        for c in constraints
    )
    assert (
        db.scalar(text("select count(*) from alembic_version where version_num = 'market_0003'"))
        == 1
    )


def test_cron_schedule():
    lines = Path(__file__).resolve().parents[3].joinpath("deploy/crontab").read_text().splitlines()
    assert lines.count("30 20 * * 1-5 cd /app && python -m app.modules.market.jobs auto-sync") == 1
