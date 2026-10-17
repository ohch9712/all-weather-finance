from sqlalchemy import func, select

from app.modules.connectors.models import ConnectorAccount, ConnectorSync


def list_accounts(db, user_id):
    return db.scalars(
        select(ConnectorAccount)
        .where(ConnectorAccount.user_id == user_id)
        .order_by(ConnectorAccount.created_at.desc(), ConnectorAccount.id)
    ).all()


def get_account(db, user_id, account_id):
    return db.scalar(
        select(ConnectorAccount).where(
            ConnectorAccount.user_id == user_id, ConnectorAccount.id == account_id
        )
    )


def find_account(db, user_id, provider, kind, organization):
    return db.scalar(
        select(ConnectorAccount).where(
            ConnectorAccount.user_id == user_id,
            ConnectorAccount.provider == provider,
            ConnectorAccount.kind == kind,
            ConnectorAccount.organization == organization,
        )
    )


def create_account(db, **values):
    row = ConnectorAccount(**values)
    db.add(row)
    db.flush()
    return row


def delete_account(db, row):
    db.delete(row)
    db.flush()


def create_sync(db, **values):
    row = ConnectorSync(**values)
    db.add(row)
    db.flush()
    return row


def list_syncs(db, user_id, account_id, page):
    filters = [ConnectorSync.user_id == user_id]
    if account_id is not None:
        filters.append(ConnectorSync.account_id == account_id)
    total = db.scalar(select(func.count()).select_from(ConnectorSync).where(*filters)) or 0
    rows = db.scalars(
        select(ConnectorSync)
        .where(*filters)
        .order_by(ConnectorSync.started_at.desc(), ConnectorSync.id)
        .offset((page.page - 1) * page.page_size)
        .limit(page.page_size)
    ).all()
    return rows, total
