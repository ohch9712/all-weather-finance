#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
skip_install=0
skip_migrate=0
for argument in "$@"; do
  case "$argument" in
    --skip-install) skip_install=1 ;;
    --skip-migrate) skip_migrate=1 ;;
    -h|--help) printf '사용법: scripts/worktree-setup.sh [--skip-install] [--skip-migrate]\n'; exit 0 ;;
    *) finance_die "알 수 없는 인자: $argument" ;;
  esac
done
finance_lock
finance_compose up -d postgres
start=$SECONDS
while :; do
  container=$(finance_compose ps -q postgres)
  if [ -n "$container" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$container")" = healthy ]; then break; fi
  [ $((SECONDS - start)) -lt 60 ] || finance_die 'Postgres가 60초 안에 준비되지 않았습니다.'
  sleep 1
done
exists=$(finance_compose exec -T postgres psql -U finance -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$FINANCE_DB'")
if [ "$exists" != 1 ]; then finance_compose exec -T postgres createdb -U finance "$FINANCE_DB"; fi
python3 "$FINANCE_ROOT/scripts/lib/setup_env.py" "$FINANCE_ROOT" "$FINANCE_DB" "$BACKEND_PORT" "$FRONTEND_PORT"
if [ "$skip_install" = 0 ]; then
  if [ -f "$FINANCE_ROOT/backend/pyproject.toml" ]; then (cd "$FINANCE_ROOT/backend" && uv sync); fi
  if [ -f "$FINANCE_ROOT/frontend/package-lock.json" ]; then
    digest=$(shasum -a 256 "$FINANCE_ROOT/frontend/package-lock.json" | awk '{print $1}')
    previous=$(cat "$FINANCE_ROOT/frontend/node_modules/.finance-lock-hash" 2>/dev/null || true)
    if [ "$digest" != "$previous" ]; then
      (cd "$FINANCE_ROOT/frontend" && npm ci)
      printf '%s\n' "$digest" > "$FINANCE_ROOT/frontend/node_modules/.finance-lock-hash"
    fi
  fi
fi
if [ "$skip_migrate" = 0 ] && [ -d "$FINANCE_ROOT/backend" ]; then
  (cd "$FINANCE_ROOT/backend" && uv run alembic upgrade heads)
fi
printf '슬롯 %s | backend %s | frontend %s | DB %s\n' "$FINANCE_SLOT" "$BACKEND_PORT" "$FRONTEND_PORT" "$FINANCE_DB"
printf 'API http://localhost:%s | 웹 http://localhost:%s\n' "$BACKEND_PORT" "$FRONTEND_PORT"
