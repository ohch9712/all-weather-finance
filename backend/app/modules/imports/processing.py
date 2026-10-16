import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from app.modules.imports.converters import convert_value
from app.modules.imports.registry import ImportKind, RowValidationError
from app.modules.imports.schemas import Preview, PreviewRow, RowErrorView
from app.modules.imports.validation import invalid


def extract_rows(table: list[list[str]], header_index: int) -> tuple[list[str], list[dict], int]:
    header = table[header_index]
    rows = []
    skipped = 0
    for row_number, cells in enumerate(table[header_index + 1 :], start=header_index + 2):
        if not any(cells):
            continue
        if any(re.match(r"^(합계|총계|소계)", re.sub(r"\s", "", c)) for c in cells):
            skipped += 1
            continue
        rows.append({"rowNumber": row_number, "cells": cells})
        if len(rows) > 5000:
            invalid("file", "한 번에 5,000행까지 올릴 수 있습니다.")
    width = max([len(header), *(len(row["cells"]) for row in rows)])
    return header + [""] * (width - len(header)), rows, skipped


def json_value(value):
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def validate_rows(
    rows: list[dict], mapping: dict[str, int | None], kind: ImportKind
) -> tuple[list[PreviewRow], list[Any]]:
    preview_rows = []
    valid = []
    for row in rows:
        values = {}
        errors = []
        for field in kind.fields:
            column = mapping.get(field.key)
            raw = row["cells"][column] if column is not None and column < len(row["cells"]) else ""
            try:
                values[field.key] = convert_value(raw, field)
            except RowValidationError as exc:
                errors.append(
                    RowErrorView(row_number=row["rowNumber"], field=exc.field, message=exc.message)
                )
        if not errors:
            try:
                valid.append(kind.normalize_row(values.copy()))
            except RowValidationError as exc:
                errors.append(
                    RowErrorView(row_number=row["rowNumber"], field=exc.field, message=exc.message)
                )
        preview_rows.append(
            PreviewRow(
                row_number=row["rowNumber"],
                values={key: json_value(value) for key, value in values.items()},
                errors=errors,
            )
        )
    return preview_rows, valid


def paginate(rows: list[PreviewRow], page: int, page_size: int, only_invalid: bool) -> Preview:
    invalid_count = sum(bool(r.errors) for r in rows)
    selected = [r for r in rows if r.errors] if only_invalid else rows
    start = (page - 1) * page_size
    return Preview(
        valid_count=len(rows) - invalid_count,
        invalid_count=invalid_count,
        rows=selected[start : start + page_size],
        page=page,
        page_size=page_size,
        total=len(selected),
    )
