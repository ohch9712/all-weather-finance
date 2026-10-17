from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.errors import AppError, field_error
from app.integrations.brokers.errors import BrokerError
from app.modules.market import service as market_service
from app.modules.watchlist import repository as repo
from app.modules.watchlist.schemas import (
    WatchlistItemView,
    WatchlistMetrics,
    WatchlistQuote,
)

DEFAULT_GROUP = "기본"
MAX_ITEMS = 100
GROUP_NAME_MAX = 20
MEMO_MAX = 200
CENT = Decimal("0.01")


def market_source() -> str:
    """시세·종목 데이터를 가져오는 운영자 공급자(08 MARKET_DATA_PROVIDER)."""
    return get_settings().market_data_provider


def _sort_key(item):
    # 그룹 → sort_order → 생성순. 같은 시각이면 id로 순서를 고정한다.
    return (item.group_name, item.sort_order, item.created_at, str(item.id))


def _ratio(value: Decimal | None) -> Decimal | None:
    return None if value is None else value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class _StockInfo:
    name: str
    market: str
    sector: str | None
    kind: str
    # 최신 스냅샷 행(08 SnapshotRow). 스냅샷이 없으면 None이고 metrics가 null이다.
    snapshot: object | None
    source: str | None


def _stock_infos(db, codes: list[str]) -> dict[str, _StockInfo]:
    """코드별 종목 정보와 지표. DB만 읽고 시세(증권사)는 부르지 않는다."""
    wanted = set(codes)
    rows = {
        row.code: row for row in market_service.list_snapshot_rows(db).rows if row.code in wanted
    }
    infos = {}
    for code in codes:
        row = rows.get(code)
        if row is not None:
            infos[code] = _StockInfo(row.name, row.market, row.sector, row.kind, row, row.source)
            continue
        # 최신 스냅샷에 없는 코드만 종목 마스터에서 정확히 같은 코드를 찾는다.
        match = _find_stock(db, code)
        if match is not None:
            infos[code] = _StockInfo(match.name, match.market, match.sector, match.kind, None, None)
    return infos


def _find_stock(db, code: str):
    matches = market_service.search_stocks(db, code, limit=1)
    return matches[0] if matches and matches[0].code == code else None


def _quotes(codes: list[str]) -> dict:
    """목록 전체 시세를 08 get_quotes 한 번으로 받는다(30초 캐시). 받지 못한 코드는 빠진다."""
    if not codes:
        return {}
    try:
        quotes = market_service.get_quotes(codes)
    except BrokerError:
        return {}
    return {quote.code: quote for quote in quotes}


def _views(db, items) -> list[WatchlistItemView]:
    codes = list(dict.fromkeys(item.stock_code for item in items))
    infos = _stock_infos(db, codes)
    quotes = _quotes(codes)
    fallback_source = market_source()
    views = []
    for item in items:
        info = infos.get(item.stock_code)
        quote = quotes.get(item.stock_code)
        snapshot = info.snapshot if info else None
        views.append(
            WatchlistItemView(
                id=item.id,
                code=item.stock_code,
                name=info.name if info else item.stock_code,
                market=info.market if info else None,
                sector=info.sector if info else None,
                kind=info.kind if info else "stock",
                group_name=item.group_name,
                memo=item.memo,
                sort_order=item.sort_order,
                quote=WatchlistQuote(
                    price=quote.price,
                    change=quote.change,
                    change_rate=quote.change_rate,
                    as_of=quote.as_of,
                )
                if quote
                else None,
                metrics=WatchlistMetrics(
                    per=_ratio(snapshot.per),
                    pbr=_ratio(snapshot.pbr),
                    market_cap=snapshot.market_cap,
                )
                if snapshot
                else None,
                source=(info.source if info else None) or fallback_source,
                created_at=item.created_at,
            )
        )
    return views


def _group_name(value) -> str:
    name = value.strip() if isinstance(value, str) else ""
    if not name:
        raise field_error("groupName", "그룹 이름을 입력해 주세요.")
    if len(name) > GROUP_NAME_MAX:
        raise field_error("groupName", f"그룹 이름은 {GROUP_NAME_MAX}자까지 입력할 수 있습니다.")
    return name


