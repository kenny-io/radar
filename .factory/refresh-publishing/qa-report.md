# Independent QA — publication failure UX and explicit team reporting

Workspace: `/Users/ekene/.codex/worktrees/radar-refresh-publishing/radar-push`; branch `kenny/structured-refresh-publishing`; base Radar merge `4f0100eec86dc404b13ffc2d8ff4793b319a7a18` plus frozen integrated changes. Runtime Node22.23.3. Local application `http://localhost:3851`, isolated PostgreSQL database `radar_refresh_report_qa` on localhost54329, synthetic Owner/Viewer/Outsider accounts and sessions. Development stubs enabled, billing disabled, no worker, provider/email credentials blank. No production mutation or actual email was performed by QA.

## Acceptance

| Requirement | Result | Observed evidence |
| --- | --- | --- |
| RP-9 simple public failures; retain server diagnostics | Passed | Actual article/dashboard UI shows safe copy and saved article, with no raw diagnostic canaries. Actual workspace, job polling and SSE responses omit raw error/progress/unknown-error canaries. Persisted DB diagnostics still contain the original marker. Unit projection tests cover publishing-result/status allowlists and internal remote state removal. |
| RP-10 explicit authorized reports and immutable incident | Passed | No automatic report on article load. Real local actions accept Viewer reports, reject Viewer retry403, outsider404, anonymous401, forged recipient/subject400 and nonfailed entry409. Real PostgreSQL concurrent Owner/Viewer requests produce one incident/outbox row with fixed recipient `kenny@thally.io` and exact subject `User Reported Issue on Radar`; body/unknown error fields excluded. |
| RP-11 acceptance states, retry and stubs | Passed locally | Real Chrome verifies sending/disabled, single submission, reported/disabled only on delivered=true, safe failure/retry, no raw response diagnostics, and stub response does not claim email sent. Real PostgreSQL with mocked mail transport verifies one provider call for eight concurrent teammates, actual sent persistence, immutable payload/key across ambiguous retry, empty receipt rejection then same-record success, and stubs log without network. |

## Final checks on frozen source

- `node node_modules/vitest/vitest.mjs run src/server/services/publishing src/server/actions/publishing.test.ts src/lib/publishingFailure.test.ts src/server/services/autopilot src/server/events src/server/actions/core.test.ts`: **444 passed**, 66 reported external/DB harness skips; 22files passed/10skipped. The explicit `core.test.ts` path has no standalone test file; real job polling behavior is verified by the browser/API probe. Existing Wix fixture refusal warning is intentional.
- `node node_modules/vitest/vitest.mjs run --config .factory/refresh-publishing/qa-report-vitest.config.ts`: **4/4 independent integration checks passed** against actual local PostgreSQL. Only mail transport and quota enforcement were mocked; real transaction/advisory-lock/outbox persistence paths ran. Quota values and provider-input boundaries also passed the developer service tests in the444suite. No actual email sent.
- `node .factory/refresh-publishing/qa-report-browser.mjs`: **10/10 actual Chrome browser/API scenario groups passed** against local Next dev server. See `qa-report-browser-result.json`.
- After stopping the dev server and restoring only the verified Next-generated tsconfig include/order drift: Node22 `tsc --noEmit` and `git diff --check` **passed**. No tsconfig diff remains. PM owns the subsequent production build.
- Frozen source fingerprints: `qa-report-fingerprint.json`. Report service `1fc03c3f1957b459969eb41a9f86f37a6a175aea981405dd15a9c010a9386b52`; public projection `074e6f1ec66d441101e6a66e92d7a4a1805df2ffc76b91dc65d9ed2f28eb0b14`; report component `bd3d66081e1130288b066e593c14ad1b29f2bf8ae0d7f751139bd041121c8fb2`; generic planner remains `9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de`.

## Browser evidence

The ten groups cover: desktop safe banner/draft/no automatic report; sending and duplicate-click guard; failed response with safe retry; actual stub no-delivery truthfulness; workspace/job/SSE diagnostic privacy; dashboard keyboard article navigation; mobile390px layout/focus; Viewer reporting and cross-member deduplication; role/tenant/input/status gates; zero browser runtime exceptions. Mobile screenshot was visually inspected locally and not committed. Browser width390 equals scroll width390; report and secondary Retry remain reachable with visible keyboard focus.

The successful UI receipt was deliberately intercepted with a synthetic delivered=true response, and error state with a synthetic503. These are UI state evidence, not real provider delivery. Actual backend acceptance/idempotency was tested separately with real PostgreSQL and a mocked provider response. Real stubs returned delivered=false and displayed “Your report was saved locally. No email was sent.”

Two earlier dashboard harness attempts inherited a synthetic entry left in review by the nonfailed-entry rejection check, making the dashboard prioritize that review headline. The reproducible final harness resets its own failed fixture before each run; all final assertions passed without product source changes or weakened privacy/authorization checks.

## Recommendation and remaining release evidence

**Accept the integrated bounded publishing/reporting implementation for release.** No material defect remains in observed local scope. Generic planner actual-provider/exact-destination evidence is separately recorded in `qa-followup.md` and `destination-qa.md`.

PM still owns deployed web/worker revision parity, one authorized actual issue report/provider acceptance while the article is failed, the normal production publication retry and the resulting destination PR/head/preview checks. Local tests do not establish real mailbox receipt or destination live deployment. No destination article merge was performed or authorized by QA.
