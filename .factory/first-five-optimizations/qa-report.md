# OPT-Q1: independent QA of "First five optimizations"

Date 2026-11-10. Tester: factory-qa (independent of the four engineers). Checks were derived from `brief.md`; the
handoffs were read only to learn selectors and what the engineers said they had not verified.

## 1. Revision and environment

- Revision under test: `3c48df20` on `kenny-dev/radar-optimization-review-dda3f5`. `git status` was clean before the
  first check and is clean now (this report is the only new file).
- macOS (Darwin 25.5), Node 22.18.0, Postgres 15 on `localhost:54329`. Browser: system Chrome, headless, driven by
  the repo's Playwright devDependency. No shared browser pane was used.
- Servers (all stopped): development web + worker on 3431 (`RADAR_BILLING=on`, stub provider, `RADAR_DEV_STUBS=1`);
  development web + worker on 3432 (`RADAR_BILLING=off`, seeded `dev@radar.local`); production build
  (`next build` + `next start`, `NODE_ENV=production`) on 3433, web only.
- Databases (all dropped): `radar_first_five_qa_a91f_{up,tests,app,seed,prod,w17}`. No other database was touched.
- Each server used its own `NEXT_DIST_DIR=.next-qa-*` so the existing `.next` was not overwritten. Next rewrites
  `tsconfig.json` `include` when a custom dist dir is used; I restored the file with `git checkout`. The three
  `.next-qa-*` folders and the stub images written to `.data/uploads` during the run were removed.
- Evidence folder (scripts, logs, 100+ screenshots):
  `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-optimization-review-dda3f5/4cb7c27a-d9a4-4561-ab1d-aadc7a64a2b6/scratchpad/qa/`
  (below: `$QA`). Saved browser sessions were deleted and credentials stripped from the scripts.

## 2. Headline

25 acceptance criteria: **23 pass, 2 partial (one minor defect each: IS-3, LS-2), 0 blocked, 0 untested.**
No blocker or major defect. Two minor and two cosmetic defects (section 5). Parts of passing criteria that I did not
exercise are listed in section 6.

Release recommendation: fit to go to the owner's review. D1 and D2 are small and bounded; they need a decision
(fix now, or accept and ticket), not a redesign. Everything here ran on stubs: real Stripe and real AI providers were
not exercised.

## 3. Acceptance criteria

