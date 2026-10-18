# 13. AI 조건검색: 필터 DSL, 자연어 해석, 결과 화면, 키움 저장 조건식

> 웨이브 3 · 브랜치 `feature/13-screener` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 08(증권사 게이트웨이)이 develop에 병합된 상태. 결과의 "관심종목 담기"는 12의 `POST /api/watchlist`를 호출한다(병렬 개발이므로 테스트는 MSW로 흉내 낸다).
> **착수 직전 갱신**: 코디네이터는 08의 `SnapshotRow` 실제 필드와 `## 구현 결과`의 지표 구현 여부(토스는 PER 등 없음)를 확인해 4.1 필드 표를 맞춘다.
> **ETF(08b)**: `SnapshotRow`에 `kind`(`stock`·`etf`)가 생긴다. 착수 전에 `ScreenFilter`에 `kinds: list[Literal["stock", "etf"]] | None`(없으면 주식만)을 더하고, ETF는 PER·PBR·ROE·EPS·BPS·외국인 비율이 null이라 그 조건에서 자연히 빠진다는 점과 "ETF 중에서 …" 같은 자연어 해석 예를 4절에 반영한다.
> **갱신함(2026-10-17, develop `4766e99` 기준, 08·08b 병합 후)**: 08의 `SnapshotRow`(`market.service`)는 `as_of, code, price, change_rate, volume, trading_value, market_cap, per, pbr, roe, eps, bps, foreign_ratio, high_52w, low_52w, source, created_at, name, market, sector, kind`로 4.1 필드가 모두 있다. 공급자별로 비는 값이 다르다: 토스는 가격 외 지표가 모두 null, 키움 ETF(`ka40004`)는 거래대금·시가총액·재무지표·52주 고저가 null, Mock ETF는 재무지표 6개(`per, pbr, roe, eps, bps, foreignRatio`)가 null. 08b의 ETF `market`은 키움 시장 코드가 없으면 `KOSPI`다(Mock ETF 10개는 모두 KOSPI). 이에 맞춰 4·5·6·9절에 `kinds`, null 정렬, ETF 표현을 더했다.

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
    kinds: list[Literal["stock", "etf"]] | None = None   # None이면 주식만(08b). 중복 없이 1~2개
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

- 값이 null인 종목은 그 필드 조건에서 제외하고 `excludedForMissingData`로 센다. ETF는 재무지표가 비어 있어 PER·PBR·ROE·EPS·BPS·외국인 비율 조건에서 자연히 빠진다(키움 데이터면 시가총액·거래대금·52주 조건에서도 빠진다).
- 평가는 `market.service.list_snapshot_rows()`가 주는 최신일 전 종목 목록(국내 약 2,500개 이하)을 파이썬에서 거른다. 먼저 `kinds`(없으면 `["stock"]`)와 `markets`·`sectors`로 거른 뒤 조건을 적용한다. 정렬 기본값은 `marketCap desc`. 정렬 필드 값이 null인 종목은 방향과 상관없이 맨 뒤에 두고, 같은 값끼리는 `code` 오름차순이다.

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
| ETF | `kinds: ["etf"]` |
| 주식과 ETF 모두, ETF 포함 | `kinds: ["stock", "etf"]` |

- 숫자 단위: 1만 = 10,000, 1억 = 100,000,000, 1조 = 1,000,000,000,000. 사용자가 숫자를 말하면 기준표보다 사용자 숫자를 따른다.
- 종류를 말하지 않으면 `kinds`를 비운다(주식만). 예: "ETF 중에서 오늘 3% 넘게 오른 것" → `kinds: ["etf"]` + `changeRate gte 3`. "ETF 중 PER 10 이하"처럼 ETF에 없는 지표를 말하면 필터는 만들되 `explanation`에 ETF는 그 지표가 없어 결과가 비어 있을 수 있다고 적는다.
- 지원하지 않는 표현(배당, 매출 성장, 영업이익률, 부채비율, 테마, 뉴스, ETF 구성종목·NAV·괴리율 등)은 `unsupported`로 돌려준다.

