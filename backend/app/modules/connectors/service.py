import logging
from functools import lru_cache

from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.crypto import decrypt_str, encrypt_str
from app.core.errors import AppError, field_error
from app.core.schemas import Page
from app.core.time import now_utc
from app.integrations.codef.client import CodefError
from app.integrations.codef.organizations import ORGANIZATIONS
from app.modules.allocation import service as allocation
from app.modules.connectors import repository
from app.modules.connectors.base import DataConnector
from app.modules.connectors.codef import CodefConnector
from app.modules.connectors.mydata import MYDATA_NOTE, MyDataConnector
from app.modules.connectors.schemas import Account, AccountList, Provider, ProviderList, Sync
from app.modules.ledger import service as ledger

logger = logging.getLogger(__name__)

# 카드 동기화 summary.errors에 남기는 실패 이유 최대 건수(스펙 17 4.1)
MAX_SUMMARY_ERRORS = 20


@lru_cache
def get_codef_connector() -> CodefConnector:
    return CodefConnector(get_settings())


def get_connector(provider: str) -> DataConnector:
    return MyDataConnector() if provider == "mydata" else get_codef_connector()


def providers():
    return ProviderList(
        items=[
            Provider(
                key="codef",
                available=get_codef_connector().is_available(),
                environment=get_settings().codef_env,
                note=(
                    "카드 승인내역과 은행 잔액을 사용자가 직접 가져옵니다. "
                    "은행은 기관에 따라 아이디 로그인이 막힐 수 있어요."
                ),
            ),
            Provider(key="mydata", available=False, note=MYDATA_NOTE),
        ]
    )


def account_view(row):
    return Account(
        id=row.id,
        provider=row.provider,
        kind=row.kind,
        organization=row.organization,
        organization_name=ORGANIZATIONS[row.kind][row.organization],
        label=row.label,
        created_at=row.created_at,
    )


def list_accounts(db, user_id):
    return AccountList(items=[account_view(row) for row in repository.list_accounts(db, user_id)])


def require_account(db, user_id, account_id):
    row = repository.get_account(db, user_id, account_id)
    if row is None:
        raise AppError(404, "NOT_FOUND", "연결 계정을 찾을 수 없습니다.")
    return row


def register_account(db, user_id, data):
    if not data.consent:
        raise field_error("consent", "카드사 로그인 정보가 CODEF로 전송되는 데 동의해 주세요.")
    connector = get_connector(data.provider)
    if data.provider == "mydata":
        raise AppError(501, "CONNECTOR_NOT_SUPPORTED", MYDATA_NOTE)
    if data.organization not in ORGANIZATIONS[data.kind]:
        raise field_error("organization", "지원하지 않는 기관입니다.")
    if not connector.is_available():
        raise AppError(409, "CONFLICT", "CODEF 키가 설정되지 않았습니다.")
    if repository.find_account(db, user_id, data.provider, data.kind, data.organization):
        raise AppError(409, "CONFLICT", "이미 등록한 기관입니다.")
    connected_id = connector.register_account(
        kind=data.kind,
        organization=data.organization,
        login_id=data.login_id.get_secret_value(),
        password=data.password.get_secret_value(),
    )
    try:
        with db.begin_nested():
            row = repository.create_account(
                db,
                user_id=user_id,
                provider=data.provider,
                kind=data.kind,
                organization=data.organization,
                label=data.label,
                connected_id_enc=encrypt_str(connected_id),
            )
        db.commit()
    except IntegrityError:
        # 동시에 같은 기관을 등록했을 때 추가로 발급된 외부 연결도 정리한다.
        try:
            connector.delete_account(connected_id, kind=data.kind, organization=data.organization)
        except Exception:
            logger.warning("중복 등록의 CODEF 연결 정리에 실패했습니다.")
        raise AppError(409, "CONFLICT", "이미 등록한 기관입니다.") from None
    return account_view(row)


def delete_account(db, user_id, account_id):
    row = require_account(db, user_id, account_id)
    try:
        get_connector(row.provider).delete_account(
            decrypt_str(row.connected_id_enc), kind=row.kind, organization=row.organization
        )
    except Exception:
        logger.warning("CODEF 외부 계정 삭제에 실패했습니다. 로컬 연결을 삭제합니다.")
    if row.kind == "bank":
        allocation.upsert_synced_holdings(
            db, user_id, source="codef", connection_id=row.id, items=[]
        )
    repository.delete_account(db, row)
    db.commit()


def card_summary(rows, result):
    # 외부 원문·행 데이터는 summary에 넣지 않는다. 공용 ImportResult의 키는 camelCase다.
    # 가계부 검사 실패의 row_number는 넘긴 목록 순번이라 그 행의 CODEF 응답 순번으로 바꾼다.
    numbers = getattr(rows, "numbers", None) or range(1, len(rows) + 1)
    failures = [(numbers[error.row_number - 1], None, error.message) for error in result.errors]
    failures += [
        (failure.row_number, failure.field, failure.message)
        for failure in getattr(rows, "failures", [])
    ]
    failures.sort(key=lambda failure: failure[0])
    return {
        "inserted": result.inserted,
        "skippedDuplicates": result.skipped_duplicates,
        "failed": result.failed + getattr(rows, "failed", 0),
        "errors": [
            {"rowNumber": number, "field": field, "message": message}
            for number, field, message in failures[:MAX_SUMMARY_ERRORS]
        ],
    }


def sync_account(db, user_id, data):
    account = require_account(db, user_id, data.account_id)
    connector = get_connector(account.provider)
    if not connector.is_available():
        raise AppError(409, "CONFLICT", "CODEF 키가 설정되지 않았습니다.")
    if account.kind == "card":
        if data.range_start is None:
            raise field_error("from", "시작일을 입력해 주세요.")
        if data.range_end is None:
            raise field_error("to", "종료일을 입력해 주세요.")
        if not 0 <= (data.range_end - data.range_start).days <= 91:
            raise field_error("to", "조회 기간은 시작일 이후 최대 92일입니다.")
    row = repository.create_sync(
        db,
        user_id=user_id,
        account_id=account.id,
        kind="card_approvals" if account.kind == "card" else "bank_balances",
        status="running",
        range_start=data.range_start if account.kind == "card" else None,
        range_end=data.range_end if account.kind == "card" else None,
    )
    db.commit()
    try:
        with db.begin_nested():
            connected_id = decrypt_str(account.connected_id_enc)
            if account.kind == "card":
                rows = connector.fetch_card_approvals(
                    connected_id, account.organization, data.range_start, data.range_end
                )
                result = ledger.import_entries(db, user_id, rows, source="codef", batch_id=row.id)
                row.summary = card_summary(rows, result)
            else:
                items = connector.fetch_bank_balances(connected_id, account.organization)
                result = allocation.upsert_synced_holdings(
                    db, user_id, source="codef", connection_id=account.id, items=items
                )
                row.summary = result.model_dump(mode="json", by_alias=True)
            row.status = "succeeded"
            row.finished_at = now_utc()
            db.flush()
    except Exception as exc:
        row.status = "failed"
        row.finished_at = now_utc()
        row.error_code = exc.result_code if isinstance(exc, CodefError) else "CONNECTOR_FAILED"
        db.commit()
        raise CodefError() from None
    db.commit()
    return Sync.model_validate(row)


def list_syncs(db, user_id, account_id, page):
    if account_id is not None:
        require_account(db, user_id, account_id)
    rows, total = repository.list_syncs(db, user_id, account_id, page)
    return Page[Sync](
        items=[Sync.model_validate(row) for row in rows],
        page=page.page,
        page_size=page.page_size,
        total=total,
    )
