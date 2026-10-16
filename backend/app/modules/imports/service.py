from datetime import timedelta
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.time import now_utc
from app.integrations.llm.deps import get_structured_llm
from app.integrations.llm.structured import StructuredLLM
from app.modules.imports import repository
from app.modules.imports.mapping import find_header, header_score, preset_for, suggest
from app.modules.imports.models import ImportJob
from app.modules.imports.processing import extract_rows, paginate, validate_rows
from app.modules.imports.readers import cell_string, read_file
from app.modules.imports.registry import CommitContext, get_import_kind, list_import_kinds
from app.modules.imports.schemas import (
    FieldView,
    ImportJobView,
    KindList,
    KindView,
    PresetView,
    Preview,
    ResultView,
    RowErrorView,
)
from app.modules.imports.validation import invalid

HEADER_NOT_FOUND = "표의 제목 행을 찾지 못했습니다. 파일 형식을 확인해 주세요."


def list_kinds() -> KindList:
    return KindList(
        items=[
            KindView(
                key=k.key,
                label=k.label,
                fields=[FieldView.model_validate(f) for f in k.fields],
                presets=[PresetView.model_validate(p) for p in k.presets],
            )
            for k in list_import_kinds()
        ]
    )


def _load(db: Session, user_id: UUID, job_id: UUID, *, lock: bool = False) -> ImportJob:
    job = repository.find(db, user_id, job_id, lock=lock)
    if job is None:
        raise AppError(404, "NOT_FOUND", "업로드 작업을 찾을 수 없습니다.")
    if job.expires_at <= now_utc():
        raise AppError(
            410, "IMPORT_JOB_EXPIRED", "업로드한 지 24시간이 지났습니다. 파일을 다시 올려 주세요."
        )
    return job


def _ensure_uncommitted(job: ImportJob) -> None:
    if job.status == "committed":
        raise AppError(409, "CONFLICT", "이미 저장한 업로드입니다.")


def _ensure_mapped(job: ImportJob) -> None:
    _ensure_uncommitted(job)
    if job.status != "mapped":
        raise AppError(409, "CONFLICT", "열 매핑을 먼저 확정해 주세요.")


def _view(job: ImportJob, preview: Preview | None = None) -> ImportJobView:
    kind = get_import_kind(job.kind)
    if job.status == "mapped" and preview is None:
        preview_rows, _ = validate_rows(job.rows, job.mapping, kind)
        preview = paginate(preview_rows, 1, 50, False)
    result = ResultView.model_validate(job.result) if job.result is not None else None
    row_count = (
        len(job.rows)
        if result is None
        else result.inserted + result.skipped_duplicates + result.failed
    )
    preset = preset_for([c["header"] for c in job.columns], kind)
    return ImportJobView(
        id=job.id,
        kind=job.kind,
        status=job.status,
        file_name=job.file_name,
        file_type=job.file_type,
        sheet_names=job.sheet_names,
        sheet_name=job.sheet_name,
        header_row=job.header_row,
        columns=job.columns,
        fields=[FieldView.model_validate(f) for f in kind.fields],
        mapping=job.mapping,
        mapping_source=job.mapping_source,
        preset_key=preset.key if preset else None,
        row_count=row_count,
        skipped_row_count=job.skipped_row_count,
        warnings=job.warnings,
        expires_at=job.expires_at,
        preview=preview,
        result=result,
    )


def _create(
    db: Session,
    user_id: UUID,
    *,
    kind_key: str,
    file_name: str,
    file_type: str,
    sheet_names: list[str],
    sheet_name: str,
    table: list[list[str]],
    header_index: int,
    llm: StructuredLLM,
    warnings: list[str],
    answer=None,
) -> ImportJobView:
    if not file_name or len(file_name) > 255:
        invalid("file", "파일 이름은 1자 이상 255자 이하로 정해 주세요.")
    kind = get_import_kind(kind_key)
    header, rows, skipped = extract_rows(table, header_index)
    mapping, source = suggest(header, [r["cells"] for r in rows[:3]], kind, llm, warnings, answer)
    columns = [
        {
            "index": i,
            "header": title,
            "samples": [r["cells"][i] if i < len(r["cells"]) else "" for r in rows[:3]],
        }
        for i, title in enumerate(header)
    ]
    now = now_utc()
    try:
        repository.remove_expired(db, user_id, now)
        job = repository.add(
            db,
            ImportJob(
                user_id=user_id,
                kind=kind_key,
                status="parsed",
                file_name=file_name,
                file_type=file_type,
                sheet_names=sheet_names,
                sheet_name=sheet_name,
                header_row=header_index + 1,
                columns=columns,
                rows=rows,
                skipped_row_count=skipped,
                mapping=mapping,
                mapping_source=source,
                warnings=warnings,
                expires_at=now + timedelta(hours=24),
                created_at=now,
                updated_at=now,
            ),
        )
        view = _view(job)
        db.commit()
        return view
    except Exception:
        db.rollback()
        raise


