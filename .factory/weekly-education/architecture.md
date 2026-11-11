# Weekly education architecture

## Scope and verified starting point

EDU-A1, architect-owned record only. Workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`, inspected clean at `5183db55d46c75f2e8f5a317b69488c698822e2e`. Read the weekly brief, lifecycle state/architecture, engagement contracts and actual schema, scheduler, dispatcher, preferences, auth and product UI. The PM subsequently authorized integration of current main; the runtime engineer reports merge `bed41631`. Runtime implementation belongs to that engineer, copy/previews to PM. No provider sends, production writes, merge to main or deployment are authorized here.

The weekly brief supersedes old nurture restrictions: enroll existing and new verified registered users across pretrial, trial, paid, complimentary and lapsed states. Five lessons then complete: AI Visibility, Daily Brief, Backlinks, Organic Search, Social Marketing. Do not stop because a trial starts, payment succeeds or a feature has already been used. Guests, unverified mailboxes, opt-outs and suppressed recipients remain excluded.

Use the existing minute cron, PostgreSQL and encrypted lifecycle outbox. No dependency, service, provider-hosted automation or new infrastructure. Existing files: `src/server/services/lifecycle/{queue,dispatch,engagement,preferences,templates}.ts`, `src/server/jobs/{cron,all}.ts`, `src/server/db/{schema,workerReady}.ts`.

## Shared copy contract (accepted by PM)

PM owns `src/server/services/lifecycle/educationContent.ts`:

```ts
export const EDUCATION_LESSONS = [
  'ai_visibility', 'daily_brief', 'backlinks', 'organic_search', 'social_marketing',
] as const;
export type EducationLessonId = typeof EDUCATION_LESSONS[number];
export interface EducationContext {
  businessName?: string;
  industry?: string;
  offering?: string;
  audience?: string;
  keyword?: string;
  gscConnected: boolean;
  access: 'workspace' | 'start_trial' | 'restart' | 'setup';
}
export interface EducationLessonContent {
  subject: string;
  heading: string;
  paragraphs: string[];
  steps: string[];
  ctaLabel: string;
}
export function renderEducationLesson(
  lesson: EducationLessonId, context: EducationContext,
): EducationLessonContent;
export function educationProgress(lesson: EducationLessonId): string;
```

This is pure plain text, not HTML. Render exactly two numbered actions followed by the progress paragraph. Template plumbing imports this contract, escapes all user text, bounds values and owns the first-party CTA URL, branded frame, reply address, company/address footer and education unsubscribe. No arbitrary URL enters the content contract.

Add lifecycle type `weekly_education` and optional `LifecycleData.education`:

```ts
{ version: 1; lesson: EducationLessonId; context: EducationContext; businessId?: string }
```

This is the encrypted payload snapshot, not client input. Validate version, lesson allowlist, access enum and field limits before rendering/delivery. Preserve nine core lifecycle events plus work updates and their existing contracts.

## Enrollment, state and cadence

Add one `education_enrollments` row per `users.id` (PK/FK cascade), version fixed to 1, `nextLesson` integer 0..5, `nextDueAt`, nullable `lastAcceptedAt`, nullable `pendingEmailId`, status `active | paused | blocked | completed`, nullable reason, `enrolledAt` and `updatedAt`. A due index covers active rows ordered by nextDueAt/userId. `pendingEmailId` is a lifecycle FK with RESTRICT, not cascade or SET NULL that silently reopens a consumed step. Keep enrollment history through pauses/re-enables; deleting a customer cascades their history normally. Do not use business-level enrollment.

Backend-owned `education.ts` implements bounded enrollment/collection plus preparation and acknowledgment helpers. Signatures can follow existing engagement style:

```ts
collectEducation(now?: Date, onlyUsers?: string[]): Promise<{ enrolled: number; queued: number }>;
// Under dispatch lock; pre-provider attempt context can be refreshed.
prepareEducation(row, payload, now): Promise<
  | { kind: 'send'; payload: LifecyclePayload }
  | { kind: 'defer'; until: Date; reason: string }
  | { kind: 'suppress'; reason: string }
