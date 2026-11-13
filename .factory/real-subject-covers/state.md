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
| T5 delivery | PM | released | | Pull request 56 merged as `8e3a4da3` on 2026-11-13 after the owner said "Yes, merge". |

## Blockers
None.

## Release (2026-11-13)
- Before merging: trial merge with `main` `2f6c70a4` typechecked, and the feature's and drafting's tests passed on it (634 passed, 47 skipped without a database).
- Merged as `8e3a4da3`. Railway deployed `web` `c32d19b0` and `worker` `23c5844e`, both SUCCESS; both started with no error in their logs; `https://radar.thally.io/` answers 200.
- Not verified on production: a real picture going through the decode child on Linux. A check inside the worker container was refused by the permission system, and nobody is signed in to production in the built-in browser.

## Next action
The owner tries "Use a picture from your site" once on a production article. A failure there would show as "Radar couldn't use that picture" with no picture stored, or as an error in the `web` logs.

## Baseline (unchanged `main` `691806da`, with a database)
Typecheck passes. 3,071 passed, 75 skipped, 1 failed (`src/server/ai/openrouter.qa.test.ts`, parity snapshot).
