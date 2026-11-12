# State
- Base: origin/main 4f1bcf83 (fetched 2026-11-12). Branch `kenny-dev/radar-contextual-images-6eb35c`, worktree `.claude/worktrees/radar-contextual-images-6eb35c`.
- Owner asked to ship (PR, merge to main, which auto-deploys).

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 diagnosis | PM | verified | brief findings | Production logs: all three image routes out of credit; template used silently. |
| T1 architecture | factory-architect | verified | AC1–AC11 | `architecture.md`; PM decisions D1–D11 in `brief.md`. |
| T2 server | factory-engineer | review | AC1–AC6, AC8–AC11 | Commits 7ee27d1e, 9f7b4915, 8a5aca3c, f830268e. Deviations listed in `verification.md`. |
| T3 client | factory-engineer | review | AC6, AC7 | Commit 3046895e. Not yet seen in a browser. |
| T4 independent QA | factory-qa | active | all | Depends on T2, T3 integrated. |
| T5 delivery | PM | planned | | PR, merge, production check. |

## Blockers
- Owner action: add credit to at least one image route (OpenRouter is first in line). Does not block the build; blocks real images in production.

## Next action
Last integrated revision: f830268e. Receive T4 QA report; fix defects; open the PR.

## Baseline (unchanged branch)
- Typecheck passes. Without a database: 2443 passed, 562 skipped, 1 failed (parity snapshot in `src/server/ai/openrouter.qa.test.ts`).
- Test database: throwaway Postgres 16 on 127.0.0.1:55432, database `radar_test`, data directory in the session scratchpad.
- With the database (`DATABASE_URL` set, run while the engineers were still reading, before any source edit): 2931 passed, 75 skipped, 14 failed in 6 files: `actions/visibility.db.test.ts` (1), `ai/openrouter.qa.test.ts` (1), `idle.cadence.db.test.ts` (5), `services/lifecycle/guides.test.ts` (2), `services/social/proactive.db.test.ts` (1), `services/visibility/digest.integration.test.ts` (4). None concerns images or drafting.
