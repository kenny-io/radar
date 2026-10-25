#!/usr/bin/env bash
# DEV ONLY. A real Ghost 5.x (SQLite) in Docker for testing Radar's Ghost connector.
# Scripts the first-run owner setup, then creates a custom integration through the admin session API to get an
# Admin API key. Credentials are generated now and written to .data/connectors/harness.env (gitignored).
# Usage: scripts/connectors/ghost-up.sh        (idempotent: reuses the running container and the existing integration)
source "$(dirname "$0")/lib.sh"
ensure_net
URL="http://localhost:$GHOST_PORT"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$GHOST"; then
  # development mode + SQLite; staff device verification off (it e-mails a code on every new sign-in and there is no
  # mail transport); url must match the published port.
  docker run -d --name "$GHOST" --network "$NET" --restart unless-stopped -p "$GHOST_PORT:2368" \
    -e NODE_ENV=development -e url="$URL" -e security__staffDeviceVerification=false \
    -e database__client=sqlite3 -e database__connection__filename=/var/lib/ghost/content/data/ghost.db \
    ghost:5-alpine >/dev/null
fi
docker start "$GHOST" >/dev/null
echo "Waiting for Ghost on $URL …"
wait_http "$URL/ghost/api/admin/site/" 120
until curl -sf "$URL/ghost/api/admin/site/" >/dev/null; do sleep 2; done

[ -f "$ENV_FILE" ] && source "$ENV_FILE"
OWNER_EMAIL="owner@radar.local"
OWNER_PASS="${RADAR_IT_GHOST_OWNER_PASS:-$(rand 12)Aa1!}"
OUTPUT="$(GHOST_URL="$URL" OWNER_EMAIL="$OWNER_EMAIL" OWNER_PASS="$OWNER_PASS" node "$(dirname "$0")/ghost-setup.mjs")"
KEY="$(printf '%s' "$OUTPUT" | sed -n 's/^KEY=//p')"
[ -n "$KEY" ] || { echo "Ghost setup failed: $OUTPUT" >&2; exit 1; }

set_env RADAR_IT_GHOST_URL "$URL"
set_env RADAR_IT_GHOST_KEY "$KEY"
set_env RADAR_IT_GHOST_OWNER_EMAIL "$OWNER_EMAIL"
set_env RADAR_IT_GHOST_OWNER_PASS "$OWNER_PASS"
VERSION="$(curl -s "$URL/ghost/api/admin/site/" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"

cat <<EOT

Ghost is ready (version $VERSION).
  Admin UI:   $URL/ghost   ($OWNER_EMAIL; password in $ENV_FILE as RADAR_IT_GHOST_OWNER_PASS)

Paste into Radar → Settings → Publishing → Add connection → Ghost:
  Site URL:       $URL
  Admin API key:  $KEY
EOT
