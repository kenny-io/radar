# Founder voice and trial-reminder retirement

Bounded architect handoff at clean `5f7c56ab56cdd60099b032e8003dc178c05d4708`, branch `kenny/weekly-education`, workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`. User correction: user-facing mail should feel personally from Ekene, founder of Radar, helping each business use the product; singular “I built Radar”, no enterprise-team voice. Remove the trial-ending/cancellation reminder entirely. Subscription copy should use subscription language and include amounts only when useful. PM owns all copy/builders/catalogue; engineer owns sender/trigger/dispatcher/schema wiring; independent QA verifies. Architect edits only this record, with no provider send, source change, production mutation or deployment.

## Retire trial_ending completely

The removed message is catalogue **#5**, currently `trial_ending`, previously subject “Your Radar trial ends soon”. It is a scheduled24hour-before-trial-end reminder from `billing/sync.ts:44–50`, not the confirmation of a cancellation the user actually requested. Keep the distinct subscription-start, receipt, failed payment, cancellation-scheduled confirmation and subscription-ended events, with PM's revised copy. Do not change subscription dates, renewals, cancellation behavior, Stripe calls or account access just to remove this message.

1. Remove the trial-ending enqueue block from `writeSubscription`; retain account trialEnd/currentPeriodEnd/state reconciliation. No substitute reminder under a new name/date/key.
2. Guard `queueLifecycle` against retired types before user lookup/render/insert. New typed active event definitions and preview lists exclude trial_ending. If an archive type is useful, keep it separate from the active sendable union; #5 does not require a live renderer. Current persisted row.type is text and can still identify historical events.
3. Add a dispatcher retired-type check before decrypt, expiry, recipient/billing checks and provider contact. Exact suppression reason: `retired_type`. Treat both trial_ending and previously retired workspace_ready as retired, including malformed/expired frozen payloads. Retire future queued trial rows as well as due rows: under the existing delivery advisory lock, a scoped sweep can suppress queued retired rows before the credential-availability early return. Respect test/operator userIds scopes. Reclaimed stale sending rows hit the same early retirement branch.
4. Preserve row ID, event key, encrypted payload, attempts, firstAttemptAt, provider acknowledgment and historical sentAt. Suppression never increments attempts or creates a replacement key/body. Previously sent/logged history stays as recorded. Failed/suppressed terminal rows remain historical. A retired row with a prior ambiguous attempt must not be retried merely to learn whether the provider accepted it.
5. Do not overwrite a currently live claim/provider request. A request already accepted or genuinely in flight cannot be recalled by this code; after a dead lease is safely reclaimed, suppress without another POST. No resend, history deletion, cancellation action or compensating email.

No schema change is needed for retirement. Catalogue numbering remains stable: #5 is a concise retired placeholder with its former subject/purpose and no active preview/send instructions. Remove active gallery HTML/plaintext output for #5; an explicitly historical archive may remain labeled as such. Other catalogue numbers do not shift.

## Audit of current sender paths

| Path | Current behavior at starting revision | Required new-send behavior |
|---|---|---|
| Lifecycle queue / render | Only founder_note uses `Ekene at Radar`; others env.mailFrom. Reply-to founder team@thally.io, others support@thally.io | All active user-facing lifecycle sends use one founder identity and team@thally.io reply-to; frozen attempted envelopes remain immutable |
| General sendMail | Configured env.mailFrom, no reply-to. Legacy outbox freezes to/subject/text/HTML but not sender metadata | Default new customer mail uses founder identity; durable sender metadata before first send; existing legacy retries retain old identity |
| Confirmation sendAuthMail | Configured env.mailFrom, no reply-to; redacted security capture and separate direct send | New security messages use founder identity and team reply-to; retain security link/redaction/expiry/verification semantics |
| Invitation / partner notices | Pure legacy builders feed general sendMail | Founder display and team reply via shared default; factual inviter/partner identity remains in body |
| Autopilot owner handoff | General sendMail with idempotency key and persisted body | Founder identity only for newly created envelopes; existing key/body/sender snapshot remain unchanged |
| Weekly AI report companion in original checkout | Separate digest job→original general sendMail; env.mailFrom/no reply-to | Freeze founder metadata in NEW report job payload and pass it explicitly; legacy jobs stay unchanged; keep isolated companion scope |
| Human support forward (internal) | Direct support POST from configured service identity; reply_to authenticated user's email | Preserve: this is a customer conversation forwarded TO the inbox, not founder mail sent to a customer |
| Feature request forward (internal) | General sendMail to configured support inbox, body identifies requestor | Explicit service identity option; do not make this operational forward appear to be a founder-authored customer message |

The weekly AI report is not imported into PR25. Its original checkout currently also has unrelated failure-observability edits; preserve those when PM applies the companion. No new DNS identity, service, secret, mailbox, provider key or permissions are required.

## Identity contract (PM-approved)

Engineer owns the implemented pure `src/server/services/mailIdentity.ts`, exposing:

```ts
export interface MailSenderMeta { from: string; replyTo?: string }
export const FOUNDER_REPLY_TO = 'team@thally.io';
export function founderFrom(configuredFrom: string): string;
// Result: Ekene from Radar <the exact configured sending address>
```

Callers explicitly pass current env.mailFrom; the helper itself imports no environment/server module. Support its existing bare address or single display-name/address format; extract and preserve the exact configured verified email address. Replace only the display name with **Ekene from Radar**. Reject CR/LF or multiple-address configuration rather than producing an injected/malformed header. Do not infer a new personal address, change the sender domain or use a business/recipient name as header data. This is sender presentation, not a provider-domain configuration change.

All new user-facing lifecycle/general/confirmation/Autopilot/report messages use reply_to **team@thally.io**, the already-approved founder-contact mailbox. Lifecycle renderers' visible reply text/mailto and envelope reply_to must agree. Keep the existing support address only where operationally appropriate, not as a conflicting “reply to me” destination in founder-signed mail. The sender may introduce “I’m Ekene, Radar’s founder” and sign Ekene; do not claim manual review, personal selection, an individual result or a guaranteed founder response that did not happen.

Extend general `sendMail` options compatibly:

```ts
{ idempotencyKey?: string; identity?: 'founder' | 'service' }
```

Default is founder for new user-facing mail. Explicit service identity snapshots env.mailFrom with no founder reply-to. The internal feature-request caller uses service; support's separate direct transport retains current authenticated-user reply_to. No user-controlled identity override. Identity option affects only initial creation; it cannot rewrite an existing idempotent row's snapshot.

## Durable sender metadata without breaking retries

PM approved additive **0015** with nullable `outbox_emails.sender_meta` JSONB, default NULL, typed `{from:string;replyTo?:string}`. No backfill. Preserve deployed0010 and PR25 canonical0011–0014 history; append a strictly newer journal time, correct snapshot chain, and read-only worker readiness for this new field. Final rollout must migrate before matching web/worker uses it.

New general-outbox INSERT persists sender_meta together with to, subject, text and HTML before provider contact. Every retry reads the stored sender_meta and maps replyTo to wire reply_to. A same-key retry must have identical From, reply-to, subject, content and recipient even if the helper's default display or runtime config changes later. Keep existing recipient-mismatch and23hour expiration guards, same provider key and sent/logged short circuit. Do not rekey to apply the founder rewrite.

Existing sender_meta=NULL rows retain legacy behavior: env.mailFrom and NO reply_to; do not fill them with founder metadata or update their bodies. This assumes the existing configured sender identity remains unchanged, as this task requires. If historical configuration identity cannot be established, hold an uncertain legacy retry rather than guessing a new envelope under its old key. Keeping NULL is also compatible with an old process inserting during rollout: it generated a legacy envelope. New code always writes an explicit snapshot for newly created rows. A createdAt/code-deployment cutoff heuristic cannot safely distinguish these cases and is rejected.

Lifecycle outbox already encrypts the complete envelope, including from and reply_to. Preserve all existing frozen attempted envelopes. Existing approved pre-first-attempt refresh paths for weekly education/guides/work may render and freeze the new identity before firstAttemptAt; core frozen queued history is not mass-rewritten to deliver a copy revision. Confirmation is a fresh security send, so its new direct envelope can use founder metadata without replaying an older token request. Security content redaction and no-auto-login stay intact.

For the isolated original-checkout weekly report, use optional sender metadata inside each NEW persisted digest job payload, e.g. `sender?:SenderMeta`. The original helper can accept an explicit sender override from that report and serialize it into the provider envelope. New payload freezes founder metadata once; retry reuses it. Old job payload missing sender keeps original env.mailFrom/noReply. Never attach new identity to preexisting job/outbox keys, and do not import PR25's sender_meta migration or the rest of the unmerged measurement feature into the other checkout. PM owns that bounded patch and evidence. If the original helper's idempotent row may be reused outside that stable job contract, reject an inconsistent sender override instead of mutating its provider body.

## Editorial boundaries and compatibility

PM owns singular, personal founder copy across all user-facing builders, including receipt/security/partner messages. Internal identifiers (`trialing`, billing module/type names, provider fields) stay unchanged. Use subscription language for the customer's plan/payment state. Mention amounts when the reader needs them to identify a payment, understand a charge or choose an action; remove repetitive pricing boilerplate where it does not help. Do not convert the real Settings→Billing UI label into a nonexistent destination; accurate UI navigation can still say Billing when quoting the interface.

Founder voice must preserve third-party facts: an invitation still names the actual inviter; partner approval/removal/decline still belongs to that business; a receipt records an actual payment; a prepared reply is not a posted reply. Plain “I’m passing along…” can be truthful automated founder communication; fabricated claims “I personally checked your results” are not. Keep necessary dates, security one-use/expiry, renewal/access facts, provider uncertainty and qualified/disclosed backlink distinctions. No invented gains/testimonials or implied guaranteed AI/search outcomes.

Preferences, timing, Autopilot operational classification and education-source eligibility are unchanged except retired trial_ending. Founder presentation does not alter authorization, opt-out scope, add a new sales campaign or disable essential account messages. No new user preference is required for a display/reply identity change.

## Required verification

- Subscription reconciliation never queues trial_ending, including replay/adoption/new trial; queue guard refuses direct retired calls; no replacement event.
- Due/future queued, expired, malformed, previously attempted/ambiguous and reclaimed stale trial rows become suppressed with retired_type, unchanged history/attempt count and zero provider attempts. Already sent/logged history stays recorded. Other subscription events still work. #5 is visibly retired and active gallery excludes its files.
- All newly rendered customer lifecycle variants, general invitation/backlink/Autopilot, security confirmation and companion report use the exact founder display with the same configured verified sending address and team reply-to; visible reply links agree. Bare/named configuration works; CRLF/multiple addresses rejected.
- New idempotent general row persists sender snapshot before POST; failed retry uses identical entire provider body/key, including after a display default/config change. Existing NULL metadata uses legacy From and no added reply-to. No retroactive rekey/update. Recipient-change/23hour guards and old sent no-POST shortcut remain effective.
- Internal support forward keeps reply_to authenticated user; feature-request forward is service identity. No accidental founder customer copy added to internal operational transcripts.
- Fresh/upgrade0015 migration, no-op rerun and worker readiness pass; previous canonical migration checksums preserved. Original report companion remains separate with stable payload metadata and no old-job rewrite.
- Render/catalogue/mobile/plaintext/preheader review covers personal voice, accurate action/subject, no enterprise plural or unsupported outcome claim, required security/subscription facts and unchanged preference/footer behavior. No real provider POST, production mutation or deploy in verification.

## Final main integration: observability PR38

Bounded read-only followup2026-11-10: `origin/main` advanced to `8b0fc3462c2709788cfa730d2f80c3ffee014a30` (observability PR38, implementation8eb03772) while FV changes were being verified against5f7c56ab. PM will freeze/commit FV before the engineer merges main. A clean merge-tree against the committed base does not prove semantic compatibility with FV's working changes.

The exact hotspot is `services/mail.ts`: main adds outer `sendMail`/`sendAuthMail` reporting wrappers and moves bodies into `prepareAndSendMail`/`prepareAndSendAuthMail`. Its private general helper still accepts only `{idempotencyKey?:string}`. Both outer and inner signatures must use the FV options `{idempotencyKey?:string;identity?:'founder'|'service'}`; a small local shared MailOptions type prevents divergence. Forward options unchanged. The inner general implementation must be FV's guarded sender_meta insert/read, NULL historical fallback, recipient check,23hour bound, stable body/key and timeout, plus main's production missing-key degraded report. Do not accidentally keep main's old env.mailFrom-only inner body or lose the explicit internal feature-request service identity even if TypeScript structurally accepts the wrapper call.

The inner security implementation keeps FV's CONFIRMATION_SUBJECT, founder sender/team reply, sender_meta snapshot and redacted production/encrypted-stub body. Its outer wrapper retains main's generic `Security email delivery unavailable` report without recipient, confirmation URL, plaintext token/body or raw provider content. Reporting must not replace the original send result/error, change queue/attempt state or create a second send. Keep main's existing alert deduplication/context behavior rather than redesigning it here.

New `observability/delivery.ts` sends an **internal operator alert**, not a new customer-facing email family: recipient comes from RADAR_FAILURE_ALERT_EMAIL (default kenny@thally.io); subject is `[Radar {environment}] Failure/Degraded: {operation} ({provider})`; sanitized diagnostics and a suggested response are frozen in the job envelope with service MAIL_FROM, its own idempotency key and23hour age guard. It sends directly and deliberately avoids the reporting mail helper to prevent recursive failure alerts. Retain that service identity, internal payload, registration and configuration. Do not founder-rewrite it, put it in the customer course/cap/preferences, or add a numbered customer catalogue message. A short internal-inventory note is accurate. PR38 adds no schema migration, so the canonical0010 plus PR25/FV0011–0015 chain remains unchanged.

Engineer preserves main's observability hooks alongside lifecycle source/action resolution, Autopilot provenance/recipient guards and early retired-type suppression. Do not expand alert instrumentation, sanitization, retries or original-checkout companion scope during this merge. Focused integration checks: (1) internal feature request through public wrapper produces service From/noReply; (2) new customer send through wrapper produces founder snapshot/team reply; (3) same-key failed retry preserves stored metadata and NULL legacy fallback; (4) recipient mismatch/expired retry causes zero customer POST, unchanged permanent handling; (5) security failure reports generic bounded diagnostics with no private link; (6) production missing key reports degraded but retains prior log-only semantics; (7) internal alert failure does not recursively invoke general mail/reporting; (8) retired trial rows still suppress before decrypt/provider, source hooks and both job registries remain. Mock all transport/reporting for these tests; no operator/customer/production send is authorized. Typecheck plus the combined FV sender/retry/security and main observability focused suites provide evidence beyond a textually clean merge.
