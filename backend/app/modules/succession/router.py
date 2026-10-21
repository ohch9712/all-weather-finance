from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.modules.succession import service
from app.modules.succession.calculations import life_expectancy
from app.modules.succession.privacy import install_access_log_filter
from app.modules.succession.rules.kr_2026_05_10 import DEFAULT_ASSUMPTIONS
from app.modules.succession.rules.kr_2026_05_10 import RULES_2026_05_10 as RULES
from app.modules.succession.schemas import (
    Assumptions,
    CaseEnvelope,
    CaseSave,
    Health,
    LifeExpectancyInfo,
    ParentRole,
    RulesInfo,
    SuccessionInput,
    SuccessionResult,
)

router = APIRouter(prefix="/succession", tags=["succession"])
JSON = [Depends(require_json)]
install_access_log_filter()


@router.get("/case", response_model=CaseEnvelope)
def get_case(db: DBSession, user: CurrentUser):
    return service.get_case(db, user.id)


@router.put("/case", response_model=CaseEnvelope, dependencies=JSON)
def save_case(data: CaseSave, db: DBSession, user: CurrentUser):
    return service.save_case(db, user.id, data)


@router.delete("/case", status_code=204, dependencies=JSON)
def delete_case(db: DBSession, user: CurrentUser):
    service.delete_case(db, user.id)
    return Response(status_code=204)


@router.delete("/case/sensitive", response_model=CaseEnvelope, dependencies=JSON)
def withdraw_consent(db: DBSession, user: CurrentUser):
    return service.withdraw_consent(db, user.id)


@router.get("/life-expectancy", response_model=LifeExpectancyInfo)
def get_life_expectancy(
    user: CurrentUser,
    role: ParentRole,
    age: Annotated[int, Query(ge=40, le=110)],
    health: Health | None = None,
):
    return life_expectancy(role, age, health)


@router.post("/plans", response_model=SuccessionResult, dependencies=JSON)
def compare_plans(data: SuccessionInput, user: CurrentUser):
    return service.compare_plans(data)


@router.get("/rules", response_model=RulesInfo)
def rules(user: CurrentUser):
    return {
        "version": RULES.version,
        "effectiveFrom": RULES.effective_from,
        "sources": [{"label": label, "url": url} for label, url in RULES.sources],
        "lifeTable": [
            {"age": age, "father": father, "mother": mother}
            for age, father, mother in zip(
                RULES.life_table_ages,
                RULES.life_table["father"],
                RULES.life_table["mother"],
                strict=True,
            )
        ],
        "healthFactors": RULES.health_factors,
        "acquisitionRates": [
            {
                "code": rate.code,
                "label": rate.label,
                "acquisitionRate": rate.acquisition,
                "educationRate": rate.education,
                "ruralRate": rate.rural,
            }
            for rate in RULES.acquisition_rates.values()
        ],
        "capitalGainsBrackets": [
            {"upTo": b.up_to, "rate": b.rate, "progressiveDeduction": b.progressive_deduction}
            for b in RULES.capital_gains_brackets
        ],
        "defaults": Assumptions(**DEFAULT_ASSUMPTIONS),
    }
