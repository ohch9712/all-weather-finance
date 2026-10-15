# 01. 기반: 백엔드·프론트 골격, 인증·프로필, 공통 모듈, 개발 인프라

> 웨이브 1. 두 작업이 이 문서 하나를 계약으로 삼아 **서로 대화 없이 병렬로** 구현한다.
>
> | 작업 | 브랜치 | 구현 | 검증 |
> | --- | --- | --- | --- |
> | 01a 백엔드·인프라 | `feature/01-foundation-backend` | codex | codex `gpt-6.1-sol` / `xhigh` |
> | 01b 프론트 | `feature/01-foundation-frontend` | claude | codex `gpt-6.1-sol` / `xhigh` |
>
> 공통 규칙은 `AGENTS.md`, 이름·경로·에러 코드 기준은 `docs/architecture.md`다.

## 1. 목표

- 백엔드(FastAPI + uv)와 프론트(Next.js) 프로젝트를 만들고, 모든 모듈이 들어갈 자리를 미리 만든다. 이후 웨이브 워커는 공유 파일을 고치지 않고 자기 자리만 채운다.
- 이메일·비밀번호 가입, 로그인, 로그아웃(서버 세션 무효화), 현재 사용자 조회, 프로필(출생연도·닉네임)을 제공한다. gamja-market 구현을 이식한다.
- 모든 LLM 구조화 호출이 쓸 공통 래퍼, 암호화·시간·로그 마스킹 유틸, 공통 에러 형식을 만든다.
- 워크트리마다 포트·DB가 분리되는 개발 인프라(`compose.yaml`, `scripts/worktree-setup.sh`, `start.sh`, `stop.sh`, `orca.yaml`)를 만든다.
- 프론트에 앱 셸, 내비게이션, 디자인 시스템(shadcn/ui, 색 토큰, 차트 래퍼), 형식 함수, API 클라이언트, 인증·온보딩·프로필 화면, 모든 모듈의 자리표시 페이지를 만든다.

## 2. 범위

### 포함

| 01a 백엔드·인프라 | 01b 프론트 |
| --- | --- |
| uv 프로젝트, 전체 의존성 설치 | `create-next-app` 프로젝트, 전체 의존성 설치 |
| `core/`, `db/`, `api/` 공통 계층 | shadcn/ui 초기화와 기본 컴포넌트 |
| `users`, `sessions`, `user_profiles` + `foundation_0001` | 색·자산군 토큰, 차트 래퍼, 공용 컴포넌트 |
| 인증 4개 API + 프로필 2개 API + 헬스체크 | `lib/`(api-client, format, navigation, domain, query) |
| 관리자 의존성과 `make-admin` CLI | AuthProvider, RequireAuth, OnboardingGate |
| LLM 공통 래퍼(`integrations/llm`) | 로그인·가입·온보딩·프로필 설정 화면 |
| 12개 모듈 스텁과 라우터 등록 | 앱 셸(사이드바·모바일 메뉴·사용자 메뉴) |
| 테스트 픽스처(`client`, `auth_client`, `other_auth_client`, `admin_client`, `fake_llm`) | 모든 모듈 경로의 자리표시 페이지(11.6절), 챗봇 위젯 스텁 |
| `compose.yaml`, `scripts/*`, `orca.yaml`, 루트 `.gitignore` | Vitest + Testing Library + MSW 설정과 렌더 도우미 |

### 제외

| 항목 | 처리 |
| --- | --- |
| 모듈 기능(자산배분, 가계부 등) | 02 이후 |
| 비밀번호 재설정·변경, 회원 탈퇴, 소셜 로그인, 이메일 인증 | 범위 밖 |
| 로그인 시도 제한 | 범위 밖(18에서 재검토) |
| Next.js 서버 측 인증 검사(proxy/middleware) | 범위 밖. 클라이언트 게이트만 |
| 배포 설정 | 18 |

## 3. 소유 파일

### 01a

- 루트: `compose.yaml`, `orca.yaml`, `.gitignore`, `scripts/**`
- `backend/pyproject.toml`, `backend/uv.lock`, `backend/.python-version`, `backend/.env.example`, `backend/.gitignore`, `backend/alembic.ini`
- `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/foundation_0001_*.py`
- `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/core/**`, `backend/app/db/**`, `backend/app/api/**`
- `backend/app/integrations/__init__.py`, `backend/app/integrations/llm/**`
- `backend/app/modules/__init__.py`, `backend/app/modules/auth/**`, 12개 모듈 스텁 `backend/app/modules/<module>/{__init__.py,router.py,models.py}`
- `backend/logs/.gitkeep`, `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/foundation/**`
- `docs/specs/01-foundation.md`의 `## 구현 결과`(01a 부분)

### 01b

