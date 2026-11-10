# OPT-E1 handoff: idle spend (IS-1 … IS-7)

Base `b2c33a50`. The implementation is the previous engineer's patch (`e1-partial.patch`, 17 files), applied cleanly and
reviewed line by line against brief.md and architecture.md §2. **No production line of the patch was changed**: the review
found no defect that needed one. This task added the tests, updated `scan.test.ts` to the earned-rescan rule, and ran the
checks. Everything is inside E1's ownership list; the patch touched nothing outside it.

## What each criterion does, and where

| | Behaviour | Where |
|---|---|---|
| IS-1 | `touchActive(biz, actor, now)`: returns at once for a guest or when the row the gate loaded is under 1 h old (no query); otherwise one conditional `UPDATE … SET last_active_at = now WHERE last_active_at <= now − 1 h`. Never touches `rev` or `updated_at`, never throws. Called by the act route for non-read actions (F0 line), by the read action `app.seen`, and by `/email/open` and `/email/learn` after every check has passed. | `src/server/idle.ts`, `src/server/actions/presence.ts`, `src/app/email/{open,learn}/route.ts` |
| IS-1 | `useSeenPing(bid, pathname)` sends `app.seen` on mount, business switch and route change, at most once per 10 min per business per tab, through `actCall` (a 402 neither redirects nor toasts; failures are dropped). | `src/client/seen.ts` |
| IS-2 | `activityTier` (active: Autopilot on, or committed < 7 d, or used < 7 d; idle < 30 d; dormant) and `cadenceDue` (active always; idle when no run or the newest is ≥ 7 d old; dormant never). `lastRuns(kind, bids)` = newest job per business in the last 8 days. Constants `IDLE_AFTER_DAYS`, `DORMANT_AFTER_DAYS`, `IDLE_EVERY_DAYS`, `TOUCH_EVERY_MS`, `CATCH_UP_AFTER_MS`. | `src/server/idle.ts` |
| IS-2 | `brief.rescan` (`rescanTick`): active tier only. `visibility.nightly` (`nightlyTick`) and `social.auto` (`autoTick`): dormant skipped, idle only when `cadenceDue`, checked before the daily mark, so a skip writes no `cron_marks` row. `brief.daily` untouched. | `services/brief/jobs.ts`, `services/visibility/jobs.ts`, `services/social/auto.ts` |
| IS-3 | Rescans and social packs resume through their existing "today only" rules. Visibility: when `touchActive`'s UPDATE wrote a row, the business is `active` (status), its tier before the write was not active and no `visibility.run` was created in the last 24 h, it enqueues one run (`singletonKey 'vis-run:' + bid`, no revision bump). | `src/server/idle.ts` |
| IS-7 | `brief_days.acted_at` is written with SQL `now()` by `withDay` when the callback returns `acted: true` (`brief.item` when `st` changes to copied, posted or skipped) and by `markActed` (`social.schedule` on a brief item, `social.postNow` that ended `posted`). `rescanDue` needs `actedAt` later than the newest `brief.scan` job of the day (any mode), then applies the 2 h rule. The cron reads `dayMark` (primary key, one timestamp) and skips the jobs query when it is null. | `services/brief/{store,rescan,jobs}.ts`, `actions/brief.ts`, `actions/socialPublish.ts` |
| IS-4 | `runScan`: a job with `payload.background === true` returns `{ mode: 'again', added: 0, addedIds: [], since, skipped: 'no_slots' }` before `buildPlan`, the earlier-scans query and the source loop when no account has a slot left on any of its platforms. Result type gains `'no_slots'`. | `services/brief/scan.ts`, `features/brief/model.ts` |
| IS-5 | `bizMatcher(name, domain)` holds the matcher (`place`, unchanged logic) and `canMatch` (the §2.6 predicate). `collectOne` skips `ai.run('visibility.extract')` when `!canMatch(text)`; `place(text, [])` then gives −1 and the not-mentioned row and event are written by the same lines as before. | `services/visibility/collect.ts` |
| IS-6 | Both per-cell `bump(bid)` calls are gone; the queue's `finally` bump is the one bump per `visibility.run` / `visibility.collect`. The AI Visibility tab reloads on the run job's id, status and `progress.done` as well as `B.rev`. | `services/visibility/collect.ts`, `features/performance/Performance.tsx` |

## Files changed

