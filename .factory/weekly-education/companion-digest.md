# Local AI digest companion handoff

Status: LOCAL ONLY, original dirty checkout `/Users/ekene/Downloads/design_handoff_radar/radar-push`, HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. No commit, staging, production writes, migration execution, or provider sends. Patch is against the pre-task dirty source, not HEAD. It deliberately excludes unrelated existing changes and does not bring measurement into the education branch.

## Implemented

- New/missing weekly preferences are on; explicit stored false remains off. Research consent remains separate and defaults absent.
- Cron and dispatch use LEFT JOIN; cron uses COALESCE true. Active non-guest business owner and collected answers required; dispatch checks current active status, owner identity, recipient address and explicit optout. Per-business weekly key/atomic mark/maxAttempts remain unchanged.
- Newly queued reports freeze HTML and text including Email preferences. HTML escapes dynamic content and includes visible linked footer button. Existing queued plaintext payloads continue unchanged with their old idempotency key; retries never regenerate content or upgrade their footer.
- Public `/ai-email-preferences`: GET only displays form, POST only disables this report. Uses purpose-specific HMAC-SHA256 with RADAR_SECRET_KEY, signed business+owner identity, signature bounds/constant-time comparison. Only one token form field is accepted; extra identity/redirect fields and duplicate tokens are rejected. POST uses existing assertAuthOrigin policy against configured APP_URL (absent Origin allowed for non-browser clients, explicit foreign Origin/cross-site denied), accepts only application/x-www-form-urlencoded, and enforces a 2048-byte body cap during streaming even when Content-Length is absent or misleading. POST locks current business ownership through transaction before upserting weekly=false. No paid access/session dependency; no study/other-email update. Fixed local 303 confirmation destination. Responses use no-store/no-referrer; HTML disables framing and indexing.

## Verification

- Before edits: `npm run typecheck` PASS.
- After edits: `npm run typecheck` PASS.
- `npx vitest run src/server/services/visibility/digest.test.ts src/server/services/visibility/digestPreferences.test.ts src/server/services/visibility/history.test.ts src/lib/recommendationShare.test.ts`: 4 files, 33 tests PASS after independent QA-requested origin/body hardening.
- Coverage: missing-pref allowance, explicit off/guest/recipient/owner absence skip, active/current-owner SQL predicates, LEFT JOIN/default-on cron predicate, pre-cadence/no-answers skip, repeated Monday key dedupe, frozen new HTML and old plaintext payload/key, preference defaults/reload-off/study-only write, viewer denial, GET harmless, forged/malformed/Unicode signature rejection, current-owner optout lock and cross-owner/deleted-owner rejection, client identity/redirect/duplicate fields rejected, configured origin accepted, foreign Origin/cross-site denied, JSON/multipart/plain content types denied, declared/streamed/misleading-length oversized bodies rejected. Measurements' five existing tests unchanged and pass.
- DB/transport mocked. No live Postgres schema application, browser layout/keyboard smoke, or real provider test. No independent QA claimed. SQL assertions plus schema metadata test do not substitute for fresh migration execution/real DB constraints.

## Integration / limits

Retain as a separate measurement-feature companion. Apply `companion-ai-digest.patch` only to the matching pre-task original source or manually reconcile the narrow hunks. Do not apply against education main where those measurement tables/services do not exist. Ten files in the patch; schema.ts change is exactly weeklyEmail default, snapshot change exactly weekly_email default. No journal rewrite. The unshipped 0009 migration collides with canonical migration numbering and must be reconciled during that feature release; do not rewrite an applied production migration. A database already created with weekly default false needs a separately reviewed ALTER COLUMN DEFAULT true (no update/backfill of existing false). Do not blanket-enroll research consent. RADAR_SECRET_KEY must be configured in production; key rotation invalidates old preference links. Tokens intentionally remain usable for the same owner until ownership or signing key changes. Existing old queued messages intentionally retain old footer behavior.

**Verified-mailbox integration blocker:** this original source base predates the verified-mailbox schema. This companion does not invent a verified flag or claim verified-recipient safety. Before releasing the measurement feature, integrate canonical main / PR26 mailbox verification and enforce that eligibility at scheduling and dispatch alongside the migration reconciliation above. The original companion is not verified-mailbox safe in isolation and remains unreleased.

This report stays per business, Monday after 08:00 UTC, collected-data gated. It does not inherit account-scoped education cadence/caps, does not send to every team member, and is not the five-lesson educational sequence. Browser preference checkbox currently binds the effective server boolean, so missing rows render checked automatically; component not modified. Public form only turns off; signed-in Performance controls can turn it back on.

## Exact pre-task / final file SHA256

Empty before hash denotes a new file.

| File | Before | After |
|---|---|---|
| `src/server/services/visibility/digest.ts` | `4697312eeb788ffbccdaab9b4065471cb186e99c2413a6396ec0f968c57c1758` | `5f6d1222ef7983f6428a50d147f58954dab5a41e0970f40d617b6fcdcbc49855` |
| `src/server/services/visibility/history.ts` | `b519b0aa49ba4527b2ee1f4bdf228059d033199fd665d3c4fec4f829d257a1e7` | `0c8c68697118ca939734654005200bcb05edca7cd5388a30dd1fa2334e64135d` |
| `src/server/db/schema.ts` | `c38a587191558682ac5eaaaefe7fffe923d68ac1e71a43ee18735f0d025251e8` | `6b39c1c655ad59010a0b4fc46884eccb348b1bbfe3c21dea3e1488697997fd9d` |
| `drizzle/0009_recommendation_share.sql` | `687356181ab220fb443d4a66e67c4e22a752cada819d57abcd1463db48a839dd` | `c1b60ca1da7ba07ff2ba2191b2b84bc70b2655ed7b699e74f2f2a4a3169bac43` |
| `drizzle/meta/0009_snapshot.json` | `ca6edee834e10ddd851ac518b47ef73a9fd9af112ce7916770ddb80894b8ef72` | `7f106322dbde24ca7fc47e485ffbe1efde34fdea44ab5f0cc0e779cd9680eb96` |
| `src/server/services/visibility/digestPreferences.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `eb7f14ec4ecc59bbdd49818c8da56f38e22ec19a71c2c5db882f76e13d2e65e6` |
| `src/app/ai-email-preferences/route.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `8a659ad1e1b4e416ae5abc32de786e1bc2960563dc653e63280d92cc81d38bf1` |
| `src/server/services/visibility/digest.test.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `9ed30c0f78cc7d3ced4e53844297e814475bba9c79db26e300e10818c68aaffe` |
| `src/server/services/visibility/digestPreferences.test.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `3d1866da577b4a74ff2887c46688269564d7d9385990bed2515ddfdb116632d5` |
| `src/server/services/visibility/history.test.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `8bbe12aef46a2f2224496f45e8f1e6fbbfa0b1a0795a5727072a77f6a8445a89` |
