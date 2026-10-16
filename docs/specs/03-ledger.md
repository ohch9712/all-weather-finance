# 03. 가계부: 수입·지출 수동 입력, 카테고리, 월간 요약

> 웨이브 2 · 브랜치 `feature/03-ledger` · 구현 claude · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 01. 카드 명세서 업로드는 10에서 이 모듈 위에 붙인다.

## 1. 목표

- 수입·지출을 직접 입력·수정·삭제하고, 기본 카테고리와 내 카테고리로 분류한다.
- 월간 요약(수입·지출·순수입, 전월 대비, 카테고리별 비중, 일별 흐름, 자주 쓴 곳)과 최근 6개월 추이를 보여 준다.
- 10이 쓸 중복 방지 키(`dedup_hash`)와 출처(`source`) 컬럼을 미리 둔다.

## 2. 범위

### 포함

- 카테고리 조회·추가·이름 변경·삭제(내 카테고리만)
- 내역 CRUD, 월·종류·카테고리·검색어 필터, 페이지네이션
- 월간 요약, 월별 추이 API
- 화면 `/ledger`
- 서비스 함수 `get_monthly_summary`

### 제외

| 항목 | 처리 |
| --- | --- |
| 카드 명세서·파일 업로드, 자동 분류, 취소 거래 처리 | 10 |
| CODEF 자동 수집 | 17 |
| 예산·알림 | 범위 밖 |
| 계좌 간 이체 구분 | 범위 밖(수입·지출 두 종류만) |

## 3. 소유 파일

- `backend/app/modules/ledger/**`
- `backend/alembic/versions/ledger_0001_*.py`
- `backend/tests/ledger/**`
- `frontend/src/app/(app)/ledger/page.tsx`(자리표시 교체. `ledger/import/`는 10 소유)
- `frontend/src/features/ledger/**`
- `frontend/tests/ledger/**`
- 이 문서의 `## 구현 결과`

## 4. DB 스키마 (revision `ledger_0001`, `branch_labels=("ledger",)`)

### 4.1 `ledger_categories`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NULL이면 기본 카테고리. FK users ON DELETE CASCADE |
| `kind` | `varchar(8)` | NOT NULL, CHECK `income, expense` |
| `name` | `varchar(20)` | NOT NULL |
| `sort_order` | `smallint` | NOT NULL, default 0 |
| `created_at` | `timestamptz` | NOT NULL |

- 부분 유일 인덱스: `(kind, name) WHERE user_id IS NULL`, `(user_id, kind, name) WHERE user_id IS NOT NULL`.
- 마이그레이션에서 기본 카테고리 행을 넣는다(`downgrade`에서 테이블과 함께 제거).
  - 지출(순서대로): 식비, 카페·간식, 교통, 주거·관리비, 통신, 쇼핑, 생활용품, 의료·건강, 교육, 문화·여가, 여행, 경조사·선물, 보험, 세금·공과금, 금융·수수료, 기타 지출
  - 수입: 급여, 상여, 부수입, 금융수입, 용돈·지원, 기타 수입

### 4.2 `ledger_entries`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK users ON DELETE CASCADE |
| `kind` | `varchar(8)` | NOT NULL, CHECK `income, expense` |
| `occurred_on` | `date` | NOT NULL |
| `amount` | `bigint` | NOT NULL, CHECK `amount > 0` |
| `category_id` | `uuid` | NOT NULL, FK `ledger_categories.id` ON DELETE RESTRICT |
| `merchant` | `varchar(100)` | NULL. 사용처·내용 |
| `payment_method` | `varchar(10)` | NOT NULL, default `'other'`, CHECK `card, cash, transfer, other` |
| `memo` | `varchar(200)` | NULL |
| `source` | `varchar(8)` | NOT NULL, default `'manual'`, CHECK `manual, import, codef` |
| `dedup_hash` | `varchar(64)` | NULL. 10·17이 채운다 |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL |

- 인덱스 `(user_id, occurred_on desc)`, 부분 유일 인덱스 `(user_id, dedup_hash) WHERE dedup_hash IS NOT NULL`.
- 10이 `ledger_0002`에서 `card_name`, `approval_no`, `is_cancellation`, `import_batch_id`를 추가한다.

