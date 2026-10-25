#!/usr/bin/env bash
# DEV ONLY. Tell the local receiver about a signing secret Radar generated (Add connection → Webhook → Signing secret).
source "$(dirname "$0")/lib.sh"
[[ "${1:-}" == whsec_* ]] || { echo "Usage: $0 whsec_…" >&2; exit 1; }
echo "$1" >> "$OUT/webhook-secrets.txt"; chmod 600 "$OUT/webhook-secrets.txt"
echo "Receiver now accepts that secret (re-read on every request)."
