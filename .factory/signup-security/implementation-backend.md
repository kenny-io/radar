# Backend implementation handoff

Base f9eb6178, branch kenny/signup-security, working tree (not committed by engineer). E1 owns backend implementation; unrelated dirty release notes and frontend/PM edits preserved.

Implemented S1–S6 backend boundaries:
- Pending signup never stores a registrant password or issues a session; confirmation selects mailbox-holder password. Single-use SHA256 token hashes expire after30minutes, canonical-email binding and locked identity transaction prevent replay/parallel consume. Confirmation revokes all old sessions/other tokens before authenticating and claiming same-browser guest.
- Migration0009 generated with matching Drizzle snapshot/journal; existing Google proof backfilled, all legacy Google passwords removed, all non-guest sessions revoked; password-only users remain unverified. Businesses/billing/members/guests preserved.
- currentUser, createSession and finishAuth require verified non-guest users. Legacy matching-password sign-in gets403 verification_required and no session; inbox recovery does not require old password. Unverified allowlisted admin remains401.
- Google provider identity verified via jose.jwtVerify and cached remote JWKS, with issuer/audience/signature/expiry/verified-email/sub/email bounds. Only Google subject matches authenticate an existing account; email-only collisions redirect /signin?error=google_link, including unique-insert races.
- Signup/resend require strict Turnstile siteverify success, action and APP_URL hostname with timeout; fail closed missing config/provider/test credentials in production. Explicit dev stubs only outside production. Separate GUEST_TURNSTILE_SECRET_KEY preserves unfinished guest widget seam independently from signup keys.
- Existing IP budgets retained, mail budgets3/address/hour and300global/hour shared across signup/resend. Invalid human challenges do not spend the mail budgets. Responses generic across registered addresses in normal operation. Production security-email bodies redacted in outbox and provider failures sanitized; only explicit local dev stubs capture encrypted body prefixed encrypted-auth: for QA.

## Files

New: src/server/auth/verification.ts, src/app/api/auth/verification/resend/route.ts, src/app/api/auth/verify-email/route.ts; src/server/auth/verification.test.ts, googleIdentity.test.ts, src/server/abuse/human.test.ts; drizzle/0009_signup_security.sql and meta/0009_snapshot.json.
Updated: signup/signin/Google callback, auth/session/claim/requests and affected requests/claim tests; human.ts, env.ts, services/mail.ts, db/schema.ts, testing/fixtures.ts (verified by default, explicit verified:false for unverified), AuthResult type union, migration journal.

## Evidence

Local isolated Postgres radar_signup_security; credentials from ignored0600 .data/signup-security/local-env.json passed as child environment (not printed). Migration applied. Auth/abuse developer suite:7files40tests passed; Google real-RSA claim bounds final rerun3/3. Existing focused suite before new tests27/27. Final quota-DoS ordering + finishAuth guard focused rerun:2files17tests passed (verification8+claim9); final typecheck passed. New tests cover unsafe audit paths, mailbox-selected credential, expired/replayed/parallel/wrong-email tokens, legacy recovery same ID/records, old session/token revocation, generic responses/budgets, production provider errors/redaction and retry, Google subject collision/return, cryptographic signature/claims, production Turnstile strictness and guest separation. Migration policy DML tested against transaction-local temporary legacy users/sessions; full schema migration applied on isolated database. Typecheck passed after fixing test type narrowing. git diff --check clean.

No production provider/mail/account/payment mutations or deployment performed. Real Turnstile widget/sender runtime proof and independent browser QA belong to PM/QA. No explicit provider-linking product UI added: insecure email-only auto-linking is removed. Migration credential/session revocations are intentionally irreversible; rollback must preserve hardened boundaries.

## Integrated old-contract onboarding regression

PM's full run exposed the remaining old immediate-signup assertion in src/server/actions/onboarding.test.ts. Updated that journey to assert pending signup does not claim/commit the guest, stores no password/verified timestamp and issues no user session; then decrypt the encrypted local mail capture, submit mailbox-selected password, and preserve all original active owner/timezone/destination/onboarded-once assertions plus cookie transitions. No implementation or requirement weakening.

Final isolated rerun after that test change: `vitest run src/server/actions/onboarding.test.ts src/server/auth src/server/abuse` —8files47tests passed. New temporary database radar_signup_e1_<timestamp> was created, fully migrated, and dropped in finally; QA's database was untouched. git diff --check passed. PM owns broader integrated/build results and known pre-existing image golden failure.

## User-authorized rate-limit default (supersedes mandatory-widget statements above)

User allowed leaving Turnstile when its existing hostname configuration cannot be resolved. Implemented `RADAR_SIGNUP_TURNSTILE=1` as an explicit opt-in (defaultfalse). Rate-only mode still requires real Resend configuration outside development stubs and preserves all mailbox/session/linking boundaries. Shared Postgres budgets are always active:10/IP/hour combined across signup+resend,3/address/hour and300global/hour, in addition to route-specific limits. The shared IP key uses `auth:verification:shared-ip` to avoid double-counting the older resend route's own `auth:verification:ip` counter. With opt-in enabled, missing keys/public test keys/invalid challenge fail closed; invalid challenges spend IP attempts but never mailbox/global mail quota. No automatic fallback occurs on provider failure.

Added production no-key/no-token rate-only signup, combined-IP threshold and real-Postgres global budget regression checks; enabled-mode fail-closed tests retained. E1 source freeze after final rerun. PM owns restaging and final integrated source fingerprint.

Final rate-default focused result:8files50tests passed in a newly created/migrated isolated local database, removed afterward. Typecheck and diff whitespace checks passed. Source frozen for PM/QA; only backend-owned files changed in this steering pass.
