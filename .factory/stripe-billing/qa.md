# Independent QA — Stripe billing

31 October 2026. QA inspected the brief, architecture, changed billing code and developer tests independently. Workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/stripe-billing`, base `5db796b5cd97c93a533cad088078a4a5b27c5e3c` plus billing changes. Unrelated concurrent marketing redesign changes were excluded from billing acceptance.

Tested billing-file fingerprint: `59ba06fe4fcb9e6648005ffc37209036ff0526df260ddb28891b598e8d92ca4e` (SHA256 of sorted path + NUL + contents + NUL for the non-record billing files in `.data/stripe-billing/review-snapshot.json`; exact file list saved in `.data/stripe-billing/qa/fingerprint.json`). Any later billing change needs affected checks repeated.

## Environment and coverage

Real Chrome browser through CUA extension; local Next development server at `http://localhost:3800`, isolated database `radar_stripe_billing` on local Docker Postgres port 54329, `RADAR_DEV_STUBS=1`. Ordinary sign-in using the locally seeded `qa-billing@radar.local` fixture. A separate viewer fixture (`qa-billing-member@radar.local`) belongs to that user's business. No production data, payments or subscriptions were changed. Browser viewport tested at 1672px desktop and 390×844 mobile; override reset afterward. QA server stopped after verification. Only its generated `.next-stripe-qa` TypeScript include was removed; concurrent unrelated includes were preserved.

| Acceptance | Result | Evidence |
|---|---|---|
| AC1 trial, credit, renewal and grandfather regressions | Passed locally | Database-backed real route-handler tests cover $1 confirmation/credit once, trial end, webhook-only activation, races, declines, past-due invoices, restart and grandfathering. |
| AC2 own overview independent of gate | Passed | Browser no-account, trial, active scheduled cancellation, canceled and complimentary states. Gate-off account retains persisted status and dates. API `private, no-store`; no Stripe IDs/secrets in overview. Viewer fixture receives its own `none` status rather than owner's account. |
| AC3 authentication, origin and portal boundaries | Passed locally; hosted operation blocked | Real endpoints: anonymous overview/portal 401, cross-origin POST 403, local stub portal 503 with safe error. Independent execution of route/transport tests covers foreign body fields ignored, own customer, comp payer, fresh idempotency keys, lapsed return path, safe provider failures and rate limits. |
| AC4 settings, recovery and accessibility | Passed observed states; hosted button flow blocked | Desktop/mobile settings, selected Billing `aria-current`, keyboard navigation, announced delayed loading, retryable network error and keyboard Enter recovery. Saved cancellation survives reload. Final gate-off cancellation label is **Subscription ends**, avoiding an access-expiration claim. With gate on, lapsed owner's Settings redirects to restart, showing $50 today and no trial. Stub mode explicitly hides fake hosted management. |
| AC5 setup/preflight | Passed mock/local checks; actual account setup not verified by QA | Twenty setup tests independently executed: create/reuse, GET-only check, pagination/ambiguity, incompatible prices, mode/origin guards, webhook drift, secret preservation and 0600 storage, symlink rejection, disconnected CLI redaction. Operator docs inspected. |
| AC6 verification | Passed focused local suite; integrated build tracked by PM | Independent database-backed focused suite: 17 files / 142 tests passed. Final cancellation-copy update separately rerun: 4/4 passed. Billing-only snapshot typecheck run recorded below. PM owns combined build/full suite evidence. |

## Browser scenarios

- Ordinary email/password sign-in, direct `/settings?section=billing`, selection retained after reload.
- No subscription with billing off; plan price and team-owner scope copy visible.
- Trial with real persisted trial-end date and $1 first-month-credit explanation.
- Active subscription scheduled to cancel: cancellation warning and persisted end date. Final correction verified on desktop and mobile with billing off: **Subscription ends**.
- Complimentary and canceled states. No next-renewal claim for canceled account.
- 390px layout: document scroll width equals viewport (390px), content pane fits; controls accessible in the incumbent settings navigation.
- Loading tested by a temporary local database lock; visible **Loading your billing details…**. Lock completed normally.
- Network failure tested by stopping only the QA server while the client remained open and selecting Billing. Visible alert plus **Try again**; restarting and pressing Enter restored the complimentary state.
- Gate enabled for the local process: canceled owner `/settings` redirects to `/start-trial`; restart page visible with $50 today, no trial, and usable card fields. No hosted Stripe action offered in stub mode.

