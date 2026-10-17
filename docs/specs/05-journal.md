# 05. 매매일지: 매매 기록, 매매 노트, 이동평균법 손익 통계

> 웨이브 2 · 브랜치 `feature/05-journal` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 파일 업로드와 증권사 체결 동기화, 현재가 기반 평가손익은 11에서 붙인다.

## 1. 목표

- 국내·미국 주식 매매를 직접 기록하고, 매수 이유·복기·메모를 노트로 남긴다(매매일지).
- 이동평균법으로 보유 수량·평균단가·실현손익을 계산하고 승률, 월별·일별 손익, 종목별 성과를 보여 준다.

## 2. 범위

### 포함

- 매매 CRUD, 노트 CRUD(거래·종목에 연결하거나 독립 메모)
- 보유 현황(수량·평균단가·매입원가·실현손익), 통계 API
- 화면 `/journal`(기록·보유·통계·노트 탭)
- 서비스 함수 `get_positions`, `get_trade_stats`

### 제외

| 항목 | 처리 |
| --- | --- |
| 파일 업로드, 증권사 체결 동기화, 현재가·평가손익 | 11 |
| 환율 환산 합계 | 범위 밖. 통화별로 따로 집계한다 |
| 공매도·신용·옵션 | 범위 밖. 매도 수량이 보유보다 많으면 경고만 한다 |

## 3. 소유 파일

- `backend/app/modules/journal/**`
- `backend/alembic/versions/journal_0001_*.py`
- `backend/tests/journal/**`
- `frontend/src/app/(app)/journal/page.tsx`(자리표시 교체), `frontend/src/app/(app)/journal/[id]/**`(신규). `journal/import/`는 11 소유
- `frontend/src/features/journal/**`
- `frontend/tests/journal/**`
- 이 문서의 `## 구현 결과`

## 4. 기술 결정

| 항목 | 결정 |
| --- | --- |
| 금액 표현 | 통화가 섞이므로 매매일지의 가격·수량·금액은 모두 문자열 decimal(architecture 4절). KRW는 소수 0자리, USD는 2자리로 응답한다(수량은 최대 6자리) |
| 계산 | `Decimal`, 원 미만·센트 미만은 마지막에 ROUND_HALF_UP |
| 거래 순서 | `traded_at` → `created_at` → `id` 오름차순 |
| 시각 미상 | 날짜만 알면 그날 09:00 KST로 저장하고 `timeKnown=false` |

## 5. 손익 계산 규칙 (이동평균법)

종목 키 = `(market, symbol_code, currency)`. 거래를 순서대로 처리한다.

- 매수: `보유수량 += q`, `매입원가 += q × p + 수수료 + 세금`
- 매도:
  - `가능수량 = min(q, 보유수량)`. `q > 보유수량`이면 그 거래에 `oversold = true` 경고를 붙이고, 초과분은 손익을 계산하지 않는다.
  - `평균단가 = 매입원가 ÷ 보유수량`(보유수량 0이면 손익 없음)
  - `실현손익 = 가능수량 × p − (수수료 + 세금) × 가능수량 ÷ q − 평균단가 × 가능수량`
  - `매입원가 −= 평균단가 × 가능수량`, `보유수량 −= 가능수량`
- 실현손익은 매도 거래의 `traded_at`(KST 날짜)에 귀속된다.
- 승: 실현손익 > 0, 패: < 0, 0은 승패에서 뺀다. 승률 = 승 ÷ (승 + 패) × 100, 매도가 없으면 `null`.

검증용 사례(KRW, 삼성전자 005930)

| 순서 | 거래 | 처리 후 보유 | 처리 후 매입원가 | 실현손익 |
| --- | --- | --- | --- | --- |
| 1 | 매수 10주 × 70,000, 수수료 100 | 10 | 700,100 | |
| 2 | 매수 10주 × 80,000, 수수료 100 | 20 | 1,500,200 | |
| 3 | 매도 5주 × 90,000, 수수료 100, 세금 810 | 15 | 1,125,150 | 74,040 |
| 4 | 매도 20주 × 60,000, 수수료 0, 세금 0 | 0 | 0 | −225,150 (`oversold`, 초과 5주 제외) |

- 3번: 평균단가 75,010 → 5 × 90,000 − 910 − 75,010 × 5 = 450,000 − 910 − 375,050 = 74,040
- 4번: 가능수량 15, 평균단가 75,010 → 15 × 60,000 − 0 − 75,010 × 15 = 900,000 − 1,125,150 = −225,150

## 6. DB 스키마 (revision `journal_0001`, `branch_labels=("journal",)`)

