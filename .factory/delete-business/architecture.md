# Delete a business: architecture (T1)

Base `main` `ead40f9b`, branch `kenny-dev/radar-delete-business-36eee1`. Design only. `file:line` references are to that
revision. "Not confirmed" marks what I could not verify in code or primary documentation. Section numbers follow the
PM's list. §12 records the decisions the PM and the owner took on 2026-11-16 (also in `brief.md`, "Decided after the
architecture") and the two points that are still open.

## 0. Shape of the work

- One status value, two columns, one check constraint, one partial index. No new table, queue or dependency.
- Two layers keep a deleted business quiet:
  1. **Choke points** (must hold, fail closed): `requireRole` and `gateBusiness` for every web entry, the job queue for
     every job, `ai.run` for every model call, and a last check before each external publish or post.
  2. **Hygiene**: the few crons that pick work from child tables without a status filter get one.
  A cron missed in layer 2 can only enqueue a job, and the queue refuses it. No cron publishes, posts or mails inline
  for a business except through the paths in §2.4.
- Delete and restore are two small routes over one server module. The wipe is a job started by an hourly cron.
- F0: the server engineer lands the shared contract first (§11). UI work starts after it.

Findings that change the brief's assumptions (each is used below):
1. **Published articles hot-link images from Radar's storage.** Body images go out as `<img src>` on the bucket's public
   URL (`publishing/render.ts:54`, `publisher.ts:71-76`); Notion and the webhook connector also link the cover
   (`connectors/notion.ts:51,161`, `webhook.ts:20`). Wiping the whole prefix would break those images on the owner's
   live site. Decided by the owner (§12 A): the wipe keeps exactly those files and removes the rest (§4.5).
2. **Google's revoke call is not per token.** It removes the whole grant: "invalidating any issued access or refresh
   tokens for all clients registered under that project" (Google, OAuth 2.0 for Web Server Apps, Token revocation).
   Revoking at the wipe would break Search Console for any other business connected with the same Google account (§4.6, §12 B).
3. **Blog connectors have no revoke call.** `blog.disconnect` only deletes the row (`actions/publishing.ts:183-191`).
   Search Console (`gsc/client.ts:90`) and social accounts (`x.ts:69`, `linkedin.ts:103`, used at `actions/socialPublish.ts:123`) do.
4. **A stale tab has no way out today.** A 404 from the workspace is ignored (`client/app.tsx:113`), and a dead event
   stream is retried every 3 s forever (`app.tsx:136-142`). DEL-4 needs a new error code and client handling (§3.7).
5. **The no-business screen is `/onboarding`**, not `GhostDash`: the `(app)` layout redirects before the shell renders
   (`app/(app)/layout.tsx:15-16`); `GhostDash` is only the inert backdrop of `OnboardingStage`.
6. `social.send` is exempt from the queue's access check (`queue.ts:69,73`), and that check does no read when billing
   is off (`queue.ts:74`). The deleted check must be separate and unconditional.
7. Nothing assumes one business per domain (§8). Queued work reminders for a business that is not active are already
   resolved for good by the collector (`lifecycle/engagement.ts:143`), so nothing extra is needed for them at restore.

## 1. Data model

| Decision | Reason |
|---|---|
| **`businesses.status` gains `'deleted'`**, plus `deleted_at` and `purge_at` (timestamptz, null unless deleted). | About 43 server sites filter on `status = 'active'` and every "is this the owner's draft" site filters on `'onboarding'`; all of them exclude a deleted business with no edit. With timestamps only, none would, and a rollback of the code would bring every deleted business back to life. With the status, a rollback leaves them dormant. |
| No "prior status" column. | Only an active business can be deleted (DEL-8), so restore always returns to `'active'`. |
| Timestamps are written by Postgres: `deleted_at = now()`, `purge_at = now() + interval '168 hours'`. | DEL-3 is exactly 7 × 24 h; `'7 days'` on timestamptz follows the session time zone across a clock change. One clock (the database's) decides delete, restore and wipe. |
| Check constraint `businesses_deleted_check`. | PUR-4 becomes structural: a row cannot be marked deleted without both timestamps, cannot keep a wipe time while active, and cannot be given a wipe time less than 168 h after its delete, even by a bug or a hand edit. |
| Partial index `businesses_purge_idx (purge_at) WHERE status = 'deleted'`. | The wipe's selector and `listDeleted` read only the handful of deleted rows. |

Schema (`src/server/db/schema.ts:41-68`): `status: text('status').$type<'onboarding' | 'active' | 'deleted'>()`,
`deletedAt`, `purgeAt`, and in the table's third argument the check and the index. Generate with `npm run db:generate`,
name it `drizzle/0019_delete_business.sql`, and confirm it equals:

```sql
ALTER TABLE "businesses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_deleted_check" CHECK (
  ("status" = 'deleted') = ("deleted_at" IS NOT NULL)
  AND ("deleted_at" IS NULL) = ("purge_at" IS NULL)
  AND ("purge_at" IS NULL OR "purge_at" >= "deleted_at" + interval '168 hours'));--> statement-breakpoint
CREATE INDEX "businesses_purge_idx" ON "businesses" USING btree ("purge_at") WHERE status = 'deleted';
```

Widening the status type makes `tsc` fail where a row's status is assigned to a client type (`auth/users.ts:25`, the
workspace builder, `testing/fixtures.ts:28`). Fix by narrowing after the filter. **Do not widen** `BusinessSummary.status`
or `Workspace.status` (`lib/types.ts:300,345`): a deleted business never reaches the client in those shapes.
Add `b.purge_at` to the worker's schema probe (`db/workerReady.ts:15-21`) so a worker never runs ahead of the migration.

## 2. Reader audit

"Auto" = already excludes or is harmless for `status = 'deleted'` with no edit. **Change** rows are the complete list of
edits (repeated in the report). Every `schema.businesses` reference under `src` was read; raw SQL was searched for
`FROM/JOIN businesses`.

### 2.1 Web entry points

| Reader | Today for a deleted business | Change |
|---|---|---|
| `access.ts:32-38` `requireRole` (workspace, act, events, media, support, `b/current`, oauth start, `email/open`, `email/learn`, `social/publish/oauth.ts:48`) | passes: it reads `members` only | **Change.** Join `businesses`; a member of a deleted business gets `businessDeleted()` = 404, code `business_deleted` (§9). This one edit covers every route under `/api/b/[bid]` (DEL-4). |
| `access.ts:48-60` `gateBusiness` | the `else` branch treats anything that is not a draft as active | **Change.** `status === 'deleted'` → `businessDeleted()` before the branches. Defense for any caller that skips `requireRole`. |
| `auth/users.ts:21-26` `listBusinesses` | returns it (no status filter) | **Change.** `ne(status, 'deleted')`. `me.businesses` and the switcher never see it. |
| `auth/users.ts:30-39` `getMe` | cookie pointing at it falls back to `usable[0]` (line 37) | **Change.** Add `deleted: await listDeleted(user.id)`. |
| `billing/access.ts:88-121` `accessSummary` | auto: `active`, `accessible`, `ownsActive` and `draft` are all status-filtered (lines 99, 112, 116-117) | none |
| `billing/access.ts:47-57` `lazyGrandfather` | auto (`status = 'active'`). Edge: an owner whose only pre-cutoff business is deleted is not grandfathered until restore; the comp row is normally written long before. | none |
| `billing/guard.ts:22-33` `resolveEntry` | auto: goes to `/onboarding` (§5) | none |
| `billing/guard.ts:110-124` `entryAfterAuth` | drops `next=/restore` when the user has no business | **Change.** Allow `/restore` exactly like `/email-preferences` (line 112). |
| `billing/guard.ts:65-71` `onboardingGuard` | n/a | **Change.** Add `deleted` to the props (§5). |
| `app/api/b/current/route.ts:27-35` GET hop (links in mail already sent) | would answer raw JSON 404 | **Change.** On `business_deleted` redirect 303 to `/dashboard`. |
| `app/api/b/[bid]/events/route.ts:22-37` + `events/workspace.ts:9` | stream keeps running up to 60 s | **Change.** Select `status` with `rev`; `break` when deleted. |
| `app/api/b/[bid]/support/route.ts:16-18` | gated by `requireRole` only | none (covered by the first row) |
| `app/api/b/[bid]/media/route.ts` | gated | none |
| `app/api/files/[...key]/route.ts` (public, local disk only) | still serves the file | none. Decision A: public file URLs are left alone for the 7 days, and files of published articles stay after the wipe. |
| `app/api/oauth/[provider]/callback/route.ts:14-23` | a flow started before the delete could still save tokens | none in the route: the delete transaction removes the business's `oauth_states`, so the callback answers `invalid_state`. |
| `services/team/invites.ts:44-50` `findInvite` | finds the invite | **Change.** `ne(businesses.status, 'deleted')` → `invalid` (DEL-8). |
| `services/visibility/digestPreferences.ts:43-48` `managedDigestPreferences` (account email settings) | lists its domain | **Change.** Exclude deleted. Line 49 `updateDigestPreference`: return `false` when deleted. Line 29 `disableDigestEmail` (one-click unsubscribe): leave, it must never fail. |
| `app/api/b/route.ts:29-45`, `billing/draft.ts:26-50`, `auth/claim.ts:32-36`, `auth/signupEmails.ts:10-13`, `actions/onboarding.ts:19,23` | auto: all `status = 'onboarding'` | none |
| `billing/confirm.ts:39-45` `businessToOpen` | auto (`active`) | none |
| `src/server/actions/*` (writes by `ctx.bid`), `workspace.ts:23-33` `getBiz`/`bump`, `loadWorkspace` | reachable only through the gate | none (see 2.5 for one filter in `loadWorkspace`) |
| `idle.ts:99-110` `touchActive` | auto: enqueues only when the row is active (line 105) | none |
| `events-backfill.ts:19`, `metrics.ts` (events only), `api/admin/metrics`, `api/health`, public pages, sitemap, robots, `lib/seo.ts` | no business read, or `active` only | none |

