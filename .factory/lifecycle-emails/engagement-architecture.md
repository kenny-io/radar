# Useful work update architecture

Confirmed workspace `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/lifecycle-emails`, starting revision `a96ebd9d`. Read the engagement brief and actual job/action/schema/route code. This record resolves the design for PM/engineer implementation; no runtime edits, provider calls, production mutation or deployment by the architect.

## Decisions

Use one optional `work_update` lifecycle message containing up to three actionable sections, not separate emails per scan/article. One per rolling24h per user across all businesses, 09:00–18:00 in the user's stable first-owned active business timezone (order createdAt then id). Existing user schema has no timezone, so do not claim this is a personal preference; Settings can explain business-local daytime. The normal dispatcher and cron remain the only execution infrastructure.

There are four source kinds but three explicit consent categories: `dailyBrief`, `calendarReminders`, `articleSocial` (the last covers article-to-social and social-pack scheduling). Defaults false, no retroactive source capture on opt-in. Persist per-category enabled time; events must occur after the relevant enabled time. An owner opts into useful work updates, not marketing growth promises. The35% figure is an internal target; exclude it from message copy and individualized forecasts. Existing billing/security behavior is unchanged. The founder note keeps its separate preference and shares the optional-email frequency cap.

## Shared contracts (freeze before implementation)

PM owns/export WorkUpdateSection with templates; preferences type may live in the backend-owned preferences module and be imported with `import type` by UI. No runtime server import in client:

```ts
export interface EngagementPreferences {
  dailyBrief: boolean;
  calendarReminders: boolean;
  articleSocial: boolean;
}
export type WorkEventKind = 'brief_reply' | 'calendar_review' | 'article_social' | 'social_publish';
export interface WorkUpdateSection {
  eventId: string;
  kind: WorkEventKind;
  businessId: string;
  businessName: string;
  ref: string;
  count: number;
  title?: string;
}
```

`LifecycleData` adds `workSections?: WorkUpdateSection[]`. `LifecycleType` adds `work_update`. Ref meanings are respectively brief day ISO, calendarGeneratedAt ISO, entryId and packId. Count is fresh actionable reply/plan/post count; article_social count=1 and title is the actual article title. Business names/titles are bounded and escaped. Templates derive fixed first-party links from typed IDs and render at most three sections with one primary action per section. Do not accept arbitrary URLs or private source text from persisted events. Subject can adapt to the first useful section, with a generic fallback when multiple businesses are included. Email footer identifies Radar/Fairspleet and reuses the existing public legal-page mailing address, `348 Business Bay, Dubai, UAE`; no invented address. Optional unsubscribe identifies work updates only; founder onboarding preference remains separate.

Backend-owned `src/server/services/lifecycle/engagement.ts` exports:

```ts
recordWorkEvent(q: Q, input: {
  kind: WorkEventKind; businessId: string; sourceKey: string;
  sourceRef: { date?: string; generationAt?: string; entryId?: string; packId?: string; initialEntryIds?: string[] };
  occurredAt?: Date;
}): Promise<void>;
collectWorkUpdates(now?: Date): Promise<{ queued: number }>;
prepareWorkUpdate(row: LifecycleEmailRow, payload: LifecyclePayload, now: Date): Promise<
  | { kind: 'send'; payload: LifecyclePayload }
  | { kind: 'defer'; until: Date }
  | { kind: 'suppress'; reason: string }
>;
```

`prepareWorkUpdate` is called under the dispatcher's existing global delivery advisory lock, before marking the first provider attempt. It checks preferences, recipient, current business ownership/active status/access and source state. On attempt0 it drops resolved sections, rebuilds the message from fresh state and durably freezes that final encrypted provider body **before** attempt1. On attempts>0 it never changes any provider body/key; if included source state/preference is no longer applicable, suppress the whole retry. A cap/quiet-window deferral changes nextAttemptAt without increasing attempts, not terminal suppression. Expired/no-section message suppresses. Protect provider idempotency retention and existing bounded retry window.

Preferences in existing `preferences.ts` (backend owned):

