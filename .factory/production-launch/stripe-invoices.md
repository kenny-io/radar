# Real Stripe recurring-invoice acceptance — E3

**Passed, 3 November 2026 (Asia/Dubai).** The real sandbox confirms the advertised sequence: **$1 card confirmation, $49 first recurring bill after its $1 credit, then $50 next month**. Actual signed Stripe events reached Radar and were processed. This is sandbox acceptance, not a live payment.

## Isolation and execution

- Explicit PM-authorized sandbox `acct_1TsnjEGaLrbBBaPs`; secret key verified `sk_test_` before operations, account identity checked against that exact ID, and every returned resource carrying `livemode` checked `false`. Credentials were loaded from ignored owner-only `.data/production-launch/stripe-sandbox.env`; no credential, client secret, signature or webhook payload was printed or committed.
- Local real-provider environment: `APP_URL=http://localhost:3902`, `RADAR_DEV_STUBS=0`, `RADAR_BILLING=on`, shared isolated database `radar_launch_stripe_sandbox`. Current working source based on `0a9af070` plus the launch fixes; the production-mode local web process received Stripe CLI's real signed event forwards. No production Stripe resource or production database changed.
- Separate synthetic E3-tagged local user/customer and clock. Visa **debit last four 5556**, created with official Stripe test token `tok_visa_debit`, avoided QA's separately reserved success/decline/3DS fingerprints. No other QA rows were modified. Objects are retained for review; nothing was deleted.
- Used Radar's exported **real `start()` and `confirmTrial()` implementation**, not a parallel subscription implementation. The clock-bound Stripe customer was attached to the synthetic local billing row before start. The actual $1 PaymentIntent was confirmed through Stripe, and Radar created the trial and credit using its normal provider/locking/idempotency logic. QA owns separate browser/3DS/decline/portal evidence.
- Advanced the clock to actual `trial_end + 1 hour`, waited until ready and the first invoice was automatically paid, then advanced to the next current-period end + 1 hour and waited for automatic payment. No manual invoice finalization, payment, balance adjustment or subscription creation replaced Radar's flow.

## Verified resources

| Resource | Result |
|---|---|
| Synthetic local user | `be522941-c80c-4dca-a813-09a7baac157a` |
| Test clock | `clock_1UXS3zGaLrbBBaPslwVZT6QS` |
| Customer | `cus_VYZCPGTVZy1zqO` |
| Subscription | `sub_1UXS44GaLrbBBaPsairHUN16`, trialing → active |
| Card check | `pi_3UXS41GaLrbBBaPs1frkVqhf`, **100 USD cents, succeeded** |
| Credit | `cbtxn_1UXS46GaLrbBBaPsEsxb7m8B`, **−100 USD cents**, exactly once |
| First monthly invoice | `in_1UXS4CGaLrbBBaPsfOIpKbJi`, **paid 4900 USD cents**; total 5000, starting balance −100, ending balance 0 |
| Next monthly invoice | `in_1UXS4SGaLrbBBaPsFsmnImxq`, **paid 5000 USD cents**; total 5000, starting/ending balance 0 |

Read-only postflight independently retrieved the retained Stripe resources and confirmed exactly three successful PaymentIntents for this customer: **100, 4900, 5000 USD cents**. The credit still existed exactly once. Local account status was active and its saved current-period end exactly matched Stripe after both renewals. One local `trial.started` event existed.

Nine real Stripe events associated with this fixture were recorded in local `billing_events`, all processed with **attempts = 1**: three `payment_intent.succeeded`, three `invoice.paid` (including the zero-dollar trial invoice), one `customer.subscription.created`, and two `customer.subscription.updated`. Both the original run and later read-only checks verified this mapping without storing payloads or signatures.

The sandbox account reported `charges_enabled=false`, but these actual test-mode payments and renewals succeeded. This does not establish live account eligibility. Tax/account recovery settings were not changed; these assertions cover the configured fixed USD invoices.

## Harness and evidence

- Harness: `.factory/production-launch/qa/stripe-invoices.mjs` (no runtime source edits). Initial run passed; retained-resource read-only verification passed. `node --check` and `git diff --check` passed.
- Ignored safe evidence: `.data/production-launch/stripe-invoices-e3.json`, mode 0600. Contains synthetic fixture IDs, money/status and processed-event IDs; no keys or client secrets.
- Repeat the retained fixture checks without mutations:

  `node --env-file=.data/production-launch/stripe-sandbox.env --import tsx .factory/production-launch/qa/stripe-invoices.mjs --verify-only`

The harness refuses a second initial run when evidence exists, protecting the retained fixture and reserved once-per-card trial fingerprint. Cleanup is deliberately deferred to the PM/owner.

Official documentation checked using Stripe CLI 1.55.6: [test cards and tokens](https://docs.stripe.com/testing), [advanced test-clock usage](https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage), [create a test clock](https://docs.stripe.com/api/test_clocks/create).
