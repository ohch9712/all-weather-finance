from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, PageQuery, require_json
from app.core.schemas import Page
from app.modules.journal import service
from app.modules.journal.schemas import (
    CostEstimate,
    CostEstimateInput,
    CostSettings,
    CostSettingsInput,
    Kind,
    NoteInput,
    NoteOut,
    NotePatch,
    Positions,
    Side,
    TradeDetail,
    TradeInput,
    TradeOut,
    TradePatch,
    TradeStats,
)

router = APIRouter(prefix="/journal", tags=["journal"])
Start = Annotated[date | None, Query(alias="from")]
End = Annotated[date | None, Query(alias="to")]


@router.get("/trades", response_model=Page[TradeOut])
def trades(
    db: DBSession,
    user: CurrentUser,
    page: PageQuery,
    start: Start = None,
    end: End = None,
    symbol: str | None = None,
    side: Side | None = None,
):
    return service.list_trades(db, user.id, page, start=start, end=end, symbol=symbol, side=side)


@router.post(
    "/trades", status_code=201, response_model=TradeOut, dependencies=[Depends(require_json)]
)
def create_trade(data: TradeInput, db: DBSession, user: CurrentUser):
    return service.create_trade(db, user.id, data)


@router.get("/trades/{trade_id}", response_model=TradeDetail)
def trade_detail(trade_id: UUID, db: DBSession, user: CurrentUser):
    return service.get_detail(db, user.id, trade_id)


@router.patch("/trades/{trade_id}", response_model=TradeOut, dependencies=[Depends(require_json)])
def update_trade(trade_id: UUID, data: TradePatch, db: DBSession, user: CurrentUser):
    return service.update_trade(db, user.id, trade_id, data.model_dump(exclude_unset=True))


@router.delete("/trades/{trade_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_trade(trade_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_trade(db, user.id, trade_id)
    return Response(status_code=204)


@router.get("/positions", response_model=Positions)
def positions(
    db: DBSession,
    user: CurrentUser,
    include_closed: Annotated[bool, Query(alias="includeClosed")] = False,
):
    return Positions(items=service.get_positions(db, user.id, include_closed=include_closed))


@router.get("/stats", response_model=TradeStats)
def stats(db: DBSession, user: CurrentUser, start: Start = None, end: End = None):
    return service.get_trade_stats(db, user.id, start, end)


@router.get("/notes", response_model=Page[NoteOut])
def notes(
    db: DBSession,
    user: CurrentUser,
    page: PageQuery,
    trade_id: Annotated[UUID | None, Query(alias="tradeId")] = None,
    symbol: str | None = None,
    kind: Kind | None = None,
    start: Start = None,
    end: End = None,
):
    return service.list_notes(
        db, user.id, page, trade_id=trade_id, symbol=symbol, kind=kind, start=start, end=end
    )


@router.post(
    "/notes", status_code=201, response_model=NoteOut, dependencies=[Depends(require_json)]
)
def create_note(data: NoteInput, db: DBSession, user: CurrentUser):
    return service.create_note(db, user.id, data)


@router.patch("/notes/{note_id}", response_model=NoteOut, dependencies=[Depends(require_json)])
def update_note(note_id: UUID, data: NotePatch, db: DBSession, user: CurrentUser):
    return service.update_note(db, user.id, note_id, data.model_dump(exclude_unset=True))


@router.delete("/notes/{note_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_note(note_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_note(db, user.id, note_id)
    return Response(status_code=204)


@router.get("/cost-settings", response_model=CostSettings)
def cost_settings(db: DBSession, user: CurrentUser):
    return service.get_cost_settings(db, user.id)


@router.put("/cost-settings", response_model=CostSettings, dependencies=[Depends(require_json)])
def save_cost_settings(data: CostSettingsInput, db: DBSession, user: CurrentUser):
    return service.save_cost_settings(db, user.id, data)


@router.delete("/cost-settings", response_model=CostSettings, dependencies=[Depends(require_json)])
def reset_cost_settings(db: DBSession, user: CurrentUser):
    return service.reset_cost_settings(db, user.id)


@router.get("/cost-estimate", response_model=CostEstimate)
def cost_estimate(data: Annotated[CostEstimateInput, Query()], db: DBSession, user: CurrentUser):
    return service.get_cost_estimate(db, user.id, data)
