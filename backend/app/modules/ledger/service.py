from calendar import monthrange
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.schemas import Page, PageParams
from app.core.time import today_kst
from app.modules.ledger import repository
from app.modules.ledger.models import LedgerCategory, LedgerEntry
from app.modules.ledger.repository import EntryFilter
from app.modules.ledger.schemas import (
    CategoryAmount,
    CategoryCreate,
    CategoryUpdate,
    DailyAmount,
    EntryInput,
    EntryOut,
    EntryPatch,
    MerchantAmount,
    MonthlySummary,
    MonthTotals,
    TrendOut,
)

# 내 카테고리를 지우면 내역이 옮겨 가는 기본 카테고리
FALLBACK_CATEGORY = {"expense": "기타 지출", "income": "기타 수입"}
KIND_ORDER = {"expense": 0, "income": 1}
TOP_MERCHANT_LIMIT = 5


# ── 달 계산 ──────────────────────────────────────────────────────────


def month_end(start: date) -> date:
    return start.replace(day=monthrange(start.year, start.month)[1])


def shift_month(start: date, months: int) -> date:
    index = start.year * 12 + start.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)


def month_label(start: date) -> str:
    return f"{start.year:04d}-{start.month:02d}"


def current_month() -> date:
    return today_kst().replace(day=1)


def percent(numerator: int, denominator: int) -> float:
    """numerator ÷ denominator × 100을 소수 둘째 자리에서 반올림한다."""
    value = Decimal(numerator) * 100 / Decimal(denominator)
    return float(value.quantize(Decimal("0.01"), ROUND_HALF_UP))


# ── 에러 ────────────────────────────────────────────────────────────


def category_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "카테고리를 찾을 수 없습니다.")


def entry_not_found() -> AppError:
    return AppError(404, "NOT_FOUND", "내역을 찾을 수 없습니다.")


def duplicate_category() -> AppError:
    return AppError(409, "CONFLICT", "이미 있는 카테고리입니다.")


def invalid_category() -> RequestValidationError:
    error = {"type": "value_error", "loc": ("body", "category_id")}
    return RequestValidationError([{**error, "msg": "카테고리를 확인해 주세요."}])


# ── 카테고리 ─────────────────────────────────────────────────────────


def list_categories(db: Session, user_id: UUID) -> list[LedgerCategory]:
    return repository.list_categories(db, user_id)


def _commit_category(db: Session, category: LedgerCategory) -> LedgerCategory:
    try:
        repository.add(db, category)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise duplicate_category() from exc
    return category


def create_category(db: Session, user_id: UUID, data: CategoryCreate) -> LedgerCategory:
    if repository.category_name_taken(db, user_id, data.kind, data.name):
        raise duplicate_category()
    return _commit_category(
        db, LedgerCategory(user_id=user_id, kind=data.kind, name=data.name, sort_order=0)
    )


def _own_category(db: Session, user_id: UUID, category_id: UUID) -> LedgerCategory:
    category = repository.find_visible_category(db, user_id, category_id)
    if category is None:
        raise category_not_found()
    if category.is_default:
        raise AppError(409, "CONFLICT", "기본 카테고리는 수정하거나 삭제할 수 없습니다.")
    return category


def rename_category(
    db: Session, user_id: UUID, category_id: UUID, data: CategoryUpdate
) -> LedgerCategory:
    category = _own_category(db, user_id, category_id)
    if repository.category_name_taken(
        db, user_id, category.kind, data.name, exclude_id=category.id
    ):
        raise duplicate_category()
    category.name = data.name
    return _commit_category(db, category)


def delete_category(db: Session, user_id: UUID, category_id: UUID) -> None:
    """내역을 같은 종류의 "기타 지출"/"기타 수입"으로 옮긴 뒤 지운다. 한 트랜잭션이다."""
    category = _own_category(db, user_id, category_id)
    fallback = repository.find_default_category(db, category.kind, FALLBACK_CATEGORY[category.kind])
    if fallback is None:
        raise RuntimeError("기본 카테고리가 없습니다. 마이그레이션을 확인해 주세요.")
    try:
        repository.move_entries(db, user_id, category.id, fallback.id)
        repository.remove(db, category)
        db.commit()
    except Exception:
        db.rollback()
        raise
    # 일괄 UPDATE로 바뀐 내역이 세션에 예전 카테고리로 남지 않게 한다.
    db.expire_all()


# ── 내역 ────────────────────────────────────────────────────────────


def _category_for(db: Session, user_id: UUID, category_id: UUID, kind: str) -> LedgerCategory:
    category = repository.find_visible_category(db, user_id, category_id)
    if category is None or category.kind != kind:
        raise invalid_category()
    return category


