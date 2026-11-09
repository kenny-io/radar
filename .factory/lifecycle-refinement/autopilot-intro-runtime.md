# Autopilot introduction runtime handoff

Implemented against accepted no-headings checkpoint `22267d421851bde1504282a9b0375d2e1713ecbf` in `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`. Source frozen for PM integration; no commit, merge, push, deployment, production write or real mail/provider call performed. PM copy/templates/catalogue remain separately owned.

## Behavior

`autopilot_intro` is the third finite one-time guide, using existing `lifecycle_guide` transport and per-account state/key `guide:v1:{userId}:autopilot_intro`. Observation requires verified non-guest ownership, usable deterministic owned source, active Owner-role membership and effective education permission. Every cohort starts a fresh48-hour delay at first observation; historical account age and completed manual workflows/course do not accelerate or exclude it. Existing course and guide histories are unchanged.

Any currently owned business with normalized enabled=true or nonempty enabledAt permanently records `autopilot_already_enabled`. Discovery, waiting refresh and preparation enforce this; dispatch's existing second preparation after suppression lookup catches intervening activation. Source/Owner-role loss cannot pivot the guide to another business. Unattempted relevance loss skips; attempted loss blocks without resetting payload/key/attempts. No activation/generation/billing mutation was added.

Existing education default/opt-outs, pause/resume, founder sender, signed footer, global24-hour optional cap, daytime, priorities, provider suppression, atomic acknowledgement and bounded retries apply. The introduction has no GSC dependency: its attempted retry preserves the exact frozen body/key/identity across a GSC-only change. Other guides retain their existing GSC retry check. The PM-owned active CTA uses the guarded existing business hop into Settings→Autopilot; other access contexts use existing activation/setup gates.

## Files owned by runtime

- `src/server/services/lifecycle/guides.ts`: observation delay, normalized account-wide use, Owner-only source checks, eligibility and narrow retry refinement.
- `src/server/db/schema.ts`, `drizzle/0016_autopilot_intro.sql`, `drizzle/meta/0016_snapshot.json`, `drizzle/meta/_journal.json`: additive third-ID CHECK allowlist only. Snapshot directly descends from0015; all earlier SQL/snapshots/journal entries remain unchanged.
- `src/server/db/workerReady.ts`: read-only validated CHECK capability query, in addition to existing column readiness.0015's identical columns cannot start the collector.
- `src/server/services/lifecycle/autopilotIntro.test.ts`, `guides.test.ts`, `src/server/db/workerReady.test.ts`:17 new real-DB intro tests, readiness boundary cases, and existing article-guide assertions scoped to their original guide now that independent introduction mail can exist.

## Performed verification

Node22.18.0; isolated local PostgreSQL on127.0.0.1:54329. Runtime DB `radar_autopilot_intro_eng_20261110` migrated cleanly through0016.

```
PATH=/Users/ekene/.nvm/versions/node/v22.18.0/bin:$PATH \
DATABASE_URL=postgres://postgres@127.0.0.1:54329/radar_autopilot_intro_eng_20261110 \
RADAR_DEV_STUBS=1 RADAR_FAILURE_ALERTS=off \
npx vitest run --no-file-parallelism src/server/services/lifecycle src/server/db/workerReady.test.ts
npm run typecheck
```

Result:14 test files,164 assertions passed; typecheck passed. All provider responses mocked. File parallelism intentionally disabled because dispatch takes a deployment-wide nonblocking advisory lock; concurrently dispatched test files can legitimately return without claiming another batch. Initial run exposed two preexisting guide assertions counting all families; they now assert original article identity rather than excluding the newly authorized introduction. No runtime failure was hidden.

The17 intro cases exercise all access cohorts, old-user observation/concurrency, completed-course/prior-guide preservation, secondary-business current/past-use tombstones, normalized malformed-state handling/foreign exclusion, Owner roles, guest/verification/opt-out exclusion, activation while waiting/queued/after suppression lookup/ambiguous retry, stable retry across GSC changes, long preference pause, weekly priority and cap.

Reproducible local-only migration proof: `.factory/lifecycle-refinement/evidence/autopilot-intro/migration-proof.ts`, run with fresh `radar_autopilot_intro_upgrade_eng_20261110` DATABASE_URL and `node --import tsx`. It proves clean17 migrations;0015→0016 upgrade; old CHECK rejecting intro and startup; new CHECK admitting intro and startup; completed course, both existing guide states, pending attempted encrypted fixture and explicit off preferences unchanged; prior16 ledger rows unchanged; no-op rerun. JSON results, affected test log and exact runtime SHA256 fingerprint are in the same evidence directory.

## Integration and limits

Apply0016 with ordinary web predeploy migration before worker admission; readiness fails closed until the CHECK is upgraded. No backfill/reset or rollout flag change is needed here. Existing operational education flag remains the release control. For rollback to code that rejects this ID, pause that flag and preserve states rather than delete/rekey mail.

This engineer did not perform independent QA, browser navigation/render inspection, final optimized build or full unrelated repository suite. PM/QA own those separate checks. Provider acceptance remains distinct from inbox delivery, and an already in-flight provider POST cannot be recalled. No new UI, service, subscription permission or automatic program activation was introduced.
