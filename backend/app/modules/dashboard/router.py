from fastapi import APIRouter

from app.api.deps import CurrentUser, DBSession
from app.modules.dashboard import service
from app.modules.dashboard.schemas import DashboardSummary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(user: CurrentUser, db: DBSession):
    """홈 카드 데이터를 한 번에 돌려준다. 섹션 하나가 실패해도 200이다(스펙 16 3절)."""
    return service.get_summary(db, user.id, user.email)
