from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.modules.imports.models import ImportJob


def find(db: Session, user_id: UUID, job_id: UUID, *, lock: bool = False) -> ImportJob | None:
    statement = select(ImportJob).where(ImportJob.id == job_id, ImportJob.user_id == user_id)
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return db.scalar(statement)


def remove_expired(db: Session, user_id: UUID, now: datetime) -> None:
    db.execute(delete(ImportJob).where(ImportJob.user_id == user_id, ImportJob.expires_at <= now))


def add(db: Session, job: ImportJob) -> ImportJob:
    db.add(job)
    db.flush()
    return job


def remove(db: Session, job: ImportJob) -> None:
    db.delete(job)
