# 배포 구성 로컬 리허설 결과

검사일: 2026-10-18 KST. 대상: 스펙 18의 서울 VPS 운영 Compose 구성. macOS Docker Desktop의 Linux arm64 컨테이너에서 실행했다. 실제 VPS·DNS·실제 API 키·증권사 허용 IP는 다루지 않았다.

## 실행 조건

- Compose 프로젝트 이름 `finance18-rehearsal`, `DOMAIN=localhost`, Caddy 내부 인증서, TCP 80·443 사용.
- 임시 디렉터리에 신규 DB 비밀번호·Fernet 키·가입 비밀번호를 만들고 파일 권한 600을 적용했다. 저장소와 이미지 빌드 인자에는 넣지 않았다.
- `LLM_GENERAL_PROVIDER=disabled`, `LLM_PERSONAL_PROVIDER=disabled`, `GEMINI_BILLING_ENABLED=false`, 모든 외부 API 키는 빈 값, `MARKET_DATA_PROVIDER=mock`.
- 기존 개발 서버 8000·3000과 루트 Compose의 Postgres 5433은 중지·변경하지 않았다.
- 브라우저는 Playwright CLI의 별도 `finance18` 세션(독립 Chrome 컨텍스트, `ignoreHTTPSErrors=true`)을 사용했다. 사용자 브라우저 프로필은 쓰지 않았다.

## 자동 검사

| 명령 | 결과 |
| --- | --- |
| `scripts/worktree-setup.sh` | 슬롯 18, 8018·3018·finance_18 준비 성공 |
| `cd backend && uv run ruff check .` | 통과 |
| `cd backend && uv run ruff format --check .` | 302개 파일 통과 |
| `cd backend && uv run pytest` | 1,396개 통과(기존 TestClient deprecation 경고 1개) |
| `cd backend && uv run pytest tests/imports/test_purge_expired.py -q` | 3개 통과 |
| `cd frontend && npm run lint` | 통과 |
| `cd frontend && npx tsc --noEmit` | 통과 |
| `cd frontend && npm run test` | 47개 파일·482개 테스트 통과 |
| `cd frontend && npm run build` | standalone 빌드 통과 |
| `docker compose -p finance18-rehearsal -f deploy/compose.prod.yaml --env-file <임시_env> config --quiet` | 통과 |
| 같은 Compose의 `build`, `up -d` | 이미지 3종 빌드·기동 성공 |
| `bash -n deploy/backup.sh deploy/restore.sh`, `sh -n deploy/postgres/init-app.sh` | 통과 |
| `git diff --check` | 통과 |

Zod jitless 변경 후 프론트 lint·타입·테스트·빌드와 Compose 이미지 빌드를 모두 다시 실행해 통과했다. 백엔드 테스트는 실제 외부 HTTP를 금지하는 기존 픽스처를 사용한다. 마이그레이션 파일은 추가하지 않았다.

## 운영 경로 확인