```ts
getEngagementPreferences(userId: string): Promise<EngagementPreferences>;
updateEngagementPreferences(userId: string, patch: Partial<EngagementPreferences>, now?: Date): Promise<EngagementPreferences>;
stopWorkUpdates(userId: string): Promise<void>;
workPreferenceToken(userId: string): string;
workPreferenceUser(token: string): string | null;
```

Use HMAC domain separation `radar-work-optout:${uid}`; never reuse onboarding signatures as work-edit authority. Signed token can disable optional work updates only, never opt in or affect billing/security. Authenticated user API `/api/me/email-preferences` GET/PATCH reads/updates only currentUser id; patch validates only the three booleans and ordinary auth-origin/body limits. GET cannot mutate preferences. Signin account details/settings do not become workspace-admin scoped.

## Data ownership and delivery atomicity

Add migration0010, preserving0009. Extend `user_email_preferences` with three booleans false and three nullable enabledAt timestamps. `updateEngagementPreferences` changes enabledAt only false→true; repeated true saves retain original consent time. Turning a category off nulls its enabledAt; re-enabling captures only newer events.

Add `engagement_events`:

- id UUID primary key; userId/users FK cascade; businessId/businesses FK cascade.
- kind text; sourceKey text unique; sourceRef bounded JSON with reference IDs/dates only.
- occurredAt, eligibleAt, expiresAt, createdAt timestamps.
- lifecycleEmailId nullable FK lifecycle_emails (on delete set null is unsafe if it permits resubmitting an already sent event; prefer restrict, or keep immutable consumedAt alongside it).
- resolvedAt nullable + resolution reason (`queued`, `acted`, `stale`, `opted_out`, `access_lost`) prevents replay even if an associated email is later deleted.
- due partial index on eligibleAt where resolvedAt IS NULL, plus userId due lookup.

`recordWorkEvent` gets recipient from the persisted active business owner, not caller email or selected-business cookie. Only real owner users with explicit eligible consent at occurredAt are captured. The sourceKey includes business ID; stable examples below ensure no rewrite/approve replay duplication. No customer text, bearer URLs or email addresses in sourceRef.

Inside the existing cron lock, collector locks eligible pending source rows, reevaluates eligibility, chooses at most three sections (prefer one per kind, earliest-expiring first; do not repeat three article prompts), queues `work_update`, and resolves/associates only included source rows in the same transaction. Digest event key `work-update:${userId}:${UTC-day}` prevents cron replay. Do not resolve eligible but unselected candidates; cap may allow them tomorrow if still fresh. Sender cap checks all other work-update rows with actual firstAttemptAt/sentAt within24h, including ambiguous provider outcomes; exclude the current row's own retries. Planner checks caps early; dispatcher checks again atomically against delivery lock.

No new service, dependency, hosted templates or external scheduler. Register `engagement.collect` through existing `defineCron`, imported by `jobs/all.ts`. Bound each cron pass (e.g.100 eligible owners and max3sections/owner) and paginate by pending due index, not full article JSON scans over all tenants. Failures retain events/outbox; log IDs/kinds/counts only.

## Source hooks and missing-next-action rules

### Daily Brief

Event kind `brief_reply`. Code: `brief/scan.ts` save path; `store.createDay` currently does `onConflictDoNothing`, with no transaction parameter. Wrap first successful day insert and source event capture in one tx, using optional `Q` support in store if needed. Capture only successful initial day insertion with at least one `kind:'reply'`, `st:'open'` item with a real conversation URL. Posts are not conversations. Do not mail empty/failing runs, handled `result.failed`, `mode:'again'`, keep runs or every2h background rescan. Key `brief:${bid}:${date}`; sourceRef date; eligible+1h; expiry at end of that business date (not a stale next-day opportunity).

The latest owner correction changes the original30min batching to **one hour** of no action. If any reply in that day's generation is copied, posted or scheduled/sending, suppress the whole day reminder; do not nag about the remaining replies. Raw brief items store copied/posted; projected scheduled state lives in `social_pubs` sid `b:${date}:${item.id}`. Also treat any successful stored publication as engagement. To make suppression permanent even if a copied item is later edited back to open, mark matching source event resolved on these actions in the same state transaction, rather than relying only on the eventually written analytics log. At send, require day==today, replies remain actionable, and no persisted action/publication evidence.

