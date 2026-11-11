# Stripe billing completion architecture

Starting revision: `5db796b5cd97c93a533cad088078a4a5b27c5e3c`, clean `kenny/suggestion-prompts-custom-images`. Architect confirmed local shell/source access; no Stripe account access was supplied to this task. This record extends the existing `.factory/marketing-trial-gating/architecture.md` and its §21 owner decisions.

## Scope and decisions

Reuse the existing Stripe REST transport, database billing account, trial checkout, recovery flow, webhook verification/deduplication, and subscription synchronization. Preserve the $1 card confirmation credited to month one, 3-day trial, $50 USD/month, per-user billing, member access through business owners, grandfathered accounts, and billing gate off until configured and verified. No schema migration or Stripe SDK dependency is needed.

Complete customer self-service with an account-scoped billing overview and Stripe-hosted portal. Add repeatable setup/preflight tooling for Stripe's product, recurring price, webhook endpoint and dedicated customer portal configuration. Never create or alter a subscription while provisioning infrastructure.

## Shared API contracts

`GET /api/billing/overview` requires `requireUser()` and returns a bare `BillingOverview` (same read-response convention as `/state`):

```ts
interface BillingOverview {
  provider: 'stripe' | 'stub' | 'none';
  enforced: boolean;
  status: SubStatus | 'comp';
  priceCents: number; // PRICE_CENTS (5000)
  currency: 'usd';
  interval: 'month';
  trialEnd: string | null; // ISO, persisted real trial end only
  currentPeriodEnd: string | null; // ISO
  cancelAtPeriodEnd: boolean;
  canManage: boolean; // Stripe provider + this user's stored Stripe customer
  everSubscribed: boolean;
}
```

Read `accountOf(user.id)` directly, regardless of `RADAR_BILLING`. `accessSummary.account` is intentionally null with gating off and would hide existing paid subscriptions. Determine `enforced` with existing `billingEnforced(user.email)`. Complimentary status derives from the billing row's `comp`; do not equate billing disabled with a complimentary account. `canManage` remains true for a complimentary user who also has a Stripe customer: complimentary access must not hide an existing recurring charge. Never return customer/subscription IDs, keys, card data or other users' information. Use dynamic responses and `Cache-Control: private, no-store`.

`POST /api/billing/portal` requires `requireUser()`; accepts no customer, business, subscription, configuration or return URL from the caller. Read only this user's billing row. No Stripe customer → 409 `no_subscription`; no Stripe provider → 503 `billing_unavailable`. Add a modest account/IP rate limit using the existing limiter. Create a new, short-lived session on each explicit action; do not cache/reuse session URLs. Success is `{ ok: true, url: string }`. Map provider failures to user-facing `billing_unavailable`; never log the portal URL, which contains a bearer secret.

Provider contract: add `createPortalSession({ customer: string, returnUrl: string, configuration?: string }, key: string): Promise<{ url: string }>` to `BillingProvider`. Stripe uses `POST /v1/billing_portal/sessions`, fields `customer`, `return_url`, optional `configuration`, with an idempotency key unique to this request (random UUID). Reuse `stripeRequest` and its network retry behavior so retries of one request share a key. Stub must explicitly refuse portal creation; never present a fake Stripe portal as functional. Optional env `STRIPE_PORTAL_CONFIGURATION_ID` selects Radar's dedicated configuration; when unset Stripe's default configuration applies. Derive the fixed return path on the server: `/settings?section=billing` for own-access accounts; `/start-trial` for lapsed accounts (`ownAccess(user) === false`). Do not accept arbitrary request return URLs. Validate `APP_URL` is HTTPS outside local development in setup/preflight.

Keep API authorization independent of `ownAccess`, business membership and business gate, so past-due/canceled owners can still manage payments. A member's selected business owner must never influence these APIs. Existing SameSite=Lax, HttpOnly cookies stay; reject a conflicting `Origin` header for the portal mutation where practical.

## UI contract

Extend existing Settings navigation with Workspace → Billing; reuse `Section`, `Row`, `Status`, existing buttons and tokens. Label this explicitly as **your Radar account**, covering all businesses the user owns. A business member's billing screen describes only their own subscription and can explain that a team business may be covered by its owner.

Show persisted status, $50/month, actual trial end or current billing period end, and scheduled cancellation. For `cancelAtPeriodEnd`, say access continues until the displayed end date and avoid suggesting another automatic renewal. Distinguish complimentary access, billing disabled/no subscription, trialing, active, payment overdue, canceled/paused, and pending states. Loading must be announced; errors must offer retry; management button must disable while opening and show actionable error copy on failure. Mobile/keyboard behavior follows existing settings.

Use `canManage` for **Manage billing**, described as updating payment method, downloading invoices and managing cancellation in Stripe. Preserve access to this action for existing customers when gating is disabled. Refresh overview when the tab/window gains focus after a portal return, with request cancellation/stale-response protection.

Settings is behind `(app)/layout.tsx` and unavailable to lapsed owners. Therefore add an accessible **Manage billing in Stripe** action on the restart variant of `TrialPage` as well; call the same portal endpoint. A provider/no-customer error must remain an inline error with the restart flow usable. No dependency on business access. No new independently styled billing page is required.

## Price validation

The existing `checkPriceOnce()` logs a mismatch asynchronously and still permits a $1 charge. Before taking new money, await a cached, successful validation of `STRIPE_PRICE_ID`; failure or mismatch must return 503 and leave customer/payment/subscription creation untouched. Validate active recurring, USD, `unit_amount === PRICE_CENTS`, licensed per-unit billing, interval month, and `interval_count === 1`; interval alone accepts a multi-month price incorrectly. Expand `Price` mapping with these fields and update the stub. Cache successful validation by provider and price ID, never a failed/in-flight check as successful. A shared in-flight Promise is acceptable. Failures must be retryable after configuration repair. Do not block portal access on price validation.