## 5. 자연어 해석 `POST /api/screener/parse`

- 요청 `{"query": "코스피 대형주 중에 PER 10 이하"}`(공백 제거 후 1~300자)
- 호출: `llm.generate(task="screener.parse", system=SYSTEM, content=query, output=ParsedScreenOutput)`(general 등급, 기본 Gemini. effort·max_tokens는 작업 등록부)
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

- `chips`는 서버가 필터에서 만든 표시용 문자열이다(LLM이 만들지 않는다). `kinds`가 `["etf"]`면 "ETF", `["stock", "etf"]`면 "주식·ETF" 칩을 맨 앞에 둔다(주식만이면 칩 없음).
- 출력이 `ScreenFilter` 검증을 통과하지 못하면 `503 LLM_UNAVAILABLE`("조건을 이해하지 못했어요. 조금 다르게 말해 주세요."). 거절은 `422 LLM_REFUSED`, LLM 꺼짐 `503`.

## 6. 실행 `POST /api/screener/run`

- 요청 `{"filter": ScreenFilter}`
- 응답 `200`

```json
{ "asOf": "2026-10-16", "source": "mock", "total": 7, "excludedForMissingData": 2,
  "items": [ { "code": "005930", "name": "삼성전자", "market": "KOSPI", "sector": "반도체", "kind": "stock",
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
- 키움 조건식: `connectionId`가 있으면 사용자 키움 연결(`get_user_broker_client`). 없으면 운영자 클라이언트(`get_market_data_client`)가 **Mock일 때만** 샘플 조건식 2개를 쓴다. 운영자 클라이언트가 실제 증권사(`kiwoom`·`toss`)이면 운영자 계좌의 HTS 조건식이 다른 사용자에게 드러나므로 쓰지 않고 `422 VALIDATION_ERROR`(`field_error("connectionId", "내 키움 증권사 연결을 선택해 주세요.")`)를 돌려준다(목록·실행 둘 다, 2026-10-19 코디네이터 변경). 클라이언트에 `CONDITIONS` 능력이 없으면 `501 BROKER_NOT_SUPPORTED`. 실행 결과 코드 목록을 스냅샷과 합쳐 6절 형식으로 준다(스냅샷에 없는 코드는 이름만).

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

- 상단 AI 입력창: "원하는 조건을 말해 보세요", 예시 버튼 4개("코스피 중형주 중 PER 10 이하", "거래대금 많은 코스닥 종목", "ROE 15% 이상 저PBR", "오늘 3% 넘게 오른 종목"). LLM 꺼짐이면 입력창 대신 "직접 조건 추가"만. 입력창 옆에 `AiProviderBadge scope="general" compact`, 아래에 "조건 문장은 AI 공급자로 전송돼요. 개인정보는 적지 마세요." 안내.
- 해석 결과: 설명 한 문단, 조건 칩(눌러서 필드·연산자·값 수정, 삭제, "조건 추가"), `unsupported` 경고 상자.
- "검색" → 결과 표(정렬 가능한 열: 종목명, 시장, 현재가, 등락률, 시가총액, PER, PBR, ROE), 행의 "관심종목 담기"(12 API, 409면 "이미 있어요"), 종목명은 `/stocks/[code]` 링크, `kind=etf` 행에는 "ETF" 배지, null 지표는 "—", 기준일·`SampleDataBadge`, 지표 없는 종목 제외 수.
- 저장한 검색 목록(불러오기·삭제), "이 조건 저장".
- "내 키움 조건식" 탭: 연결 선택, 조건식 목록, 실행 결과 표. 선택지는 사용자의 `active` 키움 연결만 보여 주고, 연결이 있으면 첫 연결을 기본으로 고른다. 연결이 없으면 `connectionId` 없이 목록을 요청해 `200`(Mock)이면 "샘플 조건식"으로 보여 주고, `422`면 "내 키움 증권사 연결이 필요합니다. 키움 HTS에서 만든 내 조건식만 실행할 수 있습니다."와 `/settings/connections` 링크를 보여 준다. "운영자 데이터" 선택지는 없앤다.
- `?f=`가 있으면 그 필터를 칩으로 보여 주고 바로 실행.
- `Disclaimer variant="investment"`.

## 10. 테스트

### 백엔드

- 평가기: 연산자 5종, between 경계, null 제외 수, 시장·업종 필터, 정렬·limit, 52주 비율 계산
- `ScreenFilter` 검증: 없는 필드·연산자, between의 value_to 누락·역전, 조건 11개, limit 범위
- 해석: `FakeStructuredLLM`으로 정상·검증 실패(503)·거절(422) 경로, `chips` 생성, 시스템 프롬프트에 기준표가 들어감
- 실행: Mock 스냅샷(`seed-mock`)으로 기대 종목 집합 확인, 스냅샷 없음
- 저장 CRUD·20개 제한·이름 중복, 키움 조건식(Mock 2개, 미지원 501), `encode_filter` 왕복
- 키움 조건식 운영자 키 보호: 운영자 클라이언트가 Kiwoom(가짜 클라이언트·respx)일 때 `connectionId` 없는 목록·실행이 422이고 운영자 클라이언트의 조건식 API를 부르지 않음, Mock이면 샘플 2개, 사용자 연결이 있으면 그 연결로 실행
- 사용자 격리 404

### 프론트

- 자연어 → 칩 → 수정 → 실행 흐름(MSW), `?f=` 진입, 정렬, 관심종목 담기 409 처리, 키움 탭

## 11. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] `seed-mock` 후 예시 4개가 Mock 데이터에서 결과를 낸다(general 공급자(Gemini 키)가 켜져 있으면 수동 확인, 없으면 칩 직접 입력으로 확인). 코디네이터가 develop의 seed-mock 스냅샷(주식 80개)으로 센 기대 건수: 코스피 중형주(`marketCap between 1조~10조`)+`0 < PER ≤ 10` 4건, 코스닥+`tradingValue ≥ 1,000억` 27건, `ROE ≥ 15`+`0 < PBR ≤ 1` 5건, `changeRate > 3` 14건.
- 참고(2026-10-17): 08 Mock 고정 데이터는 시가총액이 모두 5조 미만이고, 52주 최고가 대비 −5% 안이나 최저가 대비 +10% 안인 종목이 없으며, 등락률 최대가 4.96%다. 그래서 "대형주"·"52주 신고가 근처"·"5% 넘게 오른" 조건은 Mock에서 0건이 정상이다(결과 없음 안내). 처음 예시 문구는 이 때문에 위처럼 바꿨다.

## 12. 검증 체크리스트

1. LLM 출력이 필터 모델 검증을 거친 뒤에만 실행된다. 문자열로 쿼리를 조립하는 코드가 없다.
2. 4.1 필드·단위·계산식과 4.2 기준표가 시스템 프롬프트와 `get_filter_guide`에 같은 내용으로 들어 있다.
3. 5~7절 응답 필드·에러 코드가 같다.
4. URL 인코딩 규칙이 백엔드·프론트에서 같다(같은 필터 → 같은 문자열).
5. 서비스 함수 시그니처가 8절과 같다(15의 전제).
6. 사용자 격리 404.

## 구현 결과

- 화이트리스트 필터 모델(추가 필드 금지, 연산자·범위·조건 10개·limit·종류 중복 검증), 최신 스냅샷의 AND 평가, 52주 비율, 누락 지표 제외 수, null 마지막·동률 코드순 정렬을 구현했다. 기본 종류는 주식만이며 ETF와 주식·ETF 선택을 지원한다.
- `screener.parse` general 작업을 공통 `StructuredLLM`으로 호출한다. 시스템 프롬프트는 `get_filter_guide()`의 필드·단위·계산식·기준표를 그대로 포함하며, 검증 실패 503·거절 422·꺼짐 503과 서버 생성 칩을 제공한다.
- 인증이 필요한 5~7절 API, 저장 검색 CRUD·사용자당 20개·이름 중복·사용자 격리, `screener_0001` 마이그레이션을 구현했다. 동시 저장 요청도 상한을 지키도록 사용자별 트랜잭션 잠금을 사용한다.
- 키움 조건식은 허용된 08 서비스 함수로 클라이언트를 얻고 `CONDITIONS` 능력을 확인한다. Mock 조건식 2개와 501 처리를 검증했다. 코디네이터 답변에 따라 스냅샷에 없는 코드의 이름은 공개 `search_stocks(db, code, limit=1)`로 정확히 일치하는 첫 항목만 보완하고, 마스터에도 없으면 코드로 표시한다. 지표는 null이다.
- `/stocks/screener`에 AI 입력·수정/삭제 가능한 조건 칩·직접 조건 추가·종류/시장/업종/limit·결과 정렬·관심종목 담기(409 안내)·저장/불러오기/삭제·연결별 키움 탭을 구현했다. 작은 화면은 결과 카드, 큰 화면은 표로 표시하며 ETF 배지·null 표시·기준일·누락 지표 수·AI 공급자 배지와 필요한 고지를 붙였다. 숫자 열은 백엔드에서 다시 정렬하고, DSL 필드에 없는 종목명·시장은 현재 표시 결과를 정렬한다.
- `encode_filter`와 `encodeFilter`는 기본값을 포함한 camelCase JSON의 키를 재귀 정렬하고, UTF-8 base64url에서 패딩을 제거한다. 소수 문자열의 끝자리 0과 Python Decimal의 지수 표기를 보존하며, 한국어 업종·소수 조건을 포함한 고정 사례로 두 구현의 결과 일치를 확인했다. `?f=` 진입은 필터 검증 후 자동 실행하며 잘못된 링크는 안내한다.
- `seed-mock`으로 종목/스냅샷 90개(주식 80·ETF 10)를 준비한 뒤 실제 API와 독립 Playwright 컨텍스트에서 갱신된 예시의 결과를 확인했다: 코스피 중형주+`0 < PER ≤ 10` **4건**, 코스닥+거래대금 1,000억 이상 **27건**, ROE 15 이상+저PBR **5건**, 등락률 3 초과 **14건**. general AI가 꺼져 있어 실제 LLM 호출 없이 직접 조건/필터 링크로 확인했고, 자연어 흐름은 FakeStructuredLLM·MSW로 검증했다.
- 검증: `scripts/worktree-setup.sh`, `uv run alembic upgrade heads`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`(전체 1,065개, screener 28개), `npm run lint`, `npx tsc --noEmit`, `npm run test`(전체 359개, screener 8개), `npm run build` 통과. 기존 Starlette TestClient deprecation 경고 1건이 있으며 실패는 없다.
- 별도 빈 DB `finance_13_impl_verify`에서 `upgrade heads → downgrade base → upgrade heads`를 통과하고 DB를 삭제했다. 360px·1280px에서 문서 가로 넘침이 없고 브라우저 pageerror가 없음을 확인했으며, 조건 수정·실행과 Mock 키움 탭도 확인했다. `scripts/stop.sh`로 두 서버를 종료했다.
- 스펙과 다른 점: 없음. 코디네이터가 갱신한 예시 문구(develop `1975b0c`)와 이름 보완 지침을 반영했다. 공유 파일·08 모듈·증권사 어댑터·의존성은 수정하지 않았고 테스트에서 실제 외부 API/LLM은 호출하지 않았다.
- 남은 일: 별도 검증 워커의 PR 검증과 코디네이터 병합. 실제 Gemini·증권사 연결 확인은 이 작업에서 수행하지 않았다.

