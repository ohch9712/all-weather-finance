from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.integrations.llm.status import AiStatus, get_ai_status

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status", response_model=AiStatus)
def ai_status(user: CurrentUser):
    return get_ai_status()
