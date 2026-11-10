# State

| Task | Owner | Status | Covers | Next |
| --- | --- | --- | --- | --- |
| OPT-A1 architecture and ownership split | factory-architect | verified | all | architecture.md accepted with PM resolutions (section 11) |
| OPT-F0 shared foundations (migration 0017, types, inert stubs, call sites) | factory-engineer | verified | enables all | `9de20794`; typecheck clean; 1396 pass with DB (sequential), same single baseline failure |
| OPT-E1 idle spend | factory-engineer | review | IS-1..7 | integrated as `7988c70f`; handoff-e1.md; browser checks left for QA |
| OPT-E2 lighter saves | factory-engineer | review | LS-1..4 | integrated as `1a112427`; handoff-e2.md; engineer browser pass 46 checks on dev stubs |
| OPT-E3 billing edges + first session | factory-engineer | review | BE-1..4, FS-1..4 | integrated as `f0039c7f` + PM items `64c70659`; handoff-e3.md; engineer browser pass on stub billing |
| OPT-E4 review loop + activity | factory-engineer | active | RL-1..6 | isolated agent worktree from `90be8b2a` |
| OPT-Q1 independent QA | factory-qa | planned | all | after integration |
| OPT-P1 integration and delivery | PM | active | all | brief written; baseline recorded |

Baseline at `2d41a801`: `npm run typecheck` passes; `npm test` 1076 passed, 371 skipped (DB tests without
`DATABASE_URL`), 1 failed (`src/server/ai/openrouter.qa.test.ts` golden snapshot, pre-existing).
Local Postgres: `localhost:54329` (user `postgres`). Review database `radar_opt_review_20261110` is seeded
(dev@radar.local, email marked verified by hand).

## OPT-F0 handoff

Commit "Add inert foundations for first five optimizations" on top of `5e9367a8`: migration `0017_first_five`
(four additive columns, snapshot, journal), `schema.ts`, `types.ts`, twelve stub files and the call sites of
architecture.md section 7.1. Stubs are inert: the workspace gains only `failed: { calendar: null, drafts: {} }` and
`counts.activityUnread: 0`; `firstRun` and `billing` are absent.

- Checks: `npm run typecheck` passes. `npm test` 1076 passed, 371 skipped, 1 failed (the same
  `openrouter.qa.test.ts` golden snapshot). With a throwaway database and `--no-file-parallelism`: 1396 passed,
  65 skipped, the same 1 failed.
- Migration ran from zero (18 migrations) and on top of 0016 with existing rows: `last_active_at` and
  `activity_seen_at` backfilled to the migration time, `acted_at` and `past_due_at` NULL. Throwaway databases dropped.
- drizzle-kit writes the four statements in table-name order (billing_accounts, brief_days, businesses, members), not
  the order printed in section 6. Same statements.
- Choices the architecture left open: `app.seen` returns `{ ok: true }`; `FailedJob.error` is `string | null`;
  `ActivityItem.tone` is `'ok' | 'warn' | 'bad' | 'signal'` (as `notify()`); `firstRunOf`, `billingNoticeOf`,
  `activityUnread`, `failedJobsOf` are async; `touchActive(biz, actor, now = new Date())` takes
  `Pick<BizRow, 'id' | 'lastActiveAt' | 'autopilot' | 'onboarding'>` and `{ guest: boolean }`.
- For E1: `touchActive` is awaited after the action has run and before the revision bump, so it must not throw.
- Known and not from this change: with a database, lifecycle tests fail at random when test files run in parallel
  (they share `pg_try_advisory_lock(424251)`); they pass with `--no-file-parallelism`, before and after this commit.
- Not run: `next build`, a browser pass.

## Setup correction (2026-11-10)
The first E1–E3 launch used hand-made sibling worktrees. A session guard rejects Write/Edit into other worktrees, so
all three were stopped; some edits had already been made there through the shell before the guard was understood.
Their uncommitted work was saved as patches, the hand-made worktrees and empty branches were removed, and each task
was relaunched with agent worktree isolation from `b2c33a50`. Nothing from the first launch was committed.
PM rulings for E3 (TrialChip `onNavigate`, onboarding footer slot, failed first-run row yields to a later success)
are in the E3 task contract; AppShell call site `<TrialChip onNavigate={onClose} />` is a PM merge item.

## Integration checkpoint (2026-11-10)
`a518d043` = foundations + E1 + E3 + PM merge items + merge of `origin/main` at `93be7642` (weekly AI report, PR #42).
Main already used migration 0017, so ours was regenerated as `drizzle/0018_first_five.sql` (same four columns) on
main's snapshot. `visibility/collect.ts` conflict resolved: main's `ai_observations` inserts kept, per-cell `bump`
removed (IS-6), extraction precheck kept (IS-5 still valid: main does not use extracted names elsewhere).
`waitForWorkerSchema` now also probes the four new columns.
Checks on `a518d043` (+ the worker-gate edit): `tsc --noEmit` clean; DB suite sequential on a fresh database
migrated from zero: 1554 passed, 65 skipped, 1 failed (the pre-existing `openrouter.qa.test.ts` golden snapshot).
PM decisions since the brief: a Viewer sees the first-week page only while something is working; re-copying an
already-copied brief item does not earn a rescan (pinned by a test, one condition to change).
Docs still to update at final integration: docs/CONTRACTS.md, DIVERGENCES.md B21/P20.

## Integration checkpoint 2 (2026-11-10)
`90be8b2a` adds E2 (`1a112427`) and moves `first-week.css` to a shell-level import: E2 found that a stylesheet only a
page under `(app)` imports suspends the first commit and remounts `AppProvider` (second workspace load) in development.
Rule for this feature: screen CSS goes in `radar.css` or is imported from `AppShell.tsx`. QA must confirm one
`GET /workspace` per hard load.
Checks on `90be8b2a`: `tsc --noEmit` clean; `npm test` without a database 1165 passed, 480 skipped, 1 failed (baseline
golden snapshot). DB suite not yet re-run on this commit (E2's own run on its base: 1436 passed, same single failure).
Measured by E2 on the same data: debounced `article.save` reply 51–84 KB before, 78–79 bytes after; `GET /workspace`
no longer grows with drafted articles.
