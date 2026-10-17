from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.errors import AppError, field_error
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


def _views(db, items) -> list[WatchlistItemView]:
    codes = list(dict.fromkeys(item.stock_code for item in items))
    # 시세는 08 get_quotes로 한 번에 받는다(30초 캐시). 받지 못한 코드는 quote가 null이다.
    quotes = {quote.code: quote for quote in market_service.get_quotes(codes)} if codes else {}
    # get_quotes가 같은 운영자 클라이언트 캐시를 채웠으므로 상세 조회가 증권사를 다시 부르지 않는다.
    details = {code: market_service.get_stock_detail(db, code) for code in codes}
    fallback_source = market_source()
    views = []
    for item in items:
        detail = details[item.stock_code]
        quote = quotes.get(item.stock_code)
        snapshot = detail.snapshot if detail else None
        views.append(
            WatchlistItemView(
                id=item.id,
                code=item.stock_code,
                name=detail.name if detail else item.stock_code,
                market=detail.market if detail else None,
                sector=detail.sector if detail else None,
                kind=detail.kind if detail else "stock",
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
                source=detail.source if detail else fallback_source,
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


def add_item(
    db, user_id, code: str, *, group_name: str = DEFAULT_GROUP, memo: str | None = None
) -> WatchlistItemView:
    code = code.strip()
    if not code:
        raise field_error("code", "종목 코드를 입력해 주세요.")
    group = _group_name(group_name)
    memo = _memo(memo)
    if market_service.get_stock_detail(db, code) is None:
        raise AppError(404, "NOT_FOUND", "종목을 찾을 수 없습니다.")
    if repo.item_by_code(db, user_id, code) is not None:
        raise AppError(409, "CONFLICT", "이미 관심종목에 있습니다.")
    if repo.count_items(db, user_id) >= MAX_ITEMS:
        raise AppError(409, "CONFLICT", f"관심종목은 {MAX_ITEMS}개까지 담을 수 있습니다.")
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
        # 동시에 같은 종목을 담은 경우
        db.rollback()
        raise AppError(409, "CONFLICT", "이미 관심종목에 있습니다.") from None
    return _views(db, [item])[0]


def update_item(db, user_id, item_id: UUID, changes: dict) -> WatchlistItemView:
    item = _require_item(db, user_id, item_id)
    if "group_name" in changes:
        group = _group_name(changes["group_name"])
        if group != item.group_name:
            # 옮긴 그룹의 맨 뒤에 둔다.
            item.sort_order = repo.next_sort_order(db, user_id, group)
            item.group_name = group
    if "memo" in changes:
        item.memo = _memo(changes["memo"])
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
