# State

Branch: `kenny/stripe-billing`, base `5db796b5` (application deployed previously via main `2524537d`). Working in the existing checkout on a separate feature branch; no worktree created.

| ID | Owner | Scope | Status |
|---|---|---|---|
| A1 | factory-architect | Contracts and setup/security design | verified |
| E1 | factory-engineer | Account overview, Stripe portal, Billing UI, strict price validation and tests | verified locally |
| E2 | factory-engineer | Stripe setup/preflight tooling and tests | verified |
| P1 | PM | Live account configuration, integration/docs/delivery | verified; draft PR17 open |
| Q1 | factory-qa | Independent acceptance and browser verification | verified locally, final focused suite145/145 |
| A2 | PM + owner | Runtime keys and Railway configuration | verified; real payment acceptance and feature release pending |

Access: user connected Stripe and explicitly selected **Thally live**, then authorized reusing Thally's existing live runtime keys and installing them on Radar Railway. All six Stripe settings were installed and read back independently on web and worker. Read-only billing configuration checks pass. Keys and signing secrets were never displayed or committed. Existing production revision `2524537d` was redeployed successfully to load the values; paid access stays off. See provisioning.md and ignored activation evidence.

Baseline: typecheck passed; full database suite 728 passed,65 skipped, one known image golden mismatch. See verification.md. Isolated migrated database ready.

Integrated build/typecheck pass in isolated billing-only snapshot. Full suite779 passed,65 skipped, one exact baseline failure. Subsequent affected copy/setup suites4/4 and22/22 pass. Independent browser QA passes observed states. Review-ready code; not merged/deployed and live billing is not enabled. Existing repository rule requires owner's go-ahead before merging auto-deploying main.

Final independent source/package/scripts fingerprint: `f6aa391bca9b1d2683a85a71cec98ad4ce88cb37b69f226a63612bf584407690`, exact match between billing-only snapshot and checkout. Final focused database suite145/145 passed. Runtime keys and Railway access have been provided and verified. Real card/3-D Secure/portal acceptance and the feature's merge authorization remain outstanding.

## Delivery

Application revision `7e9dcda10477e814d78c37c0dee61b7dc0a48263`. Draft PR https://github.com/kenny-io/radar/pull/17 is open, mergeable, attached to this chat, with no configured CI checks. Only billing files committed; concurrent homepage changes left untouched. No feature merge or paid-access enablement. Existing production revision was refreshed successfully with the installed runtime configuration. Next action: verify real Stripe sandbox flows and obtain owner merge go-ahead under existing repository delivery policy.

## Runtime configuration verified — 31 October 2026

The owner explicitly authorized reusing Thally's live runtime keys and installing them on Radar Railway. All six settings match the secure sources on both services; read-only configuration preflight passes. Both existing-source redeploys succeeded: web `680ccab6-d234-4335-ae40-8c6d603b6bf9`, worker `1bbc3c47-3c1d-4984-a3dd-4eafe4d61ddb`, source `2524537da22eae7644829c05069b3b3320995c83`.

Independent operational QA passed public health/auth boundaries, a signed synthetic unsupported webhook event (200), exact replay (200, deduplication confirmed in filtered logs), and bad signature (400). The smoke test wrote one harmless processed event row and performed no Stripe customer/payment/subscription operation. Evidence is ignored `.data/stripe-billing/activation-qa.json`; no secrets are in this record.

The runtime configuration task is complete. PR #17 remains unmerged; the new billing management UI is not deployed. Paid access remains off. Real Stripe-delivered events, card/3-D Secure and hosted portal acceptance still need a sandbox run before enabling paid access.
