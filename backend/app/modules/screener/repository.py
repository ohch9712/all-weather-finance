from sqlalchemy import func, select, text

from app.modules.screener.models import SavedScreen


def list_saved(db, user_id):
    return list(
        db.scalars(
            select(SavedScreen)
            .where(SavedScreen.user_id == user_id)
            .order_by(SavedScreen.created_at.desc(), SavedScreen.id)
        )
    )


def lock_user_screens(db, user_id):
    # 사용자별 생성 요청을 직렬화해 동시에 저장해도 20개 상한을 지킨다.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": user_id.int % (2**63 - 1)})


def count_saved(db, user_id):
    return db.scalar(
        select(func.count()).select_from(SavedScreen).where(SavedScreen.user_id == user_id)
    )


def get_saved(db, user_id, screen_id):
    return db.scalar(
        select(SavedScreen).where(SavedScreen.user_id == user_id, SavedScreen.id == screen_id)
    )


def create_saved(db, **values):
    row = SavedScreen(**values)
    db.add(row)
    db.flush()
    return row


def delete_saved(db, row):
    db.delete(row)
    db.flush()
