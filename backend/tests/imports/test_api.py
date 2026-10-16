from datetime import timedelta
from pathlib import Path
from uuid import UUID

import pytest
from freezegun import freeze_time
from sqlalchemy import func, select

from app.core.time import now_utc
from app.modules.imports import service
from app.modules.imports.models import ImportJob
from app.modules.imports.registry import ImportResult, RowError

FIXTURES = Path(__file__).parent / "fixtures"
MAPPING = {"date": 0, "amount": 1, "title": 2, "category": 3}


def upload(client, data=None, name="utf8.csv", **form):
    response = client.post(
        "/api/imports/jobs",
        data={"kind": "demo", **form},
        files={"file": (name, data if data is not None else (FIXTURES / name).read_bytes())},
    )
    assert response.status_code == 201, response.text
    return response.json()


def mapped(client, job, mapping=MAPPING):
    response = client.put(f"/api/imports/jobs/{job['id']}/mapping", json={"mapping": mapping})
    assert response.status_code == 200, response.text
    return response.json()


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
def test_full_flow_disabled_llm(auth_client, db, name, type_):
    kinds = auth_client.get("/api/imports/kinds")
    assert kinds.status_code == 200
    assert kinds.json()["items"][0]["fields"][0] == {
        "key": "date",
        "label": "날짜",
        "type": "date",
        "required": True,
    }
    job = upload(auth_client, name=name)
    assert set(job) == {
        "id",
        "kind",
        "status",
        "fileName",
        "fileType",
        "sheetNames",
        "sheetName",
        "headerRow",
        "columns",
        "fields",
        "mapping",
        "mappingSource",
        "presetKey",
        "rowCount",
        "skippedRowCount",
        "warnings",
        "expiresAt",
        "preview",
        "result",
    }
    assert (job["status"], job["fileType"], job["rowCount"], job["mappingSource"]) == (
        "parsed",
        type_,
        1,
        "synonym",
    )
    assert job["preview"] is None and job["result"] is None
    assert job["mapping"] == MAPPING
    assert job["headerRow"] == (3 if type_ == "xlsx" else 1)
    assert job["skippedRowCount"] == (1 if type_ == "xlsx" else 0)
    assert job["expiresAt"].endswith("Z")
    saved = db.get(ImportJob, UUID(job["id"]))
    assert saved.rows[0]["cells"] == ["2026-10-16", "12000", "가짜 식사", "식비"]
    assert isinstance(saved.rows[0]["cells"][0], str)
    assert (
        "data" not in ImportJob.__table__.columns
        and "file_bytes" not in ImportJob.__table__.columns
    )
    assert auth_client.get(f"/api/imports/jobs/{job['id']}").json() == job
    assert auth_client.get(f"/api/imports/jobs/{job['id']}/preview").status_code == 409
    assert (
        auth_client.post(
            f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True}
        ).status_code
        == 409
    )
    job = mapped(auth_client, job)
    assert job["status"] == "mapped" and job["mappingSource"] == "synonym"
    preview = auth_client.get(f"/api/imports/jobs/{job['id']}/preview").json()
    assert preview == job["preview"]
    assert preview["rows"][0]["values"] == {
        "date": "2026-10-16",
        "amount": 12000,
        "title": "가짜 식사",
        "category": "food",
    }
    response = auth_client.post(
        f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": False}
    )
    assert response.status_code == 200, response.text
    committed = response.json()
    assert (committed["status"], committed["rowCount"], committed["preview"]) == (
        "committed",
        1,
        None,
    )
    assert committed["result"] == {"inserted": 1, "skippedDuplicates": 0, "failed": 0, "errors": []}
    db.expire_all()
    assert db.get(ImportJob, UUID(job["id"])).rows == []
    assert (
        auth_client.post(
            f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True}
        ).status_code
        == 409
    )
    assert (
        auth_client.put(
            f"/api/imports/jobs/{job['id']}/mapping", json={"mapping": MAPPING}
        ).status_code
        == 409
    )
    assert (
        auth_client.delete(
            f"/api/imports/jobs/{job['id']}", headers={"Content-Type": "application/json"}
        ).status_code
        == 204
    )
    assert auth_client.get(f"/api/imports/jobs/{job['id']}").status_code == 404


def test_mapping_validation_and_user_source(auth_client):
    job = upload(auth_client)
    base = f"/api/imports/jobs/{job['id']}"
    for mapping, field in [
        ({"amount": 1, "title": 2}, "date"),
        ({**MAPPING, "amount": 0}, "amount"),
        ({**MAPPING, "amount": 9}, "amount"),
        ({**MAPPING, "amount": -1}, "amount"),
        ({**MAPPING, "unknown": 3}, "unknown"),
    ]:
        response = auth_client.put(base + "/mapping", json={"mapping": mapping})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"][0]["field"] == field
    for value in (True, "1", 1.5):
        assert (
            auth_client.put(
                base + "/mapping", json={"mapping": {**MAPPING, "amount": value}}
            ).status_code
            == 422
        )
    updated = mapped(auth_client, job, {**MAPPING, "category": None})
    assert updated["mappingSource"] == "user"


