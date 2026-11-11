# Verification

## Baseline (PM-1, 11 Nov 2026, Node 22.18.0, `51cc99bc`, clean tree)

- `npx vitest run src/server/services/publishing`: 18 files passed, 9 skipped; 408 tests passed, 51 skipped (live-credential suites).

## Diagnosis evidence (read-only)

- Railway worker logs per deployment (`railway logs --service worker <deployment> --lines 3000 --json`): terminal `publishing.entry` failures listed in `brief.md`. Deployment `ca5180f9`, 2026-11-10T05:01:05Z, entry `e_tl6rSYPs`: `unavailable source: apps/web/app/blog/posts.ts (144591 bytes; limit 100000 bytes)`.
- `gh api repos/kenny-io/LivedHQ/contents/apps/web/app/blog`: `posts.ts` is 186,081 bytes on `migrate/netlify`; 25 inline post records; no `radar/` branch other than the merged `radar/1-bedroom-apartment-for-rent-in-dubai-MCOBF9hZ`; no Manazel article in the file.

No implementation checks have run yet.