### 2.2 Queue, AI, and jobs that act on a business id

| Reader | Today | Change |
|---|---|---|
| `jobs/queue.ts:72-89` `lapsed` / `executeInContext` | a claimed job runs: `lapsed` only looks at active businesses, skips `social.send`, and reads nothing when billing is off | **Change.** New unconditional check before `lapsed`: `job.businessId` set and the business deleted → `status 'done'`, `result { skipped: 'deleted' }`, no run. If the check itself throws, the attempt fails and is retried; the job never runs unchecked. |
| `jobs/queue.ts:92-96` `ctx.progress` | n/a | **Change.** At most every 5 s the progress call re-reads the status and throws `businessDeleted()`, so a running job that reports progress (drafting, calendar, brief scan, visibility, analysis, keywords, social packs, Search Console backfill) stops at its next step (DEL-5). Jobs that report none (`backlinks.verify`, `gsc.incremental`) run to their end; they publish and send nothing to the outside for the business. |
| `jobs/queue.ts:106-119` failure path | would record `failed` and alert an operator | **Change.** If the business is deleted when a job throws, record `done` + `{ skipped: 'deleted' }`, drop held alerts, no `reportFailure`. |
| `ai/index.ts:64-68` `aiSettingsFor` (first read of every `ai.run`) | reads `ai` only | **Change.** Select `status` in the same query; deleted → throw `businessDeleted()` before any provider call. No extra query. |
| Jobs by id: `analysis.*`, `calendar.generate`, `article.draft`, `article.bodyImages`, `keywords.*`, `suggestions.generate`, `gsc.backfill`, `gsc.incremental`, `brief.scan`, `brief.visuals`, `visibility.run`, `visibility.collect`, `social.generate`, `social.autoRun`, `backlinks.match`, `backlinks.verify`, `autopilot.run`, `autopilot.handoff`, `publish.entry`, `social.send` | each starts through the queue | none beyond the three rows above. `autopilot.handoff` mails the owner from inside a job (`autopilot/handoff.ts:44-52`): it is refused at the queue and by `canRun` → `authorized` (`autopilot/policy.ts:17`, active only). |
| `services/firstRun.ts:47-50` `startFirstRun` | auto (`status !== 'active'` → return) | none |

### 2.3 Crons

| Cron | Today | Change |
|---|---|---|
| `publishing.scheduler` `publishing/jobs.ts:34-54` | auto (join on `status = 'active'`, line 38) | none; export the `due` rule on line 49 for §3.5 |
| `drafting.due` `drafting/jobs.ts:150-151` | auto | none |
| `social.publisher` `social/publish/jobs.ts:36-53` | auto (line 41) | none |
| **`social.tokens`** `social/publish/accounts.ts:137-159` | refreshes tokens and writes "access ends" notices: the join on line 138 has no status filter | **Change.** `eq(businesses.status, 'active')`. Safe for restore: refresh tokens outlive 7 days and `ensureToken` refreshes on demand. |
| `social.auto` `social/auto.ts:32-34` | auto | none |
| **`gsc.daily`** `gsc/jobs.ts:20-27` | writes a day mark and enqueues `gsc.incremental`: join without status | **Change.** `ne(businesses.status, 'deleted')` (drafts keep syncing as today). |
| **`keywords.afterGscSync`** `keywords/jobs.ts:55-59` | reads `gsc_connections` only and enqueues `keywords.suggest` | **Change.** Join `businesses`, exclude deleted. |
| `brief.daily`, `brief.rescan` `brief/jobs.ts:49-51,75-77` | auto | none |
| `visibility.nightly` `visibility/jobs.ts:37-39` | auto | none |
| `visibility.weeklyDigest` `visibility/digest.ts:20-28` | auto (line 27) | none |
| `autopilot` `autopilot/run.ts:171-172` | auto | none |
| `backlinks` `backlinks/jobs.ts:45-63` | auto (`status !== 'active'` → continue, line 54) | none |
| `lifecycle.work-updates` `lifecycle/engagement.ts:127-160` | auto: `activeOwner` (lines 49-58) needs an active business, so its sections drop out and the event is resolved | none |
| `lifecycle.weekly-education`, `lifecycle.guides` | account mail; the context picks an active business, else a draft (`education.ts:37-39`, `guides.ts:61-63`) | none |
| `maintenance`, `onboarding.guestCleanup` | not per business | none |

### 2.4 Paths that publish, post, send or spend

| Path | Guard today | Change / recheck before the side effect (DEL-5) |
|---|---|---|
| Article publish: `publishing/publisher.ts:111-163` | autopilot only (`holdProgram`, lines 152-162) | **Change.** Re-read the business in the two existing hold points, immediately before `connector.createDraft` (159) and `connector.publish` (163). Deleted → put the entry back to `scheduled` (only if it is still `publishing`), return `{ status: 'skipped', reason: 'deleted' }`. |
| Social post: `social/publish/send.ts:175-235` `runSend` | none after the claim | **Change.** The `stage: 'create'` update on line 215 is the last write before `ad.create` (218): add `AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'active')`. No row → return `null`; the pub stays `sending` at stage `media` and restore settles it (§3.5). |
| `social.send` job `social/publish/jobs.ts:20-22` | auto (`status !== 'active'` → skip) | none |
| `claimScheduled` `send.ts:35-41` | status checked only for autopilot rows | none: only reached from the job above |
| Model calls | none | the `ai.run` row in 2.2 |
| Other paid calls inside a running job (keyword data, searches, image models, sandboxes) | none | the `ctx.progress` row in 2.2, at the job's next progress report |
| Lifecycle dispatcher `lifecycle/dispatch.ts:153-275` | each type re-checks at send time | none for existing types (§6); new branch for `business_deleted` |
| Partner mail about another account's action: `backlinks/decisions.ts:28-76` | none | **Change**, see 2.5 |
| Invites, feature requests, support, issue reports | user actions inside an open business | none (gated) |
| In-app `notify()` | not mail | none |

Residual, stated plainly: a request already on the wire when the delete commits completes. The window is the time
between the last check and the provider call (milliseconds for a post; for the sandbox publisher the publish step
itself can run for minutes). The PM accepted this wording of DEL-5 (§12 C).

### 2.5 Backlinks network (other accounts)

