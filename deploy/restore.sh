#!/usr/bin/env bash
# 대상 DB를 미리 만들고 backend·cron을 중지한 뒤 실행한다. 기본 DB 덮어쓰기는 명시 확인한다.
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 || ( $# -eq 3 && "$3" != --replace ) ]]; then
  printf '사용법: %s <덤프 파일> <대상 DB 이름> [--replace]\n' "$0" >&2
  exit 2
fi
dump_file="$1"
target_db="$2"
[[ -f "$dump_file" && "$target_db" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || exit 2
deploy_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="${FINANCE_ENV_FILE:-$deploy_dir/.env.production}"
compose=(docker compose --env-file "$env_file" -f "$deploy_dir/compose.prod.yaml")
default_db="$("${compose[@]}" exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
if [[ "$target_db" == "$default_db" && "${3:-}" != --replace ]]; then
  printf '운영 DB 복구는 서비스를 중지하고 --replace를 명시하세요.\n' >&2
  exit 2
fi
"${compose[@]}" exec -T postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$1" --clean --if-exists --no-owner --exit-on-error --single-transaction' \
  sh "$target_db" < "$dump_file"
printf '복구 완료: %s\n' "$target_db"
