# Engagement backend handoff

Starting revision `a96ebd9d`, branch `kenny/lifecycle-emails`. Shared changes and the unrelated indexing log are preserved. Runtime source is frozen for integrated QA; no commit, merge, deployment or real recipient/provider request was performed by this engineer.

## Implemented

- `engagement_events` migration0010 records bounded source references, owner/business, eligibility/expiry, durable source-key dedupe, lifecycle association and immutable first resolution time. Assignment tombstones sources so deleting an email cannot reopen a reminder. Three optional preferences default false, with genuine off→on consent timestamps and separate work-only signed opt-out authority. Disabling clears the consent timestamp and retires unassigned sources; queued state is independently checked before delivery.
- Source capture is inside successful first Brief save, generated Calendar plan, finished real article, actual article approval and social-pack insert transactions. Empty/failed/keep/background brief outcomes do not capture. Article generation/approval uses the same per-article source identity. New social pack immediately resolves article→social follow-through.
- Brief waits one hour, requiring current-day live reply conversations and no copied/posted/skipped/scheduled or persisted publishing attempt. Calendar waits24h and stops after any real approval/drafting of its initial generation's entries. Article waits2h, requires generated body and no article-based pack. Social pack waits24h, requires no copy or publication attempt. Copy/approval/scheduling completion hooks permanently retire sources even if the user later edits/reopens/unschedules them.
- Existing cron collects at most200 due owners and100 pending references per owner, choosing at most3 sections and at mostone per kind. No full-tenant article scan or new infrastructure. Global24h optional cap includes founder mail and ambiguous first attempts; stable oldest active owner-business timezone enforces9–18. Quiet/capped/active-queue/same-UTC-day-key owners move off the bounded due page instead of starving subsequent owners.
- Outbox insertion and source assignment are atomic under an owner transaction advisory lock. Dedicated dispatcher under its existing global lock checks current recipient, explicit preferences, current owner/member access, subscription access and actionable state. It prunes/re-renders/finalizes encrypted body before attempt1, then retries exact frozen bytes/key or suppresses the whole retry if an included action has been taken. Optional cap/quiet-hour deferrals do not increment provider attempts. Billing/security/welcome remain outside this cap. RFC8058 work-only headers use the existing signed preference endpoint.

## Ownership and integration

Owned backend changes: schema/migration0010/meta; `lifecycle/{preferences,engagement,engagementJobs,queue,dispatch}` plus new engagement tests; source hooks in Brief store/scan, Calendar jobs/actions, drafting jobs, article approval, social pack persistence; cron import in jobs/all. PM owns templates, preview and worker schema-readiness gate. Settings engineer owns authenticated settings API/UI, signed unsubscribe endpoints, deep-link landing and social publishing schedule/post completion hooks. No duplicated edits of those owned files.

Apply additive migrations0009 and0010 before new jobs begin. UI engineer applied0010 only to the isolated local `radar_lifecycle_20261103` database successfully. PM is adding a worker readiness gate for Railway's worker/web migration race; do not concurrently migrate from worker. New categories are explicitly opt-in and do not backfill historical completed work. Existing nine lifecycle events are otherwise preserved, with `work_update` as the additional conditional digest template.

## Checks

-15/15 new local database behavior tests passed: `DATABASE_URL=<isolated local radar_lifecycle_20261103> RADAR_DEV_STUBS=1 APP_URL=http://localhost:3933 npx vitest run --no-file-parallelism src/server/services/lifecycle/engagement.test.ts`. Log `/tmp/radar-engagement-backend-tests.log`. Actual initial/rescan/empty/failed Brief jobs ran using development stubs; the expected Reddit failure log comes from the deliberately failed scan. No network provider was contacted.
- Earlier focused regression run:43/43 passed (billing lifecycle8, existing dispatcher14, current PM templates21). This was before the final additional backend test/fairness-only refinements; full integrated suite remains PM-owned.
- Final `npm run typecheck` and `git diff --check` passed after the source freeze.
- Fingerprint for the18 owned source/migration/test files is in `backend-source-fingerprint.json`; this is a working-tree fingerprint, not a claim that uncommitted code equals HEAD.

Independent browser QA, integrated production build/full suite and live rollout are separate PM/QA responsibilities. Provider acknowledgment remains distinct from inbox delivery. No claim of measured35% performance, historical bulk send or live launch capacity is made.
