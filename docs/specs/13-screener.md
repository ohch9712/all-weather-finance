# 13. AI 조건검색: 필터 DSL, 자연어 해석, 결과 화면, 키움 저장 조건식

> 웨이브 3 · 브랜치 `feature/13-screener` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 08(증권사 게이트웨이)이 develop에 병합된 상태. 결과의 "관심종목 담기"는 12의 `POST /api/watchlist`를 호출한다(병렬 개발이므로 테스트는 MSW로 흉내 낸다).
> **착수 직전 갱신**: 코디네이터는 08의 `SnapshotRow` 실제 필드와 `## 구현 결과`의 지표 구현 여부(토스는 PER 등 없음)를 확인해 4.1 필드 표를 맞춘다.

## 1. 목표

- 사용자가 "시가총액 1조 이상이고 PER 10 이하인 코스피 종목"처럼 말하면 그 조건에 맞는 종목을 보여 준다.
- 자연어는 LLM이 **화이트리스트 필드와 연산자로만 된 JSON 필터**로 바꾸고, 백엔드가 검증한 뒤 08이 모은 최신 종목 스냅샷에서 거른다. LLM이 SQL이나 코드를 만들지 않는다.
- 해석 결과를 칩으로 보여 주고 사용자가 고칠 수 있게 한다. 지원하지 않는 조건은 버리지 않고 알려 준다.
- 키움 HTS에서 만든 내 조건식도 실행할 수 있다.

## 2. 범위

### 포함

- 필터 모델과 평가기, 자연어 해석 API, 실행 API, 저장한 검색 CRUD, 키움 조건식 목록·실행
- 용어 기준표(`get_filter_guide`) — 15의 챗봇 도구도 같은 기준을 쓴다
- 화면 `/stocks/screener`
- 서비스 함수(8절)

### 제외

- 배당·재무제표 세부(매출 성장률 등): 스냅샷에 없으므로 `unsupported`로 알린다
- 해외 종목: 스냅샷이 국내만이다

## 3. 소유 파일

- `backend/app/modules/screener/**`
- `backend/alembic/versions/screener_0001_*.py`
- `backend/tests/screener/**`
- `frontend/src/app/(app)/stocks/screener/**`(자리표시 교체)
- `frontend/src/features/screener/**`
- `frontend/tests/screener/**`
- 이 문서의 `## 구현 결과`

## 4. 필터 DSL (`screener/schemas.py`)

```python
FilterField = Literal["price", "changeRate", "volume", "tradingValue", "marketCap", "per", "pbr", "roe",
                      "eps", "bps", "foreignRatio", "high52wGapRate", "low52wGapRate"]
Op = Literal["gt", "gte", "lt", "lte", "between"]

class Condition(CamelModel):       # extra="forbid"
    field: FilterField
    op: Op
    value: Decimal
    value_to: Decimal | None = None   # between일 때만, value <= value_to

class SortSpec(CamelModel):
    field: FilterField
    direction: Literal["asc", "desc"]

class ScreenFilter(CamelModel):
    markets: list[Literal["KOSPI", "KOSDAQ"]] | None = None
    sectors: list[str] | None = None          # 스냅샷 업종명과 정확히 일치
    conditions: list[Condition] = []          # 최대 10개
    sort: SortSpec | None = None
    limit: int = 30                           # 1~100
```

### 4.1 필드와 단위

| 필드 | 뜻 | 단위 | 계산 |
| --- | --- | --- | --- |
| `price` | 현재가(스냅샷 종가) | 원 | |
| `changeRate` | 등락률 | % | |
| `volume` | 거래량 | 주 | |
| `tradingValue` | 거래대금 | 원 | |
| `marketCap` | 시가총액 | 원 | |
| `per`, `pbr` | 주가수익비율, 주가순자산비율 | 배 | |
| `roe` | 자기자본이익률 | % | |
| `eps`, `bps` | 주당순이익, 주당순자산 | 원 | |
| `foreignRatio` | 외국인 보유 비율 | % | |
| `high52wGapRate` | 52주 최고가 대비 | % | (현재가 − 52주 최고) ÷ 52주 최고 × 100(0 이하) |
| `low52wGapRate` | 52주 최저가 대비 | % | (현재가 − 52주 최저) ÷ 52주 최저 × 100(0 이상) |

- 값이 null인 종목은 그 필드 조건에서 제외하고 `excludedForMissingData`로 센다.
- 평가는 `market.service.list_snapshot_rows()`가 주는 최신일 전 종목 목록(국내 약 2,500개 이하)을 파이썬에서 거른다. 정렬 기본값은 `marketCap desc`.

### 4.2 용어 기준표 (`get_filter_guide()`가 돌려주는 고정 문자열의 내용)

