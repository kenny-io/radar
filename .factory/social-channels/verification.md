# Verification: social-channels

## Environment
- macOS (Darwin 25.5), Node 22.18.0. Postgres 16 runs in Docker as container `radar-sc-db` on `localhost:54329`. Each worktree has its own database.
- `RADAR_DEV_STUBS=1`. No live provider keys are used, and no production env files are read.

## Baseline (main @ 867e75c8, before any change)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Tests | `DATABASE_URL=… npm test` | 156/157 pass. **Pre-existing failure:** `src/server/ai/openrouter.qa.test.ts` › "parity: OPENROUTER_API_KEY unset…" golden snapshot. The stored branded-image hash `f883614e6a7dfb07` ≠ `91d5409f50974af7`, because the golden predates 170cd136 ("Branded graphic: five layouts"). Not related to this feature. |
| Migrate + seed | `npm run db:migrate`, `npx tsx scripts/dev-seed.ts` | pass |

## Feature checks
### Integrated revision dcba6fcc (PM)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Tests | `DATABASE_URL=…/radar npm test` | 249/250 (baseline openrouter.qa snapshot only). Includes 35 backend tests (DB-backed `publish.test.ts` needs `DATABASE_URL`, else it skips), 18 frontend logic tests, 42 shared-helper tests |
| Production build | `npm run build` | pass |
| Migrate | `npm run db:migrate` on radar, radar_qa, a throwaway fresh DB (backend engineer) | pass |
| Engineer evidence | backend HTTP smoke on 3101 (scheduled send by worker, failure, retry, expire/held/reconnect, other-account refused, disconnect counts, flag off); frontend flag-off pixel diff 35/36 identical (1 = animation timing), 30 flag-on flows against a temporary local shim | reported by engineers, see handbacks |

## Not run / blocked
- Live X OAuth + posting and live LinkedIn OAuth + posting (profile and page) are blocked: no developer apps or credentials, and LinkedIn page scopes need approval.

## QA (T5): independent acceptance verification
QA was done by factory-qa on 2026-10-23, between about 11:20 AM and 12:20 PM ET.

**Tested revision:** `42eb9318` on branch `kenny-dev/software-factory-feature-5a68c1`, with a clean tree. Product code is identical to `dcba6fcc`. HEAD and the tree were checked at the start and the end.

**Environment**
- `npm run dev`: web and worker on http://localhost:3100.
- Database `radar_qa` on `radar-sc-db`. It was reset and seeded at the start, and reset and seeded again at the end.
- `RADAR_DEV_STUBS=1`.
- Flag `RADAR_SOCIAL_PUBLISHING=all`. It was unset twice for the flag-off checks, then restored and diffed against a backup.
- Test accounts:
  - Owner: the seed account.
  - Viewer: invited through Team, signed up locally.
  - Non-member: signed up locally.
  - All three are localhost only. No passwords appear in the evidence.

