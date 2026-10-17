# 08. 증권사 게이트웨이: 어댑터, 종목 마스터, 시세, 종목 스냅샷, 증권사 연결

> 웨이브 2 · 브랜치 `feature/08-market` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 사용처: 11(체결 동기화), 12(관심종목), 13(조건검색), 14(잔고 반영).

## 1. 목표

- 키움 REST API와 토스증권 Open API를 같은 인터페이스(`BrokerClient`) 뒤에 두고, 키 없이도 동작하는 `MockBroker`를 기본으로 쓴다.
- 운영자 키로 국내 종목 마스터와 일별 종목 스냅샷(가격·시가총액·PER·PBR·ROE 등)을 모아 조건검색의 데이터로 쓴다.
- 사용자가 자기 증권사 앱키를 등록·검증할 수 있게 한다(암호화 저장). 계좌 데이터(잔고·체결)는 사용자 연결로만 가져온다.
- **조회 전용**이다. 주문·정정·취소 기능은 어디에도 만들지 않는다.

## 2. 범위

### 포함

- `app/integrations/brokers/`: 인터페이스, 에러, 호출 한도, Mock, Kiwoom, Toss 어댑터
- `app/modules/market/`: 종목·스냅샷·연결 테이블, API, 배치 명령, 서비스 함수
- 화면 `/settings/connections`(증권사 연결 부분)

### 제외

| 항목 | 처리 |
| --- | --- |
| 체결을 매매일지로 동기화 | 11 |
| 관심종목·종목 상세 화면 | 12 |
| 조건검색 화면·필터 DSL | 13 |
| 잔고를 자산배분에 반영 | 14 |
| 해외 종목 스냅샷 | 범위 밖(국내 KOSPI·KOSDAQ만) |
| 실시간 시세 웹소켓 구독 | 범위 밖(필요할 때 조회 + 30초 캐시) |

## 3. 소유 파일

- `backend/app/integrations/brokers/**`(고정 데이터 `brokers/fixtures/**` 포함)
- `backend/app/modules/market/**`
- `backend/alembic/versions/market_0001_*.py`
- `backend/tests/market/**`
- `frontend/src/app/(app)/settings/connections/**`(자리표시 교체)
- `frontend/src/features/market/**`
- `frontend/tests/market/**`
- 이 문서의 `## 구현 결과`

## 4. 어댑터 인터페이스 (`integrations/brokers/base.py`)

```python
Market = Literal["KOSPI", "KOSDAQ", "KONEX", "NASDAQ", "NYSE", "AMEX", "OTHER"]
Capability = Literal["STOCK_LIST", "FUNDAMENTALS", "QUOTES", "CANDLES", "HOLDINGS", "EXECUTIONS", "CONDITIONS"]

@dataclass(frozen=True)
class StockInfo:        code: str; name: str; market: Market; sector: str | None
@dataclass(frozen=True)
class Fundamentals:     code: str; price: Decimal; change_rate: Decimal | None; volume: int | None; trading_value: int | None
                        market_cap: int | None; per: Decimal | None; pbr: Decimal | None; roe: Decimal | None
                        eps: Decimal | None; bps: Decimal | None; foreign_ratio: Decimal | None
                        high_52w: Decimal | None; low_52w: Decimal | None
@dataclass(frozen=True)
class Quote:            code: str; price: Decimal; change: Decimal | None; change_rate: Decimal | None; volume: int | None; as_of: datetime
@dataclass(frozen=True)
class Candle:           day: date; open: Decimal; high: Decimal; low: Decimal; close: Decimal; volume: int
@dataclass(frozen=True)
class BrokerHolding:    code: str; name: str; market: Market; quantity: Decimal; avg_price: Decimal | None
                        eval_amount: int | None; currency: Literal["KRW", "USD"]
                        # eval_amount는 원화 평가금액(정수 원). 증권사가 원화 값을 주지 않는 외화 보유분은 None(환율을 직접 곱하지 않는다. 14가 skipped로 알린다)
@dataclass(frozen=True)
class HoldingsSnapshot: holdings: list[BrokerHolding]; cash_krw: int | None; as_of: datetime
@dataclass(frozen=True)
class Execution:        external_id: str; executed_at: datetime; code: str; name: str; market: Market
                        side: Literal["buy", "sell"]; quantity: Decimal; price: Decimal; fee: Decimal; tax: Decimal
                        currency: Literal["KRW", "USD"]
@dataclass(frozen=True)
class ConditionInfo:    seq: str; name: str

class BrokerClient(Protocol):
    provider: Literal["mock", "kiwoom", "toss"]
    capabilities: frozenset[Capability]
    def list_stocks(self, market: Market) -> list[StockInfo]: ...
    def get_fundamentals(self, code: str) -> Fundamentals: ...
    def get_quotes(self, codes: list[str]) -> list[Quote]: ...
    def get_daily_candles(self, code: str, start: date, end: date) -> list[Candle]: ...
    def get_holdings(self) -> HoldingsSnapshot: ...
    def get_executions(self, start: date, end: date) -> list[Execution]: ...
    def list_conditions(self) -> list[ConditionInfo]: ...
    def run_condition(self, seq: str) -> list[str]: ...
```

