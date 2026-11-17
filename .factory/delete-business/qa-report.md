# QA report: delete a business (T4)

Independent QA, 2026-11-16. No product code was changed.

## Verdict
**Ready for a pull request.** Delete, restore and the wipe behaved as the brief and the architecture say in every
check I could run, including every attempt to make the wipe remove something it must not.
Two phone-width layout defects (D1, D2) should be fixed before merge; they are CSS only and touch no data.
What I could not run is listed under "Not run": the bucket path of the wipe and real provider revokes matter most.

**Update:** D1 and D2 are fixed in `f315d3db` and passed the retest (section "Retest" at the end). No open defect.

## Tested revision and environment
- Revision `b732b39a15f8d7f1df025939e89b925c3ac9c42c`, branch `kenny-dev/radar-delete-business-36eee1`, base `ead40f9b`.
  Tree clean apart from untracked `.factory/delete-business/{ui,qa}/` and `verification.md`. `tsconfig.json` restored.
- macOS arm64, Node 22.18, Postgres 16 on `127.0.0.1:55471`. Web `next dev` on port 3421 and the worker
  (`npx tsx src/worker/main.ts`), same environment: `RADAR_DEV_STUBS=1`, `RADAR_SOCIAL_PUBLISHING=all`,
  `RADAR_BILLING=off`, `STORAGE_DIR=.data/qa-uploads` (local disk), database `radar_qa`. Both stopped at the end.
- Browser: Playwright 1.64, headless Chromium, one browser context per account (Owner, Admin, a stranger, a solo
  owner), real sign-in, sign-up and invite flows. The desktop browser pane was available and not used (several
  sessions at once were needed). No Safari, Firefox, real phone or screen reader.
- Accounts: the seeded developer account plus three made through sign-up. Fixture data only.
- The machine slept once mid-run (about 15:25 to 15:42 UTC). The quiet-while-deleted check was repeated after it
  with a control (below).

## Developer checks, run independently
| Check | Result |
| --- | --- |
| `npm run typecheck` | clean (start and end of the run) |
| `npx vitest run`, fresh database, run 1 | 4146 passed, 5 failed, 75 skipped. Failed: `openrouter.qa.test.ts` (known), `services/lifecycle/guides.test.ts` (4) |
| `npx vitest run`, fresh database, run 2 | 4143 passed, 8 failed, 75 skipped. Failed: `openrouter.qa.test.ts` (known), `idle.cadence.db.test.ts` (2), `lifecycle/autopilotIntro.test.ts` (2), `lifecycle/education.test.ts` (3) |
| Each failing file alone on a fresh database | all pass: guides 15/15, idle.cadence 24/24, autopilotIntro 17/17, education 27/27 |
| The feature's 17 test files alone on a fresh database | 181 passed, 0 failed |

Classification: one known baseline failure; the rest is the known shared-database flake (lifecycle, idle cadence),
a different file each run, none in the feature's files. No regression found. I did not measure the flake rate on
`ead40f9b`, so I cannot say whether the new database tests make it more frequent. Both full runs shared the
machine with the web app compiling.

