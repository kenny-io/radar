# Verification: Daily Brief post images — Download and 1–4 count

## Developer checks (working tree on `3fe684ea`)
- `npx tsc --noEmit`: pass.
- `npx vitest run`: 549 passed, 1 failed, 144 skipped. The failure is `openrouter.qa.test.ts` parity golden (`stored` hash `91d5409f…` vs `f883614e…` for a template render). It fails the same way on an untouched copy of `main` @ `3fe684ea`. Pre-existing and machine-dependent, not this change.
- New tests:
  - `src/server/services/storage.test.ts`: own bucket/local keys accepted; another business, `..`, `%2e%2e`, other hosts and lookalike hosts rejected; bucket reads rebuild the URL from the key; foreign URLs are never fetched.
  - `src/components/Visual.test.ts`: bucket URL goes through `/api/b/{bid}/media`; local URL read directly; unreadable → null, never the template (fails on the old code).
  - `src/lib/imageOptions.test.ts`: counts 1–4, clamping, legacy ranges 1–3 → 1, 3–5 → 3.

## Limits
- Local dev stores images on disk (`/api/files/…`, same origin), where the original bug doesn't happen. The cross-origin path is covered by unit tests. The production check comes after deploy.
