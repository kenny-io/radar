# Shared settings for the local connector harness (sourced by the *-up.sh / *-down.sh scripts). DEV ONLY.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/.data/connectors"          # gitignored (.data): generated credentials, certs, received webhooks
mkdir -p "$OUT"
ENV_FILE="$OUT/harness.env"

NET="radar-conn-net"
WP_PORT="${RADAR_WP_PORT:-8381}"
GHOST_PORT="${RADAR_GHOST_PORT:-2381}"
HOOK_PORT="${RADAR_HOOK_PORT:-9381}"
WP_DB="radar-conn-wp-db"
WP="radar-conn-wp"
GHOST="radar-conn-ghost"

ensure_net() { docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null; }

# set_env KEY VALUE — upsert "export KEY='VALUE'" in harness.env
set_env() {
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  local tmp; tmp="$(mktemp)"
  grep -v "^export $1=" "$ENV_FILE" > "$tmp" || true
  printf "export %s='%s'\n" "$1" "$2" >> "$tmp"
  mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}
unset_env() { [ -f "$ENV_FILE" ] || return 0; local tmp; tmp="$(mktemp)"; grep -v "^export $1=" "$ENV_FILE" > "$tmp" || true; mv "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"; }

# wait_http URL [tries] — until the URL answers with any HTTP status
wait_http() {
  local n=0
  until curl -s -o /dev/null "$1"; do n=$((n + 1)); [ "$n" -ge "${2:-90}" ] && { echo "Timed out waiting for $1" >&2; return 1; }; sleep 2; done
}
rand() { openssl rand -hex "${1:-12}"; }
