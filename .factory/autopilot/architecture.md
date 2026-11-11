# Program Autopilot architecture

Task A1. Architect read-only investigation at base `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`, workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`. Existing extensive working-tree changes are the feature base and must remain intact. This document is the architect's only write.

## Decision and contracts

Add a master per-business Autopilot, default off. The owner's explicit switch delegates supported marketing work; existing blog and social preferences remain stored unchanged. Autopilot is an effective policy overlay, distinct from legacy blog autopilot and legacy social auto scheduling. The feature automates existing Radar capabilities; it cannot claim to run ads, change budgets, provision accounts, or post community comments.

Public shared type:

```ts
interface AutopilotState {
  enabled: boolean;
  enabledAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  summary?: string;
}
// Workspace.autopilot?: AutopilotState for compatibility with fixtures.
// Server loadWorkspace always supplies the normalized state.
```

`businesses.autopilot` JSONB default `{}` stores this state plus internal `activationId: string | null` and `enabledBy: string | null`. Normalize absent/invalid enabled to false. Never expose internal authorization state as a client-writeable field. New nullable text `autopilotActivationId` columns on `calendar_entries` and `social_pubs` preserve provenance. Include all three additions in migration 0010 after the existing dirty 0009; backend engineer owns schema, migration journal and snapshot.

Owner-only actions (existing tenant-guarded action dispatcher):

- `settings.autopilot { enabled: boolean }` → `{ enabled: boolean }` plus normal workspace response. Lock business while changing state. Enabling from off sets new activationId, enabledAt and enabledBy, and queues one coordinator. Repeated on does not rotate authorization. Disabling revokes future automatic side effects without altering manual work or legacy preferences. Use current server state, not stale ctx.biz, to merge JSON.
- `settings.autopilotRun {}` → `{ jobId: string }` plus normal workspace response. Reject if disabled. Joins an existing queued/running singleton; safe to retry.

Job `autopilot.run` payload `{ activationId: string }`, businessId set, singleton `autopilot.run:{bid}`. Cron enqueues enabled active businesses periodically, using existing job queue. Re-read active status, enabled and matching activationId before each persisted/remote side effect. Bound expensive work by local date/entity, not tick count. Billing access must fail closed for Autopilot work, including publication rows: current generic queue skips most lapsed jobs but explicitly exempts social.send and fails open on access-check errors. Do not inherit that exception for master-autopilot posts.

## Reuse and execution

1. Calendar: reuse `calendar.generate` research and `calendarSettingsOf`. If no upcoming calendar exists (first setup or horizon exhausted), generate a next 30-day horizon from tomorrow in business timezone. Preserve every existing topic, including proposed rows. Existing calendar.generate unconditionally deletes all proposed rows and therefore needs an optional guarded autonomous additive mode (`autopilotActivationId` payload) rather than direct reuse unchanged. Recheck activation before transaction commit; additive selection must avoid occupied dates and duplicate keywords across all rows. Avoid an expensive generation every minute after empty/failed research: one bounded attempt per business/day plus explicit retry, with job retries for transient failures.
2. Articles: reuse `startDraft`, `article.draft`, article locks and publish connector pipeline. Activate only near-term eligible proposed/approved entries and stamp provenance when Autopilot claims them. Avoid rewriting generated bodies or touching user review/failed/locked/published entries by default. At most one article per business date, matching current legacy behavior. Effective article auto policy is matching active master activation OR unchanged legacy acknowledged blog policy. Missing/error connection produces saved draft and owner handoff. Respect existing publishing pause. Publish admission and final external side-effect boundary recheck activation for marked entries, including jobs queued before disable.
3. Social: reuse `dailyContext`, `createPack` deterministic daily ID and preflight/resolve/account selection/send paths. One pack per business/local date. Preserve dirty daily draft work: default generation remains editable drafts when master off; do not change socialAuto defaults or existing legacy autoSchedule behavior. Saved daily pack must still be eligible for an idempotent scheduling pass—existing autoRun early return otherwise strands retry after schedule failure. Only X and LinkedIn can publish; selected unsupported platforms stay editable and become handoff items. Existing manual or legacy pubs for the SID must not be overwritten/taken over. Use active-hour rule in business timezone: immediate via a due scheduled row if appropriate; otherwise next suitable future slot. Explain rule honestly; no claim of measured optimal posting times. Scheduling through existing publication worker retains retry/unknown outcome safeguards.
4. Brief: reuse `enqueueScan`, existing `briefSetup` and `briefSettings` defaults, with a bounded first scan when required. Existing scans/daily rescans can continue. Feed `kind:'post'` on X/LinkedIn may use supported publishing path, with a total daily cap that accounts for generated pack posts to avoid double campaigns. All `kind:'reply'` currently require the owner: even X and LinkedIn replies are explicitly refused by existing action/scheduling APIs. Do not add a comment adapter or bypass that restriction. Reddit/HN/Quora/unsupported feeds are also handoffs.
5. Owner email: send actionable digest to `businesses.ownerId → users.email` only. Reuse `sendMail(..., {idempotencyKey})` and outbox; do not use external connected inbox tools. Include business name/domain, why action is required, platform, draft text, source thread URL when present, and business-specific Radar deep link. Use persisted correct variant/edits; do not re-prompt model to write the email. Escape HTML if used; text-only is sufficient. Do not mark work posted merely because it was emailed. If nothing needs action, send no email. Dedupe each item or deterministic digest batch; avoid one digest/day key permanently suppressing late-arriving actionable items. Mark digest membership durably before sending through an idempotent mail job or derive deterministic batch hash from item IDs, so email failure retries the identical persisted payload. Failed/expired account and unsupported publication/generation failures must become owner actions too. Never include credentials, raw provider errors, or unrelated business data.

## Pause and provenance

`isAutopilotAuthorized(biz, activationId)` is true only when activationId is non-null and matches current enabled activation. A null provenance preserves legacy/manual behavior. Check marked rows at scheduler admission, job execution and immediately before remote create/publish; work already accepted by a remote provider cannot be recalled. Disabling may finish in-flight local generation as a saved draft, but must not newly schedule or send it. Do not gate unmarked manually scheduled posts.

A new enable receives a new activation. Old marked queued rows remain held and must not silently resume. UI/manual adoption needs deliberate conversion: manual reschedule/Post now clears provenance for the taken-over row; manual article publication may bypass the gate via existing explicit manual option, with an audit trail. Automatic worker must not clear it. Retain posted history and drafts. Existing five-minute social edit locks should not prevent a user from editing a permanently held post; consider exposing held state for unauthorized marked rows, or removing only unsent autonomous schedules on disable under a lock. Do not delete sending/posted rows.

## Ownership and implementation order

1. Backend engineer owns all shared contracts (`lib/types.ts`, `db/schema.ts`, migration 0010 and metadata, `workspace.ts`), Autopilot action/service/jobs, and server integration points. Publish contract first to UI engineer.
2. UI engineer owns SettingsPage and new Autopilot UI component only. Add Autopilot settings navigation section with existing rows/controls, visible status and last run, owner-only toggle/run-now, connection prerequisites and an explicit explanation that turning on can publish without review. Reflect server errors and disable during requests. Non-owners can read status and see who can change it. Mobile/keyboard behavior follows existing controls. No separate irreversible confirmation workflow is required by this contract; the explicit labeled toggle is consent.
3. Backend integrates effective overlay and provenance gates before coordinator activates side effects. Add meaningful DB/unit tests.
4. Independent QA validates acceptance in isolated DB/stub providers and real browser. No merge/deploy authorization inferred from read-only architecture work.

## Validation scenarios

- Migration from 0009, existing fixtures normalize off, old prefs and rows behave unchanged.
- Owner enable/disable/run-now succeeds; Editor/Admin/Viewer and foreign-business access are denied by route, not only UI.
- Enable missing calendar creates populated calendar; existing proposed and published topics survive horizon refill; duplicate/retry/tick does not multiply topics, pack, posts or email.
- Supported connected accounts schedule/publish; no account, expired account, feature flag off and provider failure retain draft and send actionable owner handoff. No real provider calls in isolated tests.
- All replies remain manual; Reddit email includes useful selected draft, correct source and business link, no posted marker. No actionable items produces no mail. Late arrivals can produce one new batch; retries do not resend old batches. Provider mail failure is retriable.
- Disable between source gathering and save, draft and scheduling, scheduling and send, and media upload and create. Marked posts held; null/manual rows still send. Off→on does not revive old activation. Manual adoption works.
- Lapsed billing and billing-check error cannot start new autonomous generation or marked sends. Existing manually scheduled work follows existing access policy.
- Local-date/daylight-saving slots, late catch-up, no backfill of old days, bounded per-day volume.
- Existing daily draft generation, legacy social schedule preference, manual publishing, article drafting/edit locks and connection pause regressions.

## Risks and limitations

No new infrastructure is needed. Existing cron advisory lock only prevents simultaneous scheduling, not simultaneous independent jobs; use conditional/transactional claims and active singleton keys for work. Existing `once()` followed by enqueue is not atomic, so avoid permanently stranding marks on crash. The existing queue Promise.race timeout does not abort job body; generation commit guards must still check job ownership and activation. Social send preserves unknown-outcome safety: never automatically resend a post after an unverified create. Owner digest should distinguish uncertain publication from definite failure. True optimization across channels/analytics and autonomous paid spend are future capabilities, not claims of this implementation.

## A2 targeted implementation review

Read-only implementation review while E1 landed. Findings sent directly to PM and engineer (implementation fixes owned by E1):

- Owner email links initially appended an ignored `bid` query. Corrected by E1 to use existing guarded `openBusinessUrl` cookie-setting hop.
- Exhausted handoff email jobs retained dedupe marks and could not be retried. E1 added explicit Run retry of the same failed job ID, preserving outbox/provider idempotency; terminal copy no longer promises automatic retry.
- Coordinator must retain mail-delivery errors until actual successful send, including queued/running retry jobs; selecting only terminal failed jobs clears errors too soon.
- Previously scheduled posts whose accounts later expire need owner handoff; they remain scheduled/held and do not appear in a failed-only follow-up query.
- Daily feed cap must count the effective destination date from socialSlot (tomorrow after active hours), including the daily pack and manual posts, rather than today's date alone.
- Direct social generation inside a successful coordinator stage retries costly failures every five minutes indefinitely. Reuse durable social.autoRun with optional activation payload and dailyJob atomic mark+enqueue, maxAttempts3, explicit run retry key; scheduling still retries independently over the deterministic saved pack.

Initial guard review confirmed fail-closed canRun billing/activation checks, social final check after media preparation, legacy/manual null provenance behavior, explicit manual social/article adoption clearing provenance, and additive calendar commit preserving proposals. PM separately identified old-proposal reactivation and program UPSERT/manual-schedule concurrency issues. These are review observations, not a final verification pass; QA owns independent behavioral evidence.

A2 final frozen-backend re-read: identified implementation findings above were addressed in code (bounded social jobs, target-date transactional publication cap, held-account handoffs, non-overwriting program upserts, reuse of ungenerated proposed topics across activations, same-job mail retry retaining error until completion, terminal retry wording, manual adoption, final activation/billing/feature-flag/pause checks). No additional backend blocker identified by this architecture pass. Remaining reported UX risk: owner email's correct-business API hop returns JSON 401 for a logged-out owner instead of a sign-in flow; PM notified. Architecture review does not substitute for independent QA or real-provider delivery verification.

PM integration resolution: the remaining logged-out handoff risk was fixed by E1. GET /api/b/current redirects anonymous visitors to sign-in with a canonical business-hop next; entryAfterAuth permits this exact validated hop, then existing membership/access and safe-destination gates apply. POST remains unauthorized without a session. Independent real-browser signed-out flow passed 3/3, including intended business restoration after login and rejection of arbitrary API destinations.
