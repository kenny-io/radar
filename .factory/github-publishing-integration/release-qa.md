# Release QA

## Latest-main integration

Verified isolated managed worktree `/Users/ekene/.codex/worktrees/github-publishing-integration/radar-push`, branch `kenny/github-publishing-integration`, based on latest `origin/main` at `085f1d88a83868b61c8cb0665dabea87f82180d3`. This includes the six commits after the original QA base, including signup hardening and AI support. The original user's dirty checkout was not modified by release QA.

All nine feature source/test/package/help/documentation files exactly match the SHA-256 values in `qa/general-fingerprint.json`: planner `c94c066a…`, connector `5f3356c3…`. The diff contains only the publishing feature and its evidence. Package changes only promote the existing TypeScript dependency to runtime; no unrelated latest-main dependencies or source changes were overwritten. `git diff --check` passed.

Independent release checks in this worktree:

- `QA_GENERAL_TEMP=/tmp/radar-github-general-qa.vGu6Qx npx vitest run --config .factory/github-publishing-integration/qa/general-vitest.config.ts`: **47 passed**. This includes strict citation/provenance challenges and the unchanged actual-response replay. No network/provider requests or keys.
- `npm run typecheck`: **passed** using latest main's committed configuration.
- `npm run build`: **passed** on latest main with the feature. Next.js 15.5.28 compiled, checked types and prerendered 36 pages, then completed trace collection. Build performed no source/config mutations; all nine feature hashes still match afterward.
- PM separately ran `npm test -- src/server/services/publishing src/server/actions/publishing.test.ts --maxWorkers=2`: **312 passed; 51 reported skipped** on this same latest-main worktree before the build. QA did not duplicate that suite during the production build, avoiding the known pre-existing 40ms HTTP timer's CPU sensitivity.

No source changes were needed for latest-main integration. No confirmed release blocker in the verified local scope.

## Production verification

Pending PM push/PR/merge and deployment. QA found an existing authenticated Chrome Radar session; it can support a read-only settings/publishing-help smoke after deployment. No live article publish, connection save, provider call or remote website mutation is authorized for that smoke. Public health and the publishing help will be checked against the deployed release, with any missing coverage recorded explicitly.

Release QA owns only this record. PM owns Git/PR/merge/deployment and the overall release decision.