- 지원하지 않는 메서드는 `BrokerError("BROKER_NOT_SUPPORTED", "이 증권사 연결에서는 지원하지 않는 기능입니다.")`.
- `BrokerError(code, message)`는 `app.core.errors.AppError`로 바꿀 때 architecture 4.1의 상태코드를 쓴다: `BROKER_AUTH_FAILED` 502, `BROKER_IP_NOT_ALLOWED` 502("증권사 포털에 이 서버의 IP를 허용 IP로 등록해 주세요."), `BROKER_RATE_LIMITED` 503, `BROKER_UNAVAILABLE` 502, `BROKER_NOT_SUPPORTED` 501.
- HTTP는 `httpx.Client`(타임아웃 10초)를 쓴다. 키·토큰·계좌번호는 로그에 남기지 않는다(01의 마스킹 필터 + 어댑터에서 직접 출력 금지).

### 4.1 호출 한도 (`ratelimit.py`)

- 토큰 버킷. 그룹별 초당 한도. 키움은 그룹 하나 초당 4회(공식 한도를 확인하면 그 값으로 바꾸고 출처를 주석에 남긴다). 토스는 `AUTH` 5, `MARKET_DATA` 15, `MARKET_DATA_CHART` 20, `ACCOUNT` 1, `ORDER_INFO` 6(09:00~09:10 KST는 3).
- `429`면 `Retry-After`를 따르고 최대 3번 지수 백오프 후 `BROKER_RATE_LIMITED`.

### 4.2 MockBroker (`mock.py`)

- `fixtures/mock_stocks.json`: KOSPI 50개·KOSDAQ 30개(실제 상장 종목 코드·이름·업종, 지표 값은 고정 시드로 만든 가상값), 가상 계좌 보유 5종목·예수금, 가상 체결 20건, 가상 조건식 2개(`{"seq": "0", "name": "샘플 저PER"}`, `{"seq": "1", "name": "샘플 대형주"}`).
- 모든 능력(capabilities 7개)을 지원한다. 결과는 결정적이다(시세는 스냅샷 가격 그대로).
- 응답·스냅샷의 `source`는 `mock`이고, 화면은 "샘플 데이터" 배지를 붙인다.

### 4.3 KiwoomBroker (`kiwoom.py`)

