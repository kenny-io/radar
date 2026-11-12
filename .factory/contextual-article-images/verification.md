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

## Final integrated checks, source revision 6266ec2c (2026-11-13)
| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass |
| `npm run build` | compiled |
| Full suite, no database (QA, and PM at 207ac9ab) | 2541 passed, 591 skipped, 1 failed: the parity snapshot that fails on main |
| Full suite, fresh database `radar_pm2` | 3070 passed, 75 skipped, 2 failed: the parity snapshot and one `idle.cadence.db` test, which passes alone (24 of 24) and fails on main in the shared-database run |
| Focused image, drafting, publishing, action and article-client files, fresh database (engineer and QA separately) | 1500 passed, 75 skipped, 0 failed |
| QA probes (`qa/`) | 57 passed; prompts without `literal` byte-identical to 4f1bcf83 across 69,120 requests |
| Real browser (QA, built-in browser pane, stub mode, 1024 and 375 px wide) | outage path, placeholder notice, body-images message, Viewer, locks, stale tab, both hints: pass |

## Independent QA
Three passes, in `qa.md`: first pass at 121da10a recommended not shipping (D1 major; D2, D3, D4 minor); D1, D2, D4, O1, O6 fixed in 051ade49 and 207ac9ab and confirmed at 4cc300ba, where N1 was found; N1 fixed in 6266ec2c and confirmed. D3 accepted (brief D12).

## Still not verified
- Any real text or image provider: direction quality, the literal prompt's results, real pictures.
- Production behaviour after deploy with provider credit.
- Screen readers; Editor and Admin roles in the browser.
