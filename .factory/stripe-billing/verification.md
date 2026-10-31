# Verification

Baseline application revision: `5db796b5cd97c93a533cad088078a4a5b27c5e3c` (before implementation).

- `npm run typecheck`: passed.
- `npm test -- src/server/billing src/features/billing`: 51 passed, 41 skipped (DATABASE_URL absent).
- Isolated Postgres database `radar_stripe_billing` created in existing local `radar-sc-db` container (:54329); `npm run db:migrate`: passed.
- `DATABASE_URL=postgres://postgres:radar@localhost:54329/radar_stripe_billing RADAR_DEV_STUBS=1 npm test`: 728 passed, 65 skipped, one pre-existing failure in `src/server/ai/openrouter.qa.test.ts` branded raster golden (`f883614e6a7dfb07` expected; `91d5409f50974af7` actual). This exact failure is recorded in the previous delivered feature. No golden changed.

External access checks: Stripe integration available but unconnected; Stripe dashboard at sign-in. Railway CLI status unlinked, account listing unauthorized. No Stripe provisioning, real payments, deployment or billing enablement performed.

## Integrated checks

Billing-only source snapshot made from base `5db796b5` plus the explicitly owned billing files (manifest in ignored `.data/stripe-billing/review-snapshot.json`). Concurrent homepage redesign and generated dev TypeScript includes were excluded. No unrelated files were reverted.

- Production `npm run build`: passed, including final UI copy correction. Log: ignored `.data/stripe-billing/integrated-build.log`.
- `npm run typecheck`: passed in the isolated snapshot after final setup warning changes.
- Full database-backed suite: **779 passed, 65 skipped, one exact baseline raster golden failure**. Log: ignored `.data/stripe-billing/integrated-tests.log`. Subsequently changed only cancellation label copy and setup's first-default warning; affected suites rerun: **4/4** copy tests, **22/22** setup tests.
- Independent real Chrome desktop/mobile QA, loading/error/keyboard recovery, cancellation persistence, restart gating, auth/origin/no-store and account isolation: passed. See `qa.md` for scope, fingerprint and evidence. Real hosted portal and payment checks remain unverified.
- UI mechanical detector: no findings. Diff whitespace check passed.
- Final independent focused database suite after all changes: **145/145 passed**, no skips. Source/package/scripts fingerprint `f6aa391bca9b1d2683a85a71cec98ad4ce88cb37b69f226a63612bf584407690`, identical in snapshot and deliverable.

## Live configuration

After the user connected Stripe and selected Thally live, product, exact monthly price, portal configuration and seven-event webhook were created and GET-verified. Details in `provisioning.md`. Webhook secret saved to ignored 0600 file; no customer/payment/subscription mutations, no activation or deployment. Runtime keys, Railway access, real Stripe sandbox acceptance and merge authorization remain outstanding.
