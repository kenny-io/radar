# Independent QA — refresh publication recovery

Workspace: `/Users/ekene/.codex/worktrees/radar-refresh-publishing/radar-push`; branch `kenny/fix-refresh-publishing`; base revision `75163f1ccf821fbe468c8a345aecb5b6de50fd2e` plus frozen feature changes. Runtime: Node 22.23.3, Vitest 3.2.7. No application server or test account was required for the changed server boundary. No production credentials, data changes, provider calls, customer retries, GitHub writes, merges or deployments were used by QA.

## Acceptance coverage

| Requirement | Result | Evidence |
| --- | --- | --- |
| RP-1 saved root-relative refresh recovery | Passed | Actual `buildPayload` resolves against the business website, sets identical canonical/refreshUrl, preserves source entry and original body; the resulting payload passes actual repository planning/route validation with mocked AI responses and no repair call. |
| RP-2 URL and route identity | Passed | External CMS host, explicit HTTP business origin, query and SPA fragment preserved; changed path, meaningful query or SPA route still rejected by actual repository validator. |
| RP-3 validation before effects; new articles | Passed | Fourteen malformed/missing/non-web/credential/control/traversal cases fail before image, AI, storage or connector calls; new article canonical/refreshUrl remain null. Developer unit suite additionally covers encoded separators, invalid escape sequences and malformed business authority. |
| RP-4 future source identity | Passed | Reviewed and independently reran developer behavior tests using actual `refreshCandidates` and `acceptSuggestion`; full URL including query and hash survives candidate creation and calendar persistence. |
| RP-5 regressions and integrated validation | Passed | Independent acceptance 23/23, broader suite 412 passed and 66 harness-dependent skips, whitespace check clean. Independent Node22 typecheck passed after PM production build completed. PM owns build evidence. |

## Commands and results

All commands ran from the workspace above using `/Users/ekene/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`:

- `node node_modules/vitest/vitest.mjs run --config .factory/refresh-publishing/qa-vitest.config.ts`: **23 passed**, one file; final frozen-source run at 22:50:24 host time, duration 1.89s.
- `node node_modules/vitest/vitest.mjs run src/server/services/publishing src/server/actions/publishing.test.ts src/server/services/autopilot src/server/services/calendar src/server/services/gsc/refresh.test.ts`: **412 passed, 66 reported skipped**, 18 files passed and 10 skipped, duration 4.72s. External CMS/live database harness tests require their explicit configured environments and were not executed. The named calendar/GSC directories currently contain no separate test files; their changed behaviors are exercised by `publishing/refreshSources.test.ts`.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed** after the PM production build.
- `git diff --check`: **passed**.
- Fingerprint recheck after build/typecheck: **all 9 files unchanged**.

No product defect found in observed scope. Existing Wix refusal warning is deliberate test fixture behavior. No test failures were waived or assertions weakened.

## Browser and deployment limits

Browser scenarios are not applicable to this patch: no UI, routing screen, interaction or client authorization code changed. These server behavior tests are not browser evidence. An authenticated production article retry, actual repository-source AI reasoning, destination CI/build/preview and live article publication were not run and must not be inferred from local acceptance. GitHub connector continues creating reviewed draft PRs; recovery of the URL validator does not prove a destination page is deployed.

Release recommendation: accept this bounded server fix for PM release review. Independent typecheck passed; PM separately reports a passing Node22 production build. It requires no database migration and repairs persisted relative targets at the next authorized retry.

Exact source fingerprints are in `qa-fingerprint.json`; reverify if source changes.
