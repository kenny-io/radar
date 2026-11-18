# Email cadence correction: architecture (EC-A)

Workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-email-cadence-6eec24`, branch `kenny-dev/radar-email-cadence-6eec24`, starting revision `e7e597ef`, clean apart from `.factory/email-cadence/`. Read-only investigation; this file is the architect's only write. No test was run (no database yet), so every statement about behaviour is from reading the code.

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **No migration, no new table, no new job kind, no new dependency.** `cron_marks` (never pruned, `jobs/maintenance.ts`) and `jobs` are enough. |
| D2 | **Unsent Autopilot items are not stored.** Every run already recomputes everything that needs the owner (`run.ts` builds `handoffs` from current state). An item is marked in `cron_marks` only in the transaction that puts it in an email. An item found after the day's email stays unmarked, is found again by later runs for as long as it is true, and goes into the next email. The recheck "does it still need the owner" is the run itself, so there is no second copy of that rule and nothing stored that can go stale. |
| D3 | **One email per business-local day** is a `cron_marks` primary key `autopilot-day:{bid}:{date}`, claimed in the same transaction as the item marks and the `autopilot.handoff` job. It is keyed by business and date only, so a new activation the same day cannot send a second one. |
| D4 | **Readiness rule.** Not before the business's daily social time `T` (`socialAuto.time`, default 08:00, business timezone). From `T`: as soon as one run has processed both today's Daily Brief and today's daily social pack. At the latest two hours after the program could start: `max(T, enabledAt) + 2 h` (10:00 local by default), never later than 23:30 local. |
| D5 | **Carry.** Persistent items (failed post, failed article, every standing condition) are carried until the next email, for as long as they stay true: no age limit. A manual daily-pack post is carried one day. A Daily Brief item is never carried past its own local day (the product expires it at local midnight, see 2.3). |
| D6 | **Standing conditions** get a key without a date or a daily id: `blog`, `blog-paused`, `social:{ch}`, `stage:{name}`, `brief-source`, `job:{kind}`. The mark is deleted when a run checks the condition and finds it resolved, so the next occurrence is told again. |
| D7 | **Work reminders weekly:** a new `workUpdateAfter` (work_update rows only, 7 days, same evidence as `optionalDeliveryAfter`), checked in `collectWorkUpdates` and again in the dispatcher. `optionalDeliveryAfter` itself is not edited. |
| D8 | **Rollout needs no data change.** Old per-item marks keep their format; old per-day marks for standing conditions are honoured through a small lookup; a batch email the old code already sent today counts as today's email. |

## 2. What the code does today (evidence)

### 2.1 Autopilot

- `autopilotTick` (`autopilot/run.ts:171`) queues `autopilot.run` per enabled business when `lastRunAt` is 5 minutes old; singleton `autopilot.run:{bid}`.
- A run has no time gate on the Daily Brief: `run.ts:126` queues `brief.scan` as soon as today's `brief_days` row is missing, so the brief exists a few minutes after local midnight. The social pack is gated by `isDue` (`social/auto.ts:23`): local time >= `socialAuto.time` (default 08:00, `workspace.ts:77`). That is why the inbox shows a first email around midnight (replies and `blog:{date}`), a second after 08:00 (`pack:{id}:{platform}`), and more after rescans.
- `enqueueHandoff` (`autopilot/handoff.ts:22`) claims `autopilot-handoff:{bid}:{activationId}:{item.key}` per item and inserts one job per batch of newly claimed keys, in one transaction under `SELECT ... FOR UPDATE` on the business row.
- `deliverHandoff` (`handoff.ts:40`) sends the frozen payload with idempotency key `autopilot-handoff:{job.id}`; `sendMail` (`mail.ts:24-33`) derives the outbox id from that key, resends the persisted body, and refuses after 23 hours.
- `requestAutopilotRun` (`control.ts:38`) re-queues a failed `autopilot.handoff` job under the same id.

### 2.2 Work reminders

- `collectWorkUpdates` (`lifecycle/engagement.ts:127`) pages 200 users with due unresolved events. Under a per-user advisory lock it either pushes the due events' `eligibleAt` (active digest: +1 h; `optionalDeliveryAfter`: the returned time) or builds one digest, at most three sections, one per kind, under event key `work-update:{userId}:{UTC date}`, and tombstones the included events as `queued`.
- The dispatcher (`lifecycle/dispatch.ts:210`) defers optional mail with `optionalDeliveryAfter` and rebuilds a work digest before its first attempt (`dispatch.ts:214`).
- `recordEngagement` does not capture events for a business with Autopilot on (`engagement.ts:27`), so the two senders never overlap for one business.

### 2.3 A fact that limits EC-03

Open and copied items of a past brief day are expired by the product: `brief/store.ts:71` (`expirePastDays`), `server/workspace.ts:137` (mapped to `expired` on every read), `actions/brief.ts:96` (an expired item cannot be acted on), and `features/brief/DailyBrief.tsx:441` (a past day is read-only). A reply found after the day's email therefore cannot "still need the owner" the next day. Background rescans, the main source of late replies, only run after a member has acted on today's brief (`brief/rescan.ts`), so the owner is in Radar when they appear, and a toast is raised.

## 3. Autopilot daily email (EC-01, EC-02, EC-03)

### 3.1 Readiness: pure function in `autopilot/policy.ts`

```ts
export const HANDOFF_WAIT_MS = 2 * 3600e3;
/** The day's owner email: not before the saved daily time, then as soon as the brief and the daily pack are
 *  processed, and two hours after the program could start at the latest (23:30 local at the very latest). */
