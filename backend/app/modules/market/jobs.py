"""조회 전용 종목 마스터·스냅샷 갱신 명령."""

import argparse
import logging
from datetime import date, timedelta
from functools import partial

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.time import today_kst
from app.db.session import SessionLocal
from app.integrations.brokers.errors import BrokerError
from app.modules.market import repository, service


def auto_sync(db, today):
    # 공개 서비스는 함수 안에서 가져와 모듈 사이 순환 import를 피한다.
    from app.modules.allocation.service import sync_holdings
    from app.modules.journal.service import sync_connection_trades

    counts = {"ok": 0, "partial": 0, "failed": 0}
    for connection_id, user_id in repository.auto_sync_connections(db):
        outcomes = []
        errors = []
        try:
            client = service.get_user_broker_client(db, user_id, connection_id)
        except Exception as exc:
            db.rollback()
            outcomes = [False, False]
            errors.append(exc.code if isinstance(exc, AppError) else "INTERNAL_ERROR")
            logging.getLogger(__name__).warning("자동 동기화 예외: %s", type(exc).__name__)
        else:
            for capability, run in (
                ("HOLDINGS", partial(sync_holdings, db, user_id, connection_id)),
                (
                    "EXECUTIONS",
                    partial(
                        sync_connection_trades,
                        db,
                        user_id,
                        connection_id,
                        start=today - timedelta(days=6),
                        end=today,
                    ),
                ),
            ):
                if capability not in client.capabilities:
                    continue
                try:
                    run()
                    outcomes.append(True)
                except Exception as exc:
                    db.rollback()
                    outcomes.append(False)
                    errors.append(exc.code if isinstance(exc, AppError) else "INTERNAL_ERROR")
                    logging.getLogger(__name__).warning("자동 동기화 예외: %s", type(exc).__name__)
        status = "ok" if all(outcomes) else "partial" if any(outcomes) else "failed"
        error_code = errors[0] if errors else None
        repository.record_auto_sync(db, user_id, connection_id, status, error_code)
        counts[status] += 1
        print(f"auto-sync {connection_id} {status} {error_code or '-'}")
    print(
        f"auto-sync done total={sum(counts.values())} "
        f"ok={counts['ok']} partial={counts['partial']} failed={counts['failed']}"
    )


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
    automatic = commands.add_parser("auto-sync")
    automatic.add_argument("--today", type=date.fromisoformat, default=None)
    args = parser.parse_args(argv)
    if getattr(args, "limit", None) is not None and args.limit < 1:
        parser.error("--limit는 1 이상이어야 합니다.")
    if getattr(args, "keep_days", 30) < 1:
        parser.error("--keep-days는 1 이상이어야 합니다.")
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    if args.command == "auto-sync":
        try:
            with SessionLocal() as db:
                auto_sync(db, args.today or today_kst())
            return 0
        except Exception as exc:
            logger.error("자동 동기화 배치 실패: %s", type(exc).__name__)
            return 1
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
