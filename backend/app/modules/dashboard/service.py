"""홈 대시보드(스펙 16). 다른 모듈의 공개 서비스 함수(architecture 8절)로 카드 데이터를 모은다."""

import logging
from collections.abc import Callable
from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import today_kst
from app.integrations.llm import status as llm_status
from app.modules.allocation import service as allocation_service
from app.modules.auth import service as auth_service
from app.modules.dashboard.schemas import (
    AllocationClass,
    AllocationSection,
    ChatSection,
    ChecklistItem,
    ChecklistKey,
    DashboardSummary,
    EstateMember,
    EstateSection,
    JournalSection,
    LearnSection,
    LedgerCategory,
    LedgerSection,
    RealizedPnl,
    SectionError,
    SectionName,
    TopDirection,
    WatchlistEntry,
    WatchlistSection,
)
from app.modules.estate import service as estate_service
from app.modules.journal import service as journal_service
from app.modules.learn import service as learn_service
from app.modules.ledger import service as ledger_service
from app.modules.watchlist import service as watchlist_service
from app.modules.watchlist.schemas import WatchlistItemView

logger = logging.getLogger(__name__)

WATCHLIST_LIMIT = 5
ESTATE_MEMBER_LIMIT = 3
ESTATE_RELATIONS = frozenset({"child", "grandchild"})
# 자녀·손자녀가 부모·조부모에게 받는 증여재산공제(직계존속, 10년 합산)
ESTATE_POOL = "lineal_ascendant"
LEDGER_TOP_CATEGORIES = 3
LEDGER_ACTIVITY_MONTHS = 12

CHECKLIST: tuple[tuple[ChecklistKey, str, str], ...] = (
    ("risk_assessment", "투자성향 진단하기", "/allocation/survey"),
    ("situation", "목표·상황 입력하기", "/allocation/situation"),
    ("holdings", "보유 자산 입력하기", "/allocation/assets"),
    ("ledger_entry", "가계부 첫 기록 남기기", "/ledger"),
    ("watchlist", "관심종목 담기", "/stocks/watchlist"),
)


