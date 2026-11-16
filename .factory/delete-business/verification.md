# Verification

Environment for every run: macOS arm64, Node 22, throwaway Postgres 16 on `127.0.0.1:55471`, a fresh database
per full run, `RADAR_DEV_STUBS=1`. No production access was used.

## Baseline, `ead40f9b` (PM)
- `npm run typecheck`: clean.
- `npx vitest run`: 4041 passed, 1 failed, 75 skipped. The failure is `src/server/ai/openrouter.qa.test.ts`
  (parity snapshot), known on `main`.

## F0, `019fba7f` (PM)
- `npm run typecheck`: clean.
- `npx vitest run src/lib/deletion.test.ts src/server/deletion src/server/billing/guard.test.ts src/server/db/workerReady.test.ts`:
  5 files, 41 passed.
- `drizzle/0019_delete_business.sql` read and compared with architecture §1.

## Integrated, `b732b39a` (PM)
- `npm run typecheck`: clean.
- `npx vitest run`: 4149 passed, 2 failed, 75 skipped (229 files).
  - `src/server/ai/openrouter.qa.test.ts`: the known failure.
  - `src/server/idle.db.test.ts`, one test: the known shared-database flake. Alone on a fresh database it passed
    twice (9 of 9).
- Wipe code read by the PM: `src/server/jobs/purge.ts`.
- UI screenshots from the UI engineer's browser pass reviewed by the PM (`ui/`, not committed).

## Engineers' own evidence
- Server (reported at `b732b39a`): `stops.db.test.ts` 10, `crons.db.test.ts` 2, `purge.db.test.ts` 16,
  `keep.test.ts` + `storage.delete.test.ts` 27, delete 10, restore 9; mutation checks on the wipe guards, the
  queue, `ai.run`, publish and send checks (each broken alone, each caught, except three backed by another layer).
- UI (reported at `29c37d6b`): 23 new unit tests; browser pass on `next dev` with fixture accounts.

## Not covered by a test
- A queued weekly AI report and a work update for a deleted business (both paths require an active business;
  confirmed by reading only).
- `backlinks/verify.ts` changes (functions not exported).
- The bucket path of `deletePrefix` against a real bucket; real Google, X and LinkedIn revokes.
- The wipe's 5-minute budget and its lock and statement timeouts.

## Fix revision, `f315d3db` (PM)
- `npm run typecheck`: clean. Only `src/features/restore/RecentlyDeleted.tsx` and a comment in
  `src/app/radar.css` changed after `b732b39a`.

## Independent QA (`qa-report.md`)
- First pass on `b732b39a`, web and worker running, Playwright with one browser context per account:
  every criterion passed except phone width (D1: wipe time cut off in Settings at 375 px; D2: `/restore`
  clipped below about 398 px). The wipe was attacked (active, inside the window, mis-dated rows, 51 due,
  `RADAR_PURGE=off`, colliding prefixes, 24 restore-versus-wipe races): nothing was wiped that must not be.
  After two wipes a text search of every row of every table found the business id nowhere; the five kept
  files were the published images and were still served.
- QA's own full runs: 4146 passed / 5 failed and 4143 passed / 8 failed, the known OpenRouter failure plus
  lifecycle and idle-cadence flakes, a different file each run, each passing alone. The feature's 17 test
  files alone: 181 passed.
- Retest on `f315d3db`: D1 and D2 fixed at 320, 360 and 375 px, desktop unchanged, restore works from both
  places at phone width, typecheck clean, the 17 feature test files 181 passed. No open defect.
- QA's screenshots (`qa/*.png`) and the UI engineer's (`ui/`) are local to the worktree and not committed;
  QA's scripts and tools are in `qa/scripts` and `qa/tools`.

## Not run by anyone
- The bucket path of the wipe against a real bucket (list, batch delete, paging).
- Real Google, X and LinkedIn revokes.
- Billing on: delete of a locked business (402) and restore without a subscription.
- Safari, Firefox, a real phone, a screen reader.
