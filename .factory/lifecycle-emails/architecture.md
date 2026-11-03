# Lifecycle email architecture — November 3, 2026

EMAIL-A1. Workspace: `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`; starting revision `963a2d597b96bb7f9e37b33cc485d87ac22a5e5b`. This is a design audit; no production mutations or email sends performed by the architect.

## Existing coverage and gaps

`src/server/services/mail.ts` currently supports invitations, partner notices and feature-request forwarding. It inserts `outbox_emails` and synchronously calls Resend. There is no timeout, idempotency header, provider message ID or retry worker. It must remain compatible: do not begin retrying legacy invitation rows, whose links can have changed.

`src/app/api/auth/signup/route.ts` and the Google callback track new accounts but send no welcome. There is no password-recovery route. `src/server/billing/sync.ts` centralizes locked subscription state changes; `activate.ts` guards trial creation with `trialStartedAt`. Neither sends account emails. `draft.ts::commitDraft` is the only activation of a business. The existing minute scheduler and Postgres job queue supply all needed infrastructure.

## Nine event contracts

| Type | Trigger / durable dedupe eventKey | Recipient and content |
| --- | --- | --- |
| `welcome` | New real user insert, `welcome:{uid}`, with trusted guest-analysis context | Primary signup already has an analyzed Business Profile: acknowledge it by business name and continue with that profile. Neutral account-ready fallback for direct signup or incomplete analysis; no active-trial/workspace claim. |
| `founder_note` | Same insert, due +24h, `founder:{uid}` | Owner-supplied reason from launch script: building got easier, discovery remains a full-time job, Radar takes on that work. Brief offer to reply for help, no invented biography or setup lecture. Optional guidance optout applies. |
| `password_reset` | Accepted recovery request, `reset:{tokenHash}` | Password-account owner only; one-hour single-use link, ignore if not requested. |
| `trial_started` | First activation, `trial:{subId}` | Billing owner; actual trial end UTC date/time, $1 confirmation credit, $50/month afterward, manage/cancel action. |
| `trial_ending` | Due 24h before trial end, `trial-ending:{subId}:{trialEndISO}` | Billing owner; revalidate still trialing, same subscription/end and not canceling; do not send after trial ends. |
| `invoice_paid` | Verified `invoice.paid`, `invoice-paid:{invoiceId}` | Billing owner; actual paid amount/currency from verified provider invoice; covers first month, renewals and recovered payments without separate duplicate recovery email. |
| `payment_failed` | Verified `invoice.payment_failed`, `payment-failed:{invoiceId}` | Billing owner; fetched invoice still unpaid/open and belongs to current subscription; action to manage payment, no unsupported promise of continuing access. |
| `cancellation_scheduled` | Current subscription false-to-true cancelAtPeriodEnd, `cancel-scheduled:{subId}:{transitionIdentity}` | Billing owner; actual effective date and manage action. Skip stale queued event if subscription was resumed. |
| `subscription_ended` | Current subscription moves to canceled/incomplete_expired, key includes subId, resulting status and transition/source identity | Billing owner; state-specific explanation and restart/manage action; do not describe a failed payment as voluntary cancellation. |

All keys are globally unique and durable beyond provider idempotency retention. Cancellation and ended events require a real transition identity (verified Stripe event ID or a monotonically incremented local billing notification revision), so cancel→resume→cancel in one period creates the new confirmation correctly. Do not use only subscription ID plus period end for a repeated transition. Never enqueue for guests or synthetic guest emails. No historical-user backfill or launch broadcast.

## Shared interfaces and data

`queueLifecycle(q: typeof db | Tx, { type, userId, eventKey, data, sendAt?, businessId? }): Promise<void>` inserts a dedicated `lifecycle_emails` row with `onConflictDoNothing` on `event_key`. It performs no HTTP call. Call it inside the same transaction as the event-producing mutation; best-effort analytics (`track`, `runLater`) are not a reliable email source.

A pure `renderLifecycle(type, data, {appUrl, unsubscribeUrl?})` produces `{ subject, text, html, replyTo }`. Render escaped user input, branded accessible HTML plus plain text, one clear CTA, absolute application links and support@thally.io. Founder reply-to may be team@thally.io. Code-rendered templates fit the present stack and can be previewed without a provider-hosted template dependency.

Mail engineer owns the shared schema/migration: `lifecycle_emails` (ID, unique eventKey, type, userId FK/cascade, optional businessId FK/cascade, safe data JSON, encrypted sensitive data if needed, sendAt, status, attempts, firstAttemptAt, lockedAt, providerId, lastError, createdAt, sentAt), `password_reset_tokens` (tokenHash PK, userId FK/cascade, expiresAt, usedAt, createdAt), and per-user guidance preference. Add indexes for due dispatch and expiring resets. Keep `outbox_emails` behavior separate for this feature.

The dispatcher claims due lifecycle rows atomically with `FOR UPDATE SKIP LOCKED`, leases/reclaims stale claims and sends with a fixed Resend Idempotency-Key derived from row ID. Save provider ID before reporting sent. Provider accepted is not delivered. Use a 15s fetch/body deadline, retry 429/5xx/network failures with bounded backoff, and do not automatically replay permanent4xx. Stop ambiguous retries within24h of first send and flag for review to avoid duplicate delivery after Resend's24h idempotency retention. Rows with missing production credentials fail visibly, rather than silently claiming a send. Never log full message bodies or bearer links.