>;
// Called in the SAME transaction as marking the claimed outbox row sent.
acknowledgeEducation(q: Q, row, acceptedAt: Date): Promise<void>;
```

Cron discovers verified non-guest users with no enrollment and effective education permission. Existing users start at collection time, never at account creation or a historical campaign week. First due time is enrollment time; actual first mail waits for daytime and shared cap. New users are found by the same job after mailbox verification, avoiding fragile hooks in every signup path. Bound each pass (e.g.100 enrollments and100 due accounts), use indexed joins/anti-joins rather than loading all profiles, and order deterministically. Include old-created accounts verified recently. Repeat cron/concurrent calls must be safe outside cron's advisory lock too: row/transaction locks plus unique enrollment and outbox event keys.

Queue at most one pending lesson per account, key `education:v1:${userId}:${lesson}`. Link it to enrollment atomically with enqueue. Do not queue all five or compute due times from signup age. Use a30-day first-attempt TTL for education, retaining the existing23-hour post-first-attempt retry deadline/MAX8 attempts; the generic3-day queue TTL is too short for downtime or optional-cap delays. First-attempt expiry is an explicit blocked condition, not a fresh key or step skip.

On valid provider acknowledgment, atomically mark that claimed outbox row `sent`, persist provider ID/accepted timestamp, increment the corresponding enrollment's nextLesson, clear pending ID, set `lastAcceptedAt=acceptedAt` and `nextDueAt=acceptedAt+7*24h`. After step5 mark completed. Compare enrollment pending ID and lesson before updating. This is provider acceptance, not proven delivery/inbox placement. Delayed collection and retries cannot create catch-up bursts. Use real acknowledgment time (injected clock in tests), not original planned time.

Provider-accepted-but-DB-crashed requests retry with the same frozen body/key, then acknowledge once. Exhausted/ambiguous delivery, invalid payload, recipient change after attempt, unsafe retry context or expiry blocks enrollment with a code-only reason. Never advance on failure, recreate a terminal lesson under another key, or automatically replay beyond provider retention. Operator inspection is required for an ambiguous blocked step. `logged` remains explicitly simulated, never provider acceptance; stub tests can record simulation progression separately or assert no production progression.

## Consent, recipient suppression and shared cap

Add nullable `user_email_preferences.education`, default NULL. Effective value is `education ?? onboarding` (missing onboarding row means true). This honors historical optional setup opt-outs without coupling an explicitly selected education preference to future founder settings. An authenticated deliberate `education:true` can override inherited false; signed opt-out can only set education false. Do not infer work-email opt-outs as education opt-outs: those categories already default false and represent separate consent.

Use a dedicated authenticated `/api/me/education-preferences` GET/PATCH contract `{ education: boolean }` to preserve the existing work-preference API shape. Retain strict key/boolean validation, origin/body limits, current-user-only scope and private/no-store. Settings adds an independent education preference component; education flags never enter work source-consent timestamps. The switch explains the five-lesson, at-most-weekly sequence. Billing, security and three work categories are unaffected. This is the engineer's accepted narrower compatibility refinement to the initially proposed shared endpoint extension.

Education token format `${uid}.education.${HMAC(secret,'radar-education-optout:'+uid)}` with timing-safe verification; reuse secret management, not founder/work signatures. Extend existing signed preference page/form and POST endpoint. GET never mutates. RFC8058 URL-token POST validates the same fixed bounded form body as work unsubscribe, and disables education only. Include `List-Unsubscribe` and `List-Unsubscribe-Post` headers. Disabling pauses enrollment and queued unsent steps remain ineligible. Retain and defer an unattempted pending row while paused; do not let its first-attempt TTL expire solely from the user pause. On explicit re-enable reset its due/first-attempt expiry and refresh context before attempting the same pending ID/event key. If a pending row was already provider-attempted, cancellation must suppress/block it rather than reopening after23h. Re-enabling resumes the remaining step at max(now,lastAcceptedAt+7days), never resets completion or unblocks ambiguous failed delivery.

No local provider bounce/complaint mirror exists. PM accepted the smallest direct suppression check for education only: bounded authenticated GET `https://api.resend.com/suppressions/{encodeURIComponent(currentEmail)}` before a send. Matching valid suppression stops/pauses enrollment with `provider_suppressed`, no provider POST. A documented absence404 permits. Invalid200 response, timeout,429,5xx,401/403 or any other uncertain result defers fail closed with code-only diagnostics, no firstAttemptAt or provider-attempt increment. Authentication/config failures should back off visibly rather than hot-loop; release must verify existing key read permission. No key changes, suppression removal or webhook provisioning in this task. Never print address-bearing URL or provider body. Native provider suppression remains the final boundary against races after preflight.

