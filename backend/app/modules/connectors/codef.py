import re
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Literal

from app.core.config import Settings
from app.integrations.codef.client import CodefClient, CodefError, encrypt_password
from app.integrations.codef.organizations import ORGANIZATIONS
from app.modules.allocation.service import SyncedHolding
from app.modules.ledger.service import LedgerImportRow


def object_rows(value) -> list[dict]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list) and all(isinstance(row, dict) for row in value):
        return value
    raise CodefError()


MASKED_MESSAGE = "값이 가려져 있어 읽을 수 없습니다."


@dataclass(frozen=True)
class RowFailure:
    # row_number는 CODEF 응답 목록의 1부터 센 순번(거절로 건너뛴 행 포함)이다.
    row_number: int
    field: str
    message: str


class ApprovalRows(list[LedgerImportRow]):
    """공개 list 계약을 유지하면서 각 행의 응답 순번과 읽지 못한 행의 실패 이유도 전달한다."""

    def __init__(self):
        super().__init__()
        self.numbers: list[int] = []
        self.failures: list[RowFailure] = []

    @property
    def failed(self) -> int:
        return len(self.failures)


class RowRejected(Exception):
    # 메시지는 고정 문구만 쓴다. 응답 원문 값은 넣지 않는다.
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


def integer(value) -> int:
    text = str(value).replace(",", "").strip()
    if not re.fullmatch(r"[+-]?\d+", text):
        raise ValueError
    return int(text)


def field_text(row: dict, field: str) -> str:
    value = row.get(field)
    text = "" if value is None else str(value).strip()
    if text and set(text) == {"*"}:
        raise RowRejected(field, MASKED_MESSAGE)
    return text


def field_integer(row: dict, field: str, message: str) -> int:
    try:
        return integer(field_text(row, field))
    except ValueError:
        raise RowRejected(field, message) from None


def approval_row(row: dict) -> LedgerImportRow:
    # 스펙 17 4.1: 이용일 → 가맹점명 → 금액 → 취소금액 순서로 처음 걸린 원인 하나만 남긴다.
    used_date = field_text(row, "resUsedDate")
    try:
        if not re.fullmatch(r"\d{8}", used_date):
            raise ValueError
        occurred_on = datetime.strptime(used_date, "%Y%m%d").date()
    except ValueError:
        raise RowRejected("resUsedDate", "이용일을 읽을 수 없습니다.") from None
    merchant = field_text(row, "resMemberStoreName")
    if not merchant:
        raise RowRejected("resMemberStoreName", "가맹점명이 비어 있습니다.")
    if row.get("resHomeForeignType") == "1":
        used = field_integer(row, "resUsedAmount", "이용금액을 읽을 수 없습니다.")
    else:
        used = field_integer(row, "resKRWAmt", "해외 이용 건의 원화 금액이 없습니다.")
    cancelled = row.get("resCancelYN")
    has_cancel_amount = bool(str(row.get("resCancelAmount") or "").strip())
    cancellation = cancelled == "1" or used < 0 or (cancelled == "2" and has_cancel_amount)
    amount = used
    if cancellation and has_cancel_amount:
        amount = field_integer(row, "resCancelAmount", "취소금액을 읽을 수 없습니다.")
    return LedgerImportRow(
        occurred_on=occurred_on,
        merchant=merchant,
        amount=abs(amount),
        is_cancellation=cancellation,
        card_name=row.get("resCardName") or None,
        approval_no=row.get("resApprovalNo") or None,
        merchant_category=row.get("resMemberStoreType") or None,
    )


