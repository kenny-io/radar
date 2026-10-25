#!/usr/bin/env bash
# DEV ONLY. Remove the Ghost harness container and its data, and its values from harness.env.
source "$(dirname "$0")/lib.sh"
docker rm -f -v "$GHOST" >/dev/null 2>&1 || true
for k in RADAR_IT_GHOST_URL RADAR_IT_GHOST_KEY RADAR_IT_GHOST_OWNER_EMAIL RADAR_IT_GHOST_OWNER_PASS; do unset_env "$k"; done
echo "Ghost harness removed."
