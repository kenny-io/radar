# Verification

Integrated implementation verified on `kenny/lifecycle-emails`, source fingerprint `3beebabab50b13b7629a49df808231ee6e52cc6b8232f55220817e3c432b2d50` (476 files, `src/**`, `next.config.ts`, `drizzle/**`; see QA manifest). Dedicated local databases only; no production fixtures, live charges or human emails. Production deployment remains pending owner merge approval.

Implementation commit `57b69edba3f570c371a877cdfd1cdfbc2c5f5e4a`; [PR25](https://github.com/kenny-io/radar/pull/25). Final documentation-only delivery checkpoint follows this source commit. GitHub reports no status-check runs for the head; do not describe an unconfigured CI check as passed.

Primary implementation references reviewed: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) (24-hour key window) and [OWASP forgot password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Integrated checks

- Initial existing auth/billing baseline:38/38 passed. Final full database-backed suite: **920 passed,65 external-platform skips, one unchanged pre-existing raster golden failure**, across88 files. The sole difference remains `openrouter.qa.test.ts`: expected image hash `f883614e6a7dfb07`, actual `91d5409f50974af7`, matching the earlier production-launch baseline. No golden was changed, no failing test hidden. Command: `DATABASE_URL=<isolated local database> RADAR_DEV_STUBS=1 npm test`; log `/tmp/radar-lifecycle-final-tests.log`.
- Final lifecycle transport/loop checks31/31; auth28/28; billing-focused74/74. Independent auth/billing/lifecycle suite190/190, plus independently derived stale-proof and real stalled-body timeout tests2/2. New tests use actual local Postgres and fake providers; they cannot establish real Stripe email-event delivery.
- Optimized production build passed, `NEXT_DIST_DIR=.next-lifecycle-release`, build ID `t98zcdGosAvaGFXMeF-bd`; log `/tmp/radar-lifecycle-release-build.log`. Typecheck and diff checks passed; generated Next type includes are removed from the deliverable.
- Migration0009 applied on three dedicated local databases, including a fresh genuine production-runtime QA database. It adds only lifecycle mail, password-reset tokens and optional onboarding preferences. Existing production data and billing settings were not modified.

## Independent browser and worker evidence

See `verification-qa.md` and `qa/`. Real isolated Google Chrome: **45/45 dev checks and45/45 optimized production checks**, including20 email viewport cases per run. Core recovery, keyboard submission, desktop/mobile, token removal, GET safety, security headers, session revocation, old/new password behavior, expired/used/missing links, fresh same-tab fragment navigation, stale client-response handling, billing deep link/refresh, explicit optional-email opt-out, no horizontal overflow, and zero page errors all passed.

QA found and closed two defects: stale password authentication could mutate drafts before refusal; fresh reset fragments opened in the same tab were ignored. A permanent auth regression and independent browser retests cover the fixes. QA also held all four real local general-worker job slots busy; the independent mail loop processed its fixture in129ms with all four jobs still running. This is a concurrency proof, not a provider-latency or launch-capacity guarantee.

## Actual email provider smoke

`provider-smoke.ts` restricts its database to a separate local simulator database and its recipient to Resend's documented `delivered+radar-lifecycle-…@resend.dev` simulator. Existing production sending credentials were read into process memory only, never printed or saved. Actual `queueLifecycle` + `dispatchLifecycleBatch` sent welcome and password-reset fixtures once each. Both persisted `sent`, one attempt and provider acknowledgment; the connected Resend readback reported **delivered** for both. IDs: `01a1a1f9-b7b8-718f-a94f-f415efa7ca40` (reset) and `01a1a1f9-b97f-759f-8952-7aec61029985` (welcome). Synthetic accounts and encrypted local payloads were deleted afterward.

This validates the provider request path and simulator behavior. It does not demonstrate a human inbox receipt, spam placement, real paid customer events or new production deployment. No customer or support inbox was mailed. [Resend simulator documentation](https://resend.com/docs/dashboard/emails/send-test-emails).

## Rollout and limits

See `docs/LAUNCH.md` §13 and `launch-readiness.md`: apply0009 before new web serves; deploy matching web/worker source and verify the independent dispatcher. Existing secrets/sender suffice. Worker startup may precede web's migration; the mail loop retains the queue and backs off on transient database/configuration failures. No historical welcome/founder backfill or bulk campaign is scheduled. Legacy invitation/partner transport is unchanged. Monitoring, private offsite backup destination, Google public OAuth verification and one owner-controlled actual inbox receipt remain separately outstanding.
