"""개인 데이터가 남지 않도록 만료된 임포트 작업을 정리한다."""

import argparse

from app.core.time import now_utc
from app.db.session import SessionLocal
from app.modules.imports import repository


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="만료된 임포트 작업 정리")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("purge-expired")
    parser.parse_args(argv)
    with SessionLocal() as db:
        with db.begin():
            count = repository.remove_all_expired(db, now_utc())
    print(count)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
