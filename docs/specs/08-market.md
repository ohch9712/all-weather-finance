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
- **체결 없는 날의 `kt00009` 응답(운영 서버 실제 응답, 2026-10-19 코디네이터 확인. 공식 명세에는 없다)**: 그날 체결이 없으면 HTTP 200, `return_code: 20`, `return_msg`에 `[2000]`과 `관련자료가없습니다`가 들어 있고 `acnt_ord_cntr_prst_array`가 없다. 지금 어댑터는 이것을 `BROKER_UNAVAILABLE`로 바꿔, 체결이 없는 날이 하루라도 낀 기간의 체결 조회(11 매매일지 동기화)가 통째로 실패한다. `kt00009`에서만 이 조합(`return_code` 20 + 메시지에 `관련자료가없습니다`)을 그날 그 매도·매수 구분의 빈 결과로 처리하고 연속조회를 멈춘다. 다른 `return_code`, 다른 api-id, 메시지가 다른 20은 지금처럼 오류다. 코드 주석에 이 근거(공식 명세 미기재, 실제 응답 관찰일)를 남긴다.
- **`kt00009` 거래소 구분(2026-10-19 코디네이터 추가)**: 요청 `dmst_stex_tp`를 `"KRX"`에서 `"%"`(전체)로 바꾼다. 공식 명세의 값은 `%`(전체)·`KRX`·`NXT`(넥스트트레이드)·`SOR`(최선주문집행)이고, KRX만 조회하면 넥스트트레이드에서 체결된 거래가 매매일지에서 빠진다. 응답 행의 `dmst_stex_tp`(국내거래소구분)를 읽어 `external_id`를 정한다. 값이 비었거나 `KRX`이면 지금처럼 `{날짜}:{ord_no}:{cntr_no}`(이미 동기화한 KRX 체결이 다시 들어오지 않게 형식을 유지한다), 그 밖의 거래소면 끝에 `:{dmst_stex_tp}`를 붙인다. 종목코드는 접두어(A·J·Q)뿐 아니라 거래소 접미사(`_NX`·`_AL`)도 떼어 KRX 6자리로 맞춘다. 체결 없음 응답 처리와 연속조회는 그대로다. 잔고(`kt00018`)는 바꾸지 않는다.

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
- 계좌 목록: `GET /api/v1/accounts`(공식 명세 1.2.24 `getAccounts`, 계좌 헤더 없이 토큰만). 응답 `result[]`의 `accountNo`·`accountSeq`(정수)·`accountType`. 종합매매(`BROKERAGE`) 계좌만 온다. `TossBroker.list_accounts()`로 둔다(`BrokerClient` 프로토콜에는 넣지 않는다). `accountNo` 원문은 어댑터 밖으로 끝 4자리만 내보낸다.
- 토큰 무효화: 토스는 같은 client로 토큰을 다시 받으면 이전 토큰이 무효가 된다(공식 OAuth2 안내). 연결 클라이언트는 프로세스 안에서 캐시되므로(`_make_client`), 다른 클라이언트가 같은 키로 토큰을 받으면 캐시된 토큰이 401이 된다. 캐시한 토큰으로 보낸 요청이 401이면 토큰을 버리고 한 번만 새로 받아 같은 요청을 다시 보낸다. 새로 받은 토큰으로도 401이면 지금처럼 `BROKER_AUTH_FAILED`다(2026-10-19 코디네이터 추가).
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
| `POST /api/market/connections/toss-accounts` | `{"appKey": "…", "appSecret": "…"}` | `200 {"items": [{"accountSeq": "1", "accountType": "BROKERAGE", "accountNoLast4": "1234"}]}`(아래 "토스 계좌 불러오기") |
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
- 서버 공인 IP는 화면을 열 때 자동으로 조회하지 않는다. "서버 공인 IP 확인" 버튼을 누를 때만 `GET /api/market/connections/egress-ip`를 부르고(외부 IP 조회 서비스를 부르기 때문), 누르기 전에는 "버튼을 누르면 확인합니다"를 보여 준다. 결과는 그 화면에 머무는 동안 다시 부르지 않는다. API 계약은 그대로다(웨이브 4 통합 검증 F3).
- 시장 데이터 상태: 원천(샘플 데이터면 `SampleDataBadge`), 기준일, 종목 수.
- 연결 목록 카드: 증권사, 환경(모의/실전), 별칭, 마스킹된 앱키·계좌, 상태 배지(미확인·정상·오류), 마지막 확인 시각, 오류 코드의 한국어 안내, "연결 확인" 버튼, 삭제(확인 대화상자).
- 추가 다이얼로그: 증권사, 환경(토스는 실전만), 별칭, 앱키, 시크릿(비밀번호 입력), 계좌번호(키움). 저장 후 바로 "연결 확인"을 권한다.
- 토스 계좌 불러오기(2026-10-19 사용자 요청): 토스를 고르면 계좌 칸 대신 "계좌 불러오기" 버튼을 보여 준다. 앱키·시크릿이 비어 있으면 버튼을 끈다. 누르면 `POST /api/market/connections/toss-accounts`를 불러 결과를 선택 목록으로 보여 준다(항목 문구 `종합매매 ****1234`, `accountType`이 `BROKERAGE`가 아니면 그 값을 그대로). 계좌가 하나면 자동으로 고르고, 없으면 "토스증권 종합매매 계좌가 없습니다."를 보여 준다. 저장할 때 고른 `accountSeq`를 기존 `accountNo` 필드로 보낸다(연결 생성 API 계약은 그대로). 계좌를 고르기 전에는 저장 버튼을 끈다. 앱키·시크릿을 바꾸면 불러온 목록과 선택을 비운다. 오류는 기존 오류 코드 안내(IP 미등록·키 오류 등)를 그대로 보여 준다. 사용자가 accountSeq를 직접 입력하는 칸은 없앤다.
- 17이 같은 페이지에 "데이터 자동 수집" 영역을 추가한다. 페이지를 섹션 컴포넌트 조합으로 만들어 두고 17이 섹션 하나를 더할 수 있게 한다.

