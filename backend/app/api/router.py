from fastapi import APIRouter

from app.api import ai_status, health
from app.modules.allocation.router import router as allocation_router
from app.modules.auth.router import auth_router, profile_router
from app.modules.chat.router import router as chat_router
from app.modules.connectors.router import router as connectors_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.estate.router import router as estate_router
from app.modules.imports.router import router as imports_router
from app.modules.journal.router import router as journal_router
from app.modules.learn.router import router as learn_router
from app.modules.ledger.router import router as ledger_router
from app.modules.market.router import router as market_router
from app.modules.screener.router import router as screener_router
from app.modules.watchlist.router import router as watchlist_router

router = APIRouter(prefix="/api")
router.include_router(health.router)
router.include_router(auth_router)
router.include_router(profile_router)
router.include_router(ai_status.router)
router.include_router(allocation_router)
router.include_router(ledger_router)
router.include_router(imports_router)
router.include_router(journal_router)
router.include_router(estate_router)
router.include_router(learn_router)
router.include_router(market_router)
router.include_router(chat_router)
router.include_router(watchlist_router)
router.include_router(screener_router)
router.include_router(dashboard_router)
router.include_router(connectors_router)
