# State
- Base: `main` `691806da`. Branch `kenny-dev/cool-dirac-60b241`, worktree `.claude/worktrees/cool-dirac-60b241`.
- Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 owner question and brief | PM | verified | scope | Owner's answer quoted in `brief.md`. |
| T1 architecture | factory-architect | verified | AC1–AC11 | `architecture.md` |
| T2a step 0 | factory-engineer | verified | AC2, AC4 | `0535e6d2` |
| T2 server | factory-engineer | verified | AC1–AC6, AC8, AC10, AC11 | `71489967`…`fe1b91b8` |
| T2b, T2c fixes | factory-engineer | verified | QA D1–D6, N1–N3 | `8227adb1`…`2b034f26`, `c7366c7e`…`9e7683c6` |
| T3 client (Media panel) | factory-engineer | verified | AC7 | `78a84acd` |
| T4 independent QA | factory-qa | verified | all | Three rounds; ship on `9e7683c6`. `qa.md` |
| T5 delivery | PM | active | | Pull request open; merge waits for the owner's go-ahead. |

## Blockers
Owner's go-ahead to merge (main auto-deploys).

## Next action
Last integrated source revision: `9e7683c6`. Release-ready; not merged, not deployed. After merge: try one owner action on production (the decode child has only run on macOS).

## Baseline (unchanged `main` `691806da`, with a database)
Typecheck passes. 3,071 passed, 75 skipped, 1 failed (`src/server/ai/openrouter.qa.test.ts`, parity snapshot).
