# State
- Base: `main` `b3ad2d50` (rebased from `8e3a4da3` when pull request 57 merged). Branch `kenny-dev/bounded-page-parse`, worktree `.claude/worktrees/vigorous-bun-88cc86`.
- Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 reproduce, measure, decide | PM | verified | brief | `probe/`, `brief.md` |
| T1 reader, crawler, brand, tests | factory-engineer | verified | AC1–AC10 | `09534dc8`…`f96d7aa0`; owns `src/server/services/analysis/{pageReader,crawl,brand}.ts` and their tests, `DIVERGENCES.md` O11 |
| T2 independent QA | factory-qa | verified | all | Round 1 on `1e6ecd47`: not ready, D1–D5. Round 2 on `283e71d0`: ship, low items N1–N4. `qa.md` |
| T1c fixes for D1–D5 | factory-engineer | verified | AC2–AC8 | `11ea9fe8`, `5ba70849`; decisions in `brief.md`, "Decided after QA round 1" |
| T1d N1, N3, wording, timer checks | factory-engineer | verified | AC5, AC10 | `26f28248`, `7d1e5f38`; PM reran QA's probes on `7d1e5f38` |
| T3 delivery | PM | active | | pull request; merge waits for the owner |

## Blockers
The owner's go-ahead to merge (`main` auto-deploys).

## Next action
Last integrated source revision: `7d1e5f38`. Release-ready; not merged, not deployed. After a merge: watch one onboarding analysis on production, since the reader has only run on macOS (its watchdog signal and the pipe size differ on Linux).