def list_entries(db: Session, user_id: UUID, flt: EntryFilter, page: PageParams) -> Page[EntryOut]:
    total = repository.count_entries(db, user_id, flt)
    entries = repository.list_entries(
        db, user_id, flt, offset=(page.page - 1) * page.page_size, limit=page.page_size
    )
    return Page[EntryOut](
        items=[EntryOut.model_validate(entry) for entry in entries],
        page=page.page,
        page_size=page.page_size,
        total=total,
    )


def get_entry(db: Session, user_id: UUID, entry_id: UUID) -> LedgerEntry:
    entry = repository.find_entry(db, user_id, entry_id)
    if entry is None:
        raise entry_not_found()
    return entry


def create_entry(db: Session, user_id: UUID, data: EntryInput) -> LedgerEntry:
    category = _category_for(db, user_id, data.category_id, data.kind)
    entry = LedgerEntry(
        user_id=user_id,
        kind=data.kind,
        occurred_on=data.occurred_on,
        amount=data.amount,
        category=category,
        merchant=data.merchant,
        payment_method=data.payment_method,
        memo=data.memo,
        source="manual",
    )
    repository.add(db, entry)
    db.commit()
    return entry


def update_entry(db: Session, user_id: UUID, entry_id: UUID, data: EntryPatch) -> LedgerEntry:
    entry = get_entry(db, user_id, entry_id)
    changes = data.model_dump(exclude_unset=True)
    if "kind" in changes or "category_id" in changes:
        # 종류만 바꾸면 지금 카테고리와 종류가 달라져 422가 된다.
        entry.category = _category_for(
            db,
            user_id,
            changes.get("category_id", entry.category_id),
            changes.get("kind", entry.kind),
        )
    for field in ("kind", "occurred_on", "amount", "merchant", "payment_method", "memo"):
        if field in changes:
            setattr(entry, field, changes[field])
    db.commit()
    return entry


def delete_entry(db: Session, user_id: UUID, entry_id: UUID) -> None:
    repository.remove(db, get_entry(db, user_id, entry_id))
    db.commit()


# ── 요약·추이 ────────────────────────────────────────────────────────


def get_monthly_summary(db: Session, user_id: UUID, month: date) -> MonthlySummary:
    """month는 그 달 1일(다른 날이면 그 달로 본다). 15(챗봇)·16(대시보드)이 쓴다."""
    start = month.replace(day=1)
    end = month_end(start)
    previous_start = shift_month(start, -1)
    totals = repository.totals_by_month(db, user_id, previous_start, end)
    current = totals.get(month_label(start), {})
    previous = totals.get(month_label(previous_start), {})
    kind_totals = {"income": current.get("income", 0), "expense": current.get("expense", 0)}
    previous_expense = previous.get("expense", 0)

    by_category = [
        CategoryAmount(
            category_id=category_id,
            name=name,
            kind=kind,
            amount=amount,
            ratio=percent(amount, kind_totals[kind]),
        )
        for category_id, name, kind, amount in sorted(
            repository.totals_by_category(db, user_id, start, end),
            key=lambda row: (KIND_ORDER[row[2]], -row[3], row[1]),
        )
    ]

    days = {start + timedelta(days=i): {"income": 0, "expense": 0} for i in range(end.day)}
    for day, kind, amount in repository.totals_by_day(db, user_id, start, end):
        days[day][kind] = amount

    return MonthlySummary(
        month=month_label(start),
        income_total=kind_totals["income"],
        expense_total=kind_totals["expense"],
        net=kind_totals["income"] - kind_totals["expense"],
        previous=MonthTotals(
            month=month_label(previous_start),
            income_total=previous.get("income", 0),
            expense_total=previous_expense,
        ),
        expense_change_rate=(
            percent(kind_totals["expense"] - previous_expense, previous_expense)
            if previous_expense
            else None
        ),
        by_category=by_category,
        daily=[DailyAmount(date=day, **values) for day, values in days.items()],
        top_merchants=[
            MerchantAmount(merchant=merchant, amount=amount, count=count)
            for merchant, amount, count in repository.top_expense_merchants(
                db, user_id, start, end, TOP_MERCHANT_LIMIT
            )
        ],
    )


def get_trend(db: Session, user_id: UUID, months: int) -> TrendOut:
    """이번 달(KST)을 포함한 최근 months개월. 오래된 달부터, 빈 달은 0"""
    last = current_month()
    first = shift_month(last, -(months - 1))
    totals = repository.totals_by_month(db, user_id, first, month_end(last))
    items = []
    for offset in range(months):
        label = month_label(shift_month(first, offset))
        values = totals.get(label, {})
        items.append(
            MonthTotals(
                month=label,
                income_total=values.get("income", 0),
                expense_total=values.get("expense", 0),
            )
        )
    return TrendOut(items=items)
