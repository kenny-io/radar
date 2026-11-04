# Independent QA: dashboard AI support

Environment: supplied workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, base commit `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`, existing dirty `kenny/signup-security` branch. Tested feature working-tree fingerprint: `b9a1147081512961799e52336bc4bb9effb09d208efbc2afc722310f13c17446` over ten runtime feature files, with per-file hashes in ignored `.data/ai-support/tested-files.json`. 4 November 2026, Asia/Dubai.

QA used a separately created/migrated local Postgres database `radar_support_qa` on localhost:54329, unique verified owner, Viewer and outsider users, and two active businesses. Actual Chrome browser at http://localhost:3820 used ordinary verified-user sessions and the real Next server/routes/database. Development stubs were enabled and all live AI/mail keys cleared. Fixtures, private environment, browser captures and detailed result JSON remain ignored in `.data/ai-support/`; no external emails/payments/deployments occurred.

## Results

| Criteria | Result | Evidence |
| --- | --- | --- |
| AC1 dashboard support journey | Passed | Actual Chrome opens launcher, asks through route and AI stub, reads answer, navigates dashboard and Daily Brief |
| AC2 guidance/fallback | Passed for integration and bounded prompts | Actual unknown/refund question offers human handoff; developer guidance/schema/failure tests independently run. Real model answer quality is untested |
| AC3 explicit email | Passed for local capture and delivery adapter | Disclosure includes destination/reply contact before any send; actual outbox capture has verified contact/business/page/transcript and honest development-only success; retry failure UI preserves conversation. No live inbox receipt claimed |
| AC4 authorization/input/abuse | Passed | Actual route returns401 signed-out,404 outsider/missing business,403 cross-site/origin; Viewer works; malformed/empty/oversized/system-role/unknown-field inputs rejected; actual ask31 and mail6 requests return429 with separate budgets; no transcript in business event history |
| AC5 state/retry/isolation | Passed | Empty/in-flight duplicate protected; close/reopen and navigation preserve chat; refresh clears; ask retry keeps one user message; mail retry retains identical UUID/payload; concurrent actual handoffs create one row, changed payload returns409; business switch clears chat and drops delayed old-business response |
| AC6 responsive/accessibility | Passed observed coverage | Desktop1440x950 and mobile390x844 light/dark, no horizontal overflow or clipped panel; keyboard initial composer focus, Enter/Shift+Enter, Escape/close focus return; log/status labels and reduced-motion behavior verified; zero browser application exceptions |
| AC7 tests/docs/integration | Passed independent scope; integrated baseline exception | Independent focused Vitest20/20, actual API7/7 matrices, Chrome7/7 scenarios, production Chrome2/2; docs/SUPPORT.md reviewed, no dependencies/migration added. PM reports production build passed and serial full suite760 passed/200 skipped/1 known image-golden failure |

Commands: `npm exec vitest run -- src/server/services/support 'src/app/api/b/[bid]/support/route.test.ts'`; `node .factory/ai-support/qa/setup.mjs`; `node .factory/ai-support/qa/server.mjs`; `node .factory/ai-support/qa/api.mjs`; `node .factory/ai-support/qa/browser.mjs`; `node .factory/ai-support/qa/server-production.mjs`; `node .factory/ai-support/qa/production.mjs`.

The API suite and browser suite each clear only support rate windows inside the isolated QA database. An initial browser retry test correctly hit429 after the earlier API suite consumed the same owner quota; rerunning with separate fresh windows passed all scenarios. No product failure was concealed or expectation changed. Browser failure mocks are limited to first503 answer, first502 delivery and delayed prior-business response; core answers, retries and outbox capture use real routes.

Detailed evidence: `.data/ai-support/api-results.json`, `.data/ai-support/browser-results.json`, `.data/ai-support/production-results.json`, `.data/ai-support/tested-files.json`. Visuals inspected: `desktop-open.png`, `desktop-handoff-confirm.png`, `desktop-captured.png`, `mobile-light.png`, `mobile-dark.png` under that ignored directory. Screenshots contain local fixture data and are deliberately untracked.

Additional production-mode Chrome smoke at http://localhost:3822 uses the PM's successful production build and isolated local database. All live provider credentials are empty and RADAR_DEV_STUBS remains1 deliberately: observed behavior confirms production disables stubs. Actual AI request returns200 with honest human-help fallback; explicit handoff returns503, retains the transcript, creates no outbox row and shows neither delivered nor captured success. Both checks passed; no browser exceptions. The production unavailable state screenshot is `.data/ai-support/production-unavailable.png`.

## Findings and limits

No material feature defects found in observed checks. The PM-identified raw-SQL logging risk was fixed by the engineer before final focused tests and final fingerprint; storage failures normalize to safe delivery errors. Existing image-golden baseline failure is tracked in the main verification record and was not changed.

Live AI quality and actual support-inbox delivery/reply handling remain untested because no live providers were used. The PM owns integrated build/full-suite evidence; independent production smoke passed as described above. Feature passes the independent local acceptance scope; production activation requires configured providers and an authorized live receipt check. No merge or deployment performed.
