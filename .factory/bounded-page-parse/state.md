# State
- Base: `main` `8e3a4da3`. Branch `kenny-dev/bounded-page-parse`, worktree `.claude/worktrees/vigorous-bun-88cc86`.
- Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 reproduce, measure, decide | PM | verified | brief | `probe/`, `brief.md` |
| T1 reader, crawler, brand, tests | factory-engineer | planned | AC1–AC10 | owns `src/server/services/analysis/{pageReader,crawl,brand}.ts` and their tests, `DIVERGENCES.md` O11 |
| T2 independent QA | factory-qa | planned | all | writes only under `.factory/bounded-page-parse/qa*` |
| T3 delivery | PM | planned | | pull request |

## Blockers
None.

## Next action
T1.
