import tempfile

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.core.errors import register_error_handlers
from app.modules.imports.upload import read_upload


@pytest.fixture
def upload_client(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("업로드 바이트를 임시 파일에 저장하면 안 됩니다.")

    monkeypatch.setattr(tempfile, "TemporaryFile", forbidden)
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", forbidden)
    monkeypatch.setattr("starlette.formparsers.SpooledTemporaryFile", forbidden)
    app = FastAPI()
    register_error_handlers(app)

    @app.post("/upload")
    async def upload(request: Request):
        parsed = await read_upload(request)
        return {
            "size": len(parsed.data),
            "name": parsed.file_name,
            "kind": parsed.kind,
            "sheet": parsed.sheet_name,
        }

    with TestClient(app) as client:
        yield client


def test_large_upload_never_spools(upload_client):
    data = b"a" * (2 * 1024 * 1024)
    response = upload_client.post(
        "/upload", data={"kind": "demo", "sheetName": "표"}, files={"file": ("가짜.csv", data)}
    )
    assert response.status_code == 200
    assert response.json() == {"size": len(data), "name": "가짜.csv", "kind": "demo", "sheet": "표"}


def test_upload_max_size(upload_client):
    response = upload_client.post(
        "/upload", data={"kind": "demo"}, files={"file": ("a.csv", b"a" * (10 * 1024 * 1024 + 1))}
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "IMPORT_FILE_TOO_LARGE"


@pytest.mark.parametrize(
    "data,files,field", [({}, {"file": ("a.csv", b"a")}, "kind"), ({"kind": "demo"}, {}, "file")]
)
def test_missing(upload_client, data, files, field):
    response = upload_client.post("/upload", data=data, files=files)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field


def test_malformed(upload_client):
    response = upload_client.post(
        "/upload", content=b"fake", headers={"Content-Type": "multipart/form-data; boundary=fake"}
    )
    assert response.status_code == 422