- `frontend/package.json`, `frontend/package-lock.json`, `frontend/.env.example`, `frontend/.gitignore`, `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`, `frontend/components.json`, `frontend/vitest.config.mts`, `frontend/public/**`, `frontend/logs/.gitkeep`
- `frontend/AGENTS.md`, `frontend/CLAUDE.md`(`next dev`가 만드는 Next.js 에이전트 규칙. 그대로 커밋한다)
- `frontend/src/app/layout.tsx`, `frontend/src/app/providers.tsx`, `frontend/src/app/globals.css`, `frontend/src/app/not-found.tsx`, `frontend/src/app/(auth)/**`
- `frontend/src/app/(app)/layout.tsx`, `frontend/src/app/(app)/page.tsx`, `frontend/src/app/(app)/onboarding/**`, `frontend/src/app/(app)/settings/profile/**`, 11.6절의 자리표시 페이지 전부
- `frontend/src/components/**`, `frontend/src/features/auth/**`, `frontend/src/features/chat/components/ChatWidget.tsx`(스텁), `frontend/src/lib/**`, `frontend/src/types/**`
- `frontend/tests/setup.ts`, `frontend/tests/utils.tsx`, `frontend/tests/foundation/**`
- `docs/specs/01-foundation.md`의 `## 구현 결과`(01b 부분)

> 두 작업은 서로의 디렉터리를 건드리지 않는다. 01b의 워크트리에는 01a가 만드는 루트 스크립트가 아직 없으므로, 01b는 `frontend/`에서 직접 `npm install`과 `.env.local`을 준비한다(`NEXT_PUBLIC_API_BASE_URL=http://localhost:8001`).

## 4. 기술 결정

| 항목 | 결정 | 근거·비고 |
| --- | --- | --- |
| Python | `requires-python = ">=3.12"`, `.python-version`은 `3.13` | uv가 버전을 관리한다 |
| ORM | SQLAlchemy 2.0 동기 엔진 + `psycopg[binary]` 3 | gamja-market과 같다. FastAPI가 동기 엔드포인트를 스레드풀에서 돌린다 |
| 비밀번호 | argon2id(`argon2-cffi` 기본 파라미터) | gamja-market 이식 |
| 세션 | 서버 세션 테이블 + HttpOnly 쿠키 `finance_session`, 7일 고정 만료, DB에는 토큰 SHA-256만 저장 | 로그아웃 즉시 무효화 |
| 가입 후 상태 | 가입 성공 시 바로 로그인(세션 쿠키 발급) | 가입 → 온보딩으로 바로 이어진다 |
| 이메일 정규화 | 앞뒤 공백 제거 후 전체 소문자 | 정규화 값만 저장 |
| JSON 표기 | camelCase(`CamelModel`) | architecture 4절 |
| 암호화 | Fernet(`cryptography`), 키 `APP_ENCRYPTION_KEY` | 08·17이 자격증명 저장에 사용 |
| LLM | `anthropic` 1.x, `claude-opus-5-5`, 구조화 출력 + 서버 측 폴백 | architecture 9.1 |
| 백엔드 린트 | ruff | |
| 프론트 | `create-next-app` 최신 안정 버전(Next.js 16, React 19, Tailwind 4, ESLint, App Router, `src/`, alias `@/*`), npm | |
| UI | shadcn/ui(CLI 초기화) + lucide-react + sonner | |
| 데이터 패칭 | TanStack Query v5, 쿼리 키는 `[module, ...]` 배열 | |
| 폼 | react-hook-form + zod + `@hookform/resolvers` | |
| 차트 | Recharts, 래퍼 3종 | |
| 프론트 테스트 | Vitest + Testing Library + jsdom + MSW 2(`msw/node`) | gamja-market은 `vi.stubGlobal` fetch였다. 모듈이 많아 MSW로 통일한다 |

### 4.1 설치할 의존성 (이후 작업은 추가하지 않는다)

백엔드 `dependencies`: `fastapi`, `uvicorn[standard]`, `sqlalchemy>=2.0,<2.1`, `psycopg[binary]`, `alembic`, `pydantic[email]`, `pydantic-settings`, `argon2-cffi`, `python-multipart`, `anthropic>=1,<2`, `httpx`, `websockets`, `cryptography`, `pandas`, `openpyxl`, `xlrd`, `lxml`, `charset-normalizer`

백엔드 `dev` 그룹: `pytest`, `respx`, `freezegun`, `ruff`

