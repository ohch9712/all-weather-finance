import pytest
from freezegun import freeze_time

from tests.conftest import authenticated_client

AGE_MESSAGE = "만 14세 이상만 이용할 수 있습니다."


@pytest.mark.parametrize(
    "now,birth_year,status",
    [
        ("2026-10-16", 2013, 422),  # 13세
        ("2026-10-16", 2012, 200),  # 14세
        ("2026-10-16", 2016, 422),  # 10세(기존 범위 안이지만 14세 미만)
        # 연 나이는 KST 기준연도로 센다. UTC로는 아직 2026년이어도 KST가 2027년이면 14세다.
        ("2026-12-31T15:00:00Z", 2013, 200),
        ("2026-12-31T14:59:59Z", 2013, 422),
    ],
)
def test_birth_year_minimum_age(app, now, birth_year, status):
    # 세션이 만료되지 않게 고정한 시각 안에서 가입한다(가입 픽스처는 출생연도 1994를 넣는다).
    with freeze_time(now), authenticated_client(app, "first@example.com") as auth_client:
        response = auth_client.put("/api/profile", json={"birthYear": birth_year})
        assert response.status_code == status, response.text
        if status == 422:
            assert response.json()["error"] == {
                "code": "VALIDATION_ERROR",
                "message": "입력값을 확인해 주세요.",
                "details": [{"field": "birthYear", "message": AGE_MESSAGE}],
            }
            # 거절하면 저장된 출생연도(가입 픽스처의 1994)를 바꾸지 않는다.
            assert auth_client.get("/api/profile").json()["birthYear"] == 1994
        else:
            assert response.json()["birthYear"] == birth_year
            assert response.json()["age"] == 14


def test_existing_range_check_is_kept(auth_client):
    # 기존 범위 검사(1920~올해−10)는 그대로 먼저 적용된다.
    with freeze_time("2026-10-16"):
        for birth_year in [1919, 2017]:
            response = auth_client.put("/api/profile", json={"birthYear": birth_year})
            assert response.status_code == 422
            assert response.json()["error"]["details"] == [
                {"field": "birthYear", "message": "출생연도를 확인해 주세요."}
            ]