export function handoffReady(o: { tz: string; date: string; time: string; enabledAt: string | null; settled: boolean; now: number }): boolean
```

- `start = zonedTimeToUtc(date, time, tz)`; `now < start` returns false.
- `settled` returns true.
- `begin = max(start, Date.parse(enabledAt) || 0)`; `cut = min(begin + HANDOFF_WAIT_MS, zonedTimeToUtc(addDays(date, 1), '00:00', tz) - 30 * 60e3)`; return `now >= cut`.
- An invalid timezone must not fail the run: fall back to `'UTC'` the way `zone()` does in `engagement.ts:20` (`zonedTimeToUtc` throws on an unknown zone; `todayIn` does not).

Why this rule:

- **Floor at `T`.** The pack cannot exist before `T`, so on a social day the work is not ready earlier. On a day without social (custom days, no platforms) the brief alone is ready at about 00:10, and "whichever is first" would mail at midnight. The floor keeps the email at the owner's own chosen morning time. This is a choice beyond the brief's wording; see Decisions needed.
- **`settled` comes from the run, not from probing jobs.** `briefDone` is set at the end of the Daily Brief stage when today's row existed and the loop finished. `packDone` is set in the Social posts stage when `isDue` says no pack is due today, or when the pack existed and its loop finished. A stage that throws, a scan still running, a pack still generating or a failed scan leave the flag unset and the cut-off decides.
- **Two hours.** `brief.scan` has one attempt and a 20-minute timeout; `social.autoRun` has three attempts of 10 minutes; runs come every 5 minutes. Honest worst case is about 40 minutes after `T`. Two hours covers a busy worker and still lands in the morning.
- **`enabledAt`.** Without it, turning Autopilot on at 15:00 would already be past the cut-off, and the first run would mail the one thing it had found, minutes before the first brief. With it, the first email waits for the first brief and pack, 17:00 at the latest.
- **After the cut-off with no email yet today,** the first run that finds something unannounced sends it at once (still the day's only email). Anything later that day waits for the next day.

### 3.2 `autopilot/handoff.ts`: contract

```ts
export interface Handoff { key: string; title: string; reason: string; href: string; text?: string; sourceUrl?: string }   // unchanged
export interface HandoffPayload { activationId: string; ownerId: string; name: string; items: Handoff[];
  /** Business-local date this email is the one for. Absent on jobs queued by the per-batch code. */ day?: string }
/** What one run found. `items`: everything that needs the owner now. `clear`: standing keys checked and resolved.
 *  `legacy`: standing key -> the keys the per-day scheme used for the same condition (rollout only). */
