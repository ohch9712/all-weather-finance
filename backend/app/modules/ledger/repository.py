from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import Select, case, desc, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import now_utc
from app.modules.ledger.models import LedgerCategory, LedgerEntry, LedgerMerchantRule

# ── 카테고리 ─────────────────────────────────────────────────────────


def visible_to(user_id: UUID):
    """기본 카테고리와 내 카테고리"""
    return or_(LedgerCategory.user_id.is_(None), LedgerCategory.user_id == user_id)


def list_categories(db: Session, user_id: UUID) -> list[LedgerCategory]:
    return list(
        db.scalars(
            select(LedgerCategory)
            .where(visible_to(user_id))
            .order_by(
                LedgerCategory.kind,
                LedgerCategory.user_id.is_not(None),
                LedgerCategory.sort_order,
                LedgerCategory.name,
            )
        )
    )


def find_visible_category(db: Session, user_id: UUID, category_id: UUID) -> LedgerCategory | None:
    return db.scalar(
        select(LedgerCategory).where(LedgerCategory.id == category_id, visible_to(user_id))
    )


def find_default_category(db: Session, kind: str, name: str) -> LedgerCategory | None:
    return db.scalar(
        select(LedgerCategory).where(
            LedgerCategory.user_id.is_(None),
            LedgerCategory.kind == kind,
            LedgerCategory.name == name,
        )
    )


def category_name_taken(
    db: Session, user_id: UUID, kind: str, name: str, exclude_id: UUID | None = None
) -> bool:
    query = select(LedgerCategory.id).where(
        visible_to(user_id), LedgerCategory.kind == kind, LedgerCategory.name == name
    )
    if exclude_id is not None:
        query = query.where(LedgerCategory.id != exclude_id)
    return db.scalar(query.limit(1)) is not None


def move_entries(db: Session, user_id: UUID, from_id: UUID, to_id: UUID) -> None:
    db.execute(
        update(LedgerEntry)
        .where(LedgerEntry.user_id == user_id, LedgerEntry.category_id == from_id)
        .values(category_id=to_id, updated_at=now_utc())
        .execution_options(synchronize_session=False)
    )


# ── 내역 ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class EntryFilter:
    start: date | None
    end: date | None
    kind: str | None = None
    category_id: UUID | None = None
    q: str | None = None
    import_batch_id: UUID | None = None


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(query: Select, user_id: UUID, flt: EntryFilter) -> Select:
    query = query.where(LedgerEntry.user_id == user_id)
    if flt.import_batch_id is not None:
        query = query.where(LedgerEntry.import_batch_id == flt.import_batch_id)
    else:
        query = query.where(
            LedgerEntry.occurred_on >= flt.start, LedgerEntry.occurred_on <= flt.end
        )
    if flt.kind is not None:
        query = query.where(LedgerEntry.kind == flt.kind)
    if flt.category_id is not None:
        query = query.where(LedgerEntry.category_id == flt.category_id)
    if flt.q:
        pattern = f"%{escape_like(flt.q)}%"
        query = query.where(
            or_(
                LedgerEntry.merchant.ilike(pattern, escape="\\"),
                LedgerEntry.memo.ilike(pattern, escape="\\"),
            )
        )
    return query


def count_entries(db: Session, user_id: UUID, flt: EntryFilter) -> int:
    return db.scalar(_filtered(select(func.count(LedgerEntry.id)), user_id, flt)) or 0


def list_entries(
    db: Session, user_id: UUID, flt: EntryFilter, *, offset: int, limit: int
) -> list[LedgerEntry]:
    return list(
        db.scalars(
            _filtered(select(LedgerEntry), user_id, flt)
            .order_by(
                desc(LedgerEntry.occurred_on), desc(LedgerEntry.created_at), desc(LedgerEntry.id)
            )
            .offset(offset)
            .limit(limit)
        )
    )


def find_entry(db: Session, user_id: UUID, entry_id: UUID) -> LedgerEntry | None:
    return db.scalar(
        select(LedgerEntry).where(LedgerEntry.id == entry_id, LedgerEntry.user_id == user_id)
    )


def add(db: Session, entity) -> None:
    db.add(entity)
    db.flush()


def remove(db: Session, entity) -> None:
    db.delete(entity)
    db.flush()


# ── 집계 ────────────────────────────────────────────────────────────


def _in_range(user_id: UUID, start: date, end: date):
    return (
        LedgerEntry.user_id == user_id,
        LedgerEntry.occurred_on >= start,
        LedgerEntry.occurred_on <= end,
    )


