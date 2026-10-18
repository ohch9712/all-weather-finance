# 프로젝트 설명

개인 자산배분 금융 플랫폼이다. 나이대(20~60대)·투자성향·상황·목표에 맞는 권장 자산배분과 관리 방향을 이유와 함께 보여 주고, 사용자가 입력한 보유 자산이 권장 배분과 얼마나 맞는지 점수로 보여 준다. 젊을수록 공격적으로, 나이가 들수록 방어적으로 배분한다. 자산군은 주식, 채권, 금, 현금성 자산, 기타다.

주요 기능

- 핵심 흐름: 가입 시 정보 입력(출생연도 → 증권사 방식 투자성향 설문 → 목표·상황 → 자산 간단 입력) → 추천 결과 → 상세 설명.
- 목표 반영 권장 배분(비상금 → 3년 안 목표 자금 → 나이대·성향 표 비중의 장기 투자), 자산 현황·상황·목표에 맞는 관리 방향(먼저 할 일)과 추천 이유.
- 보유 자산 입력과 배분 일치 점수·등급·리밸런싱 안내(흥미 유도용 점수 이력 포함).
- 가계부: 수입·지출 수동 입력, 카드 이용내역 파일 업로드 자동 기록.
- 주식 매매일지: 파일 업로드와 수동 입력, 증권사 체결 동기화.
- 관심종목, AI 챗봇에게 자연어로 말하는 종목 조건검색(키움·토스 API 데이터 기반).
- 자녀 상속·증여 플래너: 증여재산공제(10년 합산)·혼인출산 공제를 반영한 세금 계산과 분산 증여 일정, 가족 구성·자산 정보로 상속·증여 방향(증여 없이 상속, 분산 증여, 일시 증여, 손자녀 증여)을 비교하는 참고 화면.
- 주린이를 위한 주식 용어·글·영상 학습 게시판.
- 위 데이터를 도구로 쓰는 AI 챗봇 에이전트(개인 데이터를 다루므로 기본은 로컬 LLM).
- 가능한 범위의 자동 수집(CODEF 데모, 마이데이터는 허가 사업자 전용이라 스텁).

이 서비스는 정보 제공과 학습 도구다. 주문·매매 실행 기능은 만들지 않는다.

# 문서 지도

| 문서 | 내용 | 수정 권한 |
| --- | --- | --- |
| `docs/specs/00-master-plan.md` | 최상위 설계 결정, 외부 제약, 작업 분해, 조사 출처 | 코디네이터 |
| `docs/architecture.md` | 모듈 경계, 경로·테이블·revision ID·서비스 함수·에러 코드, 외부 연동 구조 | 코디네이터 |
| `docs/roadmap.md` | 웨이브, 브랜치·워크트리, 구현→검증→병합 절차, 워커 task spec | 코디네이터 |
| `docs/specs/NN-*.md` | 작업별 계약(범위, DB, API, 화면, 완료 기준, 검증 체크리스트) | 각 작업은 자기 스펙의 "구현 결과" 절만 추가 |
| `AGENTS.md` | 이 문서. 모든 워커 공통 규칙 | 코디네이터 |

문서끼리 어긋나면 `00-master-plan.md` → `architecture.md` → 작업 스펙 순서로 따른다. 어긋남을 발견하면 임의로 고르지 말고 코디네이터에게 묻는다.

# 프로젝트 기술 구조

| 영역 | 기술 |
| --- | --- |
| Frontend | Next.js 16(App Router) + TypeScript(strict) + Tailwind CSS 4 + shadcn/ui, TanStack Query, react-hook-form + zod, Recharts, react-markdown |
| Backend | FastAPI + Python 3.12+(uv), SQLAlchemy 2.0(동기), Alembic, Pydantic 2, pydantic-settings |
| Database | Postgres 17(로컬은 루트 `compose.yaml`, 호스트 포트 5433) |
| AI | 데이터 등급별 공급자. 개인 데이터가 없는 작업은 Gemini API(`google-genai`, `gemini-3.8-flash`), 개인 금융 데이터(챗봇·업로드 파일 처리)는 로컬 Ollama(`ollama`, `gemma4:12b`). 환경변수로 교체한다(architecture 9.1) |
| 외부 데이터 | 키움 REST API, 토스증권 Open API, CODEF(모두 조회 전용 어댑터, 기본은 Mock) |
| 테스트 | pytest(+ respx), Vitest + Testing Library + MSW |
| 배포 | 서울 리전 VPS 한 대 + Docker Compose(Caddy, frontend, backend, postgres, 배치 cron). VPS 고정 공인 IP가 증권사 API 허용 IP다. 운영의 personal 등급 LLM은 결제 연결 Gemini(작업 18) |