class CodefConnector:
    key: Literal["codef", "mydata"] = "codef"

    def __init__(self, settings: Settings):
        self.client = CodefClient(settings)

    def is_available(self) -> bool:
        return self.client.is_available()

    @staticmethod
    def _account(kind, organization):
        return {
            "countryCode": "KR",
            "businessType": "CD" if kind == "card" else "BK",
            "clientType": "P",
            "organization": organization,
            "loginType": "1",
        }

    def register_account(self, *, kind, organization, login_id, password) -> str:
        # https://developer.codef.io/common-guide/connected-id/register
        account = self._account(kind, organization)
        account.update(
            id=login_id, password=encrypt_password(self.client.settings.codef_public_key, password)
        )
        data = self.client.request("/v1/account/create", {"accountList": [account]})
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("connectedId"), str)
            or not data["connectedId"]
            or data.get("errorList")
        ):
            errors = data.get("errorList") if isinstance(data, dict) else None
            first = errors[0] if isinstance(errors, list) and errors else errors
            raise CodefError(first.get("code") if isinstance(first, dict) else None)
        return data["connectedId"]

    def delete_account(self, connected_id, *, kind, organization) -> None:
        # https://developer.codef.io/common-guide/connected-id/delete
        data = self.client.request(
            "/v1/account/delete",
            {"connectedId": connected_id, "accountList": [self._account(kind, organization)]},
        )
        errors = data.get("errorList") if isinstance(data, dict) else None
        if errors:
            first = errors[0] if isinstance(errors, list) else errors
            raise CodefError(first.get("code") if isinstance(first, dict) else None)

    def fetch_card_approvals(self, connected_id, organization, start, end) -> list[LedgerImportRow]:
        # KR_CD_P_002: https://developer.codef.io/products
        # https://admin.codef.io/dev-guide-menu/api-output-param/KR_CD_P_002
        data = self.client.request(
            "/v1/kr/card/p/account/approval-list",
            {
                "organization": organization,
                "connectedId": connected_id,
                "startDate": start.strftime("%Y%m%d"),
                "endDate": end.strftime("%Y%m%d"),
                "orderBy": "0",
                "inquiryType": "1",
                "memberStoreInfoType": "0",
            },
        )
        result = ApprovalRows()
        for number, row in enumerate(object_rows(data), 1):
            # 거절 건은 실패가 아니므로 건너뛰되 응답 순번은 센다.
            if row.get("resCancelYN") == "3":
                continue
            try:
                result.append(approval_row(row))
                result.numbers.append(number)
            except RowRejected as exc:
                result.failures.append(RowFailure(number, exc.field, exc.message))
        return result

    def fetch_bank_balances(self, connected_id, organization) -> list[SyncedHolding]:
        # KR_BK_1_P_001: https://developer.codef.io/products
        # https://admin.codef.io/dev-guide-menu/api-output-param/KR_BK_1_P_001
        data = self.client.request(
            "/v1/kr/bank/p/account/account-list",
            {"organization": organization, "connectedId": connected_id},
        )
        result = []
        try:
            for group in object_rows(data):
                for row in object_rows(group.get("resDepositTrust", [])):
                    if (
                        row.get("resAccountCurrency") != "KRW"
                        or row.get("resOverdraftAcctYN") == "1"
                    ):
                        continue
                    amount = integer(row.get("resAccountBalance"))
                    if amount < 0:
                        continue
                    account = row.get("resAccount")
                    if not isinstance(account, str) or not account:
                        raise ValueError
                    ref = "codef:" + sha256(f"{organization}|{account}".encode()).hexdigest()[:24]
                    # 응답의 계좌명에 계좌번호가 반복되어도 저장하지 않는다.
                    name = str(row.get("resAccountName") or "예금").replace(account, "")
                    result.append(
                        SyncedHolding(
                            external_ref=ref,
                            name=f"{ORGANIZATIONS['bank'][organization]} {name} ({account[-4:]})"[
                                :50
                            ],
                            amount=amount,
                            asset_class="cash",
                        )
                    )
        except (ValueError, TypeError, KeyError):
            # 일부 계좌만 반영하면 기존 정상 자산이 삭제될 수 있어 전체 실패로 처리한다.
            raise CodefError() from None
        return result
