# State: daily-brief-rescan

Base: `3fe684ea` (main), branch `kenny-dev/daily-brief-missing-posts-271f8b`.

| ID | Task | Owner | Owns | Depends | Status | AC |
|---|---|---|---|---|---|---|
| R1 | Rescan cron, background mode, failure skip, notify/toast, query rotation, tests, docs | factory-engineer | `src/server/services/brief/**`, `src/features/brief/model.ts`, `src/features/brief/DailyBrief.tsx` (toast dedupe only), `src/server/jobs/queue.ts` (optional queued progress), `DIVERGENCES.md`, `docs/CONTRACTS.md` | — | verified | 1–7, 9 |
| R2 | Cap rule for later scans: 2 in the morning, 4 for the day (owner chose "2 more later") | factory-engineer | `src/server/services/brief/cap.ts`, `scan.ts` | — | verified | 8 |
| R4 | Follow-ups: X API reads only posts since the previous scan on background rescans; stale "Up to two" copy (settings hint, marketing card); B21 notes | factory-engineer | `sources/x.ts`, `sources/types.ts`, `scan.ts`, `rescan.ts`, `DailyBrief.tsx` (hint), `marketing/Home.tsx` (one line), `DIVERGENCES.md` | R1 | verified | 8, 9 |
| R3 | Independent QA | factory-qa | none | R1, R2, R4 | round 1 done on `d1269410`: all ACs pass except D1 | 1–9 |
| R5 | Fix D1 (stuck scan view), "Nothing new since {time}" toast, B21/B22 and CONTRACTS notes | factory-engineer | `DailyBrief.tsx`, `DIVERGENCES.md`, `docs/CONTRACTS.md` | R3 | verified | 3, 9 |
| R6 | QA recheck of D1, the toast, and regressions | factory-qa | none | R5 | verified (`147f012d`) | 3, 5, 7 |

Last integrated revision: `147f012d`, verified and release-ready. Next action: the owner reviews the PR and approves the merge (merging deploys). After the deploy, check that the worker logs show `brief.rescan` enqueuing, and that Thally's brief gains rescans during the day.
