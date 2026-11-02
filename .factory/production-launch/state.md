# State — November 3, 2026

Base: main `0a9af070`; branch: `kenny/production-launch`. Target launch: November 4, 2026. Unrelated existing home-release records and tsconfig drift are preserved.

| Task | Owner | State | Evidence / next action |
| --- | --- | --- | --- |
| A1 infrastructure/resilience | factory-architect | verified | DB pool/readiness/SSE, redirect defenses; architecture.md |
| A2 capacity/recovery | factory-architect | verified | 200-session production-build load; actual production snapshot restored locally; qa/load.md and qa/backups.md |
| E1 auth/billing | factory-engineer | verified | Auth limits, Google state, hydration, credit retry and Stripe deadline; accounts-billing.md |
| E2 connector boundary/deadline | factory-engineer | verified | Redirect/DNS-pinning, full body deadline and streamed webhook size guard passed |
| E3 real recurring billing | factory-engineer | verified | Actual Stripe test clock: $1 / $49 / $50, one credit and signed event processing; stripe-invoices.md |
| Q1/Q2 independent QA | factory-qa | verified | Public/local/hydration/production browser; focused regressions; qa.md |
| Q3 real Stripe browser | factory-qa | active | Elements, 3DS, card update, invoice download passed; actual cancellation-shape fix now requires final retest |
| P1 integration/delivery | PM | active | Final build/QA after cancellation fix, concrete PR and authorized rollout |

## Owner decisions and runtime

- Radar is owned by Fairspleet LLC within Thally; reuse shared policies. Support/billing `support@thally.io`; legal/privacy `team@thally.io`.
- Plan for 100–200 users; local benchmark uses 200 authenticated sessions.
- Keep Railway Hobby. Owner will arrange private offsite backup destination. Immediate local recovery drill passed; scheduled offsite protection remains pending.
- User authorized finding and using Stripe test keys in their signed-in browser. Existing Thally sandbox was used; keys are only in ignored 0600 local configuration. No live charge/subscription mutation.
- Production remains main `0a9af070`, one web and worker replica, shared S3, stubs disabled, billing OFF. Actual live Stripe account can charge; configuration checks passed.
- OpenRouter account credit is exhausted despite per-key allowance. Actual app writing/research requests succeeded through Anthropic fallback.

## Delivery constraints

Existing repository policy requires owner go-ahead before merging auto-deploying main. Prepare the final reviewable PR first. Billing activation is a separate step with a recorded grandfather cutoff. External Google consent verification, real email receipt and ongoing monitoring remain unverified; report these limits explicitly.