def _memo(value) -> str | None:
    if value is None:
        return None
    memo = value.strip()
    if len(memo) > MEMO_MAX:
        raise field_error("memo", f"메모는 {MEMO_MAX}자까지 입력할 수 있습니다.")
    return memo or None


def _require_item(db, user_id, item_id):
    item = repo.owned_item(db, user_id, item_id)
    if item is None:
        raise AppError(404, "NOT_FOUND", "관심종목을 찾을 수 없습니다.")
    return item


def list_items(db, user_id, *, group: str | None = None) -> list[WatchlistItemView]:
    items = sorted(repo.list_items(db, user_id, group or None), key=_sort_key)
    return _views(db, items)


def list_groups(db, user_id) -> list[str]:
    return sorted(repo.group_names(db, user_id))


def _conflict(db, message: str) -> AppError:
    # 사용자 잠금을 잡은 뒤의 실패는 트랜잭션을 끝내 잠금을 바로 푼다(성공도 커밋으로 끝난다).
    repo.end_transaction(db)
    return AppError(409, "CONFLICT", message)


def add_item(
    db, user_id, code: str, *, group_name: str = DEFAULT_GROUP, memo: str | None = None
) -> WatchlistItemView:
    code = code.strip()
    if not code:
        raise field_error("code", "종목 코드를 입력해 주세요.")
    group = _group_name(group_name)
    memo = _memo(memo)
    # 08 종목 마스터에서 코드가 정확히 같은 종목만 담는다(DB만 읽고 시세는 부르지 않는다).
    if _find_stock(db, code) is None:
        raise AppError(404, "NOT_FOUND", "종목을 찾을 수 없습니다.")
    # 같은 사용자의 담기를 직렬화해 동시 요청에서도 100개 상한과 정렬 순서를 지킨다.
    repo.lock_user(db, user_id)
    if repo.item_by_code(db, user_id, code) is not None:
        raise _conflict(db, "이미 관심종목에 있습니다.")
    if repo.count_items(db, user_id) >= MAX_ITEMS:
        raise _conflict(db, f"관심종목은 {MAX_ITEMS}개까지 담을 수 있습니다.")
    try:
        item = repo.create(
            db,
            dict(
                user_id=user_id,
                stock_code=code,
                group_name=group,
                memo=memo,
                sort_order=repo.next_sort_order(db, user_id, group),
            ),
        )
    except IntegrityError:
        # 잠금 밖에서 같은 종목이 먼저 들어간 경우(UNIQUE)
        db.rollback()
        raise AppError(409, "CONFLICT", "이미 관심종목에 있습니다.") from None
    return _views(db, [item])[0]


def update_item(db, user_id, item_id: UUID, changes: dict) -> WatchlistItemView:
    item = _require_item(db, user_id, item_id)
    group = _group_name(changes["group_name"]) if "group_name" in changes else item.group_name
    memo = _memo(changes["memo"]) if "memo" in changes else item.memo
    if group != item.group_name:
        # 옮긴 그룹의 맨 뒤에 둔다. 동시에 옮겨도 순서가 겹치지 않게 사용자 잠금 안에서 센다.
        repo.lock_user(db, user_id)
        item.sort_order = repo.next_sort_order(db, user_id, group)
        item.group_name = group
    item.memo = memo
    repo.save(db, item)
    return _views(db, [item])[0]


def reorder(db, user_id, group_name: str, ids: list[UUID]) -> None:
    group = _group_name(group_name)
    items = {item.id: item for item in repo.list_items(db, user_id, group)}
    if len(ids) != len(set(ids)) or set(ids) != set(items):
        raise field_error("ids", "그룹에 있는 관심종목을 빠짐없이 한 번씩 보내 주세요.")
    for index, item_id in enumerate(ids):
        items[item_id].sort_order = index
    repo.save(db)


def delete_item(db, user_id, item_id: UUID) -> None:
    repo.delete(db, _require_item(db, user_id, item_id))
