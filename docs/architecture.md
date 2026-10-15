# 아키텍처

> 모든 작업 스펙(`docs/specs/01~18`)이 공유하는 기술 기준이다. 상위 결정은 `docs/specs/00-master-plan.md`, 작업 규칙은 `AGENTS.md`에 있다.
> 이 문서의 이름(모듈, 경로, 테이블, revision ID, 서비스 함수, 에러 코드)은 계약이다. 바꿔야 하면 워커가 직접 고치지 말고 코디네이터에게 묻는다.

## 1. 시스템 구성

```mermaid
flowchart LR
  U[브라우저<br/>Next.js App Router] -->|fetch + HttpOnly 쿠키| A[FastAPI<br/>/api/*]
  A --> D[(Postgres 17)]
  A -->|Anthropic Python SDK| L[Claude API]
  A -->|REST + 웹소켓, 조회 전용| K[키움 REST API]
  A -->|REST, 조회 전용| T[토스증권 Open API]
  A -->|REST| C[CODEF]
  J[배치 명령<br/>종목·스냅샷 갱신] --> K
  J --> T
  J --> D
```

- 브라우저는 백엔드를 직접 호출한다(gamja-market과 같은 구조). 프론트 서버가 API를 대신 호출하지 않는다.
- 외부 서비스는 전부 백엔드 어댑터 뒤에 있다. 기본값은 Mock이라 키가 없어도 모든 기능이 동작한다.
- 주문·매매 실행 API는 어디에도 만들지 않는다. 증권사 연동은 시세·종목·잔고·체결 조회만 한다.

## 2. 실행 환경

### 2.1 로컬 개발 구성

| 구성 요소 | 실행 | 기본값 |
| --- | --- | --- |
| Postgres | 저장소 루트 `compose.yaml`, compose 프로젝트 이름 `finance` 고정 | `127.0.0.1:5433`, 사용자 `finance`, 비밀번호 `finance_local_password` |
| 백엔드 | `cd backend && uv run uvicorn app.main:app --port $BACKEND_PORT --reload` | 포트 `8000 + 슬롯` |
| 프론트 | `cd frontend && npm run dev -- --port $FRONTEND_PORT` | 포트 `3000 + 슬롯` |

- Postgres 호스트 포트는 5433이다. gamja-market 컨테이너가 5432를 쓰기 때문이다.
- 모든 워크트리가 Postgres 컨테이너 하나를 같이 쓰고, **DB는 워크트리마다 따로** 쓴다.

### 2.2 워크트리 슬롯

`scripts/worktree-setup.sh`(01a)가 현재 브랜치 이름으로 슬롯을 정한다.

| 브랜치 | 슬롯 | 백엔드 | 프론트 | DB |
| --- | --- | --- | --- | --- |
| `main`, `develop`, 그 밖의 이름 | `00` | 8000 | 3000 | `finance_00` |
| `feature/NN-<slug>` | `NN` | `8000+NN` | `3000+NN` | `finance_NN` |

- 같은 슬롯을 두 워크트리가 동시에 쓰지 않는다. 검증 워커는 구현 워커와 같은 워크트리를 쓰므로 같은 슬롯이다(동시에 돌지 않는다).
- 설정 스크립트는 `backend/.env`와 `frontend/.env.local`을 만들고(이미 있으면 슬롯 값만 맞춘다), DB를 만들고, `uv sync`, `npm ci`, `uv run alembic upgrade heads`를 실행한다.

### 2.3 환경변수

`backend/.env`(커밋 금지, `.env.example`은 커밋)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `APP_ENV` | `development` | `development` / `test` / `production` |
| `DATABASE_URL` | `postgresql+psycopg://finance:finance_local_password@localhost:5433/finance_00` | 드라이버 없는 URL은 `postgresql+psycopg://`로 정규화 |
| `MIGRATION_DATABASE_URL` | 비어 있음 | 비면 `DATABASE_URL` 사용 |
| `DB_CONNECT_TIMEOUT_SECONDS` | `5` | |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS 허용 origin(정확히 하나) |
| `SESSION_COOKIE_NAME` | `finance_session` | |
| `SESSION_TTL_SECONDS` | `604800` | 7일 고정 만료 |
| `COOKIE_SECURE` | `false` | 운영에서 `true` |
| `APP_ENCRYPTION_KEY` | 설정 스크립트가 생성 | Fernet 키. 자격증명 암호화용 |
| `LLM_MODE` | `disabled` | `anthropic`이면 실제 호출. `disabled`면 LLM 기능이 `LLM_UNAVAILABLE`을 돌려준다 |
| `ANTHROPIC_API_KEY` | 비어 있음 | SDK가 환경변수에서 읽는다 |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | |
| `LLM_FALLBACKS_ENABLED` | `true` | 서버 측 거절 폴백(`fallbacks: "default"`) 사용 |
| `MARKET_DATA_PROVIDER` | `mock` | `mock` / `kiwoom` / `toss`. 운영자 키로 시세·종목·스냅샷을 가져오는 원천 |
| `KIWOOM_ENV` | `mock` | `mock`(모의투자 도메인) / `real` |
| `KIWOOM_APP_KEY`, `KIWOOM_APP_SECRET` | 비어 있음 | 운영자 시장 데이터용 |
| `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET` | 비어 있음 | 운영자 시장 데이터용 |
| `CODEF_ENV` | `sandbox` | `sandbox` / `development` / `production` |
| `CODEF_CLIENT_ID`, `CODEF_CLIENT_SECRET`, `CODEF_PUBLIC_KEY` | 비어 있음 | 17에서 사용 |
| `CHAT_DAILY_MESSAGE_LIMIT` | `100` | 사용자별 하루 메시지 상한 |
| `IMPORT_MAX_FILE_MB` | `10` | 업로드 상한 |

