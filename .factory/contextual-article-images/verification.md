# Verification

## PM integrated checks, revision f830268e (2026-11-13)
Environment: macOS, Node 22.18, throwaway Postgres 16 on 127.0.0.1:55432. No provider keys in this workspace, so no real image or text model was called.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | pass |
| Full suite, no database | `npx vitest run` | 2528 passed, 578 skipped, 1 failed. Baseline on 4f1bcf83: 2443 passed, 562 skipped, 1 failed. Same single failure: parity snapshot in `src/server/ai/openrouter.qa.test.ts`. |
| Full suite, fresh database `radar_pm` | `DATABASE_URL=… npx vitest run` | 3038 passed, 75 skipped, 8 failed in 5 files: the parity snapshot, `idle.cadence.db` (2), `idle.db` (1), `lifecycle/autopilotIntegration` (1), `lifecycle/founderIdentity` (3). |
| The four non-parity failing files, each alone, same database | `npx vitest run <file>` | all pass (9, 24, 7, 16 tests) |
| Image, drafting and publishing tests alone, with database | `npx vitest run src/server/services/drafting src/lib/articleImages.test.ts src/server/services/articleImagesFallback.test.ts src/server/services/imageAvailability.test.ts src/server/services/images.records.test.ts src/server/services/publishing src/server/actions/customImages.db.test.ts src/server/ai/tiers.test.ts` | 1403 passed, 75 skipped, 0 failed |

The with-database suite is not stable when all files share one database: the baseline run on 4f1bcf83 failed 14 tests in the same families (idle cadence, lifecycle, visibility digest, social scheduling), and the set differs from run to run. None of those files is touched by this change and each passes alone.

## Engineer deviations from the design (T2)
- An answer in which every slot fails validation is stored as `source: 'fallback'`, so it is not cached.
- The number check compares whole number tokens, not substrings.
- The dev stub's cover direction uses the title, not the keyword.
- The publisher's late cover render passes `literal` when the direction is Radar's.
- A stale placeholder mark is removed when a draft or restyle ends with no cover.
- `publishing/observability.test.ts` mock exports `renderImageFile`.
- The `ai_calls` test is its own file, `imageDirections.record.test.ts`.
- `bodyImages.db.test.ts` cleanup retries on deadlock.

## Not verified
- Direction quality and literal-prompt results against a real model (no key with credit anywhere: production routes are out of credit).
