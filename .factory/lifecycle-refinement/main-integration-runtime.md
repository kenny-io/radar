# Current-main integration runtime handoff

Engineer-owned integration of `origin/main` Autopilot `b38b67a4d48c51f39bd5fc68e1fc4143a9633060` into PR25 branch `kenny/weekly-education`, workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`. Started clean at pushed `96b3d730c0becd9066a28e2829728f0e84fd462f`. Read `.factory/lifecycle-refinement/main-integration-architecture.md` and the deployed Autopilot architecture/source. Main integration is resolved in the working tree/index, with MERGE_HEAD retained for the PM's coherent merge commit. No engineer commit, push, production write, provider send or deployment was performed.

This record supersedes the migration numbering and runtime integration instructions in earlier lifecycle/weekly/refinement engineer records. Their old local evidence remains historical; no shipped ledger was repaired to resemble a divergent old PR25 test database.

## Preserved source behavior and merged hooks

Both Settings sections remain: owner-controlled per-business Autopilot and account-level Emails. Existing no-access preference management remains outside workspace gating. Both job-registration sets remain imported. Current-main Reddit new-tab changes were retained automatically.

Billing guard retains main's exact safe business-hop parser and authorized cookie-setting route alongside existing narrow work/education/preference return paths. When a guest draft is committed during auth, canonical business/work hops are retained without appending an extra saved-profile parameter to the validated hop. No generic API or arbitrary redirect allowance was introduced.

Calendar/article manual adoption keeps `autopilotActivationId:null` while preserving transactional work-event resolution and article-to-social capture. Calendar generation retains Autopilot's guarded additive write, occupied date/keyword preservation, source provenance, effective saved settings and commit cancellation behavior; lifecycle capture stays within that same transaction. Brief first scan retains current activation checks and does not change the owner's saved briefSetup flag for master-created scans; the genuine manual first-scan flag and transactional source capture remain. Draft completion preserves main's current business/activation/connector checks and scheduling policy while retaining the existing calendar resolution/article-social hooks. Social scheduling retains program non-overwrite UPSERT semantics/provenance and wraps source-event resolution in the same transaction; manual adoption and final publication authorization remain main's behavior. Automatically completed actions still resolve reminders.

Master Autopilot handles its own follow-through and owner handoffs. `recordEngagement` and send-time `activeOwner` checks now both skip a business only when the pure main policy confirms an active authorized master activation. This prevents new parallel optional reminders and suppresses already-captured reminders when the owner delegates follow-through. It does not suppress weekly lessons or one-time guides, alter opt-outs, or delete sent history. Master-off relevant manual work retains its default-on behavior.

## Actual Autopilot email caller and transport

Main introduces a real29th user-facing family: operational Autopilot owner handoffs. The existing caller now uses PM's pure `autopilotHandoffEmail` from `legacyContent.ts`. Exact saved action drafts, HTTP(S) source links, current-business links, count and Manage Autopilot destination remain supplied by the persisted job. No regenerated model content, second campaign or extra key was added.

Handoffs remain operational mail expressly requested by enabling the business program, outside optional education/work preferences, their24h cap and daytime policy. Course/work opt-out cannot silently disable delegated failure/action reports. PM's numbered catalogue explains this exception. Existing already-persisted handoff bodies retain their original copy on retry.

General `sendMail` preserves main's fifth idempotency options argument, deterministic outbox ID, persisted subject/text/HTML, sent/logged no-POST shortcut and20second provider timeout. PR25's `CONFIRMATION_SUBJECT`, security copy and encrypted/redacted security transport remain intact.

Two approved narrow safety guards were added for unsent idempotent retries:

- Stored recipient must exactly match the caller's currently requested recipient before persisted data can overwrite arguments or any provider POST. A mismatch throws `RadarError(...,409,'mail_recipient_changed')` and preserves the original body/key/row.
- At age>=23hours from persisted outbox.createdAt, an unsent same-key retry throws `mail_retry_expired`. This older outbox lacks firstAttemptAt; createdAt is the conservative existing timestamp. No rekey/replay occurs beyond provider dedupe retention. Previously sent/logged rows retain the harmless no-send shortcut even after age/recipient changes.

`deliverHandoff` rechecks the current same owner/activation/access and now requires emailVerifiedAt. Missing/unverified ownership yields no mail. Stale-recipient/expired-window errors become controlled owner-visible lastError plus `PermanentJobError`, rather than repeated provider requests or a false success. Same-address retries inside the window retain the exact persisted body/provider key. Native provider suppression still applies. Provider acceptance does not establish inbox delivery.

## Canonical deployed migration history

Main0000–0010 SQL and canonical0010 snapshot/journal entries are unchanged. `0010_autopilot.sql` SHA256 remains `df6995cf7d0268cd918c917a28348f2049d879a8a8bf25a76d0b8c9a85888881`.

Only unpublished PR25 files/tags moved, preserving their SQL bytes:

| Old unpublished tag | Integrated tag | idx / when |
|---|---|---|
|0010_lifecycle_emails |0011_lifecycle_emails |11 /1794254096993 |
|0011_engagement_updates |0012_engagement_updates |12 /1794254096994 |
|0012_weekly_education |0013_weekly_education |13 /1794254096995 |
|0013_lifecycle_guides |0014_lifecycle_guides |14 /1794254096996 |

All four times are strictly after deployed Autopilot1794254096992. Keeping old PR25 times would cause installed Drizzle to skip the files despite renumbered names. Snapshot ancestry is canonical10→11→12→13→14; every appended snapshot contains the three deployed Autopilot fields. `drizzle-kit generate --name integration_check` reported **No schema changes**, validating the final snapshot/schema agreement and creating no extra migration.

Worker readiness includes the deployed Autopilot business/provenance fields plus all lifecycle, engagement, verified-recipient, education and guide fields. Web migration remains owner; deploy matching worker/web only after0011–0014 complete. Preserve existing Autopilot activation/provenance, preferences, course progress, outbox bodies and provider keys. No migration enrolls guides or sends mail. Rollback keeps a type-aware dispatcher paused or stops dispatch before an older binary; never run an older worker against new unknown optional types.

## Engineer verification

All database work used fresh local disposable Postgres on127.0.0.1:54329. All provider transports in engineer behavior tests were injected fakes; no real provider POST occurred. Engineer source freeze was communicated before PM's final full-suite/build and QA browser pass.

- Fresh integrated task DB `radar_main_integration_eng_20261110`: `npm run db:migrate` passed, all15 migrations applied. `/tmp/lc2-main-migrate.log`.
- Broad focused merge checks: **20files248tests passed**, zero skips/failures, covering Autopilot program/policy, lifecycle/course/guides/work reminders, calendar/drafting, billing guard and social generation/publishing. Command `DATABASE_URL=<fresh local integrated DB> RADAR_DEV_STUBS=1 RADAR_EDUCATION_EMAILS=1 APP_URL=http://localhost:3933 npm test -- --no-file-parallelism src/server/services/autopilot src/server/services/lifecycle src/server/billing/guard.test.ts src/server/services/social src/server/services/drafting src/server/services/calendar src/server/actions/article.test.ts src/server/actions/calendar.test.ts`. `/tmp/lc2-main-focused-tests.log`.
- Added **7/7** focused regression cases in `src/server/services/lifecycle/autopilotIntegration.test.ts`: stable same-window retry body/key; exact23hour refusal; old sent/logged shortcut; unverified owner; changed verified mailbox/expired handoff becoming permanent without extra POST; no delegated source capture plus suppression of preexisting optional work; manual topic adoption clearing provenance while resolving the captured reminder. `/tmp/lc2-main-regressions.log`.
- Main Autopilot fixture now creates a verified owner, matching current real-user eligibility. Dedicated new tests preserve explicit unverified exclusion; no acceptance/security assertion was weakened.
- Typecheck passed. `/tmp/lc2-main-typecheck-regressions.log`. Both staged and unstaged `git diff --check` passed. All conflict markers and unmerged index entries are resolved.
- Actual `waitForWorkerSchema` passed against the fresh integrated DB. `/tmp/lc2-main-readiness.log`.
- `node .factory/lifecycle-refinement/main-integration-migrations.mjs` passed **clean, exact deployed main0010→0014, and canonical pre-guide0013→0014** paths. Evidence `main-integration-migrations.json`, `/tmp/lc2-main-migration-proof.log`. It verifies byte-exact canonical SQL/snapshot/first11 journal entries, unchanged unpublished SQL bytes after rename, strict new timestamps, snapshot ancestry/Autopilot columns, every applied ledger checksum/time, exactly four appended production-upgrade entries, unchanged Autopilot/provenance, retained course/off preferences/attempted body, zero migration guide enrollments and a second migrate no-op. No ledger reset or checksum rewrite was used.

An attempted early baseline run overlapped the merge's temporary conflict markers and therefore produced transform failures; it is invalid as baseline/regression evidence and was superseded by the resolved-tree checks above. The PM had independently established the pre-integration source's full-suite/native-raster baseline; this engineer did not claim that full run.

Independent QA owns its migration/readiness/test/browser evidence under `qa/main-integration/`; PM owns the fresh full-suite/optimized build, final catalogue renders, final integrated source fingerprint and PR25 push. Engineer verification does not establish real inbox receipt, live hosted worker revision, actual production migration or deployment. No final commit was made: resolved main/merge files are partly staged, while renames/new SQL/snapshot and further safety/test/docs changes must all be staged in the PM's coherent final merge commit.
