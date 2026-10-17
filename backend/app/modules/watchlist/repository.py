import hashlib

from sqlalchemy import func, select, text

from app.modules.watchlist.models import WatchlistItem


def user_lock_key(user_id) -> int:
    """사용자별 advisory lock 키(64비트 부호 있는 정수). 다른 모듈과 겹치지 않게 접두를 넣는다."""
    digest = hashlib.blake2b(f"watchlist:{user_id}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big", signed=True)


def lock_user(db, user_id):
    """현재 트랜잭션이 끝날 때까지 이 사용자의 관심종목 쓰기를 직렬화한다."""
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": user_lock_key(user_id)})


def end_transaction(db):
    db.commit()


def list_items(db, user_id, group=None):
    stmt = select(WatchlistItem).where(WatchlistItem.user_id == user_id)
    if group is not None:
        stmt = stmt.where(WatchlistItem.group_name == group)
    return list(db.scalars(stmt))


def group_names(db, user_id):
    return list(
        db.scalars(
            select(WatchlistItem.group_name).where(WatchlistItem.user_id == user_id).distinct()
        )
    )


def owned_item(db, user_id, item_id):
    return db.scalar(
        select(WatchlistItem).where(WatchlistItem.id == item_id, WatchlistItem.user_id == user_id)
    )


def item_by_code(db, user_id, code):
    return db.scalar(
        select(WatchlistItem).where(
            WatchlistItem.user_id == user_id, WatchlistItem.stock_code == code
        )
    )


def count_items(db, user_id):
    return db.scalar(
        select(func.count()).select_from(WatchlistItem).where(WatchlistItem.user_id == user_id)
    )


def next_sort_order(db, user_id, group):
    current = db.scalar(
        select(func.max(WatchlistItem.sort_order)).where(
            WatchlistItem.user_id == user_id, WatchlistItem.group_name == group
        )
    )
    return 0 if current is None else current + 1


def create(db, values):
    item = WatchlistItem(**values)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def save(db, item=None):
    if item is not None:
        db.add(item)
    db.commit()
    if item is not None:
        db.refresh(item)
    return item


def delete(db, item):
    db.delete(item)
    db.commit()