| Reader | Today | Change |
|---|---|---|
| `backlinks/network.ts:38-41` `networkBusinesses`, `matching.ts:188-191` `matchBusiness` | auto: active only, so it is never offered in new matching | none |
| `workspace.ts:118,153-154` (another account's Backlinks page) | shows undecided proposals that name it | **Change.** Drop undecided proposals whose `partnerBusinessId` is a deleted business (one `id IN (…) AND status = 'deleted'` read, only when such proposals exist). |
| `backlinks/decisions.ts:28-51` `runDecisionNotice` | mails the deleted business's owner about the partner's decision | **Change.** Partner deleted → `{ skipped: true }`. |
| `backlinks/decisions.ts:54-58` `hostBusiness` (used by removal and lost-link mail) | `rows.find(active) \|\| rows[0]` can pick a deleted row for the domain | **Change.** Ignore deleted rows. |
| `backlinks/verify.ts:18,25-39` `markPlaced` | a partner's check writes a live link into the deleted business | **Change.** `bizRow` returns `null` for a deleted business; its own verify records the link after a restore. |
| `backlinks/verify.ts:85-102` `discoverEditorial` | reads every joined business's crawl, with no status filter at all (line 87) | **Change.** Active partners only. |
| `backlinks/outbound.ts:30-60`, `matching.ts:229-247` `applyAutoApprove` | another account's own approved links and rules | none |

### 2.6 Account-level readers that still see history

`lifecycle/guides.ts:23,32-36` (`autopilotAlreadyEnabled`, `completedWorkflow`) read the owner's businesses without a
status filter to answer "has this account ever done X". They return a boolean, no content leaves, and the wipe makes
them forget. No change.

## 3. Delete and restore

### 3.1 Where they live

`src/server/deletion/state.ts` (constants, `businessDeleted()`, `isBusinessDeleted(bid)`; imports only `db` and
`errors`, so the queue, `ai` and `access` can import it without a cycle) and `src/server/deletion/index.ts`
(`deleteBusiness`, `restoreBusiness`, `listDeleted`). Two routes call them:

- `POST /api/b/[bid]/delete`
- `POST /api/b/restore` (body `{ id }`, next to `/api/b/current`, which has the same shape)

Not actions, although the brief lists actions as the convention: the act route requires an open business, then calls
`touchActive`, bumps the revision and builds the workspace of the business that was just deleted
(`act/route.ts:37-41`), and restore has no open business at all. One module with two thin routes keeps both operations
symmetric and directly testable. Zod, `RadarError` copy and `handle()` are used as everywhere else.

### 3.2 Authorization

- Delete: `assertAuthOrigin(req)` (as the support route does), `requireUser()` (never a guest),
  `requireRole(bid, user.id, 'Owner')`, `gateBusiness` (a locked business answers 402: the brief sends that case to
  support), then inside the transaction `biz.ownerId === user.id`.
- Restore: `assertAuthOrigin`, `requireUser()`. It must **not** call `requireRole` (which now refuses a deleted
  business). The check is inside the transaction: the row's `owner_id` is the user and the user has an active `Owner`
  member row. Anyone else gets the same 404 as "no such business".

### 3.3 Delete (one transaction)

1. `SELECT … FROM businesses WHERE id = $bid FOR UPDATE`.
2. Missing or not the owner → 404 / 403. `deleted` → return the stored timestamps (two clicks at once are harmless,
   DEL-8). `onboarding` → 409 `not_active`.
3. `domainMatches(input.domain, biz.domain)` (trim + lower case, nothing else) else 400 `domain_mismatch`.
4. `UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() + interval '168 hours', rev = rev + 1, updated_at = now() WHERE id = $bid AND status = 'active' RETURNING …`.
5. `UPDATE jobs SET status = 'done', result = '{"skipped":"deleted"}', finished_at = now(), locked_at = NULL WHERE business_id = $bid AND status = 'queued'`. Running jobs are left to the checks in §2.2 and §2.4.
6. `DELETE FROM oauth_states WHERE business_id = $bid`.

After commit, each step in its own try/catch (none can fail the delete): queue the email (§6), `track`, pick
`nextId` (the first business `getMe` would call usable) and `setCurrentBusiness(nextId)` when there is one.

A later repeat of the request meets `requireRole` first and gets 404 `business_deleted`; the client treats that as
"already gone" (§3.7).

### 3.4 Restore (one transaction)

1. `SELECT … FOR UPDATE`. Missing, or not the owner → 404 `restore_not_found`.
2. `active` → return success (two clicks, RES-4). `onboarding` → 404.
3. `deleted` and `purge_at <= now()` (database clock) → 410 `restore_expired`. Time decides, not the job (RES-3).
4. Settle what came due while it was deleted (§3.5), cancel any job still queued (same statement as delete step 5).
5. `UPDATE businesses SET status = 'active', deleted_at = NULL, purge_at = NULL, rev = rev + 1, updated_at = now() WHERE id = $bid AND status = 'deleted' AND purge_at > now()`; zero rows → 410.

After commit: `setCurrentBusiness(bid)` when the gate would open it, `track`. Restore does not require a subscription:
a lapsed owner gets the business back, still locked, and lands on `/start-trial` as today (`guard.ts:31`).

### 3.5 Nothing fires late (RES-2)

Queued jobs were cancelled at delete, so there is no backlog. Rows whose time passed are moved, inside the restore
transaction, to states the product already has. "Overdue" for an entry is the scheduler's own rule
(`publishing/jobs.ts:49`): `date < today`, or `date = today` and the local time is at or past `blog.time`, in the
business time zone.

| Row | Condition | Becomes | Same as |
|---|---|---|---|
| `calendar_entries` `scheduled` | overdue | `review`, `autopilot_activation_id = NULL` | Unschedule (`actions/article.ts:296`), Autopilot off (`autopilot/control.ts:25`) |
| `calendar_entries` `publishing` | any (no job owns it any more) | `review` | `holdProgram` (`publisher.ts:154`); a remote draft in `publish_remote` is reused on the next approval |
| `calendar_entries` `drafting` | any | `approved` | the draft job's own give-back (`drafting/jobs.ts:82`) |
| `calendar_entries` `approved` with no generated article (after the row above) | overdue | `proposed`, `autopilot_activation_id = NULL` | Unapprove (`actions/calendar.ts:57`). Without this an auto-publishing blog would draft it and publish it late. |
| `social_pubs` `scheduled` | `due_at <= now()` | `failed`, `err_code = 'stale'`, `err = errCopy('stale', platform)`, `retry_at = NULL` | `failStale` (`send.ts:254-264`): "It couldn’t go out on time, so Radar held it back." with Try again |
| `social_pubs` `sending`, `stage` not `create` | any | same `failed` / `stale` | it never reached the platform |
| `social_pubs` `sending`, `stage = 'create'` | leave | the publisher verifies or fails it and never resends (`send.ts:239-251`) | existing stuck-send recovery |

Everything dated in the future is untouched and runs on time. What resumes on the next ticks is the current day's
normal work only: the brief at its hour, one visibility run if a week has passed, today's social draft if its hour has
passed ("never backfill an outage's earlier days", `social/auto.ts:22`), Search Console catching up its missing days.
Work reminders that came due meanwhile are already resolved (`engagement.ts:143`); a queued weekly AI report was
suppressed at its send time (§6).

### 3.6 Cookie

`radar_biz` may keep pointing at the deleted id; `getMe` ignores an id that is not usable (`users.ts:36-37`). Delete
sets it to `nextId`; restore sets it to the restored id. No other cookie change.

### 3.7 Moving every open tab out (DEL-4)

Server: the delete bumps `rev` in the same statement, so every open stream sends `rev` within its 5 s poll, and the
stream itself ends on the deleted status. Every request after that answers 404 `business_deleted`.

Client (`src/client/app.tsx`), one helper `leave()` = set the flash (§9.4), `window.location.assign('/dashboard')`,
guarded so it runs once. The server then opens the member's next business or sends them to `/onboarding`. Call it
when an `ApiError` has status 404 and code `business_deleted` in exactly three places: `refresh()` (line 113), the
probe after a stream error (line 140), and `act()` (line 177, before the error toast). A 404 with any other code keeps
today's behaviour. A member who is typing leaves on the failed save; an idle tab leaves within about 5 s.

## 4. Wipe

### 4.1 Trigger

`defineCron('business.purge')` in `src/server/jobs/purge.ts`, hourly at minute 23, `once('biz-purge:' + hour)`, and it
only **enqueues** `business.purge` (no `businessId`, `singletonKey: 'business.purge'`, `maxAttempts: 1`). The work runs
as a job because cron hooks run one after another under one advisory lock (`jobs/cron.ts:14-18`): deleting a bucket
prefix inside the hook would hold up the social publisher for that minute. The job's timeout does not cancel the
handler (`publishing/jobs.ts:3-4`), so `purgeDue` carries its own budget: it stops starting new businesses after 5 minutes.

### 4.2 Selection and guards (PUR-4, fail closed)

`due` = `status = 'deleted' AND purge_at <= now() AND deleted_at <= now() - interval '168 hours'`, oldest `purge_at`
first, `LIMIT 25`.

1. The check constraint (§1).
2. Two independent time tests in the selector (`purge_at` and `deleted_at`).
3. The same predicate again under the row lock.
4. The `DELETE FROM businesses` statement repeats the predicate and must affect exactly one row, else throw.
5. `deletePrefix` accepts only a UUID and lists only `<uuid>/`; its keep set can only take keys out of that list,
   never add one (§4.5). If the keep set cannot be computed, nothing is deleted and the business is not wiped.
6. `RADAR_PURGE=off` (read in `flags.ts`): the cron and the job do nothing.
7. Breaker: more than 50 businesses due in one run → wipe none, `reportFailure`, result `{ blocked: 'too_many_due' }`.
   A clock jump or a mass mis-dating bug then needs a person, not a timer.
8. Database clock only.

### 4.3 One business (`purgeOne(bid)`), one transaction

`SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '120s'`.

1. `SELECT id, owner_id FROM businesses WHERE id = $1 AND <due predicate> FOR UPDATE SKIP LOCKED`. No row → `'skipped'`
   (restored, already wiped, or another worker or a restore holds it).
2. Read, under the lock and before anything is deleted, what the later steps need:
   - what will be revoked: `gsc_connections.tokens_enc`, every `social_accounts` row (`ch`, `remote_id`, tokens);
   - the keep set: the storage keys of images inside published articles (`publishedImageKeys`, §4.5). It must be
     read here because step 4 deletes the articles it is read from. If it throws, the transaction rolls back and
     the business is not wiped.
3. Rows without a foreign key, and rows in other accounts:
   - `DELETE FROM feature_requests WHERE business_id = $1`
   - `DELETE FROM oauth_states WHERE business_id = $1`
   - `DELETE FROM cron_marks WHERE position($1::text in key) > 0`
   - `UPDATE ai_calls SET business_id = NULL, error = NULL WHERE business_id = $1`
   - `UPDATE events SET props = '{}'::jsonb, ref = NULL, user_id = NULL WHERE business_id = $1`
   - `DELETE FROM proposals WHERE partner_business_id = $1 AND decision IS NULL`
4. `DELETE FROM businesses WHERE id = $1 AND status = 'deleted' AND purge_at <= now()`; `rowCount` must be 1. Cascades:
   members, crawl pages, Search Console connection and rows, calendar entries, articles, connections, social packs,
   brief days, AI prompts/results/observations/miss topics, suggestions, proposals, live links, jobs, notifications,
   lifecycle emails with this `business_id`, engagement events, social accounts and pubs, visibility preferences.
   Set null: `proposals.partner_business_id`, `events.business_id`, `lifecycle_guide_states.source_business_id`.
5. `await deletePrefix(bid, keep)` while the transaction is still open. If it throws, the transaction rolls back and
   the business stays deleted for the next run, which reads the same articles and computes the same keep set. Files
   outside the keep set may be partly gone by then; that is safe because nothing can restore a business past `purge_at`.
6. Commit.
7. After commit, best effort, each in try/catch: revoke tokens (§4.6).

Restore and wipe both take the row lock and both decide on the database clock, so the outcome is one of two: the
restore committed first and the wipe's recheck finds an active row, or the wipe committed first and the restore finds
no row (PUR-3).

No `RESTRICT` key blocks step 4: `education_enrollments.pending_email_id` and `lifecycle_guide_states.pending_email_id`
point at lesson and guide mail, which carries no `business_id` (`lifecycle/queue.ts:36`). A test holds this (§10).

### 4.4 Failure isolation, retry, logging

`purgeDue` loops over the due ids with a try/catch per business. A failure calls `reportFailure(e, { source: 'cron',
operation: 'business.purge', businessId })` (the id of a business that still exists; no name, no domain) and moves on;
the business is picked up again next hour. Result and log carry counts only:
`{ due, wiped, failed, filesDeleted, filesKept }` and `[purge] due 3, wiped 2, failed 1, files deleted 412, kept 37`,
logged for every run that had something due (PUR-5). The job row keeps the same counts for every run; `filesKept`
summed over time is the only measure of how much orphaned storage decision A has left behind.

### 4.5 Storage: what is kept, and `deletePrefix`

Decision A (owner): the wipe removes every stored file of the business **except image files used inside articles
already published to the business's site**. Public file URLs are not touched during the 7 days.

**Which articles count.** An entry counts when `calendar_entries.status = 'published'` or `published_url IS NOT NULL`.
The publisher writes both in one statement and nowhere else (`publishing/publisher.ts:164`); the second term only
covers a row whose status was changed by hand. Nothing else counts: not `scheduled`, `publishing`, `failed`, `review`,
`draft`, `approved`, `drafting` or `proposed`. (§12 K asks whether an entry with a remote draft should count too.)

`published` is terminal, which is what makes this safe to compute: once published, the article and its images are
locked (`drafting/guard.ts:20-21`, `actions/article.ts:45,112,226`, `actions/calendar.ts:19`), and a regenerated
calendar deletes only `proposed` entries (`calendar/jobs.ts:98`). So `articles.data` of a counted entry is what went
live. Images that were replaced before publishing are no longer referenced and are deleted.

**Which fields hold the references** (`lib/types.ts:100-122`):

| Reference | Field | How it reaches the site |
|---|---|---|
| Cover | `articles.data.img.url` (the publisher writes the rendered cover back here before it publishes, `publisher.ts:46-58`) | linked: Notion (`notion.ts:161`), webhook (`webhook.ts:20`), the Next.js publisher (`nextjs-agent.ts:121`, `sandbox/workspace.ts:102`). Passed as a URL the platform fetches: Framer (`framer.ts:81`), Webflow (`webflow.ts:53`), Shopify (`shopify.ts:93`), Wix import (`wix.ts:103`); whether each keeps its own copy is not confirmed. Uploaded as bytes: WordPress, WordPress.com, Ghost. |
| Body images | `articles.data.bodyImages[].url` | `<img src>` in the HTML, an image link in the Markdown, or an external image block, for every connector (`render.ts:54`, `notion.ts:51`, `sandbox/workspace.ts:106`) |

Both are kept for every counted entry whatever the connector: the entry does not record which connection published
it, three platforms' copying is not confirmed, and a kept cover that a platform also copied costs one file.

Not references, so never kept: `img.real.url` (equal to `img.url` while a real picture is the cover, stale otherwise,
`lib/articleImages.ts:61-63`); cached image directions; the logo; crawl data; images of social packs and Daily Brief
posts. Social images are uploaded to X and LinkedIn as media and never linked (`social/publish/send.ts:207-213`), so
no published post depends on Radar's storage. Article blocks are text only (`lib/types.ts:56`).

**From a stored URL to a key**: `keptKey(bid, url): string | null`, next to `storedKey` in `storage.ts`.

1. `storedKey(bid, url)` (`storage.ts:42-50`). It accepts `/api/files/<key>` and `<current public base>/<key>`, drops
   a query or fragment, and returns the key only when its first segment is `bid` and every segment is plain.
2. Otherwise, if the URL parses and one segment of its path equals `bid`: the key is the path from that segment on,
   accepted under the same segment rule (two segments or more, each matching `storedKey`'s pattern). This covers a
   file stored under an earlier public base (`S3_PUBLIC_URL` changed, or local disk moved to a bucket). Whether
   production ever changed its base is not confirmed; without this step such a published image would be deleted.
3. Otherwise `null`, and the reference is **ignored**: an address outside Radar's storage, a file of another
   business, a relative or malformed value. It adds nothing to the keep set. It cannot cause a deletion either,
   because deletion candidates come only from listing `<bid>/`.

Every key `keptKey` returns starts with `bid + '/'` by construction.

**Computing the keep set** (new `src/server/deletion/keep.ts`, pure and unit-tested):

```ts
/** Keys of the images inside published articles. `rows` are read in the wipe transaction, under the row lock. */
export function publishedImageKeys(bid: string, rows: { data: unknown }[]): Set<string>
```

Rows come from one query in §4.3 step 2: `articles.data` joined to `calendar_entries` on `entry_id`, both with
`business_id = $1`, for counted entries. It throws, and the business is not wiped, when a counted row is not what
Radar writes: `data` is not an object, `img` is present and not an object, `bodyImages` is present and not an array,
or one of its elements has no string `url`. An absent or null field, an entry with no article row, and a reference
`keptKey` maps to `null` are all normal and keep nothing. A query error aborts the transaction the same way. A
business stuck here alerts every hour (§4.4) and needs a person; that is the intended outcome when Radar cannot tell
which files a live article needs.

**The helper**, `src/server/services/storage.ts`:

```ts
/** Delete what is stored for one business (`<bid>/…`) except the keys in `keep`. Counts only. Throws on any failure. */
export async function deletePrefix(bid: string, keep: ReadonlySet<string>): Promise<{ deleted: number; kept: number }>
```

- Refuse unless `bid` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. The prefix is
  always `bid + '/'`, so one id can never be the prefix of another's keys. All five writers use `objectKey(bid, …)`
  (`storage.ts:57`; `images.ts:255`, `analysis/brand.ts:116,123`, `social/publish/media.ts:53`, `realCover/index.ts:172`).
- **`keep` only subtracts.** The candidates are the keys returned by listing `bid + '/'` and nothing else; `keep` is
  used in exactly one expression, `candidates.filter(k => !keep.has(k))`. A keep entry that is not under the prefix
  matches no candidate and has no effect, so no value of `keep` can make the helper delete or spare anything outside
  `<bid>/`. With an empty set it deletes the whole prefix.
- `deleted` = objects removed; `kept` = objects that were listed and left in place (a keep entry with no object
  behind it is not counted). No key, name or URL is returned or logged.
- S3: loop `ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })`; per page, `DeleteObjectsCommand` for the keys
  not kept, in batches of at most 1000 with `Quiet: true`; any entry in `Errors` throws. Both commands are in
  `@aws-sdk/client-s3`, already a dependency. Share the client construction with `putObject` (`storage.ts:12-13`).
- Local disk: `root = path.resolve(cwd, env.storageDir)`, `dir = path.join(root, bid)`, require
  `path.dirname(dir) === root`. Walk `dir` without following symbolic links. For each file that is not a `.type`
  sidecar the key is its path relative to `root` with `/` separators: kept → leave the file and its `.type`
  (`storage.ts:19-20`); otherwise unlink both. Sidecars are not counted. Then remove directories left empty, `dir`
  included. `fs.rm(dir, { recursive: true })` is no longer usable.
- Running it again after a partial failure removes what is left and keeps the same files.
- The bucket credentials have only ever needed `PutObject`. **List and delete permission must be confirmed on
  production before the first wipe** (§11.4). Without it the wipe fails closed and alerts every hour.
- Not confirmed: whether the production bucket has versioning (a delete would then leave old versions) and what the
  public URL's CDN keeps. Objects are written `immutable, max-age=31536000` (`storage.ts:14`), so a CDN or browser copy
  can outlive the object.

**After the wipe no record of the kept files remains.** The articles that referenced them are gone with the business,
and no table lists them. They stay in storage under the wiped id's prefix, readable at the same public URLs, and the
only pointers to them are the `<img>` addresses in the owner's own published pages. That is the decision, with these
consequences:

- They are orphaned for good: no expiry, no owner, no later cleanup path in the product. Storage grows with every
  wiped business that had published articles: one cover plus two or three body images per article. `filesKept` in
  the purge result is the only running total.
- The object keys contain the wiped business's id, so "nothing identifies the business" (PUR-2) now reads "nothing
  in the database". The id maps to no row.
- A later request to erase everything, or a takedown request for one image, can only be served by an operator who
  takes the prefix from an image address on the owner's site and deletes it by hand. Nothing in Radar can find it.
- A cover can be a copy of a picture taken from the business's own site (`realCover/index.ts:172`), so kept files
  are not only Radar-generated images.
- Radar keeps serving these files after the account stops paying. Publishing and then deleting gives a few
  permanently hosted images per article; the value to an abuser is low, and the content is what Radar itself rendered
  or copied from the owner's site.
- The privacy page says deleted data goes within 30 days (`privacy/page.tsx:44`). These files are now an exception
  that the page does not state (§12 J).

### 4.6 Tokens

| Service | Revoke call today | At the wipe |
|---|---|---|
| Search Console | `gsc/client.ts:90-97` `revoke` | Call it **only when no other business of the same owner holds Search Console tokens**. Google's call removes the whole grant (finding 2). Otherwise delete the tokens without revoking. Decided, §12 B. |
| X, LinkedIn | adapter `revoke` (`x.ts:69`, `linkedin.ts:103`) | Call it unless another `social_accounts` row has the same `ch` and `remote_id`. X and LinkedIn scope of a revoke: not confirmed, so the same caution applies. |
| Blog connectors | none | Credentials are deleted with the row; nothing is revoked at the platform (a GitHub App installation, a WordPress application password stay until the owner removes them). Leftover, §13. |

Failures are reported (`degraded: true`) and never fail the wipe. A crash between commit and revoke leaves a token
valid at the provider but deleted from Radar; the privacy page promises deletion, not revocation (`privacy/page.tsx:44`).

### 4.7 What is kept after a wipe (PUR-2)

| Kept | Why |
|---|---|
| Image files used inside articles already published to the business's site (cover and body images), in storage under the wiped id's prefix, with no database record | decision A (owner): those posts keep working. Everything else under the prefix is deleted. Consequences in §4.5. |
| The owner's user, sessions, email preferences, `billing_accounts`, `billing_events`, `trial_fingerprints` | account level; billing is per account |
| The owner's other businesses, untouched | DEL-6 |
| One log line with counts, and the `business.purge` job row (14 days) | PUR-5 |
| `events` rows as bare counters: kind and time only (no business, user, ref or props) | the schema's stated intent (`schema.ts:401-402`); aggregate reporting keeps working |
| `ai_calls` rows without the business id or error text | spend totals stay correct |
| Decided proposals and live-link rows **in other accounts** that mention the wiped business's public pages | they are the other account's record of a real link, and what "leave the network" keeps today (`actions/backlinks.ts:55-61`). Their undecided proposals are deleted. |
| Cron marks keyed by an entry id or an account id (`draft-failed:…`, `social.tokens:…`) | opaque ids of rows that no longer exist |
| `outbox_emails` and account-level `lifecycle_emails` already sent that name the business (invites, partner notices, reminders) | they carry no business id, so they cannot be selected safely. Decision D: no retention rule in this change; leftover (§13). |
| Database backups until they rotate | covered by the privacy page ("backup records may be retained") |
| Published articles and posts on the owner's site and accounts | the brief |

Short-lived and self-expiring, not touched: `rate_limits` keys with the id or domain (2 days), operator alert jobs (14 days).

## 5. Zero-business path

- Page: `src/app/restore/page.tsx`, URL `/restore`, outside every route group, built like `/email-preferences`
  (`app/email-preferences/page.tsx`): server component, `currentUser()` or redirect to `/signin?next=%2Frestore`,
  `listDeleted(user.id)`, rendered in `AuthShell`. It never runs `resolveEntry`, because it is not under `(app)`.
  `robots: noindex`. It links back to `/dashboard`, where the layout decides.
- Sign-in keeps the destination through one line in `entryAfterAuth` (`guard.ts:112`).
- The one line: `/onboarding` is the no-business screen. `onboardingGuard` passes `deleted`; `OnboardingStage` shows the
  line in the dialog's footer slot (`OnboardingStage.tsx:28-29`), the only part of that page a keyboard reaches.
  Copy: one business → "You deleted {name}. You can restore it until {date}." + link "Restore"; more → "You have {n}
  deleted businesses you can still restore." + link "Restore a business".
- `resolveEntry` and `accessSummary` need no edit. For an owner whose only business is deleted:

| Subscription | `accessible` | `ownsActive` | Lands on |
|---|---|---|---|
| trialing / active / comp | empty | false | `/onboarding` with the restore line; a saved profile commits at once (`saveCommits`) |
| none or lapsed | empty | false | `/onboarding` with the restore line. After a restore `ownsActive` is true again and they reach `/start-trial`. |

  A deleted business must not count as `ownsActive`: `/start-trial` has no restore link.

## 6. Email (DEL-7)

- **Path: the lifecycle queue**, new type `business_deleted`. Reasons: durable retries from the worker; the body is
  encrypted at rest; the row carries `business_id`, so the wipe removes it by cascade; and a send-time check can cancel
  it. `sendMail` would leave a plaintext copy in `outbox_emails` for good and has no retry.
- When: after the delete commits, `queueLifecycle(db, …)` in try/catch. A failure is reported and the delete stands.
  `eventKey: 'business-deleted:' + bid + ':' + deletedAt`, `businessId: bid`, `expiresAt: min(purgeAt, now + 3 days)`,
  `data: { deletedBusiness: { id, name, domain, deletedAt, purgeAt } }`.
- Send-time check, new branch in `lifecycleEligible` (`dispatch.ts:22-65`): the business still exists, is deleted with
  the same `deleted_at`, `purge_at > now`, and its owner is the recipient. Restored meanwhile → suppressed.
- Template (`lifecycle/templates.ts`, add to `LIFECYCLE_TYPES` line 8 and `LifecycleData`): subject "{name} was deleted
  from Radar". Body: what was deleted (name, domain); "Radar keeps it until {date}, then wipes it for good"; button
  "Restore {name}" → `{appUrl}/restore`; "Your Radar subscription is not affected"; "Posts already published stay where
  they are" (true for their images too, decision A, so the dialog and the email need no sentence about images).
  Transactional: no unsubscribe link, no frequency cap, no quiet hours. The link carries no token and no id.
- Mail already queued for the business needs no new hold. The weekly AI report is the only type stored with a
  `business_id`; `prepareAiReport` → `source()` requires an active business (`digest.ts:14-15,61-62`) and suppresses it.
  A work update is rebuilt at send time and drops the business's section, or is suppressed when it was already frozen
  (`dispatch.ts:33-36,205-207`). Lessons and guides are account mail and pick another business or neutral copy.

## 7. Backlinks network (DEL-6)

| | During the 7 days | After the wipe |
|---|---|---|
| New matching | never offered (`network.ts:40`) | gone |
| Undecided proposals in other accounts | hidden from their workspace (§2.5); rows kept so a restore brings them back | deleted in the wipe transaction, as "leave the network" does |
| Decided proposals in other accounts | unchanged | kept, `partner_business_id` null, the partner's name and page stay as that account's record |
| Live links in other accounts | unchanged; their own weekly check keeps verifying the public page | kept |
| Mail to the deleted business's owner (decision, removal, lost link) | not sent (§2.5). A decision made meanwhile is visible in the app after a restore; the notice is not re-sent. | n/a |
| The deleted business's own proposals and links | hidden with the business, restored with it | deleted by cascade |

## 8. E-2: one business per domain

Nothing assumes it. `businesses.domain` has no unique index (`schema.ts:44`); the only draft rule is one
`onboarding` row per owner (`api/b/route.ts:30`). Domain lookups: `hostBusiness` (`decisions.ts:54-58`, fixed in §2.5
to ignore deleted rows) and the dev stub (`backlinks/stub.ts:45`). Storage keys are per business id, so two businesses
on one domain never share files.

Adding the same domain during the window therefore creates an independent business, and **restore checks nothing
about the domain**. The owner can end up with two active businesses on one domain, each with its own connections and
schedule. That is possible today by adding a domain twice. Decision F: allowed, with no warning and no extra field.

## 9. Contract between server and UI

### 9.1 Shared files (written in F0 by the server engineer, read-only for the UI engineer)

`src/lib/deletion.ts` (new, isomorphic):

```ts
export const DELETE_RETENTION_DAYS = 7;
export const DELETE_RETENTION_HOURS = 168;
/** DEL-2: trimmed and case-insensitive, nothing else (no scheme or www stripping). */
export const domainMatches = (typed: string, domain: string) => typed.trim().toLowerCase() === domain.trim().toLowerCase();
/** sessionStorage key for a toast that must survive a full navigation: JSON `{ msg: string; tone?: 'ok' | 'warn' | 'bad' }`. */
export const FLASH_KEY = 'radar.flash';
```

`src/lib/types.ts`:

```ts
/** A business the signed-in user owns, deleted and still inside its restore window. Owner only. */
export interface DeletedBusiness { id: string; name: string; domain: string; brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>; deletedAt: string; purgeAt: string }
export interface Me { user: User; businesses: BusinessSummary[]; currentId: string | null; deleted: DeletedBusiness[] }
export interface DeleteBusinessResult { id: string; name: string; domain: string; deletedAt: string; purgeAt: string; nextId: string | null }
export interface RestoreBusinessResult { id: string; name: string; /** false: restored but locked (no subscription) */ open: boolean }
// OnboardingStageProps gains:  deleted: DeletedBusiness[]   // [] for a guest and for /start
```

`me.deleted` lists only businesses with `owner_id = me`, `status = 'deleted'`, `purge_at > now()`, newest delete
first. Admins and other members never receive it. F0 also adds `deleted: []` to the synthetic `Me` in
`OnboardingStage.tsx:17` so the type check stays green; after F0 that file belongs to the UI engineer.

### 9.2 Endpoints

| Call | Request | 200 |
|---|---|---|
| `POST /api/b/{bid}/delete` | `{ "domain": string }` | `{ ok: true, data: DeleteBusinessResult }` and `radar_biz` set to `nextId` when there is one |
| `POST /api/b/restore` | `{ "id": string }` | `{ ok: true, data: RestoreBusinessResult }` and `radar_biz` set to the id when `open` |
| `GET /api/me` | | `Me` with `deleted` |
| server only: `listDeleted(userId): Promise<DeletedBusiness[]>` from `@/server/deletion` | | used by `app/restore/page.tsx` |

Errors, all `{ ok: false, error, code }` through `handle()`:

| Call | Status, code | Copy (`error`) | UI |
|---|---|---|---|
| any `/api/b/{bid}/…` | 404 `business_deleted` | "Business wasn’t found." | `leave()` (§3.7); never shown |
| delete | 400 `domain_mismatch` | "That doesn’t match. Type the business’s domain to confirm." | under the field |
| delete | 403 `forbidden` | "You don’t have permission to do that." (existing) | in the dialog |
| delete | 402 `subscription_required` | existing | existing redirect to `/start-trial` |
| delete | 404 `not_found` | "Business wasn’t found." (existing) | in the dialog |
| delete | 409 `not_active` | "Only a business that is set up can be deleted here." | in the dialog |
| delete | 404 `business_deleted` | as above | treat as done: `leave()` |
| restore | 410 `restore_expired` | "This business can’t be restored. Its 7 days have passed." | toast, then drop the row |
| restore | 404 `restore_not_found` | "This business can’t be restored. It may already be wiped." | toast, then drop the row |
| both | 401 `unauthorized`, 403 `forbidden` (cross-site) | existing | existing |

### 9.3 After a successful call (UI)

All three exits are full navigations, so no client state of the old business survives (stream, jobs, pending saves):

- Delete: flash "{name} deleted. You can restore it until {date}." then `location.assign(nextId ? '/dashboard' : '/onboarding')`.
- Restore (Settings and `/restore`): flash "{name} restored." then `location.assign('/dashboard')`. With `open: false`
  the layout sends the owner to `/start-trial`.
- Forced leave of another member: flash "That business was deleted." (no tone) then `location.assign('/dashboard')`.

`{date}` is `purgeAt` in the viewer's locale, date and time. Before the delete the dialog shows now + 7 days.

### 9.4 UI notes that depend on the contract

- Flash: `ToastHost` (`components/ui.tsx:117`, mounted in the root layout, so it works on `/onboarding` and `/restore`)
  reads and removes `sessionStorage[FLASH_KEY]` once on mount and shows it.
- Settings: `SetKey` gains `'delete'`, last in the Workspace group (`SettingsPage.tsx:59-66`). List it when
  `B.role === 'Owner' || me.deleted.length > 0`, filtered the way `social` is on line 74. Inside: the delete row only
  when `B.role === 'Owner'`; "Recently deleted" whenever `me.deleted` is not empty. (An owner who is only an Admin of
  the business they have open must still find their deleted ones in Settings, RES-1.)
- The dialog compares with `domainMatches` from the shared file, so client and server agree on DEL-2.
- The switcher needs no change: `me.businesses` no longer contains the business (`AppShell.tsx:57`).

## 10. Test plan

DB tests use `Fixtures` (`server/testing/fixtures.ts`; add `'deleted'` to `biz()` and a `seedEverything(bid)` helper
that puts at least one row in every table that can carry a business). Names are the behaviour.

`src/server/deletion/delete.db.test.ts`
- an Admin, Editor or Viewer cannot delete; a non-member gets not found (DEL-1)
- delete refuses a wrong domain and accepts the right one with spaces and in any case (DEL-2)
- delete sets `purgeAt` exactly 168 hours after `deletedAt` and bumps the revision (DEL-3)
- the response names the owner's next usable business, or null when none is left (DEL-3, E-1)
- after a delete the business is in nobody's `me.businesses` and only in its owner's `me.deleted` (DEL-4, RES-1)
- after a delete workspace, act, events, media and support answer 404 `business_deleted` for the owner and for a member (DEL-4)
- an open event stream ends after a delete (DEL-4)
- delete cancels queued jobs, and a job enqueued afterwards is recorded as skipped without running, `social.send` included, with billing off (DEL-5)
- `ai.run` refuses a deleted business before any provider call (DEL-5)
- a running job that reports progress after the delete stops and is recorded as skipped, with no failure alert (DEL-5)
- a send already claimed does not create the post once the business is deleted (DEL-5; fake adapter, delete between upload and create)
- a publish already admitted creates no draft and publishes nothing once the business is deleted, and the entry is `scheduled` again (DEL-5)
- no cron enqueues, marks or refreshes anything for a deleted business (DEL-5; table-driven over every hook in `jobs/all.ts`, asserting no new job, cron mark or token write for the id)
- a queued weekly AI report is suppressed at send time and a work update drops the business's section (DEL-5)
- a deleted business is not matched, its undecided proposals are hidden from the partner, and no partner mail goes to its owner (DEL-6)
- the owner's other business and billing row are byte-for-byte unchanged by a delete (DEL-6)
- delete queues exactly one `business_deleted` mail with the wipe date and `/restore`, and succeeds when queueing throws (DEL-7)
- the queued mail is suppressed when the business was restored before it was sent (DEL-7)
- a draft cannot be deleted; a second delete and two deletes at once leave one `deletedAt` (DEL-8)
- an invite link to a deleted business is invalid (DEL-8)

`src/server/deletion/restore.db.test.ts`
- restore brings back the same members and roles, connections, tokens, entries, articles and packs (RES-2; compare a dump taken before the delete)
- restore moves overdue `scheduled` and all `publishing` entries to `review`, `drafting` to `approved`, overdue undrafted `approved` to `proposed`, and leaves future entries alone (RES-2)
- restore fails overdue scheduled posts as `stale`, leaves future ones scheduled, and the next publisher tick sends nothing (RES-2)
- the ticks after a restore enqueue no more jobs than for a business that was never deleted (RES-2)
- an Admin of the business and the owner of another account cannot restore (RES-3)
- **restore is refused once `purgeAt` has passed while the row still exists** (RES-3)
- **restore answers not found after the wipe** (RES-3)
- restoring twice and two restores at once leave one active business (RES-4)
- an owner with no subscription can restore and the business stays locked (§3.4)
- adding the same domain during the window makes a new business and the deleted one still restores (E-2)

`src/server/jobs/purge.db.test.ts`
- **an active business and a draft are never wiped** (PUR-4)
- **a deleted business whose `purgeAt` is in the future is never wiped, by the selector or by `purgeOne` called directly with its id** (PUR-4)
- **the database refuses a deleted row with a `purge_at` less than 168 hours after `deleted_at`, and an active row with timestamps** (PUR-4)
- **a business restored between selection and the lock is not wiped** (PUR-3, PUR-4)
- **while a restore holds the row the wipe skips it and the business survives; while the wipe holds it the restore gets not found** (PUR-3)
- with `RADAR_PURGE=off` nothing is wiped; with more than 50 due nothing is wiped and a failure is reported (PUR-4)
- after a wipe no table contains the business id anywhere (PUR-2: loop over every table in `public` and search each row's text), and `seedEverything` covers every table that has a business column (a table added later fails this test until it is handled)
- the wipe succeeds while the owner has a pending lesson and a pending guide email (PUR-2)
- after a wipe the owner, their billing row and their other business remain; events are bare counters; `ai_calls` keep cost without the id (PUR-2)
- undecided proposals naming the business are gone from other accounts; decided ones and live links remain (PUR-2, DEL-6)
- the wipe removes every file under the business's prefix that no published article uses, and no file of a business whose id starts with the same characters (PUR-2, decision A)
- **the cover and the body images of a published article are still stored and still served at the same URLs after the wipe** (decision A)
- images of a draft, of an article in Review, of a scheduled article and of a failed publish are deleted; so are the logo, social pack images and Daily Brief images (decision A)
- an image that was replaced before the article was published is deleted; the image the published article ended with is kept (decision A)
- a published article whose cover or body image points outside the business's prefix (another business's file, an external address, a malformed value) keeps nothing for that reference, and no file outside the prefix is touched (decision A)
- a published image stored under an earlier public base is still recognised and kept (decision A)
- **when the keep set cannot be computed (a published article whose `bodyImages` is not a list; the read fails) the business is not wiped, no file is deleted, and the next run tries again** (PUR-4)
- after the wipe no table mentions the kept files; the run's result carries `filesDeleted` and `filesKept` as numbers only (PUR-5)
- a wipe that failed after deleting some files keeps the same published images on the next run (PUR-3)
- tokens are revoked after commit, a failed revoke does not fail the wipe, and Google is not revoked when the owner has another connected business (PUR-2)
- one failing business does not stop the next and is wiped on the following run (PUR-3)
- a storage failure leaves the business deleted and unrestorable, with its articles still in the database, and the next run finishes it (PUR-3)
- two runs at once wipe each business once (PUR-3)
- a run logs counts and nothing else: no name, domain or id of a wiped business (PUR-5)

Unit tests: `domainMatches`; `deletePrefix` refuses anything but a UUID, pages through a fake S3 client, throws on
`Errors`, deletes the whole prefix with an empty keep set, **cannot be made to delete or spare a key outside the
prefix by any keep set** (keep entries for another id, `..` paths, the bare prefix), and on local disk keeps a kept
file's `.type` sidecar and removes emptied directories; `keptKey` (local URL, current base, earlier base, query
string, another business's id, external host, traversal segments); `publishedImageKeys` (cover and body images,
missing fields, the shapes that must throw); the entry "overdue" rule shared with the scheduler; the `business_deleted` template (date, link, no token);
`entryAfterAuth` keeps `/restore`; `resolveEntry` for an owner with only a deleted business (E-1); the client's
`leave()` fires on `business_deleted` only and once.

## 11. Work split and rollout

### 11.1 Files

| Server engineer (T2) | UI engineer (T3) |
|---|---|
| `drizzle/0019_delete_business.sql` + `drizzle/meta/*`, `server/db/schema.ts`, `server/db/workerReady.ts` | `client/app.tsx`, `client/api.ts` |
| `lib/types.ts`, `lib/deletion.ts` (new) | `components/ui.tsx` (flash in `ToastHost`) |
| `server/deletion/state.ts`, `server/deletion/index.ts`, `server/deletion/keep.ts` (new) | `features/settings/SettingsPage.tsx`, `features/settings/DeleteBusiness.tsx` (new) |
| `server/jobs/purge.ts` (new), `server/jobs/all.ts`, `server/jobs/queue.ts`, `server/flags.ts` | `features/restore/RestorePage.tsx` (new), `app/restore/page.tsx` (new) |
| `server/access.ts`, `server/auth/users.ts`, `server/billing/guard.ts`, `server/ai/index.ts`, `server/workspace.ts` | `features/onboarding/OnboardingStage.tsx` (after F0) |
| `server/services/storage.ts` | `app/radar.css` or a feature stylesheet |
| `server/services/publishing/publisher.ts`, `publishing/jobs.ts` | UI tests |
| `server/services/social/publish/send.ts`, `social/publish/accounts.ts` | |
| `server/services/gsc/jobs.ts`, `keywords/jobs.ts`, `team/invites.ts`, `visibility/digestPreferences.ts` | |
| `server/services/backlinks/decisions.ts`, `backlinks/verify.ts` | |
| `server/services/lifecycle/templates.ts`, `lifecycle/dispatch.ts` | |
| `server/events/workspace.ts`, `app/api/b/[bid]/events/route.ts`, `app/api/b/current/route.ts` | |
| `app/api/b/[bid]/delete/route.ts`, `app/api/b/restore/route.ts` (new) | |
| `server/testing/fixtures.ts`, all server tests | |
| `ARCHITECTURE.md`, `docs/CONTRACTS.md`, `docs/LAUNCH.md`, `.env.example` (`RADAR_PURGE`) | |

No file appears in both columns. `AppShell.tsx` should need no edit; if it does, it is T3's.

### 11.2 Order

1. **F0 (T2, serial, first):** migration and schema, `lib/types.ts`, `lib/deletion.ts`, `getMe` returning
   `deleted` (real), `onboardingGuard` passing `deleted`, the one-token fix in `OnboardingStage.tsx:17`, and the two
   routes with their final shapes. Type check green. After F0 the shared files are frozen; a contract change goes
   through the PM.
2. In parallel: T2 gates and the reader changes of §2, delete and restore, then the wipe; T3 against the F0 routes.
3. T2's wipe and its tests last: it depends on nothing in the UI and is the part to review hardest.
4. T4 on the integrated revision.

### 11.3 Migration and rollback

- Additive: two nullable columns, a check every existing row satisfies, a small partial index. `ADD CONSTRAINT`
  scans `businesses` under a short exclusive lock; the table is small. Old code ignores the new columns, so the web
  predeploy migration (`railway.web.json`) is safe while old instances still run; the worker waits for the probe.
- During the overlap of a deploy an old instance treats a deleted row as active for a direct request. Do not delete
  a business until web and worker are both on the new build.
- Rollback = redeploy the previous build; leave the migration in place. Deleted businesses stay out of every
  `status = 'active'` reader and nothing wipes them. Two things come back for them under old code: a member can open
  one by direct URL, and `gsc.daily` syncs it. If the rollback will last, un-delete by hand:
  `UPDATE businesses SET status = 'active', deleted_at = NULL, purge_at = NULL WHERE status = 'deleted'`.
- Stop the wipe without a deploy: `RADAR_PURGE=off` on the worker.

### 11.4 Check on production after deploy (owner or PM; agents have no production access)

1. The migration applied: columns, `businesses_deleted_check`, `businesses_purge_idx`.
2. The bucket credentials can list and delete: put two objects under a random UUID prefix, call `deletePrefix` keeping
   one, check it survived, then call it again with an empty keep set (T2 adds `scripts/check-storage-delete.ts` for
   this). Confirm whether the bucket is versioned.
3. The worker started after the migration and logs no `business.purge` failure.
4. Delete and restore a throwaway business end to end, with a second member's tab open.
5. The first real wipe can happen no sooner than 7 days after the first real delete. On that day check the log line,
   that no row holds the id, that the prefix holds only the files the log counts as kept, and that one published
   article of that business still shows its images.

## 12. Decisions

Taken on 2026-11-16 (PM unless marked). The sections above already follow them.

| | Question | Decision |
|---|---|---|
| A | Published articles load body images, and for some connectors the cover, from Radar's storage. | **Owner: keep published images.** The wipe removes every stored file of the business except image files used inside articles already published to its site (§4.5). Public file URLs are left alone during the 7 days; `/api/files` is unchanged. This overrides my recommendation to remove everything and say so in the copy. |
| B | Google's revoke removes the grant for every business connected with the same Google account. | Revoke only when the owner has no other business holding Search Console tokens; otherwise delete without revoking (§4.6). Residual: another Radar account using the same Google login is still affected. |
| C | DEL-5 for a job already running. | No external call is started after the delete commits; one already on the wire completes. |
| D | Sent mail records that name the business and carry no business id. | No retention rule in this change. They stay in the kept list (§4.7). Leftover. |
| E | `events` and `ai_calls`. | Scrubbed to anonymous counters and kept. |
| F | Restoring next to a newer business on the same domain. | Allowed, no warning, no extra field. |
| G | RES-2 states (§3.5). | Confirmed. No notification after a restore. |
| H | Restore without a subscription. | Allowed; the business comes back locked. |
| I | Another member's open tab. | Shows "That business was deleted." |
| | Delete and restore as two routes instead of actions. | Accepted. |

Still open, raised by decision A:

| | Question | Recommendation |
|---|---|---|
| J | The privacy page promises that deleted data goes within 30 days (`app/(public)/privacy/page.tsx:44`). Kept images are an exception it does not state, so E-3 is no longer true as written. | Add one sentence there, for example "Images inside articles Radar already published stay available so those articles keep working." Legal copy, so the owner's call; if approved the file goes to T3. |
| K | An entry that is not `published` can still have content on the owner's site: Radar created a draft there (`publish_remote` is set, `publisher.ts:159-160`) and the publish then failed or was held, or the publish succeeded and the process died before saving the status. If the owner publishes that draft by hand, or in the second case already has a live post, its images are deleted at the wipe. | Count an entry with `publish_remote IS NOT NULL` as well. It widens the owner's wording from "published" to "written to the site", so I have not assumed it; it is one more term in the query of §4.5. |

PM, 2026-11-16, on J and K:
- **J: add the sentence.** It follows from the owner's decision A and keeps the page true. The file
  (`app/(public)/privacy/page.tsx`) goes to T3. The owner reviews the wording in the pull request.
- **K: accepted.** An entry counts when `status = 'published'`, or `published_url IS NOT NULL`, or
  `publish_remote IS NOT NULL`. The owner's purpose is that content Radar put on the site keeps working.

## 13. Risks and leftovers

- The wipe is irreversible and new. The eight guards of §4.2 and the tests marked bold in §10 are the review focus.
- Decision A makes the file step selective. A wrong keep set fails in one of two ways: too small breaks images on a
  customer's live site for good; too large leaves private files (drafts, logos) in public storage with no record.
  The first is prevented by reading only locked, terminal data and aborting on anything unexpected; the second by
  taking references only from published articles and by `keep` being unable to add to what is listed.
- Kept files are orphaned by design: no record, no expiry, no cleanup, growing with every wiped business (§4.5).
- A storage or permission failure does not lose data but leaves a deleted business unwiped and alerting hourly.
- The audit covers `ead40f9b`. A cron or reader added later is covered by the queue and the gates only if it goes
  through them; the "no cron touches a deleted business" test iterates the registered hooks to catch new ones.
- Partner notices suppressed during the window are not re-sent after a restore.
- A job stopped mid-run leaves that one piece of work unfinished (for example a draft that goes back to Approved).
- Leftovers, not in this change: no revoke at the platform for blog connectors; the Google grant-wide revoke in the
  three existing callers; CDN and browser copies of public images; bucket versioning; `cron_marks` is never pruned;
  no retention rule for sent mail records (decision D); no way to find or remove kept images later except by hand.