| | Verdict | Evidence (one line) |
|---|---|---|
| FS-1 | pass | Six real commits (guest→signup→trial, signup-first, four "Add a business"): exactly `calendar.generate` + `brief.scan(first)` + `visibility.run` each, nothing on the other businesses. Marker without job ids for 2 min → three rows "Radar couldn’t start …" with Retry; Retry ran all three. `logs/fs-a.log`, `fs-b.log`, `fs-c.log`, `be-1.log` |
| FS-2 | pass | "Radar is preparing your first week." with three live rows (step text, counts, links to `/calendar`, `/brief`, `/performance`), no start tiles; survived reload while queued and mid-run, leaving and coming back; left by itself after 9 s. `shots/fsa-04…07` |
| FS-3 | pass | Real source failure (`BRIEF_STUB_FAIL=reddit`): other two finished, row said "Radar couldn’t finish today’s Daily Brief. Reddit didn’t respond…", Retry failed again then succeeded; Dismiss persisted across reload; a manual first scan on `/brief` cleared the row; row gone at 7.1 days, present at 6.9. Viewer saw the page only while jobs were working, got 403 on retry/dismiss. `fs-b.log`, `fs-c.log`, `shots/fsb-*` |
| FS-4 | pass | Seeded business and the upgraded pre-0018 businesses have no `firstRun` marker, show the normal dashboard, and got no first-run jobs. `is-1.log`, section 4.1 |
| IS-1 | pass | Moves on app open, `app.seen`, a write action, `/email/open`, `/email/learn`; does not move on `GET /workspace`, read actions, signed-out or locked calls, a 404 email link, crons or jobs; an idle tab left 5.5 min across one SSE reconnect and 8 revision bumps left it untouched (10 workspace GETs, 0 actions). Second ping inside the hour wrote nothing. `rev`/`updated_at` untouched. `is-1.log`, `is-1-idle.log`, `ls-d.log` |
| IS-2 | pass | Real scheduler, 13 businesses: active 1 visibility + 1 social; idle no prior runs 1+1; idle with runs 3 days ago 0+0; idle with runs 7 d 1 h ago 1+1; dormant 0+0; dormant + Autopilot on ran; idle but committed 2 days ago ran; dormant business still got its morning brief; idle business with an earned rescan got none, active control got one. Counts unchanged after 45 more minutes of ticks. `logs/tiers-final.log` |
| IS-3 | **partial** | Return outside the night window: exactly one `visibility.run`, then today's one social pack. Return inside the window: two visibility runs 14 s apart (D1). `is-3.log`, `is-56.log` |
| IS-4 | pass | Cap full for every enabled account×platform → background job `skipped: no_slots`, `threadsRead 0`, 15 ms, 0 `ai_calls`; manual Scan again right after still read 662 threads. `is-4.log` |
| IS-5 | pass | Per run: `visibility.extract` calls = mentioned cells (18/18 on five businesses, 22/22 on a 45-cell run); 0 of 55 not-mentioned answers contain the business name or domain. UI cells matched the database 45/45. `is-56.log` |
| IS-6 | pass | `businesses.rev` 26 → 27 across a 45-cell run; grid changed three times during the run with no reload and one workspace GET. `is-56.log`, `shots/is56-*` |
| IS-7 | pass | No action → no rescan in two ticks; text edit only → none; Copy → rescan in 11 s; then none without a new action; "Copy again" → none (known, accepted); "I posted it" → rescan; Skip → rescan; manual Scan again always ran. `is-7.log` |
| LS-1 | pass | Debounced `article.save`: request 264–322 B, reply 78–79 B `{ok,data:{ok,v,prev},rev}`, no workspace, no workspace GET triggered. Same in the production build. `ls-a.log`, `prod.log` |
| LS-2 | **partial** | `articles` holds only `generated, outline, v` (4.6 KB for 30); body via `article.get` (6.5 KB); skeleton ("Loading article") and error state with Retry both work. But recent draft jobs carry body text in `jobs[].progress.blocks` (D2). `ls-a.log`, `ls-d.log`, `prod.log` |
| LS-3 | pass | Live draft text, cover regenerate, body images (new images shown with one `article.get`, no reload), Replace topic → Undo (title + outline restored), social "Radar article" preselect, dashboard counts, legacy header responses. `ls-a.log`, `ls-c.log` |
| LS-4 | pass | 220 characters typed over 22 s while the revision moved 60 → 79: no lost or reverted character (104 samples). Leave-and-return at 0/120/350/800 ms, pager next/previous, browser Back/Forward: text kept and saved. Owner + Editor on one article: idle side updated in 3.5 s; typing side never overwritten; other-field save arrived after own save. `ls-b.log`, `rl-a.log` |
| RL-1 | pass | "1 of 5", previous/next, "Approve and next" to the last, then `/calendar?view=list&filter=review` with "That was the last one…"; approving with an unsaved edit kept the edit. `rl-a.log`, `shots/rla-*` |
| RL-2 | pass | View, filter and open entry in the URL; reload keeps them; Back/Forward closes and reopens the sheet; article Back returns to the exact view; Dashboard → article → Back → Dashboard; of 12 `back` values tried, the 9 hostile ones (`//evil.example`, `https://…`, `/calendarx`, `/calendar/../settings`, `javascript:…`, backslashes, a fragment) fell back to `/calendar` and none left the app. Cosmetic D4. `rl-a.log` |
| RL-3 | pass | Review entry click opens the article directly from list and grid. `rl-a.log` |
| RL-4 | pass | Badge = database unread (7); newest first; links work; opening marks read, survives reload; the Editor kept their own 6; pages of 20 with Load more (37 rows, order = database); empty, loading and error+Retry states; keyboard and dialog semantics. `rl-b.log`, `smoke-b.log`, `shots/rlb-*` |
| RL-5 | pass | Real failed draft and real failed calendar run: inline failed state naming the item with Retry (article, entry sheet, calendar), same row in Activity with link, all present after reload, cleared after a successful retry; Viewer saw the state with "An owner or editor can try again." and no Retry. `rl-b.log` |
| RL-6 | pass | Error toast in the `role="alert"` region with a Dismiss button, still there after 9 s, closes on click; status toast gone within 5 s. Cosmetic D3. `rl-b.log` |
| BE-1 | pass | active → past_due: full access, `graceEndsAt` = `past_due_at` + 48.000 h, a calendar job ran; 47 h still in; 49 h locked (402, owner on "Restart your subscription", member locked); trialing → past_due locked at once; past_due → active → past_due gave a fresh 48 h; a repeat past_due event kept the clock; `unpaid` cleared it; `RADAR_PAST_DUE_GRACE_HOURS=0` locked at once. `be-2.log`, `be-3.log` |
| BE-2 | pass | Banner on 9 screens with end date and "Update card" (owner); member got the member sentence and no button; no overflow at 375/768; dark theme legible. `be-2.log`, `shots/be-12*`, `be-13*`, `dark-01*` |
| BE-3 | pass | "Trial · 3 days left" for the owner → Settings → Billing: "Your card will be charged $49 on Nov 13, 2026 … then $50 a month"; hidden for the member, for a comp account and with billing off; at 375 px tapping it closed the drawer and navigated. `be-1.log`, `smoke-b.log` |
| BE-4 | pass | Guest on `/start`: only "Need help?" (mailto), inside the dialog. Signed in on `/onboarding` and `/start-trial`: "Signed in as {email} · Sign out · Need help?", inside the dialog, reachable by Tab with a visible ring; Sign out (Enter) landed on `/`, session gone; a failed sign-out showed "Radar couldn’t sign you out. Try again." `fs-a.log`, `be-1.log`, `be-3.log` |

