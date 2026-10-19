# 11. 매매내역 업로드, 증권사 체결 동기화, 평가손익

> 웨이브 3 · 브랜치 `feature/11-journal-sync` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 04(임포트 엔진), 05(매매일지), 05b(수수료·세금 요율), 08(증권사 게이트웨이), 08b(국내 ETF·체결 비용 미제공 표시)가 develop에 병합된 상태.
> **수수료·세금(05b·08b)**: 증권사 체결의 `fee`·`tax`가 `None`(증권사 미제공, 예: 키움 kt00009)이거나 파일에 수수료·세금 열이 없거나 칸이 비면 `journal.service.estimate_trade_costs`(사용자 요율, 국내 ETF 매도 거래세 0)로 채우고 `cost_estimated=true`로 저장한다. 값이 있으면 그대로 쓴다. 착수 전에 코디네이터가 이 규칙을 6절·5절 본문에 맞춘다.
> **착수 직전 갱신**: 코디네이터는 디스패치 전에 05·08의 실제 코드와 08 `## 구현 결과`의 "키움·토스 기능 구현 여부" 표를 확인한다. 체결 조회(`EXECUTIONS`)가 어느 어댑터에서도 구현되지 않았다면 6절을 Mock 전용으로 줄이고 그 사실을 이 문서에 적은 뒤 디스패치한다.
> **갱신함(2026-10-17, 08·08b develop, 05b PR #17 `b9be65e` 기준)**:
>
> | 공급자 | 체결(`get_executions`) | 수수료·세금 |
> | --- | --- | --- |
> | 키움 | `kt00009` 구현. 날짜·주문번호·체결번호로 안정적 `external_id` | `None`(미제공) → 05b로 추정 |
> | 토스 | 미지원 → `501 BROKER_NOT_SUPPORTED` | |
> | Mock | 가상 체결 20건(`external_id` `mock-001` …) | 값 있음 |
>
> 08의 `Execution` = `external_id, executed_at, code, name, market(KOSPI·KOSDAQ·KONEX·NASDAQ·NYSE·AMEX·OTHER), side, quantity, price, fee, tax, currency`. 05의 `trades`는 `source in ('manual','import','kiwoom','toss')`·`broker in ('kiwoom','toss','other')` CHECK가 있고, 수동 입력 거래의 `dedup_hash`는 NULL이다(05b `create_trade`). 05b는 `estimate_trade_costs`와 같은 모듈의 `is_domestic_etf(db, market, symbol_code)`를 만들었다. 이에 맞춰 4·5·6·8절에 Mock 연결, 시장 변환, 중복 판정, 같은 파일 안 같은 거래 규칙을 더했다.

## 1. 목표

- 증권사에서 내려받은 매매내역 파일을 04 엔진으로 읽어 매매일지에 기록한다.
- 사용자 증권사 연결(08)로 체결 내역을 가져와 매매일지에 자동 기록한다(중복 없이).
- 보유 현황에 현재가·평가금액·평가손익을 붙인다.

## 2. 범위

### 포함

- `journal_0003` 마이그레이션(`down_revision="journal_0002"`, 05b 다음), 임포트 종류 `journal_trades`
- 체결 동기화 API와 상태
- `get_positions` 평가손익 확장, 서비스 함수 `import_trades`
- 화면 `/journal/import`, 보유 탭 평가손익 열

### 제외

- 증권사별 파일 프리셋: 실제 샘플(개인정보 제거)이 `backend/tests/journal/fixtures/presets/`에 있는 형식만. 없으면 동의어·LLM 매핑만.
- 자동 주기 동기화(스케줄러): 범위 밖. 사용자가 버튼으로 실행한다.

## 3. 소유 파일

- `backend/app/modules/journal/**`(05 코드 수정 포함)
- `backend/alembic/versions/journal_0003_*.py`
- `backend/tests/journal/**`
- `frontend/src/app/(app)/journal/import/**`(자리표시 교체), `frontend/src/app/(app)/journal/page.tsx`(보유 탭 수정)
- `frontend/src/features/journal/**`
- `frontend/tests/journal/**`
- 이 문서의 `## 구현 결과`

## 4. DB 변경 (revision `journal_0003`, `--head journal@head`)

- `trades`에 컬럼 추가: `connection_id uuid NULL`(08 연결 id, FK 없음), `external_id varchar(64) NULL`, `synced_at timestamptz NULL`.
- 부분 유일 인덱스 `(user_id, connection_id, external_id) WHERE external_id IS NOT NULL`.
- `trades.source` CHECK를 `source in ('manual','import','kiwoom','toss','mock')`로 바꾼다(개발용 Mock 연결 동기화). downgrade는 `source='mock'` 행을 지운 뒤 예전 CHECK로 되돌린다. `broker` CHECK는 그대로 두고 Mock 동기화 행의 `broker`는 NULL이다.

## 5. 임포트 종류 `journal_trades` (`journal/import_kind.py`)

| key | 라벨 | 타입 | 필수 | 동의어 |
| --- | --- | --- | --- | --- |
| `tradedOn` | 체결일 | date | 예 | 체결일, 체결일자, 거래일, 거래일자, 매매일, 매매일자, 주문일, 주문일자, 일자 |
| `tradedTime` | 체결시각 | text | 아니오 | 체결시간, 체결시각, 시간, 주문시간 |
| `symbolCode` | 종목코드 | text | 아니오 | 종목코드, 종목번호, 코드, 티커, 심볼 |
| `symbolName` | 종목명 | text | 예 | 종목명, 종목, 상품명 |
| `side` | 매매구분 | enum | 예 | 매매구분, 구분, 거래구분, 매수매도, 주문구분 (`buy`: 매수, 매수체결, 현금매수, 신용매수, BUY / `sell`: 매도, 매도체결, 현금매도, 신용매도, SELL) |
| `quantity` | 수량 | decimal | 예 | 체결수량, 수량, 거래수량, 주문수량 |
| `price` | 단가 | decimal | 아니오 | 체결단가, 단가, 체결가, 체결가격, 가격 |
| `amount` | 거래금액 | decimal | 아니오 | 체결금액, 거래금액, 정산금액, 금액 |
| `fee` | 수수료 | decimal | 아니오 | 수수료 |
| `tax` | 세금 | decimal | 아니오 | 세금, 제세금, 거래세, 증권거래세 |
| `market` | 시장 | enum | 아니오 | 시장, 시장구분, 거래소 (`KRX`: KRX, 국내, 코스피, 코스닥, KOSPI, KOSDAQ / `US`: 미국, 해외, NASDAQ, NYSE, AMEX) |
| `currency` | 통화 | enum | 아니오 | 통화, 통화코드 (`KRW`: KRW, 원 / `USD`: USD, 달러) |

- `normalize_row`
  - `price`가 없으면 `amount ÷ quantity`. 둘 다 없으면 오류("단가 또는 거래금액이 필요합니다.").
  - `symbolCode`가 없으면 `market.service.search_stocks(db, symbolName, limit=5)`에서 이름이 정확히 같은 종목 하나를 찾아 채운다. 없거나 여럿이면 오류("종목코드를 찾지 못했습니다. 종목코드 열을 매핑해 주세요."). (`normalize_row`에 `db`가 필요하므로 커밋 직전 일괄 보정 단계에서 처리해도 된다. 미리보기에는 "커밋 때 종목코드를 찾습니다" 경고로 표시한다.)
  - `market`이 없으면 6자리 숫자 코드는 `KRX`, 그 외는 `US`. `currency`가 없으면 시장에서 정한다(05 규칙).
  - 이 추론은 **비어 있는 칸에만** 쓰고, 종목코드가 없는 행은 종목코드 보정이 끝난 뒤에 한다. 사용자가 매핑한 `market`·`currency` 값은 덮어쓰지 않는다(갱신 2026-10-17, 11 검증 F1). 종목명 보정은 국내 종목 마스터(08)로만 하므로 찾은 종목은 `KRX`다. 명시한 `market`이 `KRX`가 아니거나 명시한 `currency`가 `KRW`가 아니면 그 행은 오류(`field: "market"` 또는 `"currency"`, "찾은 종목의 시장·통화와 맞지 않습니다. 종목코드 열을 매핑해 주세요.")다. 미리보기 단계에서는 코드 없는 행의 시장·통화 불일치를 판정하지 않는다.
  - 시각이 없으면 05 규칙(09:00 KST, `timeKnown=false`).
- `dedup_hash` = `sha256("{user_id}|{traded_on}|{traded_time or ''}|{symbol_code}|{side}|{quantity}|{price}")`. `normalize_row`에는 `user_id`·`db`가 없으므로 `import_trades`가 계산한다. 같은 호출(한 파일) 안에 위 문자열이 같은 행이 여러 개면 두 번째부터 끝에 `|{n}`(n = 1, 2, …, 파일 안 순서)을 붙인다(10 5절과 같은 규칙: 같은 날 같은 값의 매수 두 건은 둘 다 저장하고, 같은 파일을 다시 올리면 중복으로 걸러진다).
- 수동 입력(05 `create_trade`)에는 `dedup_hash`를 넣지 않는다(지금 동작 유지).
- `commit`: `import_trades(..., source="import", batch_id=ctx.job_id)`. flush까지만 하고 commit·rollback은 04 엔진이 한다. 종목코드를 찾지 못한 행은 `ImportResult.failed`와 `errors`(`field: "symbolCode"`, `row_number`는 `rows`의 1부터 센 순서)로 돌려준다.

## 6. 체결 동기화

- `POST /api/journal/sync` `{"connectionId": "…", "from": "2026-09-01", "to": "2026-10-16"}`(기간 최대 90일, `to`는 오늘 이하)
  - `market.service.get_user_broker_client(db, user_id, connection_id).get_executions(from, to)`
  - 연결의 공급자·별칭은 `market.service.list_connections(db, user_id)`에서 같은 `id`로 찾는다(14와 같은 방식).
  - `Execution` → 거래: `traded_at=executed_at`, `time_known=true`, `symbol_code=code`, `symbol_name=name`, `external_id`, `connection_id`, `synced_at=now`. 시장은 `KOSPI`·`KOSDAQ`·`KONEX` → `KRX`, `NASDAQ`·`NYSE`·`AMEX` → `US`, `OTHER` → `currency`가 `KRW`면 `KRX`, `USD`면 `US`. `fee`·`tax`가 `None`이면 05b `estimate_trade_costs`(국내 ETF는 `is_domestic_etf`)로 채우고 `cost_estimated=true`.
  - 새 행의 `source`는 공급자(`kiwoom`·`toss`·`mock`), `broker`는 `kiwoom`·`toss`면 같은 값, `mock`이면 NULL.
  - 중복 판정은 체결마다 이 순서다.
    1. 같은 `(connection_id, external_id)` 행이 있으면 바뀐 값만 갱신한다. 실제로 바뀐 칸이 있으면 `updated`, 없으면 `unchanged`로 센다(같은 기간을 두 번 불러도 데이터가 그대로다).
       - 비용(갱신 2026-10-17, 웨이브 3 통합 검증 F1): 체결의 `fee`·`tax`가 `None`(증권사 미제공)이면 저장된 `fee`·`tax`·`cost_estimated`를 바꾸지 않는다. 요율을 바꿔도 지난 거래는 그대로이고(05b 3절), 사용자가 PATCH로 고친 비용도 남는다. 증권사가 값을 준 칸만 그 값으로 바꾸고, 두 칸 모두 증권사 값이면 `cost_estimated=false`다. 새로 삽입하는 체결만 지금 요율로 추정한다.
    2. 없으면, `connection_id`가 없는 내 거래(수동·파일) 중 체결일(KST)·종목코드·매매구분·수량·단가가 같고 아직 다른 체결과 짝지어지지 않은 거래가 있으면 건너뛴다(`skippedDuplicates`). 기존 거래 하나는 체결 하나만 가린다(같은 값 체결이 두 건이고 수동 거래가 한 건이면 한 건은 삽입). 수동 거래는 시각이 없을 수 있어 `dedup_hash`로 비교하지 않는다.
    3. 그 밖이면 삽입(`inserted`).
  - 응답 `200 {"inserted": 12, "updated": 0, "unchanged": 0, "skippedDuplicates": 3, "costEstimated": 12, "from": "…", "to": "…", "syncedAt": "…"}`. `costEstimated`는 이번 요청에서 수수료·세금을 05b 요율로 추정해 넣은 거래(삽입·갱신) 수다. 한 요청은 한 트랜잭션이다.
  - 오류: 연결 없음 404, 연결이 `active`가 아님 `409 BROKER_NOT_CONNECTED`, 어댑터 미지원 `501 BROKER_NOT_SUPPORTED`, 그 밖은 08의 에러 변환.
- `GET /api/journal/sync/status` → `200 {"items": [{"connectionId", "label", "provider", "lastSyncedAt": "…" | null, "tradeCount": 42}]}`(사용자 연결마다)

## 7. 평가손익

- `GET /api/journal/positions?withQuotes=true`(기본 true): 05 응답 항목에 `currentPrice`(문자열 decimal | null), `evalAmount`, `unrealizedPnl`, `unrealizedPnlRate`(숫자 %, 소수 둘째 자리), `quoteSource`를 더한다.
  - 평가금액 = 현재가 × 보유수량, 평가손익 = 평가금액 − 매입원가, 수익률 = 평가손익 ÷ 매입원가 × 100.
  - 현재가는 `market.service.get_quotes`(KRX만, 해외는 08이 지원할 때만). 실패하거나 없으면 null이고 나머지는 그대로 응답한다.
- `get_positions(db, user_id, *, include_closed=False, with_quotes=False)`로 키워드 인자를 추가한다(기존 호출은 그대로 동작).

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/journal/service.py (추가)
@dataclass(frozen=True)
class TradeImportRow:
    traded_at: datetime
    time_known: bool
    market: Literal["KRX", "US", "OTHER"]
    symbol_code: str             # 빈 문자열이면 import_trades가 종목명으로 찾는다(5절)
    symbol_name: str
    side: Literal["buy", "sell"]
    quantity: Decimal
    price: Decimal
    currency: Literal["KRW", "USD"]
    fee: Decimal | None = None   # None이면 05b estimate_trade_costs로 추정하고 cost_estimated=true
    tax: Decimal | None = None
    broker: str | None = None

def import_trades(db, user_id, rows: list[TradeImportRow], *, source: str, batch_id: UUID | None = None) -> ImportResult
```

- 종목코드 보정·비용 추정·`dedup_hash` 계산·삽입을 한다. 이미 있는 `dedup_hash`는 `skippedDuplicates`. flush까지만 하고 commit은 호출자(04 엔진)가 한다. `ImportResult`는 04의 타입이다.

## 9. 화면 명세

- `/journal/import`: 두 영역
  - "파일로 가져오기": `ImportWizard kind="journal_trades"`. 증권사 앱·HTS의 거래내역 내보내기 안내.
  - "증권사에서 불러오기": 연결 선택(활성 연결만, 없으면 `/settings/connections` 안내. 연결 목록은 08의 `GET /api/market/connections`를 `features/journal/api.ts`에서 부른다), 기간(기본 최근 30일, 최대 90일), "불러오기" → 결과 요약(삽입·갱신·변화 없음·건너뜀), 연결별 마지막 동기화 시각. 토스 연결을 고르면 "토스증권은 주문 하나를 한 건으로 가져옵니다. 여러 번에 나눠 체결된 주문은 평균 체결가로 합치고, 시간외 종가 주문은 토스가 제공하지 않아 빠집니다."를 보여 준다(2026-10-19 갱신, 08 4.4절 주문 단위 체결. 토스 전용 `501` 안내는 지운다. 그 밖의 `501`은 기존 오류 안내). 수수료·세금을 추정한 행이 있으면(동기화 응답 `costEstimated > 0`) "증권사가 수수료·세금을 주지 않아 기본 요율로 추정했어요"와 `/settings/trading-costs` 링크. 0이면 안내하지 않는다.
  - 저장 후 매매일지 쿼리(목록·보유·통계)를 무효화한다(10의 캐시 미갱신 지적과 같은 문제를 피한다).
- `/journal` 보유 탭: 현재가, 평가금액, 평가손익(색 규칙), 수익률 열 추가. `quoteSource=mock`이면 `SampleDataBadge`. 시세가 없으면 "-".
- 기록 탭: `source=mock` 거래에 "샘플" 배지(Mock 연결 동기화 결과).

## 10. 테스트

### 백엔드

- 가짜 매매내역 파일 3종(국내 CSV, 해외 XLSX, 종목코드 없는 파일)으로 업로드 → 매핑 → 커밋, 종목명으로 코드 찾기 성공·실패
- 동기화: MockBroker 체결 20건 → 첫 실행 20건 삽입, 두 번째 삽입 0건·`unchanged` 20건, 같은 거래를 시각 없이 수동으로 넣어 둔 경우 건너뜀(한 거래는 한 체결만), 키움 체결(respx 고정 응답)의 `fee`·`tax` None → 추정·`costEstimated=true`, 시장 변환(OTHER+KRW → KRX), 비활성 연결 409, 토스 501, Mock 연결 `source=mock`
- 같은 파일 안 같은 행 두 줄이 둘 다 저장되고, 같은 파일을 다시 올리면 전부 `skippedDuplicates`
- 평가손익 계산, 시세 실패 시 null, `with_quotes=False` 기존 동작 유지(05 테스트 회귀 없음)
- 사용자 격리 404(남의 연결 id로 동기화 시도 포함)

### 프론트

- 파일 위저드와 증권사 불러오기 흐름(MSW), 보유 탭 새 열과 샘플 배지

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] Mock 환경에서 연결(모의 키) 없이도 테스트로 동기화 흐름이 검증된다. 실제 키움 모의투자 키가 있으면 수동으로 확인하고 `## 구현 결과`에 적는다

## 12. 검증 체크리스트

1. 5절 필드·동의어·중복 키가 같고, 근거 샘플 없는 프리셋이 없다.
2. 동기화 upsert가 `(connection_id, external_id)` 유일 인덱스로 멱등이다.
3. 평가손익 공식과 null 처리.
4. 05의 기존 API·테스트가 깨지지 않았다.
5. `import_trades` 시그니처가 8절과 같다.
6. 사용자 격리 404.

## 구현 결과

- `journal_0003`에 연결 ID·체결 ID·동기화 시각, 부분 유일 인덱스와 Mock 원천 CHECK를 추가했다. downgrade는 Mock 거래를 삭제하고 이전 CHECK와 컬럼으로 되돌린다.
- `journal_trades`를 기존 임포트 엔진에 등록했다. 5절 필드·동의어, 금액÷수량 단가 계산, 종목명 정확 일치 검색, 누락 비용 추정, 같은 파일의 동일 행 `|n` 구분과 재업로드 중복 제외를 구현했다. 실제 증권사 샘플이 없어 프리셋은 만들지 않았다.
- `TradeImportRow`·`import_trades` 공개 계약을 추가했다. 소비 함수는 flush만 하며 커밋·롤백은 임포트 엔진이 담당한다. 기존 수동 입력의 비용 추정과 `dedup_hash=NULL` 동작은 유지한다.
- 체결 동기화와 연결별 상태 API를 구현했다. 체결 ID 우선 갱신·변화 없음 판정, 시각 없는 수동·파일 거래와 일대일 중복 비교, 시장 변환, 키움 미제공 비용 추정과 국내 ETF 거래세 0을 적용했다. 같은 사용자의 파일 저장·동기화는 트랜잭션 advisory lock으로 직렬화한다.
- 보유 현황에 KRX 현재가·평가금액·평가손익·수익률·시세 원천을 추가했다. 공개 서비스의 `with_quotes` 기본값은 false, API의 `withQuotes` 기본값은 true다. 시세 실패·미제공·미지원 해외 종목의 평가 값은 null이다.
- `/journal/import`에 파일 위저드와 활성 연결 선택·최근 30일 기본 기간·최대 90일 검증·결과 요약·마지막 동기화 시각·토스 미지원 안내·비용 설정 링크를 추가했다. 파일 저장과 동기화 완료 시 `journal` 전체 쿼리를 무효화한다. 보유 평가 항목과 기록·상세의 Mock 샘플 배지를 추가했다.
- 임포트 엔진에 행별 경고 확장 없이 종목코드 없는 파일의 저장 시 검색 안내를 가져오기 화면 상단에 항상 표시한다. 동기화가 정상 완료된 기존 체결도 `synced_at`을 갱신하되 업무 값이 같으면 `unchanged`로 집계한다. 별도 상태 테이블 없이 연결에 저장된 거래의 최대 동기화 시각과 건수를 조회한다.

검증 결과:

- `scripts/worktree-setup.sh --skip-install`: 슬롯 11·8011/3011·`finance_11` 준비 성공. 의존성 추가·재설치 없음.
- 백엔드 `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`: 통과, 1,174개 테스트. 기존 05·05b 회귀와 신규 파일·동기화·평가손익 테스트 포함.
- 별도 빈 DB `finance_11_impl_verify`에서 `uv run alembic upgrade heads` → `uv run alembic downgrade base` → `uv run alembic upgrade heads`: 통과, DB 삭제 완료.
- 프론트 `npm run lint`, `npx tsc --noEmit`, `npm run test -- --maxWorkers=2`, `npm run build`: 통과, 40개 파일·390개 테스트.
- Playwright의 독립 Chrome context에서 실제 로컬 API·화면으로 파일 업로드→매핑→미리보기→저장, Mock 첫 동기화 20건·재조회 `unchanged=20`, 기록 샘플 배지와 보유 평가손익을 확인했다. 360px·1280px에서 문서 너비가 뷰포트를 넘지 않으며 브라우저 오류는 없었다. 확인용 사용자는 삭제했고 `scripts/stop.sh`로 서버를 종료했다.
- 테스트는 FakeStructuredLLM·MockBroker·respx 고정 응답만 사용했다. 실제 증권사 키·Gemini·Ollama 호출은 하지 않았다. 실키 수동 검증은 수행하지 않았다.

PR #20 검증 수정:

- 코드 없는 행은 국내 종목 검색 전 시장·통화 불일치로 걸러지지 않도록 보류 상태로 정규화한다. 저장 시 국내 종목 검색으로 찾은 코드는 KRX로 처리하고, 명시한 시장 또는 통화가 KRX·KRW와 다르면 해당 필드 오류로 저장을 거부한다. 시장·통화 열이 없는 기존 종목명 검색 테스트도 유지한다.
- 동기화 응답의 `costEstimated`는 이번 요청에서 비용을 추정해 삽입·갱신한 거래 수다. 프론트는 이 값이 0보다 클 때만 비용 추정 안내를 표시한다.
- 테스트: Mock 동기화 `costEstimated=0` 및 안내 없음, 키움 고정 respx 응답의 None 비용은 추정 수 1 및 안내 표시. 실제 API 요청으로 재현 A(KRW→005930/KRX 저장), 재현 B(US/USD→시장 오류·거래 미생성), Mock 동기화의 `costEstimated=0`을 확인했다.

스펙과 다른 점: 없음. 위 행 경고 안내 위치와 마지막 동기화 시각 계산은 소유 범위에서 정한 구현 세부 사항이다.

남은 일: 코디네이터의 별도 검증 및 PR 병합. 실제 증권사 파일 프리셋과 실키 검증은 개인정보 제거 샘플·별도 지시가 있을 때 진행한다.

### 웨이브 3 통합 검증 수정

- F1: 같은 `(connection_id, external_id)` 체결을 갱신할 때 비용을 다시 추정하지 않는다. 증권사가 미제공한 `fee`·`tax`는 저장 값을 보존하고, 제공한 칸만 갱신한다. `cost_estimated`는 기존 값을 유지하되 두 비용이 모두 제공되면 false로 바꾼다. 신규 삽입만 현재 요율로 추정하며 응답의 `costEstimated`도 실제 추정해 삽입한 거래만 센다.
- 비용 미제공 MockBroker 고정 체결로 요율 변경 후 기존 추정값 보존, PATCH 비용·추정 여부 보존, 단가 변경 시 비용 보존, 신규 체결의 변경 요율 적용을 회귀 테스트에 추가했다. 한쪽 비용만 제공하거나 0원을 제공한 경우와 양쪽 제공 시 추정 표시 해제도 검증한다. 기존 키움 ETF 테스트는 재동기화에서 저장 비용을 유지하고 신규 삽입에서 ETF 거래세 0을 적용하도록 맞췄다.
- 검사: `scripts/worktree-setup.sh` 성공(슬롯 11, 의존성 추가 없음), 백엔드 `uv run ruff check .`·`uv run ruff format --check .` 통과, `uv run pytest` **1,195개 통과**. 기존 05·05b·11 테스트와 사용자 격리 검증을 포함한다. 프론트와 마이그레이션은 변경하지 않았다.
- 실제 서버(8011)에 독립 HTTP 클라이언트로 가입·로그인하고, 저장소 밖 임시 설정으로 MockBroker에 비용 미제공 매도 체결(005930, 10주×70,000원)을 고정했다. 최초 105·1400원 추정 후 요율을 0.1·0.3·0.5로 바꾸고 재동기화해 `unchanged=1`, 응답 `costEstimated=0`, 기존 비용 유지를 확인했다. PATCH로 123·456원을 지정한 후에도 `unchanged=1`과 저장된 `costEstimated=false`를 유지했다. 새 연결의 신규 체결은 700·2100원으로 추정했다. 확인용 사용자를 삭제하고 `scripts/stop.sh`로 서버를 종료했다.
- 외부 증권사·LLM 호출과 의존성 추가는 없다. 스펙과 다른 점은 없으며, 남은 일은 코디네이터의 별도 검증과 PR 병합이다.
