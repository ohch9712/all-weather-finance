# shellcheck shell=bash
# 감자마켓의 락·PID 메타데이터·로그 회전·헬스체크 구조를 슬롯 단위로 이식한다.
FINANCE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
FINANCE_BRANCH=$(git -C "$FINANCE_ROOT" branch --show-current)
FINANCE_SLOT=00
if [[ "$FINANCE_BRANCH" =~ (^|/)feature[/-]([0-9]{2})- ]]; then
  FINANCE_SLOT=${BASH_REMATCH[2]}
fi
BACKEND_PORT=$((8000 + 10#$FINANCE_SLOT))
FRONTEND_PORT=$((3000 + 10#$FINANCE_SLOT))
FINANCE_DB="finance_$FINANCE_SLOT"
FINANCE_RUNTIME="${TMPDIR:-/tmp}/finance/$FINANCE_SLOT"
FINANCE_LOCK=""

finance_die() { printf '오류: %s\n' "$*" >&2; exit 1; }
finance_compose() { docker compose -f "$FINANCE_ROOT/compose.yaml" "$@"; }
finance_ps() { ps -o "$1=" -p "$2" 2>/dev/null | sed 's/^ *//;s/ *$//' || true; }
finance_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true; }
finance_meta() { sed -n "s/^$2=//p" "$1"; }

finance_unlock() {
  if [ -n "$FINANCE_LOCK" ] && [ "$(cat "$FINANCE_LOCK/pid" 2>/dev/null)" = "$$" ]; then
    rm -rf "$FINANCE_LOCK"
  fi
}

finance_lock() {
  mkdir -p "$FINANCE_RUNTIME"
  local waited=0 holder lock="$FINANCE_RUNTIME/lock"
  while ! mkdir "$lock" 2>/dev/null; do
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [[ "$holder" =~ ^[0-9]+$ ]] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$lock"
      continue
    fi
    [ "$waited" -lt 60 ] || finance_die "슬롯 $FINANCE_SLOT 실행 잠금을 얻지 못했습니다."
    sleep 1
    waited=$((waited + 1))
  done
  printf '%s\n' "$$" > "$lock/pid"
  FINANCE_LOCK=$lock
  trap finance_unlock EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

finance_target() {
  FINANCE_TARGET=${1:-all}
  [ "$#" -le 1 ] || finance_die "대상은 하나만 지정하세요."
  case "$FINANCE_TARGET" in
    all|backend|frontend) ;;
    -h|--help) printf '사용법: %s [all|backend|frontend]\n' "$0"; exit 0 ;;
    *) finance_die "알 수 없는 대상: $FINANCE_TARGET" ;;
  esac
}

finance_services() {
  if [ "$FINANCE_TARGET" != all ]; then printf '%s' "$FINANCE_TARGET"
  elif [ "$1" = start ]; then printf 'backend frontend'
  else printf 'frontend backend'; fi
}

finance_port() {
  if [ "$1" = backend ]; then printf '%s' "$BACKEND_PORT"; else printf '%s' "$FRONTEND_PORT"; fi
}

finance_owned_pid() {
  local file=$1 pid
  [ -f "$file" ] || return 1
  [ "$(finance_meta "$file" worktree)" = "$FINANCE_ROOT" ] || return 1
  pid=$(finance_meta "$file" pid)
  [[ "$pid" =~ ^[0-9]+$ ]] && [ "$pid" -gt 1 ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [ "$(finance_ps lstart "$pid")" = "$(finance_meta "$file" lstart)" ] || return 1
  [ "$(finance_cwd "$pid")" = "$FINANCE_ROOT/$(finance_meta "$file" service)" ] || return 1
  [ "$(finance_ps pgid "$pid")" = "$pid" ] || return 1
  printf '%s' "$pid"
}

finance_stop() {
  local service=$1 file="$FINANCE_RUNTIME/$1.pid" pid waited=0
  [ -f "$file" ] || return 0
  if pid=$(finance_owned_pid "$file"); then
    kill -TERM -- "-$pid"
    while kill -0 -- "-$pid" 2>/dev/null && [ "$waited" -lt 10 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    if kill -0 -- "-$pid" 2>/dev/null; then kill -KILL -- "-$pid"; fi
    printf '%s 종료 완료\n' "$service"
    rm -f "$file"
  elif [ "$(finance_meta "$file" worktree)" = "$FINANCE_ROOT" ]; then
    printf '%s PID 기록이 만료됐거나 소유권을 확인할 수 없어 종료하지 않습니다.\n' "$service"
    rm -f "$file"
  else
    printf '%s PID 기록은 다른 워크트리 소유이므로 보존합니다.\n' "$service"
  fi
}

finance_start() {
  local service=$1 directory="$FINANCE_ROOT/$1" port file log pid start url
  [ -d "$directory" ] || { printf '%s 디렉터리가 없어 건너뜁니다.\n' "$service"; return 0; }
  port=$(finance_port "$service")
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    finance_die "포트 $port 를 이미 사용 중입니다. 점유 프로세스는 종료하지 않았습니다."
  fi
  file="$FINANCE_RUNTIME/$service.pid"
  if finance_owned_pid "$file" >/dev/null; then finance_die "$service 프로세스가 이미 기동 중입니다."; fi
  if [ -f "$file" ] && [ "$(finance_meta "$file" worktree)" != "$FINANCE_ROOT" ]; then
    finance_die "같은 슬롯에 다른 워크트리의 PID 기록이 있습니다."
  fi
  log="$directory/logs/dev-server.log"
  mkdir -p "$directory/logs"
  if [ -s "$log" ]; then mv -f "$log" "$log.1"; fi
  : > "$log"
  set -m
  if [ "$service" = backend ]; then
    (cd "$directory" && exec nohup uv run uvicorn app.main:app --host 127.0.0.1 --port "$port" --reload) >>"$log" 2>&1 </dev/null &
  else
    (cd "$directory" && exec nohup npm run dev -- --port "$port") >>"$log" 2>&1 </dev/null &
  fi
  pid=$!
  set +m
  disown "$pid" 2>/dev/null || true
  printf 'pid=%s\nlstart=%s\nworktree=%s\nservice=%s\n' "$pid" "$(finance_ps lstart "$pid")" "$FINANCE_ROOT" "$service" > "$file"
  url="http://localhost:$port/"
  [ "$service" != backend ] || url="${url}api/health"
  start=$SECONDS
  while [ $((SECONDS - start)) -lt 60 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)" = 200 ]; then
      printf '%s 준비 완료: %s (PID %s)\n' "$service" "$url" "$pid"
      return 0
    fi
    sleep 1
  done
  finance_stop "$service"
  finance_die "$service 헬스체크 실패. $log 를 확인하세요."
}