## 4. What ran and how

### 4.1 Automated checks and upgrade path
- `npx tsc --noEmit`: exit 0.
- `npx vitest run` with no database: 1212 passed, 489 skipped, 1 failed.
- `DATABASE_URL=… RADAR_DEV_STUBS=1 npx vitest run --no-file-parallelism` on a fresh migrated database: 1650 passed,
  65 skipped, 1 failed.
- The one failure both times is `src/server/ai/openrouter.qa.test.ts` (golden snapshot). I confirmed it also fails on
  the base by running that file from a `git archive 2d41a801` export: 73 passed, 1 failed, same test.
- `npm run build` (production): exit 0.
- Upgrade: a database migrated through `0017_ai_weekly_report` only (scratch copy of `drizzle/` without 0018), loaded
  with 3 users, 3 businesses, 3 members, a `past_due` and a `trialing` billing account and a brief day, then the real
  `npm run db:migrate`. Result: 19 migrations; every business `last_active_at` = migration time; every member
  `activity_seen_at` = migration time; `past_due_at` NULL on both accounts; `acted_at` NULL; no jobs created.
  That an account with status `past_due` and NULL `past_due_at` is locked was shown in the app (BE-1, trialing →
  past_due case).
- Rollout: a worker started against the 0017 schema logged "waiting for database migrations before processing jobs"
  and started within seconds of 0018 being applied.

### 4.2 Browser scenarios (scripts in `$QA`, logs in `$QA/logs`, screenshots in `$QA/shots`)
| Script | Covers |
|---|---|
| `fs-a.mjs`, `fs-b.mjs`, `fs-b2.mjs`, `fs-c.mjs` | First session: guest path, worker paused/resumed, reload, real failure, Retry, Dismiss, manual success, Viewer, never-started jobs, 7-day expiry |
| `be-1.mjs`, `be-2.mjs`, `be-3.mjs` | Signup-first path, footer, trial chip, member, comp, grace and lock boundaries, zero grace, sign out |
| `is-1.mjs`, `is-1-idle.mjs`, `is-2-setup.mjs`, `is-3.mjs`, `is-4.mjs`, `is-7.mjs`, `is-56.mjs` | Activity signal, tiers, return, earned rescans, no-slots skip, visibility run |
| `ls-a.mjs`, `ls-b.mjs`, `ls-c.mjs`, `ls-c2.mjs`, `ls-d.mjs` | Sizes and shapes, editing integrity, media, replace/undo, loading and error states |
| `rl-a.mjs`, `rl-b.mjs` | Review loop, URL state, Activity, failures, toasts, Viewer |
| `roles.mjs` | Roles, tenancy, lock for the six new actions |
| `sweep-a.mjs`, `smoke-b.mjs`, `prod.mjs` | Hard-load counts (dev and production), dark theme, phone width, regression smoke, production pass |

