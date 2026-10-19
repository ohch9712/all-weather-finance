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
- 모든 LLM 호출이 쓸 공통 계층(데이터 등급별 공급자 선택, Gemini·Ollama 어댑터, 스키마 변환, AI 상태 API), 암호화·시간·로그 마스킹 유틸, 공통 에러 형식을 만든다.
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
| LLM 공통 계층(`integrations/llm`)과 `GET /api/ai/status` | 로그인·가입·온보딩·프로필 설정 화면, AI 공급자 배지(`AiProviderBadge`, `useAiStatus`) |
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
- `docs/specs/01-foundation.md` 끝 `## 구현 결과`의 `### 01a` 아래(자리표시 줄을 지우고 채운다. `### 01b` 부분은 건드리지 않는다)

### 01b

- `frontend/package.json`, `frontend/package-lock.json`, `frontend/.env.example`, `frontend/.gitignore`, `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`, `frontend/components.json`, `frontend/vitest.config.mts`, `frontend/public/**`, `frontend/logs/.gitkeep`
- `frontend/AGENTS.md`, `frontend/CLAUDE.md`(`next dev`가 만드는 Next.js 에이전트 규칙. 그대로 커밋한다)
- `frontend/src/app/layout.tsx`, `frontend/src/app/providers.tsx`, `frontend/src/app/globals.css`, `frontend/src/app/not-found.tsx`, `frontend/src/app/(auth)/**`
- `frontend/src/app/(app)/layout.tsx`, `frontend/src/app/(app)/page.tsx`, `frontend/src/app/(app)/onboarding/**`, `frontend/src/app/(app)/settings/profile/**`, 11.6절의 자리표시 페이지 전부
- `frontend/src/components/**`, `frontend/src/features/auth/**`, `frontend/src/features/chat/components/ChatWidget.tsx`(스텁), `frontend/src/lib/**`, `frontend/src/types/**`
- `frontend/tests/setup.ts`, `frontend/tests/utils.tsx`, `frontend/tests/foundation/**`
- `docs/specs/01-foundation.md` 끝 `## 구현 결과`의 `### 01b` 아래(자리표시 줄을 지우고 채운다. `### 01a` 부분은 건드리지 않는다)

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
| LLM | 데이터 등급별 공급자. 개인 데이터가 없는 작업은 Gemini(`google-genai` Interactions API, `gemini-3.8-flash`), 개인 금융 데이터는 로컬 Ollama(`ollama`, `gemma4:12b`). 기본값은 둘 다 꺼짐 | architecture 9.1 |
| 백엔드 린트 | ruff | |
| 프론트 | `create-next-app` 최신 안정 버전(Next.js 16, React 19, Tailwind 4, ESLint, App Router, `src/`, alias `@/*`), npm | |
| UI | shadcn/ui(CLI 초기화) + lucide-react + sonner | |
| 데이터 패칭 | TanStack Query v5, 쿼리 키는 `[module, ...]` 배열 | |
| 폼 | react-hook-form + zod + `@hookform/resolvers` | |
| 차트 | Recharts, 래퍼 3종 | |
| 프론트 테스트 | Vitest + Testing Library + jsdom + MSW 2(`msw/node`) | gamja-market은 `vi.stubGlobal` fetch였다. 모듈이 많아 MSW로 통일한다 |

### 4.1 설치할 의존성 (이후 작업은 추가하지 않는다)

백엔드 `dependencies`: `fastapi`, `uvicorn[standard]`, `sqlalchemy>=2.0,<2.1`, `psycopg[binary]`, `alembic`, `pydantic[email]`, `pydantic-settings`, `argon2-cffi`, `python-multipart`, `google-genai>=2.31,<3`, `ollama>=0.6.3,<0.7`, `pypdfium2>=5.14,<6`, `pillow`, `httpx`, `websockets`, `cryptography`, `pandas`, `openpyxl`, `xlrd`, `lxml`, `charset-normalizer`

백엔드 `dev` 그룹: `pytest`, `respx`, `freezegun`, `ruff`

프론트 `dependencies`: `next`, `react`, `react-dom`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `recharts`, `react-markdown`, `remark-gfm`, `lucide-react`, `sonner`, 그리고 shadcn CLI가 추가하는 패키지(CLI 4.21.x, radix 기반 기준: `class-variance-authority`, `cn`(clsx+tailwind-merge 대체, `shadcn-ui/cn`), `radix-ui`(통합 Radix 패키지), `tw-animate-css`, `cmdk`, `next-themes`(sonner 컴포넌트용), `shadcn`(`globals.css`의 `shadcn/tailwind.css` import용). `clsx`·`tailwind-merge`·개별 `@radix-ui/*`는 따로 설치하지 않는다)

프론트 `devDependencies`: `typescript`, `@types/*`, `eslint`, `eslint-config-next`, `tailwindcss`, `@tailwindcss/postcss`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `msw`

shadcn 컴포넌트: `accordion`, `alert`, `alert-dialog`, `avatar`, `badge`, `button`, `card`, `checkbox`, `command`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `popover`, `progress`, `radio-group`, `scroll-area`, `select`, `separator`, `sheet`, `skeleton`, `sonner`, `switch`, `table`, `tabs`, `textarea`, `tooltip`. `form`은 현재 스타일 레지스트리에서 빠져 있어 new-york-v4 레지스트리의 react-hook-form 연동 `form.tsx`를 import 경로만 맞춰 `components/ui/form.tsx`로 둔다

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
    format.py             # format_krw, format_krw_compact(9절). 서버가 만드는 화면 문장·카드용
  db/
    base.py               # Base(DeclarativeBase), 제약 이름 규칙(naming_convention)
    session.py            # engine, SessionLocal(gamja-market 이식)
    models.py             # 모든 모듈의 models 모듈 import(메타데이터 수집용)
  api/
    router.py             # APIRouter(prefix="/api"): health, auth, profile, ai_status, 12개 모듈 라우터
    deps.py               # get_db, DBSession, CurrentUser, AdminUser, require_json, PageQuery
    health.py
    ai_status.py          # GET /api/ai/status(8절)
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
- 검증: `email`은 이메일 형식, `password` 8~32자(2026-10-19 사용자 결정으로 8~128자에서 줄였다. 문자 수는 코드 포인트 기준. 로그인 7.4와 회원 탈퇴(19)의 비밀번호 확인은 이미 가입한 계정을 위해 지금처럼 8~128자를 받는다), `passwordConfirm`은 `password`와 완전히 같은 문자열(다르면 `details: [{"field": "passwordConfirm", "message": "비밀번호가 일치하지 않습니다."}]`, `password`가 규칙을 어기면 불일치 검사는 하지 않는다).
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