| 항목 | 확인 결과 |
| --- | --- |
| 초기화·계정 분리 | 빈 리허설 DB 볼륨에서 앱 역할 생성과 기본 CRUD 권한 설정 성공. 앱에 마이그레이션 URL을 전달하지 않음 |
| 기동 순서 | Postgres healthy → migrate Exit 0 → backend·cron 시작 → 앱 healthcheck 통과 후 Caddy 시작 |
| 마이그레이션 재실행 | `up -d`를 다시 실행하기 전후 migrate 로그의 `Running upgrade` 건수가 같아 이미 적용한 revision 중복 적용 없음 |
| 라우팅·TLS | `curl -k https://localhost/api/health` 200 JSON, `/login`·화면 경로 200 HTML |
| 쿠키 | 가입·로그인 뒤 `finance_session`의 Secure=true·HttpOnly=true·SameSite=Lax 확인. 값은 기록하지 않음 |
| 인증·온보딩 | 브라우저 가입 → 출생연도 → 6문항 설문 → 생활비 → 현금·주식 보유 입력 → 추천 결과·점수 화면 성공 |
| 폼 검증 | 최종 이미지에서 가입·로그인의 빈 필드 오류와 정상 제출, 가계부 금액·카테고리 필수 오류 및 12,000원 지출 저장 성공 |
| 보안 헤더 | HSTS 31536000, nosniff, Referrer-Policy, DENY, Permissions-Policy, 스펙의 CSP 전체를 API·HTML에서 확인 |
| 화면·CSP | 추천·자산배분·가계부·학습·학습 영상 5개 경로를 각 360·1280px에서 열어 총 10회 HTTP 200, 가로 스크롤 없음, `securitypolicyviolation` 0건. 영상의 youtube-nocookie iframe 플레이어 로드 확인 |
| 콘솔 | 최종 로그인 상태의 핵심 화면·영상에서 오류·경고 0건. 비로그인 화면의 인증 확인 `/api/auth/me` 401은 정상 인증 흐름이며 CSP 오류가 아님 |
| 로그인 제한 | Caddy만 재시작해 제한 창을 초기화한 뒤 같은 IP의 잘못된 로그인 1~10회는 401, 11회는 429, 양수 Retry-After 확인 |
| 배치 문법 | `cron` 컨테이너에서 `supercronic -test /app/deploy/crontab` 통과, TZ=Asia/Seoul 확인 |
| 배치 실행 | `refresh-stocks` 90건, `refresh-snapshot --resume` 90건 성공·실패 0, `prune-snapshots --keep-days 30` 0건 삭제, `imports.jobs purge-expired` 숫자 0 출력. 모두 종료 코드 0 |
| 배치 실패 격리 | 컨테이너 임시 일정에서 `exit 7`의 오류 로그 뒤에도 다음 반복과 다른 일정의 성공 로그가 이어지는 것을 확인 |
| 만료 임포트 | 두 사용자의 만료·현재 시각 경계 작업만 2건 삭제, 1마이크로초 뒤 만료 작업 유지, 반복 시 0건, CLI 커밋·숫자만 출력·실패 전파 테스트 통과 |
| 백업 | `FINANCE_ENV_FILE=<임시_env> FINANCE_BACKUP_DIR=<임시_백업> deploy/backup.sh` 성공. 7일 지난 테스트 덤프 삭제 확인 |
| 새 DB 복구 | `createdb finance18_restore` → `deploy/restore.sh <덤프> finance18_restore` 성공. 두 DB URL을 임시 복구 env에서 새 DB로 바꿔 앱 재기동 후 기존 리허설 사용자 로그인 200·출생연도 복구 확인 |
| 관리자·시드 | `auth.cli make-admin` 성공, `learn.seed` 게시물 35개 생성. 관리자 API로 임시 영상 글 생성해 화면 확인 |
| AI 상태 | `/api/ai/status`의 두 등급 모두 enabled=false·reason=not_configured 확인. 실제 Gemini·Ollama 호출 없음 |
| 포트 | Compose를 JSON으로 읽어 caddy의 TCP 80·443만 published임을 확인. frontend·backend·postgres는 내부 포트만 노출 |
| 이미지·시크릿 | 최종 backend·frontend·caddy 이미지 모두 사용자 app(uid 10001). `docker history --no-trunc`와 저장소 diff에 생성한 비밀값 없음, `/app`·`/home`에서 `.env*`·앱 테스트 디렉터리 없음 |

## 구현 중 조정

Zod 4가 JIT 지원을 탐지하려고 `Function("")`을 호출하면서 CSP eval 차단 이벤트를 냈다. 코디네이터가 스펙 5절의 소유 경로에 `frontend/src/app/providers.tsx`를 추가했고, `z.config({ jitless: true })`와 이유 주석만 추가했다. `'unsafe-eval'`은 허용하지 않았다. 이후 이벤트 0건과 기존 폼 동작을 재확인했다.

기존 `/api/ai/status` 계약에는 결제 여부 전용 필드가 없다. 코디네이터 승인에 따라 운영에서는 personal의 enabled=true·provider=gemini·reason=null과 `GEMINI_BILLING_ENABLED=true` 설정으로 확인하도록 README에 적었다. reason=billing_required면 실제 결제와 설정을 점검한다. 실제 Google 청구 상태나 모델 응답은 이번 리허설의 검증 대상이 아니다.

## 실제 서버에서 남은 확인

사용자·코디네이터가 README 순서대로 서울 VPS·고정 IP·도메인·DNS·공개 인증서를 준비하고, 결제 연결 Gemini·증권사·CODEF 키와 허용 IP를 설정한다. 실제 키의 동작, amd64 서버의 빌드·기동, 공인 인증서 발급은 현지 확인 사항이다. 다른 사람에게 가입을 열기 전에 개인정보처리방침과 개인 데이터의 Google 처리·국외 이전 안내를 별도 작업으로 제공한다. 운영 암호화 키와 덤프의 서버 밖 보관도 설정한다.

## 정리

별도 Playwright 세션을 닫고 `down -v`로 리허설 컨테이너·네트워크·볼륨을 삭제했다. 리허설 이미지 3종과 이전 이미지, 이번에 받은 `postgres:17` 이미지 및 리허설에서 생성한 빌드 캐시 57개를 ID로 지정해 정리했다. 이후 Docker 이미지는 시작 전과 같은 5개, 컨테이너 2개·볼륨 4개이며 기존 두 Postgres 컨테이너는 계속 실행 중이다. 임시 비밀번호·키·덤프·브라우저 상태는 작업을 마칠 때 임시 디렉터리와 함께 삭제한다.
