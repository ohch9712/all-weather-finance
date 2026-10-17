from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.integrations.llm.deps import get_structured_llm
from app.integrations.llm.structured import StructuredLLM
from app.modules.screener import schemas, service

router = APIRouter(prefix="/screener", tags=["screener"])
LLM = Annotated[StructuredLLM, Depends(get_structured_llm)]


@router.post("/parse", response_model=schemas.ParsedScreen, dependencies=[Depends(require_json)])
def parse(data: schemas.ParseRequest, user: CurrentUser, llm: LLM):
    return service.parse_query(llm, data.query)


@router.post("/run", response_model=schemas.ScreenResult, dependencies=[Depends(require_json)])
def run(data: schemas.RunRequest, user: CurrentUser, db: DBSession):
    return service.run_screen(db, data.filter)


@router.get("/saved", response_model=schemas.SavedList)
def saved(user: CurrentUser, db: DBSession):
    return schemas.SavedList(items=service.list_saved(db, user.id))


@router.post(
    "/saved",
    status_code=201,
    response_model=schemas.SavedScreen,
    dependencies=[Depends(require_json)],
)
def save(data: schemas.SavedCreate, user: CurrentUser, db: DBSession):
    return service.save_screen(db, user.id, data)


@router.delete("/saved/{screen_id}", status_code=204, dependencies=[Depends(require_json)])
def delete(screen_id: UUID, user: CurrentUser, db: DBSession):
    service.delete_saved(db, user.id, screen_id)
    return Response(status_code=204)


@router.get("/broker-conditions", response_model=schemas.BrokerConditionList)
def broker_conditions(
    user: CurrentUser,
    db: DBSession,
    connection_id: Annotated[UUID | None, Query(alias="connectionId")] = None,
):
    return service.list_broker_conditions(db, user.id, connection_id)


@router.post(
    "/broker-conditions/run",
    response_model=schemas.ScreenResult,
    dependencies=[Depends(require_json)],
)
def broker_run(data: schemas.BrokerRun, user: CurrentUser, db: DBSession):
    return service.run_broker_condition(db, user.id, data)
