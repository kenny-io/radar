# First five optimizations: architecture (OPT-A1)

Base `14e51cd8` (brief incl. IS-7). Design only. `file:line` references are to that revision. "Not confirmed" marks
anything I could not verify in code or primary docs.

## 0. Shape of the work

- **OPT-F0 (PM, before E1–E3 start):** one inert "foundations" commit: migration 0017, `schema.ts`, `types.ts`, stub
  modules and one-line call sites in the hot files (§7.1). After F0 the hot files `schema.ts`, `drizzle/*`,
  `types.ts`, `AppShell.tsx`, `Dashboard.tsx`, `src/server/access.ts`, `actions/index.ts` are **frozen**; engineers
  fill in their own stub files. A type or column change after F0 goes through the PM.
- E1, E2, E3 in parallel after F0. E4 after E2 is merged (it then owns E2's client files).
- No new dependency, table, queue or endpoint. Four columns, five actions, CSS in per-feature files.

Findings that change the brief's assumptions (each is used below):
1. `GET /workspace` is **not** a sign of a human. Every open tab calls it when the 4-minute SSE stream ends
   (`src/client/app.tsx:97-103`, `events/route.ts:22`) and on every `rev` event caused by background jobs
   (`app.tsx:86-91`). Read actions fire from those refreshes too (`Performance.tsx:189` reloads on `B.rev`).
2. `commitDraft` is the only path to `active` and all four callers already hold access (`onboarding.ts:25`,
   `activate.ts:126`, `guard.ts:25`, `guard.ts:49`).
3. The queue already bumps the revision once when any job ends (`queue.ts:117`); the per-cell `bump` in
   `collect.ts:119,129` is extra.
4. A `brief.scan` source failure finishes as status `done` with `result.failed` (`scan.ts:92-95`), not `failed`.
5. `accountGrants` (`billing/access.ts:23`) already sits under every gate and the job queue.
6. Calendar already reads `view`, `filter`, `open` from the URL once (`ContentCalendar.tsx:49-52`) and a notify link
   uses them (`drafting/jobs.ts:138`). RL-2 makes them two-way.

## 1. FS: first session

| Decision | Reason |
|---|---|
| **Hook: `commitDraft` only** (`src/server/billing/draft.ts`). The UPDATE that flips status also writes `onboarding.firstRun = { at: committedAt }`; then `later.push(() => startFirstRun(bid))`. | Finding 2: one hook covers guest claim + trial, signup-first, Google, Add a business, billing off, comp/grandfather. The status flip is the exactly-once claim; double commits return `null` and do nothing. |
| **Idempotency lives in `businesses.onboarding.firstRun`**, not `once()`. | Same row and statement as the commit; it is also what the Dashboard reads and what makes FS-4 hold (absent on every business committed before deploy). |
| `startFirstRun(bid)` runs after the transaction commits (existing `Later` list; in `activate.ts` that is after the billing lock commits, so the queue's access check passes). It enqueues three independent jobs, each in its own try/catch, then writes the ids. | FS-3. `enqueue` cannot run inside the tx (`bump` through `db` would wait on the row the tx holds; `draft.ts:9`). |
| Crash between commit and `startFirstRun`: `firstRun.at` exists with no `jobs` after 60 s, so the workspace reports the three rows as `failed` ("Radar couldn’t start this.") with Retry. | No outbox or healing cron. See AC correction FS-1. |

Jobs started (existing kinds, no new job code):

| key | call | notes |
|---|---|---|
| `calendar` | `enqueue('calendar.generate', { settings: calendarSettingsOf(biz), keep: false }, { businessId, ref: bid, singletonKey: 'cal-gen:' + bid, maxAttempts: 2 })` | same as the action (`actions/calendar.ts:32`) |
| `brief` | `enqueueScan(bid, bizToday(biz), 'first')` (`brief/jobs.ts:26`) | default settings = `briefSettingsOf(biz)`. **Do not set `briefSetup`**: a successful first scan sets it in its own commit (`scan.ts:155`), which then starts the morning cron. |
| `visibility` | `enqueue('visibility.run', {}, { businessId, ref: bid, singletonKey: 'vis-first:' + bid })` | no `promptIds`: the job calls `ensurePrompts` itself (`visibility/jobs.ts:15`). Sharing the `vis-first:` key makes a first visit to Performance join this run instead of starting another (`actions/visibility.ts:16`). No keywords → `{ total: 0 }`, row shows done. |

Manual brief setup screen: unchanged. While the prefill scan runs the Daily Brief shows the scan view
(`DailyBrief.tsx:192-195`, not quiet). If it failed, `brief.setup` is still false and the setup screen appears as today.

Persisted state and contract:

```ts
// OnboardingState (jsonb)
firstRun?: { at: string; jobs?: Partial<Record<FirstRunKey, string | null>>; dismissedAt?: string }
// types.ts
export type FirstRunKey = 'calendar' | 'brief' | 'visibility';
export interface FirstRunItem { key: FirstRunKey; jobId: string | null; status: 'queued' | 'running' | 'done' | 'failed'; progress: any; error: string | null }
// Workspace.firstRun?: { at: string; items: FirstRunItem[] }
```

- `firstRunOf(biz)` (server, `services/firstRun.ts`) returns it only when `onboarding.firstRun` exists, is not
  dismissed, `at` is under 7 days old, and some item is queued, running or failed. It reads the three job rows **by
  id** (one query; zero queries for every older business). Item status: job `failed` → failed; `brief` job `done`
  with `result.failed` and not `result.dismissed` → failed (finding 4); job row missing → done; `jobId` null → failed.
- Dashboard: F0 inserts `if (B.firstRun) return <FirstWeek />;`. Each row uses `app.jobs[item.jobId] ?? item` for
  live progress (`calendar` `{phase, results}`, `brief` `{step, threadsRead, steps}`, `visibility` `{done, total}`),
  links to `/calendar`, `/brief`, `/performance`. It leaves by itself: a finishing job bumps the revision, the
  refetched workspace has no `firstRun`. Nothing marks "done"; absence is the marker. Jobs live 14 days
  (`maintenance.ts:7`), longer than the 7-day window.
- Actions (`actions/firstRun.ts`, role Editor): `firstRun.retry { key }` → `{ jobId }` re-enqueues that one job with
  the calls above and stores the new id; `firstRun.dismiss {}` → `{}` sets `dismissedAt`.

## 2. IS: idle spend

### 2.1 Signal (IS-1)
- Column `businesses.last_active_at timestamptz NOT NULL DEFAULT now()`.
- `touchActive(biz, actor, now?)` in `src/server/idle.ts`: returns at once for a guest or when
  `now - biz.lastActiveAt < 1 h` (uses the row the gate already loaded: **no query on the hot path**); otherwise
  `UPDATE businesses SET last_active_at = now() WHERE id = $1 AND last_active_at < now() - interval '1 hour'`.
  It does not touch `rev` or `updated_at`.

| Writes | Does not write |
|---|---|
| `POST /act` for a **non-read** action by a signed-in member (one line in the route, F0) | `GET /workspace` and all read actions (finding 1) |
| read action `app.seen {}` (role Viewer), sent by `useSeenPing(bid, pathname)` on mount, business switch and route change, at most once per 10 min per tab | SSE `/events`, including its 60 s re-auth |
| `/email/open` and `/email/learn` (with a business) after their checks pass | jobs, crons, webhooks, guests, OAuth callbacks |

### 2.2 Tiers (IS-2), one place: `src/server/idle.ts`
```ts
export const IDLE_AFTER_DAYS = 7, DORMANT_AFTER_DAYS = 30, IDLE_EVERY_DAYS = 7;
export type Tier = 'active' | 'idle' | 'dormant';
export function activityTier(b: { lastActiveAt: Date; autopilot?: unknown; onboarding?: { committedAt?: string } | null }, now: Date): Tier;
export function cadenceDue(tier: Tier, lastRunAt: Date | null, now: Date): boolean; // active: true · idle: none or ≥ 7 d ago · dormant: false
export function lastRuns(kind: string, bids: string[]): Promise<Map<string, Date>>;  // max(jobs.created_at) per business, last 8 days
```
`active` when `autopilotOf(b).enabled`, or `committedAt` < 7 d ago, or `lastActiveAt` < 7 d ago; `idle` < 30 d; else
`dormant`. Both functions are pure and unit-tested at each boundary.

### 2.3 Gated crons
"At most once per 7 days" is keyed on the **newest job of that kind for the business** (`jobs.created_at`, any
status), not on a calendar bucket: a week key could run Sunday and Monday. Jobs are kept 14 days, so the 7-day
lookback is always there. Skipping never writes a `cron_marks` row, so nothing queues up.

| Cron | Change |
|---|---|
| `brief.rescan` (`brief/jobs.ts:71`) | select `lastActiveAt, autopilot, onboarding`; skip unless tier is `active`; then §2.4. |
| `visibility.nightly` (`visibility/jobs.ts:20`) | after the 02:00–05:59 window check and **before** `once(...)`: dormant → skip; idle → skip unless `cadenceDue` with `lastRuns('visibility.run')`. Active unchanged. |
| `social.auto` (`social/auto.ts:29`) | after `isDue`, before the mark/job transaction: same rule with `lastRuns('social.autoRun')`. |
| `brief.daily`, `drafting.due`, keywords | unchanged. |

IS-3: rescans resume through `rescanDue` (one job, it only looks at the last scan); social through `isDue` (today
only, never earlier days). Visibility has a fixed night window, so `touchActive` queues one catch-up when its UPDATE
changed a row, the tier before it was not `active`, and no `visibility.run` exists in the last 24 h
(`singletonKey 'vis-run:' + bid`). At most one run per kind in every case.

### 2.4 Earned rescans (IS-7)
- Items carry no timestamp for a state change (`BriefItem`, `types.ts:166`; `brief.item` only sets `st`). Add
  `brief_days.acted_at timestamptz NULL` (day-level, any member, either account, replies and posts).
- Writers: `withDay` accepts `acted?: boolean` in the callback result and sets `actedAt = now` in the same UPDATE;
  `brief.item` passes it when `st` changed to `copied`, `posted` or `skipped` (`actions/brief.ts:104-105`).
  `social.postNow` and `social.schedule` on a brief sid call `markActed(bid, day)` (new, `brief/store.ts`).
- Counts: copied, posted, skipped, scheduled from Radar. Does not count: text edits, mention or platform toggles,
  visuals, undo to `open`, unschedule, the worker sending a scheduled post, cron expiry. PM default confirmed.
- Decision stays pure: `rescanDue({ hasDay, last, now, actedAt })` returns false unless
  `actedAt && (!last || actedAt > last.createdAt)`, then applies today's rules. "Most recent scan" is the newest
  `brief.scan` job of the day of any mode (morning, Scan again, Keep, rescan), by `createdAt`, as today.
- Cron cost: `hasDay` becomes `dayMark(bid, date) → { actedAt } | null` (primary-key read, no JSON). When `actedAt`
  is null the jobs query is skipped. Order: tier → dayMark → `scansOf` → `rescanDue`.
- Keep: a Keep run is a scan, so it restarts the clock and a new action is needed afterwards. Clicking Keep is not an
  item action.
- Note: an item action is itself a write, so it marks the business active within the hour. The tier check on
  rescans is therefore implied by IS-7; keep it as the free pre-filter.

### 2.5 No slots (IS-4)
In `runScan` right after `plats` is computed (`scan.ts:54`), before `buildPlan`, the `earlier` query and the source
loop: `if (background && accts.every(a => Object.values(slotsLeft(items, a, platsFor(a, plats), 'again')).every(n => n === 0)))`
return `{ mode: 'again', added: 0, addedIds: [], since, skipped: 'no_slots' }`. Background = `payload.background === true`
(only the cron sets it, `brief/jobs.ts:39`). Morning scan is mode `first`; Scan again and Keep have no `background`.
Add `'no_slots'` to `BriefScanResult.skipped`. With IS-7: the skipped job still counts as the last scan.

### 2.6 Extraction precheck (IS-5): skip is safe, with this exact predicate
The extraction result (`products`) is used only to compute `mentioned` and `pos` (`collect.ts:104-113`). It is not
stored (`raw` is the engine's answer), not in events, and the UI shows only status, position, citations and the
response (`Performance.tsx:236-240`). There is no "who was mentioned instead". So, with `T = norm(text)`:

`canMatch = inText || (n !== '' && T.includes(n)) || T.includes(d) || (root !== '' && T.includes(root))`

(`n`, `d`, `root`, `inText` exactly as in `collect.ts:105-108`.) If `!canMatch`, skip `ai.run` and write the same
row and events the not-mentioned branch writes today (`status 'not-mentioned'`, `pos null`, cites, resp, raw, date).
Why it is identical: `norm` is per-character, so any name copied from the text has `norm(name)` inside `T`; every
`isBiz` clause then implies one of the terms above. `inText` is kept because a non-Latin name normalises to `''`.
The only difference is an extraction that invents the business name when the answer never contained it, which
today would be a false "mentioned".

### 2.7 One bump per run (IS-6)
Delete both `bump(bid)` calls in `collectOne`. The queue's `finally` bump covers `visibility.run` and
`visibility.collect` once each (finding 3). To keep the grid filling in live, the AI Visibility tab reloads on
`jobFor('visibility.run', B.id)` progress and status as well as `B.rev` (`Performance.tsx:189`).

## 3. LS: lighter saves

### 3.1 Wire contract
- Every client request sends header `x-radar-client: 2` (`src/client/api.ts`). **No header = legacy tab**: the server
  answers exactly as today (full workspace with article bodies). Without this an open old tab would receive
  summaries, render an empty editor and could autosave an empty body.
- Request: `POST /api/b/:bid/act { action, input, reply?: 'rev' }`. Per request, not per action, because
  `article.save` is sent both debounced and immediately. `actLater` always sends `reply: 'rev'` (all debounced
  saves; it already discards the workspace via `keepLocal`).
- Response: read → `{ ok, data }` (unchanged) · write + `reply:'rev'` → `{ ok, data, rev }`, `loadWorkspace` is
  not called · write otherwise → `{ ok, data, rev, workspace }`. `bump(bid)` returns the new `rev`.
- Client, on a rev-only reply: if `rev === localRev + 1` set it; otherwise set it and mark stale so the existing
  idle refresh runs (`app.tsx:148`). Today a teammate's bump between two of my saves is swallowed; LS-4 needs this.

### 3.2 Article summary
Readers of `B.articles` today: `SocialFlow.tsx:57` (`generated`), `ContentCalendar.tsx:201` (`brief.outline`, for
Undo of Replace topic), `ArticleWorkspace.tsx:21,22,34` (everything; moves to §3.3). No server code reads the
workspace's articles; server readers query the table.

```ts
export interface ArticleSummary { generated: boolean; outline: string[]; /** articles.updated_at, epoch ms */ v: number }
// Workspace.articles: Record<string, ArticleSummary>
// ActResponse<T>: { ok: boolean; data?: T; rev?: number; workspace?: Workspace; error?: string; code?: string }
```
`loadWorkspace(bid, userId, role, opts?: { articles?: 'summary' | 'full' })`; `'full'` only for legacy requests. The
summary query selects `entry_id`, `data->>'generated'`, `data->'brief'->'outline'`, `updated_at`, never `data`.
Every writer of `articles` already sets `updated_at` (E2 confirms with a test).

### 3.3 Loading and holding one article
- Read action `article.get { entryId }` (Viewer) → `{ article: Article, v: number }`, built like `load()` in
  `actions/article.ts:28`.
- Holder: hook `useArticle(entryId)` in new `src/client/articles.ts`, state local to the hook (one open article, no
  cache: a cached copy shown before revalidation is how edits get clobbered). Returns
  `{ status: 'loading' | 'error' | 'ready', article, error, patch(fn), reload() }`. `AppCtx` gains
  `busy(): boolean` (`later.size > 0 || inflight > 0`).
- Edits: `patch` updates hook state and increments a local `seq`; saves still go through `app.actLater` / `app.act`
  with the same keys, so `flushLater` keeps working. `optimistic` no longer carries article fields.

| Refetch and apply | Never |
|---|---|
| on open (entry or business change); skeleton until ready, `Empty` + Retry on error | while `app.busy()` |
| `B.articles[id].v !== loaded.v`, checked when `v` or `B.rev` changes, and only if `!app.busy()` | apply a response if `seq` changed or `app.busy()` since the request started: drop it and recheck on the next `B.rev` change |
| `article.draft` job done with `result.draftedAt !== article.draftedAt`; `article.bodyImages` job done | because of the tab's own rev-only replies (`v` in `B` does not change) |
| after non-debounced `article.save` (cover style), `article.regenerateImage`, `article.videos` | |

- Live draft streaming is untouched: it reads job progress from SSE (`ArticleWorkspace.tsx:37-45`). The `rev`
  listener in `app.tsx` is untouched: a teammate's save → `rev` → workspace refetch when idle → new `v` → reload.
- After a burst of own saves, the next full workspace shows a newer `v` and triggers one reload of identical
  content; the `seq` guard makes it safe.

### 3.4 Actions that relied on the returned workspace for `B.articles`
`article.save` (immediate) · `article.regenerateImage` · `article.videos` · `article.regenerateBodyImages` and
`article.draft` (via `app.refresh()` on job done) → call `reload()` as in the table. `article.source` stays
optimistic through `patch`. `article.save` now returns `{ ok: true, v }`. `article.approve`, `unschedule`, `dest`,
`calendar.update`, `calendar.replace` change entries or the outline and keep working through the workspace.

## 4. RL: review loop and activity

- **Activity data.** The `notifications` table is enough: `payload { msg, tone, action }`, `created_at`, index
  `notif_biz`. No new column on it. Retention goes from 1 day to **30 days** (`maintenance.ts:8`). The SSE toast
  window (5 min) is unchanged.
- **Read state is per member, as a cursor:** `members.activity_seen_at timestamptz NOT NULL DEFAULT now()`. Unread =
  rows newer than the cursor. No per-item state (would need a join table). See AC correction RL-4.
- **Actions** (`actions/activity.ts`): `activity.list { before?: string, limit?: number ≤ 50 }` (read, Viewer) →
  `{ items: ActivityItem[], unread: number, seenAt: string }`, newest first, `user_id IS NULL OR = me`;
  `activity.seen {}` (declared `read: true` so it does not bump the shared revision; Viewer) → `{ ok: true }`.
  `ActivityItem { id, msg, tone?, action?: { label, href }, at }`.
- **Unread in the shell:** `Workspace.counts.activityUnread` (one count query in `loadWorkspace` via
  `activityUnread(bid, userId)`). Between refetches the client adds 1 per SSE `toast` id it has not seen; a
  workspace refetch replaces the number; opening the panel calls `activity.seen` and zeroes it.
- **Richer `notify()` payloads** (signature unchanged): `drafting/jobs.ts:86` → `Radar couldn’t draft “{title}”.
  Try again.` + `{ label: 'Open', href: '/article/{entryId}' }`; `calendar/jobs.ts:131` → `Radar couldn’t finish your
  content calendar. Try again.` + `{ label: 'Open calendar', href: '/calendar' }`. Others already name their item.
- **RL-5.** `Workspace.failed: { calendar: FailedJob | null; drafts: Record<entryId, FailedJob> }`,
  `FailedJob { jobId, error, at, keep?: boolean }`, from `failedJobsOf(bid)`: newest job per `(kind, ref)` for
  `article.draft` and `calendar.generate` (`DISTINCT ON (kind, ref) … ORDER BY created_at DESC`), kept when its
  status is `failed`. A later run for the same item replaces it. Lifetime = the job row: 14 days from creation
  (confirmed, `maintenance.ts:7`). UI shows it when `B.failed…` or the live `jobFor(...)` is `failed`. Retry calls
  `article.draft { entryId }` (the entry is back at `approved`, `drafting/jobs.ts:81`) or
  `calendar.generate { settings: B.calendar.settings, keep }`.
- **RL-2 URLs.** `/calendar?view=list&filter=<key>&open=<entryId>` (defaults `calendar`, `all`, none are omitted).
  State is derived from the URL; view and filter use `router.replace`, opening a sheet uses `push`.
  `/article/{id}?back=<encoded path>`: `go('article', id)` still works, `go('article', { id, back })` adds it.
  `route.params` stays the id string; the article screen reads `back` with `useSearchParams` and accepts only
  `^/(calendar|dashboard)(\?|$)`, else `/calendar`.
- **RL-1/RL-3** are client-only: review list = entries with `status === 'review'` sorted by `date` then `id`.
  "Approve and next" runs the existing approve path, then opens the next id, or `/calendar?view=list&filter=review`
  with a toast after the last. A calendar click on a `review` entry calls `go('article', { id, back })`.
- **RL-6** in `ToastHost` (`ui.tsx:97`): tone `bad` has no timer, gets a close button and renders in a
  `role="alert"` region; the rest stay in `role="status"` with 4200 ms.

## 5. BE: billing edges

- **"Became past due at" must be added.** Stripe's Subscription has no such field (status table, docs.stripe.com
  /billing/subscriptions/overview, read 2026-11-10). `billing_accounts.past_due_at timestamptz NULL`, written only in
  `writeSubscription` (`sync.ts:18`):
  `pastDueAt: s.status !== 'past_due' ? null : a.status === 'past_due' ? a.pastDueAt : a.status === 'active' ? new Date() : null`.
  **PM decision (BE-1):** grace starts only on `active → past_due`. `trialing → past_due` (first charge failed)
  leaves it NULL and locks as today.
  Set on the transition only, so an account already past due at deploy (NULL) stays locked and a later webhook
  cannot hand it a fresh grace. `unpaid` and `canceled` clear it and lock at once.
- **Single predicate:** `accountGrants(a, now = Date.now())` = `comp || GRANTING.includes(status) || inGrace(a, now)`,
  `inGrace = status === 'past_due' && pastDueAt && now < pastDueAt + graceMs()`. Also export `graceEndsAt(a)`.
  It already feeds `ownAccess`, `bizAccess` (job queue `queue.ts:76`, autopilot guard), `accessSummary`
  (`getMe`, `resolveEntry`, `billingState`), `gateBusiness` and lifecycle mail eligibility. No gate changes.
  `GRANTING` checks on provider objects in `restart.ts` stay as they are. Start and restart answer
  `already_active` during grace; the owner pays through the portal.
- **Constant and override:** `PAST_DUE_GRACE_HOURS = 48` in `src/lib/billing.ts`; env `RADAR_PAST_DUE_GRACE_HOURS`
  read at call time (same style as `flags.ts`). `0` restores today's immediate lock.
- **Stub:** `POST /api/billing/dev/simulate { status: 'past_due' }` already runs the webhook path and so sets
  `past_due_at`. Add optional `pastDueHoursAgo?: number` to that body (stub only) to backdate it for expiry tests.
- **Client data, one source for banner and chip:**
  `Workspace.billing?: { payer: boolean; graceEndsAt?: string; trialEndsAt?: string }` from
  `billingNoticeOf(biz, userId)` (`billing/notice.ts`): undefined when billing is not enforced for the owner or the
  owner is comp; `payer = biz.ownerId === userId`; `graceEndsAt` during grace (all members); `trialEndsAt` only for
  the payer while `trialing`. It is in the workspace, not `Me`, because members need the owner's state and `Me` only
  refreshes on a full load. Also add optional `BillingOverview.graceEndsAt?: string | null` for Settings → Billing.
- **Rendering (mount points placed by F0):** `<GraceBanner />` above `<main>` in `AppShell`, on every screen: message
  plus date; for the payer the existing `PortalButton` labelled "Update card". `<TrialChip />` in `Side` above
  `UserMenu`: "Trial · N days left" → `go('settings', { section: 'billing' })`. Settings → Billing states the amount
  and date from the existing overview (`priceCents`, `trialEnd`; copy in `overviewCopy.ts:8`).
- **BE-4:** `SignedInFooter({ email })` (new, `features/billing/`) on `TrialPage` and `OnboardingStage`. Sign out =
  `POST /api/auth/signout` then `window.location.assign('/')`. Help = the existing
  `mailto:support@thally.io` link (`PasswordRecovery.tsx:84`); the in-app widget needs a business and the app
  shell. `TrialPageProps.email` and `OnboardingStageProps.user.email` are filled by the guards.
- Not confirmed: that Stripe retries the open invoice by itself when the card is updated in the portal. The portal
  does let customers pay invoices (docs.stripe.com/customer-management). Banner copy should say "update your card",
  not promise an automatic retry.

## 6. Schema and migration (owner: PM in F0; nobody else edits `schema.ts` or `drizzle/*`)

`drizzle/0017_first_five.sql` (generate with `npm run db:generate -- --name first_five`, commit the snapshot and
journal entry):
```sql
ALTER TABLE "businesses" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "brief_days" ADD COLUMN "acted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "activity_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "past_due_at" timestamp with time zone;
```
Backfill: `ADD COLUMN … DEFAULT now() NOT NULL` gives every existing row the migration time (non-volatile default,
no table rewrite), so every business starts "active now" (IS-1) and no member starts with unread items.
`acted_at` and `past_due_at` are deliberately NULL: no rescan until someone acts, no retroactive grace.
`schema.ts`: `lastActiveAt` (`.notNull().defaultNow()`), `actedAt`, `activitySeenAt` (`.notNull().defaultNow()`),
`pastDueAt`. All additive: old web and worker code run unchanged against the new schema.

## 7. Ownership

### 7.1 OPT-F0 contents (PM). Typecheck clean, behaviour unchanged.
1. Migration, snapshot, journal, `schema.ts` (§6).
2. `types.ts`: `ArticleSummary`; `ActResponse.rev`; `FirstRunKey`, `FirstRunItem`,
   `Workspace.firstRun`, `OnboardingState.firstRun`; `FailedJob`, `Workspace.failed`; `counts.activityUnread`;
   `ActivityItem`; `Workspace.billing`; `BillingOverview.graceEndsAt?`; `TrialPageProps.email?`;
   `OnboardingStageProps.user: { name: string; email?: string } | null`.
   F0 adds `ArticleSummary` but leaves `Workspace.articles: Record<string, Article>`. Retyping that one line to
   `Record<string, ArticleSummary>` is E2's only permitted edit to `types.ts` (it breaks the three readers E2 owns).
3. Stub files with final signatures and inert bodies:

| File | Exports (stub result) | Filled by |
|---|---|---|
| `src/server/idle.ts` | constants, `activityTier` (`'active'`), `cadenceDue` (`true`), `lastRuns` (empty), `touchActive` (no-op) | E1 |
| `src/server/actions/presence.ts` | `actions = { 'app.seen': read no-op }` | E1 |
| `src/client/seen.ts` | `useSeenPing(bid, pathname)` (no-op) | E1 |
| `src/server/services/firstRun.ts` | `startFirstRun(bid)` (no-op), `firstRunOf(biz)` (`undefined`) | E3 |
| `src/server/actions/firstRun.ts` | `actions = {}` | E3 |
| `src/server/billing/notice.ts` | `billingNoticeOf(biz, userId)` (`undefined`) | E3 |
| `src/features/billing/GraceBanner.tsx`, `TrialChip.tsx`, `src/features/dashboard/FirstWeek.tsx` | components returning `null` | E3 |
| `src/server/services/activity.ts` | `activityUnread(bid, userId)` (`0`), `failedJobsOf(bid)` (`{ calendar: null, drafts: {} }`) | E4 |
| `src/server/actions/activity.ts` | `actions = {}` | E4 |
| `src/features/shell/ActivityBell.tsx` | component returning `null` | E4 |

4. One-line call sites:
   - `actions/index.ts`: import and spread `presence`, `firstRun`, `activity`.
   - `act/route.ts`: `await touchActive(biz, actor);` after the `trackSoon` lines (non-read path only).
   - `client/app.tsx`: `useSeenPing(bid, pathname);` in `AppProvider`.
   - `workspace.ts` `loadWorkspace`: add `firstRunOf(b)`, `billingNoticeOf(b, userId)`, `activityUnread(bid, userId)`,
     `failedJobsOf(bid)` to the `Promise.all`; return `firstRun`, `billing`, `failed`, `counts.activityUnread`.
   - `AppShell.tsx`: `<GraceBanner />` before `<main>`; `<TrialChip />` before `<UserMenu />`; `<ActivityBell />` in
     the `Side` header row and in `.mob-bar`.
   - `Dashboard.tsx`: `if (B.firstRun) return <FirstWeek />;` after `if (!B) return null;`.

### 7.2 Tasks

| Task | Owns (may edit) | Must not touch |
|---|---|---|
| **E1** idle spend | `src/server/idle.ts`, `actions/presence.ts`, `client/seen.ts`, `app/email/open/route.ts`, `app/email/learn/route.ts`, `services/brief/{jobs,rescan,scan,store}.ts`, `features/brief/model.ts` (result type only), `actions/brief.ts`, `actions/socialPublish.ts` (two `markActed` lines), `services/visibility/{jobs,collect}.ts`, `services/social/auto.ts`, `features/performance/Performance.tsx` | every hot file, `billing/*`, `drafting/*`, `calendar/*`, `features/article/*`, `components/ui.tsx` |
| **E2** lighter saves | `client/{app.tsx,api.ts,articles.ts}`, `app/api/b/[bid]/act/route.ts`, `app/api/b/[bid]/workspace/route.ts`, `server/workspace.ts`, `actions/article.ts`, `features/article/*`, `ContentCalendar.tsx` (line 201 only), `SocialFlow.tsx` (line 57 only), new `features/article/article-load.css` | F0 lines in `app.tsx`, `act/route.ts`, `workspace.ts` must survive; `types.ts` only for the one `articles` line (§7.1); no `schema.ts`, `AppShell`, `Dashboard`, `ui.tsx`, `radar.css` |
| **E3** billing + first session | `server/billing/{access,sync,draft,guard,state,overview,notice}.ts` (+ `stub.ts` if needed), `lib/billing.ts`, `app/api/billing/dev/simulate/route.ts`, `services/firstRun.ts`, `actions/firstRun.ts`, `features/billing/*`, `features/onboarding/OnboardingStage.tsx`, `features/dashboard/FirstWeek.tsx`, new `features/billing/edges.css`, `features/dashboard/first-week.css` | every hot file, `src/server/access.ts`, `jobs/queue.ts`, `services/{brief,calendar,visibility}/*` (import `enqueueScan`, `calendarSettingsOf`, `enqueue` only) |
| **E4** review + activity (after E2 merges) | `components/ui.tsx` (toasts), `app/radar.css`, `features/shell/ActivityBell.tsx`, `services/activity.ts`, `actions/activity.ts`, `jobs/maintenance.ts`, the two `notify` lines in `drafting/jobs.ts` and `calendar/jobs.ts`, `ContentCalendar.tsx`, `ArticleWorkspace.tsx`, `client/app.tsx` (`routeToUrl`, toast listener) | `schema.ts`, `types.ts`, `AppShell`, `Dashboard`, `workspace.ts`, `act/route.ts`, `billing/*`, `idle.ts` |

Seams: E1–E3 add CSS only in their own files, imported by their component (existing pattern,
`SupportWidget.tsx:7`). `docs/CONTRACTS.md` is updated by the PM at integration from §1–§5.

## 8. Risks, rollout, tests

Behaviour that changes at deploy for existing customers:
- Background rescans stop for everyone until an item is copied, posted, skipped or scheduled (IS-7, intended).
- All businesses start `active`; the first idle downgrades happen 7 days after deploy.
- Accounts already `past_due` stay locked. New failures get 48 h. A first charge that fails at the end of a trial also
  gets 48 h (question 1).
- Error toasts stay until closed. Activity starts with the last day of notifications and zero unread.
- Only businesses committed after deploy get the first-week run.
- A new business may run AI visibility twice in its first 24 h (first run, then the 02:00 run). Accepted.

Order: the migration is additive, so run it first (web `preDeployCommand`, `railway.web.json:5`), then web, then
worker. A worker deployed before the migration logs cron errors each minute until it lands, then recovers.
Rollback is a code rollback; columns stay. `RADAR_PAST_DUE_GRACE_HOURS=0` turns grace off without a deploy.

Open tabs on the old client: no header → today's responses on `GET /workspace` and `POST /act`; `reply` is never
sent. Remove the legacy branch one release later. New client against an old web instance during the switch:
`article.get` is unknown, so the article screen shows its error state with Retry until the new instance serves it.

Other risks: (a) `app.seen` and `activity.seen` are declared `read: true` though they write per-user state; `read`
here means "does not change the shared workspace". (b) If Stripe's failed-payment settings cancel or mark `unpaid`
before 48 h, grace ends early; check the Dashboard setting. (c) Out of scope but worth a ticket: each open tab
rebuilds and discards a full workspace every 4 minutes as its SSE reconnect probe (`app.tsx:101`).

Tests each task adds (behaviours):
- **E1:** tier at 6/7/29/30 days, autopilot on, committed 6 days ago · `touchActive` writes at most once an hour,
  never for a guest, and a workspace GET, read action or SSE poll leaves the column alone · idle business gets one
  visibility run and one social pack in 7 days, dormant gets none, and returning yields one run per kind ·
  `rescanDue` with no action, action before the last scan, action after it, Keep as last scan · each counted and
  uncounted action sets or leaves `acted_at` · background scan with no slots makes no source or model call; manual
  and morning scans do · precheck property: for random texts and name lists drawn from the text, `!canMatch` implies
  today's matcher says not mentioned, including a non-Latin name · skipped extraction stores the same row · one
  revision bump per visibility run.
- **E2:** rev-only reply shape and size (< 1 KB for `article.save`) and no workspace build · v2 workspace has no
  body, legacy request still has it · `article.get` role and tenant checks · typing during an in-flight reload is not
  overwritten · a teammate's save reaches an idle open article and not a dirty one, then arrives after the save ·
  rev gap after a rev-only reply triggers a refresh · draft streaming and body-image completion still land ·
  every `articles` writer advances `v`.
- **E3:** `accountGrants` at 47 h and 49 h, env override, `0` · already-past-due row gets no grace on a later sync ·
  `past_due → active → past_due` starts a new grace · job queue runs during grace and skips after · banner for
  payer and member, chip hidden for comp, billing off, non-payer · sign-out lands on `/` · each of the four commit
  paths starts the three jobs once; a second commit starts none; a business committed before the marker gets none ·
  one failing enqueue leaves the other two and the commit intact · brief `result.failed` shows as a failed row ·
  retry replaces the tracked job · `firstRun` disappears when all are done.
- **E4:** unread count per member, `activity.seen` does not bump `rev`, list is tenant-scoped and paginated, rows
  survive 29 days · draft and calendar failures name the item in Activity and in `B.failed`, and clear after a
  successful retry · pager order and "Approve and next" on the last item · calendar URL round-trip and `back`
  validation · error toast stays, closes, and is announced as an alert.

## 9. Proposed acceptance-criteria wording

- **IS-1:** "used the signed-in app" = opened or navigated the app, or made a change, as a signed-in member.
  Background refreshes of an open tab do not count.
- **IS-3:** add "AI visibility: one catch-up run on return if the last run is over 24 h old; the nightly cadence
  resumes at the next 02:00 window."
- **IS-6:** add "the AI Visibility grid still fills in while a run is in progress."
- **FS-1:** "Exactly once" → "started automatically at most once per business; if starting fails, the Dashboard
  shows the affected rows as failed with Retry."
- **FS-3:** add "A failed row stays until it is retried successfully, dismissed, or 7 days pass."
- **RL-4:** "items can be marked read" → "the list is marked read per member, all at once (opening it, or Mark all
  read)."
- **BE-1:** add "Accounts already past due when this ships get no retroactive grace."
- **BE-4:** "Signed in as … · Sign out" applies to signed-in users; a guest on `/start` sees only "Need help?".
  Help is the support email link.

## 10. Questions for the product owner

1. Should a card that fails on the **first charge after the trial** also get the 2 days (effectively a 5-day trial)?
   As written, yes; say so if grace should require one paid invoice.
2. Is per-member "mark all read" enough for Activity, or is per-item read state required (adds a table)?
3. Is one immediate AI visibility run when an idle or dormant owner returns acceptable, or should it wait for the
   night run?

## 11. PM resolutions (2026-11-10)
- Section 9 wording accepted into brief.md.
- Q1: no grace for a first charge that fails after the trial (see section 5). Q2: per-member mark-all-read is enough.
  Q3: one immediate AI visibility catch-up run on return is accepted.
- OPT-F0 is delegated to an engineer under the PM, not written by the PM directly; ownership rules are unchanged.
