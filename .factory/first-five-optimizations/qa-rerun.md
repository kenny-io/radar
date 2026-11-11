# OPT-Q2: re-verification of D1–D4 and the article-version hardening

Date 2026-11-10. Tester: factory-qa (independent). Checks were derived from the brief (IS-3, LS-2, RL-2, RL-6) and the
OPT-Q1 repro steps; the diff was read only to find selectors and risk areas.

## 1. Revision and environment

- Revision under test: `aaf9eea1` on `kenny-dev/radar-optimization-review-dda3f5`. Tree clean at start; clean now except
  this file.
- macOS (Darwin 25.5), Node 22.18.0, Postgres 15 on `localhost:54329`. Development web (`next dev`) + real worker
  (`src/worker/main.ts`) on port 3431, `APP_URL=http://localhost:3431`, `RADAR_DEV_STUBS=1`, `RADAR_BILLING=off`,
  `NEXT_DIST_DIR=.next-qa2-app`. Browser: system Chrome, headless, through the repo's Playwright.
- Databases `radar_first_five_qa2_ylio_{app,t1,t2}`: created, migrated from zero (19 migrations), dropped. No other
  database touched. Servers stopped; `tsconfig.json` restored; `.next-qa2-app` and the stub images this run wrote to
  `.data/uploads/<seeded business>` removed. (`.data/autopilot-tests`, ignored, is rewritten by the test suite.)
- Evidence (scripts, logs, 25 screenshots; no credentials or sessions kept):
  `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-optimization-review-dda3f5/4cb7c27a-d9a4-4561-ab1d-aadc7a64a2b6/scratchpad/qa/rerun/`
  (below `$R`).

## 2. Verdicts

| Item | Verdict | Observed |
|---|---|---|
| 1. D1 (IS-3) one catch-up run | **pass** | Dormant (31 d) and idle (12 d, last run 2 d ago) businesses returning at 03:59 local: one `visibility.run` each, still one after the run finished and four scheduler ticks; next night +1 each. Outside the window: one now, +1 the next night. Never-slowed control: one per night. |
| 2. D2 (LS-2) no draft text in the workspace | **pass** | `GET /workspace` 22,416 / 22,622 / 23,450 B with 0 / 1 / 5 drafted, read 0–16 s after the drafts finished; each finished job is 209 B with `progress` = `stage,total,completed`; 0 of 56 body sentences found in the workspace. Live draft streams, also when opened mid-draft. |
| 3. D3 (RL-6) toast vs support button at 375 px | **pass**, two new cosmetic findings (N1, N2) | 375 px: toast y 647–732, button y 744–796, 12 px apart, button clickable, Dismiss works. Desktop unchanged (centred, 24 px). 601–640 px: 2 px overlap (N1). Open support panel: toast covers its footer (N2). |
| 4. D4 (RL-2) no dead Back press | **pass** | Sheet → reload → Esc → one Back lands on `/dashboard`. All neighbouring flows pass (25 checks). |
| 5. Article version always moves forward | **pass** | `calendar.replace` (and its Undo), a finished re-draft and the publish cover each moved `articles.updated_at` forward, also when the stored time was 10 min ahead (+1 ms each); the second tab showed the new content without a reload every time. Two-tab editing: 120 typed characters, 0 lost. |
| Regression smoke | **pass** | `tsc` 0. DB suite twice: 1655 passed, 65 skipped, 1 failed, identical both runs. One workspace GET + one EventSource per hard load. Autosave reply 78 B. |

No blocker, major or minor defect found. Two new cosmetic findings (section 4).

## 3. What ran

### 3.1 D1: `$R/d1.mjs`, `$R/d1b.mjs` → `logs/d1.log`, `logs/d1b.log`
Real worker scheduler on the real clock (ticks at :15 of each minute). Seven businesses owned by a separate user;
"inside the window" = Europe/London (03:58 local), "outside" = America/Denver (20:58 the day before). Idleness and
earlier runs set by SQL. The member returned by opening each business in the business switcher.

