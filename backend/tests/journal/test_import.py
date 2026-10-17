from io import BytesIO
from types import SimpleNamespace

import pytest
from openpyxl import Workbook

from app.modules.market import service as market


def upload(client, data, filename="trades.csv"):
    response = client.post(
        "/api/imports/jobs", data={"kind": "journal_trades"}, files={"file": (filename, data)}
    )
    assert response.status_code == 201, response.text
    job = response.json()
    assert job["presetKey"] is None
    mapped = client.put(f"/api/imports/jobs/{job['id']}/mapping", json={"mapping": job["mapping"]})
    assert mapped.status_code == 200, mapped.text
    return mapped.json()


def commit(client, job):
    response = client.post(f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True})
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_generic_csv_repeated_identical_rows_and_isolation(
    auth_client, fake_llm, other_auth_client
):
    # 범용 헤더로 만든 가짜 파일이며 실제 증권사 내보내기 형식이 아니다.
    row = "2026-10-01,005930,삼성전자,매수,2,10000\n"
    data = ("체결일,종목코드,종목명,매매구분,수량,단가\n" + row * 2).encode()
    job = upload(auth_client, data)
    assert job["preview"]["validCount"] == 2
    assert commit(auth_client, job)["inserted"] == 2
    again = commit(auth_client, upload(auth_client, data))
    assert again["inserted"] == 0 and again["skippedDuplicates"] == 2
    trades = auth_client.get("/api/journal/trades").json()["items"]
    assert len(trades) == 2 and all(t["source"] == "import" and t["costEstimated"] for t in trades)
    assert all(t["tradedTime"] is None and t["tradedAt"].endswith("00:00:00Z") for t in trades)
    assert other_auth_client.get(f"/api/imports/jobs/{job['id']}").status_code == 404
    assert (
        other_auth_client.post(
            f"/api/imports/jobs/{job['id']}/commit", json={"skipInvalid": True}
        ).status_code
        == 404
    )
    assert not fake_llm.calls


def test_generic_overseas_xlsx_amount_and_explicit_costs(auth_client, fake_llm):
    workbook = Workbook()
    workbook.active.append(
        [
            "거래일",
            "티커",
            "종목명",
            "구분",
            "거래수량",
            "거래금액",
            "수수료",
            "세금",
            "시간",
            "시장",
            "통화",
        ]
    )
    workbook.active.append(
        [
            "2026-10-01",
            "AAPL",
            "애플",
            "BUY",
            "0.5",
            "100.50",
            "0",
            "0.12",
            "10:30",
            "NASDAQ",
            "USD",
        ]
    )
    buffer = BytesIO()
    workbook.save(buffer)
    job = upload(auth_client, buffer.getvalue(), "generic-overseas.xlsx")
    assert commit(auth_client, job)["inserted"] == 1
    trade = auth_client.get("/api/journal/trades").json()["items"][0]
    assert trade["market"] == "US" and trade["currency"] == "USD" and trade["price"] == "201.00"
    assert trade["fee"] == "0.00" and trade["tax"] == "0.12" and not trade["costEstimated"]
    assert trade["tradedTime"] == "10:30"


def test_missing_code_lookup_success_failure_ambiguity(auth_client, fake_llm, monkeypatch):
    data = (
        "거래일,종목명,구분,수량,단가\n"
        "2026-10-01,삼성전자,매수,1,70000\n"
        "2026-10-01,알수없음,매수,1,1000\n"
        "2026-10-01,중복이름,매수,1,1000"
    ).encode()

    def search(db, query, **kwargs):
        return {
            "삼성전자": [SimpleNamespace(code="005930", name="삼성전자", kind="stock")],
            "중복이름": [
                SimpleNamespace(code="1", name="중복이름"),
                SimpleNamespace(code="2", name="중복이름"),
            ],
        }.get(query, [])

    monkeypatch.setattr(market, "search_stocks", search)
    result = commit(auth_client, upload(auth_client, data))
    assert result["inserted"] == 1 and result["failed"] == 2
    assert [(error["rowNumber"], error["field"]) for error in result["errors"]] == [
        (2, "symbolCode"),
        (3, "symbolCode"),
    ]
    trade = auth_client.get("/api/journal/trades").json()["items"][0]
    assert trade["symbolCode"] == "005930" and trade["currency"] == "KRW"


@pytest.mark.parametrize(
    "quantity,price,amount,fee",
    [("0", "100", "", ""), ("1", "", "", ""), ("1", "100", "", "-1"), ("1", "-1", "", "")],
)
def test_invalid_file_rows(auth_client, fake_llm, quantity, price, amount, fee):
    data = (
        "체결일,종목코드,종목명,구분,수량,단가,금액,수수료\n"
        f"2026-10-01,005930,삼성전자,매수,{quantity},{price},{amount},{fee}"
    ).encode()
    job = upload(auth_client, data)
    assert job["preview"]["invalidCount"] == 1
    assert commit(auth_client, job)["failed"] == 1