`frontend/.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:<백엔드 포트>`

## 3. 저장소 구조와 소유 작업

대괄호는 그 경로를 만들고 고칠 수 있는 작업 번호다. 이후 웨이브 작업이 앞 작업의 경로를 고치는 경우는 각 스펙의 "소유 파일" 절에 명시한다.

```
/
├── AGENTS.md, CLAUDE.md                      [코디네이터]
├── docs/architecture.md, docs/roadmap.md     [코디네이터]
├── docs/specs/00-master-plan.md              [코디네이터]
├── docs/specs/NN-*.md                        [각 작업은 자기 스펙의 "구현 결과" 절만 추가]
├── orca.yaml, compose.yaml, .gitignore       [01a]
├── scripts/                                  [01a]  worktree-setup.sh, start.sh, stop.sh, lib/
├── backend/
│   ├── pyproject.toml, uv.lock, alembic.ini, .env.example, .python-version  [01a]
│   ├── alembic/env.py, alembic/script.py.mako                              [01a]
│   ├── alembic/versions/<revision id>_*.py   [revision을 소유한 작업, 7절]
│   ├── app/
│   │   ├── main.py                           [01a]
│   │   ├── core/                             [01a]  config, errors, schemas, security, cookies, cors, crypto, time, logging
│   │   ├── db/                               [01a]  base, session, models(전 모듈 모델 import)
│   │   ├── api/                              [01a]  router(전 모듈 라우터 등록), deps, health
│   │   ├── integrations/
│   │   │   ├── llm/                          [01a]
│   │   │   ├── brokers/                      [08]
│   │   │   └── codef/                        [17]
│   │   └── modules/
│   │       ├── auth/                         [01a]
│   │       ├── allocation/                   [02, 14]
│   │       ├── ledger/                       [03, 10]
│   │       ├── imports/                      [04]
│   │       ├── journal/                      [05, 11]
│   │       ├── estate/                       [06]
│   │       ├── learn/                        [07]
│   │       ├── market/                       [08]
│   │       ├── chat/                         [09, 15]
│   │       ├── watchlist/                    [12]
│   │       ├── screener/                     [13]
│   │       ├── dashboard/                    [16]
│   │       └── connectors/                   [17]
│   └── tests/
│       ├── conftest.py, foundation/          [01a]
│       └── <module>/                         [모듈 작업]
└── frontend/
    ├── package.json, package-lock.json, 설정 파일들, .env.example          [01b]
    ├── src/
    │   ├── app/layout.tsx, providers.tsx, globals.css, not-found.tsx     [01b]
    │   ├── app/(auth)/                       [01b]  login, signup
    │   ├── app/(app)/layout.tsx              [01b]  앱 셸
    │   ├── app/(app)/page.tsx                [01b 자리표시 → 16]
    │   ├── app/(app)/onboarding/, settings/profile/   [01b]
    │   ├── app/(app)/allocation/             [02, 14]
    │   ├── app/(app)/ledger/                 [03, 10]
    │   ├── app/(app)/journal/                [05, 11]
    │   ├── app/(app)/estate/                 [06]
    │   ├── app/(app)/learn/, admin/learn/    [07]
    │   ├── app/(app)/settings/connections/   [08, 17]
    │   ├── app/(app)/chat/                   [09, 15]
    │   ├── app/(app)/stocks/watchlist/, stocks/[code]/   [12]
    │   ├── app/(app)/stocks/screener/        [13]
    │   ├── components/ui/, layout/, charts/, common/      [01b]
    │   ├── features/auth/                    [01b]
    │   ├── features/<module>/                [모듈 작업]  (12는 종목 검색·상세용 features/stocks/도 소유)
    │   ├── lib/                              [01b]  api-client, format, navigation, query
    │   └── types/api.ts                      [01b]
    └── tests/
        ├── setup.ts, foundation/             [01b]
        └── <module>/                         [모듈 작업]
```

01a와 01b는 모든 모듈의 빈 자리를 미리 만든다. 백엔드는 `modules/<module>/{__init__.py, router.py, models.py}` 스텁과 라우터 등록, 프론트는 각 경로의 자리표시 `page.tsx`와 내비게이션 항목이다. 모듈 작업은 이 자리를 채우기만 하고 공유 파일을 고치지 않는다.

### 3.1 백엔드 모듈 내부 구조

```
modules/<module>/
  __init__.py
  router.py      # FastAPI APIRouter(prefix="/<module>"). HTTP 계층
  schemas.py     # 요청·응답 Pydantic 모델(CamelModel 상속)
  service.py     # 도메인 로직. 다른 모듈이 호출하는 공개 함수는 여기에만 둔다
  repository.py  # SQLAlchemy 쿼리
  models.py      # ORM 모델(app.db.base.Base 상속)
  (선택) rules.py, jobs.py, cli.py, seed.py, fixtures/
```

- 다른 모듈은 `app.modules.<module>.service`의 공개 함수와 그 함수가 쓰는 타입만 import한다. 다른 모듈의 `repository`, `models`, `router`는 import하지 않는다.
- FK는 `users.id`에만 건다. 다른 모듈 테이블은 ID 값만 저장한다(FK 없음). 그래서 모듈 마이그레이션끼리 순서 의존이 생기지 않는다.