## Acceptance criteria
| | Result | Evidence |
| --- | --- | --- |
| DEL-1 | pass | Admin's Settings has no "Delete business" (`qa/01`); Admin POST with the right domain → 403; stranger → plain 404; an Admin of the open business who owns another, deleted one sees only "Recently deleted" (`qa/43`) |
| DEL-2 | pass | Wrong domain: button disabled, Enter does nothing, no request (`qa/03`). Server: wrong domain, `www.` + domain → 400 `domain_mismatch`; missing → 400. `"  FieldNote.APP  "` accepted |
| DEL-3 | pass | `purge_at − deleted_at = 168 hours` exactly, rev bumped; toast "Fieldnote deleted. You can restore it until Mon, Nov 23 at 7:19 PM."; lands on the other business (`qa/04`) or, with none left, on the no-business screen |
| DEL-4 | pass | Gone from the switcher (`qa/05`) and `me.businesses`; owner and Admin get 404 `business_deleted` on workspace, act, events, media, support, delete, current; a stranger's answers are identical to a made-up id on all of them and on restore; Admin's idle tab left in 3 s with "That business was deleted." (`qa/06`); a member saving left on the failed save, one toast (`qa/16`); old mail link → 303 `/dashboard`; email settings no longer list it |
| DEL-5 | pass, part by reading | With the worker running: 3 jobs queued after the delete (`brief.scan`, `social.send`, `publish.entry`) and 1 queued before it closed as `{skipped:'deleted'}`; a running `article.draft` stopped (one AI call already under way finished, nothing after it). About 40 minutes past due: scheduled article and 3 posts untouched, 0 jobs, 0 AI calls, 0 notifications, 0 mail, while the same worker published a due article of an active business (control). Due reminders resolved, no reminder mail. Not run by me: a publish and a social send interrupted mid-flight, weekly AI report (developer tests and reading only) |
| DEL-6 | pass, part by reading | Other business of the owner identical row for row; billing rows unchanged; a waiting proposal naming it disappears from the other account and returns on restore. "Never offered in new matching": read and developer test only |
| DEL-7 | pass | One mail per delete, dispatched within seconds (dev stubs record it as `logged`): subject "Fieldnote was deleted from Radar", "keeps it until November 23, 2026 at 3:19 PM UTC" (= `purge_at`), button to `/restore`, no token or id. Delete then restore with the worker down: mail `suppressed` (`no_longer_applicable`). "A mail failure does not fail the delete": developer test only |
| DEL-8 | pass | Two deletes at once → both 200, one `deletedAt`, one mail; a later one → 404 `business_deleted`; a business still in onboarding → 409 `not_active`; invite link to it behaves as a made-up token (signed out → `/signin`; signed in → no membership, "invalid invite" logged) |
| RES-1 | pass, with D1 and D2 | Settings list with name, domain, date, Restore (`qa/07`); `/restore` with no business left; signed out → `/signin?next=/restore` → back to `/restore`; restore line on the no-business screen (`qa/22`) |
| RES-2 | pass | Every table of the business hashed before delete and after restore: articles, calendar, connections, tokens, members and roles, packs, posts identical. Pages checked (`qa/09`–`12`). Overdue scheduled → Review, publishing → Review, drafting → Approved, overdue undrafted approved → Proposed, overdue scheduled post and unfinished send → "couldn't go out on time" with Try again, future items untouched, send at stage `create` left. Three scheduler ticks after: 0 jobs, 0 AI calls, 0 mail, nothing published or posted. Re-approved article and rescheduled post then went out normally |
| RES-3 | pass | Admin and stranger → 404 `restore_not_found`; signed out → 401; aged past the window with the wipe not run → 410 "Its 7 days have passed.", toast and row dropped (`qa/30`), not listed anywhere; after the wipe → 404 |
| RES-4 | pass | Two restores at once → both 200, one restore event; restoring again → 200, no change |
| PUR-1 | pass | The worker's own cron (minute 23 on) enqueued `business.purge`, which wiped the aged business; a second victim wiped through a queued `business.purge` job |
| PUR-2 | pass, part blocked | After each wipe a text search of every row of every table finds the id nowhere (two victims: one with team, connection, posts, tokens; one with real onboarding data: crawl pages, AI visibility, Daily Brief). Encrypted mail payloads read too: none. Files: exactly the 5 expected kept (2 covers and 2 body images of published articles, 1 cover of an entry with `publish_remote`), still served; the other 12 gone (draft cover and body image, logo, 6 social images, replaced image, nested file, a symlink). Events kept as bare counters, AI calls without the id. **Blocked:** token revokes at real providers, and the bucket path |
| PUR-3 | pass | Two runs at once over 9 due: 8 wiped once each, the unreadable one failed in one run only; that one wiped on the next run after repair. Row locked by another session → wipe skips in 1 s. 12 restore-versus-wipe races within 150 ms of the boundary: 9 restored and whole, 2 wiped and whole, 1 still deleted and whole (the wipe looked just before the boundary, the restore just after; the next run wipes it). 12 more just after the boundary: all wiped, restore refused |
| PUR-4 | pass | Active business and one inside its window → `skipped`; five SQL attempts to mis-date a row refused by the constraint; non-UUID id refused; `RADAR_PURGE=off` → cron enqueues nothing, job answers `{skipped:'off'}`; 51 due → none wiped, failure reported; unreadable published article → not wiped, 0 files deleted |
| PUR-5 | pass | Job result and log line are counts only: `[purge] due 1, wiped 1, failed 0, files deleted 12, kept 5`. A failure report names the id of the business that still exists, nothing else |
| E-1 | pass | Only business deleted → no-business screen with the add form and the restore line; restored from `/restore` |
| E-2 | pass | Same domain added again → new business; the deleted one restored next to it; later wiped without touching the newer one |
| E-3 | pass | Privacy page has the 30-day sentence and "Images inside articles Radar already published stay available so those articles keep working." |
| Experience: phone width | **fail** | D1, D2 |
| Experience: keyboard, labels, dark | pass | Focus lands on the labelled field, Tab stays in the dialog, Esc closes and returns focus, Enter opens and submits, Enter twice sends one request; busy and error states (`qa/40`–`42`); dark at desktop and phone |