## 10. 테스트

### 백엔드 (`backend/tests/market/`)

- MockBroker 전 메서드의 결정성
- Kiwoom: `respx`로 토큰·`ka10099`·`ka10001` 응답을 고정해 파싱(부호 문자열, `return_code` 오류, 숫자 시작 필드), 토큰 캐시·갱신, IP 오류 변환. 조건검색은 로컬 `websockets` 테스트 서버로 LOGIN → CNSRLST → CNSRREQ, PING 응답 확인
- Toss: 토큰(폼 인코딩), 계좌 헤더, 429 + `Retry-After` 재시도, 미지원 기능 501
- 호출 한도 버킷(시간 고정)
- 배치: `seed-mock` 결과 80행, `--resume` 건너뛰기, 성공률 계산, `listed=false` 처리
- API: 검색 순서, 상세(시세 실패 시 `quote: null`), 시세 50개 제한, 캔들 기간 제한, 연결 CRUD·검증 성공/실패, Mock 연결(개발 허용·운영 422), 응답에 원문 키 없음, 남의 연결 404
- 토스 계좌 불러오기: respx로 토큰·`/api/v1/accounts` 고정, 응답에 `accountNo` 원문 없음(끝 4자리만), 키를 DB에 저장하지 않음·로그에 없음, 앱키·시크릿 빈 값 422, 403 → `BROKER_IP_NOT_ALLOWED`·401 → `BROKER_AUTH_FAILED`, 계좌 없음 빈 목록, 미인증 401
- 토스 토큰 무효화: 캐시 토큰 401 → 한 번 재발급 후 성공, 재발급 토큰도 401이면 `BROKER_AUTH_FAILED`(재시도 한 번뿐)
- 키움 `kt00009` 거래소 구분: 요청 본문 `dmst_stex_tp="%"`, KRX·빈 값 행의 `external_id` 형식 유지, NXT·SOR 행의 `:NXT`·`:SOR` 접미사, 같은 `ord_no`·`cntr_no`가 KRX와 NXT에 함께 있어도 두 건으로 남음, 종목코드 접두어·`_NX`·`_AL` 접미사 제거
- 실제 외부 호출이 없음(respx `assert_all_mocked`)

### 프론트 (`frontend/tests/market/`, MSW)

- 연결 추가·확인·삭제, 상태 배지·오류 안내, IP 안내, 샘플 데이터 배지, 개발 환경의 샘플 증권사 선택지
- 토스 계좌 불러오기: 버튼 비활성 조건, 한 개 자동 선택, 여러 개 선택, 없음 안내, 오류 안내, 키 변경 시 선택 초기화, 저장 요청의 `accountNo`가 고른 accountSeq, 키움 폼은 그대로 계좌번호 칸

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

## 구현 결과

### 구현 내용