export interface HandoffRun { date: string; ready: boolean; items: Handoff[]; clear?: string[]; legacy?: Record<string, string[]> }
export async function enqueueHandoff(bid: string, activationId: string, run: HandoffRun): Promise<number>   // items put in an email
```

`deliverHandoff` is not changed.

Steps, all in one transaction, after `canRun`, with the business row locked `FOR UPDATE` and `authorized(b, activationId)` as today. `P = autopilot-handoff:{bid}:{activationId}:` (unchanged prefix).

1. `items` = `run.items` with duplicate keys removed, first one kept (several refusals now share one standing key).
2. Delete marks `P + k` for every `k` in `run.clear` that is not a key in `items` (a condition both resolved and present in one run counts as present).
3. No items: return 0.
4. Read which `P + item.key` marks exist. For an unmarked item with `run.legacy[item.key]`: if any mark `P + legacyKey` exists, insert `P + item.key` and treat the item as already told. This step runs on every run, ready or not.
5. `fresh` = items still unmarked. Return 0 when `!run.ready`, when `fresh` is empty, or when `todayIn(b.timezone, new Date()) !== run.date` (a run that crossed local midnight must not send yesterday's email today).
6. Insert `autopilot-day:{bid}:{run.date}` with `onConflictDoNothing().returning()`. Nothing returned: return 0.
7. Rollout guard: if a job exists with `kind = 'autopilot.handoff'`, this `businessId`, `payload->>'day' IS NULL` and `created_at >= zonedTimeToUtc(run.date, '00:00', tz)`, return 0 and keep the day mark. The old code already sent today's email.
8. Insert the marks `P + key` for `fresh`.
9. Insert the job: `kind: 'autopilot.handoff'`, `businessId`, `maxAttempts: 4`, `ref` and `singletonKey` = `autopilot-mail:{bid}:{run.date}`, payload `{ activationId, ownerId: b.ownerId, name, items: fresh, day: run.date }`. Return `fresh.length`.

Why exactly one per day holds:

| Case | Why |
| --- | --- |
| Concurrent runs | Both lock the business row; the day mark is a primary key; the second gets no row back at step 6. |
| Run retried after a failure (maxAttempts 3) | Day mark, item marks and job commit together or not at all. A retry after commit stops at step 6. |
| Crash between claim and send | There is no such state: the claim and the job row are one commit. The queue recovers a stale job after 90 s; `sendMail` resends the persisted outbox row with the same provider key. |
| Delivery fails four times | The job is `failed`, the day stays claimed, `lastError` tells the owner, nothing else is sent that day (an attempt of unknown outcome counts, as it does for lifecycle mail). |
| "Run Autopilot again" | The retry suffix only affects `dailyJob` marks. The retry run stops at step 6. A failed mail job is re-queued under the same id and payload, as today. |
| Re-enable under a new activation | Item marks carry the activation, so the new program tells its standing problems once. The day mark does not, so no second email that day. The old activation's queued job ends as `skipped: 'autopilot_off'` in `deliverHandoff`. |
| Nothing actionable | Steps 3 and 5 return before the day is claimed. No email, and the day stays free. |

### 3.3 Late items and carry limits

| Item | Found after the day's email | Dropped when |
| --- | --- | --- |
| `brief:{date}:{id}` (reply, manual post, post refused by its own publishing check) | Not carried. | Local midnight of `{date}`: the product expires it (2.3). Also when its state is no longer `open`. |
| `pack:{packId}:{platform}` manual post | In the next local day's email if still not copied. | After that next day, or once `copiedAt` is set. |
| `failed-post:{pubId}`, `failed-article:{entryId}` | In the next email. | When the post or article is no longer `failed`. No age limit. |
| Standing conditions | In the next email. | When checked and resolved. |
| Autopilot off, or re-enabled | Nothing is kept from the old activation. | At once. |

## 4. `autopilot/run.ts`: required changes

Shared bookkeeping next to `issue`:

- `issue(...)` skips a key that is already in `handoffs`.
- `clear: string[]`, `legacy: Record<string, string[]>`, `briefDone`, `packDone`, `yesterday = addDays(date, -1)`.
- A helper for standing conditions: when true it records the legacy keys and calls `issue`; when false it pushes the key to `clear`. Titles, reasons and links stay the existing strings.

### 4.1 Every `issue(...)` call, classified (EC-04)

| Line | Old key | Class | New key | Legacy keys passed |
| --- | --- | --- | --- | --- |
| 73 | `stage:{name}:{date}` | Standing | `stage:{name}` | `stage:{name}:{date}`, `stage:{name}:{yesterday}` |
| 89 | `blog:{date}` | Standing | `blog` | `blog:{date}`, `blog:{yesterday}` |
| 90 | `blog-paused:{date}` | Standing | `blog-paused` | `blog-paused:{date}`, `blog-paused:{yesterday}` |
| 116 | `pack:{packId}:{platform}` (manual platform, or publishing off) | Daily | unchanged | none |
| 118 | `pack:{packId}:{platform}` (schedule refused) | Standing when the account is missing or expired; otherwise daily | `social:{ch}`, or unchanged | `pack:{packId}:{platform}`, `pack:{dailyPackId(bid, yesterday)}:{platform}` |
| 136 | `brief:{date}:{id}` (reply, or manual post) | Daily | unchanged | none |
| 142 | `brief:{date}:{id}` (schedule refused) | Standing when the account is missing or expired; otherwise daily | `social:{ch}`, or unchanged | `brief:{date}:{id}` |
| 153 | `held-post:{pubId}` | Standing | `social:{p.ch}` | `held-post:{pubId}` |
| 154 | `failed-post:{pubId}` | Per post, once | unchanged | none |
| 155 | `failed-article:{entryId}` | Per article, once | unchanged | none |
| 156 | `failed-job:{jobId}` | Standing | `job:{kind}` | `failed-job:{jobId}` |
| 160 | `brief-source:{date}` | Standing | `brief-source` | `brief-source:{date}`, `brief-source:{yesterday}` |

`ch` is the account channel (`x`, `li_profile`, `li_page`) so a missing company page is not cleared by a working profile.

### 4.2 When each standing condition is true and when it is cleared

| Key | True in a run when | Cleared in a run when |
| --- | --- | --- |
| `stage:{name}` | The stage threw. | The stage finished. |
| `blog` | No connection has status `ok`. | One has. |
| `blog-paused` | `b.blog.paused`. | Not paused. |
| `social:{ch}` | An attempt to schedule on `ch` resolved to no account or an expired one, or a scheduled Autopilot post on `ch` is held. | An attempt on `ch` resolved to a live account and nothing in the same run said otherwise. A held-post row that is healthy is not evidence either way. |
| `brief-source` | The newest `done` scan for today has `result.failed`. | The newest `done` scan for today has none. No done scan today: not checked. |
| `job:{kind}` | The newest finished (`done` or `failed`) job of that kind for the business is `failed` and carries this activation. | The newest finished job of that kind is anything else. |

A condition that is not checked in a run (stage skipped, nothing to schedule on that channel) keeps its mark. Only a positive check clears.

Decisions the PM asked for:

- **`stage:{name}:{date}` is standing.** The text is the same every day and the owner has nothing new to do. With a date in the key, a stage that fails every run would cause an email a day on its own.
- **`brief-source:{date}` is standing.** A source that blocks Radar usually stays blocked for days.
- **`failed-job:{id}` is standing, by kind.** The program queues a new `calendar.generate`, `brief.scan` or `social.autoRun` every day under a new date mark, so a failure that repeats gets a new job id and, today, a new email every day. "Newest finished job of the kind" gives an exact "cleared": a later successful run, including a manual one.
- **A failed publishing check is daily work, not standing.** See Decisions needed, item 3.

### 4.3 Edits by stage

1. **`stage` wrapper.** On success push `stage:{name}` to `clear`; in the catch use the standing helper.
2. **Articles.** `blog` and `blog-paused` through the helper, both checked before the existing early return for a paused blog.
3. **`schedulePost`.** After the existing `if (r.existing) return 'existing'`, report `(r.ch, !!r.acct && !r.acct.expired)` to the caller (a callback parameter is enough). Nothing else in it changes. Account health is read from `resolve`, the same value `accountGate` uses, so no error code is interpreted.
4. **Social posts.**
   - Before the `isDue` return, look at yesterday's daily pack (`getPack(bid, dailyPackId(bid, yesterday))`) and issue `pack:{id}:{platform}` for its manual posts with `copiedAt == null`. This is the one-day carry. A post already told has its mark.
   - Today's manual branch: issue only when `post.copiedAt == null`.
   - Schedule branch: on a live account push `social:{ch}` to `clear`. In the catch keep `refused(e, ...)`; when the reported account was not live, use the standing helper with key `social:{ch}`; otherwise `issue` under the old per-post key.
   - `packDone = true` when `!due`, and after the loop over an existing pack.
5. **Daily Brief.** In the handoff-only branch (reply, manual post) issue only when `item.st === 'open'`; a copied item no longer needs the owner (EC-03). The scheduling branch gets the same account handling as the pack. `briefDone = true` after the loop.
6. **Publishing follow-up.**
   - Held loop: `social:{p.ch}` through the helper, true only.
   - Jobs: replace the "30 newest failed" query with the newest finished job per kind (`db.selectDistinctOn([S.jobs.kind], ...)` ordered by kind and `createdAt` descending, status in `done`, `failed`; the pattern is in `services/activity.ts:22`).
   - `brief-source` through the helper when a done scan for today exists.
   - `failed-post`, `failed-article` and the `failedMail` check are unchanged.
7. **End of run.** `enqueueHandoff(bid, activationId, { date, items: handoffs, clear, legacy, ready: handoffReady({ tz: b.timezone, date, time: socialAutoOf(b).time || '08:00', enabledAt: autopilotOf(b).enabledAt, settled: briefDone && packDone, now: Date.now() }) })`. The summary line and the `lastRunAt` update stay.

A standing condition alone still gets its first email: at readiness it is the only unmarked item, so steps 5 to 9 send one email with one item.

## 5. Weekly work reminders (EC-05)

### 5.1 `lifecycle/engagement.ts`

```ts
export const WORK_EVERY = 7 * DAY;
/** Work reminders are weekly per account. Same evidence as the daily optional cap: a first attempt counts even if
 *  its acknowledgment was lost. */