### 7.10 `GET /api/ai/status`

- 인증 필요(미인증 `401`). 응답 `200`은 architecture 9.1.3의 `get_ai_status()` 그대로다.

```json
{ "general":  { "enabled": true,  "provider": "gemini", "location": "cloud", "model": "gemini-3.8-flash", "reason": null },
  "personal": { "enabled": false, "provider": "gemini", "location": "cloud", "model": "gemini-3.8-flash", "reason": "billing_required" } }
```

- `reason`: `null`(켜짐), `not_configured`(`disabled`), `missing_api_key`(Gemini 키 없음), `billing_required`(개인 등급을 Gemini로 두었는데 `GEMINI_BILLING_ENABLED=false`). 꺼진 등급의 `provider`·`location`·`model`은 설정값 그대로 보여 주고, `not_configured`면 셋 다 `null`이다.
- 키, 호스트 주소 같은 값은 넣지 않는다. Ollama 연결 여부는 확인하지 않는다(실제 호출에서 `LLM_UNAVAILABLE`로 알린다).

## 8. LLM 공통 계층 (01a, `app/integrations/llm/`)

호출 형태와 규칙은 `docs/architecture.md` 9.1절이 기준이다. SDK 사용법을 추측하지 않는다. 9.1절에 없는 것이 필요하면 설치된 `google-genai`·`ollama` 패키지 소스를 확인하고 `ask`로 묻는다. 아래 파일을 만든다.

| 파일 | 내용 |
| --- | --- |
| `types.py` | `Effort`, `DataClass`, `ProviderName`, `TextPart`, `ImagePart`, `DocumentPart`, `Part` |
| `tasks.py` | `LLMTask`, `LLM_TASKS`(architecture 9.1.2 표 그대로), `get_task(key) -> LLMTask` |
| `schema.py` | `portable_json_schema(model) -> dict`(9.1.6) |
| `clients.py` | `get_gemini_client()`, `get_ollama_client()`(lru_cache, 9.1.3) |
| `pdf.py` | `pdf_to_png_pages(data: bytes) -> list[bytes]`(`pypdfium2`, `scale=2`, Pillow로 PNG 인코딩) |
| `gemini_adapter.py` | `GeminiStructuredLLM`(9.1.4) |
| `ollama_adapter.py` | `OllamaStructuredLLM`(9.1.5) |
| `structured.py` | `StructuredLLM` Protocol, `DisabledLLM`, `RoutedStructuredLLM` |
| `status.py` | `ScopeStatus`, `AiStatus`, `get_ai_status()`, `resolve_provider(data_class)` |
| `fake.py` | `FakeStructuredLLM`, `FakeRequest` |
| `deps.py` | `get_structured_llm()` FastAPI 의존성, `StructuredLLMDep` 타입 별칭 |

세부 동작

1. 설정(`core/config.py`): architecture 2.3의 LLM 변수를 읽는다. `LLM_GENERAL_PROVIDER`·`LLM_PERSONAL_PROVIDER`는 `disabled`/`gemini`/`ollama`만 받고, 그 밖의 값(`anthropic` 포함)이면 시작할 때 설정 오류로 멈춘다.
2. `resolve_provider(data_class)`: architecture 9.1.1의 규칙으로 등급별 `ScopeStatus`를 계산한다. 라우터와 상태 API가 같은 함수를 쓴다. 프로세스 시작 시 등급별 결정을 한 번 로그로 남긴다(키·주소 제외).
3. `RoutedStructuredLLM.generate(task=..., system=..., content=..., output=Model)`: `get_task(task)`로 등급·effort·max_tokens를 찾고, 등급의 공급자 어댑터를 부른다. 등급이 꺼져 있으면 `DisabledLLM`과 같은 503이다. `enabled_for(task)`는 등급이 켜져 있는지 돌려준다.
4. `GeminiStructuredLLM(client=None, settings=None)`, `OllamaStructuredLLM(client=None, settings=None)`: 인자가 없으면 `clients.py`의 팩토리와 `get_settings()`를 쓴다. 테스트는 가짜 클라이언트를 넣는다. 호출 순서와 오류 처리는 9.1.4·9.1.5와 같다.
5. `DisabledLLM.generate`는 항상 `AppError(503, "LLM_UNAVAILABLE", "AI 기능이 꺼져 있습니다. 서버에 로컬 AI(Ollama)나 Gemini를 설정해야 합니다.")`.
6. `FakeStructuredLLM.register(task, handler)`: `handler(req: FakeRequest) -> dict`. `generate`는 handler 결과를 `output.model_validate`해서 돌려준다. 등록되지 않은 task는 `AssertionError`. `set_enabled(task, False)`면 `enabled_for`가 거짓이고 `generate`가 503이다. 호출 기록은 `calls: list[FakeRequest]`(`task`, `data_class`, `system`, `content`(Part 목록), `output_name`).
7. `pdf_to_png_pages`: PDF가 아니면 `ValueError`. 쪽 수 제한은 하지 않는다(호출하는 쪽이 먼저 검사).

## 9. 공통 유틸 (01a)

