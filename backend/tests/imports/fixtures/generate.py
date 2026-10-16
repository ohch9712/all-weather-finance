"""실제 개인정보 없이 테스트 표를 생성한다. 추가 패키지를 쓰지 않는다."""

import io
import struct
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).parent
HEADER = ["날짜", "금액", "제목", "분류"]
DATA = ["2026-10-16", "12000", "가짜 식사", "식비"]


def record(code, body=b""):
    return struct.pack("<HH", code, len(body)) + body


def bof(kind):
    return record(0x0809, struct.pack("<HHHHII", 0x0600, kind, 0x0DBB, 0x07CC, 0x41, 0x06))


def make_xls(table):
    # BIFF8 문자열 셀을 담은 최소 OLE 문서. Workbook은 일반 FAT 스트림으로 둔다.
    eof = record(0x000A)

    def bounds(offset):
        return record(0x0085, struct.pack("<IBBBB", offset, 0, 0, 6, 0) + b"Sheet1")

    globals_ = bof(0x0005) + record(0x0042, struct.pack("<H", 1200))
    globals_ += bounds(len(globals_) + len(bounds(0)) + len(eof)) + eof
    sheet = bof(0x0010) + record(0x0200, struct.pack("<IIHHH", 0, len(table), 0, len(table[0]), 0))
    for r, row in enumerate(table):
        for c, value in enumerate(row):
            sheet += record(
                0x0204, struct.pack("<HHHHB", r, c, 0, len(value), 1) + value.encode("utf-16-le")
            )
    stream = (globals_ + sheet + eof).ljust(4096, b"\x00")
    free, end, fat = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    header = bytearray(512)
    header[:8] = bytes.fromhex("D0CF11E0A1B11AE1")
    struct.pack_into("<HHHH", header, 24, 0x003E, 3, 0xFFFE, 9)
    struct.pack_into("<H", header, 32, 6)
    struct.pack_into("<IIIIIIIII", header, 40, 0, 1, 1, 0, 4096, end, 0, end, 0)
    struct.pack_into("<109I", header, 76, 0, *([free] * 108))

    def directory(name, kind, start, size, child=free):
        entry = bytearray(128)
        name_bytes = (name + "\x00").encode("utf-16-le")
        entry[: len(name_bytes)] = name_bytes
        struct.pack_into("<HBBIII", entry, 64, len(name_bytes), kind, 1, free, free, child)
        struct.pack_into("<IQ", entry, 116, start, size)
        return entry

    directory_sector = (
        directory("Root Entry", 5, end, 0, 1) + directory("Workbook", 2, 2, 4096) + bytes(256)
    )
    fat_sector = struct.pack("<128I", fat, end, *range(3, 10), end, *([free] * 118))
    return bytes(header) + fat_sector + directory_sector + stream


def generate():
    csv_text = ",".join(HEADER) + "\n" + ",".join(DATA) + "\n"
    (ROOT / "utf8.csv").write_bytes(csv_text.encode("utf-8-sig"))
    (ROOT / "cp949.csv").write_bytes(csv_text.encode("cp949"))
    (ROOT / "tab.csv").write_bytes(csv_text.replace(",", "\t").encode())
    book = Workbook()
    sheet = book.active
    sheet.title = "이용내역"
    sheet.append(["가짜 표 안내"])
    sheet.append(["실제 개인정보가 없습니다."])
    sheet.append(HEADER)
    sheet.append([datetime(2026, 10, 16), 12000, "가짜 식사", "식비"])
    sheet.append(["합 계", 12000])
    sheet.append([None])
    book.create_sheet("안내").append(["가짜 안내"])
    buffer = io.BytesIO()
    book.save(buffer)
    (ROOT / "table.xlsx").write_bytes(buffer.getvalue())
    (ROOT / "table.xls").write_bytes(make_xls([HEADER, DATA]))
    (ROOT / "table.html").write_text(
        "<html><table>"
        + "".join(
            "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in [HEADER, DATA]
        )
        + "</table></html>"
    )
    (ROOT / "encrypted.xls").write_bytes(
        bytes.fromhex("D0CF11E0A1B11AE1") + "EncryptedPackage".encode("utf-16-le")
    )
    (ROOT / "unsupported.pdf").write_bytes(b"%PDF-1.7\nFAKE\n")


if __name__ == "__main__":
    generate()