## 프로젝트 디렉토리 구조

```
frontend/
  ├── src/
  │    ├── app/          # (auth)/, (app)/<route>/
  │    ├── components/   # ui/, layout/, charts/, common/
  │    ├── features/     # <module>/ (api.ts, types.ts, hooks.ts, components/)
  │    ├── lib/          # api-client, format, navigation, domain, query
  │    └── types/
  └── tests/             # setup.ts, foundation/, <module>/
backend/
  ├── app/
  │    ├── main.py
  │    ├── core/         # config, errors, schemas, security, cookies, cors, crypto, time, logging, domain
  │    ├── db/           # base, session, models
  │    ├── api/          # router, deps, health
  │    ├── integrations/ # llm/, brokers/, codef/
  │    └── modules/      # <module>/ (router, schemas, service, repository, models)
  ├── alembic/versions/  # <module>_NNNN_*.py
  └── tests/             # conftest.py, foundation/, <module>/
scripts/                 # worktree-setup.sh, start.sh, stop.sh
docs/                    # architecture.md, roadmap.md, specs/
```

모듈 목록과 경로별 소유 작업은 `docs/architecture.md` 3절이 기준이다.

# 작업 방식

- 이 프로젝트는 Orca 오케스트레이션으로 여러 워커가 동시에 개발한다. 작업 하나 = 브랜치 하나 = 워크트리 하나다.
- **작업 스펙이 유일한 계약이다.** 다른 워커와 직접 대화하지 않는다. 스펙에 적힌 경로·JSON 필드·상태코드·에러 코드·테이블·revision ID·서비스 함수 시그니처를 그대로 따른다.
- 스펙에 없는 세부 사항은 자기 소유 범위 안에서 가장 단순한 방식으로 정하고, 스펙의 "구현 결과" 절에 적는다.
- 스펙이 모호하거나 공유 파일을 고쳐야 하거나 의존성을 추가해야 하면, 디스패치 preamble의 `ask` 명령으로 코디네이터에게 묻고 답을 기다린다. 로컬 질문 UI를 띄우지 않는다.
- 디스패치된 워커는 주입된 preamble(Task ID, Dispatch ID, heartbeat, `check`, `worker_done`)을 그대로 따른다. `worker_done`은 한 번만, 결과(`--outcome succeeded|failed`)를 명시해서 보낸다.

## 파일 소유권

1. 워커는 자기 작업 스펙의 "소유 파일" 절에 있는 경로만 만들고 고친다. 보통 자기 모듈 디렉터리, 자기 페이지 경로, 자기 테스트 디렉터리, 자기 revision 파일, 자기 스펙의 "구현 결과" 절이다.
2. 공유 파일(`backend/app/{main.py,core,db,api}`, `backend/app/integrations/llm`, `backend/pyproject.toml`, `uv.lock`, `frontend/package.json`, `package-lock.json`, `frontend/src/{app/layout.tsx,app/providers.tsx,app/(app)/layout.tsx,components,lib,types}`, `scripts/`, `compose.yaml`, `orca.yaml`, `docs/`의 다른 문서)은 01a·01b 외에는 고치지 않는다. 고쳐야 하면 `ask`로 묻는다.
3. 다른 모듈의 코드는 `docs/architecture.md` 8절의 공개 서비스 함수로만 쓴다. 다른 모듈의 `repository`·`models`·`router`·프론트 내부 컴포넌트를 import하지 않는다. 프론트에서 다른 모듈 데이터가 필요하면 그 모듈의 API를 자기 `features/<module>/api.ts`에서 호출한다.
4. 다른 모듈 테이블에 FK를 걸지 않는다. FK는 `users.id`에만 건다.

