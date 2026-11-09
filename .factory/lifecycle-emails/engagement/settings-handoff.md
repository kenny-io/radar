# Engagement settings and links handoff

Engineer scope on branch `kenny/lifecycle-emails`, starting HEAD `a96ebd9d`. Shared worktree changes from PM/backend/QA and the pre-existing indexing log were preserved. No commit, merge, production request, provider email or live account/configuration mutation.

## Implemented

- Settings → Emails extends the established settings navigation and styles with three native, labelled opt-in checkboxes: Daily Brief follow-through, Calendar reminders, Social follow-through. The descriptions state the action-conditioned delays. Initial load, refreshing, save, saved, load retry and failed-save rollback are visible; all controls are disabled during load/save; generation tracking prevents stale responses overwriting changes.
- GET/PATCH `/api/me/email-preferences` uses the authenticated real user only, private/no-store responses, bounded strict boolean patch validation and cross-site protection. There is no user-ID argument.
- `/email-preferences?token=…` supports the new purpose-separated work token while preserving founder opt-out links. GET only validates/displays confirmation; explicit JSON POST changes only the matching preference scope. Work opt-out leaves founder, billing and security alone.
- RFC8058 POST `/api/email-preferences?token=<work token>` accepts exactly one bounded form field, `List-Unsubscribe=One-Click`, after purpose-scoped signature verification. It needs no browser session/origin; it cannot opt in or mutate security/billing. Malformed/extra/oversized body is rejected. GET has no mutating handler.
- `/email/open?businessId&kind&ref` only permits four fixed work kinds. Signed-out users go to sign-in with the validated landing preserved. Signed-in users must be an active member and actual active-business owner with current access. Resource/business association is checked before redirecting through the existing guarded `/api/b/current` cookie hop. Foreign/missing resources are refused. No arbitrary redirect URL is accepted. Responses are private/no-store, noindex/nofollow and no-referrer.
- Article-to-social links open the source step with a valid generated article selected. They do not generate, schedule or post anything.

## Files owned

`src/features/settings/EmailSettings.tsx`, `src/features/settings/SettingsPage.tsx`, `src/app/api/me/email-preferences/route.ts`, `src/app/api/email-preferences/route.ts`, `src/app/email-preferences/{page,PreferenceForm}.tsx`, `src/app/email/open/route.ts`, `src/features/social/SocialFlow.tsx`, `src/server/services/lifecycle/engagementRoutes.test.ts`.

## Verification

Applied migration0010 only to isolated local `radar_lifecycle_20261103` at127.0.0.1:54329; migration succeeded and impact-event backfill was0. Backend authorized this local application.

`DATABASE_URL=<isolated local database> RADAR_DEV_STUBS=1 APP_URL=http://localhost:3933 npx vitest run --no-file-parallelism src/server/services/lifecycle/engagementRoutes.test.ts`: **7/7 passed**. Tests cover authenticated account scoping/defaults/persistence; malformed/cross-site/oversized writes; safe preference GET; work/founder token separation; originless RFC8058 plus rejection cases; signed-out next; teammate/outsider denial; and fixed content/business destinations.

The first route run had one JSX harness failure (`React is not defined` when directly invoking the server page under Vitest classic JSX transform). Added an explicit React import to that page; all seven cases then passed. No assertion was removed.

`npm run typecheck` and `git diff --check` passed at the settings handoff. Backend is still implementing source hooks/dispatcher, so these are scoped working-tree results rather than a final integrated source fingerprint. Independent QA has the endpoint/label/flow contracts and owns real-browser verification.

## Additional agreed publishing hooks

Backend delegated `social/publish/schedule.ts` and `social/publish/send.ts`. Standalone `writeScheduled(db, …)` now wraps its scheduled write and reminder resolution in one transaction; an existing transaction remains supported. Any successfully scheduled pack post permanently resolves its social follow-through source. Failed/rolled-back scheduling does not. Later unscheduling or generation replay cannot reopen that source. Brief post scheduling never resolves a reply reminder; the target must be a reply. No edit to actions/socialPublish.ts was needed because its single/all/automatic paths already share `writeScheduled`.

The live `posted` acknowledgment remains persisted first, independent of email-table availability. A guarded reminder-resolution call follows; a failure logs static metadata and cannot lose an acknowledged post or cause a resend. The authoritative posted row remains a send-time suppression signal. This preserves the existing posting P2 guarantee.

`engagementPublishing.test.ts`3/3 plus the existing `social/publish/publish.test.ts`21/21 passed together (**24/24**). Dedicated cases verify atomic scheduling+resolution, rollback, replay/unscheduling permanence, and a reminder-write failure after actual fake-provider acknowledgment with exactly one create. These are local stub social-provider checks, not real posts or email sends.

Scoped source fingerprint (sorted relative POSIX path +NUL+raw bytes+NUL SHA256,12files): `46f3753e81b9e4daa734daa9c750a59e0446b1a161177215c1b5ab10d202c94e`. This is not the whole integrated feature fingerprint.

## QA finding EN6: signed-out return destination

Independent QA found that a signed-out work link correctly reached sign-in, but successful authentication dropped the landing because the existing `entryAfterAuth` application-path allowlist excluded `/email/open`. This was a new integration defect, not a pre-existing exception.

Added a narrow allowance in `src/server/billing/guard.ts` for exactly `/email/open` with exactly three expected query fields: UUID businessId, one of the four known kinds, and a bounded resource/date reference. Unknown keys, duplicate fields, other paths/subpaths, API paths, fragments, controls and backslashes remain refused. The landing still independently checks ownership, current membership/access and resource association before changing the business cookie. A newly committed profile does not append the unrelated `saved=profile` marker to this canonical link.

Updated routes tests now invoke the actual password sign-in route and actual Google callback with the existing local identity stub, demonstrating that both preserve the work link. They also cover rejected return paths and saved-profile claiming. **17/17** tests passed together (engagementRoutes9 +existing guard8); typecheck passed. Independent QA was notified for the real browser retest.

The preceding12-file fingerprint is historical. Current scoped13-file SHA256 under the same path+NUL+bytes+NUL algorithm: `d0c7dbb8f5f36db5cd65ce3489a3b90d0cb6a5f44270efa34ebac9a058cb0da7`. Backend/PM source is outside this scoped digest.