Extend `optionalDeliveryAfter` and dispatch optional-type checks to education. All founder/work/education mail shares at most one initial provider attempt per rolling24h across businesses; ambiguous attempts count, current-row retries excluded. Enforce under existing global delivery advisory lock424251. Daytime remains09:00–18:00 in stable earliest active owned business timezone; education-only fallback can use owned draft timezone, otherwise UTC. Invalid zones fall back UTC. Existing founder/work behavior should not change inadvertently. Every provider GET and POST counts toward rate limits; pace each request at125ms, so added preflight cannot double existing8requests/sec. Missing credentials retain queue. Optional cap/quiet-hours/suppression-lookup deferral is not terminal failure.

## Deterministic context and trust boundary

Select earliest active owned business by createdAt then ID, else newest owned onboarding draft (createdAt then ID, matching `draftOf` newest-wins behavior), else generic. Only use a business when persisted ownership and active membership are valid. Never use browser selected-business cookies or arbitrary recipient/business parameters for background personalization. Member-only accounts receive generic education and an ordinary dashboard CTA, not data borrowed from another owner; if they have an accessible workspace, `access=workspace`, otherwise setup.

Use bounded strings from saved Profile: business.name (fallback domain), industry, first nonempty offering, audience segment, and first prioritized keyword (fallback first nonempty keyword). GSC connected derives from that business's actual connection status, not token content. Names/examples have control characters removed and sensible80–200character limits. No scraped article text, secret, raw OAuth field or invented statistic. Incomplete/no profile uses neutral examples, not instructions implying analysis completed.

Determine context access with read-only persisted billing and membership checks: active owned business plus actual granting owner access → workspace; saved pretrial profile → start_trial; prior subscriber currently without access → restart; unfinished/no profile → setup. Do not call `accessSummary`/`ownAccess` from cron preparation because they can lazy-grandfather/commit; reuse read-only billing flag/account semantics, including existing configured grandfather eligibility without writing it. Trial, paid and comp all continue in sequence. Re-read permission, verified recipient identity and context before the first attempt; freeze rebuilt encrypted envelope before setting firstAttemptAt. Do not change body/key after an attempted request. Before retries, verify recipient and scoped business remain authorized and the frozen access-specific CTA is still appropriate; suppress/block unsafe retries rather than changing provider payload.

Keep lifecycle row `businessId` NULL for education and store optional scoped ID in encrypted data. Education is account-owned, and deleting a business must not cascade-delete outbox history or strand progression. Before first attempt a removed context can safely become generic. Enrollment snapshots never authorize opening a business.

## Landing URL contract

Engineer owns new GET `/email/learn?lesson=<allowlisted lesson>[&businessId=<uuid>]`; no `next`, arbitrary URL, source refs or bearer authority. Reject duplicates/unknown keys. Signed-out visitors redirect to signin preserving this validated local landing route; extend `entryAfterAuth` allowlist narrowly, preserving signup verification and existing work return paths. Cache private/no-store, noindex/nofollow, no-referrer.

With businessId: require current-user active membership AND business.ownerId===user.id before any cookie write. Recheck current business/billing authorization through existing guards. Unknown/foreign/deleted business→404, no selection mutation; do not substitute another tenant. Authorized but inactive/inaccessible owner→existing `/start-trial` or onboarding entry flow, never granting access from an email. An accessible active business goes through `openBusinessUrl`/existing current-business hop to the fixed feature. Without businessId use normal current-user entry routing and fixed feature only if a usable authorized workspace exists; otherwise setup/trial gates. Avoid cookie mutation before membership/access checks.

