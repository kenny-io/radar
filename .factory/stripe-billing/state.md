# State: Stripe billing

Feature branch: `kenny/stripe-billing`. PR https://github.com/kenny-io/radar/pull/17 was explicitly authorized for merge by the owner and merged into main as `29c3fe36fc248c1abb2fb593948e1185b3e6b9ce` on 31 October 2026.

| ID | Owner | Scope | Status |
|---|---|---|---|
| A1 | factory-architect | Contracts and setup/security design | verified |
| E1 | factory-engineer | Account overview, portal, Billing UI, strict price validation | verified and deployed |
| E2 | factory-engineer | Stripe setup/preflight tooling | verified and deployed |
| Q1 | factory-qa | Independent local acceptance | verified, 145/145 focused tests |
| P1 | PM | Live configuration, integration and authorized release | verified |
| Q3 | factory-qa | Independent production release smoke | verified within authorized scope |
| A2 | PM + owner | Real Stripe sandbox payment/portal acceptance and paid-access enablement | pending; gate remains off |

## Released — 31 October 2026

Production https://radar.thally.io. Railway auto-deployments for the exact merged revision both succeeded:
- Web: `0cbdc2b1-82c3-4115-a79b-cadbaf7a952b`.
- Worker: `9491e30d-c23b-42d9-8bd4-d844b0299ef7`.

All 29 billing source/package/script files in the merged revision exactly match the accepted independent QA fingerprint `f6aa391bca9b1d2683a85a71cec98ad4ce88cb37b69f226a63612bf584407690`. Main also retains the separately released homepage work. No configured GitHub CI checks existed; Railway's production build and deploy succeeded.

Independent real Chrome desktop/mobile home and sign-in smoke passed, with no document overflow or broken completed images and the auth logo home link working. New overview/portal routes return 401 with private/no-store headers when signed out; existing authentication boundaries pass. Missing/bad webhook signatures return 400; replaying the existing harmless synthetic event returns 200, with replay confirmed on the new deployment. No new event row, payment, customer or subscription was created during release smoke. Evidence: ignored `.data/stripe-billing/release-qa.json` and release screenshots.

## Runtime configuration

The owner explicitly selected Thally live and authorized reusing its existing live runtime keys. All six Stripe settings were securely installed and independently matched on Radar web and worker; read-only billing configuration preflight passes. Keys, signatures and cookies were never displayed or committed. Radar's product, exact $50/month price, dedicated portal and seven-event webhook are documented in provisioning.md. Stripe automatically made the account's first portal configuration its default; Radar uses its explicit configuration ID.

## Verification and remaining work

Local typecheck/build pass. Focused independent billing suite: 145/145 passed. Full suite: 779 passed, 65 skipped and one exact pre-existing raster golden failure; final affected suites rerun after changes. See qa.md and verification.md.

The code release is complete. `RADAR_BILLING` remains unset/off on both services. There was no authenticated production session, so signed-in Billing UI, real card/3-D Secure, Stripe-delivered payment webhooks and hosted portal actions remain unverified. Next action before enabling paid access: complete real sandbox scenarios, confirm grandfather/tax/recovery settings, then authorize the paid-access rollout. No more feature-merge action remains.

This post-release record is saved on the feature branch only, preserving the tested deployed main revision.