def totals_by_month(db: Session, user_id: UUID, start: date, end: date) -> dict[str, dict]:
    """{"YYYY-MM": {"income": 합계, "expense": 합계}}. 내역이 없는 달·종류는 빠진다."""
    month = func.to_char(LedgerEntry.occurred_on, "YYYY-MM").label("month")
    rows = db.execute(
        select(month, LedgerEntry.kind, func.sum(net_amount()))
        .where(*_in_range(user_id, start, end))
        .group_by(month, LedgerEntry.kind)
    )
    result: dict[str, dict] = {}
    for label, kind, total in rows:
        result.setdefault(label, {})[kind] = max(0, int(total))
    return result


def totals_by_category(db: Session, user_id: UUID, start: date, end: date) -> list[tuple]:
    """(category_id, name, kind, 합계)"""
    total = func.sum(net_amount())
    rows = db.execute(
        select(LedgerCategory.id, LedgerCategory.name, LedgerEntry.kind, total)
        .join(LedgerCategory, LedgerCategory.id == LedgerEntry.category_id)
        .where(*_in_range(user_id, start, end))
        .group_by(LedgerCategory.id, LedgerCategory.name, LedgerEntry.kind)
    )
    return [
        (category_id, name, kind, int(amount))
        for category_id, name, kind, amount in rows
        if amount > 0
    ]


def totals_by_day(db: Session, user_id: UUID, start: date, end: date) -> list[tuple]:
    """(날짜, kind, 합계)"""
    rows = db.execute(
        select(LedgerEntry.occurred_on, LedgerEntry.kind, func.sum(net_amount()))
        .where(*_in_range(user_id, start, end))
        .group_by(LedgerEntry.occurred_on, LedgerEntry.kind)
    )
    return [(day, kind, max(0, int(amount))) for day, kind, amount in rows]


def top_expense_merchants(
    db: Session, user_id: UUID, start: date, end: date, limit: int
) -> list[tuple]:
    """(사용처, 합계, 건수). 금액 → 건수 → 이름 순"""
    total = func.sum(net_amount())
    count = func.count(LedgerEntry.id).filter(LedgerEntry.is_cancellation.is_(False))
    rows = db.execute(
        select(LedgerEntry.merchant, total, count)
        .where(
            *_in_range(user_id, start, end),
            LedgerEntry.kind == "expense",
            LedgerEntry.merchant.is_not(None),
        )
        .group_by(LedgerEntry.merchant)
        .having(total > 0)
        .order_by(desc(total), desc(count), LedgerEntry.merchant)
        .limit(limit)
    )
    return [(merchant, int(amount), int(n)) for merchant, amount, n in rows]


def net_amount():
    return case(
        ((LedgerEntry.kind == "expense") & LedgerEntry.is_cancellation, -LedgerEntry.amount),
        else_=LedgerEntry.amount,
    )


def list_rules(db: Session, user_id: UUID) -> list[LedgerMerchantRule]:
    return list(
        db.scalars(
            select(LedgerMerchantRule)
            .where(LedgerMerchantRule.user_id == user_id)
            .order_by(LedgerMerchantRule.merchant_key)
        )
    )


def find_rule(db: Session, user_id: UUID, rule_id: UUID) -> LedgerMerchantRule | None:
    return db.scalar(
        select(LedgerMerchantRule).where(
            LedgerMerchantRule.user_id == user_id, LedgerMerchantRule.id == rule_id
        )
    )


def upsert_rule(db: Session, user_id: UUID, key: str, category_id: UUID) -> LedgerMerchantRule:
    query = insert(LedgerMerchantRule).values(
        user_id=user_id, merchant_key=key, category_id=category_id, updated_at=now_utc()
    )
    rule_id = db.scalar(
        query.on_conflict_do_update(
            index_elements=["user_id", "merchant_key"],
            set_={"category_id": category_id, "updated_at": now_utc()},
        ).returning(LedgerMerchantRule.id)
    )
    return db.scalar(
        select(LedgerMerchantRule)
        .where(LedgerMerchantRule.id == rule_id)
        .execution_options(populate_existing=True)
    )


def imported_entries(db: Session, user_id: UUID) -> list[LedgerEntry]:
    return list(
        db.scalars(
            select(LedgerEntry).where(
                LedgerEntry.user_id == user_id, LedgerEntry.source.in_(["import", "codef"])
            )
        )
    )


def insert_import_entry(db: Session, values: dict) -> bool:
    query = (
        insert(LedgerEntry)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=["user_id", "dedup_hash"],
            index_where=LedgerEntry.dedup_hash.is_not(None),
        )
        .returning(LedgerEntry.id)
    )
    return db.scalar(query) is not None