Fixed destinations: AI Visibility `/performance?tab=ai` (tiny engineer-owned change so Performance honors allowed initial tab; currently it always starts Search); Daily Brief `/brief`; Backlinks `/backlinks`; Organic Search `/calendar`; Social Marketing `/social?generate=1`. Non-workspace CTA copy uses start trial/reopen/continue setup and its href is the corresponding first-party gate without an embedded private-business URL. No auto-join network, generation, approval, posting or billing on GET.

## Ownership, implementation order and validation

Architect owns only this record. PM owns educationContent.ts, previews/script, brief/state/PR. Runtime engineer owns merge reconciliation, schema/migration/journal/readiness, education.ts/cron, shared lifecycle plumbing, preferences/API/page/Settings, landing route/guard and necessary Performance initial-tab support, plus focused meaningful tests. Independent QA owns evidence, never runtime implementation. Shared contracts above are settled before dependent coding.

1. Integrate main verification safely. Base lacks emailVerifiedAt; never retrofit a fake verified predicate. Preserve newer confirmation/Google ownership rules. Welcome/founder enqueue only after genuine confirmation/new verified Google creation; ordinary unverified registration is verification mail only. Reconcile lifecycle/auth regressions, not just text conflicts.
2. Resolve competing migration0009 signup-security versus0009 lifecycle histories without rewriting deployed signup migration. Preserve applied checksum/time ordering; regenerate development snapshots/journal consistently and append lifecycle/engagement/education after canonical main history. Validate upgrade from current production-like main AND clean database; worker waits read-only for all required education/verification fields.
3. Implement schema, copy contract, state machine, cap/preferences, dispatcher acknowledgment transaction and suppression preflight.
4. Wire narrow landing/Settings behavior, branded templates, plaintext/HTML previews and runtime tests. Build/typecheck and independent browser/render QA.

Required scenarios: all access cohorts including existing users and late verification; guests/unverified exclusions; legacy inherited opt-out versus explicit education setting; concurrent enrollment/collector/dispatcher and crash after acknowledgment; five steps once then complete; actual accepted+7days including downtime and DST; cap with founder/work and quiet hours; stable retries/network ambiguity/retention expiry; provider suppression, absent404, malformed200, unavailable/unauthorized fail closed and pacing; off/on with pending mail and completed/blocked enrollment; recipient/email or access/ownership loss before send/retry; missing/malformed profiles and HTML/header injection; foreign-business and signed-out return paths; AI tab arrival; mobile Settings and all five email renders; old billing/security/auth/work tests unchanged. No real recipient/provider POST in verification.

## Risks, rollout and rollback

Delivery remains at-least-once processing with provider deduplication inside24h, not a claim of exactly-once delivery. Fail closed on unresolved ambiguity prioritizes no duplicate at the cost of a blocked account requiring inspection. Daily optional cap can delay a weekly lesson under continuous other optional traffic; due timestamp remains unchanged until accepted and never triggers catch-up.

Required release evidence: source fingerprint, migration upgrade/clean/readiness checks, cohort counts and exclusions in a read-only enrollment report, existing key suppression-read permission, dispatcher outcomes (IDs/types/status/reasons, no PII), independent local tests/renders and owner review of copy. Existing/new audience enrollment is explicitly authorized by the user; this is not inferred from the old nurture draft. Do not describe mailbox verification as separate marketing consent.

Ship matching web/worker after approved migrations. A scoped education runtime kill switch (e.g. existing-style env flag, off=collector and dispatcher both defer) is a small optional rollout safeguard; if added, document default and do not require a new service. Pausing must preserve enrollment and pending rows; never reset event keys or delete provider history. Rollback application behavior to pause education, retain additive tables/preferences and resume remaining steps after accepted+7days. Never roll back signup mailbox verification to accommodate this feature. Main auto-deploy still requires owner approval; this task delivers a draft PR, not merge/deploy.

