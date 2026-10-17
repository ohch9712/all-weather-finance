"""실제 카드사 양식을 흉내 내지 않는 범용 표로 임포트 계약을 확인한다."""

import csv
import io
import json
from datetime import date
from hashlib import sha256
from uuid import UUID, uuid4

import pypdfium2
import pytest
from openpyxl import Workbook
from sqlalchemy import select

from app.integrations.llm.types import DocumentPart, ImagePart
from app.modules.ledger.categorize import keyword_category, merchant_key
from app.modules.ledger.models import LedgerEntry
from app.modules.ledger.service import LedgerImportRow, import_entries
from tests.ledger.helpers import add_entry, category_ids, error_of, send_delete

HEADERS = ["이용일자", "가맹점명", "승인금액", "승인구분", "카드명", "승인번호"]
TABLE = [
    ["2026-10-01", "스타벅스 강남점", "5000", "승인", "테스트 카드", "00123"],
    ["2026-10-01", "스타벅스 강남점", "5000", "승인", "테스트 카드", ""],
    ["2026-10-01", "스타벅스 강남점", "5000", "승인", "테스트 카드", ""],
    ["2026-10-02", "스타벅스 강남점", "-5000", "승인", "테스트 카드", "00123"],
    ["2026-10-03", "김밥 식당", "3000", "부분취소", "", ""],
    ["합계", "", "12000", "", "", ""],
]


@pytest.fixture(autouse=True)
def classification_llm(monkeypatch, fake_llm):
    fake_llm.set_enabled("ledger.categorize", False)
    monkeypatch.setattr("app.modules.ledger.categorize.deps.get_structured_llm", lambda: fake_llm)
    return fake_llm


