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

- 상단: 종목 검색 콤보박스(입력 300ms 디바운스 → `GET /api/market/stocks?q=`, 결과에 시장·업종 표시, 선택하면 담기), 그룹 탭(전체 + 그룹들), "그룹 관리"(이름 변경 = 해당 항목들 PATCH).
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