| 항목 | 값 | 상태 |
| --- | --- | --- |
| 도메인 | 운영 `https://api.kiwoom.com`, 모의 `https://mockapi.kiwoom.com`(KRX만) | 확인됨 |
| 웹소켓 | `wss://api.kiwoom.com:10000/api/dostk/websocket`(모의 `wss://mockapi.kiwoom.com:10000/...`) | 확인됨 |
| 토큰 | `POST /oauth2/token`(api-id `au10001`), 본문 `grant_type=client_credentials`, `appkey`, `secretkey`, 응답 `token`, `expires_dt` | 공식 문서로 재확인 |
| 요청 헤더 | `api-id`, `authorization: Bearer <token>`, 연속조회 `cont-yn`·`next-key` | 공식 문서로 재확인 |
| 종목 목록 | `ka10099`(종목정보 리스트), `POST /api/dostk/stkinfo`, 시장 구분 `mrkt_tp`(0 코스피, 10 코스닥) | 확인됨(필드명 재확인) |
| 기본 정보 | `ka10001`(주식기본정보), `POST /api/dostk/stkinfo`, 본문 `stk_cd`. PER·PBR·ROE·EPS·BPS·시가총액·250일 최고·최저 등 47개 필드 | 확인됨(필드명 재확인) |
| 조건검색 | 웹소켓 `LOGIN`(토큰) → `CNSRLST`(조건식 목록, seq) → `CNSRREQ`(seq, `search_type` "0" 단발 조회). 서버 `PING`은 그대로 돌려보낸다. 조건식은 HTS(영웅문)에서 만들어야 한다 | 확인됨 |
| 잔고·체결·일봉 | 계좌평가잔고, 주문체결내역, 일봉 차트의 api-id | **공식 저장소(Kiwoom-Securities/Kiwoom-REST-API)의 API 스펙에서 찾아 구현. 못 찾으면 `BROKER_NOT_SUPPORTED`** |

파싱 주의(확인된 사항)

- 값이 모두 문자열이고 `+`·`-` 부호가 붙는다(`"+70000"`, `"-1.25"`). 부호를 처리하는 변환기를 쓰고 `int()`를 바로 쓰지 않는다.
- 업무 오류도 HTTP 200으로 오고 `return_code`(0이 정상)·`return_msg`로 판단한다.
- 숫자로 시작하는 필드명(예: `250hgst`)이 있다. dict 키로 읽는다.
- 같은 종목도 거래소별 코드가 다르다(NXT `039490_NX`, SOR `039490_AL`). 이 프로젝트는 KRX 코드(접미사 없음)만 쓴다.
- 토큰은 만료 시각(`expires_dt`)까지 메모리에 캐시하고 만료 5분 전에 새로 받는다.
- IP 미등록·키 오류는 `return_code`/HTTP 상태를 보고 `BROKER_IP_NOT_ALLOWED`·`BROKER_AUTH_FAILED`로 바꾼다(정확한 코드값은 공식 문서에서 확인).

### 4.4 TossBroker (`toss.py`)

| 항목 | 값 | 상태 |
| --- | --- | --- |
| 도메인 | `https://openapi.tossinvest.com`(REST만, 모의투자 없음) | 확인됨 |
| 토큰 | `POST /oauth2/token`(`application/x-www-form-urlencoded`, client credentials), 24시간 유효, 캐시 | 확인됨 |
| 계좌 헤더 | `X-Tossinvest-Account` | 확인됨 |
| 제공 범위 | 시세(현재가·호가·체결·캔들 1분/일), 종목정보·전체 종목, 랭킹·지표, 섹터, 계좌(목록·보유·매수가능), 주문 조회 | 확인됨 |
| 미제공 | 스크리닝, 재무지표(PER 등), 관심종목 | 확인됨 → `FUNDAMENTALS`의 PER·PBR·ROE는 None |
| 경로·필드 | 개발자 포털의 OpenAPI 3.0 명세에서 확인해 구현. 명세를 구하지 못한 기능은 `BROKER_NOT_SUPPORTED` | 구현 시 확인 |

- 토스 어댑터는 조건검색(`CONDITIONS`)을 지원하지 않는다.
- 주문 생성·정정·취소 경로는 호출하지 않는다(코드에 경로 문자열도 두지 않는다).

## 5. DB 스키마 (revision `market_0001`, `branch_labels=("market",)`)

### 5.1 `stocks`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `code` | `varchar(20)` | PK. KRX 6자리 또는 해외 티커(대문자) |
| `market` | `varchar(8)` | NOT NULL, CHECK 4절 `Market` 값 |
| `name` | `varchar(100)` | NOT NULL |
| `sector` | `varchar(50)` | NULL |
| `listed` | `boolean` | NOT NULL, default true |
| `source` | `varchar(8)` | NOT NULL, CHECK `mock, kiwoom, toss` |
| `updated_at` | `timestamptz` | NOT NULL |

