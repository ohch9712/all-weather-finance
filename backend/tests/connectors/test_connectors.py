import base64
import json
from datetime import date
from urllib.parse import parse_qs, unquote

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import padding
from freezegun import freeze_time
from sqlalchemy import select, text

from app.core.crypto import decrypt_str
from app.integrations.codef.client import TOKEN_URL, CodefClient, CodefError, encrypt_password
from app.modules.connectors.models import ConnectorAccount, ConnectorSync
from app.modules.connectors.mydata import MYDATA_NOTE, MyDataConnector
from app.modules.connectors.service import get_codef_connector
from tests.connectors.conftest import response

ROOT = "/api/connectors"
CARD_PATH = "https://sandbox.codef.io/v1/kr/card/p/account/approval-list"
BANK_PATH = "https://sandbox.codef.io/v1/kr/bank/p/account/account-list"


def account_payload(**changes):
    return (
        dict(
            provider="codef",
            kind="card",
            organization="0306",
            label="생활비 카드",
            loginId="test-login-only-in-memory",
            password="test-password-only-in-memory",
            consent=True,
        )
        | changes
    )


def register(client, **changes):
    res = client.post(ROOT + "/accounts", json=account_payload(**changes))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def sync(client, account_id, **changes):
    return client.post(
        ROOT + "/sync",
        json={"accountId": account_id, "from": "2026-09-01", "to": "2026-09-30"} | changes,
    )


def card_row(**changes):
    return (
        dict(
            resUsedDate="20260910",
            resUsedTime="120000",
            resMemberStoreName="편의점",
            resCardName="생활카드",
            resUsedAmount="1,200",
            resApprovalNo="test-approval",
            resHomeForeignType="1",
            resCancelYN="0",
        )
        | changes
    )


def bank_row(**changes):
    return (
        dict(
            resAccount="test-account-ending-4321",
            resAccountName="입출금",
            resAccountBalance="2,500,000",
            resAccountCurrency="KRW",
            resOverdraftAcctYN="0",
        )
        | changes
    )


def test_rsa_roundtrip(codef_settings, rsa_key):
    encrypted = encrypt_password(codef_settings.codef_public_key, "임시-테스트-문자")
    assert (
        rsa_key.decrypt(base64.b64decode(encrypted), padding.PKCS1v15()).decode()
        == "임시-테스트-문자"
    )
    with pytest.raises(CodefError):
        encrypt_password("bad-public-key", "test")


def test_register_wire_and_no_sensitive_persistence(auth_client, db, codef_http, rsa_key, caplog):
    payload = account_payload()
    result = auth_client.post(ROOT + "/accounts", json=payload)
    assert result.status_code == 201
    assert set(result.json()) == {
        "id",
        "provider",
        "kind",
        "organization",
        "organizationName",
        "label",
        "createdAt",
    }
    request = next(
        call.request for call in codef_http.calls if call.request.url.path == "/v1/account/create"
    )
    assert request.content.startswith(b"%7B")
    body = json.loads(unquote(request.content.decode()))
    sent = body["accountList"][0]
    assert sent | {"id": "hidden", "password": "hidden"} == {
        "countryCode": "KR",
        "businessType": "CD",
        "clientType": "P",
        "organization": "0306",
        "loginType": "1",
        "id": "hidden",
        "password": "hidden",
    }
    assert (
        rsa_key.decrypt(base64.b64decode(sent["password"]), padding.PKCS1v15()).decode()
        == payload["password"]
    )
    assert sent["id"] == payload["loginId"]
    token_request = next(call.request for call in codef_http.calls if call.request.url == TOKEN_URL)
    assert token_request.headers["authorization"].startswith("Basic ")
    assert parse_qs(token_request.content.decode()) == {
        "grant_type": ["client_credentials"],
        "scope": ["read"],
    }
    account = db.scalar(select(ConnectorAccount))
    assert decrypt_str(account.connected_id_enc) == "test-connected"
    stored = str(
        {column.name: getattr(account, column.name) for column in account.__table__.columns}
    )
    for value in [payload["loginId"], payload["password"], "test-connected"]:
        assert value not in stored + result.text + caplog.text
    assert auth_client.post(ROOT + "/accounts", json=payload).status_code == 409
    assert sum(call.request.url.host != "testserver" for call in codef_http.calls) == 2


