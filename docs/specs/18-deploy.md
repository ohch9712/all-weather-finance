# 18. 배포: 서울 VPS, 고정 IP, 시크릿, 배치 일정, 백업

> 웨이브 5 · 브랜치 `feature/18-deploy` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 1~4웨이브 전체 병합(develop). 사용자 결정(2026-10-18): **서울 리전 VPS 한 대 + Docker Compose**, 개인 데이터(personal 등급) LLM은 **결제가 연결된 Gemini 키**.
> 이 작업은 저장소 안의 배포 산출물을 만들고 로컬에서 운영 구성을 리허설한다. 실제 서버 생성·도메인·DNS·키 입력·증권사 IP 등록은 병합 뒤 사용자와 코디네이터가 `deploy/README.md` 순서대로 한다.

## 1. 목표

- 운영 환경에서 프론트·백엔드·DB를 HTTPS로 서비스한다.
- 키움·토스 API가 요구하는 **고정 아웃바운드 IP**는 VPS에 붙인 고정 공인 IPv4로 확보한다.
- 시크릿을 저장소 밖(서버의 `deploy/.env.production`)에서 관리하고, 마이그레이션·배치·백업을 자동화한다.

## 2. 결정 사항

| 항목 | 결정 |
| --- | --- |
| 서버 | 서울 리전 VPS 한 대. Ubuntu 24.04 LTS, 2 vCPU·메모리 4GB 이상, 디스크 60GB 이상, 서버에 붙는 고정 공인 IPv4. 업체는 고르지 않는다. README는 업체 공통 절차로 쓰고 예시로 AWS Lightsail 서울(고정 IP 붙이기, 방화벽 22·80·443)을 든다 |
| 구성 | Docker Compose 한 벌: `caddy`, `frontend`, `backend`, `migrate`, `cron`, `postgres`. 같은 도메인에서 `/api/*`는 backend, 나머지는 frontend |
| LLM | general·personal 모두 Gemini. `LLM_GENERAL_PROVIDER=gemini`, `LLM_PERSONAL_PROVIDER=gemini`, `GEMINI_BILLING_ENABLED=true`(사용자가 결제를 연결한 키). Ollama는 운영에 두지 않는다(compose에 넣지 않는다). 개인 데이터가 Google로 가므로 화면의 `AiProviderBadge`가 "Google Gemini"로 보여야 한다 |
| 시장 데이터 | `MARKET_DATA_PROVIDER`는 `kiwoom` 또는 `toss`(사용자 서버 키). 키가 없으면 `mock`이고 화면에 샘플 데이터 배지가 붙는다. 운영에서 사용자 증권사 연결은 mock을 쓸 수 없다(08 구현) |
| CODEF | `.env.production`에 키 자리만 둔다. 키를 넣으면 쓰고, 비우면 화면에 "키 설정 필요"로 꺼진다 |
| 로그인 보호 | Caddy에서 IP 기준 시도 제한: `POST /api/auth/login`·`POST /api/auth/signup`을 IP마다 10분에 10회까지, 넘으면 `429`. Caddy 이미지는 `xcaddy`로 `github.com/mholt/caddy-ratelimit`을 넣어 만든다(버전 고정). 계정 기준 제한은 이번 범위 밖 |
| 보안 헤더 | Caddy가 붙인다. `Strict-Transport-Security: max-age=31536000`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, CSP(3절) |
| 배치 | `cron` 서비스(backend 이미지 + `supercronic`, 버전과 sha256 고정, `TZ=Asia/Seoul`)가 3절 일정을 실행한다 |
| 백업 | 서버 crontab이 매일 03:30 KST `deploy/backup.sh`를 실행한다(`docker compose exec -T postgres pg_dump -Fc` → 서버 `/var/backups/finance/`, 7일 보관). 복구는 `deploy/restore.sh` |

## 3. 운영 요구사항

