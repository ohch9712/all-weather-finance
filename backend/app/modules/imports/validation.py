from typing import NoReturn


def invalid(field: str, message: str) -> NoReturn:
    # 코디네이터의 공용 field_error 도우미 반영 후 연결한다.
    raise NotImplementedError("공용 필드 오류 도우미 반영을 기다리고 있습니다.")
