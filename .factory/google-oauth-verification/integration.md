# E6 connected YouTube lifecycle implementation

19 November 2026. Engineer workspace `/Users/ekene/.codex/worktrees/radar-youtube-lifecycle/radar-push`; branch `kenny/youtube-lifecycle`; starting revision `a8956315d30c64c0427b2c962bbf06f90cb8bf83` (merged E5). Inspected actual worktree, preserved PM/QA factory records and kept E5/media roots untouched. No commit, push, merge, deployment, live post or production data/preference mutation performed by this engineer.

## Implemented contract

- Encrypted YouTube token metadata separates successful profile reads from authorization checks. Refresh preserves profile age; only successful matching-channel reads clear configuration hold and advance profile freshness. Legacy metadata falls back to immutable account creation, so the real minutes-old connection established after E5 is initialized safely instead of using an obsolete zero-account assumption.
- Provider classification distinguishes invalid_grant/revoked from invalid_client/configuration and transient quota/network errors. A lone profile API401 gets a forced refresh and read retry. Each daily request is abort-bounded at eight seconds including body consumption; four requests fit a 35-second account budget. Post-commit revoke uses the remaining budget; outstanding intent is already durable.
- Trusted cleanup locks business → account → pubs, removes account/pending grants and API-derived pub/event/legacy pack copies, invalidates attempts, and retains only owner content plus identifier-free local tombstones. Accepted/uncertain uploads retain permanent noResend; unsent drafts require explicit new approval. Claims/upserts/recovery/attempt writes enforce database predicates. Late upload/status/profile responses cannot restore removed data. An OAuth-start generation cutoff prevents a pre-cleanup in-flight consent from reconnecting a removed grant.
- User disconnect, business soft-delete/purge, observed definitive grant failure and trusted contact deletion use the same helper. Local cleanup commits before immediate remote revoke; failures leave bounded global encrypted retry intent, never restore the account. Minimal token payload is wiped on success/already-invalid/expiry/permanent failure/terminal exhaustion; a DB sweep also wipes abandoned terminal/expired payloads within 24 hours. Pending-only grants are captured for revoke and duplicate refresh credentials are deduplicated in memory only.
- Global youtube.verify / youtube.expire / youtube.revoke jobs use businessId null, independent of billing, publishing flags, account expired state and deleted-business queue filters. The minute token hook first performs bounded DB-only expiry and enqueues the daily walk, with no provider calls under cron lock. Daily keyset batches contain ten accounts, at most two network checks concurrently. Enqueue failure clears its daily once mark. Expiry batches contain at most 100 account/receipt/event/legacy/retry rows per query and continue by keyset.
- Accounts and receipts expire on immutable 28-day clocks; fresh account/grant survives an old receipt scrub. Public projections suppress stale API labels/links before worker cleanup. Configuration failures persist an explicit verification hold, stop manual/schedule/worker/pre-create paths, and recover only after successful validation. UI explains paused verification, removed history and immutable uncertain-upload state. Business restore requires YouTube reconnect; source drafts/media/options remain.
- New YouTube outcome events/logs/alerts omit API identifiers/URLs/profile labels and raw provider bodies. Safe count/enum/local-ID results are used for jobs and operator reporting. Canary tests protect action summary/event/job/notification boundaries.
- Runnable contact script defaults to dry run, validates local UUID/account tenant scope, requires matching explicit confirmation for apply, calls the same cleanup+revoke helper and verifies account/pending/pub/event removal. --report returns aggregate age/backlog/counts only. docs/YOUTUBE_DATA_LIFECYCLE.md documents verified-support request handling within seven days, maintenance, rollout, outage response and unsafe old-code rollback. Privacy accurately describes the implemented prospective behavior without claiming provider approval or backup deletion verification.

No SQL migration, dependency, requested scope, new infrastructure or global provider-identity index. Schema diff only types existing JSON payload; other platform behavior retained. Two existing tests gained non-null assertions after the payload received its real nullable TypeScript type; assertion behavior unchanged.

## Verification performed

