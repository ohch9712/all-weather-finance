#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
finance_target "$@"
finance_lock
for service in $(finance_services stop); do finance_stop "$service"; done
