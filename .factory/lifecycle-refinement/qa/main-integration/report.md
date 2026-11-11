# Independent QA: main integration

Recommendation: accept the observed integrated change for the authorized PR update. There are no open material acceptance failures in this scope. QA did not edit product implementation, merge, deploy, send external mail or write production data. Passing observed checks does not prove every behavior correct.

## Exact source and environment

Workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`. Tested integration is lifecycle commit `96b3d730c0becd9066a28e2829728f0e84fd462f` plus incoming deployed-main source `b38b67a4d48c51f39bd5fc68e1fc4143a9633060` and the frozen merge resolutions. The commit had not yet been created when QA tested it. Final restored-configuration source SHA256: `221182093a9776bc27d34d6bcef66e5ad3646b2e3eeae76604e271225482e53a` over **612 files**; see `source-fingerprint.json` and `source-files.json` for exact paths and algorithm. This replaces the earlier LC2 fingerprint for this integration; the earlier fingerprint is not claimed to cover merged main.

Node 22.18.0; local PostgreSQL 15 at 127.0.0.1:54329; fresh database `radar_lc2_main_integration_qa_20261110` with **15 migrations through 0014**. Real installed Google Chrome used ordinary synthetic verified password owners, a fresh signup and a Viewer invitee. Dev URL was `http://localhost:3950`. Optimized URL was `http://localhost:3951`, actual NODE_ENV=production, dev stubs disabled, artifact `.next-lifecycle-integration`, BUILD_ID **TkT1HQkcSIUeAWxUTioKT**. No worker ran; server Resend key was empty, Stripe key nonfunctional, and unit provider transport mocked. Both QA servers are stopped. Final fixture counts: users 0, businesses 0, lifecycle outbox 0, guide states 0.

The final preview-only additions occurred after the optimized build; app runtime/copy source did not change. The source fingerprint includes that final preview generator, while the optimized checks cover the frozen app bundle. Generated tsconfig drift was restored by the PM before fingerprinting.

## Acceptance coverage

| Area | Result and evidence |
|---|---|
| Shared merge resolutions | Passed. Settings retains Autopilot and email controls; both business-hop and allowlisted email authentication returns work; lifecycle source/action-resolution hooks coexist with Autopilot provenance guards. Relevant developer regression suites and actual browser flows passed. |
| Deployed migration lineage | Passed. Original main 0000–0010 SQL and journal entries byte-for-byte unchanged; unpublished lifecycle migrations are 0011–0014 with all timestamps after main 0010. Independent clean, exact main 0010 upgrade and merged0013→0014 upgrade each applied all 15 migrations. |
| Preservation / no migration burst | Passed. Autopilot activation JSON, marked article provenance, failed handoff job payload/attempt count and frozen legacy mail preserved. Pre-guide upgrade also preserves explicit optout, course progress and attempted envelope. No guide enrollment from migrations. `migration-proof.json`. |
| Deployment readiness | Passed 2/2: current 0014 accepted,0013 rejected until guide schema exists. `readiness.json`. No worker launched. |
| Retry and recipient boundaries | Passed. Same-mailbox retry retains subject/body/provider key; accepted mail does not post twice; 24-hour-old failed mail does not post again; unverified owner does not receive private drafts; changed mailbox after failure blocks another POST. Developer cases also check exact 23-hour boundary, sent/logged shortcut and controlled permanent failures. |
| Master program vs optional work | Passed. Authorized master Autopilot suppresses all four optional work capture kinds and already-queued work reminders. Turning it off does not replay assigned sources. Default-on manual capture remains; source action resolution and manual adoption are retained. Education and guides keep their existing category/cap. |
| User-facing copy and catalogue | Passed. Family 29 is the actual plaintext Autopilot handoff, shared with its sender. It explains why the owner receives it, links Manage Autopilot and Email preferences, uses saved drafts and does not claim comments were posted. Article guide explicitly describes a review-first workflow with Autopilot/Blog autopilot off, and warns either can publish without separate review. Permanent family numbers and existing references preserved across added variants. |
| Actual UI/auth/tenant behavior | Passed: Settings keyboard persistence/failure handling, scoped unsubscribe, all feature and guide destinations, billing access states, signup mailbox confirmation and Viewer invite, correct business-scoped Autopilot return through login, refresh and foreign-cookie safety. |
| Final mobile/desktop rendering | Passed: all current 69 variants across29 families at 390px and 600px. Hidden preheaders stay hidden, HTML headings and logos render, documents fit width. Plaintext-only senders are labeled plaintext viewers, not represented as provider HTML. |

## Exact results