Production (exactly the patch): `src/server/idle.ts`, `src/server/actions/{presence,brief,socialPublish}.ts`,
`src/client/seen.ts`, `src/app/email/{open,learn}/route.ts`, `src/server/services/brief/{jobs,rescan,scan,store}.ts`,
`src/features/brief/model.ts`, `src/server/services/visibility/{jobs,collect}.ts`, `src/server/services/social/auto.ts`,
`src/features/performance/Performance.tsx`.

Tests: `src/server/services/brief/rescan.test.ts` (from the patch), `src/server/services/brief/scan.test.ts` (updated),
and new `src/server/idle.test.ts`, `src/server/idle.db.test.ts`, `src/server/idle.cadence.db.test.ts`,
`src/client/seen.test.ts`, `src/server/services/brief/acted.db.test.ts`,
`src/server/services/visibility/collect.test.ts`, `src/server/services/visibility/collect.db.test.ts`.

## Tests added and what each proves

No database (run by `npm test`):
- `idle.test.ts` (7): tier at 6 d, 7 d − 1 ms, 7 d, 29 d, 30 d − 1 ms, 30 d; Autopilot on at 8/31/400 days and what does
  not count as "on"; committed 6 days ago and exactly 7; `cadenceDue` per tier at the 7-day edge; the constants.
- `rescan.test.ts` (+4, from the patch): no action, action before the last scan (and at the same instant), action after
  it with the 2 h rule, every scan (Keep, failed, rescan) restarting it. The older cases now pass an action.
- `seen.test.ts` (4): one ping per 10 min, a business switch pings at once and switching back does not, no business
  sends nothing, a refused or throwing call is dropped with no unhandled rejection.
- `visibility/collect.test.ts` (8): `place` on readable examples; `place` equals the pre-change matcher (copied into the
  test as the oracle) on 6,000 generated answers including invented names; `canMatch` examples incl. Cyrillic and
  Japanese names and an empty-normalising domain; the property on 20,000 generated cases: `!canMatch` implies the old
  matcher says not mentioned for every name list cut from the text, and for the empty list `collectOne` passes. The
  generator is checked to reach both sides (> 2,000 skipped, > 2,000 mentioned) and to skip for each kind of name.
  Mutation check done by hand: dropping the root term, the literal test, or the name term from `canMatch` each fails it.

Database (skipped without `DATABASE_URL`):
- `idle.db.test.ts` (9), through the real route handlers: hourly write with the passed time; a request holding the stale
  row does not write twice; `rev` and `updated_at` untouched; guest no-op; a failing write is swallowed; workspace GET,
  `visibility.list`, `suggestions.list` and the events stream leave the column alone; `app.seen` writes it and returns
  no workspace; a write action writes it; a Viewer's ping counts and a refused (403) change does not; a guest's draft
  change and ping (402) do not; `/email/open` and `/email/learn` write only after all checks (signed out, missing
  brief, non-owner and a link without a business do not). Catch-up: one `vis-run` job for an idle and a dormant
  business with no revision bump; nothing more on later use; three concurrent calls start one; none when a run is
  under 24 h old or already queued, one when the newest is 25 h old; none for active, Autopilot, newly committed, draft
  or guest.
- `idle.cadence.db.test.ts` (6), calling `nightlyTick`, `autoTick`, `rescanTick`: active gets one of each per night;
  nothing outside the night window; idle gets one run and one pack, then none on days 1–6.99 with no `cron_marks` row,
  then one each at day 7; the newest job of any origin postpones the weekly run; dormant gets none over four nights and
  no marks; Autopilot-on at 40 days quiet still runs nightly; return yields exactly one run per kind the same night and
  one per night afterwards; `lastRuns` picks the newest job of the kind within 8 days; rescans are enqueued for active
  and Autopilot businesses only, and never without an action.
- `brief/acted.db.test.ts` (7), each through its real action: counted = copied, copied → posted, posted, skipped, copy
  with an edit, schedule, reschedule, Post now that posted. Not counted = text edit, Restore draft, mention toggle,
  platform switch, remove visuals, rewrite, undo to open, re-sending the same state, a refused action, drag to another
  day, unschedule, a refused schedule, Post now that failed, the worker sending a scheduled post, nightly expiry.
- `brief/scan.test.ts` (updated + 2 new): the rescan flow now shows no rescan at 2 h and 9 h without an action, the
  copy that earns one, the rescan leaving `acted_at` alone and spending the copy, then a skip earning the next. New:
  IS-7 wiring against real job rows (before/after the morning scan, after a rescan, Keep, manual Scan again, which is
  itself never held back). New IS-4: a full day (replies in every status) makes a background job finish as
  `no_slots` with zero source reads, zero model calls, untouched day and no toast, and it still counts as the latest
  scan; with one slot open the background job reads both platforms; manual Scan again on the full day and a morning
  scan read both platforms, and the morning scan calls the model.
