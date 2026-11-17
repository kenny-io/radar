# State
- Base: `main` `ead40f9b`. Branch `kenny-dev/radar-delete-business-36eee1`, worktree `.claude/worktrees/radar-delete-business-36eee1`.
- Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead.
- Baseline on `ead40f9b`: typecheck clean; `vitest run` 4041 passed, 1 failed (`src/server/ai/openrouter.qa.test.ts`
  parity snapshot, known on `main`), 75 skipped.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 brief | PM | verified | brief | `brief.md` |
| T1 architecture | factory-architect | verified | all | `architecture.md`, amended for decision A; J and K decided by the PM |
| F0 shared contract | factory-engineer | verified | DEL-1..3, DEL-8, RES-2..4 | `8343ce2e`…`019fba7f` |
| T2 server and the wipe | factory-engineer | verified | DEL-4..7, RES-2, PUR, E-2 | `c04d3d6c`…`b732b39a` |
| T3 UI | factory-engineer | verified | DEL-1..4, RES-1, RES-4, E-1, E-3 | `9a99bec8`…`29c37d6b`, `9e7bd839` (PM, wording), `f315d3db` (D1, D2) |
| T4 independent QA | factory-qa | verified | all | first pass on `b732b39a`: D1, D2; retest on `f315d3db`: no open defect. `qa-report.md` |
| T5 delivery | PM | active | | pull request; merge waits for the owner |

## Blockers
The owner's go-ahead to merge (`main` auto-deploys).

## Next action
Last integrated source revision: `f315d3db`. Release-ready; not merged, not deployed.
Before the first real wipe on production (`docs/LAUNCH.md` §7d): web and worker both on the new build before
anyone deletes a business; `npx tsx scripts/check-storage-delete.ts` prints `OK` with the worker's environment
(the bucket credentials have only ever needed put); confirm whether the bucket is versioned. `RADAR_PURGE=off`
on the worker stops the wipe without a deploy.

## Leftovers
- No test for weekly AI report and work-update suppression for a deleted business, or for `backlinks/verify.ts`.
- Kept images have no record or cleanup; sent mail that names a business and carries no business id is kept.
- No revoke at blog platforms; Google's grant-wide revoke in the three older callers; `cron_marks` never pruned.