## 5. API 계약 (모두 인증 필요)

### 5.1 카테고리

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/ledger/categories` | | `200 {"items": [Category...]}` 종류 → 기본 먼저 → `sort_order` → 이름 순 |
| `POST /api/ledger/categories` | `{"kind": "expense", "name": "반려동물"}` | `201 Category` |
| `PATCH /api/ledger/categories/{id}` | `{"name": "반려견"}` | `200 Category` |
| `DELETE /api/ledger/categories/{id}` | | `204` |

- `Category`: `{"id", "kind", "name", "isDefault", "sortOrder"}`
- 이름은 공백 제거 후 1~20자. 같은 종류에 같은 이름(기본 포함)이 있으면 `409 CONFLICT`("이미 있는 카테고리입니다.").
- 기본 카테고리 수정·삭제는 `409 CONFLICT`("기본 카테고리는 수정하거나 삭제할 수 없습니다.").
- 내 카테고리를 삭제하면 그 카테고리의 내역을 같은 종류의 "기타 지출"/"기타 수입"으로 옮긴 뒤 지운다.

### 5.2 내역

| 메서드·경로 | 요청 | 성공 |
| --- | --- | --- |
| `GET /api/ledger/entries?month=2026-10&kind=&categoryId=&q=&page=1&pageSize=20` | | `200 Page<Entry>` |
| `POST /api/ledger/entries` | `EntryInput` | `201 Entry` |
| `GET /api/ledger/entries/{id}` | | `200 Entry` |
| `PATCH /api/ledger/entries/{id}` | `EntryInput` 일부 | `200 Entry` |
| `DELETE /api/ledger/entries/{id}` | | `204` |

```json
// EntryInput
{ "kind": "expense", "occurredOn": "2026-10-15", "amount": 12000, "categoryId": "…",
  "merchant": "김밥천국", "paymentMethod": "card", "memo": null }
// Entry = EntryInput + id, categoryName, source, createdAt, updatedAt
```

- 목록 기본값: `month`는 이번 달(KST, `YYYY-MM`), 정렬 `occurredOn desc, createdAt desc`. `q`는 `merchant`·`memo` 부분 일치(대소문자 무시).
- 검증: `amount` 1 이상 1조 이하 정수, `occurredOn` 2000-01-01 이상 오늘+366일 이하, `merchant` 100자, `memo` 200자, `categoryId`는 내가 볼 수 있는 카테고리이고 `kind`가 같아야 한다(아니면 `422`, `field: "categoryId"`, "카테고리를 확인해 주세요.").
- 남의 내역·없는 id는 `404`.

### 5.3 `GET /api/ledger/summary?month=2026-10`

```json
{
  "month": "2026-10",
  "incomeTotal": 3500000,
  "expenseTotal": 1820000,
  "net": 1680000,
  "previous": { "month": "2026-09", "incomeTotal": 3500000, "expenseTotal": 2010000 },
  "expenseChangeRate": -9.45,
  "byCategory": [ { "categoryId": "…", "name": "식비", "kind": "expense", "amount": 520000, "ratio": 28.57 } ],
  "daily": [ { "date": "2026-10-01", "income": 0, "expense": 32000 } ],
  "topMerchants": [ { "merchant": "김밥천국", "amount": 96000, "count": 8 } ]
}
```

- `byCategory`는 종류별 금액 내림차순, `ratio`는 같은 종류 합계 대비 비율(소수 둘째 자리).
- `daily`는 그 달의 모든 날짜(빈 날 0 포함).
- `topMerchants`는 지출 중 `merchant`가 있는 것 상위 5개(금액 기준).
- `expenseChangeRate` = (이번 달 지출 − 전월 지출) ÷ 전월 지출 × 100, 전월 지출이 0이면 `null`.

### 5.4 `GET /api/ledger/trend?months=6`

- `months` 1~24(기본 6). 이번 달을 포함한 최근 N개월. `200 {"items": [{"month": "2026-05", "incomeTotal": ..., "expenseTotal": ...}]}` 오래된 달부터.

## 6. 다른 모듈용 서비스 함수

```python
# app/modules/ledger/service.py
class MonthlySummary(CamelModel): ...   # 5.3 응답과 같은 필드