프론트 `dependencies`: `next`, `react`, `react-dom`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `recharts`, `react-markdown`, `remark-gfm`, `lucide-react`, `sonner`, 그리고 shadcn CLI가 추가하는 패키지(`class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `cmdk`, Radix 패키지 등)

프론트 `devDependencies`: `typescript`, `@types/*`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `msw`

shadcn 컴포넌트: `accordion`, `alert`, `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`, `command`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `tooltip`

## 5. 백엔드 구조 (01a)

```
backend/app/
  main.py                 # create_app(): CORS, 에러 핸들러, 로깅, api.router
  core/
    config.py             # Settings(architecture 2.3의 전 변수), get_settings()
    errors.py             # AppError, 핸들러 4종(gamja-market 이식 + 메시지 일반화)
    schemas.py            # CamelModel, ErrorDetail/ErrorBody/ErrorResponse, Page[T], PageParams
    security.py           # hash_password, verify_password, new_session_token, hash_token
    cookies.py            # set_session_cookie, clear_session_cookie
    cors.py               # JsonCORSMiddleware(gamja-market 이식)
    crypto.py             # encrypt_str, decrypt_str, mask_tail
    time.py               # KST, now_utc(), today_kst()
    logging.py            # configure_logging(), SecretMaskingFilter
    domain.py             # AssetClass, RiskProfile, AgeBand(StrEnum)와 한국어 표시명, AGE_BAND_REPRESENTATIVE_AGE
  db/
    base.py               # Base(DeclarativeBase), 제약 이름 규칙(naming_convention)
    session.py            # engine, SessionLocal(gamja-market 이식)
    models.py             # 모든 모듈의 models 모듈 import(메타데이터 수집용)
  api/
    router.py             # APIRouter(prefix="/api"): health, auth, profile, 12개 모듈 라우터
    deps.py               # get_db, DBSession, CurrentUser, AdminUser, require_json, PageQuery
    health.py
  integrations/llm/       # 8절
  modules/
    auth/                 # router.py(auth_router, profile_router), schemas, service, repository, models, cli
    allocation/ ledger/ imports/ journal/ estate/ learn/ market/ chat/ watchlist/ screener/ dashboard/ connectors/   # 스텁
```

### 5.1 모듈 스텁

12개 모듈(`allocation`, `ledger`, `imports`, `journal`, `estate`, `learn`, `market`, `chat`, `watchlist`, `screener`, `dashboard`, `connectors`) 각각에 아래 세 파일을 만든다.

```python
# app/modules/<module>/router.py
from fastapi import APIRouter

router = APIRouter(prefix="/<module>", tags=["<module>"])
```

```python
# app/modules/<module>/models.py
"""<모듈> ORM 모델. 작업 NN에서 채운다."""

from app.db.base import Base  # noqa: F401
```

`__init__.py`는 비워 둔다. `app/db/models.py`는 13개 모듈(`auth` 포함)의 `models`를 모두 import하고, `app/api/router.py`는 13개 라우터를 모두 `include_router`한다. 이후 작업은 이 두 파일을 고치지 않는다.

### 5.2 공통 의존성 (`app/api/deps.py`)

| 이름 | 동작 |
| --- | --- |
| `DBSession` | 요청마다 `SessionLocal()` 세션 |
| `CurrentUser` | 쿠키 → 세션 조회 → `User`. 없거나 만료면 `401 UNAUTHENTICATED`(만료 행은 삭제) |
| `AdminUser` | `CurrentUser` + `role == "admin"`, 아니면 `403 FORBIDDEN` |
| `require_json` | `Content-Type`이 `application/json`이 아니면 `422 VALIDATION_ERROR`(`field: "body"`) |
| `PageQuery` | `page`(기본 1, 1 이상), `pageSize`(기본 20, 1~100) 쿼리 파라미터 |

### 5.3 에러 메시지 일반화

gamja-market의 `validation_error_handler`는 이메일·비밀번호 전용 문구를 썼다. 이 프로젝트는 아래처럼 일반화한다.

- `details[].field`: pydantic `loc`의 마지막 요소를 camelCase로(`birth_year` → `birthYear`). 본문 전체가 JSON이 아니면 `body`.
- `details[].message`: `missing` → "필수 항목입니다.", 문자열 길이 오류 → "길이를 확인해 주세요.", 숫자 범위 오류 → "허용 범위를 벗어났습니다.", 타입·형식 오류 → "형식이 올바르지 않습니다.", `value_error` → 검증기가 던진 한국어 메시지 그대로(`Value error, ` 접두어 제거).
- 최상위 `message`는 항상 "입력값을 확인해 주세요."

## 6. DB 스키마 (01a, revision `foundation_0001`, `branch_labels=("foundation",)`)

### 6.1 `users`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `email` | `varchar(254)` | NOT NULL, UNIQUE. 정규화 값 |
| `password_hash` | `text` | NOT NULL |
| `role` | `varchar(16)` | NOT NULL, default `'user'`, CHECK `role in ('user','admin')` |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL, default `now()` |

### 6.2 `sessions`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK `users.id` ON DELETE CASCADE, 인덱스 |
| `token_hash` | `varchar(64)` | NOT NULL, UNIQUE |
| `expires_at` | `timestamptz` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL, default `now()` |

### 6.3 `user_profiles`

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| `user_id` | `uuid` | PK, FK `users.id` ON DELETE CASCADE |
| `birth_year` | `smallint` | NULL 허용, CHECK `birth_year between 1900 and 2100` |
| `nickname` | `varchar(20)` | NULL 허용 |
| `created_at`, `updated_at` | `timestamptz` | NOT NULL, default `now()` |

가입할 때 빈 프로필 행을 함께 만든다.

## 7. API 계약 (01a 구현, 01b 사용)

Base URL(dev)은 `http://localhost:<백엔드 포트>`. 응답 예시는 필드 이름과 형식의 계약이다.

### 7.1 공통 응답 객체

```json
// AuthPayload
{
  "user": { "id": "0f8c...", "email": "potato@example.com", "role": "user", "createdAt": "2026-10-16T03:21:45Z" },
  "profile": { "birthYear": 1994, "nickname": "감자", "age": 32, "ageBand": "30s" }
}
```

- `profile`의 네 필드는 항상 있다. 출생연도가 없으면 `birthYear`, `age`, `ageBand`가 `null`이다.
- `age` = 올해(KST) − `birthYear`. `ageBand`는 `age` 29 이하 `20s`, 30~39 `30s`, 40~49 `40s`, 50~59 `50s`, 60 이상 `60s`.

### 7.2 `GET /api/health`

- 인증 불필요. `200 {"status": "ok"}`

### 7.3 `POST /api/auth/signup`

- 요청: `{"email": "Potato@Example.com", "password": "gamja1234", "passwordConfirm": "gamja1234"}`
- 검증: `email`은 이메일 형식, `password` 8~128자, `passwordConfirm`은 `password`와 완전히 같은 문자열(다르면 `details: [{"field": "passwordConfirm", "message": "비밀번호가 일치하지 않습니다."}]`, `password`가 규칙을 어기면 불일치 검사는 하지 않는다).
- 성공 `201` + `Set-Cookie: finance_session=...` + 본문 `AuthPayload`
- 실패: `409 EMAIL_ALREADY_EXISTS`("이미 가입된 이메일입니다."), `422 VALIDATION_ERROR`

### 7.4 `POST /api/auth/login`

- 요청: `{"email": "...", "password": "..."}`
- 성공 `200` + 새 세션 쿠키 + `AuthPayload`. 요청에 유효한 세션 쿠키가 있었다면 그 세션은 삭제한다.
- 실패: `401 INVALID_CREDENTIALS`("이메일 또는 비밀번호가 올바르지 않습니다.", 이메일 없음과 비밀번호 불일치를 구분하지 않는다), `422`

### 7.5 `POST /api/auth/logout`

- 쿠키의 세션을 삭제하고 쿠키를 지운다. 세션이 없어도 `204`.

### 7.6 `GET /api/auth/me`

- 성공 `200 AuthPayload`, 실패 `401 UNAUTHENTICATED`

### 7.7 `GET /api/profile`, `PUT /api/profile`

- `GET` 성공 `200`: `{"birthYear": 1994, "nickname": "감자", "age": 32, "ageBand": "30s"}`
- `PUT` 요청: `{"birthYear": 1994, "nickname": "감자"}`
  - `birthYear` 필수, 정수, 1920 이상 (올해 − 10) 이하. 어기면 "출생연도를 확인해 주세요."
  - `nickname` 선택(`null` 허용). 앞뒤 공백 제거 후 1~20자. 빈 문자열은 `null`로 저장.
- `PUT` 성공 `200`(GET과 같은 형식). 둘 다 미인증이면 `401`.

### 7.8 관리자 CLI

```bash
uv run python -m app.modules.auth.cli make-admin potato@example.com
```

- 해당 사용자의 `role`을 `admin`으로 바꾸고 결과를 출력한다. 사용자가 없으면 종료 코드 1.

### 7.9 다른 모듈용 서비스 함수

```python
# app/modules/auth/service.py
@dataclass(frozen=True)
class ProfileInfo:
    birth_year: int | None
    age: int | None
    age_band: AgeBand | None
    nickname: str | None

def get_profile(db: Session, user_id: UUID) -> ProfileInfo
def compute_age_band(birth_year: int, today: date) -> AgeBand
```

## 8. LLM 공통 래퍼 (01a, `app/integrations/llm/`)

호출 형태와 규칙은 `docs/architecture.md` 9.1절이 기준이다. 아래 파일을 만든다.

| 파일 | 내용 |
| --- | --- |
| `types.py` | `Effort`, `FALLBACK_BETA = "server-side-fallback-2026-07-01"` |
| `schema.py` | `strict_json_schema(model: type[BaseModel]) -> dict` |
| `structured.py` | `StructuredLLM` Protocol, `AnthropicStructuredLLM`, `DisabledLLM` |
| `anthropic_client.py` | `get_anthropic_client()`(lru_cache, `anthropic.Anthropic(timeout=60.0, max_retries=2)`) |
| `fake.py` | `FakeStructuredLLM`, `FakeRequest` |
| `deps.py` | `get_structured_llm()` FastAPI 의존성, `StructuredLLMDep` 타입 별칭 |

세부 동작

1. `AnthropicStructuredLLM(client=None, settings=None)`: 인자가 없으면 `get_anthropic_client()`와 `get_settings()`를 쓴다. 테스트는 가짜 클라이언트를 넣는다.
2. `generate(task=..., system=..., content=..., output=Model, effort="low", max_tokens=8000)`는 9.1절 코드와 같은 순서로 호출하고 검증한다. `task`는 로그용 이름이다(`"imports.column_mapping"` 같은 형식).
3. `DisabledLLM.generate`는 항상 `AppError(503, "LLM_UNAVAILABLE", "AI 기능을 쓰려면 서버에 Anthropic API 키를 설정해야 합니다.")`.
4. `get_structured_llm()`은 `LLM_MODE == "anthropic"`이고 `ANTHROPIC_API_KEY`가 있으면 `AnthropicStructuredLLM`, 아니면 `DisabledLLM`.
5. `FakeStructuredLLM.register(task, handler)`: `handler(req: FakeRequest) -> dict`. `generate`는 handler 결과를 `output.model_validate`해서 돌려준다. 등록되지 않은 task는 `AssertionError`. 호출 기록은 `calls: list[FakeRequest]`(`task`, `system`, `content`, `effort`, `output_name`).
6. `strict_json_schema`: `model_json_schema()`의 `$ref`를 `$defs`로 펼친다. 모든 `type: object`에 `additionalProperties: false`와 전체 속성 `required`를 넣는다. `title`, `default`, `examples`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `pattern`을 지운다. `Optional`은 `anyOf: [..., {"type": "null"}]`로 둔다.

## 9. 공통 유틸 (01a)

- `crypto.encrypt_str(plain) -> str`, `decrypt_str(token) -> str`: Fernet. 키가 비어 있거나 잘못되면 시작 시 명확한 에러로 실패한다(`APP_ENV=test`에서는 테스트용 고정 키 허용).
- `crypto.mask_tail(value, keep=4) -> str`: `"1234567890"` → `"******7890"`.
- `time.now_utc()`(aware datetime), `time.today_kst()`(date). 모든 모듈은 `datetime.now()`를 직접 쓰지 않는다.
- `logging.SecretMaskingFilter`: 로그 레코드의 메시지·인자에서 `app_key`, `appkey`, `app_secret`, `secretkey`, `secret`, `token`, `password`, `account_no`, `authorization` 키의 값을 `***`로 바꾼다.
- `domain.py`: architecture 6절 상수와 한국어 표시명, `AGE_BAND_REPRESENTATIVE_AGE = {"20s": 25, "30s": 35, "40s": 45, "50s": 55, "60s": 65}`.

## 10. 개발 인프라 (01a)

### 10.1 `compose.yaml`

- `name: finance`, 서비스 `postgres`(`postgres:17-alpine`), `POSTGRES_USER=finance`, `POSTGRES_PASSWORD=finance_local_password`, `POSTGRES_DB=finance_00`, 포트 `127.0.0.1:${FINANCE_PG_PORT:-5433}:5432`, 볼륨 `finance_pg_data`, `pg_isready` 헬스체크(gamja-market 형식).

### 10.2 `scripts/worktree-setup.sh`

멱등이어야 한다. 순서:

1. 저장소 루트와 현재 브랜치를 구한다. 브랜치 이름이 정규식 `(^|/)feature[/-]([0-9]{2})-`에 맞으면 슬롯은 그 두 자리(`feature/02-allocation`, Orca가 처음 만드는 `ohch9712/feature-02-allocation` 모두 `02`), 아니면 `00`.
2. `BACKEND_PORT=8000+NN`, `FRONTEND_PORT=3000+NN`, `DB_NAME=finance_NN`.
3. `docker compose -f <루트>/compose.yaml up -d postgres` 후 헬스체크 통과까지 대기(최대 60초).
4. DB가 없으면 만든다(`docker compose exec -T postgres psql -U finance -d postgres ...`).
5. `backend/.env`가 없으면 `.env.example`을 복사한다. `DATABASE_URL`(DB 이름), `FRONTEND_ORIGIN`(프론트 포트)만 슬롯 값으로 바꾸고, `APP_ENCRYPTION_KEY`가 비어 있으면 새로 만든다. 사용자가 넣은 다른 값(API 키 등)은 보존한다.
6. `frontend/.env.local`의 `NEXT_PUBLIC_API_BASE_URL`을 백엔드 포트로 맞춘다.
7. `backend/pyproject.toml`이 있으면 `uv sync`, `frontend/package-lock.json`이 있고 `node_modules`가 없거나 lock 해시가 바뀌었으면 `npm ci`.
8. `backend/`가 있으면 `uv run alembic upgrade heads`.
9. 슬롯, 포트, DB, URL을 출력한다.

옵션: `--skip-install`, `--skip-migrate`, `-h`. `backend/`나 `frontend/`가 없으면 해당 단계를 건너뛴다.

### 10.3 `scripts/start.sh`, `scripts/stop.sh`

- gamja-market의 `scripts/lib/common.sh` 구조(락, 헬스체크 대기, 로그 회전, PID 파일)를 이식하되, **다른 워크트리의 서버를 종료하는 동작은 넣지 않는다.** 포트가 이미 쓰이면 점유 프로세스를 알려 주고 실패한다.
- `start.sh [all|backend|frontend]`: 슬롯 포트로 백그라운드 기동, 헬스체크(`/api/health`, 프론트 `/`) 통과까지 대기. 로그 `backend/logs/dev-server.log`, `frontend/logs/dev-server.log`. PID 파일은 `${TMPDIR:-/tmp}/finance/<slot>/`.
- `stop.sh [all|backend|frontend]`: 현재 워크트리의 PID 파일에 있는 프로세스만 종료한다.

### 10.4 `orca.yaml`

```yaml
scripts:
  setup: ./scripts/worktree-setup.sh
```

Orca가 새 워크트리를 만들 때 이 스크립트를 실행하게 한다. 키 이름은 설치된 Orca(`orca skills get orca-cli`, Orca 설정 화면)에서 확인한다. 인식되지 않으면 `## 구현 결과`에 적는다. 그 경우에도 워커가 첫 단계로 직접 실행하므로 동작에는 문제없다.

### 10.5 `.gitignore`(루트)

`.env`, `.env.local`, `node_modules/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `.next/`, `*.tsbuildinfo`, `logs/*.log*`, `coverage/`, `.DS_Store`

## 11. 프론트 구조 (01b)

```
frontend/src/
  app/
    layout.tsx              # <html lang="ko">, 폰트, Providers
    providers.tsx           # QueryClientProvider, AuthProvider, Toaster
    globals.css             # Tailwind 4, shadcn 토큰, --asset-* 색 토큰(라이트·다크)
    not-found.tsx
    (auth)/login/page.tsx, (auth)/signup/page.tsx, (auth)/layout.tsx
    (app)/layout.tsx        # RequireAuth → OnboardingGate → AppShell → children + <ChatWidget />
    (app)/page.tsx          # 홈 자리표시(16)
    (app)/onboarding/page.tsx
    (app)/settings/profile/page.tsx
    (app)/<11.6절 자리표시 경로>/page.tsx
  components/
    ui/                     # shadcn
    layout/AppShell.tsx, Sidebar.tsx, MobileNav.tsx, UserMenu.tsx
    charts/DonutChart.tsx, BarChart.tsx, LineChart.tsx, palette.ts
    common/PageHeader.tsx, EmptyState.tsx, ErrorState.tsx, LoadingState.tsx, MoneyText.tsx,
           SampleDataBadge.tsx, Disclaimer.tsx, ConfirmDialog.tsx, ComingSoon.tsx
  features/
    auth/api.ts, types.ts, AuthProvider.tsx, components/(LoginForm, SignupForm, RequireAuth, OnboardingGate, ProfileForm)
    chat/components/ChatWidget.tsx   # 스텁: null을 렌더링. 09가 내용을 채운다
  lib/
    api-client.ts           # gamja-market 이식(apiFetch, ApiError, 타임아웃 10초)
    format.ts, navigation.ts, domain.ts, query.ts, site.ts
  types/api.ts              # ErrorResponse, Page<T>
```

### 11.1 공용 컴포넌트 계약

| 컴포넌트 | props | 동작 |
| --- | --- | --- |
| `PageHeader` | `title`, `description?`, `actions?` | 페이지 제목 영역 |
| `EmptyState` | `title`, `description?`, `action?` | 빈 목록 |
| `ErrorState` | `error: unknown`, `onRetry?` | `ApiError.message`를 보여 준다 |
| `LoadingState` | `rows?` | Skeleton |
| `MoneyText` | `value: number`, `signed?`, `compact?` | `formatKRW`/`formatSignedKRW`/`formatKRWCompact`, 양수 빨강·음수 파랑(국내 관례)은 `signed`일 때만 |
| `SampleDataBadge` | 없음 | "샘플 데이터" 배지 + 툴팁(`sample` 문구) |
| `Disclaimer` | `variant: "investment" \| "tax" \| "sample" \| "ai"` | architecture 13절 문구 |
| `ConfirmDialog` | `title`, `description`, `confirmLabel`, `onConfirm`, `destructive?` | alert-dialog |
| `ComingSoon` | `title`, `taskId` | 자리표시 페이지 본문("준비 중입니다. 작업 NN에서 구현합니다.") |
| `DonutChart` | `data: {key, label, value, color}[]`, `centerLabel?`, `ariaLabel` | 비중 도넛. 범례 포함 |
| `BarChart` | `data`, `xKey`, `series: {key, label, color}[]`, `layout?: "vertical" \| "horizontal"`, `valueFormatter?`, `ariaLabel` | |
| `LineChart` | `data`, `xKey`, `series`, `valueFormatter?`, `ariaLabel` | |

- 차트 색은 `palette.ts`가 CSS 변수에서 읽는다. 자산군은 `--asset-stock`(파랑), `--asset-bond`(초록), `--asset-gold`(호박색), `--asset-cash`(회색), `--asset-other`(보라). 그 밖의 계열 색 4~6개도 토큰으로 둔다. 라이트·다크 모두 대비를 확인한다(dataviz 스킬의 방식).
- 차트에는 `ariaLabel`과 같은 데이터의 숨김 표(`sr-only`)를 함께 렌더링한다.

### 11.2 형식 함수 (`lib/format.ts`)

| 함수 | 예 |
| --- | --- |
| `formatKRW(1234000)` | `1,234,000원` |
| `formatSignedKRW(-5000)` | `-5,000원`, 양수는 `+5,000원` |
| `formatKRWCompact(123400000)` | `1.2억원`, `56,700,000` → `5,670만원`, 1만 미만은 `formatKRW` |
| `formatPercent(12.345, 1)` | `12.3%` |
| `formatDate("2026-10-16")` | `2026.10.16` |
| `formatDateTime("2026-10-16T03:21:45Z")` | `2026.10.16 12:21`(KST) |

### 11.3 `lib/domain.ts`

architecture 6절의 값과 한국어 표시명, 색 토큰 이름을 내보낸다: `ASSET_CLASSES`, `ASSET_CLASS_LABEL`, `ASSET_CLASS_COLOR_VAR`, `RISK_PROFILES`, `RISK_PROFILE_LABEL`, `AGE_BANDS`, `AGE_BAND_LABEL`.

### 11.4 인증 흐름

- `AuthProvider`: 마운트 시 `GET /api/auth/me`. 상태 `loading | authenticated | unauthenticated`, 값 `user`, `profile`, 함수 `refresh()`, `setAuth(payload)`, `logout()`. `useAuth()` 훅을 제공한다.
- `RequireAuth`: `unauthenticated`면 `/login?next=<현재 경로>`로 이동. `loading` 동안 전체 화면 Skeleton.
- `OnboardingGate`: 인증됐고 `profile.birthYear === null`이고 현재 경로가 `/onboarding`이 아니면 `/onboarding`으로 이동.
- 가입 성공 → `setAuth` → `/onboarding`. 로그인 성공 → `next`(같은 사이트 경로만 허용) 또는 `/`.
- 로그아웃 → `POST /api/auth/logout` → 쿼리 캐시 비움 → `/login`.

### 11.5 내비게이션 (`lib/navigation.ts`)

architecture 12.1절의 메뉴를 `NavItem { href, label, icon, group: "main" | "stocks" | "settings" | "admin", adminOnly? }` 배열로 둔다. 사이드바와 모바일 메뉴는 이 배열만 읽는다. 관리자 메뉴는 `user.role === "admin"`일 때만 보인다. 현재 경로 항목을 강조한다.

### 11.6 자리표시 페이지

아래 경로마다 `ComingSoon`을 렌더링하는 `page.tsx`를 만든다. 담당 작업 번호를 `taskId`로 넘긴다. 해당 작업이 이 파일을 교체한다.

| 경로 | 작업 | 경로 | 작업 |
| --- | --- | --- | --- |
| `/` | 16 | `/stocks/watchlist` | 12 |
| `/allocation` | 02 | `/stocks/[code]` | 12 |
| `/allocation/survey` | 02 | `/stocks/screener` | 13 |
| `/allocation/assets` | 02 | `/estate` | 06 |
| `/ledger` | 03 | `/learn` | 07 |
| `/ledger/import` | 10 | `/learn/glossary` | 07 |
| `/journal` | 05 | `/learn/[slug]` | 07 |
| `/journal/import` | 11 | `/admin/learn` | 07 |
| `/chat` | 09 | `/settings/connections` | 08 |

## 12. 화면 명세 (01b)

### 12.1 앱 셸

- 데스크톱(≥1024px): 왼쪽 고정 사이드바(서비스 이름 + 메뉴 그룹), 상단 바(페이지 제목 영역, 사용자 메뉴: 이메일, 프로필 설정, 로그아웃). 서비스 이름은 `lib/site.ts`의 `APP_NAME` 상수 하나로 관리하고 값은 저장소 이름과 같은 "금융 프로젝트"로 둔다. 이름이 정해지면 이 상수만 바꾼다.
- 모바일: 상단 바 + 햄버거 → `Sheet` 메뉴. 본문은 좌우 16px 여백.
- 본문 최대 폭 1200px. 오른쪽 아래에 `<ChatWidget />`(지금은 아무것도 렌더링하지 않음).

### 12.2 `/login`, `/signup`

- gamja-market 폼 구성을 따른다. 가입 폼: 이메일, 비밀번호, 비밀번호 확인. 클라이언트 검증은 7.3과 같은 규칙(zod).
- 서버 에러 `details`를 해당 필드 아래에 보여 주고, 필드 없는 에러는 폼 위 `Alert`로 보여 준다.
- 이미 로그인 상태로 접근하면 `/`로 보낸다.

### 12.3 `/onboarding`

- 안내: "나이대와 투자성향에 따라 권장 자산배분이 달라져요. 먼저 출생연도를 알려 주세요."
- 입력: 출생연도(`Select`, 올해−10부터 1920까지 내림차순), 닉네임(선택, 20자).
- 저장 `PUT /api/profile` → `refresh()` → `/allocation/survey?onboarding=1`로 이동(02가 설문 화면을 만든다).

### 12.4 `/settings/profile`

- 이메일(읽기 전용), 출생연도·닉네임 수정 폼(`PUT /api/profile`), 저장 토스트, "투자성향 다시 진단하기" 링크(`/allocation/survey`), 로그아웃 버튼.

### 12.5 404

- 안내 문구와 홈 링크.

## 13. 테스트

### 13.1 백엔드 (01a, `backend/tests/`)

- `conftest.py`: gamja-market의 트랜잭션 롤백 픽스처를 이식한다. 테스트 시작 시 트랜잭션 안에서 `users`를 비운다(다른 테이블은 CASCADE로 정리된다). 제공 픽스처: `db`, `app`, `client`, `auth_client`, `other_auth_client`, `admin_client`, `fake_llm`(`get_structured_llm` 의존성을 `FakeStructuredLLM`으로 교체하고 그 인스턴스를 돌려준다). `auth_client`는 출생연도 1994가 설정된 사용자다.
- `tests/foundation/`
  - 헬스체크
  - 가입: 성공·쿠키·정규화(대문자·공백)·중복 409·검증 422(이메일 형식, 비밀번호 길이, 확인 불일치)·빈 프로필 생성
  - 로그인: 성공, 실패 401 동일 응답, 기존 세션 교체
  - 로그아웃: 세션 행 삭제, 이후 `/me` 401, 쿠키 없이도 204
  - `/me`: 만료 세션은 401이고 행이 삭제된다(`freezegun`)
  - 프로필: GET 기본값, PUT 성공·범위 오류·닉네임 공백 처리, `ageBand` 경계값(29/30, 59/60)
  - 에러 형식: 없는 경로 404, 405, 처리되지 않은 예외 500(CORS 헤더 포함)
  - `AdminUser`: 일반 사용자 403, 관리자 200(테스트 안에서 임시 라우터를 붙여 확인), `make-admin` CLI
  - `crypto`: 왕복, 잘못된 토큰, `mask_tail`
  - `SecretMaskingFilter`
  - LLM 래퍼: 가짜 클라이언트로 `generate` 호출 인자(모델, `output_config.effort`, `output_config.format.schema`, 폴백 켜짐일 때 `betas`·`fallbacks`, 꺼짐일 때 `messages.create`), `refusal` → `LLM_REFUSED`, `max_tokens` → `LLM_UNAVAILABLE`, SDK 예외 → `LLM_UNAVAILABLE`, 응답 JSON 검증 실패 → `LLM_UNAVAILABLE`, `DisabledLLM`, `strict_json_schema`(중첩 모델, Optional, enum)
  - 라우터 등록: 13개 모듈 라우터가 `/api` 아래 붙어 있다(OpenAPI의 tags로 확인)

### 13.2 프론트 (01b, `frontend/tests/`)

- `setup.ts`: jest-dom, MSW 서버(`msw/node`) 시작·초기화·종료. `utils.tsx`: `renderWithProviders(ui, { route, auth })`(QueryClient, AuthProvider, 라우터 목).
- `tests/foundation/`
  - `api-client`(gamja-market 테스트 이식: 성공, 에러 정규화, 타임아웃, 네트워크 오류, 204)
  - `format.ts` 전 함수
  - 가입·로그인 폼 검증과 서버 에러 표시
  - AuthProvider 상태 전환, 로그아웃
  - RequireAuth 미인증 리다이렉트(`next` 포함), OnboardingGate 리다이렉트
  - 온보딩 저장 후 `/allocation/survey?onboarding=1` 이동
  - 내비게이션: 관리자 메뉴 표시 조건, 현재 경로 강조
  - 자리표시 페이지가 작업 번호를 보여 준다(대표 3개)
  - 차트 래퍼가 숨김 표를 렌더링한다

## 14. 완료 기준

### 01a

- [ ] `docker compose up -d postgres` 후 `scripts/worktree-setup.sh`가 슬롯 01로 `.env`, DB `finance_01`, 마이그레이션까지 끝낸다. 두 번 실행해도 결과가 같다.
- [ ] `scripts/start.sh backend`로 `http://localhost:8001/api/health`가 `200`이다. `scripts/stop.sh`로 그 프로세스만 종료된다.
- [ ] `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`가 통과한다.
- [ ] 빈 DB에서 `alembic upgrade heads` → `downgrade base` → `upgrade heads`가 성공한다.
- [ ] `/docs`(OpenAPI)에 auth·profile·health와 12개 모듈 태그가 보인다.
- [ ] `ANTHROPIC_API_KEY` 없이 모든 테스트가 통과하고, 실제 네트워크 호출이 없다.

### 01b

- [ ] `npm run dev -- --port 3001`로 모든 자리표시 경로와 로그인·가입·온보딩·프로필 화면이 렌더링된다(백엔드 없이도 화면이 깨지지 않고 오류 상태를 보여 준다).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`가 통과한다.
- [ ] 화면 컴포넌트가 `fetch`를 직접 쓰지 않는다(`features/*/api.ts`, `lib/api-client.ts`만 사용).
- [ ] 360px 폭에서 가로 스크롤이 없다. 다크 모드에서 텍스트·차트 대비가 유지된다.

## 15. 검증 체크리스트 (검증 워커용)

1. 각 검증은 자기 브랜치 범위만 판정한다. 01b는 백엔드 없이 MSW 테스트와 화면 렌더링으로, 01a는 API 요청으로 확인한다. 두 브랜치를 합친 실제 흐름(가입 → 온보딩 → 프로필 수정 → 로그아웃 → 재로그인, localhost 포트 사이 쿠키 전달)은 `docs/roadmap.md`의 웨이브 1 통합 검증에서 확인한다.
2. 7절의 모든 엔드포인트를 실제 요청으로 대조한다: 상태코드, 필드 이름(camelCase), `Set-Cookie` 속성(HttpOnly, SameSite=Lax, Path=/, Max-Age=604800), 에러 `code`.
3. DB에 비밀번호 원문이나 세션 토큰 원문이 없다.
4. 13개 모듈 라우터 등록, 12개 모듈 스텁, `db/models.py` import 목록이 architecture 3절과 일치한다.
5. `strict_json_schema` 결과에 `additionalProperties: false`와 전체 `required`가 들어 있고, `AnthropicStructuredLLM`이 architecture 9.1절의 인자 형태로 SDK를 부른다(테스트 코드로 확인).
6. `worktree-setup.sh`가 사용자가 넣은 `.env` 값을 보존하고, 다른 슬롯 DB를 건드리지 않는다. `stop.sh`가 다른 워크트리 프로세스를 종료하지 않는다.
7. 4.1절 의존성이 모두 설치돼 있다(`uv pip list`, `npm ls --depth=0`).
8. 11.6절 자리표시 경로가 모두 있고, 내비게이션이 architecture 12.1절과 일치한다.
9. 고지 컴포넌트 문구가 architecture 13절과 글자 단위로 같다.
10. 공통 완료 기준(AGENTS.md) 전 항목.

## 16. 다음 단계 연결점

- 02~09는 이 브랜치들이 develop에 병합된 뒤 시작한다. 각 작업은 자기 모듈 스텁(`router.py`, `models.py`)과 자리표시 페이지를 채운다.
- 02는 `/onboarding`이 넘겨주는 `/allocation/survey?onboarding=1`을 받아 설문 후 `/allocation`으로 보낸다.
- 09는 `features/chat/components/ChatWidget.tsx` 스텁을 실제 위젯으로 바꾼다.
- 08·17은 `crypto`로 자격증명을 저장한다. 04·10·13·07은 `get_structured_llm`을 쓴다.
