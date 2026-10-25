#!/usr/bin/env bash
# DEV ONLY. Remove the WordPress harness containers and their data, and its values from harness.env.
source "$(dirname "$0")/lib.sh"
docker rm -f -v "$WP" "$WP_DB" >/dev/null 2>&1 || true
for k in RADAR_IT_WP_URL RADAR_IT_WP_USER RADAR_IT_WP_PASS RADAR_IT_WP_AUTHOR_USER RADAR_IT_WP_AUTHOR_PASS RADAR_IT_WP_ADMIN_PASS RADAR_IT_WP_DBPASS; do unset_env "$k"; done
echo "WordPress harness removed."
