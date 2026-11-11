# Stripe billing

User request: set up Stripe and add billing for Radar. Existing checkout already implements the approved $1 card confirmation, credited to the first month, three-day trial, then $50 USD/month. Existing customers remain grandfathered. Extend and configure this implementation.

Delivery: reviewable changes on `kenny/stripe-billing`. Live account setup and production enablement require authenticated Stripe and Railway access; neither is currently available. Keep billing off until real Stripe verification succeeds. Do not merge/deploy without the repository's required owner go-ahead.

Experience: extend the existing Settings category sidebar with Billing. Use the existing Section, row, button, status, spacing and typography conventions. Show the signed-in user's account status and dates, complimentary/billing-off/no-subscription states, and a Manage billing action to Stripe's hosted portal. Include loading, retryable error, disabled/busy, mobile and keyboard states. Lapsed subscribers must be able to reach management from the restart screen. Billing belongs to the user, independent of selected business and its owner's subscription.

## Acceptance criteria

- AC1: Preserve approved trial, renewal price, credit and grandfather behavior.
- AC2: Signed-in users can inspect their own billing status, dates and cancellation state even when billing enforcement is off. Responses expose no Stripe identifiers or secrets.
- AC3: Portal sessions are authenticated and created only for the caller's stored customer. Ignore client customer IDs and return URLs; use a fixed APP_URL return path. Reject cross-origin requests and return safe provider failures. No fake external portal in stub mode.
- AC4: Settings has accessible Billing states and portal action; restart users can also reach management. Complimentary accounts with an actual paid subscription still have management available.
- AC5: Provide repeatable Stripe setup/preflight and operator documentation for the Radar product, exact monthly price, seven webhook events, portal features, required permissions and test/live rollout. Never print credentials or write them to tracked files.
- AC6: Run focused tests, database-backed existing billing regressions, typecheck, build and independent browser QA. Real Stripe tests remain explicitly unverified until account access is provided.

Excluded: pricing changes, usage credits, annual plans, tax policy, changing existing customers' subscriptions, immediate live billing rollout.
