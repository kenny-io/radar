# Production launch architecture — 2026-11-03

Confirmed workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/homepage-faq-refresh`, starting HEAD `e8514678d2c8d199c4e708d8a1edc8f64fde268b`. Existing homepage records and tsconfig changes preserved. Architect owns this record plus PM-delegated DB/readiness/SSE resilience implementation; auth/billing owned by separate engineer.

## Observed deployment (read-only Railway CLI)

Project radar `863ea66d-04b9-40e8-b27f-89a4f75c026e`; production environment `168aae6e-c038-4198-910a-e388afaac157`. Both services SUCCESS at main merge `0a9af070adb08f15ab187e11aba3108e609df018`: web `a7aa4e38-48fe-4c79-b20e-76cfbc4bcef4`, worker `24828601-cb59-4d99-b408-10563faee1dc`. One replica each, Singapore, Hobby plan. Postgres one replica with 5GB volume (~369MB used). Web and worker have no local persistent volumes.

Both runtime configurations: production URL correct, production mode, stubs disabled, encryption key present; S3/public URL/AWS credentials present; Google, full Stripe configuration, Resend/from/support, OpenRouter alias and DataForSEO credentials present. Presence is not proof of provider success. No secret values recorded. `RADAR_BILLING` and grandfather cutoff UNSET: gate is OFF. This requires PM/owner launch decision after Stripe acceptance, never enable silently. Actual deployed web healthcheck `/privacy` differs from repository `/signin`; worker has no health endpoint.

## Smallest compatible fixes / contracts

1. Auth engineer: apply shared Postgres rate limits before expensive bcrypt work; bounded input; signup conflict race maps to 409; same-origin mutation checks and browser-bound expiring atomic Google state. No new schema/infra. Preserve response shape and valid existing login compatibility.
2. SSE: existing per-tab stream does three queries every 600ms (~5 queries/second/tab). Add process-local bounded coalescing cache keyed by already-authorized business ID, retaining successful snapshots briefly and coalescing concurrent loads. No auth data cached; every connection checks actor/role/access first. Existing `rev`, `job`, `toast`, `ping` event payloads unchanged; five-minute notification window (longer than the four-minute stream lifetime) and per-stream dedup preserve notification behavior. Adaptive ~1.5s active /5s idle polling; membership/access periodically rechecked so revoked users do not keep a stream indefinitely. Cache is optimization only: each replica polls Postgres, so no cross-node correctness dependency.
3. DB: preserve default 10 connections per process, validate `DB_POOL_MAX`, finite connection acquisition timeout, and idle connection error listener. Do not globally impose SQL statement timeout in app shared pool because migrations/backfills use it too. Budget total connections as `(web replicas + worker replicas) * DB_POOL_MAX + migrations/admin headroom`; confirm database max_connections before scaling.
4. Readiness: unauthenticated GET `/api/health`, no-store; perform a bounded SELECT 1. Return only `{ok:true}`/200 or `{ok:false}`/503, no database/errors/secrets. Coalesce/cache brief probe results so monitoring cannot create query storms. Update repository Railway healthcheck to `/api/health`; PM must reconcile deployed settings/config source. Deployment health is not ongoing uptime monitoring.
5. No storage change required: live object-storage credentials already present. Verify real upload/read across web+worker. Missing S3 must be a preflight blocker for ephemeral/multi-replica launch; do not assume local disk persists.

## Existing useful safeguards

Postgres queue claims use atomic UPDATE/FOR UPDATE SKIP LOCKED; singleton queued/running index prevents duplicate enqueue; heartbeats recover stale locks; scheduler uses advisory lock and idempotency marks. Anonymous analysis and guest creation already rate limited through Postgres. Tenant APIs require active membership and billing access. S3 supports multi-replica shared files. Web migration hook exists.

## Remaining risks requiring evidence

- Heavy traffic has no stated target and no measured capacity envelope. Public-page load alone cannot prove authenticated workspace/SSE/AI capacity. Run safe local production-mode HTTP + authenticated multi-tab SSE tests, record p95/errors/query counts, then staging at agreed realistic concurrency; do not stress live paid/provider paths.
- Worker concurrency default 4 and provider quotas constrain onboarding throughput. Queue age, failure rate and provider quotas need monitoring. Avoid increasing concurrency without provider/cost budget.
- External side effects during worker shutdown can be retried (at-least-once queue): publishing handlers must stay idempotent. Long jobs heartbeat, but Promise.race timeout does not cancel underlying work. Do not claim exactly-once execution.
- Crawler automatic redirects previously contacted a private destination before rejection. Implemented manual per-hop validation, bounded redirects, no permanent DNS allow cache, and expanded private IP checks; regression tests prove private redirects are never fetched. DNS check/connect TOCTOU still requires address pinning or controlled egress for complete defense. Existing publishing HTTP helper was unsuitable for reuse because it bypasses guards outside production and supports private-host overrides; crawler remains strict.
- Confirm Postgres backup schedule and restore drill, ongoing external health monitoring, CPU/RAM limits, Google consent verification, real mail delivery, and live Stripe charge/webhook/portal acceptance. CLI service presence does not prove them.
- RADAR_DEV_STUBS is read independently of production guard in env: live disabled, but configuration preflight must fail if production is accidentally started with stubs.

## Validation and rollout

Focused tests: concurrent snapshot readers share one query batch, different businesses remain isolated, refresh after expiry, failed snapshots retry, bounded cache; readiness 200/503/no secret payload/no caching; pool options finite and invalid env rejected/defaulted. Independent QA: real browser onboarding/login, event updates and membership loss. Safe local load: read-only page/API traffic, no production credentials, synthetic local businesses, concurrent SSE readers; capture latency/error/query evidence. No live load test without explicit cap.

Deploy code with billing OFF; apply migrations via web predeploy; verify `/api/health`, signup, upload, job processing and signed Stripe delivery; then resolve paid-gate and grandfather cutoff decision. Roll back code by Railway previous deployment; retain compatible additive schema; disable billing separately if required (existing subscriptions continue billing).

Primary documentation checked: [node-postgres pool](https://node-postgres.com/apis/pool), [Railway healthchecks](https://docs.railway.com/deployments/healthchecks), [Railway config reference](https://docs.railway.com/config-as-code/reference). Railway healthchecks gate new deployments; ongoing availability requires external monitoring.

## Additional runtime evidence

Read-only equality comparison (no values printed) confirms APP_URL, encryption key, DATABASE_URL, S3 bucket/endpoint/public URL/credentials and complete Stripe configuration match between web and worker. Both Stripe secret and publishable keys are LIVE mode; S3 endpoint/public URL use HTTPS. Worker sampled bounded logs contained one start record and no claim/cron failures (limited sample, not proof of continuous health). CLI exposes no backup-status command, so backup schedule/restore evidence remains unverified.

## Implemented architect-owned changes

DB connection acquisition bounded to 5s, idle timeout 30s, idle error listener; valid max 1–100/default 10. Readiness SELECT 1 has 2s client query timeout plus at most 5s checkout, concurrent probes coalesced and result cached 1s; 200/503 response sanitized. Repo healthcheck now /api/health; actual live setting still /privacy until PM rollout. SSE snapshots coalesce per authorized business, cached 1s, max 512 entries with in-flight protection; streams poll active 1.5s/idle 5s, heartbeat15s, permissions60s, max lifetime4min. No new infrastructure or schema.

Focused validation: `npx vitest run src/server/events/cache.test.ts src/app/api/health/route.test.ts src/server/services/analysis/crawl.test.ts` — 13/13 passed. Includes 1000 concurrent same-key readers sharing one load, key isolation, cache recovery/capacity, readiness concurrency and sanitization, safe/unsafe redirect paths and redirect loop bound. This is a query-amplification regression check, not an HTTP capacity benchmark.

Final architect `npm run typecheck` PASS after integration with auth engineer fixes. `git diff --check` on owned runtime files clean. Global pool singleton now also retained in production so route bundles share the configured per-process budget. Architect runtime files are ready for PM integrated build and independent QA; nothing merged/deployed by architect.

## PM supplied read-only database evidence

PM's bounded Railway SSH read-only probe observed production `max_connections=100`, current connections10, queued jobs0, running jobs0. Architect did not independently rerun the SSH command; earlier public-URL connection attempt was blocked because DATABASE_PUBLIC_URL was absent. At default10 connections/process, budget web+worker+deployment overlap/migrations/admin before increasing replicas.

PM also implemented `env.devStubs` production-disable guard and regression coverage after this initial audit.

## Local capacity result (initial integrated build)

Architect ran strict-loopback production-build test with200authenticated sessions/unique businesses and200simultaneous SSE connections. PASS: ~147.6GET/s over36.44s, p95~631ms/p99~1398ms, zero unexpected HTTP/tenant/stream errors,600pings/70revision events, peak11DB connections (10app+sampler), scoped fixture cleanup verified. See `qa/load.md` and executable `qa/load.mts`; sparse GET-only local workload excludes external providers, worker/signup/payment capacity and is not proof of Railway capacity. Exact initial build ID`sSixJBoLn4GfQHo4grAMt`; final-binary rerun pending PM build/restart.

PM subsequently supplied dedicated Undici public dispatcher with socket DNS pinning, URL literal checks and regression tests; PM reports25focused tests plus actual native pinned crawler/publishing HTTPS200 against example.com. The earlier rebinding residual is addressed for these guarded crawler/publishing paths by the PM's integration; architect reviewed the design, not a whole-codebase network certification.

## Confirmed backup gap (read-only authenticated API)

At2026-11-02T20:35:46Z, Railway GraphQL returned HTTP200, `backups:[]`, `schedules:[]` for production Postgres volume instance`8f49b8f2-0d30-464a-a740-f229c0cbe200`. There are no Railway volume backups/schedules configured. This replaces earlier “unverified” status with a confirmed launch blocker. Evidence `qa/backups.md`; no backups created, schedules changed or production restore performed by architect. PM notified to arrange backup/schedule and recovery validation. Official API reference: [manage volumes](https://docs.railway.com/integrations/api/manage-volumes).

PM authorized additive native snapshot+DAILY schedule. API refused schedule mutation: `Manual backups and backup schedules are only available for Pro workspaces` (BAD_USER_INPUT). Current Hobby plan cannot enable native backup protection. No schedule/snapshot/upgrade/restore changes occurred. Backup blocker now requires Pro upgrade or private offsite alternative; details in qa/backups.md.

## Final-binary local capacity verification

Final production build `.next-launch-build-final`, BUILD_ID `fQAS3QW-qLMiPPO_ayayr`: 200 authenticated sessions across200unique businesses and200SSE connections;5640timedGETs over36.33s (~155.2req/s), p50~10.4ms/p95~124.6ms/p99~728.4ms. Zero unexpected HTTP/tenant/stream errors;600pings and70revision events;10cross-tenant denial checks passed; peak10appDB connections plus1sampler;100connection localDB limit. Scoped fixtures removed. `qa/load.md` preserves initial and final exact-build evidence. Limits remain local/sparse/GET-only/no provider, worker, signupCPU or payment load.

## Interim local backup

After native backups were refused on Hobby, PM authorized an immediate private local snapshot. Read-only production pg_dump18.6 transferred through SSH/base64 to ignored directory0700/archive0600:6,662,392bytes,161archive entries, SHA256 `cb8fc8b4c00794b49a24ce9958b78b3193b9a0693a1e7a7a8ea872f3a1371a6d`. pg_restore18.6 archive listing passed; isolated local restore drill proceeding separately. This is manual local protection only; recurring offsite/native backup blocker remains unresolved.

## Final recovery disposition

Private local snapshot restoration **PASS**: network-disabled disposable PostgreSQL18 restored archive with `pg_restore --exit-on-error`; five aggregate table counts matched a fresh read-only production SELECT; archive checksum/modes rechecked; disposable container/database removed. A prior comparison timeout was psql's interactive pager, fixed with `-P pager=off`; no archive/restore failure occurred. Owner explicitly chooses to keep Hobby and arrange a private backup destination. Daily/offsite protection is therefore owner-pending, with tested manual local snapshot as interim protection; no upgrade, external upload, production restore or schedule changes performed. Final details in qa/backups.md supersede the earlier initial no-backup/blocker state.