Neighbours of the wipe: 22 files outside the prefix compared byte for byte, unchanged, including a business whose id
differs in the last character, folders named `<id>x` and `<id minus one character>`, and the target of a symlink
placed inside the victim's folder. The other account's decided proposal and live link stayed; its undecided
proposals naming the victim went. Owner's account, sessions and billing row unchanged.

## Defects
**D1. Settings → Recently deleted cuts off the wipe time at 375 px.** Medium. AC: Experience (phone width), RES-1.
1. Owner with one deleted business and another open. Viewport 375 × 812. Settings → Delete business.
- Expected: "Will be wiped on Mon, Nov 23 at 8:32 PM" in full (the date may move to its own line).
- Actual: "Will be wiped on Mon, Nov 23 at 8:32 P". The date is 239 px, no-wrap, in a 216 px column that hides
  overflow. At 360 px: "…at 8:32". A two-digit hour loses more.
- Evidence: `qa/28-phone-375-settings-recently-deleted.png`, `qa/28-phone-360-settings-recently-deleted.png`.

**D2. `/restore` does not shrink below about 398 px.** Medium at 360 px, low at 375 px. AC: Experience (phone width).
1. Owner with a deleted business. Open `/restore` at 360 × 760.
- Expected: text and the Restore button inside the screen with the page's side margin.
- Actual: the content column stays 350 px wide (the row's minimum width) inside a 398 px parent clipped by the
  page. At 360 px the Restore button and the first line of the paragraph are cut by 14 px, with no scroll. At
  375 px nothing is cut but the right margin is 1 px against 24 px on the left.
- Evidence: `qa/27-phone-360-restore-page-button-cut-off.png`, `qa/23-phone-dark-restore-page.png`.
- Same cause as D1 (the no-wrap date). This is the page the confirmation email opens.

No defect found in delete, restore, the gates or the wipe.

## Observations, no action required by the brief
- After a restore the pack list does not show that a post was held back; the copy and Try again are inside the
  pack, on the platform's tab (`qa/13`). Existing behaviour for failed posts; decision G says no notification.
- The email gives the wipe time in UTC, the app in the viewer's time zone. Same instant.
- `keptKey` accepts any http(s) address whose path contains the business id (the "earlier public base" rule). It
  can only keep that business's own files, and I found no action that lets a user set an article image address.
- Reminders that came due while deleted are resolved and not sent after a restore (as designed).
- Operator alert jobs can hold a wiped id for up to 14 days (listed in architecture §4.7); alerts are off locally.

## Not run, and why
- **Bucket path of `deletePrefix`** (list, batch delete, paging): no bucket here and Docker is not running. Unit
  tests with a fake client pass; `scripts/check-storage-delete.ts` passed on local disk only.
- **Real revokes** (Google, X, LinkedIn): stubs only.
- **Billing on**: delete of a locked business (402) and restore without a subscription (decision H).
- A publish and a social send stopped mid-flight; a mail failure during delete; weekly AI report suppression; new
  backlink matching; `backlinks/verify.ts`; the wipe's 5-minute budget and timeouts; cross-site and guest refusal.
  Developer tests or reading only.
- Real mail delivery (dev stubs record the mail instead of sending it).

## Fixture notes
- I set `email_verified_at` on the seeded account, cleared its sign-in rate-limit rows once, and used SQL for: body
  images, `publish_remote`, cross-account proposals and live links, a billing row, ageing timestamps, and the
  in-flight states (`publishing`, `drafting`, `sending`). Everything else went through the app.
- Left behind: database `radar_qa`, storage `.data/qa-uploads` (ignored by git), evidence in `qa/` (screenshots,
  `scripts/`, `tools/`). The `tools/*.ts` helpers call the product's own `purgeOne`, `purgeDue` and
  `restoreBusiness` from a second process; they are not part of the type check or the test run.

## Retest (D1, D2)
Tested revision `f315d3dbac88b33b0a08c15ba9f3a54054443627`. `git log b732b39a..HEAD --stat` shows one commit touching
`src/app/radar.css` (a comment) and `src/features/restore/RecentlyDeleted.tsx` only, so the retest covers the
"Recently deleted" row in its two places and nothing else. Same environment as before: `next dev` on port 3421,
database `radar_qa`, Playwright headless Chromium, time zone set to America/New_York so the times have two-digit
hours. The worker was not needed and not started. No product code changed, nothing committed.

Rows used: a real business deleted through the app per owner (wipe line "Mon, Nov 23 at 11:43 AM"), plus fixture
rows with a 76-character name and an 82-character domain, and a 55-character name with no spaces
("Wed, Nov 25 at 10:32 PM").

**Verdict: D1 and D2 are fixed. Nothing else moved. No open defect from QA.**

| Item | Result | Evidence |
| --- | --- | --- |
| 1. Settings → Recently deleted at 320, 360, 375 | pass | Wipe line whole on every row, wrapped as "Will be wiped on Wed, Nov 25" / "at 10:32 PM" (at 320: "…Wed, Nov" / "25 at 10:32 PM"); "at 10:32 PM" always on one line; Restore button 73 × 32 px, fully on screen, not covered; margins 16 px left and right; no sideways scroll. `qa/50-retest-settings-{320,360,375}.png` |
| 1. `/restore` at 320, 360, 375 (owner with another business, and owner with none left) | pass | Same checks; margins 24 px left and right for the rows and the paragraph (was 24 and 1 at 375, cut at 360); no sideways scroll. `qa/51-retest-restore-two-rows-*.png`, `qa/53-retest-restore-no-business-*.png` |
| 1. Long name and long domain | pass | Both break inside the column at every width; nothing passes the screen edge; the button keeps its place |
| 2. Desktop 1280 unchanged, both places | pass | In the same page I laid each row out as fixed and as it was before (date no-wrap, ordinary spaces) and compared the boxes of the row, name, domain, date and button: identical for 3 rows in Settings and 3 on `/restore`. `qa/55-retest-desktop-1280-*.png` |
| 3. Restore from Settings at 375 (tap) | pass | Lands on `/dashboard`, toast "Lumenstudio restored.", business open. `qa/52-retest-settings-375-restored.png` |
| 3. Restore from `/restore` at 320 (tap), no business left | pass | Lands on `/dashboard`, toast "Solobakery restored.", business current. `qa/54-retest-restore-320-restored.png` |
| 4. `npm run typecheck` | pass | clean |
| 4. The feature's 17 test files, fresh database | pass | 181 passed, 0 failed |

93 measured checks at phone widths plus the two restores, 0 failed. Two of my own desktop assertions failed first and were wrong, not the
product: one compared box tops that differ by a pixel between an element and its text, one assumed `/restore` is
centred at 1280 (it sits in the right half, as before). The box-for-box comparison above replaced them.

Not covered by this retest:
- Dark appearance was checked at 360 (Settings) and 320 (`/restore`) only; other widths were light.
- Chromium only. The fix keeps "at 10:32 PM" together by replacing the two ordinary spaces around the time. A
  browser whose date formatter puts a narrow no-break space before AM/PM would not match that pattern; the time
  and AM/PM would still stay together and nothing would be cut, but "at" could end the line above. Read from the
  code, not observed.
- The full `vitest` suite was not rerun: the change is one component and one CSS comment.

One note, unchanged by the fix: on `/restore` at 1280 the text column is about 329 px, so the domain and the date
share a line only for short domains; "lumenstudio.test" already puts the date on the next line.

Left as found: both real businesses active again, retest fixtures removed, web process stopped, `tsconfig.json`
restored. Scripts: `qa/scripts/retest.mjs`, `qa/scripts/retest-desktop.mjs`.
