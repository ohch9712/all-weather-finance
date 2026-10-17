"""자산배분 도메인 서비스. 다른 모듈은 8절 공개 함수만 쓴다(스펙 02 8절, architecture 8절)."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.domain import AgeBand, AssetClass, RiskProfile
from app.core.errors import AppError, field_error
from app.core.schemas import ErrorDetail
from app.core.time import now_utc, today_kst
from app.integrations.brokers.errors import BrokerError
from app.modules.allocation import recommendation as calc
from app.modules.allocation import repository, rules
from app.modules.allocation.classify import classify_holding
from app.modules.allocation.models import (
    AllocationSituation,
    FinancialGoal,
    Holding,
    RiskAssessment,
)
from app.modules.allocation.schemas import (
    AllocationReport,
    ByAssetClass,
    GoalCreate,
    GoalList,
    GoalOut,
    GoalUpdate,
    HoldingCreate,
    HoldingList,
    HoldingOut,
    HoldingSyncResult,
    HoldingSyncSkipped,
    HoldingUpdate,
    LatestAssessmentOut,
    Recommendation,
    RiskAssessmentCreate,
    RiskAssessmentCreated,
    RiskAssessmentOut,
    ScoreItem,
    ScoreList,
    SituationEnvelope,
    SituationIn,
    SituationOut,
    SurveyOption,
    SurveyOut,
    SurveyQuestionOut,
    TargetOut,
    TargetTableCell,
    TargetTableOut,
    TargetTableRow,
)
from app.modules.auth import service as auth_service
from app.modules.market import service as market_service

ORDER = rules.ASSET_CLASS_ORDER

# ── 공개 타입(8절) ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class RiskProfileInfo:
    risk_profile: RiskProfile
    score: Decimal
    assessed_at: datetime


@dataclass(frozen=True)
class TargetAllocation:
    age_band: AgeBand
    risk_profile: RiskProfile
    weights: dict[AssetClass, int]


@dataclass(frozen=True)
class AssetBreakdown:
    included_by_class: dict[AssetClass, int]  # 배분 대상(포함, 금액 > 0) 자산군별 합계. 5개 키 항상
    included_total: int
    excluded_total: int  # 점수 계산에서 뺀 자산 합계(실거주 주택 등)


def validation_error(details: Sequence[tuple[str, str]]) -> AppError:
    """422 VALIDATION_ERROR. 필드가 여럿이거나 위치(`items.0.amount`)가 붙는 경우에 쓴다."""
    return AppError(
        422,
        "VALIDATION_ERROR",
        "입력값을 확인해 주세요.",
        [ErrorDetail(field=field, message=message) for field, message in details],
    )


NOT_FOUND_HOLDING = "보유 자산을 찾을 수 없습니다."
NOT_FOUND_GOAL = "목표를 찾을 수 없습니다."
CHOICE_MESSAGE = "선택지를 다시 골라 주세요."


# ── 공통 문맥 ────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Context:
    today: date
    age_band: AgeBand | None
    assessment: RiskAssessment | None
    situation: AllocationSituation | None
    goals: list[FinancialGoal]
    breakdown: AssetBreakdown


def _breakdown(holdings: Sequence[Holding]) -> AssetBreakdown:
    included = {asset_class: 0 for asset_class in ORDER}
    excluded = 0
    for holding in holdings:
        if not holding.include_in_allocation:
            excluded += holding.amount
        elif holding.amount > 0:
            included[AssetClass(holding.asset_class)] += holding.amount
    return AssetBreakdown(included, sum(included.values()), excluded)


def _context(db: Session, user_id: UUID) -> _Context:
    return _Context(
        today=today_kst(),
        age_band=auth_service.get_profile(db, user_id).age_band,
        assessment=repository.find_latest_assessment(db, user_id),
        situation=repository.find_situation(db, user_id),
        goals=repository.list_goals(db, user_id),
        breakdown=_breakdown(repository.list_holdings(db, user_id)),
    )


def _assessment_data(assessment: RiskAssessment) -> calc.AssessmentData:
    return calc.AssessmentData(
        score=Decimal(assessment.score),
        risk_profile=RiskProfile(assessment.risk_profile),
        answers=assessment.answers,
    )


def _situation_data(situation: AllocationSituation | None) -> calc.SituationData | None:
    if situation is None:
        return None
    return calc.SituationData(
        monthly_expense=situation.monthly_expense,
        dependents=situation.dependents,
        consumer_debt=situation.consumer_debt,
    )


def _goal_data(goal: FinancialGoal) -> calc.GoalData:
    return calc.GoalData(
        id=goal.id,
        goal_type=goal.goal_type,
        title=goal.title,
        target_amount=goal.target_amount,
        target_date=goal.target_date,
        created_at=goal.created_at,
    )


def _income_answer(assessment: RiskAssessment | None) -> int | None:
    return assessment.answers.get("income") if assessment is not None else None


# ── 공개 함수(8절) ───────────────────────────────────────────────────────


def get_latest_risk_profile(db: Session, user_id: UUID) -> RiskProfileInfo | None:
    assessment = repository.find_latest_assessment(db, user_id)
    if assessment is None:
        return None
    return RiskProfileInfo(
        risk_profile=RiskProfile(assessment.risk_profile),
        score=Decimal(assessment.score),
        assessed_at=assessment.created_at,
    )


def get_target_allocation(db: Session, user_id: UUID) -> TargetAllocation:
    """나이대·성향 표 값(5.2). 출생연도·진단이 없으면 409"""
    age_band = auth_service.get_profile(db, user_id).age_band
    if age_band is None:
        raise AppError(409, "PROFILE_INCOMPLETE", "출생연도를 먼저 입력해 주세요.")
    assessment = repository.find_latest_assessment(db, user_id)
    if assessment is None:
        raise AppError(409, "RISK_PROFILE_REQUIRED", "투자성향 진단을 먼저 해 주세요.")
    risk_profile = RiskProfile(assessment.risk_profile)
    return TargetAllocation(
        age_band=age_band,
        risk_profile=risk_profile,
        weights=dict(rules.TARGET_TABLE[age_band][risk_profile]),
    )


def get_recommendation(db: Session, user_id: UUID) -> Recommendation:
    """목표 반영 권장 배분·관리 방향·추천 이유(7.10). 스냅샷을 쓰지 않는다."""
    ctx = _context(db, user_id)
    if ctx.age_band is None:
        return Recommendation(status="needs_profile")
    if ctx.assessment is None:
        return Recommendation(status="needs_assessment")
    return calc.build_recommendation(
        age_band=ctx.age_band,
        assessment=_assessment_data(ctx.assessment),
        situation=_situation_data(ctx.situation),
        goals=[_goal_data(goal) for goal in ctx.goals],
        holdings=ctx.breakdown.included_by_class,
        today=ctx.today,
    )


def get_allocation_report(db: Session, user_id: UUID) -> AllocationReport:
    """배분 리포트(7.7). `ready`면 오늘(KST) 점수 스냅샷을 upsert한다. 커밋은 호출한 쪽이 한다."""
    ctx = _context(db, user_id)
    breakdown = ctx.breakdown
    known: dict[str, Any] = {
        "age_band": ctx.age_band,
        "risk_profile": ctx.assessment.risk_profile if ctx.assessment else None,
        "total_amount": breakdown.included_total,
        "excluded_amount": breakdown.excluded_total,
        "score": None,
        "grade": None,
        "score_delta": None,
        "scored_on": None,
        "classes": None,
    }
    if ctx.age_band is None:
        return AllocationReport(status="needs_profile", **known)
    if ctx.assessment is None:
        return AllocationReport(status="needs_assessment", **known)
    if breakdown.included_total == 0:
        return AllocationReport(status="needs_holdings", **known)

    risk_profile = RiskProfile(ctx.assessment.risk_profile)
    plan = calc.plan_targets(
        base_weights=rules.TARGET_TABLE[ctx.age_band][risk_profile],
        situation=_situation_data(ctx.situation),
        income_answer=_income_answer(ctx.assessment),
        goals=[_goal_data(goal) for goal in ctx.goals],
        total=breakdown.included_total,
        today=ctx.today,
    )
    assert plan.target_amounts is not None
    actual = breakdown.included_by_class
    score = calc.allocation_score(actual, plan.target_amounts, plan.total)
    grade = rules.grade_for_score(score)
    previous = repository.find_previous_score(db, user_id, ctx.today)
    actual_weights = calc.weights_of(actual, plan.total)
    repository.upsert_score(
        db,
        user_id=user_id,
        scored_on=ctx.today,
        values={
            "score": score,
            "grade": grade,
            "total_amount": plan.total,
            "actual_weights": {key.value: float(actual_weights[key]) for key in ORDER},
            "target_weights": {key.value: float(plan.target_weights[key]) for key in ORDER},
            "age_band": ctx.age_band.value,
            "risk_profile": risk_profile.value,
        },
    )
    return AllocationReport(
        status="ready",
        **{
            **known,
            "score": score,
            "grade": grade,
            "score_delta": score - previous.score if previous is not None else None,
            "scored_on": ctx.today,
            "classes": calc.report_classes(plan, actual),
        },
    )


def get_asset_breakdown(db: Session, user_id: UUID) -> AssetBreakdown:
    return _breakdown(repository.list_holdings(db, user_id))


def _refresh_snapshot(db: Session, user_id: UUID) -> None:
    """변경 직후 리포트를 다시 계산한다. `ready`일 때만 스냅샷이 남는다(5.6)."""
    get_allocation_report(db, user_id)


# ── 설문·진단 ────────────────────────────────────────────────────────────


def get_survey() -> SurveyOut:
    return SurveyOut(
        version=rules.SURVEY_VERSION,
        questions=[
            SurveyQuestionOut(
                id=question.id,
                text=question.text,
                options=[
                    SurveyOption(value=index, label=label)
                    for index, label in enumerate(question.options, start=1)
                ],
            )
            for question in rules.SURVEY_QUESTIONS
        ],
    )


def _validate_answers(answers: dict[str, Any]) -> dict[str, int]:
    errors: list[tuple[str, str]] = []
    valid: dict[str, int] = {}
    for question in rules.SURVEY_QUESTIONS:
        value = answers.get(question.id)
        is_int = isinstance(value, int) and not isinstance(value, bool)
        if not is_int or not 1 <= value <= question.option_count:
            errors.append((question.id, CHOICE_MESSAGE))
        else:
            valid[question.id] = value
    errors.extend((key, CHOICE_MESSAGE) for key in answers if key not in rules.QUESTION_BY_ID)
    if errors:
        raise validation_error(errors)
    return valid


def create_risk_assessment(
    db: Session, user_id: UUID, data: RiskAssessmentCreate
) -> RiskAssessmentCreated:
    if data.survey_version != rules.SURVEY_VERSION:
        raise field_error("surveyVersion", "설문이 바뀌었습니다. 새로고침해 주세요.")
    answers = _validate_answers(data.answers)
    score = rules.survey_score(answers)
    assessment = RiskAssessment(
        user_id=user_id,
        survey_version=rules.SURVEY_VERSION,
        answers=answers,
        score=score,
        risk_profile=rules.classify_risk_profile(score).value,
    )
    repository.add(db, assessment)
    _refresh_snapshot(db, user_id)
    db.commit()
    return RiskAssessmentCreated(
        id=assessment.id,
        score=float(score),
        risk_profile=RiskProfile(assessment.risk_profile),
        created_at=assessment.created_at,
    )


def get_latest_assessment(db: Session, user_id: UUID) -> LatestAssessmentOut:
    assessment = repository.find_latest_assessment(db, user_id)
    if assessment is None:
        return LatestAssessmentOut(assessment=None)
    return LatestAssessmentOut(
        assessment=RiskAssessmentOut(
            id=assessment.id,
            score=float(assessment.score),
            risk_profile=RiskProfile(assessment.risk_profile),
            answers=assessment.answers,
            created_at=assessment.created_at,
        )
    )


# ── 권장 배분표 ──────────────────────────────────────────────────────────


def get_target(db: Session, user_id: UUID) -> TargetOut:
    target = get_target_allocation(db, user_id)
    return TargetOut(
        age_band=target.age_band,
        risk_profile=target.risk_profile,
        weights=ByAssetClass[int].of(target.weights),
        risky_weight=rules.risky_weight(target.age_band, target.risk_profile).final,
        explanation=calc.target_explanation(target.age_band, target.risk_profile),
    )


def get_target_table() -> TargetTableOut:
    return TargetTableOut(
        rows=[
            TargetTableRow(
                age_band=age_band,
                cells=[
                    TargetTableCell(
                        risk_profile=risk_profile, weights=ByAssetClass[int].of(weights)
                    )
                    for risk_profile, weights in row.items()
                ],
            )
            for age_band, row in rules.TARGET_TABLE.items()
        ]
    )


# ── 보유 자산 ────────────────────────────────────────────────────────────


def list_holdings(db: Session, user_id: UUID) -> HoldingList:
    return HoldingList(
        items=[HoldingOut.model_validate(item) for item in repository.list_holdings(db, user_id)]
    )


def _new_holding(user_id: UUID, data: HoldingCreate, created_at: datetime) -> Holding:
    return Holding(
        user_id=user_id,
        name=data.name,
        asset_class=data.asset_class.value,
        amount=data.amount,
        include_in_allocation=data.include_in_allocation,
        source="manual",
        memo=data.memo,
        created_at=created_at,
        updated_at=created_at,
    )


def create_holding(db: Session, user_id: UUID, data: HoldingCreate) -> HoldingOut:
    holding = _new_holding(user_id, data, now_utc())
    repository.add(db, holding)
    _refresh_snapshot(db, user_id)
    db.commit()
    return HoldingOut.model_validate(holding)


def _pydantic_message(error: dict[str, Any]) -> str:
    """공통 검증 핸들러(app.core.errors)와 같은 문구 규칙"""
    kind = error["type"]
    if kind == "missing":
        return "필수 항목입니다."
    if kind in {"string_too_short", "string_too_long"}:
        return "길이를 확인해 주세요."
    if kind in {"greater_than", "greater_than_equal", "less_than", "less_than_equal"}:
        return "허용 범위를 벗어났습니다."
    if kind == "value_error":
        return str(error["msg"]).removeprefix("Value error, ")
    return "형식이 올바르지 않습니다."


def bulk_create_holdings(db: Session, user_id: UUID, items: list[Any]) -> HoldingList:
    """1~20개를 한 번에 만든다. 하나라도 틀리면 아무것도 저장하지 않는다(7.6)."""
    if not 1 <= len(items) <= rules.MAX_BULK_HOLDINGS:
        raise field_error("items", "자산은 한 번에 1~20개까지 입력할 수 있어요.")
    parsed: list[HoldingCreate] = []
    errors: list[tuple[str, str]] = []
    for index, item in enumerate(items):
        try:
            parsed.append(HoldingCreate.model_validate(item))
        except ValidationError as exc:
            for error in exc.errors():
                path = ".".join(str(part) for part in (index, *error["loc"]))
                errors.append((f"items.{path}", _pydantic_message(error)))
    if errors:
        raise validation_error(errors)
    # 요청 순서가 생성순으로 남도록 1마이크로초씩 띄운다.
    base = now_utc()
    holdings = [
        _new_holding(user_id, data, base + timedelta(microseconds=index))
        for index, data in enumerate(parsed)
    ]
    repository.add_all(db, holdings)
    _refresh_snapshot(db, user_id)
    db.commit()
    return HoldingList(items=[HoldingOut.model_validate(item) for item in holdings])


def update_holding(db: Session, user_id: UUID, holding_id: UUID, data: HoldingUpdate) -> HoldingOut:
    holding = repository.find_holding(db, user_id, holding_id)
    if holding is None:
        raise AppError(404, "NOT_FOUND", NOT_FOUND_HOLDING)
    if holding.connection_id is not None:
        if {"name", "amount"} & data.model_fields_set:
            raise AppError(
                409,
                "CONFLICT",
                "증권사에서 불러온 자산은 금액을 직접 바꿀 수 없어요. 다시 동기화해 주세요.",
            )
        if "asset_class" in data.model_fields_set and data.asset_class != holding.asset_class:
            holding.class_override = True
    for name in data.model_fields_set:
        value = getattr(data, name)
        setattr(holding, name, value.value if isinstance(value, AssetClass) else value)
    db.flush()
    _refresh_snapshot(db, user_id)
    db.commit()
    return HoldingOut.model_validate(holding)


def delete_holding(db: Session, user_id: UUID, holding_id: UUID) -> None:
    holding = repository.find_holding(db, user_id, holding_id)
    if holding is None:
        raise AppError(404, "NOT_FOUND", NOT_FOUND_HOLDING)
    repository.remove(db, holding)
    _refresh_snapshot(db, user_id)
    db.commit()


# ── 상황 ─────────────────────────────────────────────────────────────────


def _situation_out(
    situation: AllocationSituation, assessment: RiskAssessment | None
) -> SituationOut:
    months = calc.emergency_months(situation.dependents, _income_answer(assessment))
    return SituationOut(
        monthly_expense=situation.monthly_expense,
        dependents=situation.dependents,
        consumer_debt=situation.consumer_debt,
        emergency_months=months,
        emergency_target=situation.monthly_expense * months,
        updated_at=situation.updated_at,
    )


def get_situation(db: Session, user_id: UUID) -> SituationEnvelope:
    situation = repository.find_situation(db, user_id)
    if situation is None:
        return SituationEnvelope(situation=None)
    return SituationEnvelope(
        situation=_situation_out(situation, repository.find_latest_assessment(db, user_id))
    )


def put_situation(db: Session, user_id: UUID, data: SituationIn) -> SituationOut:
    situation = repository.find_situation(db, user_id)
    if situation is None:
        now = now_utc()
        situation = AllocationSituation(user_id=user_id, created_at=now, updated_at=now)
        db.add(situation)
    situation.monthly_expense = data.monthly_expense
    situation.dependents = data.dependents
    situation.consumer_debt = data.consumer_debt
    db.flush()
    _refresh_snapshot(db, user_id)
    db.commit()
    return _situation_out(situation, repository.find_latest_assessment(db, user_id))


# ── 목표 ─────────────────────────────────────────────────────────────────


def _goal_out(goal: FinancialGoal, today: date) -> GoalOut:
    return GoalOut(
        id=goal.id,
        goal_type=goal.goal_type,
        title=goal.title,
        target_amount=goal.target_amount,
        target_date=goal.target_date,
        horizon=calc.goal_horizon(goal.target_date, today),
        created_at=goal.created_at,
        updated_at=goal.updated_at,
    )


def list_goals(db: Session, user_id: UUID) -> GoalList:
    today = today_kst()
    return GoalList(items=[_goal_out(goal, today) for goal in repository.list_goals(db, user_id)])


def create_goal(db: Session, user_id: UUID, data: GoalCreate) -> GoalOut:
    if repository.count_goals(db, user_id) >= rules.MAX_GOALS:
        raise field_error("goals", "목표는 10개까지 만들 수 있어요.")
    now = now_utc()
    goal = FinancialGoal(
        user_id=user_id,
        goal_type=data.goal_type,
        title=data.title or rules.GOAL_TYPE_LABEL[data.goal_type],
        target_amount=data.target_amount,
        target_date=data.target_date,
        created_at=now,
        updated_at=now,
    )
    repository.add(db, goal)
    _refresh_snapshot(db, user_id)
    db.commit()
    return _goal_out(goal, today_kst())


def update_goal(db: Session, user_id: UUID, goal_id: UUID, data: GoalUpdate) -> GoalOut:
    goal = repository.find_goal(db, user_id, goal_id)
    if goal is None:
        raise AppError(404, "NOT_FOUND", NOT_FOUND_GOAL)
    fields = data.model_fields_set
    for name in ("goal_type", "target_amount", "target_date"):
        if name in fields:
            setattr(goal, name, getattr(data, name))
    if "title" in fields:
        goal.title = data.title or rules.GOAL_TYPE_LABEL[goal.goal_type]
    db.flush()
    _refresh_snapshot(db, user_id)
    db.commit()
    return _goal_out(goal, today_kst())


def delete_goal(db: Session, user_id: UUID, goal_id: UUID) -> None:
    goal = repository.find_goal(db, user_id, goal_id)
    if goal is None:
        raise AppError(404, "NOT_FOUND", NOT_FOUND_GOAL)
    repository.remove(db, goal)
    _refresh_snapshot(db, user_id)
    db.commit()


# ── 점수 이력 ────────────────────────────────────────────────────────────


def list_scores(db: Session, user_id: UUID, days: int) -> ScoreList:
    since = today_kst() - timedelta(days=days - 1)
    return ScoreList(
        items=[
            ScoreItem(scored_on=row.scored_on, score=row.score, grade=row.grade)
            for row in repository.list_scores(db, user_id, since)
        ]
    )


@dataclass(frozen=True)
class SyncedHolding:
    external_ref: str
    name: str
    amount: int
    asset_class: AssetClass | None = None


def upsert_synced_holdings(
    db: Session,
    user_id: UUID,
    *,
    source: Literal["kiwoom", "toss", "codef", "mock"],
    connection_id: UUID,
    items: list[SyncedHolding],
) -> HoldingSyncResult:
    """연결 단위 잔고와 점수를 갱신한다. commit은 호출자가 한다."""
    if source not in {"kiwoom", "toss", "codef", "mock"}:
        raise field_error("source", "지원하지 않는 자산 원천입니다.")
    seen: set[str] = set()
    for index, item in enumerate(items):
        if type(item.amount) is not int or item.amount < 0:
            raise field_error(f"items.{index}.amount", "금액은 0 이상 정수로 입력해 주세요.")
        if not item.external_ref or len(item.external_ref) > 64 or item.external_ref in seen:
            raise field_error(
                f"items.{index}.externalRef", "중복되지 않는 1~64자 식별값이 필요합니다."
            )
        if not item.name.strip() or len(item.name) > 50:
            raise field_error(f"items.{index}.name", "이름은 1~50자로 입력해 주세요.")
        seen.add(item.external_ref)
    synced_at = now_utc()
    existing = {
        row.external_ref: row for row in repository.list_synced_holdings(db, user_id, connection_id)
    }
    created = updated = 0
    for item in items:
        asset_class = item.asset_class or classify_holding(item.name)[0]
        row = existing.pop(item.external_ref, None)
        if row is None:
            row = Holding(
                user_id=user_id,
                connection_id=connection_id,
                external_ref=item.external_ref,
                source=source,
                name=item.name,
                amount=item.amount,
                asset_class=asset_class,
                include_in_allocation=True,
                class_override=False,
                created_at=synced_at,
                updated_at=synced_at,
                synced_at=synced_at,
            )
            db.add(row)
            created += 1
        else:
            row.name = item.name
            row.amount = item.amount
            row.synced_at = synced_at
            if not row.class_override:
                row.asset_class = asset_class
            updated += 1
    for row in existing.values():
        db.delete(row)
    db.flush()
    _refresh_snapshot(db, user_id)
    db.flush()
    return HoldingSyncResult(
        created=created,
        updated=updated,
        removed=len(existing),
        synced_at=synced_at,
    )


def sync_holdings(db: Session, user_id: UUID, connection_id: UUID) -> HoldingSyncResult:
    broker = market_service.get_user_broker_client(db, user_id, connection_id)
    connection = next(
        (row for row in market_service.list_connections(db, user_id) if row.id == connection_id),
        None,
    )
    if connection is None:
        raise AppError(404, "NOT_FOUND", "증권사 연결을 찾을 수 없습니다.")
    try:
        snapshot = broker.get_holdings()
    except BrokerError as exc:
        raise exc.as_app_error() from None
    items: list[SyncedHolding] = []
    skipped: list[HoldingSyncSkipped] = []
    for row in snapshot.holdings:
        if row.eval_amount is None:
            skipped.append(
                HoldingSyncSkipped(name=row.name, reason="원화 평가금액이 없어 건너뛰었습니다.")
            )
        else:
            items.append(
                SyncedHolding(external_ref=row.code, name=row.name[:50], amount=row.eval_amount)
            )
    if snapshot.cash_krw is not None:
        items.append(
            SyncedHolding(
                external_ref="__cash__",
                name=f"예수금({connection.label})",
                amount=snapshot.cash_krw,
                asset_class=AssetClass.CASH,
            )
        )
    result = upsert_synced_holdings(
        db, user_id, source=connection.provider, connection_id=connection_id, items=items
    )
    result.skipped = skipped
    db.commit()
    return result
