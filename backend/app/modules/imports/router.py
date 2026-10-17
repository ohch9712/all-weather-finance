from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, DBSession, require_json
from app.integrations.llm.deps import StructuredLLMDep
from app.modules.imports import service
from app.modules.imports.schemas import (
    CommitRequest,
    ImportJobView,
    KindList,
    MappingRequest,
    Preview,
)
from app.modules.imports.upload import read_upload

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("/kinds", response_model=KindList)
def kinds(user: CurrentUser):
    return service.list_kinds()


@router.post("/jobs", response_model=ImportJobView, status_code=201)
async def create(request: Request, db: DBSession, user: CurrentUser, llm: StructuredLLMDep):
    upload = await read_upload(request)
    return await run_in_threadpool(
        service.create_job,
        db,
        user.id,
        kind_key=upload.kind,
        file_name=upload.file_name,
        data=upload.data,
        sheet_name=upload.sheet_name,
        llm=llm,
    )


@router.get("/jobs/{id}", response_model=ImportJobView)
def get(id: UUID, db: DBSession, user: CurrentUser):
    return service.get_job(db, user.id, id)


@router.put(
    "/jobs/{id}/mapping", response_model=ImportJobView, dependencies=[Depends(require_json)]
)
def mapping(id: UUID, data: MappingRequest, db: DBSession, user: CurrentUser):
    return service.update_mapping(db, user.id, id, data.mapping)


@router.get("/jobs/{id}/preview", response_model=Preview)
def preview(
    id: UUID,
    db: DBSession,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 50,
    only_invalid: Annotated[bool, Query(alias="onlyInvalid")] = False,
):
    return service.get_preview(
        db, user.id, id, page=page, page_size=page_size, only_invalid=only_invalid
    )


@router.post(
    "/jobs/{id}/commit", response_model=ImportJobView, dependencies=[Depends(require_json)]
)
def commit(id: UUID, data: CommitRequest, db: DBSession, user: CurrentUser):
    return service.commit_job(db, user.id, id, skip_invalid=data.skip_invalid)


@router.delete("/jobs/{id}", status_code=204, dependencies=[Depends(require_json)])
def delete(id: UUID, db: DBSession, user: CurrentUser):
    service.delete_job(db, user.id, id)
    return Response(status_code=204)