### 6.1 `trades`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `traded_at` | `timestamptz` | NOT NULL |
| `time_known` | `boolean` | NOT NULL, default true |
| `market` | `varchar(8)` | NOT NULL, CHECK `KRX, US, OTHER` |
| `symbol_code` | `varchar(20)` | NOT NULL. 대문자로 저장 |
| `symbol_name` | `varchar(100)` | NOT NULL |
| `side` | `varchar(4)` | NOT NULL, CHECK `buy, sell` |
| `quantity` | `numeric(20,6)` | NOT NULL, CHECK `> 0` |
| `price` | `numeric(20,6)` | NOT NULL, CHECK `> 0` |
| `currency` | `varchar(3)` | NOT NULL, CHECK `KRW, USD` |
| `fee` | `numeric(20,6)` | NOT NULL, default 0, CHECK `>= 0` |
| `tax` | `numeric(20,6)` | NOT NULL, default 0, CHECK `>= 0` |
| `broker` | `varchar(10)` | NULL, CHECK `kiwoom, toss, other` |
| `account_label` | `varchar(30)` | NULL |
| `source` | `varchar(8)` | NOT NULL, default `'manual'`, CHECK `manual, import, kiwoom, toss` |
| `dedup_hash` | `varchar(64)` | NULL. 11이 채운다 |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, traded_at)`, `(user_id, symbol_code)`, 부분 유일 `(user_id, dedup_hash) WHERE dedup_hash IS NOT NULL`. 05b가 `journal_0002`에서 `cost_estimated`와 `trade_cost_settings`를, 11이 `journal_0003`에서 `connection_id`, `external_id`, `synced_at`을 추가한다.

### 6.2 `trade_notes`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `trade_id` | `uuid` | NULL, FK `trades.id` ON DELETE SET NULL |
| `symbol_code` | `varchar(20)` | NULL |
| `noted_on` | `date` | NOT NULL |
| `kind` | `varchar(8)` | NOT NULL, CHECK `plan, review, memo` |
| `content` | `text` | NOT NULL, 1~5,000자 |
| `tags` | `varchar(20)[]` | NOT NULL, default `{}`, 최대 10개 |
| `emotion` | `varchar(12)` | NULL, CHECK `confident, calm, anxious, impulsive, greedy, fearful, regret` |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(user_id, noted_on desc)`, `(user_id, trade_id)`.

## 7. API 계약 (모두 인증 필요)

### 7.1 매매

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/journal/trades?from=&to=&symbol=&side=&page=1&pageSize=20` | `200 Page<Trade>` `traded_at desc` |
| `POST /api/journal/trades` | `201 Trade` |
| `GET /api/journal/trades/{id}` | `200 TradeDetail` |
| `PATCH /api/journal/trades/{id}` | `200 Trade` |
| `DELETE /api/journal/trades/{id}` | `204`(연결된 노트는 `trade_id`가 null이 된다) |

```json
// TradeInput
{ "tradedOn": "2026-10-15", "tradedTime": "10:32", "market": "KRX", "symbolCode": "005930", "symbolName": "삼성전자",
  "side": "buy", "quantity": "10", "price": "70000", "currency": "KRW", "fee": "100", "tax": "0",
  "broker": "kiwoom", "accountLabel": null }
// Trade = 위 필드 + id, tradedAt, timeKnown, source, createdAt, updatedAt
// TradeDetail = { "trade": Trade, "realizedPnl": "74040" | null, "oversold": false, "notes": [Note...] }
```

- `tradedTime`이 없으면 09:00 KST, `timeKnown=false`.
- 검증: `symbolCode` 1~20자(영문·숫자·`.`·`-`), `quantity`·`price` > 0, `fee`·`tax` ≥ 0, `market=KRX`면 `currency=KRW`, `market=US`면 `USD`(어기면 `422`, `field: "currency"`, "시장과 통화가 맞지 않습니다."). `tradedOn`은 2000-01-01 이상 오늘 이하.
- `from`·`to`는 `YYYY-MM-DD`(KST 날짜, 양끝 포함), `symbol`은 코드 또는 이름 부분 일치.

### 7.2 `GET /api/journal/positions?includeClosed=false`

```json
{ "items": [ { "market": "KRX", "symbolCode": "005930", "symbolName": "삼성전자", "currency": "KRW",
  "quantity": "15", "avgCost": "75010", "costBasis": "1125150", "realizedPnl": "74040",
  "firstTradedOn": "2026-09-01", "lastTradedOn": "2026-10-15", "tradeCount": 3, "hasOversold": false } ] }