- `visibility/collect.db.test.ts` (4): the skip path makes no extraction call and stores the same fields as the
  not-mentioned branch reached through extraction (compared field by field, with the same `visibility.checked` event
  and no `visibility.mentioned`); a mention still uses extraction; a failed answer makes no extraction call; a 10-cell
  run moves `rev` by exactly 1 while the read model shows landed cells mid-run at the old `rev`; Collect now moves it
  by 1. Mutation check by hand: putting one per-cell bump back fails both (11 and 3 instead of 2).

## Check results

All run on the final tree (the committed files), 2026-11-10.

- `npm run typecheck`: passes.
- `npm test` (no database): **1099 passed, 399 skipped, 1 failed**. Baseline 1076 / 371 / 1. The one failure is the
  known `src/server/ai/openrouter.qa.test.ts` golden snapshot (an image hash under `stored`; nothing to do with
  visibility collection). +23 passing are the new no-database tests; +28 skipped are the new database tests.
- Database-backed, throwaway `radar_first_five_e1_aff8dc28` (migrated from zero, dropped afterwards),
  `RADAR_DEV_STUBS=1 npx vitest run --no-file-parallelism`: **1447 passed, 65 skipped, 1 failed** (the same snapshot).
  Baseline 1396 / 65 / 1. +51 = the 23 and the 28. Run twice in full (same counts); `customImages.db.test.ts` did not
  time out.
- One flake seen once, outside this change: see `queue.ts` under "Changes needed in files I do not own".
- Not run: `next build`, a dev server, a browser.

## Changed from the patch, and why

Nothing in production code. Test-only: `scan.test.ts` updated as instructed (the action that earns the rescan added, the
no-action case added, nothing loosened).

## Deviations from architecture.md

None new. The patch's choices the PM already accepted stand (passed `now` and `<=` in `touchActive`, catch-up only for
status `active`, per-business ping throttle, `acted_at` from SQL `now()`, swallowed errors, `postNow` only when posted,
reschedule counts, exported cron functions).

## Changes needed in files I do not own

- `DIVERGENCES.md`: B21 (automatic rescans "every 2 hours" for each active business) and P20 (nightly visibility, once
  per day per business) no longer describe every business: rescans need an action since the last scan and the active
  tier; visibility and social packs follow the tier.
- `docs/CONTRACTS.md`: `brief.scan` result `skipped` gains `'no_slots'`; new read action `app.seen {}` → `{ ok: true }`.
- `src/server/jobs/queue.ts` (not E1's, existing behaviour): progress writes are unordered. A fire-and-forget
  `ctx.progress` from a source's `onRead` can land after the awaited final one and overwrite it. Seen once in four runs
  of `scan.test.ts` as `manual.progress.failed` undefined in the untouched test "a failing platform is skipped in the
  background; a manual Scan again still shows the failure"; three reruns passed. That path is a manual scan, which this
  task does not change.

## Untested or uncertain

- No browser pass (QA's). Not covered by any automated test: that `useSeenPing` fires on mount, business switch and
  route change (only its throttle and send logic are tested; there is no React test environment), and that the AI
  Visibility tab reloads on run progress (`Performance.tsx`). The server half of IS-6 "the grid still fills in" is
  tested: mid-run, `visibility.list` data shows landed cells and the job carries `progress.done`.
- `next build` not run.
- Re-copying an item that is already `copied` does not count as an action: the page sends `st: 'copied'` again, the
  state does not change, so `acted_at` is not set (architecture §2.4 says "when `st` changed"). The brief says "was
  copied". Pinned by a test; if the owner wants a repeat copy to count, it is one condition in `actions/brief.ts`
  (drop `input.st !== before` for `copied`). PM decision.
- Returning inside the 02:00–05:59 window: the catch-up run is queued at once and that night's nightly tick then joins
  it (same singleton key) while it is queued or running. If the catch-up has already finished within the minute, the
  nightly run for that night also happens, the same pair a return at 01:00 produces. Not changed.
- `/email/open` refuses anyone but the owner (existing rule), so only the owner's email click is recorded there.
- `lastRuns` reads the database clock while crons take `now`; the tests use real time and aged rows for that reason.
- The cron tests call the real cron functions, which look at every active business in the database they run against
  (as the existing `publisherTick` tests do). They assert only on their own businesses and remove their own marks.
- IS-1 "existing businesses start active at migration" is F0's migration; not re-verified here.