A dedicated bounded dispatch loop in the existing worker process scans due rows independently of analysis-job slots and cron; lapsed billing does not block service messages. Revalidate user/ownership/subscription and freshness before optional or delayed sends. Record skipped reasons. Initial deployment must not scan every historical account to invent welcome/founder events. Trial reminders are created only for future active trial windows; avoid issuing overdue reminders.

## Password recovery

Auth engineer owns request/reset service, routes and UI. Reuse origin, body-size, bcrypt limits and shared Postgres rate limiter. Cryptographic32-byte token, SHA256 stored, one-hour expiry. Request endpoint always returns the same200 message for unknown/guest/Google-only/password accounts; only real users with an existing password hash receive the message. Rate limit by IP and hashed normalized email without exposing account existence.

Do not persist the raw reset token in lifecycle JSON or rendered outbox HTML. Use the existing AES-GCM `encrypt()` helper for the type-specific secret payload and clear it after final send/skip. The lookup table stores only the token hash. Prefer a reset URL fragment read by the client and submitted in POST, preventing query-string/referrer leakage. Reset page is noindex and no-referrer, with no third-party resources.

On consume: validate password (at least8 chars, at most72UTF8 bytes), hash, then transactionally consume the unused/unexpired token, update password, revoke ALL user sessions and other reset tokens. Concurrent/reused/expired tokens cannot succeed twice. Do not automatically sign in. Google-only accounts continue using Google. No password-addition policy is introduced.

## Optional guidance and unsubscribe

Only the founder support note is optional. It must remain service-focused without promotions or unverifiable promises about personal monitoring. A signed, purpose-scoped preference token can update guidance optout without authenticating as the user. GET shows confirmation (mail scanners must not unsubscribe); POST performs optout. A separate RFC8058 POST endpoint may implement one-click headers. This preference never suppresses password recovery, receipts or account-state notices. Suppression/complaint handling should use existing provider behavior; do not remove suppression entries or alter account settings.

## Implementation ownership/order

1. Mail engineer: shared schema/migration, typed event contracts, renderer/previews, enqueue, dispatch, scheduling, preference endpoint and focused tests.
2. Auth engineer: password recovery, new-user hooks in password/Google signup, using the shared enqueue contract; no competing migration.
3. Billing engineer/PM integration: locked subscription/trial hooks, verified invoice events and reminder scheduling. Fetch current provider state to reject stale/out-of-order events. Extend provider/stub Invoice with optional amount_paid, currency, customer and subscription fields, fetched authoritatively via getInvoice. Require customer/current subscription association and appropriate actual invoice status before queueing. Legacy fixtures with only id/customer safely no-op on missing proof rather than manufacturing a receipt. Preserve the existing seven Stripe events; trial ending is locally scheduled. Do not treat hardcoded $50 as an actual receipt amount.
4. Independent QA: compare nine templates and trigger matrix, actual browser recovery flow on isolated test account, verify dedupe/rollback/retry/tenant and no-backfill behavior, production deployment only after authorized merge.

## Required verification

- Signup and concurrent Google callback create exactly one welcome and founder event; existing sign-ins create none; guests never mail.
- Transaction rollback also rolls back queued email. Concurrent webhook replays produce one email; old subscriptions do not mail the current account incorrectly.
- First trial credits the $1 once; three-day end and first paid invoice amount reflect actual values. $0 trial invoice must not be described as a $50 charge.
- Trial reminder rechecks cancellation/status/date; stale pending cancellation/failed-payment notices skip after recovery.
- Queue survives worker restart and honors leases; provider retry payload remains identical; no replay after24h ambiguous window; 4xx visible failure.
- Recovery is non-enumerating, bounded, one-hour/single-use; concurrent consume one success; all old sessions invalid; previous tokens invalidated; Google-only and guest accounts unchanged; tokens absent from stored plaintext and logs.
- Founder optout works without altering transactional notices; HTML escapes names/domains; CTA links remain app-hosted; plaintext usable.
- One owner-controlled real test receipt is required to establish actual delivery; domain verification alone does not prove inbox delivery.

## Launch gaps beyond this implementation

Existing launch records still flag private scheduled offsite backups awaiting the owner's destination, Google OAuth/connector consent verification, external uptime monitoring, and OpenRouter account funding (Anthropic fallback worked). Records predate subsequent deployment/billing activation, so confirm current runtime before calling them blockers. Search indexing follow-up is paused for locked-Mac access with946 Bing and6 Google requests pending; this does not block announcing Radar. Pending requests and accepted sitemaps never prove actual index inclusion.

Primary provider behavior checked: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) retains keys24h; resend headers must use stable keys and bounded retries.

## Final integration decisions

- Delivery uses a dedicated loop in the same worker process, batches of10 and1second between batches, retaining a shared Postgres dispatch lock and8requests/second spacing. No general job/cron registration or new service is required. This avoids password recovery waiting behind four long analyses. Shutdown aborts the current provider request and prevents additional claims.
- Cancellation transition UUIDs are generated only under the locked false-to-true state change and inserted in the same transaction. Replays see persisted true and do not enqueue again; resume suppresses prior queued notices so a second cancellation leaves only the current confirmation. End notices cover actual terminal states, while outstanding invoices use payment-failure notices.
- Independent QA found and closed a stale-signin draft-mutation race and a same-tab fragment-navigation reset defect. Permanent auth regression plus real browser retests cover the corrected behavior.
