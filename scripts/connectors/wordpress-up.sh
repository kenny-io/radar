#!/usr/bin/env bash
# DEV ONLY. A real self-hosted WordPress 6.x (+ MariaDB) in Docker for testing Radar's WordPress connector.
# Installs the site, creates an admin, enables pretty permalinks and generates an Application Password.
# Credentials are generated now and written to .data/connectors/harness.env (gitignored); nothing is committed.
# Usage: scripts/connectors/wordpress-up.sh        (idempotent: reuses running containers, makes a new app password)
source "$(dirname "$0")/lib.sh"
ensure_net
URL="http://localhost:$WP_PORT"

if ! docker ps -a --format '{{.Names}}' | grep -qx "$WP_DB"; then
  DBPASS="$(rand 12)"
  docker run -d --name "$WP_DB" --network "$NET" --restart unless-stopped \
    -e MARIADB_DATABASE=wordpress -e MARIADB_USER=wordpress -e MARIADB_PASSWORD="$DBPASS" -e MARIADB_RANDOM_ROOT_PASSWORD=1 \
    mariadb:11 >/dev/null
  set_env RADAR_IT_WP_DBPASS "$DBPASS"
fi
docker start "$WP_DB" >/dev/null
DBPASS="$(docker inspect "$WP_DB" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^MARIADB_PASSWORD=//p')"

# Application Passwords need HTTPS or WP_ENVIRONMENT_TYPE=local; WP_HOME/WP_SITEURL pin the host-side URL.
EXTRA="define('WP_ENVIRONMENT_TYPE', 'local'); define('WP_HOME', '$URL'); define('WP_SITEURL', '$URL');"
if ! docker ps -a --format '{{.Names}}' | grep -qx "$WP"; then
  # (the official image's .htaccess already forwards the Authorization header to PHP)
  docker run -d --name "$WP" --network "$NET" --restart unless-stopped -p "$WP_PORT:80" \
    -e WORDPRESS_DB_HOST="$WP_DB" -e WORDPRESS_DB_USER=wordpress -e WORDPRESS_DB_PASSWORD="$DBPASS" -e WORDPRESS_DB_NAME=wordpress \
    -e WORDPRESS_CONFIG_EXTRA="$EXTRA" wordpress:6-apache >/dev/null
fi
docker start "$WP" >/dev/null
echo "Waiting for WordPress on $URL …"
wait_http "$URL/wp-includes/images/blank.gif"

wp() { docker run --rm --network "$NET" --volumes-from "$WP" --user 33:33 \
  -e WORDPRESS_DB_HOST="$WP_DB" -e WORDPRESS_DB_USER=wordpress -e WORDPRESS_DB_PASSWORD="$DBPASS" -e WORDPRESS_DB_NAME=wordpress \
  -e WORDPRESS_CONFIG_EXTRA="$EXTRA" -e HOME=/tmp wordpress:cli wp "$@"; }

# The database container may still be initialising on the first run.
for i in $(seq 1 30); do wp db check >/dev/null 2>&1 && break; sleep 2; done

ADMIN_USER="radar-admin"
if ! wp core is-installed >/dev/null 2>&1; then
  ADMIN_PASS="$(rand 16)"
  wp core install --url="$URL" --title="Radar WP harness" --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASS" \
    --admin_email=admin@radar.local --skip-email >/dev/null
  set_env RADAR_IT_WP_ADMIN_PASS "$ADMIN_PASS"
fi
# Pretty permalinks (/%postname%/) so /wp-json and post URLs route through the image's .htaccess.
wp rewrite structure '/%postname%/' >/dev/null
wp rewrite flush >/dev/null

# A fresh Application Password each run (only the hash is stored in WordPress).
APP_PASS="$(wp user application-password create "$ADMIN_USER" "radar-$(date +%s)" --porcelain)"

# An Author-role user too: Authors lack unfiltered_html, so WordPress filters their post HTML (kses) — the common
# real-world case when a site owner gives Radar a non-admin account.
wp user get radar-author >/dev/null 2>&1 || wp user create radar-author author@radar.local --role=author --user_pass="$(rand 16)" >/dev/null
AUTHOR_PASS="$(wp user application-password create radar-author "radar-$(date +%s)" --porcelain)"
set_env RADAR_IT_WP_AUTHOR_USER radar-author
set_env RADAR_IT_WP_AUTHOR_PASS "$AUTHOR_PASS"

set_env RADAR_IT_WP_URL "$URL"
set_env RADAR_IT_WP_USER "$ADMIN_USER"
set_env RADAR_IT_WP_PASS "$APP_PASS"

# Check: Application Passwords are available and the REST API answers with them.
ME="$(curl -s -u "$ADMIN_USER:$APP_PASS" "$URL/wp-json/wp/v2/users/me?context=edit")"
if ! printf '%s' "$ME" | grep -q "\"slug\":\"$ADMIN_USER\""; then
  echo "WordPress REST check failed: $ME" >&2; exit 1
fi
ENVTYPE="$(wp eval 'echo wp_get_environment_type();')"

cat <<EOF

WordPress is ready ($(wp core version), environment type: $ENVTYPE).
  Admin UI:   $URL/wp-admin   (user $ADMIN_USER; password in $ENV_FILE as RADAR_IT_WP_ADMIN_PASS)

Paste into Radar → Settings → Publishing → Add connection → WordPress:
  Site URL:             $URL
  Username:             $ADMIN_USER
  Application password: $APP_PASS
EOF
