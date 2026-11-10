# State

| Task | Owner | Status | Covers | Next |
| --- | --- | --- | --- | --- |
| OPT-A1 architecture and ownership split | factory-architect | verified | all | architecture.md accepted with PM resolutions (section 11) |
| OPT-F0 shared foundations (migration 0017, types, inert stubs, call sites) | factory-engineer | verified | enables all | `9de20794`; typecheck clean; 1396 pass with DB (sequential), same single baseline failure |
| OPT-E1 idle spend | factory-engineer | active | IS-1..7 | worktree `first-five-e1`, branch `kenny-dev/first-five-e1` |
| OPT-E2 lighter saves | factory-engineer | active | LS-1..4 | worktree `first-five-e2`, branch `kenny-dev/first-five-e2` |
| OPT-E3 billing edges + first session | factory-engineer | active | BE-1..4, FS-1..4 | worktree `first-five-e3`, branch `kenny-dev/first-five-e3` |
| OPT-E4 review loop + activity | factory-engineer | planned | RL-1..6 | after E2 integrates |
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
