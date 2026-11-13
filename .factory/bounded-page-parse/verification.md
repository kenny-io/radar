# Verification

Environment: macOS arm64, Node 22.18.0, cheerio 1.2.0. Database checks use a throwaway Homebrew Postgres 16, a fresh database per run. Nothing here ran on Linux or in the production container.

## Before (PM, `main` `8e3a4da3`; the cheerio calls are the same on `b3ad2d50`)
| Check | Result |
| --- | --- |
| `node .factory/bounded-page-parse/probe/run.mjs steps-main.mjs evidence/main-steps.json 30` | Stalls of 4 s to more than 30 s on seven page shapes; one 173 KB page ends the process (heap out of memory). Ordinary 1.5 MB pages 0.31 s and 0.34 s. `probe/evidence/main-steps.json` |
| `node .factory/bounded-page-parse/probe/profile.mjs …` (seven runs) | The time is in parse5 start-tag handling, domutils `find` and `removeElement`, cheerio `map`, css-select `cachedDescendant`. `probe/evidence/main-profile.jsonl` |

## Baseline (PM, `main` `b3ad2d50`, with a database)
`DATABASE_URL=… npx vitest run`: 3,799 passed, 75 skipped, 3 failed: `src/server/ai/openrouter.qa.test.ts` (parity snapshot, known) and two tests of `src/server/services/lifecycle/dispatch.test.ts` (the shared-database flakiness, known).

## Engineer (T1), on `f96d7aa0`
| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npx vitest run src/server/services/analysis src/server/services/realCover` | 10 files, 687 tests pass |
| `npx vitest run` (no database), twice | 160 files pass, 53 skipped, 2 fail, both on `b3ad2d50` too: `openrouter.qa.test.ts`, and `src/server/actions/realCover.db.test.ts` in `afterAll` without a database |
| `sameAsMain.test.ts` against the record made on `b3ad2d50` | 8 crawls (239 pages) and 86 home pages identical |
| `node .factory/bounded-page-parse/probe/steps-reader.mjs` | every stalling page settles at 5.0 s or fails sooner; `probe/evidence/reader-steps.txt` |
| `pgrep -f max-old-space-size` after each run | nothing left |

## Integrated (PM), on `1e6ecd47`, in a separate checkout
| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `DATABASE_URL=… npx vitest run` | 3,953 passed, 75 skipped, 1 failed: `src/server/ai/openrouter.qa.test.ts` (parity snapshot, known on `main`) |
| `npm run build` | passes |
| `pgrep -f max-old-space-size=384` after the suite | nothing left |

## Independent QA (T2)
See `qa.md`.
