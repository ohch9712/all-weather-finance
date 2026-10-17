from uuid import UUID

from fastapi import APIRouter, Depends, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.modules.watchlist import service
from app.modules.watchlist.schemas import (
    WatchlistCreate,
    WatchlistItemView,
    WatchlistList,
    WatchlistOrder,
    WatchlistPatch,
)

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


@router.get("", response_model=WatchlistList)
def list_watchlist(user: CurrentUser, db: DBSession, group: str | None = None):
    return WatchlistList(
        items=service.list_items(db, user.id, group=group or None),
        groups=service.list_groups(db, user.id),
        source=service.market_source(),
    )


@router.post(
    "", status_code=201, response_model=WatchlistItemView, dependencies=[Depends(require_json)]
)
def add_item(data: WatchlistCreate, user: CurrentUser, db: DBSession):
    return service.add_item(db, user.id, data.code, group_name=data.group_name, memo=data.memo)


@router.put("/order", status_code=204, dependencies=[Depends(require_json)])
def reorder(data: WatchlistOrder, user: CurrentUser, db: DBSession):
    service.reorder(db, user.id, data.group_name, data.ids)
    return Response(status_code=204)


@router.patch("/{item_id}", response_model=WatchlistItemView, dependencies=[Depends(require_json)])
def update_item(item_id: UUID, data: WatchlistPatch, user: CurrentUser, db: DBSession):
    return service.update_item(db, user.id, item_id, data.model_dump(exclude_unset=True))


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_item(item_id: UUID, user: CurrentUser, db: DBSession):
    service.delete_item(db, user.id, item_id)
    return Response(status_code=204)