- 조회 전용 `BrokerClient`와 고정 MockBroker, 키움·토스 어댑터, 오류 변환, 토큰 캐시·갱신, 호출 제한 및 429 최대 3회 재시도를 구현했다.
- KOSPI 50개·KOSDAQ 30개의 종목 식별 정보를 KRX KIND 상장법인 목록과 대조했다. 가격·지표·계좌 5종목·예수금·체결 20건·조건식 2개는 결정적인 가상 데이터다.
- `market_0001` 마이그레이션에 종목·스냅샷·연결 테이블을 추가했다. 연결 자격증명은 공통 Fernet 함수로 암호화하고 API에는 끝 4자리만 반환한다. 사용자별 연결 조회·검증·삭제는 소유자를 확인한다.
- 인증된 종목 검색·상세·시세·일봉·스냅샷 상태 API와 연결 CRUD·검증·공인 IP 조회 API, 30초 시세 캐시, 최신일 조인 스냅샷 공개 함수를 구현했다. 다른 모듈에서 가져올 수 있도록 `service.MarketDataClientDep`를 노출했다.
- `refresh-stocks`, `refresh-snapshot`(기준일·개수·재개·성공률), `prune-snapshots`, `seed-mock` 배치 명령을 구현했다.
- `/settings/connections`에 조회 전용·IP 등록 안내, 시장 데이터 상태, 샘플 배지·고지, 연결 추가·확인·삭제를 구현했다. `BrokerConnectionsSection`을 분리하여 17의 자동 수집 섹션을 같은 페이지에 조합할 수 있다.

### 증권사별 구현 및 공식 근거

키움은 [공식 저장소](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/tree/953e5db)의 `kiwoom/_data/kiwoom_api_spec.json`과 `kiwoom/core/ws_client.py`, 토스는 [공식 OpenAPI JSON](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json) 버전 **1.2.24**를 확인했다(2026-10-17). 구현한 경로·필드의 출처는 어댑터 코드에도 기록했다.

| 증권사 | 기능 | 구현 여부·제한 | 공식 근거(스펙 파일·API) |
| --- | --- | --- | --- |
| 키움 | 인증 | 구현. 만료 5분 전 갱신, IP·키·한도 오류 변환 | `kiwoom_api_spec.json`: `au10001`, `error_codes` |
| 키움 | 종목 목록 | 구현. KOSPI·KOSDAQ·KONEX와 연속 조회 | 같은 파일: `ka10099`, `list.code/name/upName` |
| 키움 | 기본정보·시세 | 구현. 부호 문자열·250일 최고/최저 처리, 시가총액 억원→원. 거래대금은 미제공으로 null | 같은 파일: `ka10001`, `mac`, `250hgst`, `250lwst` |
| 키움 | 일봉 | 구현. KRX·수정주가·연속 조회·기간 필터 | 같은 파일: `ka10081` |
| 키움 | 잔고 | 구현. 토큰에 연결된 국내 잔고. 시장 구분 정보·예수금 미제공으로 `market=OTHER`, `cash_krw=None` | 같은 파일: `kt00018` |
| 키움 | 개별 체결 | 구현. 날짜별·매수/매도 필터별 조회, 날짜·주문번호·체결번호로 안정적 ID. **수수료·세금 미제공으로 fee/tax=Decimal(0)**(코디네이터 합의) | 같은 파일: `kt00009`, `cntr_no/cntr_tm/cntr_qty/cntr_uv` |
| 키움 | 조건검색 | 구현. LOGIN→CNSRLST→CNSRREQ(단발·KRX), PING 응답·연속 조회 | 같은 파일: `ka10171`, `ka10172`; `ws_client.py` |
| 토스 | 인증 | 구현. 폼 인코딩, `expires_in` 캐시·갱신, 401/403 변환 | `openapi.json` 1.2.24: `issueOAuth2Token` |
| 토스 | 종목 목록 | 구현. 시장별 전체 종목, 업종 미제공으로 null | 같은 파일: `listStocks` (`/api/v1/stocks/all`) |
| 토스 | 기본정보·시세 | 구현. 가격·기준시각 조회. 미제공 PER·PBR·ROE 등 지표·거래량·등락률은 null | 같은 파일: `getPrices`, `PriceResponse` |
| 토스 | 일봉 | 구현. `nextBefore` 페이지네이션·기간 필터·중복 제거 | 같은 파일: `getCandles`, `CandlePageResponse` |
| 토스 | 잔고 | 구현. `X-Tossinvest-Account`에는 **계좌번호 대신 accountSeq**. KRW 평가액만 원 정수, 원화 환산값이 없는 USD 보유는 `eval_amount=None`; 예수금·시장 구분은 미제공 | 같은 파일: `getHoldings`, `AccountSeq`, `HoldingsOverview` |
| 토스 | 개별 체결 | 미지원(`BROKER_NOT_SUPPORTED`). 주문별 누적 수량·평균가·최종시각으로 개별 체결을 만들지 않는다 | 같은 파일: 조회용 `OrderExecution` 스키마는 개별 체결 ID·목록을 제공하지 않음 |
| 토스 | 조건검색 | 미지원(`BROKER_NOT_SUPPORTED`) | 공식 OpenAPI에 해당 기능 없음 |

종목 회사명·업종의 근거: [KRX KIND 상장법인 목록](https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13). 어떤 어댑터에도 주문 생성·정정·취소 경로·함수를 추가하지 않았다.

### 스펙과 다른 점 및 세부 결정

