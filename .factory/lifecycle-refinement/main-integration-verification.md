# Final integration and numbered catalogue verification

PR #25 source `96b3d730` was pushed, then current main advanced to Autopilot merge `b38b67a4d48c51f39bd5fc68e1fc4143a9633060` and conflicted. The resolved integration preserves both products and is delivered as a coherent merge on the same PR branch. Earlier LC2 build/fingerprint/migration numbers remain valid historical checkpoints; this record and `qa/main-integration/report.md` are the final release-review checkpoint.

## Current result

- Every former unscheduled draft has an existing event/lesson destination or one of two durable one-time guides. No duplicated welcome/founder/course, history burst, preference reset or replay.
- Complete numbered catalogue: **29 user-facing families / 69 full access, role and data variants**, with actual subjects, preheaders, bodies/footers, triggers and cadence. `previews/catalogue.html` is the reading view; `catalogue.md` and `all-emails.txt` contain full text; `index.html` is the visual gallery. Permanent family numbers are #1–#29, with lettered variants and preserved original bare references.
- New-main Autopilot handoff is #29. Actual caller uses the refined pure builder, retains saved owner actions/drafts and scoped links, and explains program management plus Email preferences. It remains an explicitly owner-enabled operational path outside the optional lifecycle category/cap. Master-enabled businesses do not receive parallel default work reminders; lessons/guides remain eligible under their own rules.
- The first-article guide explicitly describes review-first operation with both Autopilot and Blog autopilot off. Turning either on can permit publication without separate review.
- Main's verified identity, business-hop authorization, Autopilot activation/provenance, manual adoption, transaction hooks and both Settings sections remain intact. Handoff requires a verified current owner. Unsent same-key retries hold a changed recipient or an expired 23-hour window, preserving payload/key and preventing unsafe replay.
- Canonical main migrations 0000–0010 are unchanged. The unpublished lifecycle migrations are **0011–0014**, with strictly increasing timestamps above deployed 0010. Final snapshots retain Autopilot fields and correct ancestry; clean and real-main upgrade proofs apply all 15 migrations without ledger repair.

## Evidence

Node 22.18.0, disposable local Postgres databases on port 54329, injected provider transports and synthetic ordinary accounts only.

| Check | Result | Evidence |
| --- | --- | --- |
| Fresh full integrated database-backed suite | 1,241 pass; 65 external skips; one unchanged native-raster baseline failure | main-integration-full-suite.log |
| Optimized production build | Pass; BUILD_ID `TkT1HQkcSIUeAWxUTioKT` | main-integration-build.log; .next-lifecycle-integration |
| Final restored-config typecheck | Pass | main-integration-typecheck.log |
| Engineer affected suites | 248 pass; seven focused new guards independently recorded | main-integration-runtime.md |
| Independent policy/delivery/transport checks | 31/31 pass | qa/main-integration/independent-tests.log |
| Independent affected developer regressions | 122/122 pass | qa/main-integration/report.md |
| Ordinary signup/invite/settings/guide browser | 42/42 pass | qa/main-integration/report.md |
| New Autopilot Settings/action/auth-hop browser | 7/7 pass | qa/main-integration/report.md |
| Billing CTA arrivals without payment mutations | 2/2 pass | qa/main-integration/report.md |
| Final numbered reading/gallery controls | 8/8 pass | qa/main-integration/report.md |
| Exact optimized production-mode smoke | 6/6 pass | qa/main-integration/optimized-smoke.json |
| Current renderer coverage | 69 variants × two widths = 138/138 pass; 144 raw renders retain six superseded Autopilot scenarios | qa/main-integration/report.md and render evidence |
| Migration proofs | Clean, exact main 0010→0014 and pre-guide 0013→0014 all pass | main-integration-migrations.json; qa/main-integration/migration-proof.json |
| Worker readiness | Current accepted / prior refused, 2/2 | qa/main-integration/readiness.json |

The one full-suite failure is exactly the existing image golden mismatch: expected `f883614e6a7dfb07`, actual `91d5409f50974af7`. It was independently reproduced on clean main-family source during the preceding review; image source and golden remain unchanged. This is not described as an all-green full suite.

Final independent source SHA256 **221182093a9776bc27d34d6bcef66e5ad3646b2e3eeae76604e271225482e53a**, 612 files. Final QA lists the exact source scope, hashes, commands, screenshots, cleared fixture counts and stopped servers. Additional catalogue-only scenarios were appended after the application build; they do not enter its bundle. The actual application copy/runtime stayed frozen for build and optimized acceptance. Earlier 58-case render evidence is preserved; current coverage uses final rerenders for changed Autopilot sample data.

The separate original-checkout recommendation report retains its earlier 39-test formatter/default-on companion proof and exact copy-only patch. Its actual with/no-miss, first-comparison and missing-topic render branches are in the final catalogue. Its unmerged measurement feature still needs verified-mailbox/schema/migration integration; this lifecycle PR does not import or approve it for release.

## Delivery limits

No customer sends, real provider POSTs, production writes, billing actions, main merge, deployment or flag activation. Real inbox delivery/client rendering and hosted release migration remain unverified. Existing six live families were established at the recorded production checkpoint; the new Autopilot sender is established by current main source, with no new live-service/receipt claim here.

Keep PR #25 unmerged until owner go-ahead under `.factory/production-launch/state.md:27`. After approved release, apply migrations through 0014 before matching web/worker, then enable the existing education flag as intended. Preserve ledgers, opt-outs, retry bodies/keys and active Autopilot provenance. Pause guide-aware dispatch or stop/drain it before an older guide-unaware binary; never reset history to replay an email.