def test_provider_consent_keys_organizations_and_mydata(auth_client, monkeypatch):
    settings = get_codef_connector().client.settings
    monkeypatch.setattr(settings, "codef_client_id", "")
    providers = auth_client.get(ROOT + "/providers").json()["items"]
    assert providers[0]["available"] is False
    assert providers[1] == {"key": "mydata", "available": False, "note": MYDATA_NOTE}
    assert auth_client.post(ROOT + "/accounts", json=account_payload()).status_code == 409
    for consent in [None, False]:
        payload = account_payload()
        if consent is None:
            del payload["consent"]
        else:
            payload["consent"] = consent
        result = auth_client.post(ROOT + "/accounts", json=payload)
        assert result.status_code == 422
        assert result.json()["error"]["details"][0]["field"] == "consent"
    unsupported = auth_client.post(ROOT + "/accounts", json=account_payload(organization="0302"))
    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["details"][0]["field"] == "organization"
    assert (
        auth_client.post(ROOT + "/accounts", json=account_payload(provider="mydata")).status_code
        == 501
    )
    card = auth_client.get(ROOT + "/organizations?kind=card").json()["items"]
    bank = auth_client.get(ROOT + "/organizations?kind=bank").json()["items"]
    assert len(card) == 9 and len(bank) == 11
    assert {row["code"] for row in card}.isdisjoint({"0302", "0313"})
    assert {row["code"] for row in bank}.isdisjoint({"0027", "0031", "0089"})
    assert auth_client.get(ROOT + "/organizations?kind=invalid").status_code == 422


def test_mydata_all_methods():
    stub = MyDataConnector()
    assert not stub.is_available()
    calls = [
        lambda: stub.register_account(
            kind="card", organization="0306", login_id="test", password="test"
        ),
        lambda: stub.delete_account("test", kind="card", organization="0306"),
        lambda: stub.fetch_card_approvals("test", "0306", date.today(), date.today()),
        lambda: stub.fetch_bank_balances("test", "0004"),
    ]
    for call in calls:
        with pytest.raises(Exception) as exc:
            call()
        assert exc.value.status_code == 501 and exc.value.code == "CONNECTOR_NOT_SUPPORTED"
        assert str(exc.value) == MYDATA_NOTE


@freeze_time("2026-10-17")
def test_card_end_to_end_dedup_cancellation_and_review(auth_client, codef_http):
    account_id = register(auth_client)
    rows = [
        card_row(),
        card_row(resCancelYN="1", resCancelAmount="500", resApprovalNo="cancel"),
        card_row(resCancelYN="2", resCancelAmount="300", resApprovalNo="partial"),
        card_row(resCancelYN="2", resApprovalNo="partial-empty"),
        card_row(resUsedAmount="-2,000", resApprovalNo="negative"),
        card_row(resHomeForeignType="2", resKRWAmt="4,000", resApprovalNo="foreign"),
        card_row(resHomeForeignType="2", resApprovalNo="foreign-missing"),
        card_row(resMemberStoreName=""),
        card_row(resUsedDate="invalid"),
        card_row(resCancelYN="3"),
    ]
    route = codef_http.post(CARD_PATH).mock(return_value=response(rows))
    first = sync(auth_client, account_id)
    assert first.status_code == 200, first.text
    data = first.json()
    errors = [
        {"rowNumber": 7, "field": "resKRWAmt", "message": "해외 이용 건의 원화 금액이 없습니다."},
        {"rowNumber": 8, "field": "resMemberStoreName", "message": "가맹점명이 비어 있습니다."},
        {"rowNumber": 9, "field": "resUsedDate", "message": "이용일을 읽을 수 없습니다."},
    ]
    assert data["summary"] == {
        "inserted": 6,
        "skippedDuplicates": 0,
        "failed": 3,
        "errors": errors,
    }
    assert data["status"] == "succeeded" and data["finishedAt"]
    assert set(data) == {
        "id",
        "accountId",
        "kind",
        "status",
        "rangeStart",
        "rangeEnd",
        "startedAt",
        "finishedAt",
        "summary",
        "errorCode",
    }
    sent = json.loads(unquote(route.calls[0].request.content.decode()))
    assert sent == {
        "organization": "0306",
        "connectedId": "test-connected",
        "startDate": "20260901",
        "endDate": "20260930",
        "orderBy": "0",
        "inquiryType": "1",
        "memberStoreInfoType": "0",
    }
    again = sync(auth_client, account_id).json()
    assert again["summary"] == {
        "inserted": 0,
        "skippedDuplicates": 6,
        "failed": 3,
        "errors": errors,
    }
    review = auth_client.get("/api/ledger/entries", params={"importBatchId": data["id"]})
    assert review.status_code == 200
    assert len(review.json()["items"]) == 6
    cancellations = [row for row in review.json()["items"] if row["isCancellation"]]
    assert sorted(row["amount"] for row in cancellations) == [300, 500, 2000]
    assert sum(call.request.url == TOKEN_URL for call in codef_http.calls) == 1
    history = auth_client.get(
        ROOT + "/syncs", params={"accountId": account_id, "pageSize": 1}
    ).json()
    assert history["total"] == 2 and len(history["items"]) == 1 and history["pageSize"] == 1


