# 12. 관심종목과 종목 상세

> 웨이브 3 · 브랜치 `feature/12-watchlist` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 08(증권사 게이트웨이)이 develop에 병합된 상태. 07의 용어 slug를 링크로 쓴다.
> **착수 직전 갱신**: 코디네이터는 08의 실제 응답 형식(`StockDetail`, `Quote`, 캔들)과 이 문서를 대조한다.
> **ETF(08b)**: 종목에 `kind`(`stock`·`etf`)가 생긴다. 착수 전에 08b 결과에 맞춰 반영한다: 검색 결과·관심종목 행·상세 머리에 ETF 배지, ETF는 PER·PBR·ROE·EPS·BPS·외국인 비율이 null이므로 "—"로 보이고 지표 "?" 링크 대신 `/learn/etf`를 연결, 관심종목 담기는 ETF도 허용.
> **갱신함(2026-10-17, develop `4766e99` 기준, 08·08b 병합 후)**: 08의 실제 공개 형식은 아래와 같다. 5절에 `kind`, 7절에 ETF 표시·차트 요청·매매 기록 링크를 반영했다.
>
> | 08 API·함수 | 형식 |
> | --- | --- |
> | `GET /api/market/stocks?q=&kind=&limit=` | `{"items": [StockSummary], "source"}`. `StockSummary` = `code, name, market, sector, kind` |
> | `GET /api/market/stocks/{code}` | `StockDetail` = `StockSummary` + `snapshot`(`asOf, price, changeRate, marketCap, per, pbr, roe, eps, bps, foreignRatio, high52w, low52w, tradingValue, volume`, 모두 null 가능) + `quote`(`code, price, change, changeRate, volume, asOf, source`) + `source`. 없는 코드는 `404` |
> | `GET /api/market/quotes?codes=a,b` | `{"items": [Quote]}`. 코드 1~50개 |
> | `GET /api/market/stocks/{code}/candles?from=YYYY-MM-DD&to=YYYY-MM-DD` | `{"items": [{"date", "open", "high", "low", "close", "volume"}], "source"}`. 기간은 366일 이하(넘으면 `422`, `field: "to"`) |
> | `get_quotes(codes)` / `get_stock_detail(db, code)` | 시세는 30초 메모리 캐시. 운영자 클라이언트는 `lru_cache`로 같은 객체라 `get_quotes`로 한 번에 받은 뒤 `get_stock_detail`을 불러도 캐시가 맞아 증권사를 다시 부르지 않는다 |
>
> 지표가 비는 경우: 토스는 가격 외 지표가 모두 null, 키움 ETF는 거래대금·시가총액·재무지표·52주 고저가 null, Mock ETF는 재무지표 6개가 null이다.

## 1. 목표

- 종목을 검색해 관심종목으로 담고, 그룹·메모·순서를 관리한다.
- 관심종목 목록에 현재가·등락률·주요 지표를 보여 주고 30초마다 시세를 새로 고친다.
- 종목 상세 화면에서 시세, 기간별 차트, 지표(용어 설명 링크 포함), 관심종목 담기, 내 매매 기록 바로가기를 제공한다.

## 2. 범위

### 포함

- `watchlist_items`, 관심종목 API, 서비스 함수
- 화면 `/stocks/watchlist`, `/stocks/[code]`

### 제외

- 가격 알림, 실시간 웹소켓 시세: 범위 밖
- 해외 종목 시세: 08이 지원하는 범위만

## 3. 소유 파일

- `backend/app/modules/watchlist/**`
- `backend/alembic/versions/watchlist_0001_*.py`
- `backend/tests/watchlist/**`
- `frontend/src/app/(app)/stocks/watchlist/**`, `frontend/src/app/(app)/stocks/[code]/**`(자리표시 교체)
- `frontend/src/features/watchlist/**`, `frontend/src/features/stocks/**`(종목 검색 콤보박스·상세 컴포넌트. 13도 이 검색 컴포넌트를 쓰지 않고 자기 것을 만든다)
- `frontend/tests/watchlist/**`
- 이 문서의 `## 구현 결과`