### PR 검증 후 정렬 상태 수정

- 중요 발견 1번을 수정했다. 숫자 열의 정렬 표시와 다음 방향 계산은 상위 `ScreenFilter.sort`를 사용하고, 명시적인 필터 변경/불러오기 외의 재조회에서는 마지막 성공 결과를 유지한다. 재조회 중 표를 유지하고 `aria-busy`·로딩 문구를 표시하며 정렬 조작을 잠시 비활성화한다. 종목명·시장 및 키움 결과의 화면 내 정렬만 별도 표시 상태로 처리한다.
- 회귀 테스트 3개를 추가했다. 수정 전 3개 모두 실패한 것을 확인한 뒤, 숫자 열 두 번 클릭의 `asc → desc` 요청 순서·헤더 방향·지연 응답 중 동일한 표 유지, 모바일 선택 필드 유지·방향 전환, URL 및 저장 검색의 sort 복원을 모두 통과했다.
- 수정 후 `npm run lint`, `npx tsc --noEmit`, `npm run test`(전체 **362개**, screener **11개**), `npm run build` 통과. 백엔드·의존성·공유 파일은 수정하지 않았다.
- 실제 서버와 독립 Playwright Chrome 컨텍스트에서 1280px PER `asc → desc`, 360px PBR 선택 후 `asc → desc`, 응답 지연 중 표 유지, URL ROE `desc → asc`, 저장 검색 현재가 `desc → asc` 요청과 표시를 확인했다. 두 너비의 문서 가로 넘침과 pageerror는 없었고 실제 외부 API/LLM은 호출하지 않았다. `scripts/stop.sh`로 서버를 종료했다.

