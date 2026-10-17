from datetime import date
from typing import Literal

from app.core.errors import AppError
from app.modules.allocation.service import SyncedHolding
from app.modules.ledger.service import LedgerImportRow

MYDATA_NOTE = (
    "마이데이터는 금융위원회 허가를 받은 본인신용정보관리업자만 쓸 수 있어 "
    "개인 프로젝트에서는 연동할 수 없습니다."
)


def unsupported() -> AppError:
    return AppError(501, "CONNECTOR_NOT_SUPPORTED", MYDATA_NOTE)


class MyDataConnector:
    key: Literal["codef", "mydata"] = "mydata"

    def is_available(self) -> bool:
        return False

    def register_account(
        self, *, kind: Literal["card", "bank"], organization: str, login_id: str, password: str
    ) -> str:
        raise unsupported()

    def delete_account(self, connected_id: str, *, kind: str, organization: str) -> None:
        raise unsupported()

    def fetch_card_approvals(
        self, connected_id: str, organization: str, start: date, end: date
    ) -> list[LedgerImportRow]:
        raise unsupported()

    def fetch_bank_balances(self, connected_id: str, organization: str) -> list[SyncedHolding]:
        raise unsupported()
