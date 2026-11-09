# Weekly education runtime handoff

Engineer scope EDU-E1 completed on `kenny/weekly-education` in `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`. Starting revision was lifecycle PR25 `5183db55`, with an active merge from current main `1473f559`. Merge integration is committed as `bed41631544a7a484d132ca75679bbee146eae44`; education changes remain in the shared working tree for the PM's coherent final commit. PM copy/previews, architect decisions and independent QA evidence are separate ownership.

## Implemented behavior

- Five account-wide lessons, one permanent enrollment and one pending outbox step. Verified existing/new pretrial, trial, paid, complimentary and lapsed accounts enroll through bounded minute collection. Guests and unverified addresses never receive optional mail. No signup-age catch-up or historical work backfill.
- Successful provider acknowledgment and enrollment advancement commit together. Next due is actual provider acceptance plus seven24-hour days; the fifth step completes the sequence. Frozen encrypted envelopes and stable event/provider keys survive retries. Thirty-day initial queue lifetime, existing23-hour post-attempt deadline and maximum8 attempts. Terminal/ambiguous steps block for inspection instead of changing event keys or skipping a lesson. Stub `logged` does not advance production progression.
- Deterministic earliest active owned profile, else newest owned draft, else neutral member-only/fallback copy. Read-only access checks include configured grandfather eligibility without changing billing records. Names, examples and templates are bounded/escaped. Recheck current verified recipient, consent and business/access before sends; retries retain their exact body or stop when context becomes unsafe. Education outbox business FK stays NULL so business deletion preserves account history.
- Education preference defaults on, inheriting an earlier setup-email opt-out until an explicit education choice. Dedicated authenticated strict `/api/me/education-preferences` persists only the current user's boolean. Signed `.education` token supports anonymous bounded RFC8058 opt-out; GET never mutates. Off/on preserves the remaining unattempted step, while completed/ambiguous blocked sequences cannot restart.
- New/missing work preference rows are default on under the user's updated instruction. All existing stored false values remain false; the old schema cannot distinguish historical defaults from explicit opt-outs. Source hooks capture new verified-account work without a consent-since prerequisite. Explicit off still resolves work, and a later re-enable timestamp excludes events from before that re-enable.
- Founder, work and education share daytime09:00–18:00 and a rolling24-hour optional-mail cap. Education alone uses a saved draft timezone when no active owned business exists. Due education queues immediately for the next allowable slot and dispatches before work/founder, avoiding daily-work starvation. Security and urgent billing retain priority.
- Education runs a bounded read-only Resend suppression lookup before POST. Matching suppression blocks the step; missing404 permits. The single recognized HTTP401 response with bounded valid JSON object and own exact `name: restricted_api_key` permits POST using Resend’s native delivery suppression with the existing sending-only key. Unknown/invalid-key401, same code at other statuses, malformed/oversized/nonobject bodies and unavailable results defer without a delivery attempt. Every GET and POST is paced125ms. No suppression is removed.
- All lifecycle emails have a compact Email preferences footer button. Optional links open their scoped management/opt-out page; essential notices open authenticated account controls at `/email-preferences`. These controls work without a workspace/subscription, fixing QA defect EDU05-D1. In-workspace Settings → Emails keeps the same controls. Billing/security mail cannot be unsubscribed through these settings.
- `/email/learn` accepts only lesson allowlist and optional UUID, rejects unknown/duplicate parameters, preserves a narrow sign-in return and rechecks membership/ownership/access before selection. Fixed destinations only. AI Visibility lands on Performance's AI tab. Inaccessible accounts use existing setup/trial gates; no GET initiates billing, posting or generation.

## Integration and migrations

Canonical shipped `0009_signup_security.sql` is byte-identical to `origin/main`; its timestamp/checksum history remains untouched. Pending PR25 migrations were renumbered to `0010_lifecycle_emails` and `0011_engagement_updates`, with combined snapshots, followed by `0012_weekly_education`. Migration0012 adds nullable education preference, enrollment/indexes, RESTRICT pending-mail FK and new work defaults true without rewriting stored preferences. Worker readiness now includes education and email-verification columns. Web predeploy remains migration owner; deploy matching web and worker source.

Main signup verification/Google identity rules were retained in merge. Password signup sends confirmation only; welcome/founder queue transactionally after successful mailbox confirmation. Newly created Google identities are verified before enqueue. Password-reset stale-proof locking combines with verified-session checks under the user row lock. Current main daily-social idempotent creation remains, with engagement recorded only for a genuinely inserted pack.

Operational activation is separate from user email preference defaults: `RADAR_EDUCATION_EMAILS` defaults off; set `1` on the worker only after concrete release review and migration. A valid existing sending-only Resend key is sufficient through the narrowly recognized native-suppression fallback; no broader permissions or new secret are needed. Existing setup/work/security/billing behavior does not depend on this education flag. Required existing settings are `RESEND_API_KEY`, `MAIL_FROM`, `RADAR_SECRET_KEY`, `APP_URL`; no new provider or dependency.