## 4. DB 스키마 (revision `watchlist_0001`, `branch_labels=("watchlist",)`)

### `watchlist_items`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `stock_code` | `varchar(20)` | NOT NULL(FK 없음) |
| `group_name` | `varchar(20)` | NOT NULL, default `'기본'` |
| `memo` | `varchar(200)` | NULL |
| `sort_order` | `integer` | NOT NULL, default 0 |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

UNIQUE `(user_id, stock_code)`, 인덱스 `(user_id, group_name, sort_order)`. 사용자당 최대 100개.

## 5. API 계약 (모두 인증 필요)

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/watchlist?group=` | | `200 {"items": [WatchlistItemView...], "groups": ["기본", "배당주"], "source": "mock"}` 그룹 → `sort_order` → 생성순 |
| `POST /api/watchlist` | `{"code": "005930", "groupName": "기본", "memo": null}` | `201 WatchlistItemView` |
| `PATCH /api/watchlist/{id}` | `{"groupName": "배당주", "memo": "실적 발표 확인"}` | `200 WatchlistItemView` |
| `PUT /api/watchlist/order` | `{"groupName": "기본", "ids": ["…", "…"]}` | `204`(배열 순서로 `sort_order` 재부여) |
| `DELETE /api/watchlist/{id}` | | `204` |

```json
// WatchlistItemView
{ "id": "…", "code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체", "kind": "stock",
  "groupName": "기본", "memo": null, "sortOrder": 0,
  "quote": { "price": "71200", "change": "-800", "changeRate": -1.11, "asOf": "…" } | null,
  "metrics": { "per": "12.40", "pbr": "1.30", "marketCap": 425000000000000 } | null,
  "source": "mock", "createdAt": "…" }