## 의존성

- 필요한 패키지는 01a(백엔드)와 01b(프론트)가 미리 설치한다. 다른 작업은 `pyproject.toml`·`package.json`을 고치지 않는다.
- 꼭 필요한 패키지가 없으면 `ask`로 패키지 이름과 이유를 묻는다. 코디네이터가 develop에 추가한 뒤 알려 준다.

## 마이그레이션

- 모듈마다 Alembic 브랜치를 둔다. revision ID는 스펙에 적힌 값을 쓴다. 적용은 항상 `uv run alembic upgrade heads`다.
- 명령과 규칙은 `docs/architecture.md` 7절을 따른다. 다른 모듈 테이블을 건드리는 revision은 만들지 않는다.
- 빈 DB에서 `upgrade heads` → `downgrade base` → `upgrade heads`가 성공해야 한다.

# 코드 규칙

## 공통

- API 규약(camelCase, 정수 원 금액, 문자열 decimal, 날짜·시각 형식, 페이지네이션, 에러 형식)은 `docs/architecture.md` 4절을 따른다.
- 화면 문구, 에러 메시지, 주석은 한국어로 쓴다. 식별자는 영어로 쓴다.
- 비밀값을 코드·테스트·로그·커밋에 넣지 않는다. `.env`, `.env.local`은 커밋하지 않는다.

## 백엔드

- 모듈 내부는 `router → service → repository → models` 방향으로만 호출한다. 라우터는 얇게 두고 도메인 로직은 `service.py`에 둔다.
- 요청·응답 모델은 `app.core.schemas.CamelModel`을 상속한다. 에러는 `app.core.errors.AppError(status, code, message)`로 던진다.
- 인증이 필요한 엔드포인트는 `CurrentUser`, 관리자 전용은 `AdminUser` 의존성을 쓴다. 모든 쿼리를 `user_id`로 거른다.
- 시간은 `app.core.time.now_utc()`/`today_kst()`를 쓴다. 테스트에서 시간을 고정할 수 있어야 한다.
- 린트·포맷은 ruff(`uv run ruff check .`, `uv run ruff format .`)다.

## 프론트엔드

- Next.js 16은 학습 데이터와 다르다. 코드를 쓰기 전에 `frontend/node_modules/next/dist/docs/`의 관련 가이드를 읽고 deprecation 안내를 따른다.
- 화면 컴포넌트는 `fetch`를 직접 쓰지 않는다. `features/<module>/api.ts`(내부에서 `lib/api-client.ts`의 `apiFetch`)와 `hooks.ts`의 TanStack Query 훅을 거친다.
- 공용 컴포넌트(`components/ui`, `components/common`, `components/charts`)와 형식 함수(`lib/format.ts`)를 먼저 쓴다. 자산군 색은 `globals.css`의 `--asset-*` 토큰만 쓴다.
- 고지 문구는 `Disclaimer` 컴포넌트의 variant(`investment`, `tax`, `sample`, `ai`)로 붙인다.
- 360px부터 1280px까지 가로 스크롤 없이 보여야 한다.

# AI·외부 API 규칙

