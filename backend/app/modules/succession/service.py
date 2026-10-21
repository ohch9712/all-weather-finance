"""상속·증여(과제): 입력 저장·민감정보 동의와 계산 진입점.

이 모듈의 데이터는 LLM·챗봇 도구로 보내지 않는다. 부모님 건강 상태(민감정보)는 동의한 경우에만
app.core.crypto로 암호화해 health_enc에 두고, data·로그·에러 메시지에는 남기지 않는다.
"""

import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_str, encrypt_str
from app.core.errors import AppError, field_error
from app.core.time import now_utc, today_kst
from app.modules.succession import repository
from app.modules.succession.calculations import calculate_plans, validate_input
from app.modules.succession.models import SuccessionCase
from app.modules.succession.schemas import (
    CaseEnvelope,
    CaseSave,
    SuccessionInput,
    SuccessionResult,
)


def resolve_base_date(req: SuccessionInput) -> SuccessionInput:
    if req.base_date is not None:
        return req
    return req.model_copy(update={"base_date": today_kst()})


def compare_plans(req: SuccessionInput) -> SuccessionResult:
    try:
        return calculate_plans(resolve_base_date(req))
    except ValidationError:
        # 06 계산 입력의 금액 상한(1조 원)을 넘는 중간값이 생긴 경우다.
        raise field_error(
            "assets", "금액이 너무 커 계산할 수 없어요. 재산 금액을 줄여 주세요."
        ) from None


def _envelope(row: SuccessionCase | None) -> CaseEnvelope:
    if row is None:
        return CaseEnvelope(case=None, sensitive_consent_at=None, updated_at=None)
    case = SuccessionInput.model_validate(row.data)
    if row.health_enc and row.sensitive_consent_at:
        health = json.loads(decrypt_str(row.health_enc))
        case.parents = [
            parent.model_copy(update={"health": health.get(parent.role)}) for parent in case.parents
        ]
    return CaseEnvelope(
        case=case, sensitive_consent_at=row.sensitive_consent_at, updated_at=row.updated_at
    )


def get_case(db: Session, user_id: UUID) -> CaseEnvelope:
    return _envelope(repository.find_case(db, user_id))


def save_case(db: Session, user_id: UUID, payload: CaseSave) -> CaseEnvelope:
    case = payload.case
    validate_input(resolve_base_date(case))
    health = {parent.role: parent.health for parent in case.parents if parent.health}
    stripped = case.model_copy(
        update={"parents": [p.model_copy(update={"health": None}) for p in case.parents]}
    )
    row = repository.find_case(db, user_id) or SuccessionCase(user_id=user_id)
    row.data = stripped.model_dump(mode="json", by_alias=True)
    if payload.sensitive_consent:
        row.health_enc = encrypt_str(json.dumps(health)) if health else None
        row.sensitive_consent_at = row.sensitive_consent_at or now_utc()
    else:
        row.health_enc = None
        row.sensitive_consent_at = None
    row.updated_at = now_utc()
    repository.save(db, row)
    db.commit()
    return _envelope(row)


def delete_case(db: Session, user_id: UUID) -> None:
    row = repository.find_case(db, user_id)
    if row is not None:
        repository.remove(db, row)
        db.commit()


def withdraw_consent(db: Session, user_id: UUID) -> CaseEnvelope:
    row = repository.find_case(db, user_id)
    if row is None:
        raise AppError(404, "NOT_FOUND", "저장한 입력이 없어요.")
    row.health_enc = None
    row.sensitive_consent_at = None
    row.updated_at = now_utc()
    repository.save(db, row)
    db.commit()
    return _envelope(row)