- `crypto.encrypt_str(plain) -> str`, `decrypt_str(token) -> str`: Fernet. 키가 비어 있거나 잘못되면 시작 시 명확한 에러로 실패한다(`APP_ENV=test`에서는 테스트용 고정 키 허용).
- `crypto.mask_tail(value, keep=4) -> str`: `"1234567890"` → `"******7890"`.
- `time.now_utc()`(aware datetime), `time.today_kst()`(date). 모든 모듈은 `datetime.now()`를 직접 쓰지 않는다.
- `logging.SecretMaskingFilter`: 로그 레코드의 메시지·인자에서 `app_key`, `appkey`, `app_secret`, `secretkey`, `secret`, `token`, `password`, `account_no`, `authorization` 키의 값을 `***`로 바꾼다.
- `domain.py`: architecture 6절 상수와 한국어 표시명, `AGE_BAND_REPRESENTATIVE_AGE = {"20s": 25, "30s": 35, "40s": 45, "50s": 55, "60s": 65}`.
- `format.py`: 프론트 `lib/format.ts`(11.2)와 같은 규칙. `format_krw(1234000)` → `"1,234,000원"`(음수 `"-5,000원"`). `format_krw_compact(n)`: 절댓값이 1억 이상이면 억 단위 소수 첫째 자리(ROUND_HALF_UP, `.0`은 생략, 정수부는 천 단위 쉼표: `100000000` → `"1억원"`, `123400000` → `"1.2억원"`, `2710264056` → `"27.1억원"`, `1275600000000` → `"12,756억원"`, `123456789012` → `"1,234.6억원"`. 프론트 `formatEok`와 같다), 1만 이상이면 만 단위 정수(ROUND_HALF_UP, 천 단위 쉼표: `56700000` → `"5,670만원"`, `12345678` → `"1,235만원"`, 반올림 결과가 10,000만이면 `"1억원"`), 1만 미만은 `format_krw`. 음수는 앞에 `-`.

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
           SampleDataBadge.tsx, Disclaimer.tsx, ConfirmDialog.tsx, ComingSoon.tsx, AiProviderBadge.tsx
  features/
    auth/api.ts, types.ts, AuthProvider.tsx, components/(LoginForm, SignupForm, RequireAuth, OnboardingGate, ProfileForm)
    chat/components/ChatWidget.tsx   # 스텁: null을 렌더링. 09가 내용을 채운다
  lib/
    api-client.ts           # gamja-market 이식(apiFetch, ApiError, 타임아웃 10초)
    format.ts, navigation.ts, domain.ts, query.ts, site.ts
    ai-status.ts            # useAiStatus(): GET /api/ai/status(쿼리 키 ["ai", "status"], staleTime 5분), AiStatus 타입
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
| `AiProviderBadge` | `scope: "general" \| "personal"`, `compact?` | `useAiStatus()`의 해당 등급으로 배지를 그린다. 로컬: "로컬 AI"(툴팁 "입력한 내용은 이 서버의 로컬 AI(Ollama)가 처리하고 외부로 보내지 않아요."), Gemini: "Google Gemini"(툴팁 "입력한 내용이 Google Gemini API로 전송돼요."), 꺼짐: "AI 꺼짐"(툴팁 "서버에 AI 설정이 없어 AI 기능을 쓸 수 없어요."). 상태를 못 불러오면 아무것도 그리지 않는다 |
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
| `formatKRWCompact(123400000)` | `1.2억원`, `100000000` → `1억원`, `56,700,000` → `5,670만원`, `12,345,678` → `1,235만원`, 1만 미만은 `formatKRW`. 규칙은 9절 `format_krw_compact`와 같다 |
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

- 데스크톱(≥1024px): 왼쪽 고정 사이드바(서비스 이름 + 메뉴 그룹), 상단 바(페이지 제목 영역, 사용자 메뉴: 이메일, 프로필 설정, 로그아웃). 서비스 이름은 `lib/site.ts`의 `APP_NAME` 상수 하나로 관리하고 값은 "올웨더 자산관리"다(2026-10-19 사용자 결정, 처음 값은 저장소 이름과 같은 "금융 프로젝트"였다. 21 수정에서 바꿨다). 이름을 바꿀 때는 이 상수와 백엔드 OpenAPI 제목(`app/main.py`의 `"{서비스 이름} API"`)만 바꾼다.
- 모바일: 상단 바 + 햄버거 → `Sheet` 메뉴. 본문은 좌우 16px 여백.
- 본문 최대 폭 1200px. 오른쪽 아래에 `<ChatWidget />`(지금은 아무것도 렌더링하지 않음).

### 12.2 `/login`, `/signup`

- gamja-market 폼 구성을 따른다. 가입 폼: 이메일, 비밀번호, 비밀번호 확인. 클라이언트 검증은 7.3과 같은 규칙(zod). 비밀번호 칸 안내 "8~32자로 입력해 주세요.", 오류 "비밀번호는 8~32자로 입력해 주세요."(2026-10-19). 가입 카드 설명은 "가입 시 바로 로그인되고, 출생연도를 입력하는 화면으로 이어져요."(2026-10-19, '가입하면' → '가입 시'). 로그인 폼은 비밀번호 길이를 검사하지 않는다(지금처럼 빈 값만).
- 서버 에러 `details`를 해당 필드 아래에 보여 주고, 필드 없는 에러는 폼 위 `Alert`로 보여 준다.
- 이미 로그인 상태로 접근하면 `/`로 보낸다.

### 12.3 `/onboarding`

- 안내: "나이대와 투자성향, 목표에 따라 권장 자산배분이 달라져요. 먼저 출생연도를 알려 주세요."
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
  - `format`: 9절 예시 값 전부와 음수, 99,995,000 → `"1억원"`
  - `SecretMaskingFilter`
  - LLM 라우팅: 작업 등급별 공급자 선택(general → Gemini, personal → Ollama), 등록되지 않은 작업 `ValueError`, 꺼진 등급 503, 설정값 `anthropic`이면 설정 오류
  - 결제 조건: `LLM_PERSONAL_PROVIDER=gemini`이고 `GEMINI_BILLING_ENABLED=false`면 personal이 꺼지고(`billing_required`) general은 영향이 없다. 키가 없으면 `missing_api_key`
  - Gemini 어댑터(가짜 클라이언트): 호출 인자(`model`, `store=False`, `system_instruction`, 파일 부분 → 텍스트 순서의 `input`, `response_format.schema`, `generation_config`의 `thinking_level`·`max_output_tokens`), `status`별 처리(`completed`/`incomplete`/`failed`), 400 + `code: "safety"` → `LLM_REFUSED`, 그 밖의 예외 → `LLM_UNAVAILABLE`, JSON 검증 실패 → `LLM_UNAVAILABLE`
  - Ollama 어댑터(가짜 클라이언트): 호출 인자(`model`, system → user 순서의 `messages`, `format`, `stream=False`, effort별 `think`, `OLLAMA_THINKING=false`면 `think` 없음, `options`), 이미지·PDF가 `images`로 들어감, `done_reason == "length"`, `ConnectionError`, `ResponseError` 404 안내 문구
  - `portable_json_schema`: 중첩 모델(`$defs` 펼침), Optional, enum, Literal(`const` → `enum`), 판별 유니언(`oneOf` → `anyOf`), 지워야 할 키워드, 재귀 모델 `ValueError`
  - `pdf_to_png_pages`: `pypdfium2`로 만든 2쪽 PDF → PNG 2개, PDF가 아니면 `ValueError`
  - `/api/ai/status`: 미인증 401, 설정 조합별 응답, 응답에 키·주소가 없음
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
  - `AiProviderBadge`: 로컬·Gemini·꺼짐 세 상태의 문구와 툴팁, 상태 요청 실패 시 렌더링 없음(MSW)

## 14. 완료 기준

### 01a

