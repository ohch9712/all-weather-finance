from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, PageQuery, require_json
from app.core.schemas import Page
from app.integrations.codef.organizations import ORGANIZATIONS
from app.modules.connectors import service
from app.modules.connectors.schemas import (
    Account,
    AccountInput,
    AccountList,
    Kind,
    Organization,
    OrganizationList,
    ProviderList,
    Sync,
    SyncInput,
)

router = APIRouter(prefix="/connectors", tags=["connectors"])


@router.get("/providers", response_model=ProviderList, response_model_exclude_none=True)
def providers(user: CurrentUser):
    return service.providers()


@router.get("/organizations", response_model=OrganizationList)
def organizations(user: CurrentUser, kind: Kind):
    return OrganizationList(
        items=[Organization(code=code, name=name) for code, name in ORGANIZATIONS[kind].items()]
    )


@router.get("/accounts", response_model=AccountList)
def accounts(db: DBSession, user: CurrentUser):
    return service.list_accounts(db, user.id)


@router.post(
    "/accounts", response_model=Account, status_code=201, dependencies=[Depends(require_json)]
)
def register_account(data: AccountInput, db: DBSession, user: CurrentUser):
    return service.register_account(db, user.id, data)


@router.delete("/accounts/{account_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_account(
    account_id: UUID,
    db: DBSession,
    user: CurrentUser,
    local_only: Annotated[bool, Query(alias="localOnly")] = False,
):
    service.delete_account(db, user.id, account_id, local_only=local_only)
    return Response(status_code=204)


@router.post("/sync", response_model=Sync, dependencies=[Depends(require_json)])
def sync(data: SyncInput, db: DBSession, user: CurrentUser):
    return service.sync_account(db, user.id, data)


@router.get("/syncs", response_model=Page[Sync])
def syncs(
    db: DBSession,
    user: CurrentUser,
    page: PageQuery,
    account_id: Annotated[UUID | None, Query(alias="accountId")] = None,
):
    return service.list_syncs(db, user.id, account_id, page)
