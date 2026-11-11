# E1 implementation handoff

Workspace confirmed: `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/stripe-billing`, starting HEAD `5db796b5cd97c93a533cad088078a4a5b27c5e3c`. Preserved PM, setup engineer, QA and concurrent marketing changes. No commit, merge or deployment performed.

## Implemented

- `BillingOverview` contract and authenticated, private/no-store account overview. Reads the caller's persisted billing row regardless of billing flag and never exposes Stripe IDs or secrets.
- Authenticated, origin-checked and separately rate-limited portal creation. Customer/configuration/return path derive entirely from the server; supplied body fields have no effect. Fresh idempotency key per click, stable during transport retry. Safe provider failures without logging portal bearer URLs. Lapsed users return to `/start-trial`; others return to Settings → Billing.
- Stripe provider portal transport; stub explicitly refuses hosted portal creation.
- Settings → Billing using incumbent settings components and layout. Includes loading, retry, stale-request cancellation, focus refresh, status/dates, cancellation, complimentary payer management and safe unavailable states. Restart screen includes Stripe management independent of app access.
- Fail-closed exact-price validation is awaited before customer/payment mutations on start/restart and before a new trial subscription. Checks active licensed recurring $50 USD monthly per-unit price with interval count one and no quantity transformation/custom amount. Successful checks cache by provider+price; failures retry after repair.
- Existing $1 credit, trial duration, grandfathering and billing flag behavior preserved.

Owned source: `src/lib/types.ts`; server billing `account`, `activate`, `restart`, `provider`, `stripe`, `stub`, `overview`, `portal`, `price` and focused tests; API `billing/overview` and `billing/portal`; frontend `BillingSettings`, `PortalButton`, `overviewCopy` and tests; settings integration and trial restart link. PM owns env/docs/setup/package changes; setup engineer owns webhook constant extraction.

## Verification

- `npm test -- src/server/billing/chargeSafety.test.ts src/server/billing/management.test.ts src/server/billing/stripe.test.ts src/server/billing/price.test.ts src/features/billing/overviewCopy.test.ts`: **41 passed**.
- `npm run typecheck`: **passed** after final E1 edits.
- `git diff --check`: **passed**.
- Impeccable detector on BillingSettings, PortalButton, TrialPage and SettingsPage: `[]`.
- E1 owned-file content fingerprint: `25cc6079e11cfe23e5c7ae8d90b8df8f6325b61b7a50724805960d6cef2b527c` (sorted relative names + NUL + contents + NUL, SHA256).

Independent browser and database-backed regression checks belong to Q1 and are not claimed here. Real Stripe payments/3DS/webhook delivery/customer portal actions require connected Stripe test credentials and remain unverified by E1. No migration or dependency added. Optional portal configuration env must be configured by setup/ops before rollout; existing default configuration is used when absent.
