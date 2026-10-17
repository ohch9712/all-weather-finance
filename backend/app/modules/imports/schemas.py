from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, StrictInt

from app.core.schemas import CamelModel
from app.modules.imports.registry import FieldType


class FieldView(CamelModel):
    key: str
    label: str
    type: FieldType
    required: bool


class PresetView(CamelModel):
    key: str
    label: str


class KindView(CamelModel):
    key: str
    label: str
    fields: list[FieldView]
    presets: list[PresetView]


class KindList(CamelModel):
    items: list[KindView]


class ColumnView(CamelModel):
    index: int
    header: str
    samples: list[str]


class RowErrorView(CamelModel):
    row_number: int
    field: str | None
    message: str


class PreviewRow(CamelModel):
    row_number: int
    values: dict[str, Any]
    errors: list[RowErrorView]


class Preview(CamelModel):
    valid_count: int
    invalid_count: int
    rows: list[PreviewRow]
    page: int
    page_size: int
    total: int


class ResultView(CamelModel):
    inserted: int
    skipped_duplicates: int
    failed: int
    errors: list[RowErrorView]


class ImportJobView(CamelModel):
    id: UUID
    kind: str
    status: Literal["parsed", "mapped", "committed"]
    file_name: str
    file_type: Literal["csv", "xlsx", "xls", "html"]
    sheet_names: list[str]
    sheet_name: str | None
    header_row: int
    columns: list[ColumnView]
    fields: list[FieldView]
    mapping: dict[str, int | None]
    mapping_source: Literal["preset", "synonym", "llm", "user"]
    preset_key: str | None
    row_count: int
    skipped_row_count: int
    warnings: list[str]
    expires_at: datetime
    preview: Preview | None
    result: ResultView | None


class MappingRequest(CamelModel):
    mapping: dict[str, StrictInt | None]


class CommitRequest(CamelModel):
    skip_invalid: bool = Field()