export async function workUpdateAfter(userId: string, now = new Date(), excludeId?: string, q: Q = db): Promise<Date | null>
```

- Rows: `lifecycle_emails` of this user with `type = 'work_update'`, not `excludeId`, and `firstAttemptAt`, `sentAt`, or (`status = 'logged'` and `createdAt`) inside the last 7 days.
- `latest` = the newest of those three times, computed exactly as `optionalDeliveryAfter` does. Return `new Date(latest + WORK_EVERY)` when it is in the future, else null. Exactly 7 days later is allowed, as exactly 24 hours is today.
- A digest that was suppressed or expired without an attempt leaves no evidence and does not start the week.

`collectWorkUpdates`, one line: `const after = active.length ? new Date(now.getTime() + 3600e3) : await workUpdateAfter(userId, now, undefined, tx) || await optionalDeliveryAfter(userId, now, undefined, tx);`

What then happens to due events inside the 7 days, with no further change:

- The existing `UPDATE ... SET eligibleAt = after` moves them to the end of the week. They are not assigned to an email and not tombstoned.
- They leave the due page, so the 200-user page is not starved. The cost is one update per user per newly due batch.
- `resolveEngagement` does not look at `eligibleAt`, so a source still resolves when the owner acts.
- At the end of the week `engagementSection` returns null for anything past `expiresAt` (a brief event expires at the end of its local day, the others 7 days after they occurred) and the collector resolves it as `no_longer_actionable`. What remains gives one digest of at most three sections, one per kind. Events not selected are pushed another week by the same rule and expire. There is no burst.

### 5.2 `lifecycle/dispatch.ts`: send-side check

Immediately before the existing `optionalDeliveryAfter` block (`dispatch.ts:210`):

- Only for `row.type === 'work_update' && !row.firstAttemptAt`: `const week = await workUpdateAfter(row.userId, now, row.id)`.
- When set, in one transaction: set the row to `suppressed` with `lastError: 'work_weekly_limit'` under `owned(row)`; if that changed a row, give its sources back: `engagement_events` with `lifecycleEmailId = row.id` and `resolvedReason = 'queued'` get `resolvedAt: null, resolvedReason: null, lifecycleEmailId: null, eligibleAt: week`. Then `continue`.

Notes:

- A plain `defer` is wrong here: the row expires 3 days after it was queued (`queue.ts:35`), so a 7-day deferral would end as `expired_delivery_window` with its sources tombstoned and never sent.
- Releasing is safe only because nothing was attempted. A row with `firstAttemptAt` skips the weekly check and retries its frozen payload under `radar-lifecycle/{row.id}` exactly as today.
- This path is reached at rollout and when two workers overlap. In steady state the collector does not queue inside the week.

### 5.3 Interactions checked

- **Per-UTC-day key `work-update:{userId}:{date}`.** Unchanged. It still stops two rows on one UTC day. When a released source comes due on a day that already has a row, the existing branch moves it to the next UTC midnight; it is sent that day.
- **A digest deferred by a lesson.** Lesson and digest due together: the lesson is claimed first (priority 3 before 7), the digest is deferred 24 hours by the unchanged `optionalDeliveryAfter` block, stays `queued` with its sources, and is sent the next day. The weekly check excludes the row itself, and the week is counted from the actual send. It is not lost for a week.
- **Quiet hours.** If the week ends at night, the collector's next pass gets the 09:00 time from `optionalDeliveryAfter`.
- **Other optional mail** is never held by a work reminder for more than the existing 24 hours, because `optionalDeliveryAfter` is not touched.

## 6. Rollout (EC-06)

| State at deploy | What happens |
| --- | --- |
| Item marks under old keys (`brief:`, `pack:` manual, `failed-post:`, `failed-article:`) | Same format. Already told, stays told. |
| Marks under old per-day keys for a standing condition | Step 4 of 3.2 finds today's or yesterday's old mark and writes the new mark silently. Not announced again. |
| Queued or running `autopilot.handoff` jobs | Delivered unchanged: same payload shape, same idempotency key. |
| A business that already got Autopilot mail today | The job has no `day` and was created since local midnight, so step 7 takes the day. Later items wait for tomorrow. |
| Old worker still running for a few minutes | It may send the batch it would have sent anyway; the new code then counts it as today's email. It can read a new job (`day` is an extra field). |
| Account that got a work reminder in the last 7 days | `workUpdateAfter` reads the existing rows. Nothing until 7 days after that send. |
| Queued, never attempted `work_update` row for such an account | Suppressed as `work_weekly_limit`; its sources return to the pool for the end of the week. |
| `work_update` row in the middle of a retry | Unchanged path, identical body and key. |
| First day on the new code | One email per business, at readiness. No replay of anything already told. |
| Rollback | Old code ignores the new marks and the `day` field. Nothing to undo. |

The legacy lookup (3.2 step 4) and the rollout guard (step 7) are dead code two days after deploy and can be removed later.

## 7. Paths the engineer must not touch (EC-07)

- `lifecycle/engagement.ts`: `optionalDeliveryAfter` (also used by `education.ts:78`, `guides.ts:113`, `visibility/digest.ts:46`), `recordEngagement`, `resolveEngagement`, `resolveCalendarForEntries`, `engagementSection`, `currentWorkSections`, `WORK_DELAYS`, the event key format, the three-section rule.
- `lifecycle/dispatch.ts`: the `claim` ordering (priority), `defer`, `retry`, `terminal`, `lifecycleEligible`, the retry window, the provider request and its `Idempotency-Key`.
- `lifecycle/queue.ts`, `templates.ts`, `education*.ts`, `guides.ts`, `guideContent.ts`, `preferences.ts`, `visibility/digest*.ts`.
- `services/mail.ts` (`sendMail`, `sendAuthMail`), `legacyContent.ts` (`autopilotHandoffEmail` and every other template), `mailIdentity.ts`.
- `autopilot/handoff.ts` `deliverHandoff`; `autopilot/control.ts`; `autopilot/guard.ts`; `autopilot/jobs.ts`; `autopilotTick`; `dailyJob`; the scheduling decisions inside `schedulePost` and the stages (what is generated, scheduled or published).
- Billing, security, invitation, partner and operator mail, and `db/schema.ts`.

## 8. Docs and copy (EC-08)

- `docs/EMAILS.md` rows #10 to #14: keep the per-source delay as "eligible after", add "sent only in the account's one work reminder per rolling 7 days"; #14 names both limits. Row #29, trigger "Owner-enabled Autopilot has owner actions not yet emailed", cadence "At most one per business per business-local day, after the daily social time once the day's brief and pack are processed, two hours later at the latest; a standing problem once per occurrence". Line 75 gains the same sentence.
- `.factory/lifecycle-refinement/schedule.md`: "Shared delivery behavior" second bullet (work reminders weekly) and the #29 paragraph under Rollout.
- `scripts/preview-radar-emails.ts` lines 44, 46 and 85: the cadence strings.
- `src/features/settings/EmailSettings.tsx:64` says "one new message every 24 hours", which is no longer the limit for the reminders on that screen, and lines 9 to 11 promise a reminder "after an hour" or "after 24 hours". Proposed wording is under Decisions needed, item 4.
- `AutopilotSettings.tsx:70` and the handoff email state no cadence. No change.

## 9. Implementation order

The two halves share no code and can be done in either order.

1. `policy.ts` `handoffReady` with unit tests in `policy.test.ts`.
2. `handoff.ts` `enqueueHandoff` (3.2).
3. `run.ts` (section 4).
4. `autopilot.db.test.ts`: changed and new tests.
5. `engagement.ts` `workUpdateAfter` and the collector line; `dispatch.ts` send-side check; tests in `engagement.test.ts`.
6. Copy and docs (section 8).

## 10. Test plan

Simulate days with `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime`. Use dates in the past of the real clock: `sendMail` compares `Date.now()` with the outbox row's database `created_at` and refuses at 23 hours. Do not assert "not ready yet" on the real clock: between 23:30 and midnight the cut-off is already reached.

### 10.1 Existing tests that encode the old behaviour and must change

All in `src/server/services/autopilot/autopilot.db.test.ts`:

1. `manual replies are handed to owner with selected edits; repeated runs dedupe and late arrivals are delivered`: the last assertion expects one more job after a late arrival. It must expect no new job that day. Rename it.
2. `owner email jobs persist exact payloads and explicit retry revives terminal failure with same job id`: calls `enqueueHandoff(bid, activationId, items)`; new signature.
3. `an unconnected channel is the owner's to fix: told once, ...`: expects keys `brief:{date}:li-page` and `brief:{date}:li-profile`; they become `social:li_page` and `social:li_profile`.
4. `a generated daily post for an unconnected channel is handed to the owner without a failure report`: filters on `key.startsWith('pack:')`, now `social:li_profile`. It also never creates today's brief row, so the email would wait for the cut-off: insert an empty `brief_days` row for today, or move the clock.