def create_job(
    db: Session,
    user_id: UUID,
    *,
    kind_key: str,
    file_name: str,
    data: bytes,
    sheet_name: str | None,
    llm: StructuredLLM,
) -> ImportJobView:
    kind = get_import_kind(kind_key)
    workbook = read_file(data)
    if not workbook.sheets:
        raise AppError(422, "IMPORT_HEADER_NOT_FOUND", HEADER_NOT_FOUND)
    if sheet_name is not None and sheet_name not in workbook.sheets:
        invalid("sheetName", "파일에 없는 시트입니다.")
    if sheet_name is None:
        sheet_name = max(
            workbook.sheets,
            key=lambda name: max(
                (header_score(row, kind) for row in workbook.sheets[name][:30]), default=0
            ),
        )
    warnings: list[str] = []
    table = workbook.sheets[sheet_name]
    header_index, answer = find_header(table, kind, llm, warnings)
    if header_index is None:
        raise AppError(422, "IMPORT_HEADER_NOT_FOUND", HEADER_NOT_FOUND)
    return _create(
        db,
        user_id,
        kind_key=kind_key,
        file_name=file_name,
        file_type=workbook.file_type,
        sheet_names=list(workbook.sheets),
        sheet_name=sheet_name,
        table=table,
        header_index=header_index,
        llm=llm,
        warnings=warnings,
        answer=answer,
    )


def create_job_from_table(
    db, user_id, *, kind_key: str, file_name: str, header: list[str], rows: list[list[str]]
) -> ImportJobView:
    # 외부 추출 모듈도 같은 개인 등급 AI 계층과 작업 키를 사용한다.
    llm = get_structured_llm()
    table = [[cell_string(c) for c in header], *[[cell_string(c) for c in row] for row in rows]]
    return _create(
        db,
        user_id,
        kind_key=kind_key,
        file_name=file_name,
        file_type="csv",
        sheet_names=["Sheet1"],
        sheet_name="Sheet1",
        table=table,
        header_index=0,
        llm=llm,
        warnings=[],
    )


def get_job(db: Session, user_id: UUID, job_id: UUID) -> ImportJobView:
    return _view(_load(db, user_id, job_id))


def update_mapping(
    db: Session, user_id: UUID, job_id: UUID, mapping: dict[str, int | None]
) -> ImportJobView:
    try:
        job = _load(db, user_id, job_id, lock=True)
        _ensure_uncommitted(job)
        kind = get_import_kind(job.kind)
        field_keys = {f.key for f in kind.fields}
        for key in mapping:
            if key not in field_keys:
                invalid(key, "알 수 없는 필드입니다.")
        used = set()
        final = {}
        for field in kind.fields:
            column = mapping.get(field.key)
            if column is None and field.required:
                invalid(field.key, "필수 필드의 열을 선택해 주세요.")
            if column is not None:
                if type(column) is not int or not 0 <= column < len(job.columns):
                    invalid(field.key, "열 번호가 범위를 벗어났습니다.")
                if column in used:
                    invalid(field.key, "한 열은 한 필드에만 쓸 수 있습니다.")
                used.add(column)
            final[field.key] = column
        if final != job.mapping:
            job.mapping_source = "user"
        job.mapping = final
        job.status = "mapped"
        job.updated_at = now_utc()
        view = _view(job)
        db.commit()
        return view
    except Exception:
        db.rollback()
        raise


def get_preview(
    db: Session,
    user_id: UUID,
    job_id: UUID,
    *,
    page: int = 1,
    page_size: int = 50,
    only_invalid: bool = False,
) -> Preview:
    job = _load(db, user_id, job_id)
    _ensure_mapped(job)
    rows, _ = validate_rows(job.rows, job.mapping, get_import_kind(job.kind))
    return paginate(rows, page, page_size, only_invalid)


def commit_job(db: Session, user_id: UUID, job_id: UUID, *, skip_invalid: bool) -> ImportJobView:
    try:
        job = _load(db, user_id, job_id, lock=True)
        _ensure_mapped(job)
        kind = get_import_kind(job.kind)
        preview_rows, valid_rows = validate_rows(job.rows, job.mapping, kind)
        invalid_rows = [r for r in preview_rows if r.errors]
        if invalid_rows and not skip_invalid:
            invalid("rows", "오류가 있는 행을 고치거나 제외해 주세요.")
        result = kind.commit(db, user_id, valid_rows, CommitContext(job.id, job.file_name))
        errors = [error for row in invalid_rows for error in row.errors]
        errors.extend(RowErrorView.model_validate(e) for e in result.errors)
        combined = ResultView(
            inserted=result.inserted,
            skipped_duplicates=result.skipped_duplicates,
            failed=len(invalid_rows) + result.failed,
            errors=errors[:100],
        )
        job.status = "committed"
        job.result = combined.model_dump(mode="json", by_alias=True)
        job.rows = []
        job.updated_at = now_utc()
        view = _view(job)
        db.commit()
        return view
    except Exception:
        # 소비 모듈의 저장과 작업 상태 갱신을 함께 되돌린다.
        db.rollback()
        raise


def delete_job(db: Session, user_id: UUID, job_id: UUID) -> None:
    try:
        job = _load(db, user_id, job_id, lock=True)
        repository.remove(db, job)
        db.commit()
    except Exception:
        db.rollback()
        raise