## Provisioning and preflight

Prefer one `npm run billing:setup` command in a standalone script, plus read-only `npm run billing:check` (or equivalent `--check` mode). Reuse the fixed API version and form encoder where sensible, but keep script import paths free of Next.js runtime requirements. Load `.env.local`/`.env` through Next's bundled env loader, or explicitly document environment injection. Secrets are read from environment/secret stores, never CLI args, logs or committed files.

Default setup operates against a test/sandbox key. Explicit live selection must be required when a live key is supplied, and operations must use only the existing owner account. Do not toggle `RADAR_BILLING`, grandfather dates, alter existing subscriptions, change global revenue recovery/email settings or deploy as a side effect.

Create/reuse a Radar product and $50 USD monthly licensed price using a stable lookup key and Radar metadata; if `STRIPE_PRICE_ID` is supplied, validate and reuse it rather than replace it silently. Enumerate/paginate candidate objects and refuse ambiguity or a conflicting object. Deterministic idempotency keys cover creation retries. Do not overwrite unrelated products/default portal configurations. A dedicated, versioned Radar portal configuration (`metadata.radar_config_version=1`, plus an app marker) enables invoice history, payment method updates, customer billing detail updates (name/email/address), cancellation `mode=at_period_end`, and disables price/quantity updates. Reuse an explicitly configured or uniquely Radar-tagged dedicated configuration. Do not change Stripe account defaults; save the explicit dedicated configuration ID to `STRIPE_PORTAL_CONFIGURATION_ID`.

For the webhook, use `${APP_URL}/api/billing/webhook`, the same pinned API version, exactly `WEBHOOK_EVENTS`, and Radar metadata. Reuse a matching endpoint instead of creating duplicates; refuse a conflicting explicitly supplied endpoint. Stripe returns a webhook signing secret only at creation; a reused endpoint's secret cannot be recovered by GET. Save a newly returned secret only to a deliberate ignored file with mode 0600 or the existing secret manager; never print it. If the secret cannot be persisted safely, stop and explain the missing configuration rather than claim setup complete. Dry-run/check makes no Stripe mutations. Print safe object IDs and missing variable names only.

Preflight verifies keys' modes align, price shape, webhook URL/event selection/version/enabled state, dedicated/default portal features and active configuration, presence of `STRIPE_WEBHOOK_SECRET`, and sane APP_URL. It cannot prove the signing secret matches Stripe without a delivered signed event; report that limitation and keep live test scenarios outstanding.

## Implementation order and ownership

1. Engineer owns `BillingOverview` in `src/lib/types.ts`, provider interface/Stripe+stub/env, overview+portal routes, synchronous price validation, associated tests, `BillingSettings.tsx` (or equivalent), `SettingsPage.tsx`, and restart portal action, following contracts above.
2. PM owns provisioning/preflight script and package scripts (no dependency/lockfile change expected), `.env.example`, LAUNCH, CONTRACTS, setup access, and feature records.
3. Coordinate before shared edits; the architecture record is architect-owned. Branch is now `kenny/stripe-billing` (same starting revision).
4. Independent QA exercises affected browser flows and authorization boundaries; no production payments or subscription mutations as tests.

## Meaningful verification

- Unauthenticated/guest overview and portal → 401; another customer's IDs in any supplied body never change which customer receives the session.
- Account A and B, business member, complimentary payer, billing off with an existing customer, no customer, and stub-only provider.
- Portal REST body contains only server-derived customer/return URL/configuration; fixed pinned version; fresh idempotency key between requests; transport retries share the key; response URL never logged.
- Overview reflects webhook-updated `cancelAtPeriodEnd`, current period and canceled status without exposing IDs; no fabricated preview trial dates.
- Price wrong amount/currency/quarterly interval count/inactive/metered/one-time/unavailable all reject before any charge. Correct price succeeds; failed checks retry; valid check reuse does not cross price IDs.
- Setup twice yields the same objects, read-only check sends no POST/DELETE, no secret in stdout/stderr, signing-secret persistence correct and restrictive; disconnected account produces a clear incomplete setup result.
- Real browser desktop/narrow settings, loading/error retry, portal-open failure, keyboard button behavior, restart manage action. Actual Stripe test payment/3DS/webhook/portal cancellation need authenticated test keys and are unverified until run.

## Sources checked 2026-10-31

- [Stripe portal integration](https://docs.stripe.com/customer-management/integrate-customer-portal): create a fresh temporary session per visit and authenticate before creating a session.
- [Create portal session](https://docs.stripe.com/api/customer_portal/sessions/create): customer, server return URL and optional configuration.
- [Portal configuration](https://docs.stripe.com/api/customer_portal/configurations/create): invoice history, payment method updates, cancellation mode and disabled subscription updates.
- [Price object](https://docs.stripe.com/api/prices/object): active, type, amount, interval count, billing scheme and licensed/metered recurrence.

## Rollout and rollback

No new migration. Keep gating off; provision in test mode, run real test-mode payment/webhook/portal checks, then separately configure live keys/IDs/secrets and execute authorized release. Preserve all existing active accounts via recorded grandfather policy before global enablement. Rolling back the UI or switching `RADAR_BILLING=off` does not cancel Stripe subscriptions; portal must remain reachable for existing payers. Existing repo delivery records require owner's go-ahead before merging to auto-deploying main.