- [ ] `docker compose up -d postgres` 후 `scripts/worktree-setup.sh`가 슬롯 01로 `.env`, DB `finance_01`, 마이그레이션까지 끝낸다. 두 번 실행해도 결과가 같다.
- [ ] `scripts/start.sh backend`로 `http://localhost:8001/api/health`가 `200`이다. `scripts/stop.sh`로 그 프로세스만 종료된다.
- [ ] `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest`가 통과한다.
- [ ] 빈 DB에서 `alembic upgrade heads` → `downgrade base` → `upgrade heads`가 성공한다.
- [ ] `/docs`(OpenAPI)에 auth·profile·health와 12개 모듈 태그가 보인다.
- [ ] `GEMINI_API_KEY`와 로컬 Ollama 없이 모든 테스트가 통과하고, 실제 네트워크 호출이 없다.

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
5. `portable_json_schema` 결과가 architecture 9.1.6 규칙을 지키고, Gemini·Ollama 어댑터가 9.1.4·9.1.5의 인자 형태로 SDK를 부른다(테스트 코드로 확인). Gemini 호출에 `store=False`가 항상 있다. personal 등급이 결제 조건 없이 Gemini로 가는 경로가 없다.
6. `worktree-setup.sh`가 사용자가 넣은 `.env` 값을 보존하고, 다른 슬롯 DB를 건드리지 않는다. `stop.sh`가 다른 워크트리 프로세스를 종료하지 않는다.
7. 4.1절 의존성이 모두 설치돼 있다(`uv pip list`, `npm ls --depth=0`).
8. 11.6절 자리표시 경로가 모두 있고, 내비게이션이 architecture 12.1절과 일치한다.
9. 고지 컴포넌트 문구가 architecture 13절과 글자 단위로 같다.
10. 공통 완료 기준(AGENTS.md) 전 항목.

## 16. 다음 단계 연결점

- 02~09는 이 브랜치들이 develop에 병합된 뒤 시작한다. 각 작업은 자기 모듈 스텁(`router.py`, `models.py`)과 자리표시 페이지를 채운다.
- 02는 `/onboarding`이 넘겨주는 `/allocation/survey?onboarding=1`을 받아 설문 → 목표·상황 → 자산 간단 입력 → 추천 결과 → 상세 설명으로 잇는다(02 9절).
- 09는 `features/chat/components/ChatWidget.tsx` 스텁을 실제 위젯으로 바꾼다.
- 08·17은 `crypto`로 자격증명을 저장한다. 04·10·13·07은 `get_structured_llm`을 쓴다. 09는 `clients.py`·`tasks.py`·`schema.py`와 `get_ai_status()`로 챗봇 공급자 어댑터를 만든다. AI를 쓰는 화면은 01b의 `AiProviderBadge`로 데이터 처리 위치를 보여 준다.

## 구현 결과

두 작업이 같은 파일을 고치므로 자기 소제목 아래만 채운다(병합 충돌 방지).

### 01a

- 구현: Python 3.13/uv 프로젝트와 4.1절 백엔드·dev 의존성 25개를 설치하고 `backend/uv.lock`으로 고정했다. FastAPI 공통 설정·에러·CORS·camelCase 스키마·페이지네이션, Argon2id 비밀번호, SHA-256 서버 세션과 쿠키, Fernet·시간·금액 형식·로그 마스킹 유틸을 구현했다.
- 인증·프로필: 7절 API 전체, `AdminUser`, `make-admin` CLI, 공개 서비스 `ProfileInfo`/`get_profile`/`compute_age_band`를 구현했다. 가입 시 빈 프로필을 만들며, 로그인 시 기존 세션을 교체하고 만료 세션은 삭제한다. 응답 시각은 DB 시간대와 관계없이 UTC `Z`로 직렬화한다.
- DB·모듈: `users`, `sessions`, `user_profiles`와 `foundation_0001`(foundation 브랜치)을 추가했다. auth와 12개 모듈의 모델 import 및 라우터 등록을 준비했다. 빈 모듈에는 임의 엔드포인트를 만들지 않고 OpenAPI 태그 메타데이터를 명시했다(health/auth/profile/ai + 12개 모듈 = 16개).
- AI: 작업 등록부, 데이터 등급별 라우팅·상태 API, Gemini Interactions/Ollama 어댑터, 이식 가능한 JSON 스키마 변환, PDF→PNG, `FakeStructuredLLM`을 구현했다. personal Gemini의 결제 조건은 라우터와 직접 어댑터 호출 모두에서 검사하며 자동 폴백은 없다. 모든 Gemini 호출에 `store=False`가 있다. 어댑터는 SDK 클라이언트를 주입할 수 있다.
- 인프라: 공용 Postgres 17 compose, 슬롯별 DB/포트·환경설정 준비, 설정값 보존, 잠금·PID 소유권 검사·프로세스 그룹 정리·로그 회전·헬스체크를 구현했다. 포트 점유 프로세스는 종료하지 않으며 stop은 현재 워크트리의 검증된 PID 기록만 사용한다. 이 브랜치에서 frontend 디렉터리는 만들지 않았다.
- 검증: `docker compose up -d postgres`, `scripts/worktree-setup.sh` 두 차례 실행으로 슬롯 01/DB `finance_01`/8001·3001/마이그레이션을 확인했다. `scripts/start.sh backend` 후 실제 HTTP로 가입→프로필 수정→로그아웃→재로그인, 기본 프로필·쿠키 속성·401/404/405/409/422·사용자 분리·AI 상태·OpenAPI를 확인했고 `scripts/stop.sh backend`로 종료했다. 검증용 사용자는 삭제했다.
- 검사 결과: `uv run ruff check .`, `uv run ruff format --check .` 통과, `uv run pytest -q` **97개 통과**. 테스트 HTTP 전송을 차단하며 실제 Gemini·Ollama·증권사·CODEF는 호출하지 않는다. 추가로 스크립트 Python의 ruff 검사와 Bash 구문 검사도 통과했다. 별도 빈 DB `finance_01_impl_verify`에서 `uv run alembic upgrade heads` → `uv run alembic downgrade base` → `uv run alembic upgrade heads`가 통과했고 `uv run alembic check`에 추가 작업이 없었다. 검증 DB는 삭제했다.
- 계약 확인: 코디네이터 승인에 따라 CORS 사전 요청 거부와 기타 프레임워크 오류는 원래 HTTP 상태 + `HTTP_ERROR`를 사용한다(갱신된 architecture 4.1 반영). Gemini 가짜 응답은 google-genai 2.31.0 `_gaos/types/interactions/interaction.py`의 `_populate_output_helpers`에 맞춰 `steps`로 생성한다(코디네이터 승인 및 architecture 9.1.8 반영). Orca 1.4.224 `out/shared/orca-yaml.js` 기준으로 `scripts.setup` 인식 확인.
- 스펙과 다른 점: 없음. 명세되지 않은 내부 동작은 단순하게 정했고, 테스트 픽스처는 기존 개발 데이터를 트랜잭션 안에서만 지운 뒤 롤백한다. 테스트의 공개 고정 Fernet 키는 테스트 전용이다.
- 남은 일: 코디네이터의 별도 검증·PR 병합 및 01b와의 통합 검증. 설치된 Starlette 1.8.0은 TestClient의 httpx 사용에 deprecation 경고 1건을 표시하지만 테스트는 통과하며, 계약 밖 패키지 `httpx2`는 추가하지 않았다. 실제 외부 AI 연결은 이번 테스트 범위 밖이다.

