# Local connector harness (DEV ONLY)

Real WordPress, real Ghost and a signature-checking webhook receiver on your machine, so Radar's WordPress, Ghost and
Webhook connectors can be exercised end to end, from the integration tests and from the app. Nothing here is used in
production. Credentials are generated when the scripts run and written to `.data/connectors/harness.env` (gitignored,
mode 600); nothing secret is committed.

| Piece | Script | Container / process | URL |
|---|---|---|---|
| WordPress 6.x + MariaDB 11 | `wordpress-up.sh` / `wordpress-down.sh` | `radar-conn-wp`, `radar-conn-wp-db` | http://localhost:8381 |
| Ghost 5.x (SQLite) | `ghost-up.sh` / `ghost-down.sh` | `radar-conn-ghost` | http://localhost:2381 |
| Webhook receiver (HTTPS, self-signed) | `webhook-up.sh` / `webhook-down.sh [--purge]` | `node webhook-receiver.mjs` (pid in `.data/connectors/webhook.pid`) | https://localhost:9381/hook |

Ports can be changed with `RADAR_WP_PORT`, `RADAR_GHOST_PORT` and `RADAR_HOOK_PORT`. All containers share the Docker network `radar-conn-net`.

## Start

```sh
scripts/connectors/wordpress-up.sh   # installs the site, admin "radar-admin", an Author "radar-author", pretty permalinks,
                                     # WP_ENVIRONMENT_TYPE=local (Application Passwords over http), fresh application passwords
scripts/connectors/ghost-up.sh       # owner setup via /authentication/setup/, then a "Radar" custom integration → Admin API key
scripts/connectors/webhook-up.sh     # self-signed cert for localhost + a test signing secret; receiver in the background
```

Each script is idempotent and prints what to paste into Radar's **Add connection** form. Re-running `wordpress-up.sh`
issues new application passwords (old ones keep working).

## Run the integration tests

```sh
set -a; source .data/connectors/harness.env; set +a     # also sets NODE_EXTRA_CA_CERTS for the receiver's certificate
npx vitest run src/server/services/publishing                        # connector suites (*.live.test.ts) + regression tests
DATABASE_URL=postgres://… npx vitest run src/server/services/publishing # adds publisher.live.test.ts (retry, refresh, 401, unreachable)
```

Each live suite is skipped when its `RADAR_IT_*` variables aren't set, so plain `npm test` is unaffected.
`NODE_EXTRA_CA_CERTS` is only read when Node starts: export it before running vitest or the dev server.

## Use the app against them

```sh
set -a; source .data/connectors/harness.env; set +a
export DATABASE_URL=… RADAR_DEV_STUBS=1 RADAR_ALLOW_PRIVATE_HOSTS=1 RADAR_REAL_CONNECTORS=wordpress,ghost,webhook PORT=3201 APP_URL=http://localhost:3201
npm run dev
```

Export everything in the shell: the worker (`tsx`) doesn't read `.env.local`, and it is the worker that publishes. If the
worker misses `RADAR_REAL_CONNECTORS`, **Test connection** is real but **Publish** is stubbed and "Published" points at a made-up URL.

Then Settings → Publishing → Add connection:

- **WordPress**: Site URL `http://localhost:8381`, Username `radar-admin` (or `radar-author`), the application password printed by `wordpress-up.sh`.
- **Ghost**: Site URL `http://localhost:2381`, the Admin API key printed by `ghost-up.sh`.
- **Webhook**: Endpoint `https://localhost:9381/hook`. Copy the signing secret Radar shows, then run
  `scripts/connectors/webhook-secret.sh whsec_…` so the receiver accepts it (it re-reads secrets on every request).
  Add `?status=500` (or any status) to the endpoint to drill failures and retries.

What arrived at the receiver: `.data/connectors/webhook-received.jsonl`, or `GET https://localhost:9381/__received`
(`?id={article id}` filters). Each row records the headers, the parsed body and whether the signature verified.
For `article.published` the receiver replies `{ "url": "https://localhost:9381/posts/{slug}" }` and serves that page, so **View post** works.

## Tear down

```sh
scripts/connectors/wordpress-down.sh
scripts/connectors/ghost-down.sh
scripts/connectors/webhook-down.sh --purge
```

The down scripts delete the containers with their data and remove their values from `harness.env`.
