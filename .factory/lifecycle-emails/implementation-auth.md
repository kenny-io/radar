# EMAIL-E2 auth and recovery handoff

Implemented against source base `963a2d59`, branch `kenny/lifecycle-emails`, in the shared isolated worktree. Preserved other agents' files and unrelated search-indexing edits. No commit, provider send or production mutation performed.

## Behavior

- Password and new Google signup insert welcome and 24-hour founder-note emails in the same transaction as account creation. Unique-account races enqueue only for the winning creation; ordinary sign-in and guest creation enqueue neither.
- `POST /api/auth/forgot-password` returns the same response for unknown, Google-only and password accounts. Queue-only work has a minimum 250ms response floor. Shared database rate limits cover normalized, hashed email (three/hour) and source IP (ten/15minutes); cross-origin and oversized requests are rejected. No user-existence indicator or reset token is returned.
- Password accounts receive a 32-byte random token stored only by SHA-256 in `password_reset_tokens`, expiring after one hour. The reset URL uses a fragment, which is removed from browser history after parsing. The entire email payload is encrypted by the shared lifecycle queue. GET does not consume the token.
- `POST /api/auth/reset-password` validates eight-character/72-UTF8-byte password limits. A user-row lock serializes reset consumption, including different valid tokens. Successful reset changes the bcrypt hash, marks all reset tokens used and deletes all account sessions atomically. No automatic sign-in occurs.
- A stale-password sign-in cannot create a fresh session after reset: `finishAuth` accepts an optional expected hash; password sign-in supplies it, and `createSession` locks the user and compares the current hash before inserting its session. Google retains its independent verified-Google credential flow.
- Recovery pages extend the existing AuthShell/fields/buttons, including disabled-before-hydration forms, working keyboard submit, request/sent and reset/success states, invalid/expired and rate-limit errors, recovery links and support contact. Recovery routes publish noindex/nofollow, no-referrer and no-store headers; metadata also disables indexing/referrers.

## Verification

Dedicated local database: `radar_lifecycle_20261103` on localhost54329. Applied shared migration0009 using `npm run db:migrate` (passed, no backfill events). No real email provider configured or called.

`DATABASE_URL=<local fixture database> RADAR_DEV_STUBS=1 npm test -- src/server/auth/passwordReset.test.ts src/server/auth/signupEmails.test.ts src/server/auth/requests.test.ts src/server/auth/claim.test.ts`

Result: **27 passed / zero skipped / zero failed**, four test files. New tests cover response equivalence, encrypted reset payload and hashed token, reset/session invalidation, old-password refusal/new-password acceptance, concurrent distinct-token consumption, stale-password session proof, expiry/validation, throttling/origin/body boundaries, concurrent signup dedupe, delayed founder note, Google returning-user and guest exclusions. Existing auth and guest-claim regression tests also passed.

`npm run typecheck`: passed on the integrated working tree at this checkpoint. `git diff --check`: passed. Logs: `/tmp/radar-lifecycle-e2-final-tests.log`, `/tmp/radar-lifecycle-e2-final-typecheck.log`.

Independent browser/mobile verification and the final integrated production build are reserved for PM/QA. Actual inbox receipt and production deployment remain untested. Shared transport handles reset send-time expiry/consumption suppression and provider acknowledgments separately.

## QA regression follow-up

Independent QA found that a stale password proof could mutate guest/account drafts before the session proof check. PM fixed `claimGuest` to lock and verify the real account's password proof before any guest/draft mutation; `finishAuth` forwards the proof, and password signup supplies the newly created hash too. No PM source changes were reverted.

Added a durable regression to `passwordReset.test.ts` that performs an actual reset, then calls stale `finishAuth`. It verifies both complete onboarding draft rows, their member rows, the guest user/session/cookie remain intact, with no account session or claim/replacement events.

Repeated the same four-file auth command: **28 passed / zero skipped / zero failed**. Typecheck and `git diff --check` passed. New logs: `/tmp/radar-lifecycle-e2-proof-regression.log` and `/tmp/radar-lifecycle-e2-proof-typecheck.log`. Combined owned source/test fingerprint (including PM's proof-boundary fixes): `766740356fa742df2f0abb869775538e50317f4ebe0641f99272b9004beddb9f`.

Independent browser QA also found that opening a fresh reset-email fragment in an already open reset page did not read the new token. `PasswordRecovery` now listens for hash-only navigation, resets the stale form state for each fresh nonempty fragment, and removes the fragment after reading it. Initial StrictMode effect replay preserves the previously read token. Generation/in-flight refs prevent old request completions from overriding a newly opened link and prevent duplicate immediate submits. `npm run typecheck` and `git diff --check` passed after this UI-only fix (`/tmp/radar-lifecycle-e2-hash-typecheck.log`); production rebuild and independent browser regression retest remain with PM/QA.

## Files owned

`src/server/auth/{signupEmails.ts,signupEmails.test.ts,passwordReset.ts,passwordReset.test.ts}`, new forgot/reset password API routes and auth pages, `src/features/onboarding/PasswordRecovery.tsx`, signin recovery link in `Signup.tsx`, signup/Google/signin handlers, bounded race fix in `auth/{session.ts,claim.ts}`, and recovery headers in `next.config.ts`.