#### 웨이브 1 통합 검증 지적 수정: 접근 로그 마스킹

- `SecretMaskingFilter`가 `uvicorn.access`의 메시지 틀과 인자 튜플 5개를 유지하고 각 인자 안의 비밀값만 가리도록 수정했다. 상태 코드의 정수 타입도 유지하며 쿼리 `token`은 `***`로 바뀐다.
- 일반 로그는 인자를 먼저 가린 뒤 서식을 적용한 결과를 검사한다. 결과에 추가로 가릴 비밀값이 있을 때만 최종 문자열을 메시지로 저장하고 인자를 비운다. 따라서 `password=%s`·`token=%s`의 서식 지정자가 먼저 없어져 서식 오류가 나는 일을 피하며, 추가 마스킹이 필요 없는 메시지는 기존 메시지 틀과 인자의 타입·길이를 유지한다.
- `tests/foundation/test_logging.py`에 실제 Uvicorn `AccessFormatter`, 일반·쿼리 접근 로그, 위치·딕셔너리 인자, 중첩 딕셔너리, 숫자·퍼센트 서식, 일반 메시지, 필터 중복 적용을 확인하는 회귀 테스트 13개를 추가했다. 기존 테스트는 수정하지 않았다.
- 검증: `scripts/worktree-setup.sh`(슬롯 01, `finance_01`) 성공, `uv run ruff check .`·`uv run ruff format --check .` 통과, `uv run pytest` **110개 통과**(기존 Starlette 경고 1건). 실제 외부 API를 호출하지 않았다.
- 실제 서버: `uv run uvicorn app.main:app --port 8001` 실행 후 `/api/health`와 테스트용 `token` 쿼리를 붙인 요청이 모두 `200 {"status":"ok"}`를 반환했다. 요청마다 접근 로그가 한 줄씩 남고 쿼리 값은 `***`로 가려졌으며 stderr에 `Logging error`·스택 추적이 없었다. 확인 후 검증 서버를 종료했다.
- 스펙과 다른 점·의존성 추가: 없음. 남은 일: 코디네이터의 별도 검증과 PR 병합.

### 01b

#### 구현한 것

- 프로젝트: `create-next-app` 16.4.2(Next.js 16.4.2, React 19.3, TypeScript strict, Tailwind CSS 4, ESLint 9, App Router, `src/`, `@/*`, npm). 4.1의 프론트 의존성 전부와 shadcn CLI 4.21.5(radix 기반, 스타일 `radix-nova`)로 28개 컴포넌트를 설치했다. 스크립트는 `dev`·`build`·`start`·`lint`·`test`(`vitest run`)·`test:watch`.
- 디자인 시스템(`globals.css`): shadcn neutral 토큰, 자산군 `--asset-stock|bond|gold|cash|other`, 계열 색 `--chart-1~6`, 금액 증감 `--money-up`(빨강)·`--money-down`(파랑)을 라이트·다크 두 벌로 둔다. Tailwind 유틸리티 `bg-asset-stock`, `text-money-up` 등으로도 쓸 수 있다. 차트 색은 dataviz 검증기로 확인했고 결과를 파일 주석에 적었다(자산군: 라이트 색약 ΔE 최소 10.6·일반 16.3, 다크 8.4·15.9. 계열 색: 라이트 9.1·19.6, 다크 8.4·19.3. 인접 쌍과 도넛의 처음·끝 쌍 기준).
- 차트 래퍼(`components/charts`): `DonutChart`·`BarChart`·`LineChart`(Recharts 3.10 `responsive`), `palette.ts`(`assetColor`, `seriesColor`, `CHART_CHROME`, `readCssColor`), 공용 범례·툴팁·숨김 표(`ChartParts.tsx`). 모든 차트가 `role="img"`+`aria-label`과 같은 데이터의 `sr-only` 표를 그리고, 2개 이상 계열이면 범례를 붙인다. 색은 `var(--...)`를 SVG에 그대로 넘겨 테마 전환이 다시 렌더링 없이 반영된다.
- 공용 컴포넌트(`components/common`): 11.1의 10종. `Disclaimer`는 architecture 13절 문구를 `DISCLAIMER_TEXT`로 내보낸다.
- 앱 셸(`components/layout`): `AppShell`(데스크톱 고정 사이드바 240px, 상단 바, 본문 최대 1200px·모바일 좌우 16px, 본문 건너뛰기 링크), `Sidebar`, `MobileNav`(Sheet), `UserMenu`(이메일, 프로필 설정, 로그아웃), 둘이 함께 쓰는 `NavLinks`.
- `lib/`: `api-client`(gamja-market 이식), `format`, `navigation`, `domain`, `query`(`createQueryClient`, `shouldRetry`), `site`(`APP_NAME`), `ai-status`(`useAiStatus`), `form-errors`(`toSubmitErrors`·`applyFieldErrors`: 서버 에러 → 필드 에러·폼 위 문구), `utils`(`cn`). `types/api.ts`: `ErrorResponse`, `ErrorDetail`, `Page<T>`.
- 인증(`features/auth`): `api.ts`, `types.ts`, `validation.ts`(zod 4), `redirect.ts`(`getSafeRedirectPath`, `getLoginPath`), `hooks.ts`(`useLogin`, `useSignup`, `useUpdateProfile`, `useRedirectIfAuthenticated`), `AuthProvider`, `components/`(`LoginForm`, `SignupForm`, `RequireAuth`, `OnboardingGate`, `ProfileForm`, `AuthGateFallback`, `FormAlert`).
- 화면: `/login`, `/signup`, `/onboarding`, `/settings/profile`, 404, 11.6의 자리표시 18개, `ChatWidget` 스텁(null).
- 테스트(`tests/`): `setup.ts`(jest-dom, MSW `onUnhandledRequest: "error"`, `next/navigation` 메모리 라우터 목, jsdom 폴리필), `utils.tsx`(`renderWithProviders(ui, { route, auth })`, `server`, `apiUrl`, `errorResponse`, `authPayload`, `mockMe`, `memoryRouter`), `foundation/` 12개 파일 146개 테스트(13.2 항목 전부 + 고지 문구 글자 대조, 공용 컴포넌트, fetch·apiFetch 사용 위치 구조 검사).