- 코디네이터 합의에 따라 토스 최신 명세의 `STOCK`, `STOCK_ALL`, `ASSET` 그룹명을 사용했다. 명세에 명시적인 초당 수치가 없는 그룹은 스펙의 시세 계열 15회·계좌 계열 1회를 사용하며 AUTH 5회·차트 20회를 유지한다. 공통 한도 모듈은 ORDER_INFO의 09:00~09:10 KST 3회 제한도 제공한다.
- 외화 잔고의 원화 평가액은 임의 환산하지 않는다. 코디네이터가 develop `100dea6`에서 보완한 `BrokerHolding.eval_amount: int | None` 계약을 병합·반영했다.
- 키움 `kt00009`의 수수료·세금 0 반환은 코디네이터와 합의했다. 이후 11의 체결 동기화에서 이 제한을 고려해야 한다.
- 개발 화면의 샘플 증권사 선택은 Next.js `NODE_ENV=development`에서만 보인다. 백엔드는 별도로 `APP_ENV=production`에서 Mock 연결 생성을 필드별 422로 거부한다.
- 공인 IP는 `api.ipify.org`를 프로세스당 캐시하여 조회하며 실패·잘못된 응답은 null이다. 테스트에서는 respx로 대체하고 브라우저 확인에서도 해당 IP 응답을 가로채 실제 외부 서비스를 부르지 않았다.
- 공통 외부 HTTP 차단을 유지하기 위해 respx는 `using="httpx"`, `assert_all_mocked=True`로 실행한다. 로컬 TestClient 요청만 통과시키며, 조건검색은 스펙에 따른 로컬 웹소켓 서버로 검증했다.

### 검증 결과

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 08(8008·3008·finance_08) 준비 성공 |
| `uv run alembic upgrade heads` | market_0001 포함 적용 성공 |
| `uv run python -m app.modules.market.jobs seed-mock` | 종목 80행·스냅샷 80행, 실패 0 |
| `uv run ruff check .` / `uv run ruff format --check .` | 통과 |
| `uv run pytest` | 전체 760개 통과(시장 모듈 28개), 공통 Starlette TestClient 사용 중단 안내 1건 |
| `npm run lint` / `npx tsc --noEmit` | 통과 |
| `npm run test` | 26개 파일·289개 테스트 통과(시장 화면 4개) |
| `npm run build` | Next.js 16.4.2 프로덕션 빌드 성공 |
| 빈 `finance_08_verify` DB: `upgrade heads`→`downgrade base`→`upgrade heads` | 전 과정 성공, 검증 DB 삭제 완료 |
| 독립 Playwright Chrome context: `/stocks?q=삼성`, `/stocks/005930`, `/quotes`, `/snapshot/status` | 모두 실제 백엔드 HTTP 200·source=mock, 스냅샷 count=80 |
| 같은 context의 연결 추가→확인→삭제 | 성공. 정상 상태·마스킹·삭제 확인 대화상자 확인 |
| 360·768·1280px 화면 | document.scrollWidth가 viewport 너비 이하, 360px 추가 다이얼로그 포함 확인, 브라우저 오류 0 |
| 소유 경로·비밀값·주문 코드 점검 | 소유 범위 내 변경, 환경 파일 미추적, 주문 생성·정정·취소 코드 없음 |
| `scripts/stop.sh` | 기동한 frontend·backend 종료, 브라우저 검증 사용자 정리 완료 |

### 남은 일

- 구현 범위의 남은 작업은 없다. 별도 검증 워커의 계약 검증·PR 검토·병합은 코디네이터가 진행한다.
- 실제 키·허용 IP가 필요한 실서비스 연동은 외부 호출 없이 공식 응답을 고정한 테스트로 확인했다. 토스 개별 체결·조건검색, 외화 평가액 미제공과 키움 체결 비용 미제공 제한은 위 표와 같다.

### 웨이브 4 통합 검증 수정