### 3.2 프론트 기능 폴더 구조

```
features/<module>/
  api.ts         # apiFetch 호출. 화면 컴포넌트는 fetch를 직접 쓰지 않는다
  types.ts       # API 타입(백엔드 camelCase 그대로)
  hooks.ts       # TanStack Query 훅(useQuery/useMutation)
  components/
  utils.ts
```

## 4. 공통 API 규약

- 경로는 모두 `/api`로 시작하고 모듈 접두어를 붙인다: `/api/<module>/...`. 예외는 `/api/health`, `/api/auth/*`, `/api/profile`(01a).
- 요청·응답 JSON 필드는 camelCase다. 백엔드는 `app.core.schemas.CamelModel`(`alias_generator=to_camel`, `populate_by_name=True`)을 상속하고 FastAPI 기본값 `response_model_by_alias=True`를 쓴다.
- 상태를 바꾸는 요청은 `Content-Type: application/json`만 받는다(`require_json`). 파일 업로드 엔드포인트만 `multipart/form-data`다.
- 인증은 쿠키 `finance_session`으로만 한다. `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, `Secure`는 `COOKIE_SECURE`.
- ID는 UUID 문자열이다.
- **금액(원)**은 정수(JSON number)다. 외화 가격, 수량, 세율처럼 소수 정밀도가 중요한 값은 **문자열 decimal**(예: `"123.4500"`)이다. 비중·등락률처럼 화면 표시용 비율은 숫자(소수 둘째 자리까지)다.
- 날짜는 `YYYY-MM-DD`, 시각은 ISO 8601 UTC(`2026-10-16T03:21:45Z`)다. 화면은 KST로 표시한다.
- 목록 페이지네이션: 요청 `?page=1&pageSize=20`(최대 100), 응답 `{ "items": [...], "page": 1, "pageSize": 20, "total": 123 }`.
- 다른 사용자의 자원은 존재하지 않는 것처럼 `404 NOT_FOUND`로 응답한다.

### 4.1 에러 응답

모든 4xx·5xx는 같은 형식이다. gamja-market의 `core/errors.py` 방식(핸들러 교체, `AppError`)을 이식한다.

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "입력값을 확인해 주세요.", "details": [{ "field": "birthYear", "message": "..." }] } }
```

| code | HTTP | 쓰는 곳 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | 쿠키 없음·세션 없음·만료 |
| `INVALID_CREDENTIALS` | 401 | 로그인 실패 |
| `FORBIDDEN` | 403 | 관리자 전용 경로 |
| `NOT_FOUND` | 404 | 없는 경로·자원, 남의 자원 |
| `METHOD_NOT_ALLOWED` | 405 | |
| `EMAIL_ALREADY_EXISTS` | 409 | 가입 |
| `CONFLICT` | 409 | 중복 생성(예: 이미 있는 관심종목) |
| `PROFILE_INCOMPLETE` | 409 | 출생연도가 없어 나이대를 알 수 없음 |
| `RISK_PROFILE_REQUIRED` | 409 | 투자성향 진단 전 권장 배분 요청 |
| `BROKER_NOT_CONNECTED` | 409 | 증권사 연결 없이 계좌 데이터 요청 |
| `VALIDATION_ERROR` | 422 | 본문·쿼리 검증 실패 |
| `IMPORT_FILE_ENCRYPTED` | 422 | 암호 걸린 파일 |
| `IMPORT_HEADER_NOT_FOUND` | 422 | 표 머리행을 찾지 못함 |
| `LLM_REFUSED` | 422 | 모델이 거절(`stop_reason == "refusal"`) |
| `IMPORT_FILE_TOO_LARGE` | 413 | |
| `IMPORT_FILE_UNSUPPORTED` | 415 | |
| `IMPORT_JOB_EXPIRED` | 410 | 만료된 임포트 작업 |
| `RATE_LIMITED` | 429 | 일반 호출 제한(`Retry-After` 포함) |
| `CHAT_LIMIT_EXCEEDED` | 429 | 챗봇 하루 상한 |
| `INTERNAL_ERROR` | 500 | 처리되지 않은 예외 |
| `BROKER_NOT_SUPPORTED`, `CONNECTOR_NOT_SUPPORTED` | 501 | 어댑터가 지원하지 않는 기능 |
| `BROKER_AUTH_FAILED`, `BROKER_IP_NOT_ALLOWED`, `BROKER_UNAVAILABLE`, `CONNECTOR_FAILED` | 502 | 외부 서비스 오류 |
| `LLM_UNAVAILABLE`, `BROKER_RATE_LIMITED` | 503 | 키 없음·외부 장애·외부 호출 한도 |

새 에러 코드가 필요하면 스펙에 적힌 것만 쓴다. 스펙에 없으면 코디네이터에게 묻는다.

## 5. 데이터 모델

정확한 컬럼·제약·인덱스는 각 스펙이 기준이다. 아래는 모듈 간 합의를 위한 요약이다.

