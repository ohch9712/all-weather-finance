from decimal import Decimal, DecimalException, localcontext

from pydantic import ValidationError

from app.modules.imports.registry import CommitContext, ImportKind, RowValidationError, TargetField
from app.modules.journal.schemas import TradeInput
from app.modules.journal.service import TradeImportRow, import_trades, trade_values


def normalize_row(values: dict) -> TradeImportRow:
    price = values.get("price")
    if price is None:
        if values.get("amount") is None:
            raise RowValidationError("price", "단가 또는 거래금액이 필요합니다.")
        if values["quantity"] <= 0:
            raise RowValidationError("quantity", "수량은 0보다 커야 합니다.")
        try:
            with localcontext() as context:
                context.prec = 80
                price = (values["amount"] / values["quantity"]).quantize(Decimal("0.000001"))
        except DecimalException as exc:
            raise RowValidationError("price", "단가를 확인해 주세요.") from exc
    code = values.get("symbolCode") or ""
    market = values.get("market") or ("KRX" if code.isdigit() and len(code) == 6 else "US")
    data = dict(
        traded_on=values["tradedOn"],
        traded_time=values.get("tradedTime"),
        symbol_code=code or "PENDING",
        symbol_name=values["symbolName"],
        side=values["side"],
        quantity=values["quantity"],
        price=price,
        market=market,
        currency=values.get("currency") or ("KRW" if market == "KRX" else "USD"),
        fee=values.get("fee") or Decimal(0),
        tax=values.get("tax") or Decimal(0),
    )
    try:
        validated = TradeInput(**data)
    except ValidationError as exc:
        from app.core.schemas import to_camel

        error = exc.errors()[0]
        raise RowValidationError(
            to_camel(str(error["loc"][0])), "거래 값을 확인해 주세요."
        ) from exc
    normalized = trade_values(validated)
    normalized.pop("account_label")
    normalized.update(symbol_code=code.upper(), fee=values.get("fee"), tax=values.get("tax"))
    return TradeImportRow(**normalized)


def commit(db, user_id, rows, ctx: CommitContext):
    return import_trades(db, user_id, rows, source="import", batch_id=ctx.job_id)


JOURNAL_TRADES = ImportKind(
    key="journal_trades",
    label="매매내역",
    normalize_row=normalize_row,
    commit=commit,
    llm_hint=(
        "종목코드가 없으면 저장할 때 종목명으로 찾습니다. "
        "단가가 없으면 거래금액과 수량이 필요합니다."
    ),
    fields=(
        TargetField(
            "tradedOn",
            "체결일",
            "date",
            True,
            (
                "체결일",
                "체결일자",
                "거래일",
                "거래일자",
                "매매일",
                "매매일자",
                "주문일",
                "주문일자",
                "일자",
            ),
        ),
        TargetField(
            "tradedTime", "체결시각", "text", False, ("체결시간", "체결시각", "시간", "주문시간")
        ),
        TargetField(
            "symbolCode",
            "종목코드",
            "text",
            False,
            ("종목코드", "종목번호", "코드", "티커", "심볼"),
        ),
        TargetField("symbolName", "종목명", "text", True, ("종목명", "종목", "상품명")),
        TargetField(
            "side",
            "매매구분",
            "enum",
            True,
            ("매매구분", "구분", "거래구분", "매수매도", "주문구분"),
            enum_values={
                "buy": ("매수", "매수체결", "현금매수", "신용매수", "BUY"),
                "sell": ("매도", "매도체결", "현금매도", "신용매도", "SELL"),
            },
        ),
        TargetField(
            "quantity", "수량", "decimal", True, ("체결수량", "수량", "거래수량", "주문수량")
        ),
        TargetField(
            "price", "단가", "decimal", False, ("체결단가", "단가", "체결가", "체결가격", "가격")
        ),
        TargetField(
            "amount", "거래금액", "decimal", False, ("체결금액", "거래금액", "정산금액", "금액")
        ),
        TargetField("fee", "수수료", "decimal", False, ("수수료",)),
        TargetField("tax", "세금", "decimal", False, ("세금", "제세금", "거래세", "증권거래세")),
        TargetField(
            "market",
            "시장",
            "enum",
            False,
            ("시장", "시장구분", "거래소"),
            enum_values={
                "KRX": ("KRX", "국내", "코스피", "코스닥", "KOSPI", "KOSDAQ"),
                "US": ("미국", "해외", "NASDAQ", "NYSE", "AMEX"),
            },
        ),
        TargetField(
            "currency",
            "통화",
            "enum",
            False,
            ("통화", "통화코드"),
            enum_values={"KRW": ("KRW", "원"), "USD": ("USD", "달러")},
        ),
    ),
)