| Business | Before return | Right after return | 4 ticks later | Next night |
|---|---|---|---|---|
| A1 never slowed (control) | 1 (nightly, 03:59:15) | 1 | 1 | 2 |
| I0 idle 12 d, no earlier run (control) | 1 (weekly, 03:59:15) | 1 | 1 | not checked |
| D0 dormant, never returns (control) | 0 | 0 | 0 | 0 |
| N1 dormant 31 d, returns inside window | 0 | 1 (03:59:27), mark `vis:<bid>:2026-11-10` | **1** | 2 |
| N2 idle 12 d, run 2 d ago, returns inside window | 0 new | 1 (03:59:31), mark taken | **1** | +1 |
| N3 dormant, a run 5 h ago, returns inside window | 0 new | 0 (no catch-up: under 24 h) | 1 (nightly 04:00:15) | not checked |
| O1 dormant 31 d, returns outside window | 0 | 1 (03:59:39), mark `…:2026-11-09` | 1 | 2 |

- A fresh never-slowed business added at the start of each wait got its nightly run inside the wait, so the scheduler
  was ticking (04:00:15 and 04:04:15).
- "Next night" cannot be waited for. N1, N2, A1: the day mark was renamed to yesterday's date and the jobs backdated
  24 h by SQL. O1: its time zone was changed to Europe/London, where it was 04:03 on the following local date; marks
  untouched. Each got exactly one more run on the next tick and none on the tick after.
- Failure path (`d1b`): a QA-database trigger refused the `visibility.run` job row for a returning dormant business.
  The return was recorded, no run existed, the day mark was released (0 marks), the member saw no error; web log shows
  `[idle] touchActive failed … enqueue failed`. After the trigger was removed the nightly cron ran it once (04:22:15)
  and not again on the following tick.

### 3.2 D2: `$R/d2.mjs`, `$R/d2b.mjs`, `$R/d3.mjs` → `logs/d2.log`, `logs/d2b.log`, `logs/d3.log`
| `GET /workspace` (`x-radar-client: 2`) | Bytes | `jobs[]` bytes | Without `jobs[]` |
|---|---|---|---|
| 0 drafted | 22,416 | 2 | 22,414 |
| 1 drafted, read 4 s after it finished | 22,622 | 211 | 22,411 |
| 5 drafted, read 0–16 s after each finished | 23,450 | 1,051 | 22,399 |
| 8 drafted, jobs aged out | 22,767 | 2 | — |
| Legacy (no header), 5 / 7 drafted | 60,644 / 70,519 | | |

- Growth is 207 B per drafted article while its job is listed (OPT-Q1: about 1.9 KB per job). Finished `article.draft`
  jobs: `progress` keys `stage,total,completed`, no `blocks`, no `partial`. A draft that failed for real (trigger refused
  the article write, 2 attempts): 249 B, same keys. The `jobs` row in the database still holds the blocks; only the
  workspace view drops them.
- Body-text search: 0 of 56 body sentences of seven drafted articles in the workspace read seconds after a draft;
  control: the same 56 are all found in the legacy response.
- Live stream, page open from the start (two runs): on-screen text grew 52 → 142 → 227 → 308 → 384 → 1,662 and
  67 → 160 → 248 → 331 → 410 → 1,732 characters; the undrafted view never came back; no navigation; screen text
  matches the stored body.
- Opened mid-draft (two runs): the worker process was paused while the job was `running` at stage `writing` with 3–4
  blocks; the workspace then carried the running job's `blocks`/`partial` (842–851 B), as designed. A hard load of
  the article showed 656–657 characters of the stream with "Drafting…"; after the worker resumed the text grew to
  1,738 / 1,773 characters without a reload and matched the stored body.
- Legacy: `GET /workspace` without the header → 200 with whole articles (12 body blocks); legacy `article.save` →
  `{ ok, data, workspace }` (60–70 KB); legacy `article.get` → 200.