| 모듈 | 테이블 | 핵심 컬럼 | 작업 |
| --- | --- | --- | --- |
| foundation | `users` | id, email(정규화, unique), password_hash, role(`user`/`admin`), created_at, updated_at | 01a |
| foundation | `sessions` | id, user_id, token_hash(unique), expires_at, created_at | 01a |
| foundation | `user_profiles` | user_id(PK), birth_year, nickname, created_at, updated_at | 01a |
| allocation | `risk_assessments` | id, user_id, survey_version, answers(JSONB), score, risk_profile, created_at | 02 |
| allocation | `holdings` | id, user_id, name, asset_class, amount, include_in_allocation, source, memo, created_at, updated_at (+14: external_ref, connection_id, synced_at, class_override) | 02, 14 |
| allocation | `allocation_scores` | id, user_id, scored_on(사용자·날짜 unique), score, grade, total_amount, actual_weights(JSONB), target_weights(JSONB), age_band, risk_profile, created_at, updated_at | 02 |
| ledger | `ledger_categories` | id, user_id(null=기본), kind(`income`/`expense`), name, sort_order | 03 |
| ledger | `ledger_entries` | id, user_id, kind, occurred_on, amount, category_id, merchant, payment_method, memo, source, dedup_hash, created_at, updated_at (+10: card_name, approval_no, is_cancellation, import_batch_id) | 03, 10 |
| ledger | `ledger_merchant_rules` | id, user_id, merchant_pattern, category_id, created_at | 10 |
| imports | `import_jobs` | id, user_id, kind, status, file_name, sheet_names, header_row, columns(JSONB), rows(JSONB), mapping(JSONB), mapping_source, expires_at, created_at | 04 |
| journal | `trades` | id, user_id, traded_at, market, symbol_code, symbol_name, side, quantity, price, currency, fee, tax, broker, source, dedup_hash, created_at, updated_at (+11: connection_id, external_id, synced_at) | 05, 11 |
| journal | `trade_notes` | id, user_id, trade_id(null 가능), symbol_code(null 가능), noted_on, kind(`plan`/`review`/`memo`), content, tags, emotion, created_at, updated_at | 05 |
| estate | `family_members` | id, user_id, relation, display_name, birth_date, married_on, child_birth_dates, created_at, updated_at | 06 |
| estate | `gift_records` | id, user_id, recipient_id, donor_group, deduction_category, gifted_on, asset_type, amount, appraisal_fee, tax_paid, filed, memo, created_at, updated_at | 06 |
| learn | `posts` | id, kind(`article`/`video`/`glossary`), slug(unique), title, summary, body_md, video_url, term, level, tags, published, published_at, author_id, created_at, updated_at | 07 |
| learn | `bookmarks` | user_id, post_id, created_at | 07 |
| learn | `post_reads` | user_id, post_id, read_at | 07 |
| market | `stocks` | code(PK), market, name, sector, listed, updated_at | 08 |
| market | `stock_snapshots` | as_of, code, price, change_rate, volume, trading_value, market_cap, per, pbr, roe, eps, bps, foreign_ratio, high_52w, low_52w, source | 08 |
| market | `broker_connections` | id, user_id, provider, environment, label, app_key_enc, app_secret_enc, account_no_enc, status, last_verified_at, created_at, updated_at | 08 |
| chat | `chat_conversations` | id, user_id, title, created_at, updated_at | 09 |
| chat | `chat_messages` | id, conversation_id, seq, role, content(JSONB, API 블록 원본), text_preview, cards(JSONB), model, stop_reason, usage(JSONB), created_at | 09 |
| watchlist | `watchlist_items` | id, user_id, stock_code, group_name, memo, sort_order, created_at | 12 |
| screener | `saved_screens` | id, user_id, name, query_text, filter(JSONB), created_at | 13 |
| connectors | `connector_accounts` | id, user_id, provider, kind, connected_id_enc, label, created_at | 17 |
| connectors | `connector_syncs` | id, user_id, account_id, kind, status, started_at, finished_at, summary(JSONB), error_code | 17 |

공통 규칙

- PK는 `uuid` + `gen_random_uuid()`(stocks만 `code` 자연키, `stock_snapshots`는 `(as_of, code)` 복합키, `bookmarks`·`post_reads`는 `(user_id, post_id)`).
- 시각은 `timestamptz`, 날짜는 `date`, 원 금액은 `bigint`, 소수 값은 `numeric(20,6)`.
- 사용자 소유 테이블은 `user_id uuid not null references users(id) on delete cascade`와 `(user_id, ...)` 인덱스를 둔다.
- 열거형 값은 `varchar` + `CHECK` 제약으로 둔다(Postgres ENUM 타입을 쓰지 않는다. 값 추가가 쉬워진다).

## 6. 도메인 공통 상수

| 이름 | 값 | 표시 |
| --- | --- | --- |
| 자산군 `AssetClass` | `stock`, `bond`, `gold`, `cash`, `other` | 주식, 채권, 금, 현금성 자산, 기타 |
| 투자성향 `RiskProfile` | `stable`, `stable_seeking`, `neutral`, `active`, `aggressive` | 안정형, 안정추구형, 위험중립형, 적극투자형, 공격투자형 |
| 나이대 `AgeBand` | `20s`, `30s`, `40s`, `50s`, `60s` | 20대(20세 미만 포함), 30대, 40대, 50대, 60대 이상 |
| 나이 계산 | 기준연도 − 출생연도 | 연 나이 |
| 자산군 색 토큰 | `--asset-stock`, `--asset-bond`, `--asset-gold`, `--asset-cash`, `--asset-other` | 01b가 `globals.css`에 정의, 모든 차트·카드가 같은 색을 쓴다 |

백엔드는 `app/core/domain.py`(01a)에, 프론트는 `src/lib/domain.ts`(01b)에 같은 값과 한국어 표시명을 둔다.

## 7. 마이그레이션 규칙과 revision 목록

