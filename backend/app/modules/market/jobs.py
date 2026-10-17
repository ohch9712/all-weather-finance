"""조회 전용 종목 마스터·스냅샷 갱신 명령."""

import argparse
import logging
from datetime import date, timedelta

from app.core.config import get_settings
from app.core.time import today_kst
from app.db.session import SessionLocal
from app.integrations.brokers.errors import BrokerError
from app.modules.market import service


def main(argv=None):
    parser = argparse.ArgumentParser(description="종목 데이터 갱신")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("refresh-stocks", "refresh-snapshot"):
        sub = commands.add_parser(name)
        sub.add_argument("--provider", choices=["mock", "kiwoom", "toss"], default=None)
        if name == "refresh-snapshot":
            sub.add_argument("--as-of", type=date.fromisoformat, default=None)
            sub.add_argument("--limit", type=int, default=None)
            sub.add_argument("--resume", action="store_true")
    prune = commands.add_parser("prune-snapshots")
    prune.add_argument("--keep-days", type=int, default=30)
    commands.add_parser("seed-mock")
    args = parser.parse_args(argv)
    if getattr(args, "limit", None) is not None and args.limit < 1:
        parser.error("--limit는 1 이상이어야 합니다.")
    if getattr(args, "keep_days", 30) < 1:
        parser.error("--keep-days는 1 이상이어야 합니다.")
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    settings = get_settings()
    provider = (
        "mock"
        if args.command == "seed-mock"
        else getattr(args, "provider", None) or settings.market_data_provider
    )
    client = service._make_client(
        provider,
        settings.kiwoom_env,
        settings.kiwoom_app_key if provider == "kiwoom" else settings.toss_client_id,
        settings.kiwoom_app_secret if provider == "kiwoom" else settings.toss_client_secret,
    )
    with SessionLocal() as db:
        try:
            if args.command == "prune-snapshots":
                count = service.prune_snapshots(
                    db, today_kst() - timedelta(days=args.keep_days - 1)
                )
                logger.info("스냅샷 %d건 삭제", count)
                return 0
            if args.command in {"refresh-stocks", "seed-mock"}:
                count = service.refresh_stocks(db, client)
                logger.info("종목 %d건 갱신", count)
            if args.command in {"refresh-snapshot", "seed-mock"}:
                result = service.refresh_snapshot(
                    db,
                    client,
                    getattr(args, "as_of", None) or today_kst(),
                    limit=getattr(args, "limit", None),
                    resume=getattr(args, "resume", False),
                )
                logger.info(
                    "스냅샷 성공 %d, 실패 %d, 건너뜀 %d",
                    result["success"],
                    result["failed"],
                    result["skipped"],
                )
                return result["exit_code"]
        except BrokerError as exc:
            logger.error("종목 갱신 실패: %s", exc.code)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