Evidence: ignored `.data/stripe-billing/qa/` contains desktop/mobile screenshots, loading/error/restart screenshots, complimentary accessibility snapshot, API response/header files and fingerprint. Final screenshots: `final-cancellation-desktop.jpg`, `final-cancellation-mobile.jpg`. Browser selector timeouts during initial development compilation were resolved by inspecting the completed page, and were not product failures.

## Commands and limitations

`DATABASE_URL=postgres://postgres:radar@localhost:54329/radar_stripe_billing RADAR_DEV_STUBS=1 npm test -- src/server/billing src/features/billing` → **142 passed**, none skipped. `npm test -- src/features/billing/overviewCopy.test.ts` after final copy change → **4 passed**.

An initial working-checkout typecheck raced a Next server restart that deleted generated QA type files; this was an environment artifact, not a source defect. Independent `npm run typecheck` in the PM's billing-only review snapshot passed (exit 0). The full-suite known raster golden mismatch is pre-existing per the PM's baseline; QA did not alter it.

Chrome DevTools MCP could not launch because its existing browser profile was locked; CUA Chrome supplied actual browser evidence. Runtime Stripe keys were absent. The connected account choice/sandbox setup was pending with the user during QA. Real Stripe payment/3-D Secure, signed webhook delivery, hosted portal success/card update/invoice download/cancellation and post-portal refresh remain **blocked**, not passed. No fake credentials were sent to Stripe.

Recommendation: accept the observed local implementation for review. Do not enable paid billing or label the live integration release-ready until the selected Stripe test environment passes real payment/webhook/portal scenarios and production configuration is verified. No requirement defect observed in the completed local checks.

## Final provisioning follow-up — 31 October 2026

The user subsequently selected **Thally live**. The PM created and read back the Radar product, $50/month price, portal configuration and seven-event webhook; see `provisioning.md`. Those are PM operational checks, not independent QA payment acceptance. Runtime application keys and Railway access remain unavailable. No customer charge, subscription mutation, deployment or billing enablement was part of this follow-up.

QA independently reviewed the final setup change: Stripe may automatically make the first portal configuration the account default. Setup now reports that fact and advises passing Radar's explicit configuration ID; its regression test confirms the request never sets `is_default` or overwrites an existing configuration. The warning is separate from the unrelated-account-default preservation check.

Reran the entire focused billing suite against the final billing-only snapshot `/var/folders/bj/3s47mgg94953kh5fty4qz3g80000gn/T/radar-stripe-billing-review-xechex12` with the isolated database and stubs: **17 files, 145/145 tests passed, none skipped** (including **22 setup tests**). Command: `DATABASE_URL=postgres://postgres:radar@localhost:54329/radar_stripe_billing RADAR_DEV_STUBS=1 npm test -- src/server/billing src/features/billing`.

Final source fingerprint, superseding the earlier fingerprint for source/package/scripts: `f6aa391bca9b1d2683a85a71cec98ad4ce88cb37b69f226a63612bf584407690`. It covers the 29 billing files under `src/`, `scripts/`, and `package.json` from the review manifest, using the same path/NUL/contents/NUL algorithm. Snapshot and working-checkout contents match exactly for those files. Manifest: ignored `.data/stripe-billing/qa/final-source-fingerprint.json`. Records, operator documentation, `.env.example` and concurrent marketing changes are excluded from this source fingerprint. UI code did not change after the browser checks above.

No regression observed. Recommendation remains acceptance for PR review with live billing disabled. Real payment/3-D Secure, signed webhook delivery, hosted customer portal actions and production activation remain unverified.
