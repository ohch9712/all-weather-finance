import io
from datetime import datetime
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.core.errors import AppError
from app.modules.imports.readers import cell_string, read_file

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize(
    "name,type_",
    [
        ("utf8.csv", "csv"),
        ("cp949.csv", "csv"),
        ("tab.csv", "csv"),
        ("table.xlsx", "xlsx"),
        ("table.xls", "xls"),
        ("table.html", "html"),
    ],
)
def test_formats(name, type_):
    book = read_file((FIXTURES / name).read_bytes())
    assert book.file_type == type_
    assert any("날짜" in row for rows in book.sheets.values() for row in rows)
    assert any("가짜 식사" in row for rows in book.sheets.values() for row in rows)


@pytest.mark.parametrize(
    "name,code,status",
    [
        ("encrypted.xls", "IMPORT_FILE_ENCRYPTED", 422),
        ("unsupported.pdf", "IMPORT_FILE_UNSUPPORTED", 415),
    ],
)
def test_unsupported_encrypted(name, code, status):
    with pytest.raises(AppError) as exc:
        read_file((FIXTURES / name).read_bytes())
    assert (exc.value.code, exc.value.status_code) == (code, status)


def test_limits():
    with pytest.raises(AppError) as exc:
        read_file(b"x" * (10 * 1024 * 1024 + 1))
    assert exc.value.code == "IMPORT_FILE_TOO_LARGE"


def test_cells():
    assert cell_string(1.2e15) == "1200000000000000"
    assert cell_string(12.0) == "12"
    assert cell_string(datetime(2026, 10, 16, 13, 45)) == "2026-10-16 13:45:00"
    assert cell_string(" a\n b ") == "a b"


def test_html_multiple_tables_and_th():
    book = read_file(
        b" <html><table><thead><tr><th>A</th></tr></thead><tr><td>one</td></tr></table>"
        b"<table><tr><td>B</td></tr><tr><td>two</td></tr></table></html>"
    )
    assert book.sheets == {"Sheet1": [["A"], ["one"]], "Sheet2": [["B"], ["two"]]}


def test_xlsx_magic_and_sheet_names():
    book = Workbook()
    book.active.title = "안내"
    book.active.append(["안내"])
    book.create_sheet("데이터").append(["날짜", "금액", "제목"])
    data = io.BytesIO()
    book.save(data)
    assert list(read_file(data.getvalue()).sheets) == ["안내", "데이터"]


@pytest.mark.parametrize(
    "data", [b"PK\x03\x04broken", bytes.fromhex("D0CF11E0A1B11AE1"), b"\x89PNG\r\n", b"\x00\x01"]
)
def test_corrupt_binary_is_unsupported(data):
    with pytest.raises(AppError) as exc:
        read_file(data)
    assert exc.value.code == "IMPORT_FILE_UNSUPPORTED"


def test_charset_fallback_and_long_csv_cell():
    table = "날짜,금액,제목\n2026-10-16,1,가짜\n"
    assert read_file(table.encode("utf-16")).sheets["Sheet1"][0] == ["날짜", "금액", "제목"]
    data = ("날짜,금액,제목\n2026-10-16,1," + "x" * 200000).encode()
    assert len(read_file(data).sheets["Sheet1"][1][2]) == 200000
