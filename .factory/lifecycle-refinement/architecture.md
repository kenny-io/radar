# Lifecycle refinement architecture (LC2-A)

## Confirmed scope and starting point

Workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`, inspected clean at `f616862c7dcefb1aabec9155972466f7b3aeaf36`; PR25 remains open/unmerged. Read `.factory/lifecycle-refinement/brief.md`, prior weekly architecture/inventory, actual sender/state/schema/GSC code, and `/Users/ekene/.agents/skills/emails/SKILL.md` plus its sequence-templates, copy-guidelines and email-types references. No product-marketing context file was found in this workspace. Architect owns this record only; no runtime, original-checkout or provider mutation.

Preserve default-on verified registered cohorts, explicit opt-outs, footer management, five finite weekly lessons, existing ownership/access checks and native provider suppression. Do not revive workspace-ready. The seven drafts become five existing-event replacements/aliases plus two genuinely new one-time guides, not seven additional campaign messages. References to the prior editorial-only status must be updated once implementation is verified.

## Seven-draft schedule: actual mapping

| Earlier draft | Runtime mapping | Entry / delay | Exit / duplication rule |
|---|---|---|---|
| Put your Business Profile to work | Replace `welcome` content, retaining `welcome:${uid}` event | Genuine verified account confirmation/new verified Google account, immediately as existing welcome; analyzed-profile branch continues from saved profile, neutral incomplete-profile branch | No second welcome, signup-age backfill or message on ordinary signin. Existing welcome history remains authoritative |
| Why we built Radar | Existing `founder_note`, retaining `founder:${uid}` | Same new account event, nominal+24h; cap/daytime may defer | One founder note, existing onboarding preference; do not add another story or resend to historical users |
| Would an AI assistant recommend your product? | Rewrite existing `weekly_education` lesson `ai_visibility` | Existing first lesson at enrollment during daytime | Keep course version1/order/event keys/progress; no separate AI nurture send |
| Find one conversation you can help with | Rewrite existing weekly lesson `daily_brief` | At least7days after preceding lesson's provider acceptance | No extra Brief introduction or conditional work-source reminder; normal course continues across billing stages |
| Read the sentence before you agree to the link | Rewrite existing weekly lesson `backlinks` | At least7days after preceding lesson acceptance | One course lesson, optional network choice remains explicit; no separate backlinks campaign |
| What happens before an article goes live | New `lifecycle_guide`, ID `article_workflow` | First observation of a usable primary OWNED profile: accessible active workspace+24h; saved pretrial/lapsed profile+3days. If workspace access becomes available before send, shorten due to min(existingDue,now+24h), never postpone | One/account, skip when any OWNED business has already begun meaningful article workflow. Paid/trial status alone does not suppress. No topic-generation completion notice |
| Your next article might be a page you already have | New `lifecycle_guide`, ID `search_refresh` | Observe real measured Search Console page data on the primary owned business after Organic Search lesson has actually been accepted; due=max(firstObservation+24h,organicAcceptedAt+7days) | One/account, no guide based on empty/unconnected search data; no recurring page-two campaign or unverified individualized opportunity claim |

Weekly Organic Search remains a useful topic/research/calendar lesson, distinct from early review-first article workflow and later existing-page refresh investigation. Social Marketing remains the fifth core lesson. No version bump, reset or forced replay of an already-sent feature introduction. Historical first-draft subjects are copy references, not extra send identities; PM owns revised subjects.

## Available authoritative data and exact relevance

`users.emailVerifiedAt`, current non-guest identity, persisted preferences and existing `educationContext` provide account eligibility and deterministic primary owned-business context. Primary selection remains earliest active owned business (createdAt,ID), otherwise newest owned onboarding draft. An analyzed/saved usable profile or active workspace is required for either guide; member-only generic course recipients do not receive owner setup guidance using another owner's data. Match active membership and ownership at collection/send.

For article workflow, a generated article OR a calendar entry in `approved`, `drafting`, `draft`, `review`, `scheduled`, `publishing` or `published` in ANY owned business proves the owner has already started the taught workflow and retires the guide. Mere `calendarGeneratedAt`, proposed topics, a draft profile or automatic topic generation does not. A failed entry by itself is not successful workflow evidence. Already-experienced owners are skipped with a durable reason rather than mailed a beginner guide for each business. Pretrial/lapsed copy explains the future activation prerequisite and uses the existing trial/restart gate, never claims drafts already exist.

GSC evidence: `gsc_connections` has `status`, `property`, `lastSyncedThrough`, `updatedAt` and a backfill cursor; it has NO connectedAt or first-data timestamp. `updatedAt` changes on progress, daily sync and errors (`gsc/sync.ts:16`), so it is not a connection-time anchor. `runBackfill` finishes by setting connected; incremental sync updates lastSyncedThrough. Do not add a false semantic timestamp based on these writes.

For refresh readiness require current primary owned business, GSC `status='connected'`, nonempty property, non-null lastSyncedThrough, and an indexed EXISTS on `gsc_rows` for that business, kind `page`, impressions>0 and date in the last28completed business-local days. Exclude future/current-day rows. This proves measured pages exist, not that any particular page deserves a refresh. Use the existing `(business_id,kind,date)` lookup index. No remote Google call, token read or full GSC JSON scan. Also require the exact user's version1 Organic Search outbox event `education:v1:${uid}:organic_search` with status `sent` and non-null sentAt; planned date, firstAttemptAt or stub `logged` is not accepted. Capture the guide only after BOTH facts exist, then record observation time as now. This lets old course completers with current GSC data enter safely at rollout+24h instead of a historical connection-time burst.

At send, recheck those facts for the same source business and the >=7day Organic Search gap. A temporary GSC error/stale or missing data defers the unattempted guide for a bounded daily recheck until expiry; it never produces an empty personalized opportunity. Ownership loss, deleted source or primary-business mismatch skips an unattempted guide; after provider attempt block/suppress instead of changing identity/body. Do not silently rebind one captured guide to a different business. No paid-access requirement is added to delivery: lapsed/pretrial owners with retained measured data receive truthful public educational guidance. Opening private app data still uses normal current authorization.

## Runtime contract and ownership

PM owns `src/server/services/lifecycle/guideContent.ts`:

```ts
export const GUIDE_IDS = ['article_workflow', 'search_refresh'] as const;
export type GuideId = typeof GUIDE_IDS[number];
export interface GuideContent {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  steps?: string[];
  progress?: string;
  ctaLabel: string;
}
export function renderGuide(id: GuideId, context: EducationContext): GuideContent;
```

Reuse the bounded plain-text `EducationContext` contract; content returns no HTML/URL/private source data. PM also adds required `preheader:string` to `EducationLessonContent`. Engineer owns the interface/template plumbing first, then hands shared template text to PM for a serial copy-only edit. `RenderedLifecycle.preheader?:string` remains backward-compatible. Escape preheaders and render a conventional hidden HTML preheader; preserve readable plain text rather than exposing hidden HTML artifacts. No tracking pixels, new dependency or hosted template.

Add lifecycle type `lifecycle_guide`, `LifecycleData.guide?: {version:1;id:GuideId;context:EducationContext;businessId?:string}`. The lifecycle row is account-owned, with businessId NULL (source ID is inside the encrypted snapshot/state). This avoids source business deletion cascading outbox history. Runtime builds fixed first-party CTA URLs: article-workflow workspace→the existing safe calendar/learning landing, pretrial/lapsed→existing trial/restart route, setup→onboarding; search-refresh→existing public `/blog/page-two-refresh` guide. If extending `/email/learn`, admit only an explicit allowlisted guide/calendar route; never generic next/URL authority. The public refresh CTA does not need or include a private business ID. At click time membership, selected business and billing gates remain authoritative.

## Durable guide state and collection

Add `lifecycle_guide_states`, composite PK `(userId,guideId)`, users FK cascade; guideId allowlist above, firstObservedAt, dueAt, nullable expiresAt or equivalent bounded window, nullable pendingEmailId FK RESTRICT to lifecycle_emails, status `waiting | queued | sent | skipped | blocked`, nullable sourceBusinessId (FK SET NULL accepted), reason and updatedAt. Include sentAt or use linked sent outbox for acceptance evidence. A waiting due index supports bounded collection. The source reference is a UUID only, no names/email/query text/Google token. A deleted source sets NULL but never recreates the same guide; null or mismatched source is terminal as described above. RESTRICT must align in schema/migration/snapshot and pass both isolated pending-mail deletion rejection and full user cleanup after normal owned-business cleanup (prior education FK QA proved this pattern).

Stable event keys: `guide:v1:${uid}:article_workflow` and `guide:v1:${uid}:search_refresh`. The state row is a durable tombstone; deleting an old business, retrying cron, toggling preferences or finishing a course never reenrolls a sent/skipped/blocked guide. Do not share education_enrollments.nextLesson or count a guide as a course step.

Engineer-owned `guides.ts` exports bounded `collectGuides(now?,onlyUsers?)`, `prepareGuide(row,payload,now)` with existing send/defer/suppress union semantics, and acknowledgment/block helpers taking caller Q. Use per-account advisory/row locking plus unique PK/event keys so concurrent direct collection is safe outside cron. Each pass is bounded (e.g.100 source candidates/100 due rows), indexed database lookups, not all-user profile/measurement loading. Register one hook via existing lifecycle jobs; no GSC source transaction change is necessary. Recheck eligibility in the transaction that inserts state and queue. Persist state assignment and outbox insert together.

For both new and existing users, firstObservedAt is the first eligible observation AFTER this feature is running, not account creation, verification date, old course creation, business creation or GSC updatedAt. A new article guide uses +24h or+3days from this observation. Meaningful prior work can immediately create a skipped tombstone or be permanently skipped at the first due check. Search capture begins only once the accepted Organic Search lesson and real current GSC data exist. New-source first observation is not a claim of when an external connection originally occurred. No historical bulk backfill; no enqueue of both guides merely because the account is old.

When due, queue its one pending outbox row EVEN if capped/quiet, sendAt=optionalDeliveryAfter(...) or now. This makes guide priority effective and prevents daily work reminders from winning every next slot. Guides use a30day unattempted delivery window from due/queue and the existing23hour/MAX8 provider retry window after first attempt. Valid provider acknowledgment and guide status=sent commit atomically with the claimed outbox sent transition. Attempts/failed/suppressed/expired/ambiguous outcomes never count as sent; block the state without fresh keys or automatic replays. Stub logging remains explicit simulation and does not satisfy Organic Search's accepted prerequisite. Freeze rebuilt context/body before first provider attempt; after attempt reuse exact envelope/key or suppress unsafe retry. Never mass-update encrypted attempted bodies during copy refinement.

## Preferences, priorities and failure behavior

Both guides reuse effective education permission (`education ?? onboarding ?? true`), existing education HMAC token/footer/one-click unsubscribe and `RADAR_EDUCATION_EMAILS` runtime flag. Do not introduce another opt-in, preference category, bearer scope or secret. Course completion does not turn off guide permission; a blocked course still cannot satisfy a missing Organic Search acceptance prerequisite. Default-on work and historical persisted false handling are unchanged.

Off/flag pause for an unattempted captured/queued guide retains its state/event/body identity and extends/defer first-attempt expiry as needed, following course pause semantics. On explicit re-enable resume eligible remaining guide work under original due delay and cap; do not reset sent/skipped/blocked history. Opt-out after a provider attempt blocks/suppresses that pending guide rather than reopening outside dedupe retention. Query effective allowed recipients before bounded pages so opted-out/waiting accounts cannot monopolize collection. A flag/preference pause must not make legitimate waiting guides expire solely because the account was paused.

Extend shared optional type checks/cap queries to `lifecycle_guide`, including ambiguous first attempts. Exact priority: essential security/time-sensitive billing/other transactional mail first; due weekly education next; due one-time guides next; founder note next; work reminders last. The founder retains nominal+24h schedule but may be delayed by the shared cap. Article workflow's24h workspace guide takes the early trial slot so it remains useful during the3day trial. Two finite guides cannot permanently starve founder/work. Weekly course retains its reserved next eligible slot, >=7days between actual lesson acceptances, five steps then completion. Search guide's organic+7day time can coincide with Social Marketing; the weekly lesson wins, refresh guide follows in a later allowed slot. Never waive rolling24h or daytime to satisfy multiple nominal due times.

Apply the existing bounded suppression preflight and narrowly validated401 `restricted_api_key` native-enforcement fallback to guides as to education. Valid recipient suppression stops, unknown/invalid/malformed/unavailable lookup defers, no expanded key privileges. Recheck preferences/recipient/authorization after any network lookup before POST. Provider acceptance is not delivery. Use sanitized reason codes/IDs/counts only; no email body, bearer link, GSC token or raw provider text in logs. Retain request pacing and security priority.

## Copy, compatibility and delivery

PM's rewrite covers the26 user-facing variants in the current inventory plus the2new guides; internal support/feature forward payloads remain operational. Alias drafts do not inflate the send count. PM owns content/previews/catalogue, legacy sender wording and bounded original-checkout AI-report companion; engineer owns runtime/schema/contracts/API/landing and meaningful scheduling tests. QA independently verifies rendered artifacts and behavior. All agents preserve concurrent edits and coordinate shared templates serially.

Use the installed email/copy skills as editorial guidance, not a license to add skill-template promotions, discounts, testimonials or unsupported results. One purpose/primary action, short paragraphs, meaningful preview text, first-person founder voice where natural. Preserve approved founder rationale, exact billing values/dates, security expiry/one-use semantics, actual posting/review behavior and backlink qualifier/disclosure/placement distinctions. Positive defaults never mean consent to the separate research study. No fake Re:/Fwd:, invented urgency, guarantees, contrast-reveal prose or placeholder metrics. No alternate security link/expiry or sender authority invented by copy.

Append a migration after canonical0012; do not rewrite existing applied lifecycle/security migrations or reorder history. Extend read-only worker readiness to guide fields so worker rollout cannot claim against old schema. No migration-triggered sends. Keep existing keys/course enrollment version/sent progress and all queued or attempted legacy rows. New template copy applies to newly rendered mail and safe first-attempt refresh paths only; do not resend prior messages to deliver revised wording.

Implementation order: freeze this contract and guide/preheader plumbing; migration/readiness/state/collector/dispatch/tests; hand template copy to PM; PM rewrite/render previews and companion patch; independent QA/build/typecheck/inventory then reviewable PR25 update. No provider POST, production mutation, merge or deploy in this task. Release resumes existing education flag only after approved matching migration/web/worker; rollback pauses the flag/collector and preserves states/outbox, never resets event keys or disables mailbox verification.

## Required validation

- Assert all seven exact draft mappings, one welcome/founder, unchanged five course keys/order/progress, retired workspace suppression; no extra AI/Brief/backlink campaign.
- New and old verified pretrial/workspace/lapsed cohorts get logical first-observation delays: pretrial3days, workspace24h, later access shortens but never postpones; no pre-feature source-age burst. Proposed topics alone do not suppress; any owned meaningful workflow/generated article does.
- GSC missing/disconnected/error/empty rows/zero impressions/stale/future data do not qualify. Current connected measured page data plus actually accepted Organic Search qualifies at max(observation+24h,organic+7days); no assumption that updatedAt means connection time. Stub logged Organic Search does not qualify.
- Concurrent collectors/dispatcher, replay, unique state/event, cap/daytime including DST, daily work load, founder collision, Social Marketing/refresh collision,5step completion and two guides independently once.
- Preference/default-on/legacy false, off/on unattempted pause with original delay, attempted opt-out, partial rollout/readiness, provider suppression/restricted sending-only fallback, retry ambiguity/expiry and crash after acknowledgment preserve history and frozen bodies.
- Removed/foreign/mismatched owned business, email change/unverified recipient, member-only neutral course, authorized pretrial/lapsed CTA gates, public refresh guide and no cookie mutation before authorization.
- New-table direct referenced-outbox deletion fails; user cleanup succeeds; clean and upgrade migrations. Render all HTML/plaintext/preheaders at mobile/desktop; long names, control characters and HTML text escape safely; all user-facing footer links and required billing/security copy remain accurate.
