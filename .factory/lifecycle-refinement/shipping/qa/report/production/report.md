# Final production acceptance

Accept the deployed, configured #28 runtime. The separate-local report release gap is closed; #5 remains intentionally retired. This verifies wiring and observed behavior, not immediate delivery of every event email or a human inbox receipt.

Matching production commit **93be7642a7a880bca6f9c40dbc9619ff6684f5b1**:

- Web `dc0c65a0-43d5-466d-86a6-d63966a25efd` and worker `ca5180f9-89e8-4de9-b2c7-92985c6f24ef`: SUCCESS per PM Railway inspection. Actual worker image/config/registration proof: shipping/worker-final.json.
- QA independently matched all656 tracked source files to the accepted fingerprint **1cee02f75468e0468dddc800f5a3afeb977590d0c11474e874d23e3326c6813f** (657 local files includes generated next-env.d.ts). source-match.json records this distinction.
- QA independently matched all18 hosted migration hashes/timestamps and the unchanged prior17 ledger rows against local SQL/journal. Required three report tables exist; core course/guide counts remain unchanged. Actual observations=0, consistent with no fabricated history/backfill (hosted-ledger-comparison.json). Hosted audit originally records five accounts, all verified.
- PM's read-only worker proof identifies education1/stubs0, correct production APP_URL, required credentials present and all five expected crons registered, including visibility.weeklyDigest and the existing nightly measurement hook. Import/registration audit did not tick a cron.

Actual installed Chrome at https://radar.thally.io:

| Check | Result | Evidence |
| --- | --- | --- |
| Public health, invalid landing, privacy headers, oneclick method/token/body/media/size boundaries, normal-form invalid/duplicate/oversize/foreign-origin boundaries and unauthenticated API |16/16 pass| public-results.json, public.log |
| Ordinary no-business simulator sign-in/return, report section/API empty state, cache policy, existing category reads, refresh, mobile/desktop and no mutation |11/11 pass| auth-results.json, auth.log, screenshots |

No page errors. Only the provided simulator's sign-in POST was allowed in its browser; no preference PATCH, email/reset trigger, business, collection, valid unsubscribe token, artificial observation or production clock change. Public POST probes contained invalid/missing tokens and caused no preference mutation. The browser is closed; PM owns exact simulator cleanup. No credentials, recipient address or bearer token appears in this evidence.

Both local defects are closed in the deployed source: no-referrer applies to new signed endpoints, and the strict native-form null-origin exception was proved with actual Chrome locally before deployment. Production valid-token form/oneclick mutation was deliberately not repeated; the local22-scenario production-build proof and exact deployed source match cover those flows.

Report collection begins from real new observations. With zero observations at the hosted checkpoint, no weekly report can truthfully be generated yet. Monday discovery, completed-week figures, scheduling delays, cap/fairness, sender/retry identity and boundaries were proved locally with controlled clocks/fake transports; production clocks/data were not forced. Later reports require naturally collected data and an eligible Monday. Provider acceptance/human inbox delivery for a real #28 report remains unobserved, as expected at rollout. The earlier core simulator's provider-delivered reset proves its stated transport envelope only.

No unresolved observed regression or blocked check in this authorized post-deploy scope. See ../report.md for independent source/build/migration/browser acceptance, closed defects and the known pre-existing full-suite raster baseline; these limits remain explicit.