인덱스 `(name)`(검색용 `lower(name)` 함수 인덱스 또는 `pg_trgm` 없이 `ILIKE`로 충분).

### 5.2 `stock_snapshots`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `as_of` | `date` | PK 일부 |
| `code` | `varchar(20)` | PK 일부 |
| `price` | `numeric(20,4)` | NOT NULL |
| `change_rate` | `numeric(8,2)` | NULL(%) |
| `volume` | `bigint` | NULL |
| `trading_value` | `bigint` | NULL(원) |
| `market_cap` | `bigint` | NULL(원) |
| `per`, `pbr`, `roe` | `numeric(12,2)` | NULL(배, 배, %) |
| `eps`, `bps` | `numeric(20,2)` | NULL(원) |
| `foreign_ratio` | `numeric(6,2)` | NULL(%) |
| `high_52w`, `low_52w` | `numeric(20,4)` | NULL |
| `source` | `varchar(8)` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL |

인덱스 `(as_of)`.

### 5.3 `broker_connections`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `provider` | `varchar(8)` | NOT NULL, CHECK `kiwoom, toss, mock` |
| `environment` | `varchar(4)` | NOT NULL, CHECK `real, mock`(토스는 `real`만) |
| `label` | `varchar(30)` | NOT NULL. 사용자 안에서 UNIQUE |
| `app_key_enc`, `app_secret_enc` | `text` | NOT NULL(Fernet) |
| `account_no_enc` | `text` | NULL |
| `app_key_masked`, `account_no_masked` | `varchar(30)` | 끝 4자리만 남긴 값 |
| `status` | `varchar(12)` | NOT NULL, default `'unverified'`, CHECK `unverified, active, error` |
| `last_verified_at` | `timestamptz` | NULL |
| `last_error_code` | `varchar(40)` | NULL |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

## 6. API 계약 (모두 인증 필요)

### 6.1 종목·시세

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/market/stocks?q=삼성&market=KOSPI&limit=20` | `200 {"items": [{"code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체"}], "source": "mock"}` 코드 완전일치 → 이름 앞부분 일치 → 부분 일치 순, `limit` 1~50 |
| `GET /api/market/stocks/{code}` | `200 StockDetail`, 없으면 `404` |
| `GET /api/market/quotes?codes=005930,000660` | `200 {"items": [Quote...]}`, 코드 1~50개(넘으면 `422`) |
| `GET /api/market/stocks/{code}/candles?from=2026-01-01&to=2026-10-16` | `200 {"items": [{"date", "open", "high", "low", "close", "volume"}], "source"}`, 기간 최대 366일 |
| `GET /api/market/snapshot/status` | `200 {"asOf": "2026-10-16" \| null, "count": 80, "source": "mock" \| null}` |

```json
// Quote
{ "code": "005930", "price": "71200", "change": "-800", "changeRate": -1.11, "volume": 12345678, "asOf": "2026-10-16T05:12:00Z", "source": "mock" }
// StockDetail
{ "code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체",
  "snapshot": { "asOf": "2026-10-16", "price": "71200", "changeRate": -1.11, "marketCap": 425000000000000, "per": "12.40", "pbr": "1.30", "roe": "10.50",
                "eps": "5741.00", "bps": "54769.00", "foreignRatio": "53.20", "high52w": "88800", "low52w": "58000", "tradingValue": 879000000000, "volume": 12345678 } | null,
  "quote": Quote | null, "source": "mock" }
```

- 가격·지표(소수 의미가 있는 값)는 문자열 decimal, 등락률은 숫자(소수 둘째 자리), 시가총액·거래대금·거래량은 정수(architecture 4절).
- 시세는 `get_quotes`의 30초 메모리 캐시를 거친다. 외부 오류면 `quote: null`로 응답하고 상세 자체는 실패시키지 않는다.

### 6.2 증권사 연결

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/market/connections` | | `200 {"items": [Connection...]}` |
| `POST /api/market/connections` | `{"provider": "kiwoom", "environment": "mock", "label": "키움 모의", "appKey": "…", "appSecret": "…", "accountNo": "1234567890"}` | `201 Connection`(`status: "unverified"`) |
| `POST /api/market/connections/{id}/verify` | | `200 Connection`(토큰 발급 + 잔고 조회 성공이면 `active`, 실패면 `error`와 `lastErrorCode`) |
| `DELETE /api/market/connections/{id}` | | `204` |
| `GET /api/market/connections/egress-ip` | | `200 {"ip": "203.0.113.7" \| null}` 서버의 공인 IP(외부 IP 조회 서비스 1회 호출, 실패하면 null) |

