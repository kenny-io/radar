# OPT-E4 handoff: review loop and activity (RL-1 … RL-6)

Base `90be8b2a`. Worktree branch `worktree-agent-a1c5eda5fc87c5bc7`. Nothing pushed, merged or deployed.
Design: architecture.md §4. Where this differs, see "Deviations".

## What each criterion does now, and where

**RL-1 Review pager and "Approve and next".**
`src/features/article/review.ts` (no React): `reviewList` (entries with `status === 'review'`, by `date` then `id`),
`reviewPos`, `afterApprove`. `ArticleWorkspace.tsx` shows, for an article in review, a `<nav>` in the top bar with
previous / "2 of 5" / next, and the primary button reads "Approve and next" when another review article exists
("Approve article" when it is the only one). The approve path is the existing one (`approve` → `schedule`, or the
"Not now" branch of `PublishIntro`, or `BlogConnect` → `schedule`); when the article was in review, its `.then` calls
`advance`: open the next id (keeping `back`), or after the last one go to `/calendar?view=list&filter=review` with the
toast "That was the last one. No articles are waiting for review." next to the usual approval toast.
An article that is not in review (status `draft` or `approved`) has no pager and approving it stays on the article, as before.
No keyboard shortcut was added: the screen is full of `contenteditable` blocks and inputs, so a global key is not
trivially safe.
Flush: the existing approve path does not call `flushLater`, and I left its order alone. Pending debounced saves are
not lost: the queue is app-wide, and `useArticle` flushes it before it fetches the next article (handoff-e2).

**RL-2 Calendar view, filter and open entry live in the URL; Back returns there.**
`src/features/calendar/calendarUrl.ts`: `calendarState` (decode), `calendarParams` / `calendarUrl` (encode, defaults
omitted). `ContentCalendar.tsx` no longer keeps `view`, `filter`, `open` in state: it reads them from `route.params`.
View and filter changes replace the history entry, opening an entry adds one (browser Back closes the sheet, Forward
reopens it), and neither scrolls. `go` gained a third argument, `go(page, params, { replace?, scroll? })`;
`go('article', id)` still works and `go('article', { id, back })` adds `?back=<encoded path>` (`route.params` is still
the id string). The article screen reads `back` with `useSearchParams`, passes it through `safeBack`
(`^/(calendar|dashboard)(\?|$)`, at most 512 characters, else `/calendar`) and its Back button pushes that URL. The
button reads "Dashboard" when `back` is a dashboard path.

**RL-3 A review entry opens the article directly.** `openEntry` in `ContentCalendar.tsx`, used by the grid and the list:
status `review` → `go('article', { id, back: <current calendar URL without open> })`; anything else opens the sheet.
The sheet's "Open article" passes the same `back`.

**RL-4 Activity.**
Server: `activityUnread` (`src/server/services/activity.ts`) counts rows of the business with
`user_id IS NULL OR = me` newer than the member's `members.activity_seen_at`. `src/server/actions/activity.ts`:
`activity.list { before?, limit? ≤ 50 }` (read, Viewer) → `{ items, unread, seenAt }`, newest first;
`activity.seen {}` (read, Viewer) moves the caller's cursor to the database's `now()` → `{ ok: true }`.
Retention is 30 days (`NOTIFICATION_DAYS`, `pruneNotifications` in `src/server/jobs/maintenance.ts`).
Client: `src/features/shell/ActivityBell.tsx`. The badge is `B.counts.activityUnread` plus the toast events received
since the last workspace from the server (`src/client/liveUnread.ts`, fed from the SSE `toast` listener in `app.tsx`,
once per notification id). Opening the bell shows a `Sheet` titled Activity: skeleton, then the list (tone dot, message,
"New" for rows written after the read cursor, relative time, the action as a real `<a href>` that navigates in-app and
closes the panel), the empty copy, an error state with Retry, and "Load more". Once the list has loaded it calls
`activity.seen` and zeroes the badge. A notification that arrives while the panel is open is added on top.
Accessibility: the button has `aria-expanded`, `aria-controls` (while open) and the name "Activity" or
"Activity, N unread"; the panel is a labelled modal dialog, takes focus on open, keeps Tab inside, closes on Esc and
returns focus to the bell. At ≤ 640 px the sheet is the full width less 16 px. At ≤ 900 px the bell in the sidebar
drawer is hidden (CSS) because the phone bar has its own, and the drawer would cover the panel.