Expected to pass unchanged, to be confirmed: `an unexpected scheduling error is still reported as a failure` (an unexpected error keeps the per-post key), every test in `engagement.test.ts`, `autopilotIntegration.test.ts`, `deletion/crons.db.test.ts`.

### 10.2 Autopilot scenarios

Business timezone `America/New_York`, social time 08:00, Autopilot enabled the day before, unless stated. "Jobs" means `autopilot.handoff` rows.

| # | Criterion | Scenario | Expected |
| --- | --- | --- | --- |
| A1 | EC-01, 02 | Today's brief row has 2 open replies; no blog connection. Run at 07:55. Create the pack. Runs at 08:10, 08:15, 13:00. | 07:55: 0 jobs. 08:10: 1 job, `payload.day` = local date, items = 2 replies + `blog` (+ pack items). After: still 1. |
| A2 | EC-02 | No brief row (scan never finishes); pack processed; no blog connection. Runs at 08:10, 09:55, 10:00. | 0, 0, then 1 job at 10:00 with `blog`, without replies. |
| A3 | EC-02 | Autopilot enabled today at 15:00. Runs at 15:01 (nothing ready), 15:20 (brief and pack ready). Variant: never ready, run at 17:00. | 0 jobs, then 1 at 15:20. Variant: 1 at 17:00. |
| A4 | EC-03 | After A1, a new reply is added to today's brief at 11:00. Runs until 23:55, then next day 08:10 with a new brief. | No job after 11:00. Next day: 1 job with only the new day's items. |
| A5 | EC-03 | After A1, an Autopilot post fails at 14:00. Runs that day, then 08:10 next day. Variant: the post is rescheduled overnight. | Day 1: still 1 job. Day 2: 1 job that includes `failed-post:{id}`. Variant: not included. |
| A6 | EC-03 | Manual platform. Email goes at the cut-off before the pack exists; pack created at 11:00. Next day 08:10. Variants: `copiedAt` set overnight; the day after. | Day 2's email has `pack:{yesterday}:{platform}`. Variants: absent. |
| A7 | EC-01, 03 | Nothing actionable in the morning; a post fails at 15:00; another at 16:00. | 0 jobs until 15:05, then 1; the second waits for the next day. |
| A8 | EC-01 | Two `runAutopilot` calls in parallel at readiness. | 1 job, 1 day mark. |
| A9 | EC-01, 06 | Deliver with the provider answering 503 then 200; call `deliverHandoff` twice more. | 1 outbox row, identical body, same `Idempotency-Key`. |
| A10 | EC-01 | `requestAutopilotRun` after today's email, with the mail job set to `failed`. | Same job id re-queued with the same payload; no second job. |
| A11 | EC-01, 03 | Disable and enable after today's email. Run today and tomorrow at 08:10. | Today 0 new jobs; the old job delivers as `skipped: autopilot_off`. Tomorrow 1 job that tells the standing conditions again under the new activation. |
| A12 | EC-04 | No blog connection for 3 local days, nothing else. Connect on day 4, disconnect on day 5. | Day 1: 1 job with `blog`. Days 2, 3: 0 jobs. Day 4: mark gone. Day 5: 1 job with `blog`. |
| A13 | EC-04 | LinkedIn not connected; a LinkedIn pack post and two brief posts each day. Day 3: connect. Later the account expires with a post scheduled. | Day 1: one `social:li_profile` item, not three. Day 2: none. Day 3: mark cleared. On expiry: told once more. |
| A14 | EC-04 | The only item is `blog-paused`. | 1 job with 1 item. |
| A15 | EC-04 | A post whose text is too long, two days running, account connected. | A per-post item each day; no `social:` item. |
| A16 | EC-01 | `Pacific/Auckland`: a run at 23:50 local and one at 08:10 the next local day (the same UTC date), each with a new failed post, no email yet either day. A run started at 23:59 that reaches `enqueueHandoff` at 00:01. | One job per local date, two on that UTC date; the crossing run adds none. |
| A17 | EC-02 | `handoffReady` unit cases: before `T`; `T` with settled; `T + 1:59` and `T + 2:00` unsettled; `T` = 23:00; the DST days 2026-03-08 and 2026-11-01 in New York; an invalid zone. | False, true, false, true; 23:30 bound; no throw. |
| A18 | EC-06 | Old marks `blog:{today}` and `pack:{todayPack}:linkedin`, and an old-shape job (no `day`, `createdAt` set explicitly to today). Run today, and tomorrow at 08:10. | Today: 0 new jobs, day mark set, `blog` and `social:li_profile` marks written. Tomorrow: neither item is in the email. |