```

- `code`는 08 `stocks`에 있어야 한다(`get_stock_detail`가 None이면 `404 NOT_FOUND`, "종목을 찾을 수 없습니다."). 이미 있으면 `409 CONFLICT`("이미 관심종목에 있습니다."), 100개 초과 `409 CONFLICT`("관심종목은 100개까지 담을 수 있습니다.").
- 시세는 08 `get_quotes`로 한 번에 가져온다(30초 캐시). 실패하면 `quote: null`. 지표는 최신 스냅샷이고 값이 없으면 각 필드가 null이다(스냅샷이 없으면 `metrics: null`). `kind`는 08 종목의 종류다.
- `PUT /order`의 `ids`는 그 그룹의 내 항목 전부여야 한다(아니면 `422`, `field: "ids"`).

## 6. 다른 모듈용 서비스 함수

```python
# app/modules/watchlist/service.py
def list_items(db, user_id, *, group: str | None = None) -> list[WatchlistItemView]
def add_item(db, user_id, code: str, *, group_name: str = "기본", memo: str | None = None) -> WatchlistItemView   # 404 / 409
```

- 15(챗봇 도구)와 16(대시보드)이 쓴다.

## 7. 화면 명세

### 7.1 `/stocks/watchlist`

- 상단: 종목 검색 콤보박스(입력 300ms 디바운스 → `GET /api/market/stocks?q=`, 결과에 시장·업종 표시, 선택하면 담기), 그룹 탭(전체 + 그룹들), "그룹 관리"(이름 변경 = 해당 항목들 PATCH). "전체" 탭은 어떤 그룹 이름과도 겹치지 않는 값으로 구분한다(그룹 이름이 `__all__`이어도 일반 그룹 탭으로 동작. 갱신 2026-10-17, 웨이브 3 통합 검증 K4).
- 검색 결과·목록 행에서 `kind=etf`면 "ETF" 배지를 붙인다. ETF도 담을 수 있다.
- 목록 행: 종목명·코드, 현재가, 등락률(상승 빨강·하락 파랑·보합 회색), PER·PBR(null이면 "—"), 메모 아이콘, 위·아래 이동 버튼(순서 변경), 삭제. 행을 누르면 `/stocks/[code]`.
- 화면이 보이는 동안 30초마다 목록을 다시 불러온다(TanStack Query `refetchInterval`, 탭이 숨으면 멈춤).
- `source=mock`이면 `SampleDataBadge`, 아래 `Disclaimer variant="investment"`.
- 비었을 때: 검색 안내와 "조건검색으로 종목 찾기"(`/stocks/screener`) 링크.

### 7.2 `/stocks/[code]`

- 머리: 종목명, 코드, 시장, 업종, ETF 배지(`kind=etf`), 현재가와 등락, 관심종목 담기·빼기 토글, 샘플 배지.
- 차트: 기간 버튼(1개월·3개월·6개월·1년), 종가 선 그래프(`LineChart`), 데이터 없으면 안내. 요청은 `candles?from=<오늘(KST) − 기간>&to=<오늘>`(1년은 365일 전부터).
- 지표 격자: PER, PBR, ROE, EPS, BPS, 시가총액(`formatKRWCompact`), 52주 최고·최저, 외국인 비율, 거래대금. PER·PBR·ROE·EPS·시가총액 라벨 옆 "?"는 `/learn/per`, `/learn/pbr`, `/learn/roe`, `/learn/eps`, `/learn/market-cap`로 연결(07 시드 slug, develop에 있음 확인). 값이 null인 지표는 "—"다. ETF는 재무지표 "?" 링크 대신 격자 위에 "ETF란?"(`/learn/etf`) 링크를 둔다.
- "내 매매 기록 보기": `/journal?tab=records&symbol=<code>`(05의 탭 키는 `records`다. 기록 탭이 `symbol` 쿼리를 초기 종목 필터로 읽는 것은 05b가 같은 묶음에서 만든다. 12는 링크 주소만 테스트한다).
- 존재하지 않는 코드는 404 화면.
- `Disclaimer variant="investment"`.

## 8. 테스트

### 백엔드

- 담기·중복 409·없는 종목 404·100개 409, 수정, 순서 변경(누락 id 422), 삭제
- 목록에 시세·지표 병합, 시세 실패 시 null
- 서비스 함수, 사용자 격리 404

### 프론트

- 검색 콤보박스로 담기, 그룹 탭, 순서 이동, 삭제, 30초 재조회 설정
- 상세: 기간 전환, 지표 링크, 담기 토글, 404

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] `seed-mock` 후 검색 → 담기 → 상세 → 차트가 샘플 데이터로 동작한다

## 10. 검증 체크리스트

1. 5절 경로·필드·에러 코드·정렬 규칙이 같다.
2. 시세를 종목마다 따로 부르지 않고 한 번에 가져온다(호출 수 확인).
3. 용어 링크 slug가 07 시드와 일치한다.
4. 서비스 함수 시그니처가 6절과 같다.
5. 사용자 격리 404.

## 구현 결과

### 구현한 것

- 백엔드 `app/modules/watchlist`(models·schemas·repository·service·router), revision `watchlist_0001`(`branch_labels=("watchlist",)`, `down_revision="foundation_0001"`). 테이블·UNIQUE `(user_id, stock_code)`·인덱스 `(user_id, group_name, sort_order)`는 4절 그대로이고, 제약 이름은 `uq_watchlist_items_user_code`, `ix_watchlist_items_user_group_order`다.
- API 5개(5절 경로·필드·상태코드·에러 코드 그대로). 상태를 바꾸는 요청은 `require_json`을 쓴다. 공개 서비스 함수 `list_items`, `add_item`의 시그니처는 6절과 같고 테스트로 고정했다.
- 08은 `market.service`의 `get_quotes`, `list_snapshot_rows`, `search_stocks`만 쓴다(검증 후 수정 F2, 아래 절). 목록은 `list_snapshot_rows(db)`를 한 번 읽어 코드별 이름·시장·업종·`kind`·지표를 쓰고, 최신 스냅샷에 없는 코드만 `search_stocks(db, code, limit=1)`의 정확 일치로 채운다(지표 null). 시세는 `get_quotes(codes)`를 목록당 정확히 한 번 부르고 `get_stock_detail`은 부르지 않는다.
- 화면 `/stocks/watchlist`(`features/watchlist`), `/stocks/[code]`(`features/stocks`). 종목 검색 콤보박스(300ms 디바운스, 시장·업종 표시, ETF 배지, 키보드 선택), 그룹 탭(전체 + 그룹, 개수 표시), 그룹 관리(이름 변경 = 그 그룹 항목들을 순서대로 PATCH), 메모·그룹 편집 다이얼로그, 위·아래 이동(PUT `/order`, 낙관적 갱신), 삭제(확인 다이얼로그), 30초 `refetchInterval`(`refetchIntervalInBackground: false`), 빈 상태의 `/stocks/screener` 링크, `SampleDataBadge`, `Disclaimer variant="investment"`.
- 상세: 머리(종목명·코드·시장·업종·ETF 배지·현재가와 등락·담기/빼기 토글·샘플 배지), 기간 버튼 차트(1개월·3개월·6개월·1년, `LineChart`, 데이터 없음 안내), 지표 격자 10개(null은 "—", PER·PBR·ROE·EPS·시가총액 "?" → `/learn/per|pbr|roe|eps|market-cap`, 07 시드 slug 확인), ETF는 "ETF란?"(`/learn/etf`), "내 매매 기록 보기"(`/journal?tab=records&symbol=<code>`), 없는 코드는 404 화면.

### 스펙에 없어서 정한 것(소유 범위 안)

- 정렬: 그룹 이름 오름차순(가나다, Python 문자열 순서) → `sort_order` → `created_at` → `id`. `groups`도 같은 순서이고, `?group=`으로 걸러도 `groups`는 내 그룹 전체다. `?group=`(빈 값)은 전체다.
- 새 항목과 다른 그룹으로 옮긴 항목은 그 그룹의 맨 뒤(`max(sort_order)+1`)에 놓는다.
- 입력 검증(필드별 422는 `field_error`): `groupName`은 앞뒤 공백을 지우고 1~20자(`groupName`), `memo`는 공백을 지우고 200자 이하·빈 문자열은 null(`memo`), `code`가 공백뿐이면 `code`. PATCH의 `groupName: null`은 422다. `PUT /order`는 중복 id도 422(`ids`)이고 실패하면 순서를 바꾸지 않는다.
- 남의 항목·없는 항목은 `404 NOT_FOUND`("관심종목을 찾을 수 없습니다."). 동시에 같은 종목을 담아 UNIQUE에 걸리면 409 "이미 관심종목에 있습니다."로 바꾼다. 404(없는 종목) → 409(중복) → 409(100개) 순서로 검사한다.
- `metrics.per`·`pbr`는 소수 둘째 자리로 맞춘 문자열(`"31.86"`), `marketCap`은 정수다. `quote`는 `get_quotes` 결과만 쓴다(`price`·`change` 문자열, `changeRate` 숫자, `asOf`).
- `source`: 항목은 08 `StockDetail.source`, 응답 최상위는 `MARKET_DATA_PROVIDER`(08 목록 API의 `source`와 같은 값). 프론트는 둘 중 하나라도 `mock`이면 샘플 배지를 붙인다.
- 최신 스냅샷에도 없고 08 종목 마스터(상장 종목)에서도 찾지 못한 코드는 목록에 남겨 지울 수 있게 했다. 이때 `name`은 코드, `market`·`sector`·`metrics`는 null, `kind`는 `stock`이다(그래서 `market` 타입이 `string | null`이다). 최신 스냅샷 날짜에 행이 있으면 그 정보를 쓴다.
- 화면: 목록은 한 번에 받아 그룹 탭을 클라이언트에서 거른다. 그룹 탭을 고른 채 검색해 담으면 그 그룹에 담고, 전체 탭이면 "기본"에 담는다. 위·아래 이동은 같은 그룹 안에서만 된다. 메모 아이콘은 메모와 그룹(옮기기)을 함께 고치는 다이얼로그를 연다.
- 콤보박스는 shadcn `Command` 대신 ARIA combobox를 직접 만들었다(서버 검색 결과를 그대로 보여 주기 위해). 입력 blur 뒤 150ms 동안은 목록을 열어 둬, 터치처럼 결과를 누르기 전에 blur가 먼저 와도 고를 수 있다.
- 차트 기본 기간은 3개월이다. 1·3·6개월은 달력 기준(오늘이 그 달에 없는 날이면 그 달 마지막 날), 1년은 365일 전이다. 날짜는 KST 오늘 기준이다.
- 가격은 국내 시장이면 원 단위 정수로, 변동 금액이 null이거나 0이면 등락률만 보여 준다(Mock 시세의 `change`는 항상 0이다).
- ETF는 PER·PBR·ROE·EPS의 "?"만 빼고 시가총액 "?"는 남겼다(ETF에도 시가총액 값이 있다).
- 404는 07 학습 상세와 같이 화면 안의 `EmptyState`로 보여 준다(데이터를 클라이언트에서 불러오므로 `notFound()`를 쓰지 않는다).

### 확인 결과

- 백엔드: `uv run ruff check .` 통과, `uv run ruff format --check .` 통과(241 files), `uv run pytest` 1049 passed(watchlist 12개 포함).
- 마이그레이션: 빈 DB(`finance_12_cycle`, 확인 뒤 삭제)에서 `upgrade heads` → `downgrade base` → `upgrade heads` 성공, `alembic check` "No new upgrade operations detected."
- 프론트: `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run test` 38 files·377 tests 통과(`tests/watchlist` 26개), `npm run build` 성공.
- 실제 서버(슬롯 12, `seed-mock` 후, Orca isolated 프로필): 검색 → 담기(주식·ETF) → 목록(ETF 배지, PER·PBR "—", 등락 색) → 상세 → 차트(3개월) → 담기 토글 → ETF 상세("ETF란?") → 없는 코드 404 확인. 360px에서 `/stocks/watchlist`, `/stocks/005930`, `/stocks/069500` 모두 `scrollWidth` 360(가로 스크롤 없음).

### 남은 일

- 08 `get_quotes`는 일괄 조회가 `BrokerError`로 실패하면 내부에서 코드별로 다시 조회한다(08 설계, 이 작업 범위 밖). 그래서 증권사 장애 때 증권사 호출은 1 + 종목 수다. watchlist는 그 위에 호출을 더하지 않는다.
- `/journal?tab=records&symbol=`의 초기 종목 필터는 05b가 만든다. 12는 링크 주소만 테스트했다.
- 실제 키움·토스 시세로는 확인하지 않았다(테스트와 화면 확인은 Mock).

### 검증 후 수정(F1·F2)

- F1 동시 담기 상한: `add_item`이 개수를 세기 전에 같은 트랜잭션에서 사용자별 advisory lock(`SELECT pg_advisory_xact_lock(key)`, key는 `"watchlist:<user_id>"`의 blake2b 8바이트를 부호 있는 64비트 정수로 바꾼 값)을 건다. 중복·상한 확인과 삽입이 사용자 단위로 직렬화되고, 커밋하거나 409를 낼 때 트랜잭션을 끝내 잠금이 풀린다. 다른 그룹으로 옮기는 `PATCH`도 같은 잠금 안에서 맨 뒤 순서를 센다. `users` 등 다른 모듈 테이블은 잠그지 않는다.
- F2 목록 시세 호출: `_views`에서 `get_stock_detail`을 뺐다(위 "구현한 것" 참고). 종목 존재 확인(`add_item`의 404)도 `get_stock_detail` 대신 `search_stocks` 정확 일치로 바꿔 시세를 부르지 않는다. `get_quotes`가 `BrokerError`를 직접 던져도 `quote: null`로 응답한다.
- 회귀 테스트: `test_concurrent_adds_never_exceed_limit`(99개인 사용자, 별도 세션·스레드 8개 동시 `add_item` → 201 1건·409 `CONFLICT` 7건·최종 100개. 개수 확인 뒤 0.2초 지연을 넣어 잠금을 끄면 8건 모두 담겨 실패함을 확인), `test_empty_quotes_do_not_trigger_per_stock_calls`(빈 시세: `get_quotes` 1회·증권사 1회·상세 0회), `test_broker_error_returns_null_quote_without_detail_calls`(일괄 실패: `get_quotes` 1회·상세 0회), `test_get_quotes_raising_broker_error_returns_null_quote`, `test_stock_without_snapshot_uses_master_or_code`.
- 실제 서버(슬롯 12, MockBroker 시세 호출을 기록하는 저장소 밖 실행 스크립트): 4종목 목록 한 번에 증권사 시세 호출이 빈 결과 1회(수정 전 5회), 장애 5회(1회 + 08 내부 개별 재조회 4회, 수정 전 13회), 정상 1회, 30초 안 재조회 0회. 99개인 사용자로 서로 다른 유효 종목 8개를 동시에 `POST /api/watchlist` → 201 1건·409 7건, API·DB 모두 100개(두 번 반복, 확인용 사용자는 삭제).
- 검사: `uv run ruff check .` 통과, `uv run ruff format --check .` 통과, `uv run pytest` 1052 passed. 프론트는 바꾸지 않았다.

### 웨이브 3 통합 검증 수정

- 경미 K4: 전체 탭의 내부 값 `ALL_GROUPS`를 `"__all__"`에서 빈 문자열로 바꿨다. 그룹 이름은 기존 API 계약상 공백 제거 후 1~20자이므로 빈 문자열은 어떤 유효한 그룹 이름과도 겹치지 않는다. API와 그룹 이름 검증은 바꾸지 않았다.
- 회귀 테스트: `__all__` 그룹과 전체 탭의 단독 선택, 그룹별 목록 필터링, 그룹 선택 후 검색한 종목을 해당 그룹에 담기, 전체로 돌아와 모든 종목 보기와 기본 그룹에 담기를 확인한다.
- 검사: `scripts/worktree-setup.sh`, `npm run lint`, `npx tsc --noEmit`, `npm run build` 통과. `npm run test` 최초 실행은 가계부 테스트 2개가 5초 제한시간을 넘겼고(415 통과), 병렬 부하를 줄인 `npm run test -- --maxWorkers=2` 재실행은 43개 파일·417개 테스트 모두 통과했다. 백엔드와 의존성은 바꾸지 않았고 외부 API·LLM은 호출하지 않았다.
- 실제 서버(슬롯 12, Mock, Playwright 독립 세션): 새 계정 가입·로그인 후 삼성전자를 담고 그룹 이름을 `__all__`로 저장, 전체 탭에서 KODEX 200을 기본 그룹에 담기, 각 탭의 단독 선택과 필터링, `__all__` 탭에서 NAVER를 담아 실제 API 저장 그룹 확인, 전체 탭으로 복귀해 두 그룹 표시를 확인했다. 전체·그룹 화면 모두 360px·1280px에서 가로 스크롤이 없고 샘플 배지와 투자 고지가 유지된다.
- 스펙과 다른 점: 없음. 남은 일: 코디네이터의 별도 검증과 병합.