#### 검사 결과

- `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run test` 12 files / 146 tests 통과, `npm run build` 통과(22개 경로 생성).
- `npm run dev -- --port 3001`로 모든 자리표시 경로와 로그인·가입·온보딩·프로필이 200으로 렌더링된다. 백엔드가 꺼져 있으면 `(app)` 화면은 "서버에 연결할 수 없습니다…" 오류 상태와 "다시 시도"를, 로그인·가입은 폼을 정상으로 보여 준다.
- 헤드리스 Chrome(CDP)으로 360px·1280px × 라이트·다크에서 홈·프로필·설문 자리표시·종목 상세·로그인·가입·온보딩·모바일 메뉴·차트 데모(커밋하지 않음)를 열어 `scrollWidth == clientWidth`(가로 스크롤 없음)와 화면 대비를 확인했다.
- develop 병합 후 `scripts/worktree-setup.sh`가 이 lock 파일로 `npm ci`까지 성공했고, `scripts/start.sh backend`로 띄운 01a 백엔드와 실제 브라우저 흐름(미인증 접근 → `/login?next=/ledger`, 가입 → `/onboarding`, 출생연도 저장 → `/allocation/survey?onboarding=1`, 프로필 화면, 로그아웃 → `/login`·`/api/auth/me` 401, 재로그인 → `/ledger`)이 통과했다.

#### 스펙과 다른 점과 이유

1. `next.config.ts`는 create-next-app 16.4 기본값인 `cacheComponents`·`partialPrefetching`을 끈다(코디네이터 결정, architecture 12절). 데이터를 모두 클라이언트에서 불러와 이점이 적고, Activity가 숨긴 이전 경로 상태가 다른 사용자에게 남을 수 있다.
2. Tailwind: 스캐폴드가 넣은 `@tailwindcss/turbopack`(+turbopack 규칙)을 빼고 4.1대로 `@tailwindcss/postcss` + `postcss.config.mjs`로 바꿨다.
3. shadcn CLI 4.21이 넣은 패키지(`cn`, `radix-ui`, `next-themes`, `shadcn`)를 그대로 쓴다(코디네이터 승인, 4.1 갱신). `form`은 현재 스타일 레지스트리에서 비어 있어 new-york-v4 `form.tsx`를 경로만 맞춰 두었다(파일 맨 위에 출처 주석). zod 변환(문자열 → 정수)을 쓰는 폼을 받도록 `FormField`에 `TTransformedValues` 제네릭을 더했다. `components/ui`의 영어 문구(Close, Command Palette)는 한국어로 바꿨다.
4. 버전: MSW는 최신 3.x 대신 스펙대로 2.x(2.15), `@types/node`는 vitest 5의 peer 요구로 24, zod는 4(최신).
5. `frontend/CLAUDE.md`: Next 16.4의 `next dev`는 `AGENTS.md`만 만들므로 gamja-market·저장소 루트와 같은 `@AGENTS.md` 한 줄을 직접 두었다.
6. 폰트: `next/font`로 받지 않고 시스템 한글 글꼴 스택(`--font-sans`: Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR …)을 쓴다. 빌드할 때 네트워크가 필요 없고 한글 글리프가 없는 Geist를 쓰지 않기 위해서다. 템플릿의 `src/app/favicon.ico`는 소유 경로인 `public/favicon.ico`로 옮겼다.
7. 다크 모드는 OS 설정(`prefers-color-scheme`)을 따른다. shadcn의 `dark:` 변형을 미디어 쿼리로 바꿨다(스크립트가 없어 첫 화면 깜빡임·하이드레이션 문제가 없다). 테마 전환 UI는 없다.
8. 자산군 색은 11.1의 색 계열을 검증기로 고른 값이다. 채권은 금(호박)과 적록 색약에서 구분되도록 청록 쪽 초록(라이트 `#1baf7a`, 다크 `#199e70`)이다. 현금성 자산 회색은 스펙상 중립색이라 채도 기준의 예외다. 3:1 미만인 색(라이트 채권 2.82, 다크 기타 2.81)은 범례·값·숨김 표로 보완한다.
9. `formatKRWCompact`는 스펙 11.2·9절 규칙(만 단위 정수)이다(코디네이터 확인, architecture 12절 예시 수정 5273cba). `AGE_BAND_LABEL`은 짧은 이름이고 "20세 미만 포함"은 주석으로 둔다(코디네이터 확인).
10. `apiFetch`는 문자열 본문뿐 아니라 본문 없는 POST·PUT·PATCH·DELETE에도 `Content-Type: application/json`을 붙인다. 01a의 로그아웃이 architecture 4절대로 `require_json`을 걸어, 본문 없는 요청은 422가 났기 때문이다(실제 백엔드 흐름 확인 중 발견). `FormData` 본문(업로드)에는 붙이지 않는다. jsdom·Node에서 `DOMException` realm이 달라 취소 판별은 `instanceof` 대신 이름과 호출자 signal로 한다.
11. 스펙에 없던 세부(가장 단순한 쪽으로 정함)
    - `AuthProvider` 값에 `error`(`/me`가 401이 아닌 이유로 실패)와 `signedOut`(이 화면에서 로그아웃함)을 더했다. `RequireAuth`는 `error`가 있으면 로그인으로 보내지 않고 오류 상태와 다시 시도를 보여 준다. `logout`은 요청이 실패하면 상태를 유지하고 에러를 던지며, 사용자 메뉴·프로필 화면은 토스트로 알린다. `refresh`는 로그인된 상태에서 실패하면 화면을 유지한다.
    - `next`에는 쿼리 문자열도 담는다(`/login?next=/allocation/survey%3Fonboarding%3D1`). `RequireAuth`·`LoginForm`은 `useSearchParams`를 쓰므로 `(app)/layout.tsx`와 로그인 페이지에서 `Suspense`로 감쌌다.
    - 내비게이션 그룹: `main`(홈·자산배분·가계부·매매일지·상속·증여·배우기·AI 상담), `stocks`(관심종목·조건검색, 제목 "주식"), `settings`(프로필·증권사 연결), `admin`(학습 콘텐츠 관리). 배열 순서는 architecture 12.1 표와 같다. 상단 바 제목은 현재 메뉴 이름(`findActiveNavItem`)이다.
    - `formatPercent(value, digits = 1)`은 소수 자릿수를 고정한다(`50` → `"50.0%"`, 정수는 `digits = 0`). `formatDate`는 시각 문자열도 받아 KST 날짜로 바꾼다. `currentKstYear()`를 더했다.
    - `ConfirmDialog`에 `trigger`·`open`·`onOpenChange`·`cancelLabel`을 더했고 `onConfirm`이 Promise면 끝난 뒤 닫는다. `DonutChart`에 `valueFormatter`, `BarChart`·`LineChart`에 `height`를 더했다. `BarChart`의 `layout`은 Recharts와 같은 뜻이다(`horizontal` 기본 = 세로 막대, `vertical` = 가로 막대). `MoneyText`는 `compact`일 때 원래 금액을 `title`로 둔다. `seriesColor`는 7번째 계열부터 회색을 준다(돌려 쓰지 않는다).
    - 프로필 저장에 성공하면 모든 쿼리를 무효화한다(나이대가 바뀌면 다른 모듈 결과도 바뀐다). 온보딩 닉네임은 앞뒤 공백을 걷고 빈 값이면 `null`로 보낸다. 출생연도 미선택 문구는 "출생연도를 선택해 주세요."다.
    - 쿼리 기본값: `staleTime` 30초, 4xx는 재시도하지 않고 그 밖에는 1회, 창 포커스 재요청 끔. `useAiStatus`는 5분.