### 3.3 D3: `$R/d3.mjs` → `logs/d3.log`, `shots/d3-*.png`
A draft failed for real at 375×812; sticky toast in the `role="alert"` region with Open and Dismiss.

| Width | Toast box (y) | Support button (y) | Result |
|---|---|---|---|
| 320 | 454–560 | 572–624 | 12 px apart |
| 375 | 647–732 | 744–796 | 12 px apart; button centre and four inner corners hit-test to the button; a click opened the support panel; toast still up after 9 s; Dismiss closed it |
| 390, 600 | | | 12 px apart |
| 601, 620, 640 | 656–720 | 718–776 | **2 px overlap** (N1) |
| 641, 768, 1280 | | | `bottom: 24px`, toast centre = viewport centre ±1 px, 24 px under the toast, no overlap |

- Status toast at 375 px uses the same position (668–732), gone after 6 s.
- Phone page without the widget (`/onboarding`, new account, 375 px): no `.radar-support`, toast wrapper `bottom: 12px`.

### 3.4 D4: `$R/d4.mjs` → `logs/d4.log` (25 checks, 0 failed)
Each flow in a fresh browser context: hard load `/dashboard` → sidebar "Content Calendar" → List → Proposed.
- A (the OPT-Q1 repro): open sheet → reload → Esc → URL `/calendar?view=list&filter=proposed`, sheet closed → one Back
  → `/dashboard`. Same with the sheet's Close button, and after two reloads.
- B: open → Esc → Back → `/dashboard`.
- C: open → Back closes (list kept) → Forward reopens → Esc closes → Back → `/dashboard`.
- D: direct link with `open=<id>` in a fresh tab → Esc → still on the list, sheet closed, `open=` gone; same after a
  reload; then a second sheet opened from there, reloaded and closed returns to the list.
- E: a "ready for review" entry opens the article (`back=` set); the article's Back button and the browser's Back both
  return to `/calendar?view=list&filter=review`; from the grid, Back returns to the grid URL.
- F: grid view: sheet → reload → Esc → `/calendar` → Back → `/dashboard`.
- G: sheet open → another page → Back (lands on the open sheet) → Esc → list → Back → `/dashboard`.

### 3.5 Article version: `$R/d5.mjs` → `logs/d5.log` (36 checks, 0 failed)
Two tabs of the same member. Each case ran twice: normally, and with the row's `updated_at` set 10 minutes ahead by SQL
(standing in for clocks that disagree).
- Replace topic on a proposed entry: tab A's list shows the new title, sheet closed, no reload; tab B (that article
  open) shows the new title and all three new outline items after 3.6 s / at once. A second replace followed by Undo
  restored title and outline in both tabs. `updated_at` moved forward on every write (ahead case: +1 ms each).
- Rewrite from brief: a marker typed into a paragraph in tab A reached tab B in 3.3 s; after the re-draft both tabs
  showed the new body without the marker in 1.3 s / 1.8 s, no reload, and still did a few seconds later.
- Publish cover: stored cover removed by SQL, article approved and published through a stub WordPress connection;
  the cover was written, `updated_at` moved forward, the open tab showed the cover after 2.3 s.
