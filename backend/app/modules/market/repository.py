from datetime import date

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.time import now_utc
from app.modules.market.models import BrokerConnection, Stock, StockSnapshot


def search_stocks(db, query, limit, market=None):
    query = query.strip()
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    stmt = select(Stock).where(
        Stock.listed,
        or_(
            Stock.code.ilike(f"%{escaped}%", escape="\\"),
            Stock.name.ilike(f"%{escaped}%", escape="\\"),
        ),
    )
    if market:
        stmt = stmt.where(Stock.market == market)
    rank = case(
        (Stock.code == query, 0), (Stock.name.ilike(f"{escaped}%", escape="\\"), 1), else_=2
    )
    return list(db.scalars(stmt.order_by(rank, Stock.name, Stock.code).limit(limit)))


def get_stock(db, code):
    return db.scalar(select(Stock).where(Stock.code == code, Stock.listed))


def latest_date(db):
    return db.scalar(select(func.max(StockSnapshot.as_of)))


def stock_snapshot(db, code):
    return db.scalar(
        select(StockSnapshot)
        .where(StockSnapshot.code == code)
        .order_by(StockSnapshot.as_of.desc())
        .limit(1)
    )


def snapshot_rows(db, as_of):
    return db.execute(
        select(StockSnapshot, Stock)
        .join(Stock, Stock.code == StockSnapshot.code)
        .where(StockSnapshot.as_of == as_of)
        .order_by(Stock.code)
    ).all()


def list_connections(db, user_id):
    return list(
        db.scalars(
            select(BrokerConnection)
            .where(BrokerConnection.user_id == user_id)
            .order_by(BrokerConnection.created_at.desc())
        )
    )


def get_connection(db, user_id, connection_id):
    return db.scalar(
        select(BrokerConnection).where(
            BrokerConnection.id == connection_id, BrokerConnection.user_id == user_id
        )
    )


def create_connection(db, values):
    row = BrokerConnection(**values)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save_connection(db, row):
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_connection(db, row):
    db.delete(row)
    db.commit()


def refresh_stocks(db, rows, source):
    codes = [r.code for r in rows]
    # 다른 공급자의 종목도 현재 수집한 국내 유니버스에서 사라졌다면 비상장으로 표시한다.
    db.execute(
        update(Stock)
        .where(Stock.market.in_(["KOSPI", "KOSDAQ"]), Stock.code.not_in(codes))
        .values(listed=False, updated_at=now_utc())
    )
    for row in rows:
        values = dict(
            code=row.code,
            name=row.name,
            market=row.market,
            sector=row.sector,
            source=source,
            listed=True,
            updated_at=now_utc(),
        )
        db.execute(
            insert(Stock)
            .values(**values)
            .on_conflict_do_update(index_elements=["code"], set_=values)
        )
    db.commit()


def listed_stocks(db, limit=None):
    stmt = (
        select(Stock)
        .where(Stock.listed, Stock.market.in_(["KOSPI", "KOSDAQ"]))
        .order_by(Stock.code)
    )
    return list(db.scalars(stmt.limit(limit) if limit is not None else stmt))


def snapshot_exists(db, as_of, code):
    return db.get(StockSnapshot, (as_of, code)) is not None


def upsert_snapshot(db, values):
    db.execute(
        insert(StockSnapshot)
        .values(**values)
        .on_conflict_do_update(index_elements=["as_of", "code"], set_=values)
    )
    db.commit()


def prune_snapshots(db, before: date):
    result = db.execute(delete(StockSnapshot).where(StockSnapshot.as_of < before))
    db.commit()
    return result.rowcount
