import re
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


class ApprovalRows(list[LedgerImportRow]):
    """공개 list 계약을 유지하면서 변환 중 제외한 행 수도 호출자에게 전달한다."""

    failed = 0


def integer(value) -> int:
    text = str(value).replace(",", "").strip()
    if not re.fullmatch(r"[+-]?\d+", text):
        raise ValueError
    return int(text)


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
        self.client.request(
            "/v1/account/delete",
            {"connectedId": connected_id, "accountList": [self._account(kind, organization)]},
        )

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
        for row in object_rows(data):
            if row.get("resCancelYN") == "3":
                continue
            try:
                merchant = str(row.get("resMemberStoreName") or "").strip()
                if not merchant:
                    raise ValueError
                domestic = row.get("resHomeForeignType") == "1"
                used = integer(row.get("resUsedAmount") if domestic else row.get("resKRWAmt"))
                cancelled = row.get("resCancelYN")
                cancel_amount = row.get("resCancelAmount")
                cancellation = (
                    cancelled == "1" or used < 0 or (cancelled == "2" and bool(cancel_amount))
                )
                amount = integer(cancel_amount) if cancellation and cancel_amount else used
                result.append(
                    LedgerImportRow(
                        occurred_on=datetime.strptime(row["resUsedDate"], "%Y%m%d").date(),
                        merchant=merchant,
                        amount=abs(amount),
                        is_cancellation=cancellation,
                        card_name=row.get("resCardName") or None,
                        approval_no=row.get("resApprovalNo") or None,
                        merchant_category=row.get("resMemberStoreType") or None,
                    )
                )
            except (ValueError, TypeError, KeyError):
                result.failed += 1
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
