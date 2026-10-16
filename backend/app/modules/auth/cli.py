import argparse

from app.db.session import SessionLocal
from app.modules.auth.service import make_admin


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="관리자 권한을 설정합니다.")
    parser.add_argument("command", choices=["make-admin"])
    parser.add_argument("email")
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        if not make_admin(db, args.email):
            print("사용자를 찾을 수 없습니다.")
            return 1
    print("관리자 권한을 설정했습니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
