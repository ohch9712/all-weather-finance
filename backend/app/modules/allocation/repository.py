"""allocation SQLAlchemy 쿼리. 모든 쿼리를 user_id로 거른다."""

from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.time import now_utc
from app.modules.allocation.models import (
    AllocationScore,
    AllocationSituation,
    FinancialGoal,
    Holding,
    RiskAssessment,
)


def add(db: Session, entity) -> None:
    db.add(entity)
    db.flush()


def add_all(db: Session, entities: list) -> None:
    db.add_all(entities)
    db.flush()


def remove(db: Session, entity) -> None:
    db.delete(entity)
    db.flush()


# ── 진단 ─────────────────────────────────────────────────────────────────


def find_latest_assessment(db: Session, user_id: UUID) -> RiskAssessment | None:
    return db.scalar(
        select(RiskAssessment)
        .where(RiskAssessment.user_id == user_id)
        .order_by(RiskAssessment.created_at.desc())
        .limit(1)
    )


# ── 보유 자산 ────────────────────────────────────────────────────────────


def list_holdings(db: Session, user_id: UUID) -> list[Holding]:
    return list(
        db.scalars(
            select(Holding)
            .where(Holding.user_id == user_id)
            .order_by(Holding.created_at, Holding.id)
        )
    )


def find_holding(db: Session, user_id: UUID, holding_id: UUID) -> Holding | None:
    return db.scalar(select(Holding).where(Holding.id == holding_id, Holding.user_id == user_id))


# ── 상황·목표 ────────────────────────────────────────────────────────────


def find_situation(db: Session, user_id: UUID) -> AllocationSituation | None:
    return db.scalar(select(AllocationSituation).where(AllocationSituation.user_id == user_id))


def list_goals(db: Session, user_id: UUID) -> list[FinancialGoal]:
    return list(
        db.scalars(
            select(FinancialGoal)
            .where(FinancialGoal.user_id == user_id)
            .order_by(FinancialGoal.target_date, FinancialGoal.created_at, FinancialGoal.id)
        )
    )


def count_goals(db: Session, user_id: UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(FinancialGoal).where(FinancialGoal.user_id == user_id)
    )


def find_goal(db: Session, user_id: UUID, goal_id: UUID) -> FinancialGoal | None:
    return db.scalar(
        select(FinancialGoal).where(FinancialGoal.id == goal_id, FinancialGoal.user_id == user_id)
    )


# ── 점수 스냅샷 ──────────────────────────────────────────────────────────


def find_previous_score(db: Session, user_id: UUID, before: date) -> AllocationScore | None:
    """`before`보다 앞선 날 중 가장 최근 스냅샷"""
    return db.scalar(
        select(AllocationScore)
        .where(AllocationScore.user_id == user_id, AllocationScore.scored_on < before)
        .order_by(AllocationScore.scored_on.desc())
        .limit(1)
        .execution_options(populate_existing=True)
    )


def list_scores(db: Session, user_id: UUID, since: date) -> list[AllocationScore]:
    return list(
        db.scalars(
            select(AllocationScore)
            .where(AllocationScore.user_id == user_id, AllocationScore.scored_on >= since)
            .order_by(AllocationScore.scored_on)
            .execution_options(populate_existing=True)
        )
    )


def upsert_score(db: Session, *, user_id: UUID, scored_on: date, values: dict) -> None:
    """사용자·날짜당 한 행. 같은 날 다시 계산하면 값을 덮어쓴다.

    Core INSERT … ON CONFLICT라 세션에 올라온 AllocationScore 객체는 갱신되지 않는다.
    점수 조회 쿼리는 populate_existing으로 다시 읽는다.
    """
    now = now_utc()
    statement = insert(AllocationScore).values(
        user_id=user_id, scored_on=scored_on, created_at=now, updated_at=now, **values
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AllocationScore.user_id, AllocationScore.scored_on],
            set_={**{key: statement.excluded[key] for key in values}, "updated_at": now},
        )
    )