### 10.3 Work reminder scenarios

Owner in UTC, as in `engagement.test.ts`.

| # | Scenario | Expected |
| --- | --- | --- |
| W1 | Digest sent Mon 2026-11-02 10:00. New due sources every day; collect and dispatch daily at 12:00 until Sun. Then Mon 2026-11-09 10:00. | Tue to Sun: 0 queued, 0 new rows, due events have `eligibleAt` = 2026-11-09 10:00. Then 1 digest, at most 3 sections, expired brief events resolved `no_longer_actionable`. 2 provider calls in 8 days. |
| W2 | Earlier work row: `failed` with a first attempt 3 days ago; `logged` 3 days ago; `suppressed` never attempted; a lesson sent 3 days ago. | Blocks, blocks, does not block, does not block. |
| W3 | Evidence exactly 7 days ago, and 1 ms less. | Allowed; deferred. |
| W4 | Two businesses of one owner, each with due sources, 2 days after a digest. | 0 queued. |
| W5 | Digest and a higher-priority optional mail (a lesson, or the founder note as the existing cap test does) due together at 10:00. Dispatch now and 24 hours later. | The other mail is sent; digest `queued` with `optional_frequency_or_quiet_hours` and its sources still attached; sent the next day; the week counts from that send. |
| W6 | A never-attempted queued digest, and another digest sent 2 days ago. Dispatch. Then collect at sent + 7 days. | 0 provider calls; row `suppressed`, `work_weekly_limit`; its events unresolved, unassigned, `eligibleAt` = sent + 7 days; then 1 digest. |
| W7 | First attempt answered 429, retry 31 s later, with a digest sent 2 days ago also present. | The retry sends the identical body and key. |
| W8 | One owner inside the week, one free, both with due sources. | 1 queued (the free owner); the other owner's events moved past now. |
| W9 | The week ends at 03:00. | Collected at 03:00 and moved to 09:00 by the existing rule; sent then. |
| W10 | The owner acts on a source during the week. | Resolved `action_taken`; not in the next digest. |
| W11 | The existing founder-note cap test and the quiet-hours assertion. | Unchanged. |