#### 다음 작업이 쓰는 법

- API: `features/<module>/api.ts`에서 `apiFetch<T>(path, init)`를 부르고 `hooks.ts`에서 TanStack Query 훅으로 감싼다. 폼 서버 에러는 `toSubmitErrors(error, FIELDS, { codeToField })` → `applyFieldErrors(form.setError, …)`, 남는 문구는 `FormAlert`처럼 폼 위에 둔다.
- 차트 색: 자산군은 `assetColor("stock")`, 그 밖의 계열은 `seriesColor(0..5)`.
- 테스트: `renderWithProviders(<Page />, { route: "/ledger?month=2026-10", auth: authPayload() })` 후 `server.use(http.get(apiUrl("/api/..."), …))`. 이동은 돌려받은 `router.push`·`router.replace`(vi.fn)나 `memoryRouter.pathname`으로 확인한다. 처리하지 않은 요청은 테스트 실패다.

#### 남은 일

- 두 브랜치를 합친 실제 흐름은 로드맵의 웨이브 1 통합 검증에서 다시 확인한다(위 브라우저 흐름은 사전 확인이다).
- 다른 API 호출 중 세션이 만료되면(401) 해당 화면은 오류 상태만 보여 주고 로그인 화면으로 자동 이동하지 않는다. 필요하면 공통 처리(쿼리 캐시의 401 감지 → `refresh()`)를 추가한다.
- 테마 전환 UI, 로그인 시도 제한 안내는 범위 밖이다. `npm audit`의 high 9건은 create-next-app·shadcn 의존성에서 온 것이라 이번 범위에서 손대지 않았다.

#### 검증 지적 수정(1차 검증, PR #2 코멘트)

1. 중요 — 제어문자가 든 `next`로 외부 이동: `getSafeRedirectPath(next, origin = window.location.origin)`가 제어문자(U+0000~U+001F, U+007F)가 있거나, `/`로 시작하지 않거나, `//`·`/\`로 시작하는 값을 거절한다. 퍼센트 인코딩을 한 번 푼 값도 같은 기준으로 보고(잘못된 인코딩은 거절), URL로 해석·정규화한 뒤 origin이 현재 사이트와 같을 때만 `pathname + search + hash`를 돌려준다. 그 밖에는 `/`다. 사용처는 `LoginForm` 한 곳이고 그대로 이 함수를 거친다(`RequireAuth`는 `getLoginPath`로 next를 만들기만 한다).
   - 테스트: `tests/foundation/redirect.test.ts`(정상 6건, 거절 24건 + null·undefined: LF·CR·탭·NUL·US·DEL, `%0A`·`%0D`·`%09`·`%2F`·`%5C`·잘못된 인코딩, `//`, `/\`, 절대 URL(같은 사이트 절대 URL도 `/`로 시작하지 않아 거절), `javascript:`·대소문자 섞은 `javascript:`, `data:`, 상대 경로, 앞 공백, 빈 값), `auth-forms.test.tsx` LoginForm에 `/\n/…`·`/\r/…`·`/\t/…`·`javascript:` 케이스 추가. 헤드리스 Chrome으로 `/login?next=%2F%0A%2Fverify.invalid`(CR·탭 포함)를 다시 밟아 `/`로 가는 것을 확인했다.
2. 경미 — 토스트 접근성 문구: `components/ui/sonner.tsx`에서 sonner 2.0.8 공식 옵션 `containerAriaLabel="알림"`(영역 이름 "알림 alt+T", 단축키 표시는 sonner가 붙인다)과 `toastOptions.closeButtonAriaLabel="알림 닫기"`를 기본값으로 둔다. 테스트: `common-components.test.tsx`의 Toaster 케이스.

#### 검증 지적 수정(2차 검증, PR #2 코멘트)