Primary provider sources checked2026-11-09: [suppression lookup](https://resend.com/docs/api-reference/suppressions/get-suppression), [team-wide bounce/complaint/manual suppressions](https://resend.com/changelog/suppression-list-support), [24-hour idempotency retention and body/key conflict behavior](https://resend.com/changelog/idempotency-keys). These support the bounded preflight and retry design; provider acceptance does not establish recipient delivery.

## User steering amendment: default-on usage mail

The user's subsequent instruction makes optional educational and usage/work mail default-on, with an Email preferences button in each footer for managing or opting out. PM accepted the following bounded change. This amendment supersedes the prior engagement architecture's explicit-opt-in source-capture requirement; it does not remove event relevance, mailbox verification, opt-outs or the shared cap.

- Missing `user_email_preferences` rows mean all three work categories are enabled. Change database defaults for `daily_brief`, `calendar_reminders` and `article_social` to true so rows created for education/founder preferences also retain default-on work behavior. Settings reflects the effective enabled values and describes managing mail rather than opting in.
- Preserve every existing persisted work boolean. The old schema has no per-field explicit-choice audit: false plus NULL since can mean the old default or an explicit API/signed-token opt-out. Resetting those values would silently resubscribe some opted-out users. PM accepted conservative preservation. Recorded PR25 state says this preference schema was not shipped, so ordinary production users have no legacy rows and will receive the new default-on behavior. Do not claim perfect reconstruction of old intent.
- Keep `recordEngagement` at new source completion hooks only; do not create events from existing saved calendars, articles, social packs or brief history. Missing enabledSince is no longer a consent gate. Capture/send when the effective category is enabled, and if a non-null enabledSince exists require occurrence on/after it. Explicit off→on still sets since=now; explicit false permanently retires pending source events as before. No opt-in requirement is introduced by a null timestamp.
- Recheck verified non-guest recipient status during source capture and dispatch. Default-on does not authorize unverified legacy password-account mail. Work source usefulness, ownership/access, permanent action resolution, delays/expiry, digest deduplication, quiet hours and shared founder/work/education24h cap remain unchanged.
- Add a visible footer button labeled **Email preferences** to every lifecycle template. Optional education/work/founder messages can use their purpose-scoped signed preference landing, which must explain its category and offer opt-out; retain working direct unsubscribe semantics and one-click headers. Billing/security messages use the authenticated first-party email settings destination. Billing/security do not acquire an unsubscribe switch. Do not turn a footer GET into a mutation or give a signed optional opt-out token authority to manage another category.
- Searches of integrated `src/server/services` and job definitions find no weekly AI digest implementation in this branch. A digest on another unmerged branch is outside this feature; do not import unrelated measurement/runtime changes to satisfy an absent event.

Engineer owns this source-policy/defaults/footer amendment and meaningful regression updates. QA additionally verifies absent/new preference rows default on, rows inserted by unrelated founder/education choices keep work on, persisted explicit false remains off, null since no longer blocks new eligible sources, re-enable cannot backfill old sources, unverified exclusion and scoped footer behavior for every lifecycle type. Existing3-category API shape remains stable.

## Followup: protect the next optional slot and pending history

Default-on daily work can otherwise starve education: work collection runs first, the dispatcher can consume an opening before the next education collection, and the old education collector simply moves nextDueAt24hours forward without ever creating an outbox row. Collector order alone does not close the race with the independently running dispatcher.

Accepted minimal fix: when a lesson is due, queue exactly that one lesson even if `optionalDeliveryAfter` returns a future cap/daytime instant. Use that instant as `sendAt`, link pending ID atomically, and retain the original due position; do not return with only a modified enrollment nextDueAt. Claim essential security/billing/transactional mail before optional mail, and claim due education before work updates and founder notes. The dispatcher still rechecks the rolling24h cap and quiet hours atomically; priority never waives either. An unqueued lesson may lose one slot before the next cron discovers it, but its now-persisted outbox row wins the following eligible slot, preventing indefinite work-induced starvation. Queue no later lesson before acknowledgment+7days.

No education reservation helper, extra lock, service or repeated one-hour reservation is needed. A suppression lookup failure defers that education row; it is not currently send-eligible and must not block all other optional mail indefinitely. Paused/opted-out/blocked/completed education likewise cannot reserve a slot. Existing in-flight retries preserve their frozen body, dedupe deadline and cap semantics. Validation must include7+days of fresh daily work, a due lesson discovered during an already-consumed cap interval, a pending work row with an earlier original due timestamp, worker/cron interleaving, quiet-hours extension, essential-mail priority and education preflight unavailability. Expect the next eligible healthy-provider slot to go to the queued lesson and no two initial optional attempts inside24h.

FK audit at this followup found `schema.ts` declares pendingEmailId `ON DELETE RESTRICT` while migration0012 still declared `ON DELETE SET NULL`; these must match before review. SET NULL is rejected because deleting history can reopen the same logical lesson under a fresh provider key. Required invariant: deleting a referenced pending outbox row by itself fails, while deleting the user removes both account-owned enrollment and outbox successfully. QA must exercise actual database account cascade, not only inspect the schema. PostgreSQL RESTRICT cannot defer its check, so if it blocks the multi-table user cascade use `ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED` for this FK (schema action no-action, explicit migration deferrability), with both account FKs still cascading. Direct outbox deletion then fails at transaction commit unless the referencing enrollment is deliberately removed too. Do not use outbox→enrollment CASCADE, which would silently erase progression on routine mail cleanup. If RESTRICT passes the real cascade test it is the smaller accepted implementation; document that evidence and align migration/snapshot/schema.

The deletion distinction is supported by [PostgreSQL foreign-key action documentation](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK): NO ACTION can be deferred; RESTRICT cannot. Exact cascade behavior is validated against the local deployed schema and migration, not inferred from FK names.

## Readiness amendment: valid send-only key and native suppression

PM's read-only production readiness check found that the worker has a valid sending-only Resend key. Its suppression GET returns HTTP401 with JSON `name: 'restricted_api_key'`, identifying unavailable lookup scope rather than an invalid sending credential. Requiring successful suppression-read permission would block every lesson and unnecessarily require expanding the runtime credential. No privilege expansion or user decision is needed for this internal compatibility fix.

Retain suppression preflight, with one narrow exception to the earlier universal401 fail-closed rule: **HTTP401 from the fixed HTTPS Resend suppression endpoint may fall back to native provider suppression enforcement only when the bounded response body is valid JSON, is a non-null non-array object, and its `name` property is exactly `restricted_api_key`.** Read at most4096bytes; reject/cancel an oversized stream, empty/malformed JSON, arrays, missing/wrong code and transport failures. Use code equality, never free-form message matching. Other object properties may be ignored; never persist or print the body, recipient-bearing request URL or credential.

This result permits the normal provider POST after all existing recipient verification, application opt-out, enrollment, body-freeze, cap, daytime and retry checks. It does not whitelist the recipient or bypass provider suppression. Resend's account-level suppression is still authoritative and prevents actual delivery to suppressed addresses, including a suppression occurring after any successful preflight. Native provider acknowledgment still means acceptance only; the sequence may advance on that acceptance and must never claim inbox delivery. Do not remove suppressions, grant a broader key or silently treat arbitrary lookup errors as success.

Valid suppression200 still stops the sequence, documented absence404 still permits, and unknown401 (including invalid credential responses),403,429,5xx, malformed/oversized bodies and timeouts still defer with no firstAttemptAt/provider attempt. An invalid POST credential remains an ordinary provider failure, not a successful send. If an operational marker is added, record only a bounded code such as `suppression_lookup_restricted_key_native_enforcement`, IDs and counts; no response message.

Required mocked regression cases: exact bounded restricted401 allows one accepted POST and one progression; replay remains stable; unknown/invalid-key401, malformed/oversized/non-object401 and503 produce zero POST/zero delivery attempt; explicit application opt-out remains zero POST despite the fallback; valid200 suppression remains stopped. Test the literal status-and-code pair so e.g.200 or403 containing the same name does not activate fallback. No real provider POST or key change is authorized. Native suppression behavior is documented in [Resend's account-wide suppression description](https://resend.com/changelog/suppression-list-support); the exact restricted-key response is supported by the PM's observed read-only readiness evidence, not inferred from that source.