### Calendar

Event kind `calendar_review`. Code: `calendar/jobs.ts` already has tx inserting proposed entries and updating business.calendarGeneratedAt. Capture event there, including IDs of this generation's inserted proposed entries. Key `calendar:${bid}:${generationISO}`; eligible+24h; expiry+7days. Match current business.calendarGeneratedAt at collect/send so regeneration retires old plans.

Owner correction: **any real approval/scheduling action for an entry in this generation resolves the whole plan reminder**, rather than continuing to nag remaining topics. Resolve event when calendar.approve/approveAll actually change >=1 matching rows, and article.approve schedules/approves a matching generated entry. Use actual changed rows/IDs, not attempted no-op requests or unrelated prior-calendar entries. Current status fallback: any initialEntryId advanced out of proposed/draft/review into approved/scheduled/publishing/published suppresses; deleted/no-actionable future/current rows suppress. Manual review only; no35% promise. A generated plan waits once, not recurring weekly reminders.

### Article → social

Code: `drafting/jobs.ts` final successful tx stores articles.data generated:true and status review/scheduled; `actions/article.ts` article.approve tx can status approved or scheduled. Call the same recording helper from both only for an actual generated article. Key `article-social:${bid}:${entryId}` (not draft job ID or draftedAt) gives one suggestion across generation, approval, rewrites and webhook/action replays. Eligible+2h; expiry+7days. Do not capture plain topic approval before a real body exists.

Require source article still generated, allowed status review/draft/approved/scheduled/publishing/published as applicable, owner still has access and no existing socialPacks.data.source `{kind:'article',ref:entryId}` for the same business. Creating such a pack immediately resolves this event. A mere calendar topic or failed drafting attempt produces no suggestion.

### Social pack → schedule/post

Code: `social/generate.ts:createPack` persists fully generated socialPacks row; capture in same tx as insert. Key `social-publish:${bid}:${packId}`; sourceRef packId; eligible+2h; expiry+7days. Uses `articleSocial` consent. New fourth kind, not a fourth consent toggle.

Require pack still exists and has actionable supported posts. Suppress whole pack reminder when any pack post is scheduled/sending/posted, or a persisted manual-used/copied state signals completion. Authoritative publication state is `social_pubs`, src='pack', sid built with `packSid(packId, platform)` from `lib/socialPublish.ts`, status scheduled/sending/posted. Do not invent posts published externally if Radar has no evidence. Exclude already automatic-scheduled packs and completed auto-generation flows. Creation of an article-sourced pack resolves article_social and starts this separate next-action timer, but the24h digest cap prevents a follow-up barrage.

## Actual business-switch deep link

Existing `/brief`, `/calendar`, `/article/:id` and `/social` routes read the radar_biz cookie; appending a business query does not select it. Existing `/api/b/current` GET can select a business but returns auth JSON when signed out. Therefore introduce UI-engineer-owned `/email/open` landing handler, not an app-layout page:

`/email/open?businessId=<uuid>&kind=brief_reply|calendar_review|article_social|social_publish&ref=<date|generationISO|entryId|packId>`

- Validate bounded shape and fixed kind enum; no arbitrary target URL.
- If not signed in,303→`/signin?next=<encoded same-site /email/open path+query>`; signin's existing next flow returns here.
- Verify current user's actual membership/Editor action permission and business access; names/IDs in mail never grant access. Recipient may own several businesses; session may currently have another business selected.
- Validate requested article/pack belongs to this business. Map social_publish/ref to `/social?pack=<packId>` and article_social/ref to `/social?generate=1&article=<entryId>`. brief_reply and calendar_review use `/brief` and `/calendar`. The latter refs validate date/generation but are not arbitrary target URLs.
- Set current business via existing `setCurrentBusiness`, then303 to fixed target. Locked account follows ordinary trial/recovery flow without a foreign-business cookie change.
- UI engineer adds article preselection to SocialFlow when route has generate+article; verify article against loaded selected business entries. Do not spend provider tokens or generate posts just by following the email link.

## Ownership / order

