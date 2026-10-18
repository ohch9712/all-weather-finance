from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.modules.imports import jobs, repository
from app.modules.imports.models import ImportJob

NOW = datetime(2026, 10, 18, 3, tzinfo=UTC)


def add_job(db, user_id, expires_at):
    job = ImportJob(
        user_id=user_id,
        kind="ledger",
        file_name="개인거래.csv",
        file_type="csv",
        header_row=1,
        columns=["금액"],
        rows=[["12345"]],
        mapping={},
        mapping_source="user",
        expires_at=expires_at,
    )
    return repository.add(db, job)


def test_purge_all_users_includes_boundary(db, auth_client, other_auth_client):
    first = auth_client.get("/api/auth/me").json()["user"]["id"]
    second = other_auth_client.get("/api/auth/me").json()["user"]["id"]
    expired = add_job(db, first, NOW - timedelta(seconds=1))
    boundary = add_job(db, second, NOW)
    active = add_job(db, first, NOW + timedelta(microseconds=1))
    assert repository.remove_all_expired(db, NOW) == 2
    assert db.scalars(select(ImportJob.id)).all() == [active.id]
    assert repository.remove_all_expired(db, NOW) == 0
    assert expired.id != boundary.id


def test_cli_commits_and_prints_only_count(monkeypatch, capsys):
    events = []

    class FakeSession:
        @contextmanager
        def begin(self):
            events.append("begin")
            yield
            events.append("commit")

    db = FakeSession()

    @contextmanager
    def session():
        yield db

    def remove(session, now):
        assert session is db
        assert now == NOW
        return 2

    monkeypatch.setattr(jobs, "SessionLocal", session)
    monkeypatch.setattr(jobs, "now_utc", lambda: NOW)
    monkeypatch.setattr(repository, "remove_all_expired", remove)
    assert jobs.main(["purge-expired"]) == 0
    assert events == ["begin", "commit"]
    assert capsys.readouterr().out == "2\n"


def test_cli_failure_propagates_and_does_not_print_success(monkeypatch, capsys):
    @contextmanager
    def session():
        raise RuntimeError("정리 실패")
        yield

    monkeypatch.setattr(jobs, "SessionLocal", session)
    with pytest.raises(RuntimeError, match="정리 실패"):
        jobs.main(["purge-expired"])
    assert capsys.readouterr().out == ""