| 표현 | 필터 |
| --- | --- |
| 저PER | `per gt 0` + `per lte 10` |
| 저PBR | `pbr gt 0` + `pbr lte 1` |
| 고ROE | `roe gte 15` |
| 대형주 | `marketCap gte 10조` |
| 중형주 | `marketCap between 1조 ~ 10조` |
| 소형주 | `marketCap lt 1조` |
| 거래대금 많은 | `tradingValue gte 1,000억` |
| 52주 신고가 근처 | `high52wGapRate gte -5` |
| 52주 신저가 근처 | `low52wGapRate lte 5` |
| 급등 / 급락 | `changeRate gte 5` / `changeRate lte -5` |
| 외국인 많이 보유 | `foreignRatio gte 30` |
| 코스피 / 코스닥 | `markets` |

- 숫자 단위: 1만 = 10,000, 1억 = 100,000,000, 1조 = 1,000,000,000,000. 사용자가 숫자를 말하면 기준표보다 사용자 숫자를 따른다.
- 지원하지 않는 표현(배당, 매출 성장, 영업이익률, 부채비율, 테마, 뉴스 등)은 `unsupported`로 돌려준다.

## 5. 자연어 해석 `POST /api/screener/parse`

- 요청 `{"query": "코스피 대형주 중에 PER 10 이하"}`(공백 제거 후 1~300자)
- 호출: `llm.generate(task="screener.parse", system=SYSTEM, content=query, output=ParsedScreenOutput, effort="medium", max_tokens=4000)`
  - `SYSTEM` = 역할(한국 주식 조건검색 해석기) + 4.1 필드 표 + 4.2 기준표 + 규칙(필드·연산자는 목록에서만, 확실하지 않은 조건은 `unsupported`, 업종명은 사용자가 말한 그대로).
  - `ParsedScreenOutput` = `{"filter": ScreenFilter, "explanation": str, "unsupported": [{"text": str, "reason": str}]}`
- 응답 `200`

```json
{ "filter": { "markets": ["KOSPI"], "sectors": null,
              "conditions": [ { "field": "marketCap", "op": "gte", "value": "10000000000000", "valueTo": null },
                              { "field": "per", "op": "gt", "value": "0", "valueTo": null },
                              { "field": "per", "op": "lte", "value": "10", "valueTo": null } ],
              "sort": { "field": "marketCap", "direction": "desc" }, "limit": 30 },
  "explanation": "코스피에서 시가총액 10조 원 이상이면서 PER이 0보다 크고 10배 이하인 종목을 찾습니다.",
  "unsupported": [],
  "chips": [ { "label": "코스피" }, { "label": "시가총액 ≥ 10조원" }, { "label": "0 < PER ≤ 10" } ] }
```

- `chips`는 서버가 필터에서 만든 표시용 문자열이다(LLM이 만들지 않는다).
- 출력이 `ScreenFilter` 검증을 통과하지 못하면 `503 LLM_UNAVAILABLE`("조건을 이해하지 못했어요. 조금 다르게 말해 주세요."). 거절은 `422 LLM_REFUSED`, LLM 꺼짐 `503`.

## 6. 실행 `POST /api/screener/run`

- 요청 `{"filter": ScreenFilter}`
- 응답 `200`

```json
{ "asOf": "2026-10-16", "source": "mock", "total": 7, "excludedForMissingData": 2,
  "items": [ { "code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체",
               "price": "71200", "changeRate": -1.11, "marketCap": 425000000000000,
               "per": "12.40", "pbr": "1.30", "roe": "10.50", "tradingValue": 879000000000 } ] }
```

- 스냅샷이 없으면 `200`에 `asOf: null`, `items: []`, 그리고 화면은 "종목 데이터가 아직 없습니다(관리자: `seed-mock` 또는 `refresh-snapshot`)" 안내.

## 7. 그 밖의 API (모두 인증 필요)

| 메서드·경로 | 성공 |
| --- | --- |
| `GET /api/screener/saved` | `200 {"items": [{"id", "name", "queryText", "filter", "createdAt"}]}` |
| `POST /api/screener/saved` | `{"name": "저평가 대형주", "queryText": "…" \| null, "filter": ScreenFilter}` → `201`(사용자당 20개, 넘으면 `409 CONFLICT`) |
| `DELETE /api/screener/saved/{id}` | `204` |
| `GET /api/screener/broker-conditions?connectionId=` | `200 {"items": [{"seq": "0", "name": "샘플 저PER"}], "source": "mock"}` |
| `POST /api/screener/broker-conditions/run` | `{"connectionId": "…" \| null, "seq": "0"}` → `200` 6절 형식(`source: "kiwoom_condition"` 또는 `"mock"`) |