- 발견 사항(경미 F3): `/settings/connections`를 열면 `BrokerConnectionsSection`의 `useEgressIp`(`useQuery`)가 사용자 동작 없이 실행돼 `GET /api/market/connections/egress-ip`를 부르고, 서버가 외부 IP 조회 서비스를 불렀다.
- 고친 내용: `useEgressIp`를 `useMutation`으로 바꿔 "서버 공인 IP 확인" 버튼을 누를 때만 부른다. 누르기 전 "버튼을 누르면 확인합니다", 조회 중 "확인 중…", null이나 요청 실패면 "확인할 수 없음"을 보여 준다. 상태는 컴포넌트에 머물러 화면을 떠나면 사라지고, 다시 들어오면 버튼을 다시 눌러야 한다. 백엔드와 API 계약은 바꾸지 않았다.
- 세부 결정: 응답을 받으면(IP·null 모두) 버튼을 비활성화해 그 화면에 머무는 동안 다시 부르지 않는다. 백엔드 `get_egress_ip`가 null까지 프로세스 캐시하므로 null 뒤 재요청은 의미가 없다. 요청 자체가 실패(HTTP 오류·네트워크 오류)했을 때만 버튼을 다시 누를 수 있다.
- 회귀 테스트(`frontend/tests/market/connections.test.tsx`): 화면 진입 시 egress-ip 요청 0회와 안내 문구, 버튼 클릭 시 "확인 중…"·1회 요청·결과 표시, 결과 뒤 버튼 비활성과 재클릭 시 추가 요청 없음, 요청 실패 시 "확인할 수 없음"과 재시도를 확인한다. 기존 IP 표시·null 테스트는 버튼을 누른 뒤 확인하도록 바꿨다. 새 진입 테스트는 수정 전 코드에서 실패하는 것을 확인했다.

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 08(8008·3008·finance_08) 준비 성공 |
| `npm run lint` / `npx tsc --noEmit` | 통과 |
| `npm run test` | 47개 파일·468개 테스트 통과(시장 화면 6개) |
| `npm run build` | Next.js 16.4.2 프로덕션 빌드 성공 |
| 실제 서버(슬롯 08) + 독립 Playwright Chrome context, egress-ip는 브라우저에서 가로채 가짜 응답 | 1280·360·768px 모두 진입 시 요청 0회·"버튼을 누르면 확인합니다", 클릭 시 "확인 중…"·버튼 비활성 → 1회 요청 후 `203.0.113.7`(null 응답은 "확인할 수 없음") 표시, 재클릭 시 추가 요청 없음, `scrollWidth`가 viewport 너비 이하, 브라우저 오류 0 |
| 백엔드 로그 | 확인 동안 egress-ip 요청 0건(외부 IP 조회 서비스 미호출) |
| `scripts/stop.sh` | 기동한 frontend·backend 종료, 확인용 사용자 삭제 |

### 키움 체결 없음 응답 처리

- 발견 사항: `kt00009`가 체결 없는 날에 HTTP 200, `return_code: 20`, `return_msg`에 `관련자료가없습니다`를 반환하면 공통 오류 변환이 `BROKER_UNAVAILABLE`을 발생시켜 기간 전체의 매매일지 동기화가 실패했다.
- 고친 내용: `_pages`에서 `kt00009`의 HTTP 200·코드 20·해당 메시지 조합만 그 날짜·매도수 구분의 빈 결과로 처리하고 연속조회를 종료한다. 다른 날짜·매도수 구분은 계속 조회하며 앞서 받은 체결은 유지한다. 다른 api-id·코드·메시지와 HTTP 오류는 기존 오류 처리를 유지한다.
- 근거: 공식 `kiwoom_api_spec.json`에는 없는 응답이며, 2026-10-19 코디네이터가 운영 서버에서 관찰한 응답 조합을 따른다. 같은 근거를 코드 주석에 남겼다.
- 회귀 테스트: 30일 전체 no-data(정수·문자열 코드 20), 일부 날짜·매수 구분만 체결 있음, 체결 페이지 뒤 no-data와 연속조회 헤더 종료, 메시지가 다른 20·다른 코드·HTTP 오류, 다른 api-id(`kt00018`)의 오류 유지를 확인한다. 매매일지에는 테스트 함수 하나를 추가하고 0건·체결 1건 저장을 매개변수로 확인한다.

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 08(8008·3008·finance_08) 준비 성공 |
| `uv run ruff check .` / `uv run ruff format --check .` | 통과, 307개 파일 포맷 확인 |
| `uv run pytest tests/market/test_brokers.py tests/journal/test_sync.py -q` | 42개 통과 |
| `uv run pytest` | 전체 1,435개 통과, 기존 Starlette TestClient 사용 중단 안내 1건 |
| 수정 전 `522e27c`의 `_pages`로 새 전체 no-data 테스트 실행(저장소 밖 임시 플러그인) | 두 매개변수 모두 `BROKER_UNAVAILABLE`로 실패하여 회귀 재현 확인 |
| 실제 슬롯 08 uvicorn 서버, 30일 `POST /api/journal/sync` | 전체 no-data: HTTP 200·0건, 일부 날짜만 체결: HTTP 200·1건 저장, 메시지가 다른 코드 20: HTTP 502·`BROKER_UNAVAILABLE` |
| 서버 확인의 외부 호출 | 저장소 밖 임시 실행 설정에서 키움 HTTP를 `MockTransport`로 대체하고 실제 외부 HTTP 전송을 차단. 실서비스 키·LLM·외부 IP 조회 미사용 |
| 프론트·마이그레이션 검사 | 변경이 없어 생략. API·화면·DB 계약 변경 없음 |
| 정리 | 서버 확인용 사용자 삭제, `scripts/stop.sh`로 기동한 백엔드 종료 |

