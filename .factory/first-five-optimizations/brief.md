# First five optimizations

Source: product review of 2026-11-10 (code reading plus a local stub-data walkthrough). Owner approved the five
"do first" items and made two policy decisions (below). Branch `kenny-dev/radar-optimization-review-dda3f5`, base
`2d41a801`. Delivery target: reviewed PR against `main`; merge and deploy need the owner's go-ahead.

## Problem
1. A new customer's first session is empty: nothing is generated when onboarding commits, and the trial is 3 days.
2. Background AI and API work runs at full cadence for businesses nobody opens.
3. Every write, including each autosave, returns the entire workspace with every article body (measured locally:
   298-byte save, 44 KB response with one drafted article; it grows with use).
4. Reviewing articles dead-ends after each approval, and failures appear only as a 4.2 s generic toast.
5. A failed renewal locks the account at once; trial time left is invisible; trial/onboarding pages have no way out.

## Owner decisions (2026-11-10)
- Idle policy: **tiered**. Idle 7+ days: no 2-hour brief rescans; AI visibility and social packs weekly; morning
  brief unchanged. Idle 30+ days: rescans, visibility and social packs paused until the owner returns. Businesses
  with Autopilot on are never slowed. "Idle" = no signed-in app use and no email link click.
- Failed renewal grace: **2 days** of full access with a banner, then the existing lock.
- Rescans must be earned (added 2026-11-10): a 2-hour background rescan runs only if the owner has copied,
  posted or discarded at least one of the day's recommendations since the previous scan. No action, no rescan.

## Acceptance criteria

### FS — first session
- FS-1 When a business first becomes active *and* has access (trialing/active, comp, or billing off), Radar queues
  a calendar generation, a first Daily Brief scan with default settings, and an AI visibility run. Started
  automatically at most once per business, safe under retries and double commits; if starting fails, the Dashboard
  shows the affected rows as failed with Retry. Applies to the first business and to "Add a business".
- FS-2 While any of those is queued or running, the Dashboard shows a "Radar is preparing your first week" state
  with one live row per job (label, step/progress, link to its screen) instead of the two start tiles. It survives
  reload and leaves by itself when the jobs finish.
- FS-3 One job failing does not block the others or the commit. The failed row says what failed and offers Retry.
  A failed row stays until it is retried successfully, dismissed, or 7 days pass.
- FS-4 Businesses that were already active before this ships are untouched (no backfill, no surprise jobs).

### IS — idle spend
- IS-1 Each business records when a member last used the signed-in app (opened or navigated it, or made a change)
  or clicked a Radar email link, written at most hourly. Background refreshes of an open tab do not count. Background jobs never count as activity. Existing businesses start as "active now" at migration.
- IS-2 Tiers: *active* (activity < 7 days ago, or Autopilot enabled, or became active < 7 days ago), *idle*
  (7–30 days), *dormant* (30+ days). Brief 2-hour rescans: active only. Nightly AI visibility and automatic social
  packs: active as today; idle at most once per 7 days; dormant paused. Morning brief scan: unchanged in all tiers.
- IS-3 When an idle or dormant business becomes active again, normal cadence resumes on the next scheduler tick
  with at most one catch-up run per job kind (no backlog burst). AI visibility: one catch-up run on return if the
  last run is over 24 h old; the nightly cadence resumes at the next 02:00 window.
- IS-4 A background rescan does no source collection or model call when no account/platform has a reply slot left
  for the day. Manual "Scan again" and the morning scan behave as today.
- IS-7 A background rescan is due only when at least one of today's brief items was copied, marked posted or
  skipped/discarded after the day's most recent scan started. With no such action it is not enqueued, however much
  time has passed, in every tier. Manual "Scan again" and the morning scan are unaffected.
- IS-5 AI visibility makes no extraction model call for an answer that cannot match the business (same
  normalisation the matcher uses), provided what is stored and shown is identical to today. If extraction output
  is used for anything else (e.g. competitor names shown in the UI), keep the call and say so.
- IS-6 A visibility run bumps the workspace revision once per run, not once per cell. The AI Visibility grid still
  fills in while a run is in progress.
- Thresholds live in one place and are unit-tested.

### LS — lighter saves
- LS-1 Debounced autosaves get back only the new revision (no workspace). An `article.save` response is < 1 KB.
- LS-2 The workspace no longer carries article bodies. It carries only the per-article fields other screens need.
  The body loads when an article opens, with a skeleton and an error state with Retry.
- LS-3 No behaviour change in article editing, autosave, live draft streaming, body images, calendar, dashboard
  counts, publishing or social flows that read articles.
- LS-4 No lost or clobbered edits: optimistic text is kept while typing; an edit from another tab or teammate
  still reaches an open article that has no unsaved changes.
- Not in scope: splitting the React context or reducing re-render breadth; SSE transport changes.

### RL — review loop and activity
- RL-1 An article in review shows its position ("2 of 5") with previous/next across articles awaiting review
  (by publish date). "Approve and next" approves and opens the next one; after the last it returns to the review
  list with a confirmation.
- RL-2 Calendar view, filter and open entry live in the URL; Back from an article returns to the view it came from.
- RL-3 Clicking a calendar entry that is ready for review opens the article directly.
- RL-4 A persistent Activity list in the shell (bell with unread count) shows Radar's notifications for the
  business, newest first, each with its action link; it survives reload. The list is marked read per member, all
  at once (opening it, or Mark all read).
- RL-5 A failed article draft or calendar generation shows an inline failed state naming the item, with Retry, on
  its screen, for as long as the job record exists; the same failure appears in Activity.
- RL-6 Error toasts stay until dismissed, have a close button and use `role="alert"`. Other toasts are unchanged.

### BE — billing edges
- BE-1 A subscription that goes `past_due` keeps full access (app and background jobs) for 2 days from when it
  became past due, then locks exactly as today. The period is one constant, overridable by env. Grace applies only
  to a subscription that was `active` (has paid) when the payment failed: a first charge that fails at the end of a
  trial locks as today (PM reading of "paying customer"; one condition to flip if the owner wants otherwise).
  Accounts already past due when this ships get no retroactive grace.
- BE-2 During grace every app screen shows a banner: payment failed, the date access ends, and a button to update
  the card (owner). Members see the same message without the button.
- BE-3 While trialing, the shell shows "Trial · N days left" linking to Settings → Billing, which states the
  charge amount and date. Hidden for comp, grandfathered and billing-off accounts and for non-owners.
- BE-4 `/start-trial` and the onboarding stage show "Signed in as {email} · Sign out · Need help?" to signed-in
  users (a guest sees only "Need help?"). Sign out works and lands on the public home page; help is the existing
  support email link.

## Design
Extend the existing system in `src/components/ui.tsx` and `src/app/radar.css` (no new dependencies, no new visual
language). New surfaces: dashboard preparing state, activity bell + panel, article review pager, grace banner,
trial chip, signed-in footer. Each needs loading, empty, error, keyboard, and ≤640 px behaviour.
Copy says "Radar", never a model or provider.

## Exclusions
Keyword-suggestion cadence, scheduler/queue restructuring, cheap model tier, guest-funnel changes, undo for
destructive actions, trial-ending email (retired on purpose).

## Constraints
- One new migration set, numbered after `0016`, owned by a single task; web and worker deploy together.
- Typecheck clean; baseline has one known failing test (`openrouter.qa.test.ts` golden snapshot) — do not touch.
- Role, tenant and billing gates must hold on every new action and route.