- 각 모듈은 자기 Alembic 브랜치를 가진다. 루트 revision `foundation_0001`에서 갈라지고, 모듈의 첫 revision에 `branch_labels=("<module>",)`를 단다.
- 적용은 항상 `uv run alembic upgrade heads`(복수형)다. 여러 head가 있는 것이 정상이다.
- 새 revision은 스펙에 적힌 ID로 만든다.
  - 모듈 첫 revision: `uv run alembic revision -m "<설명>" --head foundation_0001 --branch-label <module> --rev-id <module>_0001`
  - 같은 모듈의 다음 revision: `uv run alembic revision -m "<설명>" --head <module>@head --rev-id <module>_0002`
- `--autogenerate`를 쓰더라도 결과를 손으로 검토한다. 다른 모듈 테이블을 건드리는 revision은 만들지 않는다.
- 모든 revision은 `downgrade`를 구현한다. 빈 DB에서 `upgrade heads` → `downgrade base` → `upgrade heads`가 성공해야 한다.

| revision ID | 모듈 | 작업 | 내용 |
| --- | --- | --- | --- |
| `foundation_0001` | foundation | 01a | users, sessions, user_profiles |
| `allocation_0001` | allocation | 02 | risk_assessments, holdings, allocation_scores |
| `ledger_0001` | ledger | 03 | ledger_categories(기본 카테고리 행 포함), ledger_entries |
| `imports_0001` | imports | 04 | import_jobs |
| `journal_0001` | journal | 05 | trades, trade_notes |
| `estate_0001` | estate | 06 | family_members, gift_records |
| `learn_0001` | learn | 07 | posts, bookmarks, post_reads |
| `market_0001` | market | 08 | stocks, stock_snapshots, broker_connections |
| `chat_0001` | chat | 09 | chat_conversations, chat_messages |
| `ledger_0002` | ledger | 10 | ledger_merchant_rules, ledger_entries 컬럼 추가 |
| `journal_0002` | journal | 11 | trades 컬럼 추가 |
| `watchlist_0001` | watchlist | 12 | watchlist_items |
| `screener_0001` | screener | 13 | saved_screens |
| `allocation_0002` | allocation | 14 | holdings 컬럼 추가 |
| `connectors_0001` | connectors | 17 | connector_accounts, connector_syncs |

## 8. 모듈 간 서비스 함수 (공개 인터페이스)

다른 모듈이 호출해도 되는 함수는 아래뿐이다. 시그니처는 계약이고, 구현 작업이 바뀌어도 유지한다. 모든 함수는 동기 함수이고 첫 인자는 `db: sqlalchemy.orm.Session`이다(순수 계산 함수 제외). 반환 타입은 그 모듈 `schemas.py` 또는 `service.py`에 정의한 dataclass·Pydantic 모델이다.

```python
# app/modules/auth/service.py  (01a)
def get_profile(db, user_id: UUID) -> ProfileInfo
    # ProfileInfo(birth_year: int | None, age: int | None, age_band: AgeBand | None, nickname: str | None)
def compute_age_band(birth_year: int, today: date) -> AgeBand

# app/modules/allocation/service.py  (02, 14)
def get_latest_risk_profile(db, user_id) -> RiskProfileInfo | None
def get_target_allocation(db, user_id) -> TargetAllocation        # PROFILE_INCOMPLETE / RISK_PROFILE_REQUIRED
def get_allocation_report(db, user_id) -> AllocationReport        # 보유·실제 비중·권장 비중·점수·등급·리밸런싱
def get_investable_total(db, user_id) -> int                      # 배분 대상 자산 합계(원)
def upsert_synced_holdings(db, user_id, *, source: str, connection_id: UUID, items: list[SyncedHolding]) -> HoldingSyncResult   # 14가 추가

# app/modules/ledger/service.py  (03, 10)
def get_monthly_summary(db, user_id, month: date) -> MonthlySummary   # month는 그 달 1일
def import_entries(db, user_id, rows: list[LedgerImportRow], *, source: str, batch_id: UUID | None = None) -> ImportResult   # 10이 추가, 17이 사용

# app/modules/imports/registry.py  (04)
def register_import_kind(kind: ImportKind) -> None
def get_import_kind(key: str) -> ImportKind
def list_import_kinds() -> list[ImportKind]
# app/modules/imports/service.py  (04)
def create_job_from_table(db, user_id, *, kind_key: str, file_name: str, header: list[str], rows: list[list[str]]) -> ImportJobView   # 10의 PDF 추출이 사용

# app/modules/journal/service.py  (05, 11)
def get_positions(db, user_id, *, include_closed: bool = False, with_quotes: bool = False) -> list[Position]   # with_quotes는 11이 추가
def get_trade_stats(db, user_id, start: date | None = None, end: date | None = None) -> TradeStats
def import_trades(db, user_id, rows: list[TradeImportRow], *, source: str, batch_id: UUID | None = None) -> ImportResult   # 11이 추가

# app/modules/estate/service.py  (06)
def calc_gift_tax(req: GiftTaxInput) -> GiftTaxResult                  # 순수 함수
def calc_inheritance_tax(req: InheritanceTaxInput) -> InheritanceTaxResult   # 순수 함수
def get_deduction_status(db, user_id, member_id: UUID, as_of: date) -> DeductionStatus
def simulate_gift_plan(req: GiftPlanInput) -> GiftPlanResult           # 순수 함수
def list_members(db, user_id) -> list[MemberInfo]

# app/modules/learn/service.py  (07)
def search_posts(db, query: str, *, kind: str | None = None, limit: int = 5) -> list[PostSummary]
def get_term_of_the_day(db, day: date) -> PostSummary | None
def get_progress(db, user_id) -> LearnProgress

# app/modules/market/service.py  (08)
def get_market_data_client() -> BrokerClient                     # MARKET_DATA_PROVIDER 기준 운영자 클라이언트
def get_user_broker_client(db, user_id, connection_id: UUID) -> BrokerClient   # BROKER_NOT_CONNECTED
def search_stocks(db, query: str, *, limit: int = 20) -> list[StockSummary]
def get_stock_detail(db, code: str) -> StockDetail | None
def get_quotes(codes: list[str]) -> list[Quote]                   # 30초 메모리 캐시
def list_snapshot_rows(db, as_of: date | None = None) -> SnapshotSet   # 최신(또는 지정일) 전 종목 스냅샷

# app/modules/watchlist/service.py  (12)
def list_items(db, user_id, *, group: str | None = None) -> list[WatchlistItemView]
def add_item(db, user_id, code: str, *, group_name: str = "기본", memo: str | None = None) -> WatchlistItemView   # CONFLICT / NOT_FOUND

# app/modules/screener/service.py  (13)
def parse_query(llm: StructuredLLM, query: str) -> ParsedScreen
def run_screen(db, screen_filter: ScreenFilter) -> ScreenResult
def get_filter_guide() -> str                 # 15의 screen_stocks 도구 설명에 사용
def encode_filter(screen_filter: ScreenFilter) -> str   # /stocks/screener?f= 값

# app/modules/chat/tools/registry.py  (09)
def register_tool(spec: ToolSpec) -> None
def get_registered_tools() -> list[ToolSpec]
```

