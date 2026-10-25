#!/usr/bin/env bash
# DEV ONLY. Start the local HTTPS webhook receiver (scripts/connectors/webhook-receiver.mjs) in the background.
# Radar's webhook connector only accepts https:// endpoints, so this creates a self-signed certificate for localhost.
# Start Radar's dev server with NODE_EXTRA_CA_CERTS pointing at it (harness.env exports it) so Node trusts it.
source "$(dirname "$0")/lib.sh"
CERT="$OUT/webhook-cert.pem"; KEY="$OUT/webhook-key.pem"; PID="$OUT/webhook.pid"
if [ ! -f "$CERT" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT" -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
  chmod 600 "$KEY"
fi
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
SECRET="${RADAR_IT_WEBHOOK_SECRET:-whsec_$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')}"
set_env RADAR_IT_WEBHOOK_SECRET "$SECRET"
set_env RADAR_IT_WEBHOOK_URL "https://localhost:$HOOK_PORT/hook"
set_env NODE_EXTRA_CA_CERTS "$CERT"
touch "$OUT/webhook-secrets.txt"; chmod 600 "$OUT/webhook-secrets.txt"

if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then kill "$(cat "$PID")"; sleep 1; fi
HARNESS_DIR="$OUT" RADAR_HOOK_PORT="$HOOK_PORT" RADAR_IT_WEBHOOK_SECRET="$SECRET" \
  nohup node "$(dirname "$0")/webhook-receiver.mjs" >> "$OUT/webhook-receiver.log" 2>&1 &
echo $! > "$PID"
for i in $(seq 1 20); do curl -sk -o /dev/null "https://localhost:$HOOK_PORT/__received" && break; sleep 0.5; done
curl -sk -o /dev/null "https://localhost:$HOOK_PORT/__received" || { echo "Receiver didn't start; see $OUT/webhook-receiver.log" >&2; exit 1; }

cat <<EOT

Webhook receiver is running (pid $(cat "$PID"), log $OUT/webhook-receiver.log).
  Received payloads: $OUT/webhook-received.jsonl   (or GET https://localhost:$HOOK_PORT/__received)

Start Radar with:   set -a; source $ENV_FILE; set +a; npm run dev     (NODE_EXTRA_CA_CERTS trusts the receiver's certificate)
Paste into Radar → Settings → Publishing → Add connection → Webhook:
  Endpoint URL:  https://localhost:$HOOK_PORT/hook          (add ?status=500 to drill failures)
Then register the signing secret Radar shows:   scripts/connectors/webhook-secret.sh whsec_…
EOT
