import json
from datetime import UTC, datetime
from urllib.parse import unquote
from uuid import UUID

import httpx
import pytest
from sqlalchemy import func, select

from app.core.crypto import encrypt_str
from app.core.errors import AppError
from app.modules.allocation.service import SyncedHolding, upsert_synced_holdings
from app.modules.connectors.models import ConnectorAccount
from app.modules.connectors.service import delete_all_accounts, get_codef_connector
from tests.connectors.conftest import response

DELETE_URL = "https://sandbox.codef.io/v1/account/delete"
FAILED_MESSAGE = (
    "CODEF 연결을 지우지 못했습니다. 데이터 자동 수집 화면에서 연결을 먼저 삭제해 주세요."
)


def user_id(client):
    return UUID(client.get("/api/auth/me").json()["user"]["id"])


def add_account(db, owner, index, *, kind="card", organization=None):
    # 만든 순서를 created_at으로 고정하고 연결마다 다른 가짜 connectedId를 쓴다.
    row = ConnectorAccount(
        user_id=owner,
        provider="codef",
        kind=kind,
        organization=organization or ("0306" if kind == "card" else "0004"),
        label=f"연결 {index}",
        connected_id_enc=encrypt_str(f"test-connected-{index}"),
        created_at=datetime(2026, 10, 1, index, tzinfo=UTC),
    )
    db.add(row)
    db.flush()
    if kind == "bank":
        upsert_synced_holdings(
            db,
            owner,
            source="codef",
            connection_id=row.id,
            items=[SyncedHolding(external_ref=f"codef:test-{index}", name="입출금", amount=1000)],
        )
    db.commit()
    return row.id


def sent_ids(route):
    return [
        json.loads(unquote(call.request.content.decode()))["connectedId"] for call in route.calls
    ]


def count_accounts(db, owner):
    return db.scalar(
        select(func.count()).select_from(ConnectorAccount).where(ConnectorAccount.user_id == owner)
    )


def test_no_accounts_does_nothing(auth_client, db, codef_http):
    route = codef_http.post(DELETE_URL)
    delete_all_accounts(db, user_id(auth_client))
    assert route.calls.call_count == 0
    assert sum(call.request.url.host != "testserver" for call in codef_http.calls) == 0


def test_no_accounts_without_keys_does_nothing(auth_client, db, monkeypatch):
    # 연결이 없으면 키가 없어도 CODEF를 부르지 않고 그대로 끝난다.
    monkeypatch.setattr(get_codef_connector().client.settings, "codef_client_id", "")
    delete_all_accounts(db, user_id(auth_client))


def test_deletes_all_in_created_order(auth_client, other_auth_client, db, codef_http, caplog):
    owner, other = user_id(auth_client), user_id(other_auth_client)
    # 만든 순서와 다르게 넣어도 created_at 순서로 지운다.
    add_account(db, owner, 3, kind="card", organization="0301")
    add_account(db, owner, 1, kind="bank")
    add_account(db, owner, 2, kind="card")
    add_account(db, other, 4, kind="bank")
    route = codef_http.post(DELETE_URL).mock(return_value=response({"errorList": []}))
    delete_all_accounts(db, owner)
    assert sent_ids(route) == ["test-connected-1", "test-connected-2", "test-connected-3"]
    assert count_accounts(db, owner) == 0
    assert count_accounts(db, other) == 1
    assert auth_client.get("/api/allocation/holdings").json()["items"] == []
    assert len(other_auth_client.get("/api/allocation/holdings").json()["items"]) == 1
    assert "test-connected" not in caplog.text


@pytest.mark.parametrize("failure", ["result", "errors", "network"])
def test_middle_failure_stops_and_retry_handles_rest(auth_client, db, codef_http, caplog, failure):
    owner = user_id(auth_client)
    first = add_account(db, owner, 1, kind="card")
    second = add_account(db, owner, 2, kind="bank")
    third = add_account(db, owner, 3, kind="card", organization="0301")

    def fail_second(request):
        connected_id = json.loads(unquote(request.content.decode()))["connectedId"]
        if connected_id != "test-connected-2":
            return response({"errorList": []})
        if failure == "result":
            return response(code="CF-03002", message="sensitive-remote-message")
        if failure == "errors":
            return response({"errorList": [{"code": "CF-12345", "message": "sensitive-remote"}]})
        raise httpx.ConnectError("test-connected-2 sensitive-remote-message")

    route = codef_http.post(DELETE_URL).mock(side_effect=fail_second)
    with pytest.raises(AppError) as exc:
        delete_all_accounts(db, owner)
    assert (exc.value.status_code, exc.value.code, exc.value.message) == (
        409,
        "CONFLICT",
        FAILED_MESSAGE,
    )
    assert sent_ids(route) == ["test-connected-1", "test-connected-2"]
    # 첫 연결은 지워진 채로 남고(commit), 실패한 연결과 그 뒤 연결은 현금 자산과 함께 남는다.
    db.expire_all()
    remaining = db.scalars(
        select(ConnectorAccount.id).where(ConnectorAccount.user_id == owner)
    ).all()
    assert set(remaining) == {second, third}
    assert first not in remaining
    assert len(auth_client.get("/api/allocation/holdings").json()["items"]) == 1
    assert "계정 삭제 중 CODEF 연결 삭제를 멈췄습니다." in caplog.text
    for value in ["test-connected", "sensitive-remote"]:
        assert value not in caplog.text + exc.value.message

    # 다시 시도하면 남은 연결만 CODEF에 지운다.
    route.mock(return_value=response({"errorList": []}))
    before = route.calls.call_count
    delete_all_accounts(db, owner)
    assert sent_ids(route)[before:] == ["test-connected-2", "test-connected-3"]
    assert count_accounts(db, owner) == 0
    assert auth_client.get("/api/allocation/holdings").json()["items"] == []


def test_missing_keys_stops_without_codef_call(auth_client, db, codef_http, monkeypatch):
    owner = user_id(auth_client)
    add_account(db, owner, 1)
    route = codef_http.post(DELETE_URL)
    monkeypatch.setattr(get_codef_connector().client.settings, "codef_client_id", "")
    with pytest.raises(AppError) as exc:
        delete_all_accounts(db, owner)
    assert (exc.value.status_code, exc.value.code, exc.value.message) == (
        409,
        "CONFLICT",
        FAILED_MESSAGE,
    )
    assert route.calls.call_count == 0
    assert count_accounts(db, owner) == 1
