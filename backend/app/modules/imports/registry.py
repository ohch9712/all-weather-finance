from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.imports.validation import invalid

FieldType = Literal["date", "datetime", "amount", "decimal", "text", "enum"]


@dataclass(frozen=True)
class TargetField:
    key: str
    label: str
    type: FieldType
    required: bool
    synonyms: tuple[str, ...]
    description: str = ""
    enum_values: dict[str, tuple[str, ...]] | None = None


@dataclass(frozen=True)
class ImportPreset:
    key: str
    label: str
    header_signature: tuple[str, ...]
    mapping: dict[str, str]


@dataclass
class RowError:
    row_number: int
    field: str | None
    message: str


@dataclass
class ImportResult:
    inserted: int
    skipped_duplicates: int
    failed: int
    errors: list[RowError]


@dataclass(frozen=True)
class CommitContext:
    job_id: UUID
    file_name: str


@dataclass(frozen=True)
class ImportKind:
    key: str
    label: str
    fields: tuple[TargetField, ...]
    normalize_row: Callable[[dict[str, Any]], Any]
    # 저장 함수는 flush까지만 한다. commit·rollback은 임포트 엔진이 맡는다.
    commit: Callable[[Session, UUID, list[Any], CommitContext], ImportResult]
    presets: tuple[ImportPreset, ...] = ()
    llm_hint: str = ""


class RowValidationError(Exception):
    def __init__(self, field: str | None, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


_kinds: dict[str, ImportKind] = {}


def register_import_kind(kind: ImportKind) -> None:
    if kind.key in _kinds:
        raise ValueError("이미 등록된 임포트 종류입니다.")
    _kinds[kind.key] = kind


def get_import_kind(key: str) -> ImportKind:
    if key not in _kinds:
        invalid("kind", "지원하지 않는 임포트 종류입니다.")
    return _kinds[key]


def list_import_kinds() -> list[ImportKind]:
    return list(_kinds.values())