- `Connection`: `{"id", "provider", "environment", "label", "appKeyMasked", "accountNoMasked", "status", "lastVerifiedAt", "lastErrorCode", "createdAt"}`. **키·시크릿 원문은 어떤 응답에도 넣지 않는다.**
- 검증: 토스는 `environment=real`만(`422`). `label` 중복 `409 CONFLICT`. 키는 1~200자.
- **개발용 Mock 연결**: `APP_ENV`가 `production`이 아니면 `provider: "mock"`(`environment: "mock"`, 키 칸은 아무 문자열)을 허용한다. 확인은 항상 성공(`active`)하고 `get_user_broker_client`는 `MockBroker`의 가상 계좌(보유 5종목·예수금·체결 20건)를 돌려준다. 운영에서는 `422`(`field: "provider"`). 11·14의 동기화 흐름을 키 없이 검증하는 데 쓴다. 화면의 증권사 선택에도 개발 환경일 때만 "샘플 증권사"로 보인다.
- 남의 연결·없는 id `404`.

## 7. 배치 명령 (`uv run python -m app.modules.market.jobs <명령>`)

| 명령 | 동작 |
| --- | --- |
| `refresh-stocks [--provider mock\|kiwoom\|toss]` | KOSPI·KOSDAQ 종목을 `stocks`에 upsert. 목록에서 사라진 종목은 `listed=false` |
| `refresh-snapshot [--provider ...] [--as-of YYYY-MM-DD] [--limit N] [--resume]` | 상장 국내 종목마다 기본 정보를 받아 `(as_of, code)` upsert. `--resume`은 이미 있는 행을 건너뛴다. 호출 한도를 지키고, 실패는 세고 계속한다. 성공률 90% 미만이면 종료 코드 1 |
| `prune-snapshots --keep-days 30` | 오래된 스냅샷 삭제 |
| `seed-mock` | `refresh-stocks` + `refresh-snapshot`을 Mock으로 실행(개발용, 몇 초) |

- `--provider` 기본값은 `MARKET_DATA_PROVIDER`. 진행 상황을 100건마다 로그로 남긴다.
- 개발·검증 환경은 `seed-mock`을 한 번 실행해야 12·13 화면에 데이터가 있다. 로드맵의 웨이브 통합 절차에 이 명령이 들어간다.

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/market/service.py
def get_market_data_client() -> BrokerClient
def get_user_broker_client(db, user_id, connection_id: UUID) -> BrokerClient      # 없음 404, active 아님 409 BROKER_NOT_CONNECTED
def search_stocks(db, query: str, *, limit: int = 20) -> list[StockSummary]
def get_stock_detail(db, code: str) -> StockDetail | None
def get_quotes(codes: list[str]) -> list[Quote]                                   # 30초 캐시, 실패한 코드는 빠진다
def list_snapshot_rows(db, as_of: date | None = None) -> SnapshotSet              # as_of 없으면 최신일

@dataclass(frozen=True)
class SnapshotRow:  # 5.2 컬럼 + name, market, sector(stocks 조인)
    ...
@dataclass(frozen=True)
class SnapshotSet:
    as_of: date | None
    source: str | None
    rows: list[SnapshotRow]