### 운영자 키 조건식 노출 수정

- 앞선 구현의 '연결 선택(없으면 운영자 데이터)' 동작을 변경했다. `connectionId`가 없으면 운영자 클라이언트가 Mock일 때만 샘플을 허용하며, 실제 증권사(Kiwoom·Toss)는 조건식 API를 호출하기 전에 `422 VALIDATION_ERROR`와 `connectionId` 필드 오류("내 키움 증권사 연결을 선택해 주세요.")로 막는다. 목록·실행에 같은 보호 규칙을 적용하며 사용자 연결과 다른 시장 데이터 API는 기존 경로를 유지한다.
- '내 키움 조건식' 선택지에서 '운영자 데이터'를 없애고 사용자의 active 키움 연결만 표시하며 첫 연결을 기본으로 고른다. 연결 조회가 성공한 뒤 조건식 목록을 요청하므로 초기 렌더에서 불필요한 운영자 목록 요청을 보내지 않는다. 연결이 없고 목록이 Mock 200이면 '샘플 조건식'과 샘플 고지를 표시하고, 422이면 스펙의 연결 안내와 `/settings/connections` 링크를 표시한다.
- 백엔드 회귀 테스트는 Kiwoom·Toss 운영자 클라이언트(능력 유무 모두)의 연결 없는 목록·실행 422와 조건식 API 미호출, Mock 샘플 2개, 사용자 연결로 조회·실행하는 경로를 검증했다. 프론트 MSW 테스트는 선택지 제한·첫 연결 기본 선택·연결 조회 대기 중 조건식 미요청, 연결 변경, 연결 없는 422 안내·링크, Mock 샘플 표시·실행을 검증했다. 기존 사용자 격리 404도 통과했다.
- 검사: `scripts/worktree-setup.sh`, 백엔드 `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`(전체 **1,426개**, screener **33개**), 프론트 `npm run lint`, `npx tsc --noEmit`, `npm run test`(전체 **504개**, screener **13개**), `npm run build`가 통과했다. 기존 Starlette TestClient deprecation 경고 1건이 있으며 실패는 없다.
- 실제 슬롯 13 서버를 Kiwoom 실전 provider 설정(실제 자격증명 없이)으로 실행해 연결 없는 목록·실행의 422와 정확한 필드 오류를 확인했다. Mock 설정으로 재기동해 샘플 목록 2개·실행 200을 확인했다. 독립 Playwright 세션에서 로그인하고 연결 안내·설정 링크 이동·Mock 샘플 표시를 확인했으며, 안내와 샘플 화면 모두 360px·1280px에서 문서 가로 넘침이 없었다. `/api/market/connections/egress-ip`는 브라우저에서 가짜 응답으로 가로챘고 실제 외부 API·LLM은 호출하지 않았다. 확인 후 `scripts/stop.sh`로 서버를 종료했다.
- 스펙과 다른 점: 없음. 소유 경로만 수정했으며 공유 파일·의존성·마이그레이션은 변경하지 않았다.
- 남은 일: 별도 검증 워커의 PR 검증과 코디네이터 병합.