To pause/rollback education set `RADAR_EDUCATION_EMAILS=0`. Collector stops and dispatcher defers education, preserving unattempted history. Retain all additive tables, preference choices, terminal rows and provider keys. Never delete history or manually bulk replay blocked steps; provider acceptance with lost acknowledgment is intentionally treated as ambiguous outside the retry window. Preserve signup mailbox verification and billing/security processing.

A read-only preactivation audience report can group eligibility without displaying addresses:

```sql
SELECT u.guest, (u.email_verified_at IS NOT NULL) AS verified,
       coalesce(p.education,p.onboarding,true) AS education_allowed,
       coalesce(a.status,'none') AS access_status, coalesce(a.comp,false) AS complimentary,
       coalesce(e.status,'not_enrolled') AS enrollment_status, count(*)
FROM users u
LEFT JOIN user_email_preferences p ON p.user_id=u.id
LEFT JOIN billing_accounts a ON a.user_id=u.id
LEFT JOIN education_enrollments e ON e.user_id=u.id
GROUP BY 1,2,3,4,5,6;
```

Observe counts by education enrollment status/reason and lifecycle type/status/attempts/provider-ID presence; logs use IDs and code-only errors. `sent` means provider accepted, not inbox receipt. A recognized `restricted_api_key`401 uses provider-native suppression. Other401/403 responses require configuration investigation and retain the queue; uncertain lookup errors are never treated as clear. The PM verified the production sending-only key read-only and observed the precise recognized response; this engineer made no production request.

## Engineer verification

No real provider requests, live recipients, production writes, GitHub push, merge-to-main or deploy were performed by this engineer. Provider fetches in behavior tests were injected fakes. Local Postgres only, port54329, DB `radar_education_20261109`.

- Baseline post-merge `npm run typecheck`: passed. A pre-DB test baseline passed36 tests and skipped50 database tests; no database evidence was claimed from those skips.
- `DATABASE_URL=<local task DB> RADAR_DEV_STUBS=1 RADAR_EDUCATION_EMAILS=1 APP_URL=http://localhost:3933 npm test -- --no-file-parallelism src/server/auth src/server/billing/guard.test.ts src/server/services/social/social.test.ts src/server/services/lifecycle src/server/db/workerReady.test.ts`: **17 files,153 tests passed**, zero skips/failures. Log `/tmp/education-focused-final.log`. Includes14 new education behavior/link tests and existing real database auth, lifecycle, social and startup checks.
- After QA EDU05-D1 fix and final payload/event-key validation, focused `educationRoutes.test.ts education.test.ts templates.test.ts`: **3 files,41 tests passed**. Log `/tmp/education-final-regressions.log`. Four new route regressions cover authenticated no-access preference management, origin/key/tenant isolation, scoped one-click and safe landing returns.
- Final `npm run typecheck`: passed. Log `/tmp/education-runtime-typecheck.log`. Final `git diff --check`: passed.
- `node .factory/weekly-education/runtime-migrations.mjs`: passed clean database and canonical-main9→pending10/11→12 upgrades. Both have13 journal entries, readiness fields, new defaults on, direct pending-mail DELETE rejected and account cascade successful. Upgrade preserved all stored false choices and nullable education inheritance. Evidence `runtime-migrations.json`; log `/tmp/education-migration-proof.log`. The script verifies canonical signup SQL byte identity and only creates fresh local databases.
- Useful old tests were updated for intentional contracts: password lifecycle welcome only after confirmation; returning Google login requires existing matching provider identity; missing/new work preferences default on while explicit off/re-enable boundaries retain coverage. No useful security checks were removed.

The full suite/build and independent browser/render QA belong to the PM/QA pass. Engineer verification does not establish real inbox delivery, native suppression behavior on a real recipient, deployment compatibility on the actual hosted database or provider retention behavior beyond documented contracts. Existing native-raster golden failure, if encountered by the full suite, remains a separate baseline issue; this engineer did not run or change that test.

Changed runtime groups: `.env.example`, `docs/LAUNCH.md`, `next.config.ts`; migration0012/journal/snapshot and schema/readiness; `education.ts`, `educationLinks.ts`, education/routes tests; shared lifecycle queue/dispatch/preferences/engagement/template plumbing/tests; account API, signed preference page/form, lesson landing; Settings education control and Performance initial AI tab; signup email integration tests. Full integration fingerprint is recorded in `runtime-fingerprint.json` after source freeze. No runtime files were staged, per PM's instruction to commit the integrated tree coherently.

Final narrow production-configuration correction: `education.test.ts` now adds11 cases distinguishing the exact sending-only401 fallback from invalid keys, unknown401, freeform messages, malformed JSON, array/null/prototype-only objects, oversized bodies and the same code at200/403. Focused `education.test.ts dispatch.test.ts educationRoutes.test.ts`: **3 files,43 tests passed**; final typecheck passed. Logs `/tmp/education-native-suppression-final.log` and `/tmp/education-native-typecheck-final.log`. No UI changed during this correction. Existing independent UI evidence remains separate; PM owns the final rebuilt artifact.