How the crons were driven: the real worker scheduler (one tick a minute, real clock). Business time zones and
times were set so "now" fell inside the nightly window (Europe/Berlin) or outside it (America/New_York); idleness and
earlier runs were set by backdating `last_active_at` and job rows. No tick function was called by hand.

How failures were forced: the brief failure used the stub's own `BRIEF_STUB_FAIL=reddit`. The draft and calendar
failures used a trigger in the QA database that refused the write, so the real job failed after its real two
attempts and wrote its real notification. No application code was changed.

### 4.3 Hard loads
One `GET /api/b/:bid/workspace` and one EventSource per hard load of `/dashboard`, `/calendar`, `/article/<id>`,
`/brief`, `/performance`, `/settings`: confirmed in development and in the production build. `article.get` is sent
twice per open in development (StrictMode) and once in production.

### 4.4 Roles and tenancy (`logs/roles.log`)
For `app.seen`, `article.get`, `activity.list`, `activity.seen`, `firstRun.retry`, `firstRun.dismiss`: signed out →
401; a signed-in non-member → 404; another business's entry id or notification id → 404 or an empty list, never its
data; Viewer → 200 on the four reads, 403 on retry/dismiss; locked business → 402 for owner and Editor (Viewer 403
on the two Editor actions); `activity.seen` moved only the caller's cursor; the four reads did not move `rev`.

### 4.5 Sizes measured
| | Bytes |
|---|---|
| `article.save` request / reply (debounced) | 264–322 / 78–79 |
| `article.get` reply | 6,476 |
| `GET /workspace`, 0 / 1 / 5 drafted (5 within two minutes) | 34,848 / 36,784 / 44,625 |
| `GET /workspace`, 6 drafted, jobs aged out (production build) | 37,458 |
| `GET /workspace` without the client header (legacy) | 87,374 |

### 4.6 Console and network
No console error, page error or failed request in any scenario except the ones the tests caused: the stub's 503 for
the billing portal, injected 500s for the Activity and article error states, an aborted sign-out, and one
`article.videos` 500 while the database trigger was refusing writes for that article.

## 5. Defects

### D1 (minor, IS-3): two AI visibility runs back to back when a business returns inside its night window
- Steps: business idle 31 days, time zone set so local time is between 02:00 and 05:59, no `visibility.run` in the
  last 24 h. A member opens the app (or switches to that business).
- Expected: one catch-up run; the nightly cadence resumes at the next 02:00 window.
- Actual: the catch-up run is queued at once and finishes in seconds; the next scheduler tick sees an active
  business inside the window with no mark for the night and queues the nightly run as well.
- Evidence: `logs/is-3.log`, T9 (Europe/Berlin, 03:50 local): `vis-run` at 02:50:18 and again at 02:50:32 UTC.
  Reproduced a second time on T5 (`logs/tiers-final.log`, 2 runs). Control T8 (America/New_York, 21:50 local): one.
- Reach: the owner's own 3 a.m. is unlikely, but a teammate in another time zone, or an email link opened abroad,
  lands there in normal use. Cost is one extra full run per return. The engineer listed this as known and unchanged.

### D2 (minor, LS-2): the workspace still carries article text for two minutes after each draft
- Steps: draft an article; within two minutes read `GET /api/b/:bid/workspace` with `x-radar-client: 2`.
- Expected: no article body in the workspace; size does not grow as articles are drafted.
- Actual: `jobs[]` lists the finished `article.draft` job with `progress.blocks`, the opening blocks of the body
  (about 1.9 KB per job). 34,848 B with none drafted, 36,784 B after one, 44,625 B after five; `jobs` was 9,794 B of
  that. Back to about 37 KB once the jobs age out. `articles` itself is clean.
