from datetime import date
from typing import Literal, Protocol

from app.modules.allocation.service import SyncedHolding
from app.modules.ledger.service import LedgerImportRow


class DataConnector(Protocol):
    key: Literal["codef", "mydata"]

    def is_available(self) -> bool: ...
    def register_account(
        self, *, kind: Literal["card", "bank"], organization: str, login_id: str, password: str
    ) -> str: ...
    def delete_account(self, connected_id: str, *, kind: str, organization: str) -> None: ...
    def fetch_card_approvals(
        self, connected_id: str, organization: str, start: date, end: date
    ) -> list[LedgerImportRow]: ...
    def fetch_bank_balances(self, connected_id: str, organization: str) -> list[SyncedHolding]: ...
