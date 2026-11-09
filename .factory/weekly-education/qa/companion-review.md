# Independent narrow review: local AI report companion

Local source/units accepted with integration limits. This companion is **not** part of the education runtime, optimized build or release acceptance. Original dirty checkout /Users/ekene/Downloads/design_handoff_radar/radar-push, HEAD f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49. Reviewed the actual final digest.ts, history.ts, digestPreferences.ts, public route and narrow10-file patch. Final patch SHA256: 915f5cbacbcd4c5110b12ad7a25bd358dbfc6e214252ed8725f3147f64fe8af4. Per-file before/after hashes and patch-base caveat are in ../companion-digest.md.

Independently reran the four developer files: **33/33 pass**, companion-tests.log. DB/transport are mocked. No source changes by QA, real DB migration, browser session or actual provider request for this companion.

Observed passes:

- Missing preference rows/default become weekly=true; storedfalse preserved. Research participation remains separate and does not default to consent.
- Current active owner and address are rechecked before dispatch; changed owner/address and guest skip. Optional HTML is frozen at enqueue and sent unchanged; old queued text-only payload and key remain unchanged.
- Purpose-separated HMAC and bounded signature parsing; business+owner identity is authoritative. Current ownership row is locked through optout write, so an old owner's token cannot change a transferred/deleted business. Caller owner/redirect cannot substitute a destination.
- GET displays a form without a preference write. Only POST disables weekly report; other email/research fields untouched. Fixed local303, no-store/no-referrer, CSP frame/form restrictions.
- QA initially found direct unbounded formData and no request-origin check. The owner fixed this through the PM. Final code calls existing assertAuthOrigin (foreign browser Origin or cross-site rejected; missing Origin permitted for API clients under existing policy), accepts only URLencoded, streams with2KB maximum independent of Content-Length, and accepts exactly one token with no other/duplicate fields. Focused final17preference tests pass, including declared/undeclared oversized bodies and cross-site requests.

Release/integration checks **blocked/not performed** here: the original branch lacks integrated-main mailbox verification, so the digest cannot yet be claimed verified-recipient-safe; its0009 migration collides with canonical signup-security0009; real PostgreSQL upgrade/constraints, browser/mobile/keyboard, provider sends and integration with shared optional cadence remain unverified. Retain as a local patch until the separate measurement feature is reconciled and independently tested against main. Its per-business Monday report policy is distinct from the account education sequence and this review does not authorize merging/deploying it.

Command: Node22.18.0 `npx vitest run src/server/services/visibility/digest.test.ts src/server/services/visibility/digestPreferences.test.ts src/server/services/visibility/history.test.ts src/lib/recommendationShare.test.ts`, from the original checkout. Tests ran without DATABASE_URL or provider configuration.