- Evidence: `logs/ls-a.log` (L2, L4) and the per-key breakdown taken right after.
- Bound: the job list is capped at 30, so roughly 57 KB extra at worst, during a batch. The mechanism predates this
  feature (it feeds the live draft); it is now the only body text left in the workspace.

### D3 (cosmetic, RL-6): at phone width a sticky error toast covers the support button
- Steps: 375 px wide, cause a failed draft or calendar run.
- Actual: toast occupies x 12–363, y 715–800; the support button (x 307–359, y 744–796) is fully under it until
  Dismiss is tapped. Status toasts did the same for 4 s before; error toasts now stay.
- Evidence: `shots/rlb-10-calendar-failed-375.png`.

### D4 (cosmetic, RL-2): one Back press does nothing after closing a sheet that was opened by reload
- Steps: `/calendar?view=list&filter=proposed`, open an entry, reload, press Esc, press browser Back.
- Actual: the URL stays `/calendar?view=list&filter=proposed` (the earlier, identical history entry). The next Back
  leaves the calendar as expected. Evidence: `logs/rl-a.log`, R10.

## 6. Not tested, and why

- Real Stripe: hosted portal ("Update card" was checked for presence and for the stub's failure copy only), Stripe's
  retry schedule, delivered webhooks. Stub only.
- Real AI, crawl and social providers. In the production build only database-backed flows were exercised (sign in,
  hard loads, article open, autosave, calendar state, Activity). The worker was not run in production mode: without
  stubs or keys its crons could call public sources.
- A screen reader. Roles, names, focus order and `aria-*` were read from the browser's accessibility tree.
- FS-1 double commit: not forced by hand. It rests on exact job counts over six real commits and the passing
  database tests.
- IS-7: Undo, and "scheduled / posted from Radar" as earning actions, were not driven in the browser.
- IS-1: an email link opened by a non-owner member; `/email/open` kinds other than `calendar_review`.
- Trial chip wording at "1 day left" and "ends today"; the chip and the signed-in footer in dark theme.
- The first approval when no blog is connected (connect dialog inside the approve step). A connection was created
  through the action beforehand.
- A new client against an old web instance during deploy; 14-day job and 30-day notification retention.
- After the web process was restarted the in-memory billing stub had lost its subscriptions, so the zero-grace
  check set the account row by SQL instead of through the simulate route.

## 7. Observations for the product owner (not defects against the brief)

1. Leaving the app document (closing the tab, or browser Back out of Radar) within 600 ms of the last keystroke
   loses that keystroke burst: debounced saves are not flushed on unload. Same on the base revision. In-app
   navigation is safe.
2. A Viewer still sees "Draft now" and "Edit brief" on an undrafted article; the server refuses (403). The new
   failed line correctly has no Retry.
3. A scheduled article's top bar overflows by 29 px at 375 px with a long time-zone label ("Asia/Dubai"). The markup
   is the same as on the base; I did not measure the base.
4. A locked member with no business of their own lands on onboarding with no explanation, and the 402 message says
   "Start your free trial to continue" to a customer whose paid subscription lapsed. Both predate this feature and
   are now what a customer meets at hour 49.
5. Brief settings changed today applied to today's scans at once (a manual scan read only the one platform left
   enabled), while the action's copy says they apply from tomorrow.
6. Activity has no "Mark all read" button; opening the panel marks everything read. The brief allows either.
7. In-tab navigation within 10 minutes of the tab's last ping sends no activity ping. Worst case the timestamp is
   about 70 minutes stale, which is irrelevant against 7-day thresholds.
8. In the grid view the URL keeps `filter=review` although the filter only applies to the list.
9. Running a second dev server or build with `NEXT_DIST_DIR` edits the tracked `tsconfig.json`.

## 8. Product decisions needed

- D1: accept one extra visibility run for returns inside the night window, or have the catch-up count as that
  night's run.
- D2: accept the transient text in `jobs[].progress`, or drop `progress.blocks` from finished jobs in the workspace.
- Observation 4: whether the lock copy should change now that paying customers reach it after a grace period.
