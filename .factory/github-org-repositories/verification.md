# Verification

Baseline 8dc6f844, 2026-10-30:
- `npm test -- src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/oauth.test.ts src/server/actions/publishing.test.ts src/server/services/publishing/connectors.test.ts`: 4 files, 91 tests passed.
- Read-only authenticated GitHub UI: Connection with Radar page shows `repo` permission and Restricted thallylabs with Grant action. Same for several other owned orgs. No permissions changed; no secret access.
- Current docs: https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user and https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps confirm affiliation and separate org approval requirements.

Integrated verification pending.

Full baseline suite: `npm test` → 585 passed, 161 skipped, 1 failed (pre-existing `openrouter.qa.test.ts` golden snapshot, also documented by previous feature verification). Log: ignored `.data/github-org-baseline-tests.log`. No baseline failures in GitHub/OAuth/publishing tests.

## Integrated implementation

- Final focused suite: `npx vitest run src/client/api.test.ts src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/oauth.test.ts src/server/actions/publishing.test.ts src/server/services/publishing/connectors.test.ts` → 102 passed across 5 files (engineer; QA independently re-ran publishing coverage).
- `npm run typecheck` → passed (engineer).
- `npm test` → 596 passed, 161 skipped, same one pre-existing OpenRouter golden snapshot failure. Log `.data/github-org-final-tests.log`.
- `NEXT_DIST_DIR=.next-github-org-build npm run build` → passed, compiled/types/prerender complete. Log `.data/github-org-build.log`. Emitted client bundles explicitly checked for latest unique popup/source correlation and save generation guard.
- `git diff --check` → passed.
- Architect reviewed final code: no blocking findings. Independently re-ran `src/client/api.test.ts` → 4 passed.
- Regression coverage: 700 repositories, max4 concurrent page requests, ordered results, case-insensitive deduplication, required-page failure, ignored speculative-page failures, invalid list response, manual URL normalization/traversal and external-origin rejection, wrong-source/origin/provider OAuth messages, overlapping popup attempts, popup closed/blocked and cleanup.
- Exact tested source/test fingerprint: `86a393d451eac379cd49fa51c9c8cc5925300bbe8465c13f178f63421572089e` (SHA256 of sorted relative path + NUL + contents + NUL for 8 changed source/test files; manifest `.data/github-org-repositories/tested-source-fingerprint.json`).

Independent browser QA report: `qa.md` (local dev stubs, isolated database; live organization approval cannot be exercised without expanding app access).

## Architecture decisions

Keep existing `repo` OAuth scope, `/user/repos` affiliations, `blog.targets`, `blog.test`, `blog.saveConnection`, encrypted credentials and canonical stored owner/repo. No new dependencies, persistence/schema changes or migrations. Organization approval is an external GitHub requirement; full enumeration and manual entry cannot override it. Existing test creates/deletes a temporary branch to prove push access. OAuth popup source correlation also protects concurrent same-provider attempts. Deployment rollback is an ordinary code revert.

Independent QA completed: 102 focused tests/typecheck pass; real Chrome checks cover new manual entry/test/save/reload, edit/refresh selection and folder preservation, invalidated pending test, account switch/reauth, Webflow authorize/test/save, mobile width/keyboard/Escape. Actual local action boundaries: unauth401, nonmember404, invalid manual host400, Viewer403. No regressions observed. Limitations: real GitHub grant/SSO, forced empty/list-error UI, all arbitrary response orderings and legacy pre-picker row were not browser-tested (automated/source coverage described in qa.md). Local QA server stopped; temporary viewport and generated tsconfig changes restored.

Delivery: implementation committed as `ecd6902cd4293ef90a0ebf15e8f5918a7862fd81`, rebased onto main to exclude unrelated prior release documentation. Recomputed source/test fingerprint matches exactly after rebase. Pushed branch and created draft PR https://github.com/kenny-io/radar/pull/14; no merge/deployment. Subsequent commit changes delivery records only.