```

- 기본은 보유 수량 > 0인 종목만, `includeClosed=true`면 청산된 종목도. 종목명은 가장 최근 거래의 이름.

### 7.3 `GET /api/journal/stats?from=&to=`

```json
{
  "byCurrency": [ { "currency": "KRW", "realizedPnl": "-151110", "winCount": 1, "lossCount": 1, "winRate": 50.0,
                    "sellCount": 2, "avgWin": "74040", "avgLoss": "-225150",
                    "bestTrade": { "tradeId": "…", "symbolName": "삼성전자", "realizedPnl": "74040", "tradedOn": "2026-10-10" },
                    "worstTrade": { … } } ],
  "monthly": [ { "month": "2026-10", "currency": "KRW", "realizedPnl": "-151110" } ],
  "daily": [ { "date": "2026-10-10", "currency": "KRW", "realizedPnl": "74040" } ],
  "bySymbol": [ { "symbolCode": "005930", "symbolName": "삼성전자", "currency": "KRW", "realizedPnl": "-151110", "sellCount": 2 } ]
}
```

- 손익 계산은 항상 전체 거래 이력으로 하고(평균단가 때문), 집계만 `from`~`to` 매도 거래로 한정한다.

### 7.4 노트

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/journal/notes?tradeId=&symbol=&kind=&from=&to=&page=` | `200 Page<Note>` `noted_on desc` |
| `POST /api/journal/notes` | `201 Note` |
| `PATCH /api/journal/notes/{id}` | `200 Note` |
| `DELETE /api/journal/notes/{id}` | `204` |

