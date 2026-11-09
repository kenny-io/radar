# EMAIL-E3 billing/workspace handoff

Implemented on `kenny/lifecycle-emails`, starting HEAD `963a2d597b96bb7f9e37b33cc485d87ac22a5e5b`. Shared workspace edits by transport/auth engineers preserved. No production writes, provider sends, live charges, merge or deployment.

## Changed

- `billing/sync.ts`: queue cancellation and actual terminal (`canceled`/`incomplete_expired`) notices in the locked billing transaction; schedule trial-ending mail24h before a future deadline. Reconciliation does not create overdue reminders. Unpaid/paused are not mislabeled as subscription termination.
- Cancellation dedupe uses a random identity created only for a proven false→true transition under the existing account lock. A rollback discards the queue row; a replay sees unchanged state and produces none. Resume suppresses prior queued confirmations for the exact subscription prefix in the same transaction, so a later re-cancel has one current queued confirmation. Already in-flight sends cannot be recalled.
- `billing/activate.ts`: first trial activation queues one trial-start notice with the actual persisted trial end. The email, draft activation, account changes and$1 credit steps share the existing rollback boundary.
- `billing/draft.ts`: default standalone commit now wraps a transaction; profile activation and workspace-ready mail commit together. Existing external transactions remain supported; analytics run after commit.
- `billing/webhook.ts`: invoice events fetch provider invoice data inside the billing lock, validate customer/current subscription and status, and use invoice-ID dedupe. Receipt amounts/currency come from fetched facts. Zero-dollar trial invoices and missing association/amount facts do not become payment receipts. Delayed failed events for paid invoices and other subscriptions do not create failed-payment notices.
- `billing/provider.ts`, `stripe.ts`, `stub.ts`: optional authoritative invoice customer/subscription/amount-paid/currency/number fields. Stripe mapping supports Basil/Dahlia `parent.subscription_details.subscription` plus legacy fixtures; absent fields preserve legacy exact return shape. Stub payment success updates actual paid amounts.

## Verification

Dedicated local Postgres database `radar_lifecycle_20261103`, migrated0009 by auth engineer. `RADAR_DEV_STUBS=1`; no external mail/payment requests.

Command: `DATABASE_URL=<isolated local database> RADAR_DEV_STUBS=1 npm test -- src/server/billing/billingLifecycle.test.ts src/server/billing/webhookSync.test.ts src/server/billing/billingFlow.test.ts src/server/billing/stripe.test.ts src/server/billing/restart.test.ts src/server/billing/chargeSafety.test.ts src/server/actions/onboarding.test.ts src/server/auth/claim.test.ts`

Result: **74passed across8files**, including8new lifecycle tests. Covers confirm/webhook replay, future reminder timing, repeated cancellation transitions, atomic outbox/state rollback, failed-credit rollback and subscription adoption without duplicate credit, fetched$49 receipt vs forged payload values, zero-dollar invoices, delayed/foreign-subscription failures, concurrent workspace activation, guest suppression, and authoritative Stripe invoice mapping. Log `/tmp/radar-lifecycle-billing-tests-final.log`.

An initial added test incorrectly expected generic500 for a failed trial credit; the existing documented `activation_failed` contract is502. The test was corrected to that existing behavior, with rollback assertions intact, then all74passed. No product behavior or pre-existing expectation was weakened.

Typecheck passed during implementation (`/tmp/radar-lifecycle-billing-final-typecheck.log`); `git diff --check` passed. Final eight-file billing scope fingerprint (concatenated path, NUL, bytes): `736dc775e278ed159646b0236759ec883db0be9ba2dc6bcfdbe87d00d95beea5`.

## Integration and limits

Requires transport engineer's queue, `LifecycleData.status`, lifecycle schema and migration0009. No new Stripe event subscriptions, billing configuration or money logic changed. Independent QA and combined production build remain PM-owned; this pass does not establish real inbox delivery or live Stripe acceptance.