| 항목 | 요구 |
| --- | --- |
| 도메인·HTTPS | Caddy 자동 HTTPS(`{$DOMAIN}`, ACME 이메일 `{$ACME_EMAIL}`). 프론트와 API가 같은 출처라 쿠키는 first-party |
| 쿠키 | `COOKIE_SECURE=true`, `SameSite=Lax` 유지 |
| CORS | 같은 출처라 불필요. `FRONTEND_ORIGIN=https://{DOMAIN}` |
| 프론트 API 주소 | 빌드 인자 `NEXT_PUBLIC_API_BASE_URL=""`(빈 문자열 → 같은 출처 상대 경로 `/api/...`). `lib/api-client.ts`는 `??`로 기본값을 고르므로 빈 문자열이 그대로 쓰인다 |
| 백엔드 실행 | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'`(Caddy와 같은 내부 네트워크에서만 닿는다). 포트는 호스트에 열지 않는다 |
| 고정 IP | 백엔드·배치가 밖으로 나갈 때 쓰는 IP = VPS 고정 공인 IPv4. README에 앱의 증권사 연결 화면(나가는 IP 표시)과 `curl -4 https://ifconfig.me`로 확인하는 방법, 키움·토스 포털 등록 방법을 적는다 |
| DB | Postgres 17, 볼륨, 호스트 포트를 열지 않는다. 앱 계정과 마이그레이션 계정은 `DATABASE_URL`·`MIGRATION_DATABASE_URL`로 넣는다 |
| 마이그레이션 | `migrate` 서비스가 `uv run alembic upgrade heads`를 한 번 실행하고 끝난다. `backend`·`cron`은 `depends_on: migrate: condition: service_completed_successfully` |
| 배치(KST) | 평일 16:30 `python -m app.modules.market.jobs refresh-snapshot --resume`, 매주 월 08:00 `... refresh-stocks`, 매일 04:00 `... prune-snapshots --keep-days 30`, 매시 05분 `python -m app.modules.imports.jobs purge-expired`. 실패(종료 코드 ≠ 0)는 로그에 남기고 다음 일정은 그대로 돈다 |
| 만료 임포트 정리 | 지금은 사용자가 다시 접근할 때만 그 사용자의 만료 작업을 지운다. 업로드 원문 행(개인 데이터)이 남지 않도록 `imports.jobs purge-expired`(새 파일)가 `expires_at <= now_utc()`인 `import_jobs`를 모두 지우고 지운 건수만 출력한다 |
| CSP | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Next.js가 넣는 인라인 스크립트 때문에 `script-src`에 `'unsafe-inline'`을 둔다(nonce 방식은 범위 밖). 학습 글의 Markdown 이미지가 외부 https라서 `img-src https:`를 둔다. 리허설에서 핵심 화면과 학습 영상 글을 열어 CSP 위반이 콘솔에 없어야 한다 |
| 관리자 | 배포 후 `python -m app.modules.auth.cli make-admin <email>`, 학습 시드 `python -m app.modules.learn.seed` |
| AI 확인 | `GET /api/ai/status`에서 personal이 Gemini이고 결제 연결로 표시되어야 한다 |
| 개인정보처리방침 | 다른 사람이 가입해 쓰게 열기 전에 별도 작업으로 만든다(CODEF 위탁 안내 https://codef.io/privacy-pop, Google Gemini로 개인 데이터 처리·국외 이전 안내). 이 작업 범위 밖이고 README의 "공개 전 확인"에 적는다 |

## 4. 범위와 산출물

- `backend/Dockerfile`, `backend/.dockerignore`: `python:3.12-slim`, `uv sync --frozen --no-dev`, 비루트 사용자, `.env`·테스트·캐시를 이미지에 넣지 않는다. 같은 이미지를 `backend`·`migrate`·`cron`이 쓴다(`cron`용 `supercronic`도 이 Dockerfile에서 받거나 별도 단계로 넣는다).
- `frontend/Dockerfile`, `frontend/.dockerignore`: Next.js standalone 출력, 비루트 사용자, 빌드 인자 `NEXT_PUBLIC_API_BASE_URL`. `frontend/next.config.ts`에 `output: "standalone"`만 더한다(다른 설정과 주석은 그대로).
- `deploy/compose.prod.yaml`: 2·3절 서비스. 재시작 정책 `unless-stopped`, 로그 크기 제한(`json-file` max-size·max-file), 볼륨 `pgdata`·`caddy_data`·`caddy_config`. 외부에 여는 포트는 caddy의 80·443뿐이다.
- `deploy/caddy/Dockerfile`(xcaddy + caddy-ratelimit, 버전 고정), `deploy/Caddyfile`(라우팅, 보안 헤더, CSP, 시도 제한, gzip·zstd).
- `deploy/crontab`(supercronic 일정 파일), `deploy/backup.sh`, `deploy/restore.sh`, `deploy/.env.production.example`(값 없는 키 목록 + 안전한 기본값, 2절 LLM 값 포함, `DOMAIN`·`ACME_EMAIL`·`POSTGRES_*`), `deploy/README.md`.
- `deploy/README.md`: 서버 준비(고정 IP 붙이기, SSH 키, `ufw` 22·80·443, Docker 설치), 도메인 A 레코드, 저장소 받기(`main`), `.env.production` 만들기(`chmod 600`, `APP_ENCRYPTION_KEY`·DB 비밀번호 만드는 명령), 첫 배포, 관리자·시드, AI 상태 확인, 나가는 IP 확인과 키움·토스 IP 등록, 업데이트(`git pull` → `docker compose ... build` → `up -d`), 롤백(이전 커밋으로 되돌려 다시 빌드, 마이그레이션 문제면 백업 복구), 백업·복구, 로그 보기, 공개 전 확인(개인정보처리방침, 관리자 계정, 키 입력 여부).
- `backend/app/modules/imports/jobs.py`(새 파일, `purge-expired`), `backend/app/modules/imports/repository.py`에 전체 만료 작업을 지우는 함수 하나 추가, `backend/tests/imports/test_purge_expired.py`.
- GitHub Actions와 배포 자동화는 범위 밖이다.

## 5. 소유 파일

- `deploy/**`
- `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`
- `frontend/next.config.ts`(`output: "standalone"` 한 줄만)
- `frontend/src/app/providers.tsx`(모듈 최상단 `z.config({ jitless: true })`와 이유 주석만. Zod 4의 JIT 지원 탐지 `Function("")`가 CSP에서 eval 차단 이벤트를 내므로 끈다. `'unsafe-eval'`은 넣지 않는다. 코디네이터 승인 2026-10-18)
- `backend/app/modules/imports/jobs.py`, `backend/app/modules/imports/repository.py`(만료 작업 전체 삭제 함수 추가만), `backend/tests/imports/test_purge_expired.py`
- 이 문서의 `## 구현 결과`
- 그 밖의 경로는 `ask`로 받는다.

## 6. 완료 기준

- [ ] 공통 완료 기준(AGENTS.md) 중 바꾼 영역의 명령(백엔드 ruff·pytest, 프론트 lint·tsc·test·build)이 통과한다.
- [ ] `docker compose -f deploy/compose.prod.yaml --env-file <리허설용 env> build`가 성공한다.
- [ ] 로컬 리허설(`DOMAIN=localhost`, Caddy 내부 인증서, 리허설용 env는 `$TMPDIR`에 만들고 LLM은 `disabled`, 외부 키 없음, `MARKET_DATA_PROVIDER=mock`)에서 다음을 확인한다.
  - `migrate`가 한 번 실행되고 끝난 뒤 `backend`·`cron`이 뜬다. 다시 `up` 해도 마이그레이션이 두 번 적용되지 않는다.
  - `https://localhost`에서 가입·로그인·온보딩·자산배분·가계부·학습 화면이 동작하고, 세션 쿠키에 `Secure`·`HttpOnly`·`SameSite=Lax`가 붙는다. `/api/*`는 backend로, 나머지는 frontend로 간다.
  - 2절 보안 헤더와 3절 CSP가 응답에 있고, 위 화면과 학습 영상 글에서 CSP 위반이 콘솔에 없다.
  - 같은 IP에서 `POST /api/auth/login` 11번째 요청이 `429`다.
  - `supercronic -test deploy/crontab`이 통과하고, `cron` 컨테이너에서 각 배치 명령을 한 번씩 손으로 실행해 종료 코드 0(Mock)을 확인한다.
  - `backup.sh`로 만든 덤프를 `restore.sh`로 새 DB에 복구한 뒤 앱이 뜨고 리허설 사용자로 로그인된다.
  - 호스트에 열린 포트가 80·443뿐이다(postgres·backend·frontend 포트가 없다).
- [ ] 이미지와 저장소에 시크릿 값이 없다(`docker history`, 이미지 안 `.env` 파일 검색, `git diff`).
- [ ] `purge-expired`가 만료된 작업만 지우고 지운 건수를 출력한다(테스트).

## 7. 검증 체크리스트

1. 이미지에 `.env`·키·테스트 파일이 들어 있지 않고 비루트로 실행된다.
2. 쿠키 `Secure`, 같은 출처 배치, `FRONTEND_ORIGIN`, `NEXT_PUBLIC_API_BASE_URL=""` 빌드.
3. 마이그레이션이 앱보다 먼저 한 번만 실행된다.
4. 배치 일정이 KST이고 3절 명령과 같으며, 실패해도 다음 일정이 돈다.
5. 보안 헤더·CSP가 있고 YouTube nocookie 임베드를 막지 않는다.
6. 로그인·가입 시도 제한 `429`.
7. 백업·복구를 실제로 한 번 수행한 기록.
8. `.env.production.example`의 LLM 값이 2절과 같고(personal Gemini, 결제 연결), Ollama 서비스가 없다.
9. 열린 포트가 80·443뿐이다.
10. README만 보고 빈 서버에 배포할 수 있을 만큼 순서·명령이 빠짐없고, 나가는 IP 확인과 증권사 IP 등록, 공개 전 확인이 있다.

## 구현 결과

- 서울 VPS용 backend·frontend standalone·Caddy 이미지를 만들었다. 앱 이미지는 비루트이며 env·앱 테스트를 넣지 않는다. supercronic v0.2.50·xcaddy v0.4.7·caddy-ratelimit 커밋과 SHA-256을 고정하고 Caddy v2.11.7을 빌드한다. amd64·arm64 다운로드를 지원한다.
- 운영 Compose의 6개 서비스, migrate 성공 뒤 backend·cron 기동, Caddy 동일 출처 라우팅·보안 헤더·CSP·인증 시도 제한, KST 배치 일정, 앱·마이그레이션 DB 계정 분리, 7일 보관 백업·새 DB 복구 스크립트와 빈 Ubuntu 서버부터의 한국어 README를 추가했다.
- imports의 전체 만료 작업 삭제 함수·CLI와 테스트 3개를 추가했다. 전체 백엔드 1,396개, 프론트 482개 테스트 및 ruff·lint·tsc·build, Compose build를 통과했다.
- `localhost` 내부 인증서·독립 프로젝트·신규 임시 비밀값·LLM disabled·외부 키 없음·시장 Mock으로 리허설했다. 가입·로그인·온보딩·추천·가계부 입력·학습·영상, 쿠키 속성, 11번째 로그인 429, 배치 4종, 새 DB 복구 뒤 기존 사용자 로그인, 이미지 시크릿 검사, Caddy 80·443만 게시됨을 확인했다. 자세한 명령과 판정은 `deploy/REHEARSAL.md`에 적었다.
- 조정: Zod 4 JIT 탐지의 CSP eval 차단 이벤트를 없애기 위해 코디네이터가 승인하고 5절에 추가한 providers.tsx의 `z.config({ jitless: true })`만 반영했다. 이후 360·1280px 핵심 화면·영상 10회 검사에서 CSP 이벤트 0건·가로 스크롤 없음, 폼 검증·저장 정상과 프론트 전체 재검사 통과를 확인했다.
- 조정: 기존 AI 상태 API에는 billing 필드가 없어 코디네이터 승인으로 personal.enabled=true·provider=gemini·reason=null과 운영 결제 설정을 함께 확인하도록 문서화했다. API 계약과 실제 외부 호출은 추가하지 않았다.
- 실제 서버에서 사용자·코디네이터가 할 일: VPS·고정 IP·도메인·DNS·공개 인증서 준비, 결제 연결 Gemini·시장·CODEF 키 입력, 증권사 허용 IP 등록, 실제 키 동작·amd64 서버 확인, 개인정보처리방침·Google 개인 데이터 처리/국외 이전 안내 제공, 암호화 키·백업의 서버 밖 보관과 호스트 crontab 설정.
- 리허설 브라우저·컨테이너·볼륨·이미지와 이번 생성 빌드 캐시를 정리했고 기존 개발 서버·공용 Postgres는 건드리지 않았다.

### 실제 서버 배포 (코디네이터, 2026-10-19)

- 환경: AWS Lightsail 서울 리전 Ubuntu 24.04.4 LTS(x86_64, 2 vCPU, 메모리 3.7GB, 디스크 77GB), 고정 공인 IPv4, 업체 방화벽 22·80·443. `main` `82e986b`를 `/opt/finance`에 받아 `deploy/README.md` 순서대로 진행했다. 도메인·이메일·키 값은 이 문서에 적지 않는다.
- 서버 준비: 패키지 업데이트 뒤 커널 업데이트로 한 번 재부팅, `ufw` 22·80·443, 시간대 Asia/Seoul. README에 없는 단계로 첫 빌드 전에 2GB 스왑을 만들었다(4GB 서버에서 프론트·Caddy 빌드 메모리 여유). Docker 29.9.1, Compose v5.6.0.
- 시크릿: `.env.production`은 예시를 복사한 뒤 README 3절 스크립트로 DB 비밀번호 두 개·`APP_ENCRYPTION_KEY`·두 DB URL을 만들고(출력 없음), 사용자가 도메인·ACME 이메일·결제 연결 Gemini 키·CODEF 데모 키(`CODEF_ENV=development`)·`PRIVACY_*`를 직접 넣었다. 코디네이터는 키 이름별 채움 여부와 형식만 확인했다.
- 빌드·기동: 이미지 빌드는 `DOMAIN`·`ACME_EMAIL`이 필수 보간이라 빌드 때만 임시 값을 넣어 먼저 빌드했다(이미지에 도메인이 들어가지 않는다). `up -d` 후 postgres healthy → migrate Exit 0 → backend·frontend healthy → caddy. Let's Encrypt 인증서 자동 발급, HTTP → HTTPS 308.
- 확인: `/api/health` 200, 보안 헤더(HSTS, nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, CSP), 외부에서 열린 포트 22·80·443뿐(3000·8000·5432·2019 닫힘), backend·frontend·caddy uid 10001, `supercronic -test` 통과, AI 상태 general·personal 모두 `enabled=true, provider=gemini, reason=null`, 호스트·backend·cron의 나가는 IP가 고정 IP와 같음, `/privacy` 운영자 정보 표시(초안 경고 없음), 학습 시드 35개, 사용자 가입·온보딩 후 `make-admin`.
- 백업: `/var/backups/finance`(700)에 첫 덤프 생성, 호스트 crontab 매일 03:30 `backup.sh` 등록(기존 crontab이 없던 계정이라 `crontab -l`이 실패한다). 사용자가 Lightsail 인스턴스 자동 스냅샷을 켰다.
- 남은 일: 키움·토스 앱키 발급과 허용 IP 등록 후 `MARKET_DATA_PROVIDER` 전환, README 보완(데모 키 `CODEF_ENV=development`, 스왑, 첫 crontab 등록), 다른 사용자에게 가입을 열기 전 처리방침 법률 검토, 백업의 새 DB 복구 정기 점검.

### README 실제 서버 반영

- 대상: 위 '실제 서버 배포'의 남은 일 중 README 보완. `deploy/README.md`만 고쳤고 다른 절·기존 명령은 그대로 두었다.
- 3절: CODEF 문장을 `CODEF_ENV`와 세 키 이름으로 바꾸고, 키와 환경의 짝(샌드박스 `sandbox`, 데모 키(일 100회) `development`, 정식 키 `production`, 도메인은 스펙 17 4절)과 예시 기본값 `production`을 데모 키에서는 `development`로 바꾼다는 문장을 더했다.
- 2.1절(새 소절): 메모리 4GB 이하 서버는 첫 빌드 전에 2GB 스왑 파일을 만든다. `swapon --show --noheadings` 출력이 있으면 건너뛰고, 없을 때만 `fallocate`·`chmod 600`·`mkswap`·`swapon`과 `/etc/fstab` 한 줄(이미 있으면 더하지 않음)을 실행한 뒤 `swapon --show`·`free -h`로 확인한다.
- 4절: 빌드 전에 `DOMAIN`·`ACME_EMAIL`·`GEMINI_API_KEY`와 DB 값·`APP_ENCRYPTION_KEY`를 먼저 넣는다는 문장을 더했다. `DOMAIN`·`ACME_EMAIL`·DB 값은 Compose 필수 보간이라 비면 `dc config`·`dc build`가 멈추고, `GEMINI_API_KEY`는 보간 검사 대상이 아니지만 비면 AI 상태가 `missing_api_key`가 된다. 값이 빈 필수 키의 이름만 보여 주는 `grep`·`cut` 확인 명령을 더했다(값은 출력하지 않는다).
- 8절: `crontab -e` 안내 뒤에 비대화형 등록 명령 `(crontab -l 2>/dev/null | grep -vF '/opt/finance/deploy/backup.sh'; echo '<백업 줄>') | crontab -`과 `crontab -l` 확인을 더했다. 처음 쓰는 계정의 `crontab -l` 실패를 무시하고, 기존 줄은 유지하며 같은 경로의 백업 줄만 바꿔 넣는다. `grep -vF`는 지시의 `backup.sh` 대신 전체 경로로 걸러 다른 프로젝트의 `backup.sh` 줄을 지우지 않게 했다.
- 검사: 문서만 바뀌어 코드 검사(ruff·pytest·lint·tsc·test·build)는 생략했다. 바꾼 bash 블록 3개를 README에서 추출해 `bash -n`을 통과했다. 서버 명령은 실행하지 않았고, 로컬에서 `crontab`·`sudo`·`swapon`·`free`를 가짜 함수로 바꾸고 임시 파일만 쓰는 모의 실행으로 동작을 확인했다. crontab은 없는 계정·재실행·기존 줄 유지·다른 경로 `backup.sh` 유지에서 백업 줄이 한 줄만 남았다. 스왑은 없음·이미 켜짐·fstab 줄이 이미 있음에서 생성 건너뛰기와 fstab 중복 방지가 맞았다. 필수 값 확인은 빈 키 이름만 출력하고 모두 채우면 출력이 없었다(가짜 값만 쓴 임시 env).
- 남은 일: 다음 서버 작업(새 서버·재설치) 때 실제 Ubuntu에서 2.1절 스왑 명령과 8절 비대화형 crontab 명령을 한 번 확인한다.
