"""홈 대시보드 응답(스펙 16 3절). 다른 모듈의 공개 함수 반환값에서 카드에 필요한 값만 담는다."""

from datetime import date
from typing import Literal
from uuid import UUID

from app.core.domain import AssetClass
from app.core.schemas import CamelModel
from app.modules.allocation.schemas import DirectionKind, Grade, ReportStatus
from app.modules.journal.schemas import Currency
from app.modules.learn.schemas import PostSummary
from app.modules.watchlist.schemas import Provider

SectionName = Literal[
    "allocation", "ledger", "journal", "watchlist", "estate", "learn", "chat", "checklist"
]
ChecklistKey = Literal["risk_assessment", "situation", "holdings", "ledger_entry", "watchlist"]


class AllocationClass(CamelModel):
    asset_class: AssetClass
    actual_weight: float
    target_weight: float


class TopDirection(CamelModel):
    kind: DirectionKind
    title: str
    body: str
    href: str


class AllocationSection(CamelModel):
    status: ReportStatus
    score: int | None
    grade: Grade | None
    score_delta: int | None
    classes: list[AllocationClass] | None
    top_direction: TopDirection | None


class LedgerCategory(CamelModel):
    name: str
    amount: int
    ratio: float


class LedgerSection(CamelModel):
    month: str
    income_total: int
    expense_total: int
    expense_change_rate: float | None  # 전월 지출이 0이면 null
    top_categories: list[LedgerCategory]


class RealizedPnl(CamelModel):
    currency: Currency
    realized_pnl: str


class JournalSection(CamelModel):
    month_realized_pnl: list[RealizedPnl]
    win_rate: float | None
    open_position_count: int


class WatchlistEntry(CamelModel):
    code: str
    name: str
    price: str | None
    change_rate: float | None


class WatchlistSection(CamelModel):
    items: list[WatchlistEntry]
    source: Provider | None


class EstateMember(CamelModel):
    member_id: UUID
    display_name: str
    available: int
    next_reset_on: date | None


class EstateSection(CamelModel):
    members: list[EstateMember]


class LearnSection(CamelModel):
    today: PostSummary | None
    read_count: int
    published_count: int


class ChatSection(CamelModel):
    enabled: bool
    location: Literal["local", "cloud"] | None


class ChecklistItem(CamelModel):
    key: ChecklistKey
    label: str
    done: bool
    href: str


class SectionError(CamelModel):
    section: SectionName
    code: str


class DashboardSummary(CamelModel):
    greeting_name: str
    allocation: AllocationSection | None
    ledger: LedgerSection | None
    journal: JournalSection | None
    watchlist: WatchlistSection | None
    estate: EstateSection | None
    learn: LearnSection | None
    chat: ChatSection
    checklist: list[ChecklistItem]
    errors: list[SectionError]