class _Sections:
    """섹션마다 savepoint를 열어 실행한다. 실패한 섹션만 되돌리고 오류를 모은다(3.1 트랜잭션)."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.errors: list[SectionError] = []

    def attempt[T](self, label: str, fn: Callable[..., T], *args: object) -> tuple[T | None, str]:
        """(결과, 오류 코드). 성공하면 오류 코드는 빈 문자열이다."""
        try:
            with self.db.begin_nested():
                return fn(*args), ""
        except Exception as exc:  # 한 모듈의 실패가 다른 카드를 막지 않게 모두 잡는다
            code = exc.code if isinstance(exc, AppError) else "INTERNAL_ERROR"
            # 예외 메시지에는 개인 데이터가 섞일 수 있어 클래스 이름과 코드만 남긴다.
            logger.warning(
                "대시보드 섹션을 불러오지 못했습니다: section=%s code=%s error=%s",
                label,
                code,
                type(exc).__name__,
            )
            return None, code

    def run[T](self, section: SectionName, fn: Callable[..., T], *args: object) -> T | None:
        value, code = self.attempt(section, fn, *args)
        if code:
            self.errors.append(SectionError(section=section, code=code))
        return value


def get_summary(db: Session, user_id: UUID, email: str) -> DashboardSummary:
    """`GET /api/dashboard/summary`. 섹션을 순서대로 조회하고 끝에 한 번 커밋한다.

    커밋은 `get_allocation_report`가 남긴 오늘 점수 스냅샷을 저장하려는 것이다.
    """
    today = today_kst()
    month_start = today.replace(day=1)
    sections = _Sections(db)

    greeting_name = _greeting_name(sections, db, user_id, email)
    allocation = sections.run("allocation", _allocation, db, user_id)
    ledger = sections.run("ledger", _ledger, db, user_id, month_start)
    journal = sections.run("journal", _journal, db, user_id, month_start, today)
    watch_items = sections.run("watchlist", watchlist_service.list_items, db, user_id)
    estate = sections.run("estate", _estate, db, user_id, today)
    learn = sections.run("learn", _learn, db, user_id, today)
    chat = sections.run("chat", _chat) or ChatSection(enabled=False, location=None)
    checklist = _checklist(sections, db, user_id, watch_items)

    db.commit()
    return DashboardSummary(
        greeting_name=greeting_name,
        allocation=allocation,
        ledger=ledger,
        journal=journal,
        watchlist=_watchlist(watch_items) if watch_items is not None else None,
        estate=estate,
        learn=learn,
        chat=chat,
        checklist=checklist,
        errors=sections.errors,
    )


def _greeting_name(sections: _Sections, db: Session, user_id: UUID, email: str) -> str:
    """닉네임, 없으면 이메일의 `@` 앞부분. 프로필을 못 읽어도 이메일 앞부분으로 인사한다."""
    profile, _ = sections.attempt("greeting", auth_service.get_profile, db, user_id)
    nickname = profile.nickname if profile is not None else None
    return nickname or email.split("@", 1)[0]


def _allocation(db: Session, user_id: UUID) -> AllocationSection:
    # 리포트가 `ready`면 오늘 점수 스냅샷을 upsert한다(커밋은 get_summary가 한다).
    report = allocation_service.get_allocation_report(db, user_id)
    recommendation = allocation_service.get_recommendation(db, user_id)
    directions = sorted(recommendation.directions, key=lambda direction: direction.priority)
    top = directions[0] if directions else None
    classes = (
        [
            AllocationClass(
                asset_class=item.asset_class,
                actual_weight=item.actual_weight,
                target_weight=item.target_weight,
            )
            for item in report.classes
        ]
        if report.status == "ready" and report.classes is not None
        else None
    )
    return AllocationSection(
        status=report.status,
        score=report.score,
        grade=report.grade,
        score_delta=report.score_delta,
        classes=classes,
        top_direction=TopDirection(kind=top.kind, title=top.title, body=top.body, href=top.href)
        if top is not None
        else None,
    )


def _ledger(db: Session, user_id: UUID, month_start: date) -> LedgerSection:
    summary = ledger_service.get_monthly_summary(db, user_id, month_start)
    expenses = sorted(
        (item for item in summary.by_category if item.kind == "expense"),
        key=lambda item: item.amount,
        reverse=True,
    )
    return LedgerSection(
        month=summary.month,
        income_total=summary.income_total,
        expense_total=summary.expense_total,
        expense_change_rate=summary.expense_change_rate,
        top_categories=[
            LedgerCategory(name=item.name, amount=item.amount, ratio=item.ratio)
            for item in expenses[:LEDGER_TOP_CATEGORIES]
        ],
    )


def _journal(db: Session, user_id: UUID, month_start: date, today: date) -> JournalSection:
    stats = journal_service.get_trade_stats(db, user_id, start=month_start, end=today)
    wins = sum(item.win_count for item in stats.by_currency)
    decided = wins + sum(item.loss_count for item in stats.by_currency)
    return JournalSection(
        month_realized_pnl=[
            RealizedPnl(currency=item.currency, realized_pnl=item.realized_pnl)
            for item in stats.by_currency
        ],
        win_rate=round(wins / decided * 100, 2) if decided else None,
        open_position_count=len(journal_service.get_positions(db, user_id)),
    )


def _watchlist(items: list[WatchlistItemView]) -> WatchlistSection:
    return WatchlistSection(
        items=[
            WatchlistEntry(
                code=item.code,
                name=item.name,
                price=str(item.quote.price) if item.quote is not None else None,
                change_rate=item.quote.change_rate if item.quote is not None else None,
            )
            for item in items[:WATCHLIST_LIMIT]
        ],
        source=items[0].source if items else None,
    )


def _estate(db: Session, user_id: UUID, today: date) -> EstateSection:
    members = [
        member
        for member in estate_service.list_members(db, user_id)
        if member.relation in ESTATE_RELATIONS
    ][:ESTATE_MEMBER_LIMIT]
    result = []
    for member in members:
        status = estate_service.get_deduction_status(db, user_id, member.id, today)
        pool = next(pool for pool in status.pools if pool.category == ESTATE_POOL)
        result.append(
            EstateMember(
                member_id=member.id,
                display_name=member.display_name,
                available=pool.available,
                next_reset_on=pool.next_reset_on,
            )
        )
    return EstateSection(members=result)


def _learn(db: Session, user_id: UUID, today: date) -> LearnSection:
    progress = learn_service.get_progress(db, user_id)
    return LearnSection(
        today=learn_service.get_term_of_the_day(db, today),
        read_count=progress.read_count,
        published_count=progress.published_count,
    )


def _chat() -> ChatSection:
    personal = llm_status.get_ai_status().personal
    return ChatSection(enabled=personal.enabled, location=personal.location)


# ── 시작 체크리스트 ─────────────────────────────────────────────────────


def _has_risk_profile(db: Session, user_id: UUID) -> bool:
    return allocation_service.get_latest_risk_profile(db, user_id) is not None


def _has_situation(db: Session, user_id: UUID) -> bool:
    if allocation_service.get_situation(db, user_id).situation is not None:
        return True
    return len(allocation_service.list_goals(db, user_id).items) > 0


def _has_holdings(db: Session, user_id: UUID) -> bool:
    breakdown = allocation_service.get_asset_breakdown(db, user_id)
    return breakdown.included_total + breakdown.excluded_total > 0


def _has_ledger_entry(db: Session, user_id: UUID) -> bool:
    trend = ledger_service.get_trend(db, user_id, LEDGER_ACTIVITY_MONTHS)
    return any(item.income_total > 0 or item.expense_total > 0 for item in trend.items)


def _has_watchlist(db: Session, user_id: UUID, items: list[WatchlistItemView] | None) -> bool:
    # 관심종목 섹션에서 이미 받은 목록을 쓴다. 섹션이 실패했으면 다시 조회한다.
    if items is None:
        items = watchlist_service.list_items(db, user_id)
    return len(items) > 0


def _checklist(
    sections: _Sections,
    db: Session,
    user_id: UUID,
    watch_items: list[WatchlistItemView] | None,
) -> list[ChecklistItem]:
    checks: dict[ChecklistKey, tuple[Callable[..., bool], tuple[object, ...]]] = {
        "risk_assessment": (_has_risk_profile, (db, user_id)),
        "situation": (_has_situation, (db, user_id)),
        "holdings": (_has_holdings, (db, user_id)),
        "ledger_entry": (_has_ledger_entry, (db, user_id)),
        "watchlist": (_has_watchlist, (db, user_id, watch_items)),
    }
    items = []
    for key, label, href in CHECKLIST:
        check, args = checks[key]
        # 판정 함수가 실패하면 그 항목은 미완료로 둔다(errors에는 checklist로 남는다).
        done = sections.run("checklist", check, *args)
        items.append(ChecklistItem(key=key, label=label, done=done is True, href=href))
    return items