- Two-tab editing: A's save reached idle B in 3.6 s; B typed 120 characters over 12 s while A saved another field and
  the same field: 178 of 178 characters present, 0 regressions in 94 samples; A's other-field save arrived in B; both
  tabs and the server ended on the same text (B's, last writer).

### 3.6 Regression smoke: `$R/setup.mjs`, `$R/smoke.mjs` → `logs/setup.log`, `logs/smoke.log`
- `npx tsc --noEmit`: exit 0 (before and after the run).
- `npx vitest run --no-file-parallelism` on a fresh migrated database, twice (separate databases): 1655 passed,
  65 skipped, 1 failed both times, 172 s each. The one failure both times is `src/server/ai/openrouter.qa.test.ts`
  (golden snapshot, known). No test differed between the runs. Matches the PM's numbers.
- Without a database: 1215 passed, 491 skipped, the same 1 failed.
- Hard loads (development): `/dashboard`, `/calendar`, `/calendar?view=list`, `/article/<id>`: one `GET /workspace`
  and one EventSource each (`article.get` twice in development, as before).
- Sign in through the form as the seeded account → dashboard. Calendar grid 27 entries, list 27 rows (= database),
  no overflow at 375 px. Review entry opens the article with its body and "1 of 6 awaiting review".
- Autosave: request 266 B → reply 78 B `{ok,data:{ok,v,prev},rev}`, no workspace, no workspace GET; stored; shown
  after reload.
- Activity: badge 16 = database unread = `counts.activityUnread`; panel lists the notifications; opening it set unread
  to 0; still read after reload.
- No console error, page error or failed request in any scenario. Worker log: only the stub's own
  "assistant did not respond" lines and the two injected draft failures.

## 4. New findings

### N1 (cosmetic, RL-6): at 601–640 px wide the sticky toast touches the top of the support button
- Steps: viewport 620×800, cause a failed draft.
- Expected: toast clear of the button, as at 375 px.
- Actual: toast y 656–720, button y 718–776: 2 px overlap. The button is 58 px at 24 px from the edge above 600 px
  (`support.css`), while the new toast offset assumes the 52 px / 16 px phone button up to 640 px (`radar.css`). The
  button stays clickable.
- Evidence: `$R/shots/d3-03-toast-620.png`, `logs/d3.log`.

### N2 (cosmetic, RL-6): at 375 px with the support panel open, the sticky toast covers the panel's footer
- Steps: 375×812, failed draft toast up, tap the support button.
- Actual: the toast (y 647–732) lies over the bottom of the panel (y 174–734): "AI answers can be mistaken.", the
  character counter and the "Need a person? Email support" link (y 653–715), and 1 px of the message box. They are
  reachable again after Dismiss.
- Before the change the toast sat lower (y 715–800 in OPT-Q1), which by these measurements left that row uncovered.
  I did not re-run the old revision to confirm.
- Evidence: `$R/shots/d3-02-panel-open-toast-375.png`, `logs/d3.log`, `logs/smoke.log` (S5).

## 5. Notes on the run

- The first D2 attempt stopped at once: the business's draft cron had already drafted two approved topics due that day.
  I regenerated the calendar a week out and deleted the eight early entries by SQL to get a true "0 drafted" baseline.
- `logs/d2.log` shows three FAIL lines that are faults of my script (it read the body blocks in the wrong shape, so the
  sentence search was empty). `d2b.mjs` repeats those checks correctly on two more articles, with the legacy control.
- `logs/d2b.log` shows one FAIL "no step back": in one mid-draft run the on-screen text was 1,778 characters for one
  frame before the stored article (1,773) replaced the stream. The streamed and stored text are the same 1,718 body
  characters in the database; nothing reverted and the undrafted view never appeared. Not treated as a defect.
- The first D5 attempt reported a failure that was also mine (it looked for the outline in page text; the outline is
  in inputs). The page had shown the correct new outline (seen in that run's screenshot, since overwritten); the fixed script passed and its log replaced the first one.

## 6. Not tested, and why

- A real night passing: simulated as described in 3.1.
- Return through an email link, and businesses with Autopilot on: not repeated (same function as the app-open path).
- Opening an article mid-draft by in-app navigation; only hard loads were tried. Real AI streaming: the stub draft
  lasts about 2.5 s, so "mid-draft" was produced by pausing the worker process.
- Real clock disagreement between hosts: stood in for by a stored time 10 minutes ahead.
- Production build, real Stripe, real AI/crawl/social/publishing providers, a screen reader, a real phone (safe-area
  insets are 0 in headless Chrome).
- A legacy tab in the browser: legacy behaviour was checked at the HTTP level only.
- The 30-job cap of the workspace job list.

## 7. Recommendation

D1–D4 are fixed as specified and the hardening holds. N1 and N2 are cosmetic and do not block the owner's review;
they need a decision (fix or ticket). All of this ran on stubs.