- **31/31 independent tests**, five files: prior23 acceptance assertions rerun on the new database plus 6 Autopilot/mail and 2 master/reminder overlap cases. `independent-tests.log`.
- **122/122 affected developer tests**,10 files: Autopilot DB/policy, new overlap guards, work collection/publishing, route permissions, verification, business-hop guard and Reddit copy behavior. `developer-tests.log`.
- **42/42 core real-browser checks**, `browser-results.json`; actual signup confirmation and Viewer invitation included.
- **7/7 Autopilot handoff browser checks**, `handoff-browser.json`; correct selected business, explicit publication warning, foreign business denied without changing the selected business, signed-out return and refresh persistence, no generation/payment/Autopilot action POST.
- **2/2 billing CTA arrivals**, `billing-browser-results.json`; past-due/canceled owners can reach restart/management controls, with zero billing POST and unchanged account state. No portal/payment invoked.
- **6/6 optimized build checks**, `optimized-smoke.json`; production-mode signin, enforced local billing fixture, keyboard preference persistence, authorized guide calendar arrival, public refresh guide and zero action/payment POST.
- **8/8 final numbered-catalogue browser checks**, `catalogue-browser.json`: mobile reading/index, keyboard expand/collapse, every Markdown variant, primary/all variants and category filtering. Covers final 29/69 catalogue.
- **138/138 current renders**,69 variants ×2 widths. `render-union.json` is the validated final union: original 58 variants (116 renders),10 new variants plus3 refreshed Autopilot samples (26), and the remaining neutral Backlinks variant (2). Raw execution is144 renders;6 original Autopilot scenario screenshots are superseded. Original result files remain intact. `final-preview-files.json` fingerprints final 69 HTML artifacts.
- **3 migration paths and2 readiness checks passed**, as above. Migration proof databases are distinct from the cleaned application QA database.

Final representative screenshots were visually inspected for review-first article guides, social lesson, Autopilot action/comment/error notices, missing invoice amount, expired subscription setup and first AI report without comparison. Previous bounded long-name stress evidence remains applicable to unchanged email frames; it is not counted as a new integration run. The separate local report's previous 39-test evidence remains scoped to its unchanged companion patch, SHA256 `ef8f571115fef39c79b0db0ae13f5d4eeee203f78509e563405cd34690d45022`; its additional data branches are included in the new render union.

## Findings and limits

Closed integration findings: source audit found unverified-owner delivery and stale-mailbox retry risks in incoming main's handoff path; the PM/architect approved verified-owner and immutable-recipient guards, and independent mocked-provider checks pass. The architect added a bounded 23-hour unsent idempotent retry window to prevent a late manual retry from exceeding provider key retention; fresh/expired/sent cases pass. The PM qualified the guide's review-first claims for the new master Autopilot capability. No QA product edits or weakened feature assertions were used.

Diagnostic harness issues are separate from product regressions: copied baseline test import needed its new relative path; existing developer fixtures require billing-off by default and explicit billing scenarios enable it; a dev route's initial30-second compilation timeout passed on a warmed serial rerun; an initial handoff locator used a non-existent heading; and Settings intentionally consumes its section query into persisted state. The corrected browser check verifies visible section, selected business and refresh rather than permanent query text. HTML heading checks apply to actual HTML mail, while plaintext viewers are checked as plaintext. An unmatched requested neutral variant ID was corrected with a separate render; the final union asserts every expected id/width exists.

Failed: **0 open material failures**. Blocked / unverified: no real provider POST, mailbox delivery, inbox-client rendering, production migration or live scheduling was authorized. Operational Autopilot handoffs intentionally remain outside optional lifecycle preferences, daytime and 24-hour cap; disabling Autopilot controls that delegated program. The separate AI report remains local-only with its original schema/migration/real queue/browser integration limits, so this report does not approve its release. Not applicable: deployed customer state was never changed; retired workspace-ready delivery remains removed.

PM's fresh integrated full-suite run reports 1,241 passes,65 external skips and the same raster golden baseline mismatch (expected f883614e6a7dfb07, received 91d5409f50974af7). QA independently reran the affected suites above. The same mismatch had been independently reproduced on clean main-family source during the earlier release review; the affected image source/golden are unchanged by this integration. It remains a baseline failure, not a newly passing full suite.

## Reproduction

Use Node 22, the isolated database above and dummy local secrets; never supply a real provider key. Run unit suites serially. The independent harness command is:

```sh
npx vitest run --config .factory/lifecycle-refinement/qa/main-integration/vitest.config.ts
```

Relevant developer files are the 10 passed files in `developer-tests.log`; normal fixture environment uses RADAR_DEV_STUBS=1 and RADAR_BILLING=off, with explicit scenarios controlling their own gate. Browser servers use the stated localhost canonical origin, empty RESEND_API_KEY and dummy STRIPE_SECRET_KEY. Executable QA scripts are `migrations.mjs`, `readiness.ts`, `browser.ts`, `handoff-browser.ts`, `billing-browser.ts`, `optimized-smoke.ts`, `catalogue-browser.ts` and `render-numbered.ts`; run TypeScript scripts via `node --import tsx`. Optimized server uses NEXT_DIST_DIR=.next-lifecycle-integration. Fingerprint reproduction: `python3 .factory/lifecycle-refinement/qa/main-integration/fingerprint.py`.