- LLM 호출은 `app.integrations.llm` 계층만 거친다. 구조화 출력은 `StructuredLLM`(`get_structured_llm` 의존성), 챗봇은 09의 공급자 어댑터를 쓴다. 호출 형태는 `docs/architecture.md` 9.1·11절에 고정돼 있다. SDK 사용법을 추측하지 않는다. 없는 내용은 설치된 패키지 소스를 확인하고 `ask`로 묻는다.
- **개인 금융 데이터(거래·자산·가족 정보, 업로드 파일 내용, 챗봇 대화)는 personal 등급 작업으로만 보낸다.** personal은 기본 로컬 Ollama이고, 결제가 연결된 Gemini 키(`GEMINI_BILLING_ENABLED=true`)일 때만 Gemini로 갈 수 있다. 다른 공급자로 자동 전환하지 않는다. Gemini 호출은 항상 `store=False`다.
- 모델 이름은 설정값(`GEMINI_MODEL`, `OLLAMA_MODEL`)만 쓴다. 코드에 모델 이름을 새로 하드코딩하지 않는다. effort·max_tokens·데이터 등급은 작업 등록부(architecture 9.1.2)가 정한다. 강제 도구 호출은 쓰지 않는다.
- 거절(Gemini 안전 차단)과 잘림(Gemini `status: "incomplete"`, Ollama `done_reason: "length"`)을 먼저 확인한 뒤 내용을 읽는다.
- 테스트는 실제 Gemini·Ollama·증권사·CODEF를 부르지 않는다. `FakeStructuredLLM`, 가짜 공급자·가짜 SDK 클라이언트, `MockBroker`, `respx`를 쓴다.
- 증권사 연동은 조회 전용이다. 주문·정정·취소 API를 구현하지 않는다.
- 외부 API의 api-id·경로·필드는 공식 문서에서 확인한 것만 쓰고 코드 주석에 출처를 남긴다. 확인하지 못한 기능은 `BROKER_NOT_SUPPORTED`로 둔다.
- 카드사·증권사 내보내기 파일 형식을 지어내지 않는다. 실제 샘플이 없으면 범용 헤더 탐지와 LLM 매핑만 만든다.

# 보안·고지

- **저장소는 공개(public)다.** 커밋, PR 제목·본문, PR 코멘트(검증 보고서 포함), `worker_done` 요약, `ask` 메시지에 비밀값(API 키, 앱키·시크릿, 계좌번호 원문, `APP_ENCRYPTION_KEY`, 세션 토큰)을 쓰지 않는다. `.env`·`.env.local` 내용을 출력하지 않고(`cat` 등), 환경변수 전체를 출력하지 않는다(`env`, `printenv`, `set`). 명령 출력을 붙일 때 비밀값이 섞이지 않았는지 확인한다.
- 실제 API 키는 기본 체크아웃의 `backend/.env`에만 있다. 워크트리의 `.env`는 `scripts/worktree-setup.sh`가 예시 파일에서 만들어 키가 없다. 실제 키로 외부 API를 부르는 확인은 코디네이터가 지시할 때만 한다.
- 로컬 pre-commit hook(모든 워크트리 공유)과 GitHub push protection이 `.env` 파일과 비밀값 커밋을 막는다. hook을 우회(`--no-verify`)하지 않는다. 막히면 값을 지우고 다시 커밋한다.
- 자격증명은 `app.core.crypto`로 암호화해 저장하고 응답에는 끝 4자리만 보낸다.
- 업로드 파일은 디스크에 저장하지 않는다.
- 다른 사용자 자원에 접근하면 404다. 테스트로 확인한다.
- 자산배분·종목 화면에는 `investment`, 세금 화면에는 `tax`, Mock 데이터에는 `sample`, AI 응답에는 `ai` 고지를 붙인다.
- AI를 쓰는 화면은 `AiProviderBadge`(01b)로 데이터가 처리되는 곳(로컬 AI·Google Gemini)을 보여 준다. 관리 방향·추천 이유는 자산군 단위로만 말하고 특정 상품·종목을 권하지 않는다.

# 브랜치·커밋·PR

- 브랜치: `main`(릴리스) ← `develop`(통합) ← `feature/<NN>-<slug>`(작업, 스펙 번호와 같음). 작업 브랜치는 항상 그 시점의 `develop`에서 만든다.
- 작업을 시작하면 먼저 `scripts/worktree-setup.sh`를 실행한다(Orca가 setup으로 이미 실행했다면 다시 실행해도 안전하다).
- 커밋 메시지는 한국어 한 줄 요약으로 쓴다(예: `자산배분 점수 계산과 리밸런싱 금액 추가`). 작은 단위로 자주 커밋한다.
- 원격(`origin`)은 HTTPS이고 gh 자격 증명을 쓴다. `gh auth status`가 로그인 상태면 `git push`가 된다.
- 완료 기준을 모두 통과하면 푸시하고 `gh pr create --base develop`으로 PR을 연다.
  - 제목: `[NN] <작업 제목>`
  - 본문: 요약, 스펙 링크, 완료 기준 체크 결과(실행한 명령과 결과), 변경 경로 요약, 스펙과 다르게 한 점, 남은 일