def get_monthly_summary(db, user_id, month: date) -> MonthlySummary   # month는 그 달 1일
```

- 15(챗봇)와 16(대시보드)이 쓴다. 10은 이 파일에 `import_entries`를 추가하고, 취소 거래(`is_cancellation`)를 요약 계산에 반영한다.

## 7. 화면 명세 (`/ledger`)

- 상단: 월 이동(◀ 2026년 10월 ▶), "내역 추가" 버튼, "카드 명세서 가져오기" 버튼(`/ledger/import`, 10이 만들기 전까지는 자리표시 페이지로 이동).
- 요약 카드 4개: 수입, 지출, 순수입, 전월 대비 지출(증감률, 줄면 "아꼈어요").
- 차트: 지출 카테고리 도넛(상위 6개 + 나머지 "그 외"), 일별 지출 막대, 최근 6개월 수입·지출 막대.
- 자주 쓴 곳 상위 5개 목록.
- 내역 목록: 날짜별 묶음(날짜 헤더에 그날 합계), 항목은 카테고리 칩·사용처·결제수단·금액. 수입은 `+` 접두와 파란색, 지출은 `-` 접두와 기본 글자색. 무한 스크롤 대신 페이지 버튼.
- 필터: 종류 탭(전체/수입/지출), 카테고리 선택, 검색어(300ms 디바운스). 필터는 URL 쿼리(`?month=&kind=&categoryId=&q=`)에 반영한다.
- 추가·수정 다이얼로그: 종류 토글, 날짜(기본 오늘), 금액(숫자, 천 단위 구분 표시), 카테고리(종류에 맞게), 사용처, 결제수단, 메모. 저장 후 목록·요약·추이 쿼리를 무효화한다.
- 카테고리 관리 다이얼로그: 내 카테고리 추가·이름 변경·삭제(삭제 시 "내역은 기타로 옮겨집니다" 확인).
- 출처가 `import`·`codef`인 내역에는 작은 출처 배지를 붙인다.

## 8. 테스트

### 백엔드 (`backend/tests/ledger/`)

- 기본 카테고리 22개가 마이그레이션 후 존재하고 사용자 모두에게 보인다
- 카테고리: 추가, 중복 409(기본과 같은 이름 포함), 기본 수정·삭제 409, 삭제 시 내역 이동
- 내역 CRUD, 검증 422(금액 0, 범위 밖 날짜, 종류가 다른 카테고리, 남의 카테고리)
- 목록 필터(월·종류·카테고리·검색어)와 정렬, 페이지네이션
- 요약: 합계·순수입·전월·증감률(전월 0일 때 null)·카테고리 비율·일별 빈 날 0·상위 사용처
- 추이: 빈 달 0 포함
- 다른 사용자 내역·카테고리 접근 404

### 프론트 (`frontend/tests/ledger/`, MSW)

- 요약 카드·차트 영역 렌더링, 월 이동 시 쿼리 변경
- 내역 추가·수정·삭제 흐름과 목록 갱신
- 필터의 URL 반영
- 카테고리 관리

## 9. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 전 항목
- [ ] 실제 서버로 내역 추가 → 요약·차트 반영 → 수정 → 삭제가 동작한다
- [ ] 360px에서 요약 카드·목록이 깨지지 않는다

## 10. 검증 체크리스트

1. 기본 카테고리 이름·순서가 4.1과 같다.
2. 5절 응답 필드·상태코드·에러 코드가 일치한다. 금액은 정수다.
3. `dedup_hash` 부분 유일 인덱스와 `source` CHECK 값이 4.2와 같다(10·17의 전제).
4. 카테고리 삭제 시 내역 이동이 트랜잭션 안에서 일어난다.
5. 요약 계산이 경계(월말·월초, 전월 0)에서 맞다.
6. `get_monthly_summary` 시그니처가 6절과 같다.
7. 사용자 격리 404.

## 11. 다음 단계 연결점

- 10: `ledger_0002`로 컬럼을 더하고 `import_entries`, 가맹점 규칙 학습, 취소 거래 반영, `/ledger/import` 화면을 만든다.
- 15·16: `get_monthly_summary`를 쓴다.

## 구현 결과

### 구현한 것

- 백엔드 `app/modules/ledger/`: 모델(`LedgerCategory`, `LedgerEntry`), 리포지토리(필터·집계 쿼리), 서비스, 라우터. 5절의 엔드포인트 11개(카테고리 4, 내역 5, 요약, 추이)와 공개 함수 `get_monthly_summary(db, user_id, month: date) -> MonthlySummary`.
- 마이그레이션 `ledger_0001`(`down_revision="foundation_0001"`, `branch_labels=("ledger",)`): 4절의 두 테이블, CHECK 제약, 부분 유일 인덱스 3개, `(user_id, occurred_on desc)` 인덱스, 기본 카테고리 22개(지출 16·수입 6, 목록 순서대로 `sort_order` 1부터). `downgrade`는 인덱스와 테이블(기본 행 포함)을 지운다.
- 카테고리 삭제는 내역을 같은 종류의 "기타 지출"/"기타 수입"으로 옮기는 UPDATE와 DELETE를 한 커밋으로 처리하고, 실패하면 둘 다 되돌린다.
- 프론트 `/ledger`: 월 이동(◀ 2026년 10월 ▶, 다른 달이면 "이번 달" 버튼), "내역 추가"·"카드 명세서 가져오기"(`/ledger/import`) 버튼, 요약 카드 4개, 지출 카테고리 도넛(상위 6 + "그 외"), 일별 지출 막대, 최근 6개월 수입·지출 막대, 자주 쓴 곳 상위 5, 필터(종류 탭·카테고리·검색어 300ms 디바운스, URL `?month=&kind=&categoryId=&q=` 반영), 날짜별 묶음 목록(그날 합계, 수입 `+`·파란색, 지출 `-`, 출처 배지), 이전·다음 페이지 버튼, 추가·수정 다이얼로그(삭제 확인 포함), 카테고리 관리 다이얼로그(추가·이름 변경·삭제 확인 "내역은 기타로 옮겨집니다").
- 테스트: 백엔드 `tests/ledger/` 70개(8절 항목 전부, 카테고리 삭제 트랜잭션 롤백, KST 월 경계, 사용자 격리 404 포함), 프론트 `tests/ledger/` 28개(MSW 메모리 가짜 서버).

### 스펙에 없어 정한 것

- `MonthlySummary`와 하위 모델은 `schemas.py`에 두고 `service.py`가 import한다. `from app.modules.ledger.service import MonthlySummary, get_monthly_summary`로 쓸 수 있다. `month`에 1일이 아닌 날을 넘기면 그 달로 본다.
- 정렬 세부: 카테고리 목록의 종류 순서는 지출 → 수입. 내역은 `occurredOn desc, createdAt desc` 뒤에 `id desc`로 동률을 끊는다. `byCategory`는 지출 → 수입, 각 금액 내림차순(같으면 이름). `topMerchants`는 금액 → 건수 → 이름. 비율과 증감률은 사사오입(ROUND_HALF_UP)으로 소수 둘째 자리다.
- `createdAt`·`updatedAt`은 DB 기본값과 함께 애플리케이션 시각(`now_utc`)을 기본값으로 넣는다. 한 트랜잭션에서 여러 건을 넣어도 입력 순서가 남는다. 새 내 카테고리의 `sortOrder`는 0이다.
- 쿼리: 빈 값(`kind=&categoryId=&q=`)은 조건 없음이다. `month`는 `YYYY-MM`(1000년 이상)이 아니면 `422`(`field: "month"`), `kind`가 `income`/`expense`가 아니면 `field: "kind"`, `categoryId`가 UUID가 아니면 `field: "categoryId"`, `q`가 100자를 넘으면 `field: "q"`. `q`의 `%`·`_`는 글자 그대로 찾는다. `summary`의 `month`를 빼면 이번 달(KST)이다.
- 경로의 id가 UUID 형식이 아니면 FastAPI 기본 검증으로 `422`(`field: "categoryId"`/`"entryId"`)다. 형식이 맞는데 없거나 남의 것이면 `404`다.
- `DELETE`도 다른 상태 변경 요청처럼 `require_json`을 건다(`apiFetch`가 본문 없는 DELETE에 `Content-Type: application/json`을 붙인다).
- `PATCH /entries/{id}`: 보낸 필드만 바꾼다. `merchant`·`memo`만 `null`로 지울 수 있고 다른 필드의 `null`은 `422`("필수 항목입니다."). 종류만 바꿔 지금 카테고리와 종류가 달라지면 `422`(`field: "categoryId"`). 빈 본문은 바꾸지 않고 `200`이다. `merchant`·`memo`는 앞뒤 공백을 지우고 빈 문자열은 `null`로 저장한다. `amount`는 JSON 정수만 받는다(`12000.0`, `"12000"`은 `422`).
- `categoryId` 422는 develop에 추가된 `app.core.errors.field_error`로 던진다(검증 체크리스트 2의 응답 형식은 같다).
- 화면: 날짜 헤더의 그날 합계는 지금 쪽에 보이는 내역으로 계산한다(한 날짜가 두 쪽에 걸치면 쪽마다 부분 합계). 페이지 번호는 URL에 넣지 않고 화면 상태로 두며 필터가 바뀌면 1쪽부터 본다. 최근 6개월 추이는 선택한 달과 상관없이 이번 달(KST) 기준이다(5.4).
- 화면: 새 내역의 결제수단 기본값은 지출 "카드", 수입 "계좌이체"이고 직접 고르면 바꾸지 않는다. 출처 배지 문구는 `import` "명세서", `codef` "자동 수집"이다. 사용처가 없으면 메모, 메모도 없으면 카테고리 이름을 내역 제목으로 쓴다.
- 고지: 가계부 화면은 자산배분·종목·세금·AI·Mock 화면이 아니라 `Disclaimer`를 붙이지 않았다.
- `features/auth`의 `FormAlert`는 다른 모듈 내부 컴포넌트라 쓰지 않고 같은 모양의 `LedgerFormAlert`를 뒀다.
- `ledger_entries.category_id` 단독 인덱스는 스펙에 없어 만들지 않았다(목록·집계는 `(user_id, occurred_on desc)`를 쓴다).

### 검사 결과

- 백엔드: `uv run ruff check .`·`uv run ruff format --check .` 통과, `uv run pytest` 181개 통과(가계부 70개).
- 마이그레이션: 빈 DB `finance_03_cycle`에서 `upgrade heads` → `downgrade base` → `upgrade heads` 성공(기본 카테고리 22개 확인) 후 DB 삭제.
- 프론트: `npm run lint`·`npx tsc --noEmit` 통과, `npm run test` 230개 통과(가계부 28개), `npm run build` 성공.
- 실제 서버(`scripts/start.sh`, 8003·3003): API로 가입 → 내역 추가(201) → 요약 반영 → 수정(200) → 목록 필터·페이지 → 추이 → 삭제(204, 다시 조회 404)와 에러 코드(422 `categoryId`·`amount`·`month`·`months`, 409 기본 카테고리·중복, 401)를 확인했다. 화면(Orca 내장 브라우저, 360×780)에서 로그인 → `/ledger` → 내역 추가 → 요약 카드 반영을 확인했고, 360px에서 `scrollWidth`가 360(가로 넘침 요소 0개), 추가 다이얼로그 폭 328px이다. 수정·삭제 화면 조작은 Orca 런타임 연결이 끊겨 브라우저로는 마치지 못했고, 같은 흐름을 실제 서버 API와 MSW 화면 테스트로 확인했다. 확인 후 `scripts/stop.sh`로 서버를 멈췄다.

### 남은 일

- 10: `ledger_0002`(카드 컬럼·`ledger_merchant_rules`), `import_entries`, 취소 거래의 요약 반영, `/ledger/import` 화면.
- 15·16: `get_monthly_summary` 사용.
