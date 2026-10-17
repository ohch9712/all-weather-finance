from app.modules.imports.registry import (
    CommitContext,
    ImportKind,
    RowValidationError,
    TargetField,
)
from app.modules.ledger.categorize import merchant_key
from app.modules.ledger.schemas import MAX_AMOUNT, check_occurred_on
from app.modules.ledger.service import LedgerImportRow, import_entries


def normalize_row(values: dict) -> LedgerImportRow:
    amount = values["amount"]
    if amount == 0:
        raise RowValidationError("amount", "금액이 0입니다.")
    if abs(amount) > MAX_AMOUNT:
        raise RowValidationError("amount", "금액을 확인해 주세요.")
    try:
        check_occurred_on(values["occurredOn"])
    except ValueError as exc:
        raise RowValidationError("occurredOn", str(exc)) from exc
    if not merchant_key(values["merchant"]):
        raise RowValidationError("merchant", "가맹점을 입력해 주세요.")
    for key, limit in (("merchant", 100), ("cardName", 50), ("approvalNo", 30)):
        if values.get(key) and len(values[key]) > limit:
            raise RowValidationError(key, f"{limit}자 이하로 입력해 주세요.")
    return LedgerImportRow(
        occurred_on=values["occurredOn"],
        merchant=values["merchant"],
        amount=abs(amount),
        is_cancellation=amount < 0 or values.get("status") == "cancelled",
        card_name=values.get("cardName"),
        approval_no=values.get("approvalNo"),
        merchant_category=values.get("merchantCategory"),
    )


def commit(db, user_id, rows, ctx: CommitContext):
    return import_entries(db, user_id, rows, source="import", batch_id=ctx.job_id)


LEDGER_CARD = ImportKind(
    key="ledger_card",
    label="카드 이용내역",
    fields=(
        TargetField(
            "occurredOn",
            "이용일",
            "date",
            True,
            (
                "이용일",
                "이용일자",
                "이용일시",
                "거래일",
                "거래일자",
                "거래일시",
                "승인일",
                "승인일자",
                "승인일시",
                "사용일",
                "사용일자",
            ),
        ),
        TargetField(
            "merchant",
            "가맹점",
            "text",
            True,
            (
                "가맹점",
                "가맹점명",
                "이용가맹점",
                "이용하신곳",
                "이용하신 가맹점",
                "사용처",
                "이용처",
                "상호",
                "거래처",
            ),
        ),
        TargetField(
            "amount",
            "금액",
            "amount",
            True,
            ("이용금액", "승인금액", "사용금액", "거래금액", "금액", "결제원금", "매출금액"),
        ),
        TargetField(
            "status",
            "승인/취소",
            "enum",
            False,
            ("상태", "승인구분", "취소여부", "매출구분", "거래구분"),
            enum_values={
                "approved": ("승인", "정상", "매출", "일시불"),
                "cancelled": ("취소", "승인취소", "매출취소", "부분취소"),
            },
        ),
        TargetField(
            "cardName",
            "카드",
            "text",
            False,
            ("카드명", "카드종류", "이용카드", "카드구분", "카드"),
        ),
        TargetField("approvalNo", "승인번호", "text", False, ("승인번호",)),
        TargetField(
            "installment", "할부", "text", False, ("할부", "할부개월", "할부기간", "이용구분")
        ),
        TargetField("merchantCategory", "업종", "text", False, ("업종", "가맹점업종", "업종명")),
    ),
    normalize_row=normalize_row,
    commit=commit,
    llm_hint="한국 신용·체크카드 이용내역 표다. 결제일·결제예정금액 열은 이용일·이용금액이 아니다.",
)
