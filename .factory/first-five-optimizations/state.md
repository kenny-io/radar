# State

| Task | Owner | Status | Covers | Next |
| --- | --- | --- | --- | --- |
| OPT-A1 architecture and ownership split | factory-architect | verified | all | architecture.md accepted with PM resolutions (section 11) |
| OPT-F0 shared foundations (migration 0017, types, inert stubs, call sites) | factory-engineer | verified | enables all | `9de20794`; typecheck clean; 1396 pass with DB (sequential), same single baseline failure |
| OPT-E1 idle spend | factory-engineer | verified | IS-1..7 | integrated as `7988c70f`; QA pass; IS-3 double run (D1) fixed by PM after QA |
| OPT-E2 lighter saves | factory-engineer | verified | LS-1..4 | integrated as `1a112427`; QA pass; LS-2 job text (D2) fixed by PM after QA |
| OPT-E3 billing edges + first session | factory-engineer | verified | BE-1..4, FS-1..4 | integrated as `f0039c7f` + PM items `64c70659`; QA pass on stub billing |
| OPT-E4 review loop + activity | factory-engineer | verified | RL-1..6 | integrated as `ea538775`; QA pass; cosmetic D3, D4 fixed by PM after QA |
| OPT-Q1 independent QA | factory-qa | verified | all | qa-report.md on `3c48df20`: 23 pass, 2 partial, 0 blocked |
| OPT-Q2 QA rerun | factory-qa | verified | IS-3, LS-2, RL-2, RL-6 | qa-rerun.md on `aaf9eea1`: D1-D4 pass; cosmetic N1, N2 fixed after it (CSS, PM-measured) |
| OPT-P1 integration and delivery | PM | review | all | release-ready on stubs; not pushed; PR, merge and deploy wait for the owner |

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

## Integration checkpoint 3 and QA (2026-11-10)
`ea538775` adds E4; `3c48df20` adds the PM items (draft-ready notices link to the article, Dashboard Back) and docs.
OPT-Q1 ran on `3c48df20`; fixes are `aaf9eea1`; OPT-Q2 ran on `aaf9eea1`; the last commit only moves toast offsets
in `radar.css`. Numbers and what was not verified are in verification.md.

Open for the owner (not defects against the brief):
- Lock copy at hour 49: the 402 message says "Start your free trial to continue" to a customer whose paid
  subscription lapsed, and a locked member with no business of their own lands on onboarding with no explanation.
- A debounced edit made within 600 ms of closing the tab is lost (no unload flush; same on the base).
- A Viewer still sees "Draft now" and "Edit brief" on an undrafted article (the server refuses).
- Brief settings changed today apply to today's scans, while the copy says tomorrow.
- Out of scope findings from the build: the 4-minute SSE reconnect probe rebuilds the workspace; `events/workspace.ts`
  toasts ignore `user_id`; queue progress-write ordering can flake.

Rollout: apply `0018_first_five` before deploying web, then worker; `RADAR_PAST_DUE_GRACE_HOURS` (default 48, `0`
locks at once); confirm Stripe's retry schedule spans at least 48 hours; remove the legacy client branch one release
later.

Local leftovers: database `radar_opt_review_20261110`; gitignored `.env.local`; agent worktrees
`agent-a96b46f5c04024165`, `agent-a50b32d49e24bf207`, `agent-ac6bc35b94ff11c90`, `agent-a1c5eda5fc87c5bc7` and their
`worktree-agent-*` branches.
