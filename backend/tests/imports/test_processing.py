import pytest

from app.core.errors import AppError
from app.modules.imports.processing import extract_rows, paginate, validate_rows


def test_rows_original_numbers_and_totals():
    header, rows, skipped = extract_rows(
        [
            ["안내"],
            ["날짜", "금액", "제목"],
            ["2026-10-16", "12", "가짜"],
            ["합 계", "12"],
            [],
            ["총계"],
            ["소계"],
            ["2026-10-17", "34", "다음", "추가"],
        ],
        1,
    )
    assert header == ["날짜", "금액", "제목", ""]
    assert [r["rowNumber"] for r in rows] == [3, 8]
    assert skipped == 3


def test_5000_rows():
    table = [["날짜", "금액", "제목"]] + [["2026-10-16", "1", "가짜"]] * 5000
    assert len(extract_rows(table, 0)[1]) == 5000
    with pytest.raises(AppError) as exc:
        extract_rows(table + [["2026-10-16", "1", "추가"]], 0)
    assert exc.value.details[0].field == "file"


def test_preview_normalization_errors_and_paging(demo_kind):
    _, rows, _ = extract_rows(
        [
            ["날짜", "금액", "제목"],
            ["2026-10-16", "12000", "정상"],
            ["2026-10-16", "1.5", "금액오류"],
            ["2026-10-16", "2000", "거절"],
        ],
        0,
    )
    preview_rows, valid = validate_rows(
        rows, {"date": 0, "amount": 1, "title": 2, "category": None}, demo_kind
    )
    assert len(valid) == 1
    assert preview_rows[0].values == {
        "date": "2026-10-16",
        "amount": 12000,
        "title": "정상",
        "category": None,
    }
    page = paginate(preview_rows, 2, 1, True)
    assert (page.valid_count, page.invalid_count, page.total) == (1, 2, 2)
    assert page.rows[0].row_number == 4
    assert page.rows[0].errors[0].message == "제목을 확인해 주세요."