def test_preview_invalid_commit_result_and_limit(auth_client, replace_kind):
    called = []

    def commit(db, user_id, rows, ctx):
        called.append((rows, ctx))
        return ImportResult(1, 1, 0, [RowError(2, None, "참고 오류")])

    replace_kind(commit=commit)
    data = (
        "날짜,금액,제목,분류\n2026-10-16,12000,정상,식비\n"
        "2026-10-16,12000,중복,식비\n2026-10-16,잘못,오류,식비\n"
        "2026-10-16,2000,거절,식비\n"
    ).encode()
    job = mapped(auth_client, upload(auth_client, data=data))
    base = f"/api/imports/jobs/{job['id']}"
    response = auth_client.get(base + "/preview?page=2&pageSize=1&onlyInvalid=true")
    preview = response.json()
    assert (
        preview["validCount"],
        preview["invalidCount"],
        preview["total"],
        preview["rows"][0]["rowNumber"],
    ) == (2, 2, 2, 5)
    assert auth_client.get(base + "/preview?pageSize=101").status_code == 422
    response = auth_client.post(base + "/commit", json={"skipInvalid": False})
    assert response.status_code == 422
    assert response.json()["error"]["details"] == [
        {"field": "rows", "message": "오류가 있는 행을 고치거나 제외해 주세요."}
    ]
    assert not called
    response = auth_client.post(base + "/commit", json={"skipInvalid": True})
    assert response.status_code == 200, response.text
    assert response.json()["result"]["failed"] == 2
    assert response.json()["result"]["skippedDuplicates"] == 1
    assert len(called[0][0]) == 2
    assert called[0][1].file_name == "utf8.csv" and str(called[0][1].job_id) == job["id"]


def test_errors_capped_at_100(auth_client):
    data = ("날짜,금액,제목,분류\n" + "틀림,틀림,,모름\n" * 120).encode()
    job = mapped(auth_client, upload(auth_client, data=data))
    response = auth_client.post(f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True})
    assert response.status_code == 200, response.text
    assert response.json()["result"]["failed"] == 120
    assert len(response.json()["result"]["errors"]) == 100


