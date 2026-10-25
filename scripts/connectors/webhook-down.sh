#!/usr/bin/env bash
# DEV ONLY. Stop the webhook receiver. Pass --purge to also delete its certificate, secrets and received payloads.
source "$(dirname "$0")/lib.sh"
PID="$OUT/webhook.pid"
if [ -f "$PID" ]; then kill "$(cat "$PID")" 2>/dev/null || true; rm -f "$PID"; fi
if [ "${1:-}" = "--purge" ]; then
  rm -f "$OUT"/webhook-*.pem "$OUT/webhook-secrets.txt" "$OUT/webhook-received.jsonl" "$OUT/webhook-receiver.log"
  for k in RADAR_IT_WEBHOOK_SECRET RADAR_IT_WEBHOOK_URL NODE_EXTRA_CA_CERTS; do unset_env "$k"; done
fi
echo "Webhook receiver stopped."
