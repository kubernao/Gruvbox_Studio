#!/usr/bin/env bash
set -euo pipefail

# Railway API URL used by default for Studio startup.
# If GRUVBOX_API_BASE_URL is already set, prefer that value.
DEFAULT_API_BASE_URL="https://gruvboxapi-production.up.railway.app/"
API_BASE_URL="${GRUVBOX_API_BASE_URL:-$DEFAULT_API_BASE_URL}"
DEFAULT_AUTH_BASE_URL="https://gruvboxauth-production.up.railway.app/"
AUTH_BASE_URL="${GRUVBOX_AUTH_BASE_URL:-$DEFAULT_AUTH_BASE_URL}"

if [[ -z "$API_BASE_URL" ]]; then
  echo "Please edit start-railway.sh and set API_BASE_URL first."
  exit 1
fi

export GRUVBOX_API_BASE_URL="${API_BASE_URL%/}"
export GRUVBOX_API_REQUIRE_EXPLICIT=1

export GRUVBOX_AUTH_BASE_URL="${AUTH_BASE_URL%/}"
export WATCHPACK_POLLING="${WATCHPACK_POLLING:-true}"
export CHOKIDAR_USEPOLLING="${CHOKIDAR_USEPOLLING:-1}"
export CHOKIDAR_INTERVAL="${CHOKIDAR_INTERVAL:-250}"

if ! [[ "$GRUVBOX_API_BASE_URL" =~ ^https?:// ]]; then
  echo "[gruvbox] GRUVBOX_API_BASE_URL must start with http:// or https://"
  exit 1
fi
if ! [[ "$GRUVBOX_AUTH_BASE_URL" =~ ^https?:// ]]; then
  echo "[gruvbox] GRUVBOX_AUTH_BASE_URL must start with http:// or https://"
  exit 1
fi

echo "[gruvbox] Verifying API reachability at $GRUVBOX_API_BASE_URL/v1/models ..."
if ! curl -sS --max-time 8 -o /dev/null "$GRUVBOX_API_BASE_URL/v1/models"; then
  echo "[gruvbox] Could not reach API. Check GRUVBOX_API_BASE_URL and network."
  exit 1
fi
echo "[gruvbox] Verifying Auth reachability at $GRUVBOX_AUTH_BASE_URL/health ..."
if ! curl -sS --max-time 8 -o /dev/null "$GRUVBOX_AUTH_BASE_URL/health"; then
  echo "[gruvbox] Could not reach auth service. Check GRUVBOX_AUTH_BASE_URL and network."
  exit 1
fi

echo "[gruvbox] GRUVBOX_API_BASE_URL=$GRUVBOX_API_BASE_URL"
echo "[gruvbox] GRUVBOX_AUTH_BASE_URL=$GRUVBOX_AUTH_BASE_URL"
echo "[gruvbox] WATCHPACK_POLLING=$WATCHPACK_POLLING CHOKIDAR_USEPOLLING=$CHOKIDAR_USEPOLLING"
echo "[gruvbox] Starting Gruvbox Studio..."

run_start() {
  local log_file="$1"
  shift

  set +e
  "$@" 2>&1 | tee "$log_file"
  local cmd_status=${PIPESTATUS[0]}
  set -e
  return "$cmd_status"
}

start_log="$(mktemp -t gruvbox-start-railway.XXXXXX.log)"
cleanup() {
  rm -f "$start_log"
}
trap cleanup EXIT

if run_start "$start_log" env WATCHPACK_POLLING="$WATCHPACK_POLLING" CHOKIDAR_USEPOLLING="$CHOKIDAR_USEPOLLING" CHOKIDAR_INTERVAL="$CHOKIDAR_INTERVAL" npm run start; then
  exit 0
fi

if [[ "$( <"$start_log" )" =~ EMFILE:\ too\ many\ open\ files,\ watch|Watchpack\ Error\ \(watcher\) ]]; then
  echo "[gruvbox] Detected watcher EMFILE. Retrying with WATCHPACK_POLLING=true."
  if run_start "$start_log" env WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL="$CHOKIDAR_INTERVAL" npm run start; then
    exit 0
  fi
fi

echo "[gruvbox] Startup failed. See log: $start_log"
trap - EXIT
exit 1