- PR 병합은 코디네이터가 검증 통과 후 `gh pr merge --merge`로 한다. 워커는 병합하지 않는다.

# 실행·테스트 명령

```bash
# 워크트리 준비(포트·DB 슬롯, .env, 의존성, 마이그레이션)
scripts/worktree-setup.sh

# 공용 Postgres
docker compose up -d postgres

# 서버
scripts/start.sh            # backend + frontend, 슬롯 포트로 기동
scripts/stop.sh

# 백엔드
cd backend
uv run alembic upgrade heads
uv run ruff check . && uv run ruff format --check .
uv run pytest

# 프론트
cd frontend
npm run lint
npx tsc --noEmit
npm run test
npm run build
```

# 공통 완료 기준

모든 작업은 자기 스펙의 완료 기준과 함께 아래를 만족해야 한다.

- [ ] 백엔드를 바꿨다면 `ruff check`, `ruff format --check`, `pytest`가 통과한다.
- [ ] 프론트를 바꿨다면 `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`가 통과한다.
- [ ] 마이그레이션을 추가했다면 빈 DB에서 `upgrade heads` → `downgrade base` → `upgrade heads`가 성공한다.
- [ ] `git diff --name-only develop...HEAD`의 모든 경로가 스펙의 소유 파일 안에 있다.
- [ ] 테스트가 실제 외부 API를 호출하지 않는다.
- [ ] 사용자 소유 자원마다 "다른 사용자 접근 시 404" 테스트가 있다.
- [ ] 새 화면이 360px에서 가로 스크롤 없이 보이고, 필요한 고지가 붙어 있다.
- [ ] 자기 스펙 끝에 `## 구현 결과` 절을 추가했다(구현한 것, 스펙과 다른 점과 이유, 남은 일).

# 검증 워커 규칙

- 구현이 끝난 모든 작업은 별도 검증 작업으로 확인한다. 검증 워커는 codex, 모델 `gpt-6.1-sol`, effort `xhigh`로 띄운다.
- 검증 워커는 **저장소의 추적 파일을 고치지 않는다.** 임시 파일은 저장소 밖(`$TMPDIR`)에만 만든다. 커밋·푸시·병합하지 않는다.
- 검증 범위
  1. `scripts/worktree-setup.sh` 후 공통 완료 기준의 모든 명령을 다시 실행한다.
  2. 별도 빈 DB(`finance_NN_verify`)를 만들어 마이그레이션 순환을 확인하고 끝나면 지운다.
  3. 서버를 띄워 스펙의 API 계약(경로, 필드, 상태코드, 에러 코드)을 실제 요청으로 대조한다.
  4. 소유 경로 위반, 비밀값 노출, 사용자 격리, 고지 누락, 외부 API 호출 여부를 점검한다.
  5. 스펙의 "검증 체크리스트"를 하나씩 판정한다.
- 결과는 `gh pr comment <PR 번호>`로 남긴다. 같은 계정의 PR은 승인(approve)할 수 없으므로 코멘트로 보고한다. 형식:
  - 판정: 통과 / 실패
  - 실행한 명령과 결과 요약
  - 체크리스트 판정표
  - 발견 사항: 심각도(차단/중요/경미), 위치(`파일:줄`), 재현 방법, 기대와 실제
- 통과면 `worker_done --outcome succeeded`, 실패면 발견 사항을 요약해 `--outcome failed`로 끝낸다. 차단·중요 발견 사항이 하나라도 있으면 실패다.

# 설계문서 저장

- `docs/specs` 디렉토리 안에 구현 단계별로 순번을 붙여 md 파일로 저장한다. `00`은 마스터 설계 계획이다.
- 각 작업은 구현을 마치면 자기 스펙 끝에 `## 구현 결과` 절을 추가한다. 스펙의 다른 절은 고치지 않는다(바꿔야 하면 코디네이터에게 묻는다).