**RL-5 Failed drafts and calendar runs.**
`failedJobsOf(bid)`: `DISTINCT ON (kind, ref) … ORDER BY created_at DESC` over `article.draft` and
`calendar.generate`, kept only when that newest job is `failed`; for the calendar the newest run across refs.
`failedNow(live, snap)` in `src/features/shell/activity.ts` decides what a screen shows from `app.jobFor(...)` and
`B.failed…`. UI: `FailedLine` (exported from `ContentCalendar.tsx`) on the article screen (bar under the top bar), in
the calendar entry sheet, and on the calendar screen (both the empty and the filled layout). Each names the item and
has Retry (`article.draft { entryId }`, or `calendar.generate { settings: B.calendar.settings, keep }`); a Viewer sees
"An owner or editor can try again." instead of the button. The two `notify()` calls now read
`Radar couldn’t draft “{title}”. Try again.` + `{ Open → /article/{entryId} }` and
`Radar couldn’t finish your content calendar. Try again.` + `{ Open calendar → /calendar }`.

**RL-6 Toasts.** `ToastHost` (`src/components/ui.tsx`) with the rules in `src/components/toasts.ts`. Tone `bad`: no timer,
a close button named "Dismiss", rendered in a `role="alert"` region. Everything else: `role="status"` region, 4200 ms
(or the caller's `ms`). Rule for the limit of three (`retainToasts`):
1. the same error message again replaces its earlier copy;
2. when there is no room the oldest status toast leaves first;
3. an error leaves only for a newer error, when three errors are already showing;
4. a status toast that arrives while three errors show is shown as one extra and leaves by itself (so at most four).

## Files changed

| File | Change |
|---|---|
| `src/server/services/activity.ts` | `activityUnread`, `failedJobsOf`, `visibleTo` |
| `src/server/actions/activity.ts` | `activity.list`, `activity.seen` |
| `src/server/jobs/maintenance.ts` | notifications kept 30 days; `pruneNotifications(now)` exported for the test |
| `src/server/services/drafting/jobs.ts`, `calendar/jobs.ts` | the two failure `notify` calls; the then-unused `GENERIC_AI_ERROR` import removed from each |
| `src/components/ui.tsx` | `ToastHost` as above; `Sheet` takes optional `id`, `label`, `focus` (nothing changes for existing callers) |
| `src/components/toasts.ts` (new) | `toastPlan`, `retainToasts` |
| `src/client/app.tsx` | `routeToUrl` for `{ id, back }`; `go(page, params, opts)`; one line in the `toast` listener. act / rev / busy untouched |
| `src/client/liveUnread.ts` (new) | toast ids counted since the last workspace |
| `src/features/shell/ActivityBell.tsx` | bell and panel |
| `src/features/shell/activity.ts` (new) | `bellLabel`, `badgeText`, `agoLabel`, `internalHref`, `isNew`, `failedNow` |
| `src/features/calendar/ContentCalendar.tsx` | URL state, direct open of review entries, failed states, `FailedLine` |
| `src/features/calendar/calendarUrl.ts` (new) | encode / decode |
| `src/features/article/ArticleWorkspace.tsx` | pager, "Approve and next", `back`, failed draft bar |
| `src/features/article/review.ts` (new) | review list, position, next after approve, `safeBack`, `articleUrl` |
| `src/app/radar.css` | all CSS for the above (one block at the end). No component-level stylesheet |
| six test files | below |

## Tests added (56)

No database (47):
- `src/features/article/review.test.ts` (13): order by date then id · position and neighbours · no pager outside review ·
  "Approve and next" target, from the end of the list, and null after the last one · a whole session reads
  1 of 3, 1 of 2, 1 of 1 · `safeBack` follows `/calendar…` and `/dashboard…` and rejects `//evil.example`, absolute
  URLs, `/calendarx`, `/calendar/../settings`, a newline trick, a backslash, `javascript:`, empty, over-long ·
  `articleUrl` round trip.
- `src/features/calendar/calendarUrl.test.ts` (5): defaults ↔ plain `/calendar` · only non-defaults are written, in a
  fixed order · every state round-trips · `route.params` shape · unknown values ignored.
- `src/components/toasts.test.ts` (8): an error has no timer and is an alert, also when the caller passes `ms` · other
  tones are statuses with 4200 ms · the four retention rules above.
- `src/client/liveUnread.test.ts` (5): one per id · repeats ignored · settle returns to zero and an already counted id
  does not come back · per business · bad input ignored.
- `src/features/shell/activity.test.ts` (16): bell name and badge cap · relative time · links that would leave the app are
  dropped · "New" · `failedNow`: record after a reload, live failure before the workspace catches up, keep flag,
  queued / running / done retry hides it, a stale live job does not hide a newer failure, a job last seen running that
  the workspace says failed, a newer live failure.

Database, through the real act and workspace routes and the real job queue (`src/server/services/activity.db.test.ts`, 9):
- unread is per member (two members, two cursors; a non-member counts nothing) and shows in `counts.activityUnread`
- `activity.seen` and `activity.list` reply `{ ok, data }` only, leave `rev` alone, and work for a Viewer
- list: newest first, item shape, `before` / `limit` paging with three rows in the same instant (each row exactly
  once), limit 51, limit 0 and a malformed cursor refused
- tenant scope: another business's row never appears, its id as a cursor gives an empty page, a non-member gets 404 on
  both actions and their cursor does not move, signed out gets 401
- a private row is listed and counted only for its member
- retention: 29 days and 30 days less a minute survive, 30 days plus a minute and 45 days are pruned
- failed draft (the model call rejects on the last attempt): notification text, tone, link, no provider detail;
  `B.failed.drafts[id]`; entry back at `approved`; another business sees nothing; Retry queued hides it; the successful
  run keeps it gone while the failed job row still exists
- a failure in one article does not mark another; a long title is cut to 40 characters in the notification
- failed calendar run: notification, `B.failed.calendar` with `keep`, cleared by the retried run (the real stubbed run).

Mutation check: 37 deliberate breaks (drop the tenant filter, the private-row filter, the cursor's business check,
tuple paging, retention 1 day and 29 days, `read: true` on `activity.seen`, one cursor per business, ignore the cursor,
no `DISTINCT ON`, ignore job status, generic notification text, no link, looser `back` patterns, unsorted list, no
wrap, error timer, old three-toast rule, …). All 37 fail at least one test. One earlier mutant survived and showed
that a line in `failedNow` was redundant; the rule was rewritten (see deviation 5) and the six mutants of the new rule fail.

## Check results

- `npm run typecheck`: clean (base and final).
- `npm test`, no database. Base `90be8b2a`: 1165 passed, 480 skipped, 1 failed. Final: **1212 passed, 489 skipped,
  1 failed**. The failure is `src/server/ai/openrouter.qa.test.ts` (golden snapshot), before and after. +47 passed,
  +9 skipped (the database tests).
- Database suite, `RADAR_DEV_STUBS=1 npx vitest run --no-file-parallelism`, my own empty migrated database. Base:
  1594 passed, 65 skipped, 1 failed. Final: **1650 passed, 65 skipped, 1 failed**. Same single failure. +56 passed. The base run used an empty
  migrated database; for the final run I dropped and recreated mine so it was empty again.

## Browser pass

Web and worker from this worktree on :3424 against my throwaway database, dev stubs, billing off; Playwright driving
headless system Chrome. 150 checks passed across ten scripts (counting each script's last run). Three checks failed
and all three were the script's: a filter with no rows (the page was too short to scroll), a view that fits a 900 px
window (same), and a box measured during the sheet's slide-in. The two scroll checks were re-run in a form that can
fail for the right reason (a list long enough, a 560 px window) and passed; for the box, the value measured was
18 px + 359 px mid-animation and screenshot `m2` shows the settled panel inside the screen. One script stopped once
because it clicked the bell before the page had hydrated; the rest of it was run with a wait. Scripts A to C ran
before two late changes (deviations 4 and 5, which touch only the panel's paging and the failed-state rule); D and E
ran after the first of them; G ran after both and repeats the failure, reload, Retry and panel checks. After G one
more line changed in the bell (a notification arriving during "Load more" no longer cancels it); script H ran on the
committed code against a freshly seeded database and covers exactly that, plus open by keyboard, mark read, Esc,
focus and one workspace load on `/dashboard` and `/calendar`.
While running D the app's sign-in rate limit tripped (one sign-in per script); I deleted the sign-in rows from
`rate_limits` in my own database and made the scripts reuse one session.

Covered and seen:
- Calendar generated, "Approve all 30", three articles drafted with "Draft now".
- Hard loads of `/calendar`, `/dashboard`, `/article/<id>`, `/calendar?view=list&filter=review` and of an article
  with a failed draft: exactly one `GET /api/b/:bid/workspace` each (dev mode).
- List + "Ready for review" → `/calendar?view=list&filter=review`, no request to the server for it; reload keeps it;
  defaults disappear from the URL; scroll position kept on filter change, view change and opening a sheet; a page
  change still starts at the top; browser Back closes the sheet, Forward reopens it, Esc and Close drop `open=`.
- Grid: a review entry opens `/article/<id>` directly, another entry opens its sheet. List: a review entry opens
  `/article/<id>?back=%2Fcalendar%3Fview%3Dlist%26filter%3Dreview`.
- "1 of 3", previous disabled, next → "2 of 3" → previous; Back returns to list + review.
- "Approve and next" twice ("1 of 2", then "1 of 1" with plain "Approve article"), the last approval lands on the review
  list with the confirmation toast in the status region; toasts leave by themselves. Done once through "Not now —
  approve without publishing" (no blog connected) and once with a connection row inserted (articles scheduled, no dialog).
- `back=//evil.example`, an absolute URL, `/calendarx`, `/settings`: Back goes to `/calendar` on the same origin.
- Forced failures: worker stopped, "Draft now" / "Regenerate" clicked in the page, then the queued job run as its last
  attempt through the real job code and queue with the dev AI stub made to throw (`e4/force-fail.ts` in the scratchpad).
  Result: sticky toast in the `role="alert"` region naming the article with "Open" and "Dismiss", still there after
  6.5 s, closed by keyboard with a visible focus ring; inline failed state with Retry on the article, in the entry sheet
  and on the calendar; badge 1, then 2, bell name "Activity, 1 unread"; all of it still there after a reload, with no toast.
- Activity panel by keyboard: Enter opens, focus is inside, `aria-expanded` / `aria-controls` set, newest first, the
  failure names its article and links to it, "New" markers, relative times, badge gone, Tab stays inside, Esc closes and
  focus is back on the bell, no badge after a reload, nothing marked New on reopening, the link opens the article and
  closes the panel.
- Panel states: skeleton, error with Retry (the page's `activity.list` request answered with 500 in the browser), Retry
  loads, the empty copy (same technique), 20 rows + "Load more" until all 39 real rows were shown and the button left,
  a notification arriving while open (on top, "New", read), one arriving while "Load more" was still loading (shown
  on top, and the held page still landed: 31 of 31, each once), one arriving while closed (status toast, badge 1,
  still 1 after a reload); a badge of 30 straight from the workspace count.
- Retry with the worker back: calendar Retry → research view → failed state gone, also after a reload; article Retry
  hides the bar at once and ends in review; sheet Retry likewise.
- 375 px: calendar failure live (toast fits, inline state, phone-bar badge), Activity panel (359 px wide), failed
  article, failed sheet, review list, pager with "Approve and next"; no horizontal overflow in any of them; only the
  phone bar's bell is visible.

Screenshots, all in
`/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-optimization-review-dda3f5/4cb7c27a-d9a4-4561-ab1d-aadc7a64a2b6/scratchpad/e4-shots/`:
`a1-calendar-research`, `a2-entry-sheet`, `b1-review-list`, `b2-article-1-of-3`, `b3-after-first-approve`,
`b4-last-1-of-1`, `b5-review-list-after-last`, `c1-article-draft-failed-toast`, `c2-sheet-draft-failed`,
`c3-article-draft-failed-reload`, `c4-activity-panel`, `c5-calendar-failed`, `d1-calendar-after-retry`,
`e1-panel-loading`, `e2-panel-error`, `e3-panel-empty`, `e4-panel-load-more`, `f1-review-done-scheduled`,
`g1-calendar-failed-desktop`, and at 375 px `m1-calendar-failed-toast-375`, `m2-activity-panel-375`,
`m3-article-draft-failed-375`, `m4-sheet-draft-failed-375`, `m5-calendar-failed-375`, `m6-review-list-375`,
`m7-article-pager-375` (all `.png`). The scripts are next to them in `scratchpad/e4/`.

## Deviations from architecture.md, and why

1. **Calendar URL changes use the History API, not `router.replace` / `router.push`.** `go(..., { scroll: false })` on
   the same path calls `history.replaceState` / `pushState`. In the App Router a router navigation that changes only the
   query still asks the server for the page, and the screen updates when that returns; the view toggle and filter
   would wait on the network. Next 15 keeps `usePathname` / `useSearchParams` in step with the History API (documented),
   and the browser pass showed the state updating with no `_rsc` request and Back / Forward working. Semantics are as
   specified: replace for view and filter, a new entry for an open sheet.
2. **"Do not reset scroll when only query params change" is opt-in (`scroll: false`), used by the calendar.** Social and
   Settings use query params as sub-pages (`go('social', { pack })` from the list); for them a same-path `go` still
   scrolls to the top. Every existing `go` caller behaves as before.
3. **`before` is the id of the last item, not a timestamp.** Rows are ordered by `(created_at, id)`; a timestamp cursor
   skips or repeats rows written in the same instant (the calendar job writes two notifications back to back).
4. **The panel asks for 21 rows and shows 20**, so "Load more" appears only when there is more (with the plain
   "a full page came back" rule the last click returned nothing). The action's contract is unchanged.
5. **`FailedJob.at` is the failed job's `created_at`, not the time it failed**, and `failedNow` is: the workspace's
   record wins when it is about the same run as the live job or a later one; otherwise the live job decides (failed →
   shown, anything else → not). Both sides of that comparison then come from the database clock. Nothing displays `at`.
6. **Where "Approve and next" goes.** From the end of the list while others still wait (the reviewer stepped past
   them), it opens the first one still waiting. Approving the only article in review (plain "Approve article") also
   returns to the review list with the confirmation, as the task's browser script expects.
7. **The failure notification shortens a long title to 40 characters** with the job file's existing `trunc`, like the
   other draft toasts (a toast is one pill). The inline failed states show the whole title.
8. **Closing a sheet this screen opened goes one step back in history** instead of replacing the URL, so no duplicate
   entry is left; a sheet reached by link or reload is closed by replacing the URL.
9. `routeToUrl('article', { id, back })` leaves `back` out when it is the plain `/calendar` (the default).
10. `Sheet` got `id`, `label`, `focus`; the bell's icon is an inline SVG in `ActivityBell.tsx` rather than a new entry
    in `IC`; five small React-free modules were added so the logic can be tested (listed above).

## Changes needed in files I do not own

None are required for this to work. For the PM:
- `src/lib/types.ts`: the comment on `FailedJob.at` could say "when the failed run was created" (deviation 5).
- `src/features/dashboard/Dashboard.tsx` opens articles with `go('article', id)`, so Back from them goes to the
  calendar, as today. `go('article', { id, back: '/dashboard' })` would return to the dashboard; the article screen
  already accepts it and labels the button "Dashboard".
- `src/server/events/workspace.ts` sends every notification of the business as a toast, whatever its `user_id`.
  Nothing writes `user_id` today (`notify()` has no such argument). If private notifications are ever written, that
  query needs the same `user_id IS NULL OR = me` filter the list and the count have.
- Docs: `ARCHITECTURE.md` (`go`'s third argument, `B.failed`, Activity), `docs/CONTRACTS.md` (`activity.list`,
  `activity.seen`, the two notification texts, 30-day retention).

## Untested or uncertain

- No production build was run. One workspace load per hard load, and the History API integration, were measured in
  development only.
- The Viewer's view of a failed state (text instead of Retry) was not opened in the browser. The server side of Viewer
  access to both actions is tested.
- Two members were not driven in the browser; the per-member cursor is tested against the database.
- Connecting a blog from inside the approve dialog (`BlogConnect` → `schedule`) was not driven. Its `.then` is the same
  code as the connected path, which was.
- Dark theme not looked at (only existing tokens are used). No screen reader was used: roles, names, focus and
  `aria-*` were checked through the browser's accessibility queries.
- Unread count between refetches is approximate at the edges: a workspace fetched just before a notification was
  written but applied after its toast undercounts by one until the next workspace; a workspace already in flight when
  the panel marks everything read can bring the old number back until the next one. Both correct themselves.
- `activity.seen` moves the cursor to now, so a notification written between the list query and that call is marked
  read without having been listed (it still shows as a toast).
- A failed job the tab saw live keeps its failed state if a later successful run was missed by the event stream and is
  more than two minutes old (no longer in `B.jobs`), until a reload.
- At deploy, Activity starts with whatever the one-day rule left, and every member starts with zero unread
  (the migration set `activity_seen_at` to now).