## 9. 외부 연동

### 9.1 LLM 공통 래퍼 (01a, `app/integrations/llm/`)

모든 구조화 출력 호출(04 컬럼 매핑, 10 분류·추출, 13 자연어 해석, 07 초안)은 이 래퍼를 쓴다. 챗봇(09)은 같은 클라이언트 팩토리와 설정을 쓰되 스트리밍 루프를 직접 구현한다.

```python
# app/integrations/llm/types.py
Effort = Literal["low", "medium", "high", "xhigh", "max"]
FALLBACK_BETA = "server-side-fallback-2026-07-01"

# app/integrations/llm/structured.py
class StructuredLLM(Protocol):
    def generate(self, *, task: str, system: str, content: str | list[dict],
                 output: type[T], effort: Effort = "low", max_tokens: int = 8000) -> T: ...

# app/integrations/llm/anthropic_client.py
@lru_cache
def get_anthropic_client() -> anthropic.Anthropic   # anthropic.Anthropic(timeout=60.0, max_retries=2)

# app/integrations/llm/deps.py
def get_structured_llm() -> StructuredLLM           # FastAPI 의존성. LLM_MODE=anthropic → AnthropicStructuredLLM, 그 외 → DisabledLLM
```

`AnthropicStructuredLLM.generate`의 호출 형태는 아래로 고정한다(claude-api 스킬 문서 기준, `anthropic` Python SDK 1.x).

```python
kwargs = dict(
    model=settings.anthropic_model,            # "claude-opus-5-5"
    max_tokens=max_tokens,
    system=system,
    messages=[{"role": "user", "content": content}],
    output_config={
        "effort": effort,                      # Opus 5.5 기본값이 medium이므로 항상 명시
        "format": {"type": "json_schema", "schema": strict_json_schema(output)},
    },
)
if settings.llm_fallbacks_enabled:
    response = client.beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **kwargs)
else:
    response = client.messages.create(**kwargs)

if response.stop_reason == "refusal":
    raise AppError(422, "LLM_REFUSED", "AI가 이 요청을 처리하지 않았습니다. 다른 표현으로 다시 시도해 주세요.")
if response.stop_reason == "max_tokens":
    raise AppError(503, "LLM_UNAVAILABLE", "AI 응답이 너무 길어 중단됐습니다. 잠시 후 다시 시도해 주세요.")
text = next(b.text for b in response.content if b.type == "text")
return output.model_validate_json(text)
```

- `thinking` 파라미터는 보내지 않는다. Opus 5.5는 적응형 사고가 항상 켜져 있고 `{"type": "disabled"}`는 400이다.
- 강제 도구 호출(`tool_choice: any/tool`)은 Opus 5.5에서 400이다. 구조화 결과가 필요하면 위의 `output_config.format`을 쓴다.
- `strict_json_schema(model)`은 Pydantic `model_json_schema()`를 바탕으로 `$defs`를 펼치고, 모든 객체에 `additionalProperties: false`를 넣고, 모든 속성을 `required`에 넣는다(선택 값은 `X | None`으로 선언). `title`·`default`·길이·범위 키워드는 지우고, 범위 검증은 응답을 받은 뒤 Pydantic이 한다.
- SDK 예외(`anthropic.APIConnectionError`, `anthropic.RateLimitError`, `anthropic.APIStatusError`)는 `LLM_UNAVAILABLE`(503)로 바꾼다. 원문 메시지와 `_request_id`는 서버 로그에만 남긴다.
- 프롬프트에 이메일·사용자 ID·계좌번호를 넣지 않는다.
- 테스트는 `FakeStructuredLLM`(`app/integrations/llm/fake.py`)으로 의존성을 바꾼다. `register(task, handler)`로 작업별 응답을 정하고 `calls`로 호출 내용을 검사한다. 실제 API를 부르는 테스트는 만들지 않는다.

### 9.2 증권사 어댑터 (08, `app/integrations/brokers/`)

