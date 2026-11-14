# State
- Base: `main` `b3ad2d50` (pull request 57 merged during the work; the branch was started on its tip `472bdfd8`, which has the same files). Branch `kenny-dev/frosty-snyder-ec6225`, worktree `.claude/worktrees/frosty-snyder-ec6225`.
- Delivery: pull request. No merge or deploy without the owner's go-ahead.
- Last integrated source revision: `e88c6f53`.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 trace and brief | PM | verified | the table, D1–D7 | See `brief.md`. QA checked the table independently. |
| T1 `coverCrop` in the child, tests | factory-engineer | verified | AC1–AC8 | `0d2739c1`, follow-up `e88c6f53` (findings Q2, Q3). |
| T2 independent QA | factory-qa | verified | AC1–AC8 | On `0d2739c1`: ship with noted limits. `qa/qa.md`; findings Q1–Q7 in the brief. Its `corpus` and `paths` probes rerun by the PM on `e88c6f53`. |
| T3 pull request | PM | review | delivery | Release-ready; not merged, not deployed. Waits for the owner. |

Open for the owner: finding Q1 in the brief (whole files with bytes after their end are refused).
Follow-ups not started: Q4 (no blank check on a provider's picture), Q5 (`photo: true` on a template fallback), Q6 (`pixels` and `compressBytes` trust storage).
