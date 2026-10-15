# 18. 배포: 호스팅, 고정 IP, 시크릿, 배치 일정, 백업

> 웨이브 5 · 브랜치 `feature/18-deploy` · 구현 codex · 검증 codex `gpt-6.1-sol` / `xhigh`
> 선행: 1~4웨이브 전체 병합, **사용자의 호스팅 결정**(3절). 결정 전에는 디스패치하지 않는다.
> **착수 직전 갱신**: 코디네이터는 결정된 호스팅에 맞춰 4절을 확정하고 나머지 선택지 설명을 지운다.

## 1. 목표

- 운영 환경에서 프론트·백엔드·DB를 HTTPS로 서비스한다.
- 키움·토스 API가 요구하는 **고정 아웃바운드 IP**를 확보한다.
- 시크릿을 저장소 밖에서 관리하고, 마이그레이션·종목 스냅샷 배치·백업을 자동화한다.

## 2. 운영 요구사항

| 항목 | 요구 |
| --- | --- |
| 도메인·HTTPS | 프론트와 API를 같은 사이트(예: `app.example.com`과 `app.example.com/api`)로 두어 쿠키를 first-party로 쓴다 |
| 쿠키 | `COOKIE_SECURE=true`, `SameSite=Lax` 유지 |
| CORS | 같은 출처면 불필요. 다른 출처면 `FRONTEND_ORIGIN`을 운영 도메인으로 |
| 고정 IP | 증권사 API를 부르는 백엔드·배치의 나가는 IP가 고정이어야 한다(키움 최대 10개 등록) |
| DB | Postgres 17, 매일 백업 7일 보관, 복구 절차 문서화 |
| 마이그레이션 | 배포마다 `alembic upgrade heads`를 앱 시작 전에 한 번 |
| 배치 | 평일 16:30 KST `refresh-snapshot`, 매주 월요일 08:00 KST `refresh-stocks`, 매일 `prune-snapshots --keep-days 30`, 매시간 만료 임포트 작업 정리 |
| 로그인 보호 | 로그인 시도 제한(IP·계정 기준, 예: 10분 10회) — 리버스 프록시 또는 앱 미들웨어 |
| 보안 헤더 | HSTS, `X-Content-Type-Options`, `Referrer-Policy`, CSP(YouTube nocookie 임베드 허용) |
| 관리자 | 배포 후 `make-admin`으로 첫 관리자 지정, 학습 시드(`learn.seed`) 실행 |

## 3. 호스팅 선택지 (사용자 결정 필요)

| 선택지 | 구성 | 고정 IP | 장점 | 단점 |
| --- | --- | --- | --- | --- |
| A. VPS 한 대(권장) | 고정 IP VPS + Docker Compose(Caddy, frontend, backend, postgres, 배치 cron) | VPS 공인 IP 그대로 | 단순하고 저렴, 증권사 IP 등록이 쉽다, 배치·웹소켓 제약 없음 | 서버 관리·백업을 직접 해야 한다 |
| B. Vercel + 관리형 DB | Vercel Services(Next.js + FastAPI) + Vercel Static IPs + Supabase/Neon Postgres | Static IPs(유료 기능) | 배포 자동화, 미리보기 환경 | 비용, 함수 실행 시간 제한, 배치는 Cron + 청크 실행 필요, Supabase면 RLS 설정 필요 |
| C. 컨테이너 PaaS + 관리형 DB | Fly.io·Railway 등 + 고정 egress IP 옵션 + 관리형 Postgres | 플랫폼 옵션 | 관리 부담 중간 | 플랫폼별 설정 차이 |

- 권장은 A다. 증권사 허용 IP와 장 마감 후 배치를 가장 단순하게 맞출 수 있다.

## 4. 범위와 산출물 (선택지 A 기준, 결정에 따라 조정)

- `backend/Dockerfile`(uv, slim, 비루트 사용자), `frontend/Dockerfile`(Next.js standalone 출력)
- `deploy/compose.prod.yaml`: `caddy`(HTTPS 자동, `/api/*` → backend, 나머지 → frontend), `frontend`, `backend`, `postgres`(볼륨), `migrate`(시작 시 `alembic upgrade heads` 1회), `cron`(2절 배치)
- `deploy/Caddyfile`, `deploy/.env.production.example`(값 없는 키 목록), `deploy/backup.sh`(pg_dump + 7일 보관), `deploy/README.md`(서버 준비, 시크릿 넣기, 첫 배포, 업데이트, 롤백, 복구, 증권사 IP 등록 안내)
- 앱 수정이 필요한 부분(로그인 시도 제한, 보안 헤더)은 소유 모듈을 확인해 코디네이터에게 `ask`로 범위를 받는다.
- GitHub Actions(선택): `develop`·`main` PR에서 백엔드·프론트 테스트 실행. 배포 자동화는 사용자 결정 후.

## 5. 소유 파일

- `deploy/**`, `backend/Dockerfile`, `frontend/Dockerfile`, `.github/workflows/**`(선택)
- 그 밖의 경로는 `ask`로 받는다.
- 이 문서의 `## 구현 결과`

## 6. 완료 기준

- [ ] 빈 서버에 `deploy/README.md` 순서대로 따라 하면 HTTPS로 가입·로그인·핵심 화면이 동작한다
- [ ] 서버의 나가는 IP가 고정이고, 그 IP를 키움(모의) 포털에 등록해 연결 확인이 성공한다(사용자 키가 있을 때)
- [ ] 백업 스크립트로 만든 덤프를 새 DB에 복구해 앱이 뜬다
- [ ] 저장소에 시크릿 값이 없다

## 7. 검증 체크리스트

1. 이미지에 `.env`·키가 들어 있지 않다(`docker history`, 이미지 파일 검사).
2. 쿠키 `Secure`, 같은 사이트 배치, CORS 설정.
3. 마이그레이션이 앱보다 먼저 한 번만 실행된다.
4. 배치 일정(KST)과 종료 코드 처리.
5. 보안 헤더와 CSP가 YouTube nocookie 임베드를 막지 않는다.
6. 백업·복구 절차를 실제로 한 번 수행한 기록.