```python
class BrokerClient(Protocol):
    provider: Literal["mock", "kiwoom", "toss"]
    capabilities: frozenset[Capability]   # STOCK_LIST, FUNDAMENTALS, QUOTES, CANDLES, HOLDINGS, EXECUTIONS, CONDITIONS
    def list_stocks(self, market: Market) -> list[StockInfo]
    def get_fundamentals(self, code: str) -> Fundamentals
    def get_quotes(self, codes: list[str]) -> list[Quote]
    def get_daily_candles(self, code: str, start: date, end: date) -> list[Candle]
    def get_holdings(self) -> HoldingsSnapshot            # 계좌 범위. 사용자 연결 클라이언트만
    def get_executions(self, start: date, end: date) -> list[Execution]
    def list_conditions(self) -> list[ConditionInfo]      # 키움만
    def run_condition(self, seq: str) -> list[str]        # 종목코드 목록, 키움만
```

- 지원하지 않는 메서드는 `BrokerError("BROKER_NOT_SUPPORTED")`를 던진다. 주문 관련 메서드는 정의하지 않는다.
- `MockBroker`는 저장소에 들어 있는 고정 데이터(`fixtures/`)로 결정적으로 동작한다. Mock에서 나온 값에는 `source="mock"`을 달고 화면은 "샘플 데이터" 배지를 붙인다.
- 키움: 운영 `https://api.kiwoom.com`, 모의 `https://mockapi.kiwoom.com`(KRX만), 웹소켓 `wss://api.kiwoom.com:10000/api/dostk/websocket`. 값은 부호 붙은 문자열이고 업무 오류도 HTTP 200 + `return_code`로 온다. 조건검색은 HTS에서 만든 조건식만 실행할 수 있다.
- 토스: `https://openapi.tossinvest.com`, OAuth2 client credentials(토큰 24시간, 캐시), 계좌 계열은 `X-Tossinvest-Account` 헤더, 그룹별 초당 한도와 `429 Retry-After`. 모의투자 환경이 없으므로 조회 API만 쓴다.
- 두 증권사 모두 **허용 IP 등록이 필수**다. IP 거부는 `BROKER_IP_NOT_ALLOWED`로 바꿔 화면에 "증권사 포털에 서버 IP를 등록하세요"라고 안내한다.
- 정확한 api-id·경로·필드는 공식 문서와 키움 공식 저장소 스펙에서 확인하고, 어댑터 코드 주석에 출처를 남긴다. 확인하지 못한 기능은 `BROKER_NOT_SUPPORTED`로 둔다. 추측으로 엔드포인트를 만들지 않는다.

### 9.3 데이터 수집 커넥터 (17)

- 마이데이터는 본인신용정보관리업 허가 사업자만 쓸 수 있으므로 `MyDataConnector`는 항상 `CONNECTOR_NOT_SUPPORTED`를 돌려주는 스텁이다.
- CODEF는 데모(일 100회)·샌드박스 키로 카드 승인내역과 계좌 잔액을 가져온다. 결과는 원장 서비스 `ledger.import_entries`와 배분 서비스 `allocation.upsert_synced_holdings`로 넘긴다.

## 10. 보안 설계

- 비밀번호는 argon2id, 세션 토큰은 `secrets.token_urlsafe(32)`를 쿠키에 담고 DB에는 SHA-256 해시만 둔다(gamja-market 이식).
- CORS는 `FRONTEND_ORIGIN` 하나만 허용하고 `allow_credentials=True`다.
- 증권사·CODEF 자격증명은 `app/core/crypto.py`의 Fernet `encrypt_str`/`decrypt_str`로 암호화해 저장한다. API 응답에는 마스킹 값(끝 4자리)만 보낸다.
- `app/core/logging.py`의 필터가 `app_key`, `app_secret`, `secret`, `token`, `password`, `account_no` 같은 키의 값을 로그에서 가린다.
- 업로드 파일은 디스크에 저장하지 않는다. 메모리에서 파싱하고 파싱 결과만 `import_jobs`에 24시간 보관하며, 커밋하면 지운다.
- 모든 조회·수정 쿼리는 `user_id`로 거른다. 각 모듈 테스트에 "다른 사용자 자원 접근 시 404" 사례를 넣는다.
- 관리자 경로는 `AdminUser` 의존성(`users.role == "admin"`)으로 막는다. 첫 관리자는 `uv run python -m app.modules.auth.cli make-admin <email>`로 만든다.
- 투자 권유·세무 고지는 13절 문구를 쓴다.

## 11. AI 챗봇 에이전트 (09, 15)

