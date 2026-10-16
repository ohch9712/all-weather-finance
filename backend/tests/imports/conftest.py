from dataclasses import replace

import pytest

from app.modules.imports import registry
from app.modules.imports.registry import ImportKind, ImportResult, RowValidationError, TargetField


def normalize_demo(values):
    if values["title"] == "거절":
        raise RowValidationError("title", "제목을 확인해 주세요.")
    return values


@pytest.fixture(autouse=True)
def demo_kind():
    previous = registry._kinds.copy()
    registry._kinds.clear()
    kind = ImportKind(
        key="demo",
        label="테스트 가져오기",
        fields=(
            TargetField("date", "날짜", "date", True, ("날짜", "이용일", "date")),
            TargetField("amount", "금액", "amount", True, ("금액", "amount")),
            TargetField("title", "제목", "text", True, ("제목", "title")),
            TargetField(
                "category",
                "분류",
                "enum",
                False,
                ("분류", "category"),
                enum_values={"food": ("식비", "FOOD"), "other": ("기타",)},
            ),
        ),
        normalize_row=normalize_demo,
        commit=lambda db, user, rows, ctx: ImportResult(len(rows), 0, 0, []),
    )
    registry.register_import_kind(kind)
    yield kind
    registry._kinds.clear()
    registry._kinds.update(previous)


@pytest.fixture
def replace_kind(demo_kind):
    def apply(**changes):
        kind = replace(demo_kind, **changes)
        registry._kinds[kind.key] = kind
        return kind

    return apply
