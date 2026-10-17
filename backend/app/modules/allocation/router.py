from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.modules.allocation import service
from app.modules.allocation.schemas import (
    AllocationReport,
    GoalCreate,
    GoalList,
    GoalOut,
    GoalUpdate,
    HoldingBulkCreate,
    HoldingCreate,
    HoldingList,
    HoldingOut,
    HoldingSyncRequest,
    HoldingSyncResult,
    HoldingUpdate,
    LatestAssessmentOut,
    Recommendation,
    RiskAssessmentCreate,
    RiskAssessmentCreated,
    ScoreList,
    SituationEnvelope,
    SituationIn,
    SituationOut,
    SurveyOut,
    TargetOut,
    TargetTableOut,
)

router = APIRouter(prefix="/allocation", tags=["allocation"])
JSON_BODY = [Depends(require_json)]


# ── 설문·진단 ────────────────────────────────────────────────────────────


@router.get("/survey", response_model=SurveyOut)
def get_survey(user: CurrentUser):
    return service.get_survey()


@router.post(
    "/risk-assessments",
    status_code=201,
    response_model=RiskAssessmentCreated,
    dependencies=JSON_BODY,
)
def create_risk_assessment(data: RiskAssessmentCreate, db: DBSession, user: CurrentUser):
    return service.create_risk_assessment(db, user.id, data)


@router.get("/risk-assessments/latest", response_model=LatestAssessmentOut)
def get_latest_assessment(db: DBSession, user: CurrentUser):
    return service.get_latest_assessment(db, user.id)


# ── 권장 배분 ────────────────────────────────────────────────────────────


@router.get("/target", response_model=TargetOut)
def get_target(db: DBSession, user: CurrentUser):
    return service.get_target(db, user.id)


@router.get("/targets/table", response_model=TargetTableOut)
def get_target_table(user: CurrentUser):
    return service.get_target_table()


@router.get("/recommendation", response_model=Recommendation)
def get_recommendation(db: DBSession, user: CurrentUser):
    return service.get_recommendation(db, user.id)


# ── 보유 자산 ────────────────────────────────────────────────────────────


@router.get("/holdings", response_model=HoldingList)
def list_holdings(db: DBSession, user: CurrentUser):
    return service.list_holdings(db, user.id)


@router.post("/holdings", status_code=201, response_model=HoldingOut, dependencies=JSON_BODY)
def create_holding(data: HoldingCreate, db: DBSession, user: CurrentUser):
    return service.create_holding(db, user.id, data)


@router.post("/holdings/bulk", status_code=201, response_model=HoldingList, dependencies=JSON_BODY)
def bulk_create_holdings(data: HoldingBulkCreate, db: DBSession, user: CurrentUser):
    return service.bulk_create_holdings(db, user.id, data.items)


@router.post("/holdings/sync", response_model=HoldingSyncResult, dependencies=JSON_BODY)
def sync_holdings(data: HoldingSyncRequest, db: DBSession, user: CurrentUser):
    return service.sync_holdings(db, user.id, data.connection_id)


@router.patch("/holdings/{holding_id}", response_model=HoldingOut, dependencies=JSON_BODY)
def update_holding(holding_id: UUID, data: HoldingUpdate, db: DBSession, user: CurrentUser):
    return service.update_holding(db, user.id, holding_id, data)


@router.delete("/holdings/{holding_id}", status_code=204, dependencies=JSON_BODY)
def delete_holding(holding_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_holding(db, user.id, holding_id)
    return Response(status_code=204)


# ── 리포트·점수 ──────────────────────────────────────────────────────────


@router.get("/report", response_model=AllocationReport)
def get_report(db: DBSession, user: CurrentUser):
    report = service.get_allocation_report(db, user.id)
    db.commit()  # ready면 오늘 스냅샷을 남긴다(5.6)
    return report


@router.get("/scores", response_model=ScoreList)
def list_scores(db: DBSession, user: CurrentUser, days: Annotated[int, Query(ge=1, le=730)] = 180):
    return service.list_scores(db, user.id, days)


# ── 상황·목표 ────────────────────────────────────────────────────────────


@router.get("/situation", response_model=SituationEnvelope)
def get_situation(db: DBSession, user: CurrentUser):
    return service.get_situation(db, user.id)


@router.put("/situation", response_model=SituationOut, dependencies=JSON_BODY)
def put_situation(data: SituationIn, db: DBSession, user: CurrentUser):
    return service.put_situation(db, user.id, data)


@router.get("/goals", response_model=GoalList)
def list_goals(db: DBSession, user: CurrentUser):
    return service.list_goals(db, user.id)


@router.post("/goals", status_code=201, response_model=GoalOut, dependencies=JSON_BODY)
def create_goal(data: GoalCreate, db: DBSession, user: CurrentUser):
    return service.create_goal(db, user.id, data)


@router.patch("/goals/{goal_id}", response_model=GoalOut, dependencies=JSON_BODY)
def update_goal(goal_id: UUID, data: GoalUpdate, db: DBSession, user: CurrentUser):
    return service.update_goal(db, user.id, goal_id, data)


@router.delete("/goals/{goal_id}", status_code=204, dependencies=JSON_BODY)
def delete_goal(goal_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_goal(db, user.id, goal_id)
    return Response(status_code=204)
