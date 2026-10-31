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

## Remaining activation dependencies

- Runtime live restricted/secret API key and matching publishable key, supplied securely through `.env.local` or the Radar Railway environment. The connected integration cannot issue application API keys.
- Railway CLI re-authentication (`railway login`): current account listing is unauthorized.
- Copy private generated configuration to web and worker secret environments after access is restored; verify all mode/price/webhook/portal settings. The private provisioning file does not configure a running app automatically.
- Real sandbox payment, 3-D Secure, webhook delivery and portal scenarios remain unrun. Live configuration GET checks are not payment acceptance tests.
- Repository policy requires owner go-ahead before merge to auto-deploying main. Preserve grandfather policy and roll out with the gate off until validation is complete.