- **루프**: 백엔드가 수동 에이전트 루프를 돈다. `get_anthropic_client()`로 `client.beta.messages.stream(...)`(폴백 켜짐) 또는 `client.messages.stream(...)`을 열고, 텍스트 조각을 SSE로 흘리고, `stream.get_final_message()`로 턴을 마무리한다. `stop_reason`이 `tool_use`면 도구를 실행해 같은 사용자 메시지 하나에 모든 `tool_result`를 담아 다시 부른다. 한 요청에서 도구 왕복은 최대 8회다.
- **도구**: 레지스트리에 등록된 도구만 쓴다. 입력 스키마는 Pydantic 모델에서 만든 strict 스키마(`strict: true`, `additionalProperties: false`)이고 `eager_input_streaming: true`를 켠다. 그래서 입력을 실행 전에 Pydantic으로 다시 검증하고, 실패하면 `is_error: true` 결과를 돌려준다. `stop_reason`이 `max_tokens`나 `refusal`이면 도구를 실행하지 않는다.
- **기록**: 어시스턴트 응답은 API가 준 content 블록 그대로(`block.model_dump()`) 저장하고 다음 요청에 그대로 다시 보낸다. 이전 턴은 절대 고치지 않는다(append-only). Opus 5.5는 thinking 블록이 대화에 묶여 있어 기록을 고치면 400이 날 수 있다.
- **캐싱**: 도구 목록(이름순 고정) → 시스템 프롬프트(고정 문자열) 순서로 두고 시스템 블록에 `cache_control: {"type": "ephemeral"}`을 단다. 날짜·사용자 정보 같은 가변 값은 시스템 프롬프트에 넣지 않고 도구로 가져온다.
- **SSE 이벤트**: `message_start`, `text_delta`, `tool_start`, `tool_end`, `message_end`, `error`. 15초마다 `: ping` 주석을 보낸다. 세부 형식은 스펙 09.
- **카드**: 도구 결과는 모델용 텍스트와 화면용 카드(`{"type": "...", ...}`)를 따로 만든다. 프론트는 카드 타입별 컴포넌트 레지스트리로 그린다.
- **안전**: 시스템 프롬프트에 정보 제공 목적, 개별 종목 매수·매도 권유 금지, 주문 불가, 숫자는 도구 결과만 인용, 세금은 참고용이라는 규칙을 넣는다.
- **비용**: 기본 effort는 `medium`(설정으로 변경), 사용자별 하루 메시지 상한 `CHAT_DAILY_MESSAGE_LIMIT`.

## 12. 프론트엔드 구조

- 데이터가 필요한 화면은 Client Component이고 `features/<module>/hooks.ts`의 TanStack Query 훅을 쓴다. 인증 쿠키가 API origin에 있으므로 서버 컴포넌트에서 API를 부르지 않는다.
- 라우트 그룹: `(auth)`는 셸 없는 로그인·가입, `(app)`은 앱 셸 + `RequireAuth` + `OnboardingGate`(출생연도 없으면 `/onboarding`) + 챗봇 위젯.
- 공용 컴포넌트(01b): shadcn/ui 기본 컴포넌트(`components/ui`), 앱 셸(`components/layout`), 차트 래퍼 `DonutChart`·`BarChart`·`LineChart`(`components/charts`), `PageHeader`·`EmptyState`·`ErrorState`·`LoadingState`·`MoneyText`·`SampleDataBadge`·`Disclaimer`·`ConfirmDialog`(`components/common`).
- 형식 함수(`lib/format.ts`): `formatKRW`(1,234,000원), `formatKRWCompact`(123.4만원, 1.2억원), `formatSignedKRW`, `formatPercent`, `formatDate`, `formatDateTime`(KST).
- 폼은 react-hook-form + zod, 알림은 shadcn `sonner`.
- 모바일 360px에서 가로 스크롤이 없어야 한다.
- Next.js 16은 학습 데이터와 다른 부분이 있다. 코드를 쓰기 전에 `frontend/node_modules/next/dist/docs/`의 해당 가이드를 읽는다.

### 12.1 내비게이션

| 메뉴 | 경로 | 작업 |
| --- | --- | --- |
| 홈 | `/` | 16 |
| 자산배분 | `/allocation` | 02 |
| 가계부 | `/ledger` | 03 |
| 매매일지 | `/journal` | 05 |
| 관심종목 | `/stocks/watchlist` | 12 |
| 조건검색 | `/stocks/screener` | 13 |
| 상속·증여 | `/estate` | 06 |
| 배우기 | `/learn` | 07 |
| AI 상담 | `/chat` | 09 |
| 설정 | `/settings/profile`, `/settings/connections` | 01b, 08 |
| 관리자(관리자만) | `/admin/learn` | 07 |

## 13. 고지 문구

`components/common/Disclaimer.tsx`(01b)의 `variant`로 쓴다. 백엔드 응답에는 고지 문구를 넣지 않는다.

| variant | 문구 |
| --- | --- |
| `investment` | 이 서비스의 자산배분·종목 정보는 일반적인 정보 제공과 학습을 위한 것이며 투자 권유가 아닙니다. 투자 결정과 그 결과의 책임은 본인에게 있습니다. |
| `tax` | 세금 계산 결과는 입력값과 2026년 10월 기준 세법을 단순화해 추정한 참고용입니다. 실제 신고 전에는 세무 전문가와 상담하세요. |
| `sample` | 샘플 데이터입니다. 실제 시세가 아닙니다. |
| `ai` | AI 답변은 틀릴 수 있습니다. 중요한 결정 전에는 원문 자료를 확인하세요. |

## 14. 테스트 전략

- 백엔드: pytest + FastAPI `TestClient`. 워크트리 DB에 테스트별 트랜잭션을 열고 롤백한다(gamja-market `tests/conftest.py` 이식). 01a가 `client`, `auth_client`(가입·로그인된 사용자), `other_auth_client`(두 번째 사용자), `admin_client`, `fake_llm` 픽스처를 제공한다.
- 외부 호출은 테스트에서 금지다. LLM은 `FakeStructuredLLM`, 증권사는 `MockBroker` 또는 `respx`로 고정한 HTTP 응답, CODEF도 `respx`를 쓴다.
- 프론트: Vitest + Testing Library + jsdom, API는 MSW(`msw/node`)로 가짜 응답을 만든다. 01b가 `tests/setup.ts`에 MSW 서버와 렌더 도우미(`renderWithProviders`)를 둔다.
- 각 스펙의 "완료 기준"과 "검증 체크리스트"가 검증 워커(codex `gpt-6.1-sol`, `xhigh`)의 판정 기준이다.