- `Note`: `{"id", "tradeId", "symbolCode", "notedOn", "kind", "content", "tags", "emotion", "createdAt", "updatedAt"}`
- `tradeId`는 내 거래여야 한다(아니면 `422`, `field: "tradeId"`). 태그는 공백 제거 후 1~20자, 중복 제거, 최대 10개.

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/journal/service.py
def get_positions(db, user_id, *, include_closed: bool = False) -> list[Position]
def get_trade_stats(db, user_id, start: date | None = None, end: date | None = None) -> TradeStats
```

- `Position`, `TradeStats`는 7.2·7.3 응답과 같은 필드의 모델이다. 15(챗봇)·16(대시보드)이 쓰고, 11이 `import_trades`를 이 파일에 더한다.

## 9. 화면 명세 (`/journal`)

- 탭: 기록 / 보유 / 통계 / 노트. 탭은 URL 쿼리(`?tab=`)에 반영한다.
- 기록: 기간·종목 검색·매수/매도 필터, 표(날짜, 종목, 매수·매도 배지, 수량, 단가, 금액, 수수료+세금, 출처), "매매 추가", "파일로 가져오기"(`/journal/import`, 11 전까지 자리표시). 행을 누르면 `/journal/[id]`.
- 매매 추가·수정 다이얼로그: 날짜, 시각(선택), 시장(KRX/US), 종목코드·종목명, 매수/매도, 수량, 단가, 통화(시장에 따라 자동), 수수료, 세금, 증권사, 계좌 별칭. 저장 후 "이 거래에 노트 남기기" 버튼.
- `/journal/[id]`: 거래 정보, 이 거래의 실현손익(매도면), `oversold` 경고, 연결된 노트 목록과 노트 추가.
- 보유: 종목별 수량, 평균단가, 매입원가, 실현손익, 거래 수. `hasOversold`면 경고 아이콘과 "기록이 빠진 매수가 있는지 확인해 주세요."
- 통계: 통화 선택(KRW/USD), 요약 카드(실현손익, 승률, 평균 수익, 평균 손실), 최고·최악 거래, 월별 손익 막대, 일별 손익 달력(월 단위 격자, 수익은 빨강·손실은 파랑 농도), 종목별 성과 표.
- 노트: 종류·기간 필터, 카드 목록(종류 배지, 감정 이모지 대신 한국어 라벨: 확신, 차분, 불안, 충동, 욕심, 두려움, 후회), 노트 추가(종류, 날짜, 내용, 태그, 감정, 종목·거래 연결 선택).
- 손익 색은 국내 관례(수익 빨강, 손실 파랑)로 `MoneyText`와 같은 규칙을 쓴다. 통화 표시는 KRW `원`, USD `$`.

## 10. 테스트

### 백엔드 (`backend/tests/journal/`)

- 5절 검증 사례 4단계(보유·매입원가·실현손익·oversold)
- 같은 날 시각 미상 거래 순서(created_at), 통화별 분리, USD 소수 계산·반올림
- 승률(0손익 제외, 매도 없음 null), 월별·일별·종목별 집계, 기간 필터가 평균단가에 영향 주지 않음
- 검증 422(시장·통화 불일치, 0 수량, 미래 날짜, 남의 tradeId), 거래 삭제 시 노트 `trade_id` null
- 다른 사용자 거래·노트 404

### 프론트 (`frontend/tests/journal/`, MSW)

- 매매 추가·수정·삭제, 시장 선택 시 통화 자동 설정
- 보유·통계 탭 렌더링(달력 색 구분 포함), 노트 추가와 거래 연결

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 5절 사례를 화면에서 입력하면 보유·통계가 표와 같은 값을 보여 준다

## 12. 검증 체크리스트

1. 5절 계산 규칙과 사례 값이 테스트로 고정돼 있다.
2. 모든 가격·수량·금액이 문자열 decimal이고 통화별 소수 자리 규칙을 지킨다.
3. 7절 경로·필드·상태코드·에러 코드가 같다.
4. 손익을 전체 이력으로 계산한 뒤 기간 필터를 적용한다.
5. `dedup_hash` 부분 유일 인덱스와 `source` 값이 6.1과 같다(11의 전제).
6. 서비스 함수 시그니처가 8절과 같다.
7. 사용자 격리 404.

## 13. 다음 단계 연결점

- 05b: 수수료·세금 기본 요율 설정과 추정(`journal_0002`).
- 11: `journal_trades` 임포트 종류, 증권사 체결 동기화(`journal_0003`), 보유 탭의 현재가·평가손익(08의 `get_quotes`).
- 15·16: `get_positions`, `get_trade_stats`.

## 구현 결과

### 구현한 것

- `journal_0001` 분기 마이그레이션으로 `trades`, `trade_notes`, 사용자별 조회 인덱스, `dedup_hash` 부분 유일 인덱스와 거래 삭제 시 노트 연결 해제 제약을 추가했다.
- 인증된 사용자의 매매·노트 CRUD, 기간·종목·종류 필터와 페이지네이션, 거래 상세·보유·통계 API를 구현했다. 다른 사용자의 거래·노트는 404이고, 노트에 다른 사용자 거래를 연결하면 `tradeId` 필드의 422다.
- 전체 이력을 `traded_at → created_at → id` 순서로 처리하는 Decimal 이동평균 계산을 구현했다. 초과 매도는 보유 수량만 계산하며, 통계 기간은 계산 이후 매도 집계에 적용한다. 공개 함수 `get_positions`, `get_trade_stats`와 응답 모델을 제공한다.
- 가격·금액은 KRW 0자리, USD 2자리로 마지막에 ROUND_HALF_UP하고 수량은 최대 6자리 문자열로 응답한다. 날짜만 입력한 거래는 09:00 KST, `timeKnown=false`로 저장한다.
- `/journal`의 기록·보유·통계·노트 탭과 URL 쿼리, `/journal/[id]` 상세 화면, 매매·노트 추가·수정·삭제, 저장 후 노트 연결, 통화 자동 설정, 초과 매도 경고와 투자 고지를 구현했다. 월별 막대, 일별 손익 달력, 종목별 성과 표를 제공한다.
- 비동기 거래 목록을 불러온 뒤에도 상세 화면에서 선택한 노트 연결 거래가 유지되도록 처리하고 회귀 테스트를 추가했다. `journal/import/`는 기존 11 담당 자리표시를 유지했다.

### 스펙에 없는 세부 결정

- PATCH는 전달된 필드만 기존 값과 합친 뒤 전체 입력을 다시 검증한다. 원본 DB decimal을 합치므로 응답용 반올림 값이 부분 수정에서 원본 정밀도를 덮어쓰지 않는다.
- 탭 쿼리 값은 `records`, `positions`, `stats`, `notes`이며, 없거나 잘못된 값이면 기록 탭을 보여 준다. 기록은 좁은 화면에서 같은 필드의 카드로 표시한다.
- 승·패가 각각 없으면 `avgWin`·`avgLoss`는 null이고, 계산 가능한 매도가 없으면 최고·최악 거래도 null이다. 매도 전부터 보유가 없는 초과 매도는 `realizedPnl=null`, `oversold=true`이며 매도 건수에는 포함한다. 청산된 종목의 평균단가는 0이다.
- 매수만 있는 통화도 통계 요약에 실현손익 0·승률 null로 포함한다. 각 손익은 반올림 전 값으로 집계한 뒤 응답 시 반올림한다.
- 의존성 추가나 공유 파일 직접 수정은 없다. 코디네이터 안내에 따라 공통 오류 도우미와 자리표시 테스트 수정이 포함된 develop을 병합했다.

### 검증 결과 (2026-10-17)

| 검사 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 05 준비·마이그레이션 성공 |
| `cd backend && uv run ruff check .` | 통과 |
| `cd backend && uv run ruff format --check .` | 통과 |
| `cd backend && uv run pytest` | 139개 통과(매매일지 28개 포함), 기존 Starlette 사용 중단 경고 1개 |
| 별도 빈 DB에서 `uv run alembic upgrade heads` → `uv run alembic downgrade base` → `uv run alembic upgrade heads` | 통과, 검증용 DB 삭제 완료 |
| `cd frontend && npm run lint` | 통과 |
| `cd frontend && npx tsc --noEmit` | 통과 |
| `cd frontend && npm run test` | 211개 통과(매매일지 9개 포함), 외부 API는 MSW로 대체 |
| `cd frontend && npm run build` | 통과 |
| 5절 사례 실제 화면 입력 | 1·2차 매수 원가 700,100원·1,500,200원, 3차 거래 후 15주·평균 75,010원·원가 1,125,150원·실현 74,040원, 4차 초과 매도 −225,150원·청산 확인 |
| 실제 화면 통계·노트 | 합계 −151,110원·승률 50%, 달력 수익 빨강·손실 파랑, 거래 연결 노트 저장·한국어 감정 표시 확인 |
| 반응형 | 네 탭 360·768·1280px, 상세 360px에서 문서 가로 넘침 없음; 360px 매매·노트 다이얼로그 내부 폭 328px와 스크롤 폭 일치 |
| 소유 경로·외부 호출·고지 | 변경 경로가 소유 범위 내임을 확인, 실제 외부 API·LLM 호출 없음, 투자 고지 확인 |
| `scripts/stop.sh` | 기동한 프론트·백엔드 종료 완료 |

### 남은 일

- 이번 작업 범위의 남은 구현은 없다. 별도 검증 워커의 독립 검증과 코디네이터 병합이 필요하다.
- 파일 업로드·증권사 체결 동기화·현재가와 평가손익은 계약대로 11에서 추가한다.

### 검증 지적 F1 수정 (2026-10-17)

- 수정 다이얼로그를 열 때의 초기값을 고정하고, 제출값을 같은 API 입력 형식으로 정규화한 뒤 달라진 필드만 PATCH한다. 이름·계좌 별칭 수정에서 응답용 반올림 가격·수수료를 다시 보내지 않으므로 DB 원본 정밀도가 유지된다. 신규 매매는 전체 필드를 POST한다.
- 시장 변경으로 자동 설정된 통화도 초기 통화와 다르면 변경분에 포함한다. 실제 수정한 가격·수량·수수료·세금은 새 값을 보내며, 원래 표시값으로 되돌린 금액은 생략한다. 생성과 부분 수정의 API 요청 타입을 분리했다.
- `frontend/tests/journal/trade-patch.test.tsx`에 회귀 테스트 5개를 추가했다. 소수 단가 `10.005`·수수료 `0.001`인 AAPL 1,000주에서 이름·계좌 별칭만 수정할 때 원본 금액과 보유·실현손익·매입원가가 유지되는지, 금액 변경·시장과 통화 변경·금액 되돌리기의 정확한 PATCH 본문을 검사한다. 수정 전 5개 실패를 확인한 뒤 수정 후 통과했다.
- 공통 검사 재실행: 백엔드 `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`(139개), 프론트 `npm run lint`, `npx tsc --noEmit`, `npm run test`(216개, 매매일지 14개 포함), `npm run build` 모두 통과했다.
- 공용 쿠키를 사용하지 않는 독립 Playwright 브라우저 컨텍스트에 로그인해 실서버에서 확인했다. 이름·계좌 별칭 변경은 각각 그 필드 하나만 PATCH하고 원가 `10005.00`과 DB 원본 단가 `10.005000`·수수료 `0.001000`을 유지했다. 가격 `10.007`·수수료 `0.003`을 실제로 수정하면 두 필드만 PATCH하고 원가 `10007.00`으로 반영했다.
- 360px 수정 다이얼로그에서 문서 폭 360px, 다이얼로그 내부 폭·스크롤 폭 328px로 가로 넘침이 없었다. 검증용 사용자·거래를 삭제하고 독립 브라우저를 닫았으며 `scripts/stop.sh`로 서버를 종료했다.
