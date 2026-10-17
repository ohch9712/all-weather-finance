import re
from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from app.api.deps import CurrentUser, DBSession, PageQuery, require_json
from app.core.errors import AppError, field_error
from app.core.schemas import Page
from app.integrations.llm.deps import StructuredLLMDep
from app.modules.imports.registry import register_import_kind
from app.modules.imports.schemas import ImportJobView
from app.modules.ledger import service
from app.modules.ledger.extract import extract_statement
from app.modules.ledger.import_kind import LEDGER_CARD
from app.modules.ledger.repository import EntryFilter
from app.modules.ledger.schemas import (
    CategoryCreate,
    CategoryList,
    CategoryOut,
    CategoryUpdate,
    EntryInput,
    EntryOut,
    EntryPatch,
    MerchantRuleInput,
    MerchantRuleList,
    MerchantRuleOut,
    MerchantRuleSaved,
    MonthlySummary,
    TrendOut,
)
from app.modules.ledger.upload import read_upload

register_import_kind(LEDGER_CARD)

router = APIRouter(prefix="/ledger", tags=["ledger"])

MONTH_PATTERN = re.compile(r"^[1-9]\d{3}-(0[1-9]|1[0-2])$")
KINDS = ("income", "expense")


def query_error(field: str) -> AppError:
    return field_error(field, "형식이 올바르지 않습니다.")


def get_month(month: Annotated[str | None, Query()] = None) -> date:
    """`YYYY-MM` → 그 달 1일. 비어 있으면 이번 달(KST)"""
    if not month:
        return service.current_month()
    if not MONTH_PATTERN.match(month):
        raise query_error("month")
    return date(int(month[:4]), int(month[5:]), 1)


MonthQuery = Annotated[date, Depends(get_month)]


def get_entry_filter(
    month: MonthQuery,
    kind: Annotated[str | None, Query()] = None,
    category_id: Annotated[str | None, Query(alias="categoryId")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    import_batch_id: Annotated[UUID | None, Query(alias="importBatchId")] = None,
) -> EntryFilter:
    # 화면은 빈 필터를 `kind=&categoryId=&q=`로 보내므로 빈 값은 조건 없음으로 본다.
    if kind and kind not in KINDS:
        raise query_error("kind")
    parsed_category = None
    if category_id:
        try:
            parsed_category = UUID(category_id)
        except ValueError as exc:
            raise query_error("categoryId") from exc
    return EntryFilter(
        start=None if import_batch_id else month,
        end=None if import_batch_id else service.month_end(month),
        import_batch_id=import_batch_id,
        kind=kind or None,
        category_id=parsed_category,
        q=(q or "").strip() or None,
    )


# ── 카테고리 ─────────────────────────────────────────────────────────


@router.get("/categories", response_model=CategoryList)
def list_categories(db: DBSession, user: CurrentUser):
    return CategoryList(
        items=[CategoryOut.model_validate(c) for c in service.list_categories(db, user.id)]
    )


@router.post(
    "/categories",
    status_code=201,
    response_model=CategoryOut,
    dependencies=[Depends(require_json)],
)
def create_category(data: CategoryCreate, db: DBSession, user: CurrentUser):
    return service.create_category(db, user.id, data)


@router.patch(
    "/categories/{category_id}", response_model=CategoryOut, dependencies=[Depends(require_json)]
)
def rename_category(category_id: UUID, data: CategoryUpdate, db: DBSession, user: CurrentUser):
    return service.rename_category(db, user.id, category_id, data)


@router.delete("/categories/{category_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_category(category_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_category(db, user.id, category_id)
    return Response(status_code=204)


# ── 내역 ────────────────────────────────────────────────────────────


@router.get("/entries", response_model=Page[EntryOut])
def list_entries(
    db: DBSession,
    user: CurrentUser,
    flt: Annotated[EntryFilter, Depends(get_entry_filter)],
    page: PageQuery,
):
    return service.list_entries(db, user.id, flt, page)


@router.post(
    "/entries", status_code=201, response_model=EntryOut, dependencies=[Depends(require_json)]
)
def create_entry(data: EntryInput, db: DBSession, user: CurrentUser):
    return service.create_entry(db, user.id, data)


@router.get("/entries/{entry_id}", response_model=EntryOut)
def get_entry(entry_id: UUID, db: DBSession, user: CurrentUser):
    return service.get_entry(db, user.id, entry_id)


@router.patch("/entries/{entry_id}", response_model=EntryOut, dependencies=[Depends(require_json)])
def update_entry(entry_id: UUID, data: EntryPatch, db: DBSession, user: CurrentUser):
    return service.update_entry(db, user.id, entry_id, data)


@router.delete("/entries/{entry_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_entry(entry_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_entry(db, user.id, entry_id)
    return Response(status_code=204)


# ── 요약·추이 ────────────────────────────────────────────────────────


@router.get("/summary", response_model=MonthlySummary)
def get_summary(db: DBSession, user: CurrentUser, month: MonthQuery):
    return service.get_monthly_summary(db, user.id, month)


@router.get("/trend", response_model=TrendOut)
def get_trend(
    db: DBSession,
    user: CurrentUser,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
):
    return service.get_trend(db, user.id, months)


@router.get("/merchant-rules", response_model=MerchantRuleList)
def merchant_rules(db: DBSession, user: CurrentUser):
    return MerchantRuleList(
        items=[
            MerchantRuleOut.model_validate(rule)
            for rule in service.list_merchant_rules(db, user.id)
        ]
    )


@router.post(
    "/merchant-rules", response_model=MerchantRuleSaved, dependencies=[Depends(require_json)]
)
def save_rule(data: MerchantRuleInput, db: DBSession, user: CurrentUser):
    return service.save_merchant_rule(db, user.id, data)


@router.delete("/merchant-rules/{rule_id}", status_code=204, dependencies=[Depends(require_json)])
def delete_rule(rule_id: UUID, db: DBSession, user: CurrentUser):
    service.delete_merchant_rule(db, user.id, rule_id)
    return Response(status_code=204)


@router.post("/import/extract", response_model=ImportJobView)
async def extract(request: Request, db: DBSession, user: CurrentUser, llm: StructuredLLMDep):
    upload = await read_upload(request)
    return await run_in_threadpool(extract_statement, db, user.id, upload, llm)
