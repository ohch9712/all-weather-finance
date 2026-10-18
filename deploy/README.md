# 서울 VPS 배포

Ubuntu 24.04 LTS 한 대에 Caddy·Next.js·FastAPI·Postgres 17·배치를 올린다. 서버는 서울 리전, 2 vCPU·메모리 4GB·디스크 60GB 이상, 고정 공인 IPv4를 준비한다. 아래 명령의 도메인·이메일·계정 이름은 자신의 값으로 바꾼다. 명령은 별도 표시가 없으면 SSH로 접속한 서버에서 실행한다. 실제 배포는 `main`에 병합한 뒤 진행한다.

## 1. 서버·고정 IP·접속 준비

업체 콘솔에서 Ubuntu 24.04 서버와 SSH 공개키를 등록한다. 개인키는 로컬 컴퓨터에만 보관한다. 예를 들어 AWS Lightsail은 서울 리전 인스턴스를 만든 뒤 네트워킹에서 **고정 IP를 생성하고 인스턴스에 연결**한다. 기본 동적 IP를 그대로 쓰지 않는다. 다른 업체도 고정 IP를 서버에 연결하는 절차는 같다.

업체 방화벽은 TCP 22(가능하면 관리자 IP만), TCP 80·443을 허용한다. IPv6를 쓰지 않으면 DNS AAAA를 만들지 않는다. 3000·8000·5432는 열지 않는다. 로컬 컴퓨터에서 접속한다.

```bash
chmod 600 ~/.ssh/finance_vps
ssh -i ~/.ssh/finance_vps ubuntu@<고정_IP>
```

서버의 SSH 키 로그인을 확인한 뒤 기본 패키지·방화벽·시간대를 준비한다. `ufw enable` 전에 SSH 규칙을 반드시 추가한다.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git openssl python3 ufw cron
sudo timedatectl set-timezone Asia/Seoul
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
sudo systemctl enable --now cron
```

도메인 DNS의 A 레코드를 고정 IPv4로 지정한다. 프록시/CDN은 켜지 않고 VPS에 직접 연결한다(IP 기준 로그인 제한을 위해서도 필요하다). DNS 전파 뒤 로컬 컴퓨터에서 `nslookup <도메인>`으로 확인한다. Caddy는 공개 도메인이면 ACME로 인증서를 자동 발급·갱신한다. `localhost`만 내부 인증서를 쓴다([Caddy 공식 문서](https://caddyserver.com/docs/automatic-https)).

## 2. Docker 설치

[Docker Ubuntu 공식 설치 절차](https://docs.docker.com/engine/install/ubuntu/)의 apt 저장소를 쓴다. 빈 서버 기준이며, 기존 비공식 Docker 패키지가 있다면 공식 문서의 충돌 패키지 제거 절차부터 따른다.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo usermod -aG docker "$USER"
```

SSH를 끊고 다시 접속한다. Docker 그룹은 호스트 관리자 권한을 줄 수 있으므로 운영자만 넣는다. Docker가 게시한 포트는 UFW를 우회할 수 있다. 이 Compose는 Caddy의 TCP 80·443만 게시하며 업체 방화벽도 함께 적용한다.

```bash
docker version
docker compose version
```

## 3. 저장소·시크릿 준비

```bash
sudo install -d -o "$USER" -g "$USER" -m 750 /opt/finance
git clone --branch main https://github.com/ohch9712/finance-project.git /opt/finance
cd /opt/finance
umask 077
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

다음 명령은 DB 비밀번호 두 개와 Fernet 키를 새로 만들고 **출력하지 않고 파일에만** 기록한다. 두 URL의 호스트는 내부 서비스 이름 `postgres`, 포트는 `5432`다. 앱은 제한된 CRUD 계정, 마이그레이션·백업·복구는 별도 소유자 계정이다. `init-app.sh`는 첫 DB 볼륨 생성 때 앱 역할과 소유자가 앞으로 만드는 테이블의 권한을 설정한다.

```bash
python3 - <<'PY'
import base64
import secrets
from pathlib import Path