1. 중요 — 정규화된 `next`가 `//`로 시작해 외부 이동: `/.//verify.invalid`, `/a/..//verify.invalid`, `/%2e//verify.invalid`, `/.\/verify.invalid`는 들어온 값 검사를 통과했지만 URL 정규화(점 구간 `.`·`..`·`%2e` 제거, `\` → `/`)가 `//verify.invalid`를 만들었다. `getSafeRedirectPath`가 이제 돌려줄 최종 값도 검사한다. (a) 들어온 값과 같은 위험 검사(제어문자, `//`·`/\` 시작, 한 번 디코딩한 값 포함)를 다시 적용하고, (b) 그 값을 `new URL(result, origin)`으로 다시 해석해 origin이 같고 다시 만든 `pathname + search + hash`가 똑같을 때(고정점)만 돌려준다. 하나라도 어기면 `/`다. 사용처 `LoginForm`은 그대로다.
   - 테스트(`redirect.test.ts`): 검증 코멘트의 4건과 `/%2e%2e//…`, `/.\/…`, `/a/../..//…`, `/./%2e//…`, `/.%2e//…`, `/%2F/…`, `/%5C…` → `/`. 성질 테스트: 구간 후보 11개(`.`, `..`, `%2e`, `%2E`, `%2e%2e`, `.%2e`, 빈 문자열, `a`, `\`, `%5c`, `%2f`)를 깊이 1~4로 조합한 16,104개 × 앞에 `/` 있음·없음 = 32,208개 입력 뒤에 `/evil.example/x`를 붙여, 결과가 `/`로 시작하고 `//`·`/\`로 시작하지 않으며 같은 origin이고 다시 넣어도 같은 값인지 확인한다(이전 코드는 2,925개가 외부로 나갔고 지금은 0개). 정상 경로 `/allocation?x=1#a`, `/learn/per`, `/stocks/005930`, `/settings/profile`는 그대로다. 정규화 뒤 같은 사이트 경로로 남는 값(`/a/.\./\evil…` → `/a//evil…`)은 그 경로로 보낸다. `auth-forms.test.tsx` LoginForm에 검증 코멘트의 4건 추가.
   - 헤드리스 Chrome에서 `/login?next=` 뒤에 위 4건(인코딩해서)을 붙여 로그인하면 모두 `http://localhost:3001/`로, `/allocation?x=1#a`는 그대로 이동한다.

### 웨이브 3 통합 재검증 수정(K5)

#### 구현한 것

- 원인: 공용 숨김 표 `ChartDataTable`(`components/charts/ChartParts.tsx`)이 `<table className="sr-only">`였다. 표 상자는 `sr-only`의 `height: 1px`를 최소 높이로만 쓰고 `overflow: hidden`도 적용되지 않아, 절대 위치인 채로 행 수만큼 높아져 문서의 스크롤 높이를 늘렸다(가로 넘침은 `white-space: nowrap`·1px 너비로 문제없었다).
- 수정: `sr-only`를 감싸는 `<div>`에 걸고 표는 그 안에 클래스 없이 둔다. 블록 컨테이너라 1px 높이와 `overflow: hidden`이 그대로 적용되어 표가 문서 높이에 영향을 주지 않는다. 표의 caption·thead·tbody, `scope`, 차트의 `role="img"`·`aria-label`·범례·색은 바꾸지 않았다. `LineChart`·`BarChart`·`DonutChart`가 모두 이 컴포넌트를 쓰므로 세 차트에 함께 반영된다.
- 테스트(`tests/foundation/charts.test.tsx`): 숨김 표 헬퍼가 표 자체가 아니라 감싸는 `div`에 `sr-only`가 있는지 확인하도록 바꿨고, 262행 `LineChart` 회귀 테스트를 더했다(표가 `sr-only` 블록 안에 있고 표 자체에는 `sr-only`가 없음, caption 이름으로 찾는 `table`, 열·행 머리글, 셀 값, 그림 밖에 있음). 이전 코드에서는 숨김 표 테스트 4개가 실패하고 수정 후 통과한다.

#### 검사 결과

- `npm run lint` 통과, `npx tsc --noEmit` 통과, `npm run test` 44 files / 436 tests 통과, `npm run build` 통과.
- 실제 서버(`scripts/start.sh`, 슬롯 01)와 `market.jobs seed-mock` 후, 독립 헤드리스 Chrome 브라우저 컨텍스트에서 새 테스트 사용자로 UI 로그인해 높이 900px로 쟀다(자산배분·가계부 데이터는 API로 미리 넣음). `documentElement.scrollHeight`와 `main` 끝(문서 좌표):

| 화면 | 폭 | 수정 전 scrollHeight / main 끝 | 수정 후 scrollHeight / main 끝 |
| --- | --- | --- | --- |
| `/stocks/069500` 3개월(67행) | 360 | 2,228 / 1,108.5 | 1,109 / 1,108.5 |
| `/stocks/069500` 1년(262행) | 360 | 6,908 / 1,108.5 | 1,109 / 1,108.5 |
| `/stocks/005930` 1년(262행) | 360 | 6,908 / 1,056.5 | 1,057 / 1,056.5 |
| `/allocation` 리포트(도넛 2개) | 360 | 2,090 / 2,089.5 | 2,090 / 2,089.5 |
| `/ledger?month=2026-10` 요약(차트 3개) | 360 | 3,888 / 3,888 | 3,888 / 3,888 |
| `/stocks/069500` 3개월 | 1280 | 2,192 / 900 | 900 / 900 |
| `/stocks/069500` 1년 | 1280 | 6,872 / 900 | 900 / 900 |
| `/stocks/005930` 1년 | 1280 | 6,872 / 900 | 900 / 900 |
| `/allocation` 리포트 | 1280 | 1,481 / 1,480.5 | 1,481 / 1,480.5 |
| `/ledger?month=2026-10` 요약 | 1280 | 3,100 / 3,100 | 3,100 / 3,100 |

- 수정 후 모든 화면에서 빈 세로 영역이 없고(차이 0~1px), 가로 넘침이 없으며, 숨김 표를 감싼 블록의 높이는 1px다. 행이 적은 `/allocation`·`/ledger`는 원래 표가 본문 안에서 끝나 수치가 같다. Chrome 접근성 트리에서 1년 차트의 표가 caption 이름("KODEX 200 종가 추이(1년)", "삼성전자 종가 추이(1년)")과 행 262개로 수정 전과 같게 노출된다.

#### 스펙과 다른 점과 이유

- 없음. 11.1의 "같은 데이터의 숨김 표(`sr-only`)"를 `sr-only` 블록 안의 표로 지킨다. 의존성 추가 없음.

#### 남은 일

- 코디네이터의 별도 검증과 PR 병합.

### 웨이브 4 통합 검증 수정

- 경미 F2: `format_krw_compact`의 억 단위 정수부에 천 단위 쉼표를 넣었다. 소수 첫째 자리 `ROUND_HALF_UP`, `.0` 생략, 음수 부호와 만·원 단위 규칙은 유지한다.
- `tests/foundation/test_core.py`의 `test_format_compact`에 `1275600000000` → `12,756억원`, `123456789012` → `1,234.6억원`을 추가했다. 기존 음수 검사로 두 값의 음수도 확인한다. 수정 전에는 새 예시 2개가 실패했고 수정 후에는 통과한다.
- 코디네이터가 허용한 범위에서 챗봇 `tools/common.py`의 억 단위 보정 정규식과 `re` import를 제거했다. `krw_compact`는 `None` 처리 후 공용 함수 결과를 그대로 반환하며 기존 챗봇 카드 기대값은 유지한다. 프론트는 수정하지 않았다.
- 검사: `scripts/worktree-setup.sh` 성공(슬롯 01), 백엔드 `uv run ruff check .`·`uv run ruff format --check .` 통과, `uv run pytest` 전체 **1,357개 통과**(기존 Starlette 경고 1건). 실제 외부 API·LLM 호출 없음.
- 실제 서버: `scripts/start.sh backend`로 슬롯 01 서버를 띄우고 검증 전용 사용자로 가입·프로필·투자성향·자산을 입력했다. `GET /api/allocation/recommendation`이 200으로 `장기 투자 몫: 12,756억원`과 대출 안내의 `1,234.6억원`을 반환했다. 검증 데이터는 삭제하고 `scripts/stop.sh`로 서버를 종료했다.
- 스펙과 다른 점·의존성 추가: 없음. 남은 일: 코디네이터의 별도 검증과 PR 병합.