MASKED = "값이 가려져 있어 읽을 수 없습니다."
LEDGER_AMOUNT = "금액을 확인해 주세요."


def card_errors(client, account_id):
    result = sync(client, account_id)
    assert result.status_code == 200, result.text
    summary = result.json()["summary"]
    history = client.get(ROOT + "/syncs", params={"accountId": account_id}).json()
    assert history["items"][0]["summary"] == summary
    return summary


@freeze_time("2026-10-17")
def test_card_masked_single_object_records_reason(auth_client, codef_http):
    # CODEF 샌드박스에서 본 응답: data가 객체 한 건이고 이용일·가맹점명·금액이 모두 가려져 있다.
    account_id = register(auth_client)
    masked = card_row(
        resUsedDate="********", resMemberStoreName="********", resUsedAmount="********"
    )
    codef_http.post(CARD_PATH).mock(return_value=response(masked))
    assert card_errors(auth_client, account_id) == {
        "inserted": 0,
        "skippedDuplicates": 0,
        "failed": 1,
        "errors": [{"rowNumber": 1, "field": "resUsedDate", "message": MASKED}],
    }


@freeze_time("2026-10-17")
def test_card_failure_reasons_per_cause_without_raw_values(auth_client, codef_http, caplog):
    account_id = register(auth_client)
    raw = dict(
        resMemberStoreName="원문-가맹점-7731",
        resCardName="원문-카드-5512",
        resApprovalNo="원문승인-9043",
        resUsedAmount="87,654",
        resUsedDate="20260911",
    )

    def raw_row(**changes):
        return card_row(**raw) | changes

    missing_date = raw_row()
    del missing_date["resUsedDate"]
    rows = [
        raw_row(),  # 1 저장
        raw_row(resCancelYN="3", resApprovalNo="원문승인-거절"),  # 2 거절은 제외하고 순번만 센다
        raw_row(resUsedDate="********", resMemberStoreName="**", resUsedAmount="***"),  # 3
        raw_row(resUsedAmount="0"),  # 4 가계부 검사 실패(넘긴 목록 2번째)
        missing_date,  # 5
        raw_row(resUsedDate="2026-09-11"),  # 6
        raw_row(resMemberStoreName=" ", resUsedAmount="x"),  # 7 가맹점명을 금액보다 먼저 본다
        raw_row(resMemberStoreName="***"),  # 8
        raw_row(resUsedAmount="8만 7천"),  # 9
        raw_row(resUsedAmount="*****"),  # 10
        raw_row(resHomeForeignType="2"),  # 11
        raw_row(resHomeForeignType="2", resKRWAmt="12.5"),  # 12
        raw_row(resHomeForeignType="2", resKRWAmt="****"),  # 13
        raw_row(resCancelYN="1", resCancelAmount="일부"),  # 14
        raw_row(resCancelYN="2", resCancelAmount="******"),  # 15
        raw_row(resCardName="가" * 51),  # 16 가계부 검사 실패(넘긴 목록 3번째)
        raw_row(resApprovalNo="원문승인-2"),  # 17 저장
    ]
    codef_http.post(CARD_PATH).mock(return_value=response(rows))
    summary = card_errors(auth_client, account_id)
    assert summary["inserted"] == 2 and summary["skippedDuplicates"] == 0
    assert summary["failed"] == 14
    assert summary["errors"] == [
        {"rowNumber": 3, "field": "resUsedDate", "message": MASKED},
        {"rowNumber": 4, "field": None, "message": LEDGER_AMOUNT},
        {"rowNumber": 5, "field": "resUsedDate", "message": "이용일을 읽을 수 없습니다."},
        {"rowNumber": 6, "field": "resUsedDate", "message": "이용일을 읽을 수 없습니다."},
        {"rowNumber": 7, "field": "resMemberStoreName", "message": "가맹점명이 비어 있습니다."},
        {"rowNumber": 8, "field": "resMemberStoreName", "message": MASKED},
        {"rowNumber": 9, "field": "resUsedAmount", "message": "이용금액을 읽을 수 없습니다."},
        {"rowNumber": 10, "field": "resUsedAmount", "message": MASKED},
        {"rowNumber": 11, "field": "resKRWAmt", "message": "해외 이용 건의 원화 금액이 없습니다."},
        {"rowNumber": 12, "field": "resKRWAmt", "message": "해외 이용 건의 원화 금액이 없습니다."},
        {"rowNumber": 13, "field": "resKRWAmt", "message": MASKED},
        {"rowNumber": 14, "field": "resCancelAmount", "message": "취소금액을 읽을 수 없습니다."},
        {"rowNumber": 15, "field": "resCancelAmount", "message": MASKED},
        {"rowNumber": 16, "field": None, "message": "카드명 또는 승인번호 길이를 확인해 주세요."},
    ]
    recorded = json.dumps(summary, ensure_ascii=False) + caplog.text
    for value in [*raw.values(), "87654", "원문승인-거절", "원문승인-2", "가" * 51, "12.5"]:
        assert value not in recorded