path = Path('deploy/.env.production')
values = dict(line.split('=', 1) for line in path.read_text().splitlines()
              if line and not line.startswith('#'))
values['POSTGRES_PASSWORD'] = secrets.token_hex(32)
values['POSTGRES_APP_PASSWORD'] = secrets.token_hex(32)
values['APP_ENCRYPTION_KEY'] = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
for key, user, password in [
    ('DATABASE_URL', 'POSTGRES_APP_USER', 'POSTGRES_APP_PASSWORD'),
    ('MIGRATION_DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD'),
]:
    values[key] = (f"postgresql+psycopg://{values[user]}:{values[password]}"
                   f"@postgres:5432/{values['POSTGRES_DB']}")
path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
path.chmod(0o600)
PY
nano deploy/.env.production
```

편집기에서 `DOMAIN`(스킴·경로 없는 도메인), `ACME_EMAIL`, **결제가 연결된 프로젝트의 `GEMINI_API_KEY`**를 넣는다. `LLM_GENERAL_PROVIDER=gemini`, `LLM_PERSONAL_PROVIDER=gemini`, `GEMINI_BILLING_ENABLED=true`가 운영 결정값이다. 결제를 실제 연결한 뒤에만 true로 둔다. 미연결 키로 개인 금융 데이터를 보내지 않는다. 결제 여부는 설정의 운영자 선언이며 서버가 Google 청구 상태를 조회하지 않는다. 개인 데이터가 Google로 전송되고, 모든 Gemini 호출은 앱의 기존 `store=False` 경로를 쓴다. Ollama 서비스는 없다.

시장 데이터 키가 없으면 `MARKET_DATA_PROVIDER=mock`을 유지한다. 키를 준비했을 때만 `kiwoom`과 `KIWOOM_ENV=real`·`KIWOOM_APP_KEY`·`KIWOOM_APP_SECRET`, 또는 `toss`와 `TOSS_CLIENT_ID`·`TOSS_CLIENT_SECRET`을 넣는다. CODEF는 `CODEF_ENV=production`과 세 키를 넣으면 활성화되며, 비우면 화면에서 키 설정 필요로 표시된다. 실제 키·계좌번호·쿠키를 문서·로그·PR에 붙이지 않는다. `.env.production`과 `APP_ENCRYPTION_KEY`는 별도 접근 통제된 비밀 보관소에도 보관한다. 키를 잃으면 백업 DB의 암호화된 연결 정보를 해독할 수 없다. 기존 운영 볼륨에서 위 생성 명령을 다시 실행하지 않는다(비밀번호는 DB 역할에서도 따로 변경해야 한다).

## 4. 첫 배포

이하 편의를 위해 매 SSH 세션에 함수를 정의한다. `config`는 시크릿을 펼칠 수 있으므로 `--quiet` 없이 출력하지 않는다.

```bash
cd /opt/finance
dc() { docker compose --env-file /opt/finance/deploy/.env.production -f /opt/finance/deploy/compose.prod.yaml "$@"; }
dc config --quiet
dc build
dc up -d
dc ps -a
dc logs --tail=100 migrate backend cron caddy
```

`postgres`가 healthy → `migrate`가 `uv run alembic upgrade heads` 후 Exit 0 → `backend`·`cron` 시작 → 앱 healthcheck 통과 후 Caddy 시작 순서다. `migrate`는 일회성이라 `restart: "no"`, 나머지는 `unless-stopped`다. 재배포 시 명령이 다시 실행되어도 이미 적용한 revision은 다시 적용되지 않는다. 로그는 서비스마다 10MB × 3개로 제한한다. 첫 빌드는 메모리·디스크 여유가 필요하다.

```bash
curl -fsS https://<도메인>/api/health
curl -sSI https://<도메인>/login
dc exec -T backend id
dc exec -T frontend id
dc exec -T caddy id
dc exec -T cron supercronic -test /app/deploy/crontab
dc ps
```

외부 게시 포트는 Caddy의 80·443뿐이어야 한다. backend·frontend·Caddy는 uid 10001이다. HTTPS 응답에 HSTS·nosniff·프레임 제한·CSP 등이 있는지 확인한다. `/api/*`는 경로를 유지해 backend로, 나머지는 frontend로 간다. 프론트 API 주소는 빌드에서 빈 문자열로 고정해 같은 출처 `/api/...`를 쓰며 쿠키는 Secure·HttpOnly·SameSite=Lax다. TLS 종료 뒤의 backend는 내부 네트워크에서만 연결되므로 Caddy의 프록시 헤더를 신뢰한다.

브라우저에서 가입 → 온보딩 → 자산배분·가계부·배우기를 확인한다. 로그인·가입 POST는 같은 IP에서 합산 10분당 10회이며 초과하면 Caddy가 429와 Retry-After를 돌려준다. 앞에 임의의 프록시를 추가하지 않는다. 제한 상태는 Caddy 재시작 시 초기화된다.

## 5. 관리자·학습 시드·AI 확인

먼저 본인 이메일로 웹에서 가입한 다음 승격한다.

```bash
dc exec -T backend python -m app.modules.auth.cli make-admin <가입한_이메일>
dc exec -T backend python -m app.modules.learn.seed
```

다시 로그인해 관리자 학습 화면을 확인한다. 로그인한 브라우저 개발자도구 콘솔에서 다음을 실행한다(쿠키를 복사하지 않는다).

```javascript
fetch('/api/ai/status', { credentials: 'include' }).then(r => r.json()).then(console.log)
```

`general`·`personal`의 `enabled=true`, `provider=gemini`, `reason=null`을 확인한다. personal이 이 상태이면 결제 연결 **설정**이 켜져 있다는 뜻이다. 응답에는 별도 billing 필드가 없다. `reason=billing_required`면 `.env.production`의 `GEMINI_BILLING_ENABLED`와 실제 결제 연결을 확인한다. 화면의 `AiProviderBadge`도 **Google Gemini**로 표시되어야 한다. 여기까지는 상태 설정 확인이며 실제 모델 호출은 별도 사용자 동의가 있는 운영 확인에서 수행한다. Mock 시장 데이터는 샘플 데이터 배지가 있어야 한다.

## 6. 나가는 IP·증권사 허용 IP

```bash
curl -4 https://ifconfig.me
dc exec -T backend curl -4 https://ifconfig.me
dc exec -T cron curl -4 https://ifconfig.me
```

세 결과가 VPS에 붙인 고정 IPv4인지 확인한다. 앱 **설정 → 증권사 연결**에서도 나가는 IP 표시를 확인한다. 키움 REST API 포털에서 해당 앱의 허용 IP 설정에 이 IP를 등록하고, 토스증권 Open API 포털에서도 사용 앱의 접속 허용 IP에 등록한다. 모의·운영 앱이 다르면 해당 키에 맞는 앱을 선택한다. 포털 UI는 바뀔 수 있으므로 [키움 공식 포털](https://openapi.kiwoom.com/)·[토스 공식 포털](https://openapi.tossinvest.com/)의 현재 안내를 따른다. 서버를 바꾸면 키를 쓰기 전에 IP부터 갱신한다. 운영 사용자 연결에는 mock을 쓸 수 없다. 이 서비스는 조회 전용이며 주문·정정·취소를 제공하지 않는다.

## 7. 배치·로그

`cron` 서비스는 [supercronic](https://github.com/aptible/supercronic)으로 `deploy/crontab`을 읽으며 `TZ=Asia/Seoul`이다. 평일 16:30 스냅샷 갱신(`--resume`), 월요일 08:00 종목 갱신, 매일 04:00 30일 이전 스냅샷 정리, 매시 05분 모든 사용자의 만료 임포트 정리를 실행한다. 실패는 종료 코드와 로그에 남고 다음 일정은 계속 실행된다. 만료 임포트 명령은 삭제 건수만 출력한다.

```bash
dc logs --tail=100 cron
dc logs -f --tail=100 backend
dc logs --tail=100 caddy
# 필요할 때만 수동 실행한다. 운영 키가 있으면 실제 조회 호출이 발생한다.
dc exec -T cron python -m app.modules.market.jobs refresh-stocks
dc exec -T cron python -m app.modules.market.jobs refresh-snapshot --resume
dc exec -T cron python -m app.modules.market.jobs prune-snapshots --keep-days 30
dc exec -T cron python -m app.modules.imports.jobs purge-expired
```

## 8. 백업·복구

호스트 crontab은 03:30 KST에 백업한다. `backup.sh`는 `pg_dump -Fc`를 임시 파일로 받고 성공한 덤프만 완성 파일로 바꾸며 7일(10080분) 지난 덤프를 지운다. 실패하면 0이 아닌 종료 코드로 끝나고 기존 덤프는 유지된다. 디렉터리는 700, 덤프는 600이다. 서버가 없어져도 복구할 수 있도록 덤프와 암호화 키를 접근 통제된 서버 밖 보관소에 별도로 복제한다(외부 보관 자동화는 이번 범위 밖).

```bash
sudo install -d -o "$USER" -g "$USER" -m 700 /var/backups/finance
deploy/backup.sh
crontab -e
```

기존 crontab을 유지하고 다음 한 줄을 추가한다. 호스트 시간대가 `Asia/Seoul`인지 `timedatectl`로 확인한다. cron 로그 파일은 운영자만 읽게 미리 만든다.

```bash
install -m 600 /dev/null /var/backups/finance/backup.log
```

```cron
30 3 * * * /opt/finance/deploy/backup.sh >> /var/backups/finance/backup.log 2>&1
```

정기적으로 **새 DB 복구**를 실제 수행해 덤프를 검증한다. 먼저 백업 파일 경로를 지정하고, 대상 DB를 만든 뒤 복구한다. 같은 Postgres 클러스터의 역할을 사용하므로 덤프의 앱 권한도 복원된다.

```bash
dc exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" finance_restore'
deploy/restore.sh /var/backups/finance/<백업파일>.dump finance_restore
dc exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d finance_restore -c "SELECT count(*) FROM users"'
```

복구 DB로 앱 로그인까지 확인하려면 서비스를 멈추고 `.env.production`의 **두 URL 모두** DB 이름을 `finance_restore`로 바꾼 뒤 올린다. 테스트 후 두 URL을 원래 DB로 돌리고 다시 올린다.

```bash
dc stop caddy backend cron
nano deploy/.env.production
dc up -d
# 웹에서 기존 사용자 로그인·자산·학습 확인 후 다시 중지하고 URL을 원복한다.
dc stop caddy backend cron
nano deploy/.env.production
dc up -d
dc exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" finance_restore'
```

운영 DB를 같은 이름으로 덮어쓸 때는 유지보수 시간을 잡고 현재 백업을 먼저 만든다. 새 서버에서는 동일한 역할 이름으로 Postgres를 초기화하고 같은 암호화 키를 복원한다. 덤프를 만든 코드 버전으로 복구한 뒤 마이그레이션한다.

```bash
deploy/backup.sh
dc stop caddy backend cron
# POSTGRES_DB와 같은 DB 대상은 --replace가 필요하다. 대상 이름을 실제 값으로 바꾼다.
deploy/restore.sh /var/backups/finance/<백업파일>.dump finance --replace
dc up -d
```

`FINANCE_ENV_FILE`·`FINANCE_BACKUP_DIR` 환경변수로 리허설용 env·백업 디렉터리를 지정할 수 있다. 스크립트는 env를 shell source하지 않고 Compose로 전달한다.

## 9. 업데이트·롤백

업데이트 전에 현재 커밋을 기록하고 DB 백업을 남긴다.

```bash
cd /opt/finance
git rev-parse HEAD
deploy/backup.sh
git pull --ff-only origin main
dc build
dc up -d
dc ps -a
dc logs --tail=100 migrate backend cron
curl -fsS https://<도메인>/api/health
```

업데이트 때도 새 이미지의 migrate가 성공해야 앱·배치가 시작한다. 코드만 되돌릴 수 있는 DB 호환 변경이면 기록해 둔 이전 커밋을 체크아웃하고 다시 빌드한다.

```bash
dc stop caddy backend cron
git switch --detach <이전_커밋>
dc build
dc up -d
```

새 마이그레이션이 이전 코드와 호환되지 않으면 이전 커밋에서 DB 백업도 복구한 뒤 `up -d`한다. 복구 시점 이후 입력은 소실되므로 유지보수 공지·덤프 시점을 확인한다. 운영에서 `alembic downgrade base`나 `down -v`를 실행하지 않는다. 이후 업데이트를 다시 받을 때는 `git switch main`으로 돌아온다.

## 10. 공개 전 확인

- 개인정보처리방침을 별도 작업으로 제공한다. [CODEF 위탁 안내](https://codef.io/privacy-pop), Google Gemini의 개인 금융 데이터 처리·국외 이전 안내와 동의 등 실제 서비스 조건을 반영하기 전에는 다른 사람에게 가입을 열지 않는다.
- 관리자 계정이 본인 소유이며 일반 사용자는 관리자 화면에 접근할 수 없는지 확인한다.
- Gemini 키에 결제가 실제 연결되어 있고 personal 상태·화면 배지가 Google Gemini인지 확인한다.
- 시장 키·CODEF 키 유무와 disabled·sample 상태가 의도대로인지, 증권사 IP 등록이 맞는지 확인한다.
- HTTPS·쿠키 속성·보안 헤더·영상 글과 핵심 화면의 CSP 콘솔, 가입·로그인 429, DB 백업·새 DB 복구·로그인까지 확인한다.
- 외부에 열린 서비스 포트는 80·443(관리용 SSH 22 제외)이며 backend·frontend·DB는 게시하지 않는다.
- 시크릿·덤프는 Git에 추가하지 않는다. 이미지에는 env와 테스트를 복사하지 않는다. `docker history`나 이미지 검색 결과를 외부에 공유하기 전에도 비밀값 포함 여부를 확인한다.

## 11. 로컬 격리 리허설

실제 외부 API 확인 없이 `DOMAIN=localhost`, 두 LLM provider=`disabled`, 결제 플래그=false, 시장 provider=`mock`, 외부 키는 빈 값으로 둔다. `$TMPDIR`에 env·키·비밀번호를 새로 만들고 권한을 600으로 둔다. 프로젝트 이름도 `COMPOSE_PROJECT_NAME=finance18-rehearsal`로 분리한다. 기존 개발 서버·Postgres는 건드리지 않는다. 포트가 이미 쓰이면 리허설 env에서만 `HTTP_PORT`·`HTTPS_PORT`를 바꾸고 브라우저 origin·FRONTEND_ORIGIN도 해당 포트를 포함하도록 Compose override를 사용한다. 운영 기본은 80·443이다.

```bash
docker compose -p finance18-rehearsal --env-file <임시_env> -f deploy/compose.prod.yaml build
docker compose -p finance18-rehearsal --env-file <임시_env> -f deploy/compose.prod.yaml up -d
curl -k https://localhost/api/health
```

Caddy의 localhost 내부 인증서는 `curl -k`, 독립 Playwright 브라우저 컨텍스트의 `ignoreHTTPSErrors: true`로 다룬다. 브라우저의 기존 사용자 컨텍스트는 사용하지 않는다. 리허설 결과는 [REHEARSAL.md](REHEARSAL.md)에 기록한다. 끝나면 임시 리허설 구성만 정리한다.

```bash
docker compose -p finance18-rehearsal --env-file <임시_env> -f deploy/compose.prod.yaml down -v --rmi local
docker image rm finance18-rehearsal-backend:local finance18-rehearsal-frontend:local finance18-rehearsal-caddy:local
```

태그가 지정된 이미지가 `--rmi local`로 남는 경우 마지막 명령으로 지운다. 다른 프로젝트의 볼륨·이미지를 일괄 prune하지 않는다.
