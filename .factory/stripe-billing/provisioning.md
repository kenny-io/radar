# Stripe live configuration — 31 October 2026

The user connected Stripe and explicitly selected **Thally live** for Radar configuration. Account `acct_1Tsnj5GvJ7a2H31W`. Objects were created through the connected Stripe integration, then read back independently through its GET API operations.

| Object | Verified configuration |
|---|---|
| Product | `prod_VXf6cCVonMkDjz`, Radar, active |
| Price | `price_1UWZluGvJ7a2H31WBnPuO5es`, active recurring licensed per-unit 5000 USD cents per one month, lookup `radar_monthly_usd_50_v1`, no quantity transform/custom amount |
| Portal | `bpc_1UWZlvGvJ7a2H31WVfGbdXf1`, active, invoice history, payment method updates, name/email/address updates, cancellation at period end without proration; plan/quantity updates disabled |
| Webhook | `we_1UWZmFGvJ7a2H31WcmBKPwAO`, enabled, `https://radar.thally.io/api/billing/webhook`, pinned `2026-05-27.dahlia`, exactly the existing seven billing events |

No Radar product/lookup price or portal configuration existed beforehand. The unrelated Thally application webhook was preserved. Stripe automatically made Radar's first portal configuration the account default (`is_default=true`); no existing default was overwritten. Radar must use its explicit configuration ID, and other apps sharing this account should review their default portal usage.

The generated webhook signing secret and public configuration values are saved only in ignored `.data/stripe-billing/live.env`, mode **0600**, verified ignored by Git. The secret is omitted from this record and all displayed results. API keys are not stored in that output file.

No customer, payment, balance, invoice or subscription mutations were performed. `RADAR_BILLING` was not enabled, and nothing was merged or deployed. Tax settings and account-wide recovery settings were not changed.

## Runtime configuration completed — 31 October 2026

The owner authorized reusing Thally's existing live secret and publishable keys. The keys were read securely and never displayed, copied into tracked files, or passed as command-line arguments. Radar's own price, portal, webhook secret and pinned API version were installed alongside them on both Railway production services using stdin, with automatic deployments suppressed until all values were verified. A targeted 0600 rollback backup is stored privately.

Read-only `billing:check` passed with these values, then both services were redeployed from the unchanged production source `2524537d`. New deployments succeeded: web `680ccab6-d234-4335-ae40-8c6d603b6bf9`, worker `1bbc3c47-3c1d-4984-a3dd-4eafe4d61ddb`. Independent QA confirmed all six settings match, public health/auth checks pass, signed synthetic webhook/replay return 200 with deduplication, and an invalid signature returns 400. The synthetic smoke writes only one harmless processed event row, with no customer/payment/subscription mutation. No keys or signatures appear in evidence.

## Remaining activation dependencies

- Real sandbox payment, 3-D Secure, Stripe-delivered webhook and hosted portal scenarios remain unrun; configuration and synthetic signature checks are not payment acceptance tests.
- PR #17 is still unmerged, so the new billing management UI is not deployed. Repository policy requires owner go-ahead before merging auto-deploying main.
- `RADAR_BILLING` stays off. Preserve grandfather policy and verify tax/recovery settings before enabling paid access.
