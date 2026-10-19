import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.router import router
from app.core.config import get_settings
from app.core.cors import JsonCORSMiddleware
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.integrations.llm.status import get_ai_status

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    status = get_ai_status()
    for scope in ("general", "personal"):
        decision = getattr(status, scope)
        emit = logger.error if decision.reason == "billing_required" else logger.info
        emit(
            "AI 설정: scope=%s provider=%s enabled=%s reason=%s",
            scope,
            decision.provider,
            decision.enabled,
            decision.reason,
        )
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="올웨더 자산관리 API",
        lifespan=lifespan,
        openapi_tags=[
            {"name": name}
            for name in (
                "health",
                "auth",
                "profile",
                "ai",
                "allocation",
                "ledger",
                "imports",
                "journal",
                "estate",
                "learn",
                "market",
                "chat",
                "watchlist",
                "screener",
                "dashboard",
                "connectors",
            )
        ],
    )
    application.add_middleware(
        JsonCORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(application)
    application.include_router(router)
    return application


app = create_app()