## 11. Risks

- **Late Daily Brief replies are never emailed** (2.3). This is the one place the design does not follow the brief's wording.
- **A delivery that failed yesterday and is retried by the owner today** arrives today next to today's email. It needs a provider outage plus a click on "Run Autopilot again" within 23 hours. Closing it would mean changing `control.ts` and the retry contract EC-06 asks to keep.
- **A standing condition that alternates** between true and resolved is told again each time it returns, at most once a day.
- **`social:{ch}` clears lazily.** After a reconnect the mark stays until the next attempt on that channel, normally the next day's post. An account that breaks again inside that gap is not told again.
- **Old and new workers overlapping** for a few minutes can send one old-style batch. The new code counts it.
- **A digest bumped by higher-priority optional mail for 3 days** expires with its sources, as it does today. It leaves no evidence, so the next digest is not delayed by a week.
- **The owner changing the business timezone** during a day changes the local date and can allow a second email that day.
- **Not verifiable from here:** production marks and queues cannot be read. The rollout rows in section 6 are proven only by A18 and W6 against a local database.

## 12. Decisions needed

1. **Late brief replies:** accept that a reply found after the day's email is not emailed, because the product expires it at local midnight. The alternative is a product change (keeping yesterday's replies actionable), which the brief excludes.
2. **The floor at the daily social time.** On a day with no social post the brief is ready at about 00:10; the design still waits for the social time (08:00 by default). Without the floor that email would go out at midnight.
3. **A failed publishing check is treated as daily work.** EC-04 lists "failing the publishing check" with the account problems. The check (`lib/socialPublish.ts:112`) is about one post: too long, image too big, images still being made. Each day's post is a different post with a different fix, so it stays one item per post in the day's email. Account missing, account expired and held posts are standing, per channel.
4. **Settings copy** (`EmailSettings.tsx`). Proposed:
   - Line 63: "Choose what your work reminder includes. Radar checks that each step is still unfinished before emailing you."
   - Line 64: "Work reminders come as one email, at most once a week across your businesses, sent during the day. These choices don't affect billing or security."
   - Daily Brief: "Today's Daily Brief, when it has been ready for an hour and you haven't copied or posted a reply."
   - Calendar: "A new content plan you haven't approved or scheduled anything from after 24 hours."
   - Social: "A new article not yet turned into social posts after two hours, or a social pack not scheduled or posted after 24 hours."
5. **Regenerating the preview catalogue** under `.factory/lifecycle-refinement/previews/` after the cadence strings change: the PM's call.

## 13. Leftovers

- Remove the legacy lookup and the rollout guard in `enqueueHandoff` once two days have passed in production.
- `refused()` in `run.ts` keeps its owner-fixable set; it is still needed for a failed publishing check.