@pytest.mark.parametrize(
    "method,suffix,body",
    [
        ("get", "", None),
        ("get", "/preview", None),
        ("put", "/mapping", {"mapping": MAPPING}),
        ("post", "/commit", {"skipInvalid": True}),
        ("delete", "", None),
    ],
)
def test_other_user_404(auth_client, other_auth_client, method, suffix, body):
    job = upload(auth_client)
    response = getattr(other_auth_client, method)(
        f"/api/imports/jobs/{job['id']}" + suffix,
        **(
            {"json": body}
            if body is not None
            else {"headers": {"Content-Type": "application/json"}}
        ),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_expiration_and_cleanup_is_scoped(auth_client, other_auth_client, db):
    with freeze_time("2026-10-16 00:00:00"):
        mine = upload(auth_client)
        other = upload(other_auth_client)
    with freeze_time("2026-10-17 00:00:00"):
        expired = auth_client.get(f"/api/imports/jobs/{mine['id']}")
        assert expired.status_code == 410
        assert expired.json()["error"]["code"] == "IMPORT_JOB_EXPIRED"
        new = upload(auth_client)
        assert new["id"] != mine["id"]
    assert db.get(ImportJob, UUID(mine["id"])) is None
    assert db.get(ImportJob, UUID(other["id"])) is not None


def test_sheets_magic_and_headers(auth_client):
    job = upload(auth_client, name="table.xlsx")
    assert job["sheetName"] == "이용내역"
    response = auth_client.post(
        "/api/imports/jobs",
        data={"kind": "demo", "sheetName": "없는표"},
        files={"file": ("a.xlsx", (FIXTURES / "table.xlsx").read_bytes())},
    )
    assert response.status_code == 422
    response = auth_client.post(
        "/api/imports/jobs",
        data={"kind": "demo", "sheetName": "안내"},
        files={"file": ("a.xlsx", (FIXTURES / "table.xlsx").read_bytes())},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "IMPORT_HEADER_NOT_FOUND"
    assert (
        upload(auth_client, data=(FIXTURES / "table.html").read_bytes(), name="pretend.xls")[
            "fileType"
        ]
        == "html"
    )


@pytest.mark.parametrize(
    "name,status,code",
    [
        ("unsupported.pdf", 415, "IMPORT_FILE_UNSUPPORTED"),
        ("encrypted.xls", 422, "IMPORT_FILE_ENCRYPTED"),
    ],
)
def test_file_rejections(auth_client, name, status, code):
    response = auth_client.post(
        "/api/imports/jobs",
        data={"kind": "demo"},
        files={"file": (name, (FIXTURES / name).read_bytes())},
    )
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_kind_missing_and_unauthenticated(client, auth_client):
    assert client.get("/api/imports/kinds").status_code == 401
    assert (
        client.post(
            "/api/imports/jobs", data={"kind": "demo"}, files={"file": ("a.csv", b"fake")}
        ).status_code
        == 401
    )
    response = auth_client.post(
        "/api/imports/jobs", data={"kind": "missing"}, files={"file": ("a.csv", b"fake")}
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "kind"


def test_table_flow(db, auth_client, monkeypatch, fake_llm):
    fake_llm.set_enabled("imports.column_mapping", False)
    monkeypatch.setattr(service, "get_structured_llm", lambda: fake_llm)
    user_id = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    job = service.create_job_from_table(
        db,
        user_id,
        kind_key="demo",
        file_name="추출.csv",
        header=["날짜", "금액", "제목", "분류"],
        rows=[["2026-10-16", "12000", "표", "식비"], ["소계", "12000"]],
    )
    assert job.header_row == 1 and job.file_type == "csv" and job.skipped_row_count == 1
    result = mapped(auth_client, {"id": str(job.id)})
    assert result["preview"]["rows"][0]["rowNumber"] == 2
    assert (
        auth_client.post(f"/api/imports/jobs/{job.id}/commit", json={"skipInvalid": False}).json()[
            "result"
        ]["inserted"]
        == 1
    )


def test_commit_atomic_rollback(db, auth_client, replace_kind):
    job = mapped(auth_client, upload(auth_client))
    count = db.scalar(select(func.count()).select_from(ImportJob))

    def failed_commit(session, user_id, rows, ctx):
        session.add(
            ImportJob(
                user_id=user_id,
                kind="demo",
                status="parsed",
                file_name="롤백.csv",
                file_type="csv",
                sheet_names=[],
                sheet_name=None,
                header_row=1,
                columns=[],
                rows=[],
                mapping={},
                mapping_source="user",
                warnings=[],
                expires_at=now_utc() + timedelta(hours=24),
            )
        )
        session.flush()
        raise RuntimeError("소비 모듈 저장 실패")

    replace_kind(commit=failed_commit)
    response = auth_client.post(f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True})
    assert response.status_code == 500
    assert db.scalar(select(func.count()).select_from(ImportJob)) == count
    saved = db.get(ImportJob, UUID(job["id"]))
    assert saved.status == "mapped" and len(saved.rows) == 1 and saved.result is None


def test_llm_upload_mapping_and_failure(auth_client, fake_llm):
    import json

    from app.core.errors import AppError

    task = "imports.column_mapping"
    fake_llm.register(
        task,
        lambda _: {
            "headerRow": None,
            "mappings": [{"field": "title", "columnIndex": 2, "reason": "예시가 제목입니다."}],
        },
    )
    job = upload(auth_client, data="날짜,금액,모르는열\n20261016,12000,123456789012\n".encode())
    assert job["mappingSource"] == "llm" and job["mapping"]["title"] == 2
    prompt = json.loads(fake_llm.calls[0].content[0].text)
    assert prompt["samples"][0] == ["20****16", "12000", "12********12"]
    assert mapped(auth_client, job)["mappingSource"] == "llm"

    def fail(_):
        raise AppError(503, "LLM_UNAVAILABLE", "실패")

    fake_llm.register(task, fail)
    job = upload(auth_client, data="날짜,금액,모르는열\n2026-10-16,12000,가짜\n".encode())
    assert job["mappingSource"] == "synonym"
    assert job["warnings"] == ["AI 매핑 추천을 쓰지 못했습니다."]
    assert job["mapping"]["title"] is None
    assert mapped(auth_client, job, {"date": 0, "amount": 1, "title": 2})["mappingSource"] == "user"


def test_llm_header_fallback(auth_client, fake_llm):
    fake_llm.register(
        "imports.column_mapping",
        lambda _: {
            "headerRow": 2,
            "mappings": [
                {"field": "date", "columnIndex": 0, "reason": ""},
                {"field": "amount", "columnIndex": 1, "reason": ""},
                {"field": "title", "columnIndex": 2, "reason": ""},
            ],
        },
    )
    job = upload(auth_client, data="가짜 안내\nA,B,C\n2026-10-16,12000,가짜\n".encode())
    assert job["headerRow"] == 2 and job["mappingSource"] == "llm"
    assert len(fake_llm.calls) == 1
    assert (
        mapped(auth_client, job, {"date": 0, "amount": 1, "title": 2})["preview"]["rows"][0][
            "rowNumber"
        ]
        == 3
    )


def test_upload_and_table_row_limit(auth_client, db, fake_llm, monkeypatch):
    data = ("날짜,금액,제목,분류\n" + "2026-10-16,1,가짜,식비\n" * 5001).encode()
    response = auth_client.post(
        "/api/imports/jobs", data={"kind": "demo"}, files={"file": ("a.csv", data)}
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "file"
    fake_llm.set_enabled("imports.column_mapping", False)
    monkeypatch.setattr(service, "get_structured_llm", lambda: fake_llm)
    user_id = UUID(auth_client.get("/api/auth/me").json()["user"]["id"])
    from app.core.errors import AppError

    with pytest.raises(AppError) as exc:
        service.create_job_from_table(
            db,
            user_id,
            kind_key="demo",
            file_name="a.csv",
            header=["날짜", "금액", "제목"],
            rows=[["2026-10-16", "1", "가짜"]] * 5001,
        )
    assert exc.value.details[0].field == "file"