- 저장 테이블 `saved_screens`(revision `screener_0001`, `branch_labels=("screener",)`): `id uuid PK`, `user_id`(FK users CASCADE), `name varchar(40) NOT NULL`, `query_text varchar(300) NULL`, `filter jsonb NOT NULL`, `created_at`. UNIQUE `(user_id, name)`.
- 키움 조건식: `connectionId`가 있으면 사용자 키움 연결(`get_user_broker_client`), 없으면 운영자 클라이언트(`get_market_data_client`, Mock이면 샘플 조건식 2개). 클라이언트에 `CONDITIONS` 능력이 없으면 `501 BROKER_NOT_SUPPORTED`. 실행 결과 코드 목록을 스냅샷과 합쳐 6절 형식으로 준다(스냅샷에 없는 코드는 이름만).

## 8. 다른 모듈용 서비스 함수

```python
# app/modules/screener/service.py
def parse_query(llm: StructuredLLM, query: str) -> ParsedScreen
def run_screen(db, screen_filter: ScreenFilter) -> ScreenResult
def get_filter_guide() -> str              # 4.1·4.2 내용을 담은 고정 문자열(15의 도구 설명에 쓴다)
def encode_filter(screen_filter: ScreenFilter) -> str   # 화면 URL용, 아래 규칙
```

- URL 인코딩 규칙: `ScreenFilter`를 camelCase JSON(키 정렬, 공백 없음)으로 직렬화 → UTF-8 → base64url(패딩 `=` 제거). 화면은 `/stocks/screener?f=<값>`을 열면 그 필터로 바로 실행한다. 프론트에도 같은 `encodeFilter`/`decodeFilter`를 둔다.

## 9. 화면 명세 (`/stocks/screener`)

- 상단 AI 입력창: "원하는 조건을 말해 보세요", 예시 버튼 4개("코스피 대형주 중 PER 10 이하", "52주 신고가 근처 코스닥 종목", "ROE 15% 이상 저PBR", "오늘 5% 넘게 오른 종목"). LLM 꺼짐이면 입력창 대신 "직접 조건 추가"만.
- 해석 결과: 설명 한 문단, 조건 칩(눌러서 필드·연산자·값 수정, 삭제, "조건 추가"), `unsupported` 경고 상자.
- "검색" → 결과 표(정렬 가능한 열: 종목명, 시장, 현재가, 등락률, 시가총액, PER, PBR, ROE), 행의 "관심종목 담기"(12 API, 409면 "이미 있어요"), 종목명은 `/stocks/[code]` 링크, 기준일·`SampleDataBadge`, 지표 없는 종목 제외 수.
- 저장한 검색 목록(불러오기·삭제), "이 조건 저장".
- "내 키움 조건식" 탭: 연결 선택(없으면 운영자 데이터), 조건식 목록, 실행 결과 표.
- `?f=`가 있으면 그 필터를 칩으로 보여 주고 바로 실행.
- `Disclaimer variant="investment"`.

## 10. 테스트

### 백엔드

- 평가기: 연산자 5종, between 경계, null 제외 수, 시장·업종 필터, 정렬·limit, 52주 비율 계산
- `ScreenFilter` 검증: 없는 필드·연산자, between의 value_to 누락·역전, 조건 11개, limit 범위
- 해석: `FakeStructuredLLM`으로 정상·검증 실패(503)·거절(422) 경로, `chips` 생성, 시스템 프롬프트에 기준표가 들어감
- 실행: Mock 스냅샷(`seed-mock`)으로 기대 종목 집합 확인, 스냅샷 없음
- 저장 CRUD·20개 제한·이름 중복, 키움 조건식(Mock 2개, 미지원 501), `encode_filter` 왕복
- 사용자 격리 404

### 프론트

- 자연어 → 칩 → 수정 → 실행 흐름(MSW), `?f=` 진입, 정렬, 관심종목 담기 409 처리, 키움 탭

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] `seed-mock` 후 예시 4개가 Mock 데이터에서 결과를 낸다(실제 LLM 키가 있으면 수동 확인, 없으면 칩 직접 입력으로 확인)

## 12. 검증 체크리스트

1. LLM 출력이 필터 모델 검증을 거친 뒤에만 실행된다. 문자열로 쿼리를 조립하는 코드가 없다.
2. 4.1 필드·단위·계산식과 4.2 기준표가 시스템 프롬프트와 `get_filter_guide`에 같은 내용으로 들어 있다.
3. 5~7절 응답 필드·에러 코드가 같다.
4. URL 인코딩 규칙이 백엔드·프론트에서 같다(같은 필터 → 같은 문자열).
5. 서비스 함수 시그니처가 8절과 같다(15의 전제).
6. 사용자 격리 404.