- 스펙과 다른 점: 없음. 의존성을 추가하지 않았다.
- 남은 일: 수정 범위의 구현은 완료했다. 별도 검증·PR 검토·병합은 코디네이터가 진행한다.

### 토스 계좌 불러오기와 토큰 재발급 재시도

- 발견 사항: (1) 토스 연결 추가 화면이 `accountSeq`를 사용자가 직접 입력하게 했는데, 이 값은 토스 `GET /api/v1/accounts` 응답에만 있어 구하기 어려웠다. (2) 토스는 같은 client로 토큰을 다시 받으면 이전 토큰을 무효화하는데, `_make_client`가 캐시한 연결 클라이언트는 캐시 토큰이 401이 되어도 만료(24시간)까지 그 토큰을 써서 `BROKER_AUTH_FAILED`가 났다.
- 고친 내용(백엔드): `TossBroker.list_accounts()`가 `GET /api/v1/accounts`를 계좌 헤더 없이 부르고 `TossAccount(seq, account_type, account_no_last4)`만 돌려준다(`accountNo` 원문은 어댑터 밖으로 나가지 않는다). `TossBroker._get`은 캐시에서 꺼낸 토큰으로 보낸 요청이 401이면 그 토큰을 버리고 한 번만 새로 받아 같은 요청을 다시 보낸다. 새 토큰으로도 401이면 기존처럼 `BROKER_AUTH_FAILED`다. `POST /api/market/connections/toss-accounts`(인증·`require_json`)를 추가했다. 응답은 `{"items": [{"accountSeq": "1", "accountType": "BROKERAGE", "accountNoLast4": "8901"}]}`이고 `BrokerError`는 기존 `as_app_error`로 바꾼다. 키움 어댑터와 다른 API는 바꾸지 않았다.
- 고친 내용(프론트): 토스를 고르면 계좌 칸 대신 "계좌 불러오기" 버튼을 보여 준다. 앱키·시크릿이 비었거나 불러오는 중이면 버튼을 끈다. 결과는 "계좌" 선택 목록(`종합매매 ****8901`, `BROKERAGE`가 아니면 `accountType` 그대로)으로 보여 주고, 하나면 자동으로 고르고, 없으면 "토스증권 종합매매 계좌가 없습니다."를 보여 준다. 계좌를 고르기 전에는 저장 버튼을 끄고, 저장할 때 고른 `accountSeq`를 기존 `accountNo`로 보낸다. 앱키·시크릿·증권사를 바꾸면 목록과 선택을 비운다. 오류는 연결 카드와 같은 오류 코드 안내를 보여 준다. 키움·샘플 증권사 폼의 계좌번호 칸은 그대로다.
- 근거: [토스 공식 OpenAPI JSON](https://openapi.tossinvest.com/openapi-docs/latest/openapi.json) 1.2.24를 2026-10-19에 다시 확인했다. `getAccounts`는 한도 그룹 `ACCOUNT`이고 `result[]`의 `accountNo`(문자열)·`accountSeq`(int64)·`accountType`(알 수 없는 enum 값을 허용하라고 명시)을 준다. `issueOAuth2Token` 설명에 "client 당 유효한 access token 은 1 개", "재발급 시 이전에 발급된 token 은 즉시 무효화"가 있고, 공통 `Unauthorized` 응답 예시에 `token-revoked`(재발급으로 무효화된 토큰)가 있다. 같은 근거를 `toss.py` 주석에 남겼다.

세부 결정

- 401 재시도는 캐시에서 꺼낸 토큰으로 보낸 요청에만 한다. 그 요청을 위해 방금 받은 토큰이 401이면 다시 받아도 같은 결과이므로 재시도하지 않고 `BROKER_AUTH_FAILED`다. 401의 오류 코드(`token-revoked`, `expired-token` 등)는 가리지 않는다.
- 토큰은 실패한 토큰과 지금 캐시된 토큰이 같을 때만 버린다. 동시 요청에서 다른 스레드가 이미 받은 새 토큰을 버려 연쇄 재발급이 일어나지 않게 하기 위해서다.
- `toss-accounts`는 요청마다 새 `TossBroker`와 `httpx.Client`를 만들고 닫는다. `_make_client` 캐시를 쓰지 않으므로 키가 DB에도 메모리 캐시에도 남지 않는다. 이 호출로 같은 키의 연결 클라이언트 토큰이 무효가 되지만 위 재시도로 다음 요청에서 회복한다.
- 토스 버킷에 스펙 4.1의 `ACCOUNT`(초당 1회)를 추가했다. `accountNo`는 하이픈을 뺀 뒤 끝 4자리를 쓰고, `accountSeq`는 정수로 읽어 문자열로 응답한다.
- 요청 스키마는 최대 200자만 검사하고, 빈 값·공백만 있는 값은 서비스에서 `field_error("appKey"|"appSecret")` 422로 거른다. 필드가 아예 없으면 Pydantic 422다.
- 오류 코드 안내 문구를 `features/market/errors.ts`로 옮겨 연결 카드와 계좌 불러오기가 같이 쓴다. 문구는 바꾸지 않았다.
- 계좌가 하나여도 선택 목록을 보여 줘 어떤 계좌가 골라졌는지 보이게 했다. 불러오는 중에 키를 바꾸면 TanStack Query mutation을 `reset`해 늦게 온 응답을 버린다. 불러오기의 필드 오류(422)는 앱키·시크릿 칸에 표시한다. 토스 저장은 zod에서도 계좌를 요구한다(저장 버튼 비활성의 보조). 불러오기 요청 제한 시간은 30초다.
- 증권사를 바꾸면 계좌 값도 비운다(키움에서 입력한 계좌번호가 토스 선택 값으로 넘어가지 않게 하기 위해서다).

테스트

- 백엔드 `test_brokers.py`: 계좌 목록(계좌 헤더 없음, 끝 4자리만, 다른 `accountType` 그대로), 캐시 토큰 무효화 → 한 번 재발급 후 성공과 새 토큰 재사용, 재발급 토큰도 401이면 `BROKER_AUTH_FAILED`(토큰 2회·요청 2회), 방금 받은 토큰의 401은 재시도 없음.
- 백엔드 `test_market.py`: `toss-accounts` 응답 형식과 `accountNo` 원문 없음, 키가 응답·로그에 없고 연결 행·`_make_client` 캐시가 남지 않음, 계좌 없음 빈 목록, 토큰·계좌 경로의 403 → `BROKER_IP_NOT_ALLOWED`·401 → `BROKER_AUTH_FAILED`(502), 앱키·시크릿 빈 값·공백 422(field), 필드 누락·201자·JSON 아님 422, 미인증 401, 계좌 불러오기 → 연결 저장 → 확인 → 같은 키로 다시 불러오기 → 다시 확인이 `active`(재현 시나리오). 모든 토스 호출은 respx(`assert_all_mocked`)로 고정했다.
- 프론트 `connections.test.tsx`(MSW): 키움 계좌번호 칸 유지와 토스 버튼 비활성 조건, 한 개 자동 선택과 저장 요청의 `accountNo`, 여러 개 선택 전후 저장 버튼, 없음 안내, 오류 안내 2종, 앱키·시크릿·증권사 변경 시 초기화, 불러오는 중 키 변경 시 늦은 응답 무시. 기존 토스 폼 테스트는 `accountSeq` 칸 대신 불러오기 버튼을 확인하도록 바꿨다.

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 08(8008·3008·finance_08) 준비 성공 |
| `uv run ruff check .` / `uv run ruff format --check .` | 통과, 307개 파일 포맷 확인 |
| `uv run pytest` | 전체 1,446개 통과(시장 모듈 53개), 기존 Starlette TestClient 사용 중단 안내 1건 |
| 수정 전 `toss.py`(재시도 없음)로 새 재시도 테스트 실행 | 캐시 토큰 재발급 2개·API 재현 시나리오 1개가 `BROKER_AUTH_FAILED`로 실패해 회귀 재현 확인 후 복원 |
| `npm run lint` / `npx tsc --noEmit` | 통과 |
| `npm run test` | 50개 파일·512개 테스트 통과(시장 화면 14개) |
| 초기화 코드(`tossAccounts.reset()`)를 잠시 뺀 프론트 테스트 | 키 변경 초기화·늦은 응답 무시 2개가 실패하는 것을 확인 후 복원 |
| `npm run build` | Next.js 16.4.2 프로덕션 빌드 성공 |
| 실제 슬롯 08 uvicorn 서버 + curl | 계좌 불러오기 200(`accountNoLast4`만), 연결 저장·확인 `active`, 같은 키로 다시 불러온 뒤 확인도 `active`(캐시 토큰 401 → 1회 재발급 → 200), 공백 키 422(`appKey`), IP 거부 502 `BROKER_IP_NOT_ALLOWED`, 미인증 401. 서버 로그에 키·계좌번호 원문 없음 |
| 같은 서버 + 독립 Playwright Chrome context(egress-ip는 브라우저에서 가로챔) | 키움 계좌번호 칸 유지, 토스 버튼 비활성→활성, 한 개 자동 선택·저장 요청 `accountNo: "1"`, 카드 `계좌 ****1`·정상, 같은 키로 다시 불러온 뒤 연결 확인 정상(오류 안내 없음), 여러 개 선택·키 변경 시 비움, 없음 안내, IP 오류 안내. 360·768·1280px에서 `scrollWidth`가 viewport 너비 이하, egress-ip 요청 0회. 콘솔 메시지는 일부러 만든 IP 거부 502의 리소스 로그 1건뿐이고 페이지 스크립트 오류는 없음 |
| 서버 확인의 외부 호출 | 저장소 밖 임시 실행기에서 httpx 전송을 바꿔 토스 경로는 "client마다 마지막 토큰만 유효"한 가짜 응답으로, 그 밖의 외부 호스트는 차단했다. 실서비스 키·LLM·외부 IP 조회 미사용 |
| 정리 | 확인용 사용자 2명 삭제(연결 함께 삭제), 임시 백엔드 종료, `scripts/stop.sh`로 프론트 종료. 마이그레이션 변경 없음 |

- 스펙과 다른 점: 없음. 의존성을 추가하지 않았다.
- 남은 일: 수정 범위의 구현은 완료했다. 실제 토스 키·허용 IP로 하는 확인과 별도 검증·PR 검토·병합은 코디네이터가 진행한다.

### 키움 체결 전체 거래소 조회

- 발견 사항: `kt00009`의 `dmst_stex_tp="KRX"` 고정 요청으로 NXT 체결이 빠지고, 거래소가 다른 동일 주문번호·체결번호는 같은 `external_id`로 덮어썼다. 체결 종목코드의 `_NX`·`_AL` 접미사도 남았다.
- 고친 내용: 요청을 `dmst_stex_tp="%"`로 바꿨다. 응답 행의 거래소가 KRX·빈 값(누락·null 포함)이면 기존 `{날짜}:{ord_no}:{cntr_no}`를 유지하고, 그 밖이면 `:{dmst_stex_tp}`를 붙인다. 체결 경로에서만 `_NX`·`_AL`을 제거한 뒤 기존 접두어(A·J·Q) 변환을 적용한다. 공용 코드 변환 함수·잔고 `kt00018`·체결 없음 응답 처리·매도수 필터·연속조회는 유지했다.
- 근거: [키움 공식 `kiwoom_api_spec.json`](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/main/kiwoom/_data/kiwoom_api_spec.json)의 `kt00009` 요청 `dmst_stex_tp`는 `%`·`KRX`·`NXT`·`SOR`이고, 응답 행에도 `dmst_stex_tp`가 있다(2026-10-19 재확인). 같은 근거를 코드 주석에 남겼다.
- 회귀 테스트: respx로 전체 거래소 요청, 누락·빈 값·null·KRX의 ID 유지, NXT·SOR 접미사, A·J·Q 및 `_NX`·`_AL` 코드 정리, 같은 주문·체결번호의 KRX·NXT·SOR가 연속조회 뒤에도 각각 남고 같은 KRX 행의 중복만 제거되는 것을 확인한다. 기존 체결 조회 테스트의 요청 단언도 `%`로 맞췄다.

| 명령·확인 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 08(8008·3008·finance_08) 준비 성공 |
| 수정 전 새 회귀 테스트(`-k 'exchange_ids or exchange_collisions'`) | 8개 모두 `KRX` 고정 요청으로 실패하여 재현 확인 |
| `uv run ruff check .` / `uv run ruff format --check .` | 통과, 307개 파일 포맷 확인 |
| `uv run pytest tests/market/test_brokers.py tests/journal/test_sync.py -q` | 54개 통과 |
| `uv run pytest -q` | 전체 1,454개 통과, 기존 Starlette TestClient 사용 중단 안내 1건 |
| 실제 슬롯 08 uvicorn 서버: `POST /api/journal/sync` | 기존 KRX 1건 저장 → 전체 거래소 응답에서 3건 추가·기존 1건 유지 → 재동기화 0건 추가·4건 유지, 모두 HTTP 200 |
| 같은 서버의 DB·요청 확인 | `20261016:1:2`, `:NXT`, `:SOR`와 빈 거래소 `20261016:3:2` 총 4건·코드 모두 `005930`. `kt00009` 전체 거래소·연속조회·다른 날짜 no-data, `kt00018` KRX 유지 확인 |
| 같은 서버의 사용자 격리 | 다른 사용자가 같은 연결로 동기화하면 HTTP 404·`NOT_FOUND` |
| 외부 호출·정리 | 저장소 밖 임시 `sitecustomize.py`에서 키움 HTTP 전송을 가짜 응답으로 대체하고 그 밖의 외부 HTTP를 차단. 실서비스 키·LLM·외부 IP 조회 미사용. 확인용 사용자 2명과 연결·거래 삭제, `scripts/stop.sh`로 백엔드 종료 |
| 프론트·마이그레이션 검사 | 변경이 없어 생략. API·화면·DB 계약 변경 없음 |

- 스펙과 다른 점: 없음. 의존성을 추가하지 않았고 소유 경로만 수정했다.
- 남은 일: 수정 범위의 구현은 완료했다. 별도 검증·PR 검토·병합은 코디네이터가 진행한다.