```

- 테스트에서 어댑터를 바꿀 수 있게 `get_market_data_client`는 FastAPI 의존성으로도 노출한다(`MarketDataClientDep`).

## 9. 화면 명세 (`/settings/connections`)

- 안내 상자: "증권사 연동은 조회만 합니다. 주문은 할 수 없습니다.", "키움·토스 포털에서 이 서버의 IP(`egress-ip` 결과)를 허용 IP로 등록해야 연결됩니다.", 키움 포털·토스 WTS 설정 경로 안내.
- 시장 데이터 상태: 원천(샘플 데이터면 `SampleDataBadge`), 기준일, 종목 수.
- 연결 목록 카드: 증권사, 환경(모의/실전), 별칭, 마스킹된 앱키·계좌, 상태 배지(미확인·정상·오류), 마지막 확인 시각, 오류 코드의 한국어 안내, "연결 확인" 버튼, 삭제(확인 대화상자).
- 추가 다이얼로그: 증권사, 환경(토스는 실전만), 별칭, 앱키, 시크릿(비밀번호 입력), 계좌번호. 저장 후 바로 "연결 확인"을 권한다.
- 17이 같은 페이지에 "데이터 자동 수집" 영역을 추가한다. 페이지를 섹션 컴포넌트 조합으로 만들어 두고 17이 섹션 하나를 더할 수 있게 한다.

## 10. 테스트

### 백엔드 (`backend/tests/market/`)

- MockBroker 전 메서드의 결정성
- Kiwoom: `respx`로 토큰·`ka10099`·`ka10001` 응답을 고정해 파싱(부호 문자열, `return_code` 오류, 숫자 시작 필드), 토큰 캐시·갱신, IP 오류 변환. 조건검색은 로컬 `websockets` 테스트 서버로 LOGIN → CNSRLST → CNSRREQ, PING 응답 확인
- Toss: 토큰(폼 인코딩), 계좌 헤더, 429 + `Retry-After` 재시도, 미지원 기능 501
- 호출 한도 버킷(시간 고정)
- 배치: `seed-mock` 결과 80행, `--resume` 건너뛰기, 성공률 계산, `listed=false` 처리
- API: 검색 순서, 상세(시세 실패 시 `quote: null`), 시세 50개 제한, 캔들 기간 제한, 연결 CRUD·검증 성공/실패, Mock 연결(개발 허용·운영 422), 응답에 원문 키 없음, 남의 연결 404
- 실제 외부 호출이 없음(respx `assert_all_mocked`)

### 프론트 (`frontend/tests/market/`, MSW)

- 연결 추가·확인·삭제, 상태 배지·오류 안내, IP 안내, 샘플 데이터 배지, 개발 환경의 샘플 증권사 선택지

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] `seed-mock` 후 `GET /api/market/stocks?q=삼성`, `/stocks/005930`, `/quotes`가 샘플 데이터로 응답한다
- [ ] 어댑터 코드에 주문 관련 경로·함수가 없다
- [ ] `## 구현 결과`에 키움·토스 각 기능의 구현 여부와 근거 문서(URL·스펙 파일 이름)를 표로 남긴다

## 12. 검증 체크리스트

1. 4절 인터페이스와 데이터 클래스가 문서와 같다(11·12·13·14의 전제).
2. 확인되지 않은 엔드포인트를 추측으로 구현하지 않았다. 구현한 키움·토스 기능마다 출처 주석이 있다.
3. 주문·정정·취소 코드가 없다(`grep -ri "order"` 결과 검토, 조회용 "주문 조회"만 허용).
4. 자격증명이 Fernet으로 저장되고, 응답·로그에 원문이 없다.
5. 호출 한도·재시도·에러 변환이 4.1과 같다.
6. 6절 응답 필드·숫자 표현(문자열 decimal / 정수 / 숫자)이 같다.
7. `list_snapshot_rows`가 최신일을 고르고 `stocks`와 조인된 이름·시장·업종을 준다.
8. 사용자 격리 404.

## 13. 다음 단계 연결점

- 11: `get_user_broker_client(...).get_executions` → 매매일지 동기화, `get_quotes` → 평가손익.
- 12: `search_stocks`, `get_stock_detail`, `get_quotes`, 캔들 API.
- 13: `list_snapshot_rows`, 키움 `list_conditions`·`run_condition`.
- 14: `get_holdings`.
- 18: 운영에서 고정 아웃바운드 IP와 스냅샷 배치 일정(장 마감 후 1회)을 정한다.