def upload(client, name, data):
    response = client.post(
        "/api/imports/jobs", data={"kind": "ledger_card"}, files={"file": (name, data)}
    )
    assert response.status_code == 201, response.text
    job = response.json()
    assert job["mappingSource"] == "synonym"
    response = client.put(
        f"/api/imports/jobs/{job['id']}/mapping", json={"mapping": job["mapping"]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def commit(client, job):
    response = client.post(f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True})
    assert response.status_code == 200, response.text
    return response.json()["result"]


def file_bytes(kind):
    rows = [HEADERS, *TABLE]
    if kind in ("csv", "cancel.csv"):
        stream = io.StringIO()
        csv.writer(stream).writerows(rows)
        return stream.getvalue().encode()
    if kind == "xlsx":
        workbook = Workbook()
        for row in rows:
            workbook.active.append(row)
        stream = io.BytesIO()
        workbook.save(stream)
        workbook.close()
        return stream.getvalue()
    return (
        "<html><meta charset='utf-8'><table>"
        + "".join("<tr>" + "".join(f"<td>{v}</td>" for v in row) + "</tr>" for row in rows)
        + "</table></html>"
    ).encode()


@pytest.mark.parametrize("kind", ["csv", "xlsx", "xls", "cancel.csv"])
def test_upload_commit_dedup_and_summary(auth_client, other_auth_client, kind, db):
    job = upload(auth_client, f"generic.{kind}", file_bytes(kind))
    assert job["skippedRowCount"] == 1
    assert commit(auth_client, job) == {
        "inserted": 5,
        "skippedDuplicates": 0,
        "failed": 0,
        "errors": [],
    }
    entries = auth_client.get(f"/api/ledger/entries?importBatchId={job['id']}&month=2020-01").json()
    assert entries["total"] == 5
    assert sum(e["isCancellation"] for e in entries["items"]) == 2
    assert all(e["paymentMethod"] == "card" for e in entries["items"])
    assert {e["categoryName"] for e in entries["items"]} == {"식비", "카페·간식"}
    assert (
        other_auth_client.get(f"/api/ledger/entries?importBatchId={job['id']}").json()["total"] == 0
    )
    error_of(other_auth_client.get(f"/api/ledger/entries/{entries['items'][0]['id']}"), 404)
    error_of(other_auth_client.get(f"/api/imports/jobs/{job['id']}"), 404)
    again = upload(auth_client, f"generic.{kind}", file_bytes(kind))
    assert commit(auth_client, again)["skippedDuplicates"] == 5
    summary = auth_client.get("/api/ledger/summary?month=2026-10").json()
    assert summary["expenseTotal"] == 7000
    assert summary["byCategory"][0]["amount"] == 10000
    assert summary["byCategory"][0]["ratio"] == 100
    assert summary["daily"][1]["expense"] == 0
    assert summary["topMerchants"][0]["count"] == 3
    user_id = db.scalar(select(LedgerEntry.user_id))
    base = f"{user_id}|2026-10-01|스타벅스 강남점|5000||False"
    hashes = set(db.scalars(select(LedgerEntry.dedup_hash)))
    assert sha256(base.encode()).hexdigest() in hashes
    assert sha256((base + "|1").encode()).hexdigest() in hashes


def current_user(client):
    return UUID(client.get("/api/auth/me").json()["user"]["id"])


def test_classification_priority_and_private_input(auth_client, db, fake_llm):
    ids = category_ids(auth_client)
    response = auth_client.post(
        "/api/ledger/merchant-rules",
        json={"merchant": "(주) 스타벅스", "categoryId": ids["expense", "교육"]},
    )
    assert response.status_code == 200, response.text
    fake_llm.set_enabled("ledger.categorize", True)
    fake_llm.register(
        "ledger.categorize",
        lambda _: {
            "items": [
                {"merchant": "미지상점", "category": "여행"},
                {"merchant": "잘못된상점", "category": "없는분류"},
            ]
        },
    )
    rows = [
        LedgerImportRow(date(2026, 10, 1), name, 12345, False, approval_no="secret-approval")
        for name in (
            "주식회사 스타벅스",
            "김밥천국",
            "미지상점",
            "잘못된상점",
            "나머지상점",
            "미지상점",
        )
    ]
    result = import_entries(db, current_user(auth_client), rows, source="codef", batch_id=uuid4())
    assert result.inserted == 6
    entries = auth_client.get("/api/ledger/entries?month=2026-10").json()["items"]
    categories = {e["merchant"]: e["categoryName"] for e in entries}
    assert categories == {
        "주식회사 스타벅스": "교육",
        "김밥천국": "식비",
        "미지상점": "여행",
        "잘못된상점": "기타 지출",
        "나머지상점": "기타 지출",
    }
    request = fake_llm.calls[-1]
    assert request.task == "ledger.categorize" and request.data_class == "personal"
    content = json.loads(request.content[0].text)
    assert len(content["merchants"]) == 3
    assert (
        "12345" not in request.content[0].text and "secret-approval" not in request.content[0].text
    )
    assert all(set(m) == {"merchant", "merchantCategory"} for m in content["merchants"])


def test_rule_learning_apply_existing_and_isolation(auth_client, other_auth_client, db):
    ids = category_ids(auth_client)
    user = current_user(auth_client)
    rows = [LedgerImportRow(date(2026, 9, 1), "(주) 동네상점", 100, False)] * 2
    assert import_entries(db, user, rows, source="import").inserted == 2
    manual = add_entry(auth_client, merchant="동네상점")
    imported = auth_client.get("/api/ledger/entries?month=2026-09").json()["items"]
    response = auth_client.patch(
        f"/api/ledger/entries/{imported[0]['id']}", json={"categoryId": ids["expense", "교육"]}
    )
    assert response.status_code == 200
    rules = auth_client.get("/api/ledger/merchant-rules").json()["items"]
    assert rules[0]["merchantKey"] == "동네상점"
    assert other_auth_client.get("/api/ledger/merchant-rules").json()["items"] == []
    error_of(send_delete(other_auth_client, f"/api/ledger/merchant-rules/{rules[0]['id']}"), 404)
    saved = auth_client.post(
        "/api/ledger/merchant-rules",
        json={
            "merchant": "㈜ 동네상점",
            "categoryId": ids["expense", "교통"],
            "applyToExisting": True,
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["updatedCount"] == 2
    assert auth_client.get(f"/api/ledger/entries/{manual['id']}").json()["categoryName"] == "식비"
    invalid = auth_client.post(
        "/api/ledger/merchant-rules", json={"merchant": "상점", "categoryId": ids["income", "급여"]}
    )
    assert error_of(invalid, 422)["details"][0]["field"] == "categoryId"
    custom = auth_client.post(
        "/api/ledger/categories", json={"kind": "expense", "name": "개인분류"}
    ).json()
    auth_client.post(
        "/api/ledger/merchant-rules", json={"merchant": "삭제용", "categoryId": custom["id"]}
    )
    assert send_delete(auth_client, f"/api/ledger/categories/{custom['id']}").status_code == 204
    assert len(auth_client.get("/api/ledger/merchant-rules").json()["items"]) == 1


def test_cancellation_boundaries_and_direct_import(auth_client, db):
    user = current_user(auth_client)
    rows = [
        LedgerImportRow(date(2026, 9, 1), "스타벅스", 9000, False),
        LedgerImportRow(date(2026, 10, 1), "스타벅스", 9000, True),
    ]
    assert import_entries(db, user, rows, source="codef").inserted == 2
    summary = auth_client.get("/api/ledger/summary?month=2026-10").json()
    assert summary["expenseTotal"] == 0
    assert summary["previous"]["expenseTotal"] == 9000
    assert summary["byCategory"] == summary["topMerchants"] == []
    assert summary["daily"][0]["expense"] == 0
    assert all(
        item["expenseTotal"] >= 0 for item in auth_client.get("/api/ledger/trend").json()["items"]
    )
    invalid = import_entries(
        db, user, [LedgerImportRow(date(2026, 10, 1), "상점", 0, False)], source="codef"
    )
    assert invalid.failed == 1 and invalid.errors[0].row_number == 1
    db.rollback()


def test_llm_error_and_batch_limit(auth_client, db, fake_llm):
    fake_llm.set_enabled("ledger.categorize", True)

    def fail(_):
        raise RuntimeError("가짜 실패")

    fake_llm.register("ledger.categorize", fail)
    rows = [LedgerImportRow(date(2026, 10, 1), f"미지상점 {n}", 1, False) for n in range(201)]
    assert import_entries(db, current_user(auth_client), rows, source="codef").inserted == 201
    assert [len(json.loads(c.content[0].text)["merchants"]) for c in fake_llm.calls] == [200, 1]


@pytest.mark.parametrize(
    ("merchant", "expected"),
    [
        ("CU 강남점", "생활용품"),
        ("CUCKOO", None),
        ("SKT요금", "통신"),
        ("SRT123", None),
        ("KT", "통신"),
        ("쿠팡이츠", "식비"),
    ],
)
def test_short_keyword_boundaries(merchant, expected):
    assert keyword_category(merchant) == expected
    assert merchant_key("  (주)  abc   강남점-123  ") == "ABC 강남점-123"


def pdf_bytes(pages=1):
    document = pypdfium2.PdfDocument.new()
    for _ in range(pages):
        page = document.new_page(100, 100)
        page.close()
    stream = io.BytesIO()
    document.save(stream)
    document.close()
    return stream.getvalue()


def test_extract_pdf_and_image(auth_client, fake_llm):
    fake_llm.register(
        "ledger.extract_statement",
        lambda _: {
            "transactions": [
                {
                    "occurredOn": "2026-10-01",
                    "merchant": "김밥천국",
                    "amount": 5000,
                    "isCancellation": False,
                    "cardName": None,
                    "approvalNo": None,
                }
            ],
            "warnings": ["가짜 추출 경고"],
        },
    )
    for name, data, part in [
        ("generic.pdf", pdf_bytes(), DocumentPart),
        ("generic.png", b"\x89PNG\r\n\x1a\n" + b"fake", ImagePart),
    ]:
        response = auth_client.post(
            "/api/ledger/import/extract", data={"consent": "true"}, files={"file": (name, data)}
        )
        assert response.status_code == 200, response.text
        job = response.json()
        assert job["kind"] == "ledger_card" and "가짜 추출 경고" in job["warnings"]
        call = fake_llm.calls[-1]
        assert call.task == "ledger.extract_statement" and call.data_class == "personal"
        assert isinstance(call.content[0], part)
        mapped = auth_client.put(
            f"/api/imports/jobs/{job['id']}/mapping", json={"mapping": job["mapping"]}
        ).json()
        assert commit(auth_client, mapped)["failed"] == 0


def test_extract_validation(auth_client, fake_llm):
    def request(name, data, consent=None):
        return auth_client.post(
            "/api/ledger/import/extract",
            data={} if consent is None else {"consent": consent},
            files={"file": (name, data)},
        )

    assert error_of(request("x.pdf", pdf_bytes()), 422)["details"][0] == {
        "field": "consent",
        "message": "AI로 처리하는 데 동의해 주세요.",
    }
    assert (
        error_of(request("x.pdf", b"x" * (10 * 1024 * 1024 + 1), "true"), 413)["code"]
        == "IMPORT_FILE_TOO_LARGE"
    )
    assert (
        error_of(request("x.png", b"x" * (5 * 1024 * 1024 + 1), "true"), 413)["code"]
        == "IMPORT_FILE_TOO_LARGE"
    )
    assert (
        error_of(request("x.pdf", pdf_bytes(21), "true"), 422)["details"][0]["message"]
        == "20쪽 이하의 명세서만 올릴 수 있습니다."
    )
    assert error_of(request("x.txt", b"x", "true"), 415)["code"] == "IMPORT_FILE_UNSUPPORTED"
    fake_llm.set_enabled("ledger.extract_statement", False)
    assert error_of(request("x.pdf", pdf_bytes(), "true"), 503)["code"] == "LLM_UNAVAILABLE"


def test_zero_amount_preview_error(auth_client):
    job = upload(auth_client, "generic.csv", "이용일,가맹점,금액\n2026-10-01,상점,0\n".encode())
    assert job["preview"]["invalidCount"] == 1
    assert job["preview"]["rows"][0]["errors"][0]["message"] == "금액이 0입니다."
    assert commit(auth_client, job)["failed"] == 1