**Tools**
- The built-in browser pane, for the core flows.
- Playwright scripts, for screenshots, drag-and-drop (synthetic mouse drags don't fire HTML5 drag-and-drop in the pane), OAuth popups (the pane opens popups in the same tab), phone with touch input, dark mode and keyboard checks.
- curl against `/api/b/{bid}/act`, for server refusals.
- SQL on radar_qa, for the worker self-heal paths.

**Evidence** is in `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-software-factory-feature-5a68c1/d523451c-bc44-4c1f-bb7a-ba6275d91627/scratchpad/qa-t5/`. That folder holds:
- `shots/`: about 85 PNGs, numbered as cited below;
- `logs/`: dev server logs, with invite and OAuth codes redacted;
- `db-social_pubs.txt` and `db-social_events.txt`;
- `test.log` and `typecheck.log`;
- the `s-*.mjs` scenarios, `run.mjs`, `shot.mjs` and `act.sh`.

### Commands
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass (exit 0) |
| Tests | `DATABASE_URL=…/radar_qa npm test` | 249/250. Only the known baseline failure: `openrouter.qa.test.ts` parity snapshot (`f883614e6a7dfb07` ≠ `91d5409f50974af7`). The DB-backed `publish.test.ts` ran and was not skipped |

### Checks
P = pass, F = fail (defect), B = blocked, N = not run. Screenshots are in `shots/`.

| # | AC | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| H1 | AC-1, AC-2 | Settings → Social accounts. Disconnect, then Connect X; connect a LinkedIn page through the picker; connect the profile from the Brief hint | Rows with logos; Connect, Connected/Disconnect and Reconnect needed states; footnote; Connect window and logo buttons; page picker | All as designed. The picker lists 2 pages; "X connected" and the other toasts appear. A denied callback gives "X didn’t respond. Nothing changed — try again." and nothing is saved. A closed popup returns quietly (22–25) | P |
| H2 | AC-5, AC-7 | X tab of a pack: emoji, bare domains, 280 vs 281, a long URL; Reddit tab | Weighted count; over 280 blocks; Reddit copy-only | 280 enabled; 281 shows "Shorten to 280… It’s 281 now." and Post now is disabled. Emoji counts 2, `radar.app` 23, a URL 23. The server refuses `social.schedule` and `social.postNow` with the same copy. Reddit: Copy text, Download image, "Radar can’t post to Reddit…" (06, 07) | P (see D2) |
| H3 | AC-8, AC-11, AC-12 | Schedule all → panel, Calendar, This week | "Scheduled · Sat, Oct 24 at 9:00 AM ET"; chip on Calendar and This week | As expected. The chip aria-label and title carry the full text | P |
| H4 | AC-10, AC-11 | Drag a chip to Tue 27, to a past day, and drag a chip that is sending soon | Move with toast; past refused; locked can't be dragged | "LinkedIn post moved to Tue, Oct 27 at 9:00 AM ET", which survives a reload. Past: "Pick today or a later day." from the UI and the server. A locked chip has `draggable=false`. move, unschedule, schedule, text, style and postNow return 409 locked or sending (04, 05, 11) | P |
| H5 | AC-9 | Schedule all | Staggered by default, rows, reasons | Staggered by default: LinkedIn 9:00, X 12:30. Reasons seen: "Copy and paste", "Reconnect needed", "moves from Sun, Oct 25", "Already posted" / "Nothing to schedule". Same time shows a single time. "Schedule 2 posts" gives the toast "2 posts scheduled for Sat, Oct 24" (65) | P |
| H6 | AC-4, AC-14 | `devSimulate expire` X with 2 scheduled posts; reconnect as `stub_as=other`, then as the same account | On hold, amber chip, Needs attention, reconnect restores | Panel "X needs reconnecting / …on hold until you reconnect." Amber chips. "Reconnect X — X access for @fieldnoteapp expired. 2 scheduled posts are on hold." Other account refused: "You signed in as @otherapp. Sign in as @fieldnoteapp…". The same account toasts "X reconnected. 2 held posts will go out as scheduled." (13–17) | P |
| H7 | AC-14 | Scheduled `[[radar:ratelimit]]`, then Dashboard → Fix and retry | Needs attention item opens the post | "A X post didn’t go out." / "N posts didn’t go out" → Fix and retry opens `/social?pack=…&plat=x`. Try again after fixing the text posts it. The sent text is the latest edit (DB `payload.text`) | P (D3 copy) |
| H8 | AC-15 | Brief LinkedIn feed draft with the profile connected; then disconnect and expire the profile | Post now / Schedule when connected; Copy + hint when not | Connected: Post now, Schedule (default today 5:00 PM), and an icon-only "Copy post". Disconnected: Copy + "Connect your LinkedIn profile to post or schedule from Radar. Connect" (links to Settings). Expired: "…needs reconnecting… Reconnect" (30, 63) | P |
| H9 | AC-16 | AutoModal: Schedule posts with and without accounts | Can't be saved with no account | No account: "Connect X or LinkedIn in Settings first." and Save is disabled. The server returns `no_account`. With accounts: the toast "…scheduled to your connected accounts" and the status line "· scheduled to connected accounts" (31, 32) | P (D5) |
| H10 | AC-13 | 390×844, `pointer: coarse`: tap a chip in This week | Move post window | "Move X post" with 14 days, time and Open post. Moving gives "Moved to Mon, Oct 26 at 12:30 PM ET". Open post opens the pack. The phone calendar agenda lists the social chips (37–40) | P |
| S1 | AC-5 | Every PublishBox state | Handoff §3 | can't post, not connected (Connect LinkedIn profile + page), ready (Post as menu), scheduled, sending soon ("Sending at 11:37 AM ET", text and controls read-only), posted, failed + Try again, expired: all seen. Buttons are 40px | P |
| S2 | AC-6 | Post now on X and on LinkedIn | Confirmation naming the account and image count; Posted; View on | "Post to X now? It goes live as @fieldnoteapp with 1 image." becomes "Posted Fri, Oct 23 at 11:31 AM ET · As @fieldnoteapp". View on X calls `window.open(pub.url,'_blank','noopener')`. The LinkedIn profile case shows "As Maya Chen" | P |
| S3 | AC-18 | Schedule 3–4 min ahead with the page open; also two concurrent Post now calls | sending → posted live, no double post | The open page updated to Posted with no reload. One `social.posted` event per sid. Concurrent calls: one 200, one 409 "This post is going out now." | P |
| F1 | AC-18 | Post now with each marker, on X and on LinkedIn | Readable copy; unknown has no "Nothing was published." | reject / ratelimit / down / quota / timeout / lost each map to `errCopy`. Unknown: "Radar couldn’t confirm… Check X/LinkedIn before trying again." with no "Nothing was published." X `lost` was read back as posted (09, 10, 62) | P |
| F2 | AC-18 | Scheduled `[[radar:ratelimit]]` | Retries, then a readable failure | Retries at +3, +6 and +12 s (worker log), 4 attempts, then "X is limiting posts right now. Try again later." | P |
| F3 | AC-18 | SQL: a stuck `sending`/`create` LinkedIn row, and a row 25 h late | Verify-or-fail, never resent; stale | The stuck row became `failed`/`unknown` with no resend. The late row became `failed`/`stale` ("It couldn’t go out on time, so Radar held it back.") | P |
| R1 | AC-24 | Viewer: every new action and OAuth start | Readable refusal | Every action returns 403 "You don’t have permission to do that." OAuth start: "Access wasn’t granted". The UI toasts the same copy (36) | P |
| R2 | AC-24 | Non-member user against Fieldnote's bid | Refused | workspace 404; `/act` "Business wasn’t found."; OAuth start refused | P |
| R3 | D4 | `GET /workspace` as Owner and as Viewer; dev logs | No tokens | No token, secret or refresh fields. `tokens_enc` is stored as `v1.` ciphertext. Logs carry no tokens. Event props hold ids and enums only | P |
| O1 | AC-23 | Flag unset: UI | Today's UI | Dashboard shows "Upcoming articles" and no This week, chips or social items. Social subtitle as on `main`. Pack shows Copy text / Download visual. X counter uses raw length (45/280). AutoModal has no "When a pack is ready". Calendar has no chips. Brief has no Post now. Settings has no Social accounts (50–56) | P |
| O2 | AC-23 | Flag unset: actions, worker, projection | 404 `not_enabled`; nothing posts | All 10 new actions and OAuth start return `not_enabled`. `social.auto` is coerced to library. No `pub`/`accounts`/`now` in the workspace. A post due at 12:01 did not send with the flag off. It sent once at 12:06 after the flag was turned back on | P |
| O3 | AC-23 | Flag off and on: generate pack, Copy text, Brief Copy → I posted it, article drag, Settings timezone | Unchanged | All work in both modes | P |
| B1 | AC-15, AC-22 | Brief X reply: Reply now (connected and expired) | Intent URL in a new tab; no confirmation; I posted it | Opens `x.com/intent/tweet?in_reply_to=…&text=…` with `noopener`, then "I posted it / Copy again". Works while X is expired. The server refuses postNow ("Reply in X’s own box instead.") and schedule ("Replies go out with Reply now only.") | P |
| B2 | AC-15 | Brief Schedule, Reschedule/Unschedule, reload, Calendar, drag `b:` chip | Leaves the to-do count; dimmed; on the Calendar | Count 12→11 (and 10→9). Item dimmed (opacity .5). Scheduled line with Reschedule and Unschedule. Survives a reload. Shows on Calendar and This week. Drag gives "Post moved to Sat, Oct 24…". The company post routes to the page and shows "Posted to LinkedIn" + View on, with no Undo (29) | P |
| C1 | AC-3, A19 | Disconnect X with 2 scheduled; disconnect the page with 1 | Toast counts; posted keeps history | "X disconnected. 2 scheduled posts were unscheduled.", "LinkedIn page disconnected. 1 scheduled post was unscheduled." A posted post still shows "Posted … · As @fieldnoteapp · View on X" (20, 26) | P |
| A1 | AC-12, AC-5 | Widths 1440 / 1100 / 900 / 700 / 390 | 7 columns; one row per day under 860; phone hides empty days; panel ≤400px below the preview | 1440: one row of 7. ≤1100: one column. 390 + coarse on a fresh DB: only "Mon 26" visible. Empty week: "Nothing scheduled this week. Create social posts". Panel 400px wide below the preview (≤1100), 416px beside it at 1440. No horizontal overflow (41, 42, 80, 81) | P |
| A2 | a11y | Keyboard through the panel and windows; dark mode | Tab order, Escape, visible focus | The panel tabs in order with a 2px focus-visible outline. Escape closes Schedule, Schedule all and Post now. Day cells are `role=radio` with `aria-checked`. The time select is labelled. Chips have aria-label and title. Dark mode renders on Dashboard, Pack, Settings, Calendar and Brief (43, 44-*) | P (baseline gap D4) |
| M1 | AC-7, AC-20 | A real 11.5 MB PNG swapped in on a LinkedIn post | Compress fix | "Image 1 is 11.5 MB. LinkedIn’s limit is 5 MB." + Compress images. After compressing: a 1.97 MB JPEG, unblocked, `compressed: true` | P (D6) |
| M2 | AC-8, A23 | `devSimulate lapse` on the profile | Expiry note; expiry through the tokens path | Schedule window: "LinkedIn profile access for Maya Chen ends Fri, Oct 23. Reconnect before then…". `social.tokens` then expired it | P |
| M3 | §18-13 | Timezone NY → Chicago → NY | 9:00 AM kept; due_at moves | "9:00 AM CT"; `due_at` 13:00Z → 14:00Z → 13:00Z | P |
| M4 | AC-23 metrics | `impactMetrics` on radar_qa (no `ADMIN_EMAILS` for the route) | `derived.social` | sent 2, failed 1, rate .67, expiries 1, reconnects 1, quota 3 | P (function only) |
| M5 | AC-26 | grep docs | LAUNCH, env, CONTRACTS | LAUNCH §7b: apps, scopes, `/api/oauth/{x,linkedin,linkedin_page}/callback`. `.env.example` has the flag, X/LinkedIn keys and `LINKEDIN_API_VERSION`. CONTRACTS has § Social channels | P |
| L1 | AC-19, AC-20, AC-22 | Live X and LinkedIn OAuth, media and posting | — | — | **N (blocked: no developer apps)** |
| L2 | AC-16 | autoRun actually scheduling at `auto.time` | — | Needs the cron at 8:00. Covered by unit tests only | N |
| L3 | AC-2 | LinkedIn user with no pages; unticked scope (P6); unsupported image format; background-failure toast seen on an open page | — | Stubs always return 2 pages and full scopes. Not exercised | N |

### Defects
| ID | Severity | Area | Summary |
|---|---|---|---|
| D1 | minor | frontend (`PublishBox.schedule`) | **Reschedule on a held post always fails.** Expire X with a post scheduled, open the pack's X tab, and Reschedule to another day at the same time. Toast "X needs reconnecting." and nothing moves. Drag and Move post (`social.move`) succeed for the same change, as A4 and the "Move post" divergence intend. PublishBox always calls `social.schedule`; it should route a same-time change to `social.move` (as SocialChip does), or not offer Reschedule while held. Evidence: `shots/64-held-reschedule-refused.png` |
| D2 | minor | frontend | **Reschedule stays enabled when preflight fails.** Scheduled X post edited to 281 weighted characters: Post now is disabled but Reschedule stays enabled. The server refuses with readable copy ("Shorten to 280…"), so nothing is wrong on the server. Evidence: `shots/06-x-overlimit-reschedule.png` |
| D3 | cosmetic | shared copy (from the prototype) | "A X post didn’t go out." in the Dashboard heading and notify. The grammar would be "An X". The prototype uses the same template, so this is for the owner to decide |
| D4 | minor, baseline (not a regression) | shared `Modal` (unchanged vs main) | Opening a window doesn't move focus into it, Tab walks the background controls first, and after Escape from inside the window focus falls to `body`. Applies to every Radar window, including the new ones |
| D5 | cosmetic | frontend | With auto set to Schedule posts and every account then disconnected, the Social status line still says "· scheduled to connected accounts" next to "Connect X or LinkedIn". Packs stay in the library, per the server rule |
| D6 | cosmetic | frontend | `social.compress` returning `compressed: 0` (stale meta larger than the real file, which I produced by editing the meta in SQL) still toasts "Images compressed". The problem stays until the meta is refreshed. Not reachable with normally recorded meta |

Not defects:
- A Viewer sees Post now, Schedule and Disconnect, and the server refuses them readably. The app gates nothing in the client by role elsewhere, and AC-24 requires server enforcement, which passes.
- The flag-off check was text- and DOM-level, plus screenshots, not a pixel diff against a `main` build.

### Disclosures
- A helper `scripts/.qa-metrics-tmp.ts` was briefly created in the repo to call `impactMetrics`, then removed.
- A gitignored `.data/uploads` PNG was temporarily replaced with an 11.5 MB image for M1, then restored. That pack later pointed at the compressed JPEG, before the final DB reset.
- Reply now in Playwright opened x.com's intent page headlessly for one check. Nothing was posted.

### Release recommendation
**Pass with minor issues, behind the default-off flag.**
- No blocker or major defect was found.
- Fix D1 before enabling the flag for users. D2 is optional.
- Live X and LinkedIn behaviour is unverified until developer apps exist.

## QA retest (T5b)
Retested by factory-qa on 2026-10-23, 12:20–12:45 PM ET.

**Tested revision:** `7e8e6238` (it includes sc-client `691f6518` and `ffd4e7c0`). The tree was clean at the start apart from this file. Product changes since `42eb9318` are limited to DailyBrief, SocialMarketing, PublishBox, ScheduleModal, SocialChip, `channels/logic.ts` and `send.ts`, plus their tests.

**Environment:** same as T5. radar_qa was reset and seeded, the app ran on port 3100 with stubs and the flag set to `all`.

**Evidence:** in `…/scratchpad/qa-t5/`:
- `retest/` holds `typecheck.log`, `test.log` and `dev.log`;
- the screenshots are `shots/r01…r12-*.png`;
- the scenarios are `s-r-*.mjs`.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Tests | `DATABASE_URL=…/radar_qa npm test` | 253/254. The one failure is the known `openrouter.qa.test.ts` parity snapshot |

| Defect | Steps | Expected | Actual | Result |
|---|---|---|---|---|
| D1, pack | Browser pane: X expired with a pack post scheduled Sat 24 at 12:30 → Reschedule → Tue 27 | Time locked; moves by day | Time select disabled at 12:30. Toast "Scheduled for Tue, Oct 27 at 12:30 PM ET". Panel still "on hold" with Tue 27. DB updated, one `social.rescheduled` event | **Pass** |
| D1, Brief | Browser pane: a held Brief X post (Sat 24, 5:00 PM) → Reschedule → Mon 26 | Same | Time disabled at 17:00. Toast and scheduled line show Mon, Oct 26 at 5:00 PM ET | **Pass** |
| D1, chip | Playwright, 390×844 with touch: tap the held This week chip → Move post → Mon 26 | Same | "Move X post" opens with the time disabled. Toast "Moved to Mon, Oct 26 at 12:30 PM ET". After a reload it's still on Mon 26 and still "On hold" (r01) | **Pass** |
| D2, pack | Scheduled X post edited to 299 weighted characters | Reschedule disabled | Post now and Reschedule are disabled; Unschedule stays enabled. Both re-enable once the text is fixed (r03) | **Pass** |
| D2, Brief | A scheduled Brief X post's draft set over the limit in SQL. Its text box is read-only while scheduled, so the state can't be reached in the UI | Reschedule disabled | "367/280", "Shorten to 280… It’s 367 now.", Reschedule disabled, Unschedule enabled (r04) | **Pass** |
| D3 | A scheduled `[[radar:reject]]` X post with the Dashboard open | "An X post didn’t go out." | Live toast "An X post didn’t go out." with an Open button. The Dashboard heading is the same (r05, r06) | **Pass** |
| D5 | Auto set to Schedule posts with accounts connected, then all accounts expired, then all disconnected | Line reflects whether scheduling is possible | "· scheduled to connected accounts", then "· saved to your library", then "· saved to your library" with "Connect X or LinkedIn" (r10–r12) | **Pass** |
| D6 | Stale meta (6 MB recorded, real file 28 KB) → Compress images | No false "compressed" | Toast "Images are already small enough." The stale "Image 1 is 5.7 MB" problem stays because the meta isn't refreshed from the real file. Only reachable with edited meta (r07) | **Pass** (residual note R1) |

**Regression (flag on)**
- A first-time pack Schedule has an enabled time select: 9:00 changed to 10:00, saved.
- A normal Reschedule to a new time works: 10:00 → 11:30. A new day and a new time works: Thu 29 at 2:00 PM.
- An unchanged save is a no-op, with no event.
- Calendar drag: "LinkedIn post moved to Fri, Oct 30 at 2:00 PM ET", which survives a reload. A drag to a past day is refused with "Pick today or a later day." (r08).
- Brief Schedule defaults to 5:00 PM with the time enabled, and the to-do count drops 11 → 10. Brief Post now confirms the account ("Fieldnote · Page") and shows "Posted to LinkedIn as Fieldnote · Page" (r09).
- A Reconnect toast lists the released held posts.
- The dev log has no server errors and no tokens.

**Flag off:** not re-run in the browser. Every changed path is behind `pubOn`, `B.social.publishing`, or a projected `st:'scheduled'` that doesn't exist with the flag off.

**Residual and new notes (minor, not blocking)**
- **R1 (cosmetic):** `social.compress` with 0 changes doesn't refresh stale meta from the real file, so the size problem stays next to "Images are already small enough." Only reachable with edited meta.
- **R2 (minor):** a scheduled Brief post whose account is expired shows only "Scheduled · …", with no "on hold" line or Reconnect hint. The pack panel shows "X needs reconnecting / …on hold", and the chip shows On hold. This existed in T5; it was not caused by the fix.

**Recommendation:** D1, D2, D3, D5 and D6 are fixed, and no regression was found. **Pass**, behind the default-off flag. Live X and LinkedIn are still not run (blocked: no developer apps).

## QA recheck (T5c)
Rechecked by factory-qa on 2026-10-23, about 12:40–12:50 PM ET.

**Tested revision:** `fd1956dd`. It includes the R2 fix (`fd1956dd`) and the X env alias (`5e510589`, server env only, not exercised live).

**Environment:** same as T5. radar_qa was reset and seeded, the app ran on port 3100 with stubs and the flag set to `all`.

**Evidence:** in `…/scratchpad/qa-t5/`:
- `recheck/` holds `typecheck.log`, `test.log` and `dev.log`;
- the screenshots are `shots/c01…c05-*.png`;
- the scenario is `s-c-r2.mjs`.

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `DATABASE_URL=…/radar_qa npm test` | 258/259. The one failure is the known `openrouter.qa.test.ts` parity snapshot |
| R2: held Brief post (X expired, scheduled Sat 24 at 5:00 PM), in the browser pane and in Playwright | **Pass.** Shows "X needs reconnecting", "Scheduled for Sat, Oct 24 at 5:00 PM ET, on hold until you reconnect.", Reschedule, Unschedule and "Reconnect X" (with the logo). The Reschedule window has the time disabled at 17:00. Reconnect X opens the "access expired" window and toasts "X reconnected. 2 held posts will go out as scheduled.". The item returns to "Scheduled · Sat, Oct 24 at 5:00 PM ET / As @fieldnoteapp" (c02, c03) |
| Pack panel held state (shared helper) | **Pass.** Same copy as before: "X needs reconnecting / Scheduled for Sat, Oct 24 at 12:30 PM ET, on hold until you reconnect." with Reconnect X, Reschedule and Unschedule. It shows "Scheduled · …" again after the reconnect (c01, c05) |
| Brief regression on live accounts | **Pass.** The LinkedIn profile post shows "Scheduled · Sun, Oct 25 at 5:00 PM ET / As Maya Chen", and Unschedule toasts "Unscheduled" and returns it to Post now / Schedule. Company post Post now asks "It goes live as Fieldnote · Page", toasts "Posted to LinkedIn as Fieldnote · Page", and then shows "Posted to LinkedIn" + View on LinkedIn (c04) |
| Dev log | No server errors, no tokens |

**Result:** R2 is fixed, and no regression was found. **Pass**, behind the default-off flag. Live X and LinkedIn are still not run (blocked: no developer apps).

## Release (PM, 2026-10-23)
| Check | Result |
|---|---|
| Merged revision | PR #1 head `2b2fc733` (QA'd product code at `fd1956dd` + env-alias change with unit tests; full suite 260/261, baseline only) → merge commit `7ce3992e` on `main` |
| Railway deploy | GitHub deployment "radar / production" for `7ce3992e`: `radar - web` success (radar.thally.io), `radar - worker` success. Pre-deploy runs `npm run db:migrate` (0006) |
| Live probe (signed out) | `/signin` 200, `/privacy` 200; `/api/oauth/x/start` → "Sign in to continue." popup result; `POST /api/b/…/act social.schedule` → 401 `unauthorized` |
| Not run | Signed-in production checks (flag-off UI, connect X) — no production credentials used by the PM; owner to run after setting env. Live X/LinkedIn posting still unverified |