@freeze_time("2026-10-17")
def test_card_failure_reasons_keep_first_twenty_and_total_failed(auth_client, codef_http):
    account_id = register(auth_client)
    rows = [card_row(resCancelYN="3")]
    for index in range(30):
        # 응답 순번 짝수는 커넥터 변환 실패, 홀수는 가계부 검사 실패
        rows.append(
            card_row(resUsedDate="********")
            if index % 2 == 0
            else card_row(resUsedAmount="0", resApprovalNo=f"test-approval-{index}")
        )
    codef_http.post(CARD_PATH).mock(return_value=response(rows))
    summary = card_errors(auth_client, account_id)
    assert summary["inserted"] == 0 and summary["failed"] == 30
    assert summary["errors"] == [
        {"rowNumber": number, "field": "resUsedDate", "message": MASKED}
        if number % 2 == 0
        else {"rowNumber": number, "field": None, "message": LEDGER_AMOUNT}
        for number in range(2, 22)
    ]


@freeze_time("2026-10-17")
def test_bank_end_to_end_filters_dedup_and_delete(auth_client, db, codef_http, caplog):
    account_id = register(auth_client, kind="bank", organization="0004", label="현금 계좌")
    rows = [
        bank_row(),
        bank_row(resAccount="test-foreign", resAccountCurrency="USD"),
        bank_row(resAccount="test-overdraft", resOverdraftAcctYN="1"),
        bank_row(resAccount="test-negative", resAccountBalance="-1"),
    ]
    route = codef_http.post(BANK_PATH).mock(
        return_value=response({"resDepositTrust": rows, "resLoan": [{"resAccount": "ignored"}]})
    )
    first = sync(auth_client, account_id)
    assert first.status_code == 200, first.text
    assert first.json()["summary"]["created"] == 1
    second = sync(auth_client, account_id).json()
    assert second["summary"]["updated"] == 1 and second["summary"]["created"] == 0
    holdings = auth_client.get("/api/allocation/holdings").json()["items"]
    assert len(holdings) == 1
    holding = holdings[0]
    assert holding["amount"] == 2500000 and holding["assetClass"] == "cash"
    assert holding["name"] == "KB국민 입출금 (4321)"
    assert db.scalar(text("select external_ref from holdings")).startswith("codef:")
    assert bank_row()["resAccount"] not in json.dumps(holdings) + first.text + caplog.text
    sent = json.loads(unquote(route.calls[0].request.content.decode()))
    assert sent == {"organization": "0004", "connectedId": "test-connected"}
    codef_http.post("https://sandbox.codef.io/v1/account/delete").mock(
        return_value=response(code="CF-03002", message="sensitive-remote-message")
    )
    assert (
        auth_client.delete(
            ROOT + "/accounts/" + account_id, headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.get("/api/allocation/holdings").json()["items"] == []
    assert db.scalars(select(ConnectorSync)).all() == []
    assert "sensitive-remote-message" not in caplog.text


@pytest.mark.parametrize("code", ["CF-03002", "CF-12108", "CF-99999"])
def test_failure_is_saved_without_remote_details(auth_client, db, codef_http, caplog, code):
    account_id = register(auth_client)
    codef_http.post(CARD_PATH).mock(
        return_value=response(
            code=code,
            message="test-login-only-in-memory test-connected",
            extraMessage="test-password-only-in-memory",
        )
    )
    result = sync(auth_client, account_id)
    assert result.status_code == 502 and result.json()["error"]["code"] == "CONNECTOR_FAILED"
    saved = db.scalar(select(ConnectorSync))
    assert saved.status == "failed" and saved.error_code == code and saved.finished_at
    history = auth_client.get(ROOT + "/syncs").text
    for value in ["test-login-only-in-memory", "test-password-only-in-memory", "test-connected"]:
        assert value not in result.text + history + caplog.text


def test_registration_partial_error_and_missing_connected_id(auth_client, codef_http):
    for data in [
        {"connectedId": "test-connected", "errorList": [{"code": "CF-03002"}]},
        {"successList": []},
    ]:
        codef_http.post("https://sandbox.codef.io/v1/account/create").mock(
            return_value=response(data)
        )
        assert auth_client.post(ROOT + "/accounts", json=account_payload()).status_code == 502
    assert auth_client.get(ROOT + "/accounts").json() == {"items": []}


def test_user_isolation_and_range_validation(auth_client, other_auth_client, codef_http):
    account_id = register(auth_client)
    assert other_auth_client.get(ROOT + "/accounts").json() == {"items": []}
    assert other_auth_client.get(ROOT + "/syncs").json()["total"] == 0
    assert (
        other_auth_client.get(ROOT + "/syncs", params={"accountId": account_id}).status_code == 404
    )
    assert (
        other_auth_client.delete(
            ROOT + "/accounts/" + account_id, headers={"Content-Type": "application/json"}
        ).status_code
        == 404
    )
    assert sync(other_auth_client, account_id).status_code == 404
    for fields in [
        {"from": None},
        {"to": None},
        {"from": "2026-10-01", "to": "2026-09-01"},
        {"from": "2026-01-01", "to": "2026-04-03"},
    ]:
        assert sync(auth_client, account_id, **fields).status_code == 422
    codef_http.post(CARD_PATH).mock(return_value=response(card_row()))
    assert (
        sync(auth_client, account_id, **{"from": "2026-07-01", "to": "2026-09-30"}).status_code
        == 200
    )


def test_token_refresh_and_malformed_response(codef_settings, codef_http):
    client = CodefClient(codef_settings)
    codef_http.post(CARD_PATH).mock(side_effect=[httpx.Response(401), response([])])
    assert client.request("/v1/kr/card/p/account/approval-list", {}) == []
    assert sum(call.request.url == TOKEN_URL for call in codef_http.calls) == 2
    with freeze_time("2026-11-01"):
        codef_http.post(CARD_PATH).mock(return_value=response([]))
        client.request("/v1/kr/card/p/account/approval-list", {})
    assert sum(call.request.url == TOKEN_URL for call in codef_http.calls) == 3
    for bad in [
        httpx.Response(200, text="not-json"),
        httpx.Response(200, json={"result": []}),
        httpx.Response(503),
    ]:
        codef_http.post(CARD_PATH).mock(return_value=bad)
        with pytest.raises(CodefError):
            client.request("/v1/kr/card/p/account/approval-list", {})


def test_transaction_rollback_preserves_failed_history(auth_client, codef_http, monkeypatch):
    from app.modules.connectors import service

    account_id = register(auth_client)
    codef_http.post(CARD_PATH).mock(return_value=response(card_row()))
    original = service.ledger.import_entries

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("test-sensitive-detail")

    monkeypatch.setattr(service.ledger, "import_entries", fail_after_write)
    result = sync(auth_client, account_id)
    assert result.status_code == 502 and "test-sensitive-detail" not in result.text
    assert auth_client.get(ROOT + "/syncs").json()["items"][0]["status"] == "failed"
    assert auth_client.get("/api/ledger/entries").json()["total"] == 0


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/providers"),
        ("get", "/organizations?kind=card"),
        ("get", "/accounts"),
        ("get", "/syncs"),
        ("post", "/accounts"),
        ("post", "/sync"),
    ],
)
def test_auth_required(client, method, path):
    assert (
        getattr(client, method)(
            ROOT + path, **({"json": {}} if method == "post" else {})
        ).status_code
        == 401
    )