1. Backend engineer owns schema/migration0010, preference types and preferences.ts, engagement.ts, source hooks/action resolution, cron registration, dispatch integration and meaningful backend tests.
2. UI engineer owns authenticated `/api/me/email-preferences` endpoint, Settings email category/panel, optional work preference GET/POST UI, `/email/open` landing handler, SocialFlow article-source preselection, browser loading/save/error/accessibility. Coordinate exact helper names above before edits. Public token route remains POST-only for opt-out; GET displays form without mutation. A signed opt-out cannot enable a category. Use existing standard header/body origin rules; no account settings other than these toggles.
3. PM owns templates.ts/template tests, local preview generator, final copy/brand presentation, records and PR integration. Shared WorkUpdateSection above is the renderer contract; importing types must not pull server code into client.
4. Independent QA derives scenarios from engagement/brief.md, verifies integrated source, actual browser Settings/deep-link/mobile/keyboard and source-to-dispatch states. No live sends, billing actions, account settings or deployment.

## Meaningful acceptance cases

- Initial reply-bearing brief+1h unopened gives one source; any copy/post/schedule suppresses even if only one of several replies. All-source failure, zero replies, posts-only, rescan and retry create no duplicate.
- Calendar generation+24h still proposed gives one reminder. Any matching approval resolves whole plan. No-op approval and approval of an unrelated kept entry do not. Regeneration supersedes old reminder.
- Real article generates once, then approves or rewrites: one article_social candidate; creating same-business article pack suppresses; foreign pack cannot suppress it. Ungenerated topic cannot generate suggestion.
- New pack unacted+2h gives scheduling section; any scheduled/sending/posted publication suppresses. Failed publication remains a real next action, not a false posted claim.
- Three simultaneous kinds→one digest≤3sections; events across businesses respect same user's rolling24h cap; no body changes after attempt1; cap defers rather than drops. Quiet-hours/DST/date rollover and brief expiry work correctly.
- All categories initiallyoff; explicit single-category opt-in persists consent time; no old source backfill. Opt-out between queue/send suppresses only optional update and no security/billing event. Unknown/signed-forged token cannot mutate others.
- Signed-out link preserves target through signin; wrong current business switches only after actual authorization. Foreign article/pack or removed owner permission gives no private preview/access. Social CTA opens chosen existing article without generation/network side effect.
- Migration empty and upgrade, queue rollback atomicity, concurrent collectors/globaldispatch, provider429/timeout retry immutable payload, last useful section resolved→suppressed. Audit/logs contain no customer body/credentials.

## Limits / rollback

A copied reply or platform-scheduled post is observable; external engagement outside Radar cannot be inferred. Do not call these emails proof of growth or readership. Defaultoff means no launch broadcast and requires users to choose categories. On rollback stop new dispatcher/cron before reverting matching web+worker; retain additive tables. Existing billing/recovery provider behavior must retain prior semantics. No consequential product question remains after PM-approved digest/cadence/source contracts; implementation details such as helper splitting can be resolved by the backend owner without changing these user-visible rules.

Final naming reconciliation: PM owns the exact WorkUpdateSection shape above in templates.ts; backend's agreed authenticated preference helpers are `getEngagementPreferences` and `updateEngagementPreferences`. Public work-token helper names can follow backend's established naming, but UI must import the actual exported functions rather than duplicate signature logic. Digest delivery priority follows security/billing and founder messages; it must never starve password recovery. All new product notices are optional, and all four source kinds share the same daily cap.


## Final implementation reconciliation

The source implementation splits the preparation contract into `currentWorkSections(row,payload,now)` plus `optionalDeliveryAfter(userId,now,excludeId,q)`, with first-attempt payload freezing owned by dispatch.ts. Source capture is named `recordEngagement(q,{businessId,kind,ref,entryIds?,now?})`; the stored sourceRef is `{ref,entryIds?}`. `resolveEngagement` and `resolveCalendarForEntries` permanently retire sources at action boundaries. Public preference helpers use getEngagementPreferences/updateEngagementPreferences, matching the settings and backend handoffs. Due events deferred by quiet hours/caps/active queues or an already-used UTCday key advance their eligibleAt so they cannot monopolize the bounded collector page. The startup read-only schema guard handles worker/web migration order without adding a second migrator. These names and handoffs supersede earlier design sketches above.
