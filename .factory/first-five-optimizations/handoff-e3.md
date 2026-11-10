# OPT-E3 handoff: billing edges (BE-1 … BE-4) and first session (FS-1 … FS-4)

Worktree `.claude/worktrees/agent-a50b32d49e24bf207`, branch `worktree-agent-a50b32d49e24bf207`, one commit on top of
`b2c33a50`. The worktree was created at `main` (`93be7642`) and reset to `b2c33a50` as instructed. `main` is 7 commits
ahead of the feature base (PR #42, weekly report emails); none of them touches a file changed here.

Started from `e3-partial.patch` (15 files) plus three untracked files. All 15 were inside this task's file list; no hunk
was reverted. The patch type-checked but broke one existing test and had two defects (below).

## What each criterion does and where

| | Behaviour | Where |
|---|---|---|
| BE-1 | A subscription that goes `active → past_due` gets `past_due_at = now`; while `now < past_due_at + grace` the account grants access exactly like `active`. `trialing → past_due`, and a row already past due with `past_due_at` NULL, stay NULL and lock as before. Any other status clears the clock. Grace is `PAST_DUE_GRACE_HOURS = 48`, overridden by `RADAR_PAST_DUE_GRACE_HOURS` read at call time; `0` locks at once; unusable values mean 48. | `src/lib/billing.ts`, `src/server/billing/access.ts` (`graceMs`, `graceEndsAt`, `inGrace`, `accountGrants(a, now?)`), `src/server/billing/sync.ts` (`writeSubscription`). No gate was edited: `ownAccess`, `bizAccess`, `accessSummary`, `gateBusiness`, the job queue and lifecycle-mail eligibility already call `accountGrants`. |
| BE-1 (dev) | `POST /api/billing/dev/simulate { status: 'past_due', pastDueHoursAgo }` moves an existing clock back. It cannot start one. | `src/app/api/billing/dev/simulate/route.ts`, `src/server/testing/billing.ts` |
| BE-2 | `Workspace.billing.graceEndsAt` for every member while the owner is in grace; `payer` only for the owner. The banner states that the payment failed and when access ends ("Thu, Nov 12 at 4:43 AM", viewer's zone). The payer gets "Update card" (the existing `PortalButton`); a member is told to ask the owner and gets no button. Neither sentence promises a retry. Settings → Billing repeats the date. | `src/server/billing/notice.ts`, `src/server/billing/overview.ts`, `src/features/billing/{GraceBanner.tsx,notice.ts,BillingSettings.tsx,edges.css}` |
| BE-3 | `Workspace.billing.trialEndsAt` only for the payer while `trialing`; absent for comp, grandfathered, billing-off and members, so the chip renders nothing for them. "Trial · 3 days left" / "1 day left" / "ends today" (calendar days in the viewer's zone, never negative), a real link to `/settings?section=billing`. Settings → Billing adds "Your card will be charged $49 on {date} for your first month ($50 less the $1 card confirmation), then $50 a month. Cancel before then to avoid the charge.", computed from `priceCents − FEE_CENTS` like the `/start-trial` fine print; hidden when a cancellation is scheduled, when not trialing, and when billing is not enforced. | `src/features/billing/{TrialChip.tsx,notice.ts,BillingSettings.tsx}` |
| BE-4 | "Signed in as {email} · Sign out · Need help?" under the `/start-trial` form (both states) and as the last row **inside** the onboarding dialog. A guest on `/start` sees only "Need help?". Sign out = `POST /api/auth/signout`, then `window.location.assign('/')`; on failure an inline alert and the user stays. Help = `mailto:support@thally.io`. The in-app "Add a business" dialog has no footer. | `src/features/billing/SignedInFooter.tsx`, `TrialPage.tsx`, `src/features/onboarding/{Onboarding.tsx,OnboardingStage.tsx}`, `src/server/billing/guard.ts` (`email` in the props) |
| FS-1 | `commitDraft` writes `onboarding.firstRun = { at }` in the UPDATE that flips the status, then (after its transaction) `startFirstRun` enqueues `calendar.generate`, `brief.scan` (mode `first`) and `visibility.run` with the same singleton keys their screens use, and stores the three ids with one revision bump. The status flip is the once-only claim; `startFirstRun` does nothing once ids are stored. An enqueue that throws is stored as `null` and does not stop the others. | `src/server/billing/draft.ts`, `src/server/services/firstRun.ts` |
| FS-2 | `Workspace.firstRun = { at, items }` while any item is queued, running or failed. The Dashboard shows "Radar is preparing your first week." with one row per item: title, live step from the event stream, a short progress note and bar, a status word with an icon, and a link to `/calendar`, `/brief` or `/performance`. It survives reload (state is in the workspace) and leaves when the refetched workspace has no `firstRun`. | `src/features/dashboard/{FirstWeek.tsx,firstWeekRows.ts,first-week.css}` |
| FS-3 | Item `failed` when its job failed, when a brief scan ended `done` with `result.failed` (not dismissed), when it was never queued, or when the commit's ids were never stored for 60 s. A failed row says what failed ("Radar couldn’t build your content calendar.", plus a specific reason when the job gave one) with Retry. `firstRun.retry { key }` re-enqueues that one job and tracks the new id; `firstRun.dismiss` sets `dismissedAt`. Both role `Editor`. A failed row leaves when retried successfully, dismissed, after 7 days, **or when a newer job of that kind for the business finished well** (PM ruling). When nothing is working and something failed the heading becomes "Radar couldn’t finish preparing your first week." and "Dismiss" is offered. | `src/server/services/firstRun.ts`, `src/server/actions/firstRun.ts`, `FirstWeek.tsx` |
| FS-4 | No marker, no jobs, no query: `firstRunOf` returns before touching the database for a business without `onboarding.firstRun`. | `src/server/services/firstRun.ts` |

## Files

Server: `src/lib/billing.ts`, `src/server/billing/{access,draft,guard,notice,overview,sync}.ts`,
`src/app/api/billing/dev/simulate/route.ts`, `src/server/services/firstRun.ts`, `src/server/actions/firstRun.ts`,
`src/server/testing/billing.ts`.
Client: `src/features/billing/{BillingSettings,GraceBanner,TrialChip,TrialPage,SignedInFooter}.tsx`,
`src/features/billing/{notice.ts,edges.css}`, `src/features/dashboard/{FirstWeek.tsx,firstWeekRows.ts,first-week.css}`,
`src/features/onboarding/{Onboarding,OnboardingStage}.tsx`.
Tests: new `src/server/billing/grace.test.ts`, `src/server/services/firstRun.test.ts`,
`src/features/billing/notice.test.ts`, `src/features/dashboard/firstWeekRows.test.ts`; edited
`src/server/billing/guard.test.ts` (see "Existing test changed").
Not touched: `stub.ts`, `activate.ts`, `restart.ts`, `state.ts`, every file on the must-not-touch list.

`src/features/dashboard/firstWeekRows.ts` is a new file that was not on my list. It holds the row wording and the
live-job merge as pure functions so they can be tested (the repo has no DOM test tooling and vitest only collects
`*.test.ts`). Say so if it should be folded into `FirstWeek.tsx`.

## What I changed from the patch, and why

1. **`overview.ts`: `graceEndsAt` is present only during grace.** The patch always returned `graceEndsAt: null`, which
   broke `management.test.ts` (exact response shape); the no-database suite had 2 failures instead of 1. The response
   is now unchanged for every account outside grace.
2. **`firstRun.ts`: wrong platform name.** A brief scan with a failed source was labelled with `platLabel`, the blog
   connector table, so `reddit` read "Radar couldn’t read WordPress." It now uses `BPLAT` and the Daily Brief's own
   wording: "Reddit didn’t respond, so today’s brief isn’t ready."
3. **`firstRun.ts`: retry on a still-starting row.** A row with no job id yet and status `queued` fell through to the
   enqueue. That could store one id before `startFirstRun` stored its three, turning its final UPDATE into a no-op and
   losing two ids. Retry now starts nothing unless the row is failed, and answers `{ jobId: null }` in that state.
4. **`firstRun.ts`: later success (PM ruling).** Only when a row is failed, one extra query reads the business's jobs
   of those kinds created after the failure. A job that finished well (`done`, not `skipped`, no `result.failed`)
   makes the row done. I also let a newer queued or running job of that kind take the row over, so the Dashboard shows
   that run instead of a stale failure while a manual "Scan again" or calendar regeneration is in flight; if it
   fails, the row goes back to failed.
5. **Onboarding footer inside the dialog (PM ruling).** `Onboarding` takes `footer?: React.ReactNode` and renders it
   as the last row of the modal column; `SignedInFooter`'s `bar` prop became `inModal`; the fixed bar and its
   `body:has(...)` rules are gone.
6. **Footer layout.** On `/start-trial` the single line wrapped and left a separator dangling. The address is now on
   its own line above "Sign out · Need help?", and one line only inside the wide dialog.
7. **Deadline wording.** "ends Thu, Nov 12, 4:05 PM" → "ends on Thu, Nov 12 at 4:05 PM".
8. **Banner colour.** Mixing `--bad` with `--line` / `--paper` in oklch drifted to a lavender rule and a tan wash;
   it now mixes with `transparent` (the pattern radar.css already uses) and stays red in light and dark.
9. `src/server/testing/billing.ts`: `billing.simulate(status, pastDueHoursAgo?)`.

## Existing test changed

`src/server/billing/guard.test.ts` asserted the exact props of `onboardingGuard`: `user: { name: 'Ada' }`. BE-4 adds
the email to those props, so the expectation is now `user: { name: 'Ada', email: u.email }`, and the `trialGuard` case
also asserts `props.email`. Nothing was loosened; this is the one place an existing assertion had to follow a
contract change. No other existing test was edited.

## Tests added (52)

`src/server/billing/grace.test.ts` (15; 3 run without a database)
- Predicate: access at 47 h, none at 49 h and at exactly 48 h; env override read at call time; `0`; junk values fall
  back to 48; no clock means no grace; a stale timestamp on `unpaid` / `canceled` / others never grants.
- Stub provider through the real routes: `active → past_due` sets the clock and keeps access, 49 h later the state is
  `restart`; `trialing → past_due` leaves it NULL and locks, and the dev knob cannot create a clock; a row already
  past due with NULL stays locked after a later webhook; a later sync keeps the original clock; `active → past_due →
  active → past_due` starts a new one and paying clears it; `unpaid` and `canceled` clear it and lock; env `0`.
- Gates: `gateBusiness`, the workspace route and the act route let the owner and a member in during grace and answer
  402 `subscription_required` after it.
- Queue: a job for the business runs during grace and finishes `{ skipped: 'no_access' }` after it.
- Notice: payer and member during grace, trial end for the payer only, nothing for a paying account, the env override
  moves the date, no date after grace; undefined for comp, for an owner without a billing row, with billing off, and
  for an owner not on an email list.

`src/server/services/firstRun.test.ts` (17, database)
- Each commit path starts the three jobs once: `onboarding.save` with access (also "Add a business"), trial start
  with `confirm` racing the webhook, `resolveEntry`, `trialGuard`; a repeat of each starts none.
- Three racing commits: one wins, three jobs; `startFirstRun` again, also after the jobs finished, adds nothing.
- A business without the marker, and a draft, get nothing; retry answers 409.
- One enqueue made to throw: the commit stands, two jobs exist, the third row is failed with "Radar couldn’t start
  this."; retry while the queue is still down is a 503 and the row stays failed; then retry works.
- Ids never stored: three `queued` rows for 60 s (retry starts nothing), then three failed rows.
- Rows follow job state and progress; `firstRun` is absent when all three are done.
- A failed job is a failed row and the job's internal `detail` never reaches the client.
- Brief `done` with `result.failed` is a failed row naming the platform; dismissed in the Daily Brief it is not.
- Later success: another business's job, an older job, another kind, a skipped job and a failed job do not clear the
  row; a newer running job takes it over (and retry then starts nothing); once it finishes well the row is done. For
  the brief, a later scan that also lost a source does not count. A never-started row is cleared the same way.
- The block is still there at 7 days minus an hour and gone an hour after.
- Retry replaces the tracked id for a failed row (old job `failed`, new one `queued`, payload `keep: false`), is a
  no-op on a queued and on a done row, and rejects an unknown key.
- Dismiss by an Editor hides it for the owner too; the queued jobs are untouched.
- Viewer: sees the rows, gets 403 on both actions; a non-member gets 404; no session gets 401; nothing changed.
- Both actions answer 402 once the owner has no access.

`src/features/billing/notice.test.ts` (8): chip day count across midnight in two zones, "ends today", never negative;
deadline format; both banner sentences and that neither mentions a retry; the charge line equals the `/start-trial`
figure at two prices and is absent when no charge is coming; the grace line.

`src/features/dashboard/firstWeekRows.test.ts` (12): titles and links in every state; status words; the calendar,
brief and visibility step wording and progress; done lines; failed wording (specific reason added, catch-all not
repeated, no job or provider names); live job over workspace item, including a brief scan that ends `done` with a
failed source and the workspace's final verdict winning over an older stream entry; when Dismiss is offered.

Mutation check (source edited, test run, source restored): each of these made one or more tests fail: grace for
`trialing → past_due`; a fresh clock for a NULL row; `inGrace` dropped from `accountGrants`; the later-success rule
removed; the marker removed from the commit; retry always enqueueing; `startFirstRun`'s "ids already stored" guard
removed (only after I added the "once the jobs have finished" case; while the jobs are queued the singleton keys hide
it); the brief label taken from the blog table; the overview always returning `graceEndsAt`; a member being told the
trial end.

## Checks

- `npm run typecheck`: passes.
- `npm test` (no database): **1099 passed, 400 skipped, 1 failed**. Baseline 1076 / 371 / 1. The failure is
  `src/server/ai/openrouter.qa.test.ts` (golden snapshot, pre-existing, untouched). +23 passed and +29 skipped are the
  new tests.
- Database (`radar_first_five_e3_ae14ad8c`, migrated from zero, `RADAR_DEV_STUBS=1 npx vitest run
  --no-file-parallelism`): **1448 passed, 65 skipped, 1 failed** (the same golden snapshot). Baseline 1396 / 65 / 1;
  +52 are the new tests. `customImages.db.test.ts` did not time out.
- `next build` (stub env, throwaway database): compiled and generated 39 static pages, exit 0. `.next` removed after.
- The patch as received, before my changes: no-database suite 1075 passed, 2 failed (`management.test.ts` was the new
  one); with a database `guard.test.ts` also failed on the new `email` prop. Both are dealt with above and below.

## Browser pass

Web (`next dev -p 3423`) and worker from this worktree against a second throwaway database, `RADAR_DEV_STUBS=1`,
`RADAR_BILLING=on`, stub provider. Playwright 1.64 driving headless system Chrome (no Playwright browser is installed
on this machine; nothing was downloaded). Sign-up used the dev-stub Google sign-in. Scripts are in the scratchpad
(`e3r/pw/`), screenshots in `$SCRATCH/e3-shots/` (52 files). Every surface was also captured at 375 px; measured
horizontal overflow was 0 px each time. No page errors apart from the two I caused on purpose (an aborted sign-out
request, the stub's 503 for the portal). `a03-*` and `c01-*` / `c04-*` were taken before items 6 and 8 above; `d05-*`
(footer) and `e01-*` / `e02-*` (banner) show the final look.

- **A, guest to first week** (`a01`–`a11`): `/start` shows only "Need help?" inside the dialog. Onboarding, save,
  sign-up, `/start-trial` with the footer, stub card, "Open dashboard". The Dashboard opened on "Radar is preparing
  your first week." with live rows ("Researching keywords · Step 4 of 7", "Reading X · 1,120 threads read", "Choosing
  what’s worth your time", "Drafting for you and {name}") and became the normal dashboard after about 7 s ("30
  proposed topics are waiting for approval."). Database after: 30 calendar entries, 1 brief day with `brief_setup`
  true, 35 AI visibility results. Calendar, Daily Brief and Performance screenshots show the data. Chip "Trial · 3
  days left" opens Settings → Billing with the $49 line; the chip is in the drawer at 375 px.
- **B, failure, Retry, Dismiss** (`b01`–`b06`): with the worker paused the three rows read "Queued · Waiting to
  start." and survive reload. I forced the failure by writing the calendar job row as the queue writes a failed job
  (status, error, `finished_at`) and bumping the revision, with the worker paused so nothing raced it. The row turned
  to "Failed · Radar couldn’t build your content calendar." with Retry; no Dismiss while the others were queued. With
  the worker resumed the other two finished, the heading changed and Dismiss appeared. The failed row still opened
  `/calendar`. Retry went queued → working → done and the page left; the tracked job id was replaced and 30 entries
  exist. Then "Add a business" in the app (no footer in that dialog) started its own three jobs; its brief job was
  written as `done` with `result.failed = reddit`, the row read "Radar couldn’t finish today’s Daily Brief. Reddit
  didn’t respond, so today’s brief isn’t ready."; Dismiss removed the block and it stayed gone after reload.
- **C, grace** (`c01`–`c06`, `e01`, `e02`): trialing shows no banner. After `active` then `past_due` the owner sees
  the banner with "Update card" on Dashboard, Calendar, Brief, Performance and Settings; Settings → Billing shows the
  grace line. Clicking "Update card" shows "Payments aren’t available right now. Try again in a few minutes." (the
  stub has no portal, so only presence and copy were checked). A member added to the business sees the member
  sentence with no button and no chip. After `pastDueHoursAgo: 49` the workspace API answers 402 for both, the owner
  lands on `/start-trial` ("Restart your subscription"), the member on `/onboarding` (existing behaviour for a member
  with no business of their own). Banner also captured in dark mode.
- **D, footer and sign out** (`d01`–`d06`): signed in on `/onboarding` the footer is inside `[role=dialog]`, none
  outside it, and the shell behind is inert. Tab from the domain field goes Analyze website → Sign out → Need help?.
  Sign out lands on `http://localhost:3423/` and `/api/me` answers 401. On `/start-trial` an aborted sign-out request
  shows "Radar couldn’t sign you out. Try again." and the session stays; the next click lands on `/`.
- Reduced motion: with `prefers-reduced-motion: reduce` the spinner's computed animation duration is 1e-06 s (the
  existing global rule). I did not screenshot it.

Seen and not mine: a second `visibility.run` started 14 s after the first for the flow-A business. The business
timezone put it at 04:39, inside the nightly 02:00–05:59 window, so the nightly cron ran it. architecture.md §8
accepts this ("may run AI visibility twice in its first 24 h").

## Deviations from architecture.md

- `firstRunOf` makes a second query while a row is failed (PM ruling), and a newer queued or running job of the same
  kind takes a failed row over (my addition, item 4 above).
- `firstRun.retry` answers `{ jobId: string | null }`.
- `BillingOverview.graceEndsAt` is absent, not `null`, outside grace.
- The heading is "Radar is preparing your first week." only while something is queued or running. With nothing
  working and a failed row it is "Radar couldn’t finish preparing your first week."
- §8 lists "banner for payer and member, chip hidden …, sign-out lands on /" as tests. Without DOM test tooling they
  are covered at the data level (`billingNoticeOf`, the copy functions) and in the browser pass, not as component
  tests.
- `TrialChip` has an optional `onNavigate` prop (PM ruling).

## Changes needed in files I don't own

- `src/features/shell/AppShell.tsx`: `<TrialChip onNavigate={onClose} />` (known). Until then the chip navigates
  without closing the phone drawer (read from the code; I opened the drawer in the browser but did not tap the chip there).
- `.env.example`: document `RADAR_PAST_DUE_GRACE_HOURS` (default 48; `0` = lock at once; same value on web and
  worker).
- `docs/LAUNCH.md` §7c, "Failed payments": it says the account loses access while `past_due`. A paid subscription now
  keeps access for 48 h. Worth adding that if Stripe's retry settings move the subscription to `unpaid` or `canceled`
  before 48 h, the grace ends then.
- `docs/CONTRACTS.md`: `Workspace.firstRun`, `Workspace.billing`, `BillingOverview.graceEndsAt`, the actions
  `firstRun.retry` / `firstRun.dismiss`, and `pastDueHoursAgo` on `POST /api/billing/dev/simulate`.

## Untested or uncertain

- **Real Stripe.** Everything here ran on the stub. Not verified: that updating the card in the hosted portal makes
  Stripe retry the open invoice; that the portal configuration lets the customer pay it; how soon Stripe's retry
  schedule moves a subscription out of `past_due`. During grace `/start-trial` redirects to the dashboard and
  `/api/billing/restart` answers `already_active`, so the portal is the payer's only way to pay until the grace ends.
  After it, the existing restart page pays the open invoice.
- "Update card" was checked for presence and failure copy only.
- A Viewer cannot retry or dismiss. If nobody else acts, a Viewer sees the first-week page instead of the dashboard
  for up to 7 days after a failure.
- When a failed brief scan is dismissed from the Daily Brief ("Try again" / "Keep"), the row counts as done at once,
  as architecture §1 specifies, even if the new scan then fails.
- `FirstWeek.tsx` re-asks the workspace on a timer in two cases no revision bump announces (ids not stored yet; every
  job ended on the stream while the workspace still lists one as working). The server side of both is tested; the
  timer itself was not exercised.
- Settings → Billing still has the pre-existing hard-coded "Radar · $50/month" and "three-day trial" strings; the new
  charge line does not use them.
- Not checked: a screen reader, the email-link sign-up path in the browser, the first-week page in dark mode (it uses
  existing tokens only).

## Integration

Take the single commit. No migration, no new dependency, no new endpoint; two new actions (`firstRun.retry`,
`firstRun.dismiss`, already spread in `actions/index.ts` by F0). After merge make the AppShell `onNavigate` edit and
the three documentation edits above. `RADAR_PAST_DUE_GRACE_HOURS=0` turns grace off without a deploy.
