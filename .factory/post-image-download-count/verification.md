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

## Q1: independent QA on 62dcc6db (factory-qa, built-in browser, own Postgres container, `RADAR_DEV_STUBS=1`)
- PID-5/6/7, phone width 375px: PASS. Count is single-select 1–4, persisted after reload; keyboard selection works. Legacy `range:'many'` opens at 3, an `n:5` post opens at 4. Try again keeps `n:2`. The server rejects `n` of 5, 0 and 2.5.
- PID-1 local: PASS (sha256 of the saved blobs = the stored files, 2 and 4 images).
- PID-1 cross-origin (`S3_BUCKET=qa-dummy`, `S3_PUBLIC_URL` = a no-CORS static server, bucket copy deliberately different from local disk): PASS. Download saved the bucket bytes via `GET /api/b/{bid}/media → 200`. A direct page fetch of the bucket fails with a CORS error (the original bug).
- PID-3: PASS. A missing key gives the toast, nothing saved, media 404. With 2 images and 1 missing: "Radar couldn’t download 1 of 2 images. Try again."
- PID-4: PASS (Social pack Download visual / Download all, article Download).
- PID-2: FAIL, D1 (Medium). `%252e%252e`, `..\` and `..%5C` in a bucket URL passed `storedKey` and were resolved by the URL parser outside `<bid>/`, so a member could read another business's bucket file and paths at the bucket root. Signed out → 401, non-member → 404, Viewer → 200, invited → 404, plain `..`/foreign host/other business → 404 were all correct.
- Regression: tsc pass; vitest 549 passed, 1 failed (known baseline).

## F1: D1 fix (working tree after 62dcc6db)
- `storedKey` no longer decodes. Every segment must match `[A-Za-z0-9_-][A-Za-z0-9._+-]*` (the `objectKey` shape), the first must be the business id, and there must be more than one.
- QA's isolated repro (`storedkey-repro.ts`): all four vectors now return `key: null`.
- Unit tests added for `%252e%252e`, `..\`, `..%5C`, root escape, `.`, empty segment and bare bid. tsc pass; vitest 549 passed, 1 failed (known baseline).