Installed exact lockfile dependencies with Node22. Migrated isolated local **radar_youtube_lifecycle_engineer** on port54329; QA's separate database was preserved. Ignored runner `.data/youtube-lifecycle-engineer/run.mjs` reads QA's synthetic local environment, overrides engineer DB/storage/key and blanks real integration credentials. No external provider calls were made by these tests; provider boundaries use synthetic fetch/adapters/hooks.

Final Node v22.18.0 commands:

```sh
node .data/youtube-lifecycle-engineer/run.mjs npx vitest run \
  src/server/services/social/publish/youtubeRetention.db.test.ts \
  src/server/services/social/publish/youtubeLifecycle.test.ts src/lib/youtubeLifecycle.test.ts \
  src/server/services/social/publish/publish.test.ts src/server/services/social/publish/multiplatform.db.test.ts \
  src/server/services/social/publish/instagramUnified.db.test.ts \
  src/server/deletion/delete.db.test.ts src/server/deletion/restore.db.test.ts src/server/deletion/stops.db.test.ts \
  src/server/jobs/purge.db.test.ts src/server/services/social/publish/multiplatform.test.ts \
  src/server/services/social/publish/adapters.test.ts src/server/services/social/publish/youtubeOAuth.test.ts \
  src/server/services/social/publish/instagramUnified.test.ts src/lib/socialPublish.test.ts \
  src/server/services/autopilot/autopilot.db.test.ts --maxWorkers=1
npm run typecheck
git diff --check
```

**266/266 tests passed across 16 files**, including **37 new tests** (22 real-DB cases, 12 provider cases, three clock cases). Typecheck exit0, diff check clean. Final logs `/tmp/radar-youtube-lifecycle-focused.log`, `/tmp/radar-youtube-lifecycle-typecheck.log`; additional isolated22DB pass `/tmp/radar-youtube-lifecycle-final-new.log`. An earlier broad pass caught an extra business-revision increment introduced by the cleanup hook; fixed by reusing the existing deletion/purge transaction's revision change, with all original deletion/SSE assertions retained. No remaining pre-existing failure in this focused set.

New checks cover persisted cleanup/tombstones, cross-tenant/platform preservation, explicit approval, upload/status/profile barriers, forced refresh/config hold/recovery, revoked vs transient behavior, day28 boundary despite token rotation, fresh unstamped grant, receipt-only cleanup, revoke expiry/terminal/crash paths, delete/restore, real contact CLI scope/confirmation/dry-run/apply, stale OAuth start, global queue execution with billing/publishing disabled, >10 verification continuation, >100 expiry continuation, enqueue mark recovery, count-only reporting and snapshot canaries.

## Frozen inventory / integration

28 modified/new source/script/doc files SHA256 **09c649b220d1c098a31997d739ac461296f4f6cfec3c89fdce3c0b825cbefc75**, computed over sorted relative path + NUL + bytes + NUL for all modified/untracked src/scripts/docs files. All code/tests/docs frozen; only this factory record written afterward.

New: lib/youtubeLifecycle.ts and tests; publish/youtubeGuards.ts, youtubeRetention.ts, youtubeRetentionJobs.ts and lifecycle provider/DB tests; scripts/operations/youtube-data.ts; docs/YOUTUBE_DATA_LIFECYCLE.md.

Changed: publish api/accounts/youtube/oauth/jobs/pubs/schedule/send; socialPublish actions; business deletion/purge; existing social JSON payload types; SocialAccounts/PublishBox/DeleteBusiness UI; privacy page. Existing multiplatform/publish tests have type-only nullable payload assertions. PM/QA factory records not owned or altered.

Independent QA and isolated build are separate pending passes owned by QA/PM. No live Google revoke, real consent, real upload or production cleanup was tested here. Hosting backup retention has not been independently verified or attested by this patch. Google OAuth verification and YouTube upload audit remain separate approvals. Rollout must reread aggregate account/pub/freshness counts because a real account now exists, deploy web/worker together, verify global job registration/age/backlog and preserve permanent tombstones on rollback. Never use the contact apply command against production merely to gather rollout evidence.
