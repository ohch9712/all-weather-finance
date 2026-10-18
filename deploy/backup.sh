#!/usr/bin/env bash
# 덤프에는 개인 데이터가 있으므로 소유자만 읽을 수 있게 저장한다.
set -euo pipefail
umask 077
deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${FINANCE_ENV_FILE:-$deploy_dir/.env.production}"
backup_dir="${FINANCE_BACKUP_DIR:-/var/backups/finance}"
mkdir -p -- "$backup_dir"
chmod 700 "$backup_dir"
dump_file="$backup_dir/finance-$(TZ=Asia/Seoul date +%Y%m%d-%H%M%S)-$$.dump"
partial_file="$dump_file.partial"
trap 'rm -f -- "$partial_file"' EXIT
docker compose --env-file "$env_file" -f "$deploy_dir/compose.prod.yaml" \
  exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial_file"
test -s "$partial_file"
mv -- "$partial_file" "$dump_file"
find "$backup_dir" -maxdepth 1 -type f -name 'finance-*.dump' -mmin +10080 -delete
printf '백업 완료: %s\n' "$dump_file"
