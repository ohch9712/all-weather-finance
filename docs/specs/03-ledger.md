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
