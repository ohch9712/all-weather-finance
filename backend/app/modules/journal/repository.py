from datetime import UTC, datetime, time, timedelta

from sqlalchemy import func, or_, select

from app.core.time import KST
from app.modules.journal.models import Trade, TradeCostSettings, TradeNote


def owned_trade(db, user_id, trade_id):
    return db.scalar(select(Trade).where(Trade.user_id == user_id, Trade.id == trade_id))


def owned_note(db, user_id, note_id):
    return db.scalar(select(TradeNote).where(TradeNote.user_id == user_id, TradeNote.id == note_id))


def all_trades(db, user_id):
    return list(
        db.scalars(
            select(Trade)
            .where(Trade.user_id == user_id)
            .order_by(Trade.traded_at, Trade.created_at, Trade.id)
        )
    )


def trade_page(db, user_id, page, start=None, end=None, symbol=None, side=None):
    query = select(Trade).where(Trade.user_id == user_id)
    if start:
        query = query.where(Trade.traded_at >= datetime.combine(start, time(), KST).astimezone(UTC))
    if end:
        query = query.where(
            Trade.traded_at < datetime.combine(end + timedelta(days=1), time(), KST).astimezone(UTC)
        )
    if symbol:
        query = query.where(
            or_(
                Trade.symbol_code.icontains(symbol, autoescape=True),
                Trade.symbol_name.icontains(symbol, autoescape=True),
            )
        )
    if side:
        query = query.where(Trade.side == side)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = list(
        db.scalars(
            query.order_by(Trade.traded_at.desc(), Trade.created_at.desc(), Trade.id.desc())
            .offset((page.page - 1) * page.page_size)
            .limit(page.page_size)
        )
    )
    return items, total


def note_page(db, user_id, page, trade_id=None, symbol=None, kind=None, start=None, end=None):
    query = select(TradeNote).where(TradeNote.user_id == user_id)
    if trade_id:
        query = query.where(TradeNote.trade_id == trade_id)
    if symbol:
        query = query.where(TradeNote.symbol_code.icontains(symbol, autoescape=True))
    if kind:
        query = query.where(TradeNote.kind == kind)
    if start:
        query = query.where(TradeNote.noted_on >= start)
    if end:
        query = query.where(TradeNote.noted_on <= end)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = list(
        db.scalars(
            query.order_by(
                TradeNote.noted_on.desc(), TradeNote.created_at.desc(), TradeNote.id.desc()
            )
            .offset((page.page - 1) * page.page_size)
            .limit(page.page_size)
        )
    )
    return items, total


def trade_notes(db, user_id, trade_id):
    return list(
        db.scalars(
            select(TradeNote)
            .where(TradeNote.user_id == user_id, TradeNote.trade_id == trade_id)
            .order_by(TradeNote.noted_on.desc(), TradeNote.created_at.desc(), TradeNote.id.desc())
        )
    )


def save(db, item):
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete(db, item):
    db.delete(item)
    db.commit()
    db.expire_all()


def cost_settings(db, user_id):
    return db.scalar(select(TradeCostSettings).where(TradeCostSettings.user_id == user_id))
