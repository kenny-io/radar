# Independent QA

## Tested revision and environment

Local checkout `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` plus feature working tree. Exact tested implementation/test/package/help/doc SHA-256 values are in `qa/fingerprint.json`. Unrelated pre-existing changes were preserved. Node 22.18.0; Vitest 3.2.7; real Chrome through Playwright, anonymous local fixture with no account.

Destination source was read-only `thallylabs/thally-website` at `c44cde2f12d5170a2fbaf4e038b467b12efb161f`. Repository files and compiler install stayed in isolated `/tmp/radar-github-qa.UeAb7d`; no destination source or private screenshots were saved to this repository. A complete pinned destination archive was subsequently started with genuine Next.js 16.3.5 and the existing target dependencies. The existing user checkout and its unrelated dirty files were untouched.

## Results

- GPI-1 **passed**: production planner against the actual destination tree/registry generated page/body/content/OG route plus one registry entry. Actual generated route wrappers and raw MDX compiled and rendered in Chrome; the actual destination index module consumed the modified registry.
- GPI-2 **passed locally**: independent rerun of connector transaction tests confirmed all companion files enter one Git tree/commit before article branch creation; PR body lists files and asks for preview verification. Commit-failure test leaves no partial branch. GitHub writes were mocked.
- GPI-3 **passed**: independent probes verified retry deduplication and wrapper preservation, refresh route/publication-date preservation, and avoidance of unregistered route-folder and flat-file collisions. Existing connector retry/PR reuse tests also passed.
- GPI-4 **passed**: unsupported registry/inheritance/spread, absent OG dependency, malformed imports and truncated trees fail safely; auth/network tests passed. Suspected spread/inheritance gaps were closed during implementation before final probes and no defect remains from those observations.
- GPI-5 **passed**: existing 35 flat-export tests passed, with PR disclosure that post discovery/navigation require preview verification.
- GPI-6 **passed**: the initial six-check representative browser fixture passed. A stronger seven-check real-browser pass then exercised the complete destination snapshot with its genuine BlogIndex, PostShell, MDX components and OG renderer: article-card keyboard navigation, reload, breadcrumb, mobile without horizontal overflow, fresh direct article load and a rendered 1200×630 PNG from the generated OG route. No browser errors or failed local responses.

No confirmed defects in the final tested working tree.

## Independent commands and evidence

- `npm test -- src/server/services/publishing/connectors/nextjs-integration.test.ts src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/connectors.test.ts src/server/actions/publishing.test.ts`: **89 passed**.
- `npm test -- src/server/services/publishing src/server/actions/publishing.test.ts`: **265 passed; 51 reported skipped**. Live credentials/network tests were not enabled. No new failures.
- `npm run typecheck`: **passed**.
- `QA_TEMP=/tmp/radar-github-qa.UeAb7d node --import tsx .factory/github-publishing-integration/qa/generate-fixture.ts`: production planner generated all five actual destination integration files.
- `QA_TEMP=/tmp/radar-github-qa.UeAb7d node --import tsx .factory/github-publishing-integration/qa/edge-cases.ts`: **8 passed; no defects**, details `qa/edge-result.json`.
- `QA_TEMP=/tmp/radar-github-qa.UeAb7d node .factory/github-publishing-integration/qa/browser-fixture.mjs`: **6 passed**, details `qa/browser-result.json`. Final ephemeral browser URL was `http://127.0.0.1:51004` (server closed after checks).
- `node .factory/github-publishing-integration/qa/real-destination.mjs`: **7 passed**, details `qa/real-destination-result.json`. Actual destination Next dev URL `http://localhost:3948`, anonymous Chrome, complete immutable destination snapshot overlaid with the production planner output, genuine existing components and dependencies. No shims in this pass.

Fixture preparation used `gh api repos/thallylabs/thally-website/git/trees/c44cde2f12d5170a2fbaf4e038b467b12efb161f?recursive=1`, pinned content reads, and `npm install --prefix /tmp/radar-github-qa.UeAb7d --no-package-lock --no-audit --no-fund @mdx-js/mdx@3.1.0`. This installed only into the temporary directory.

The stronger real-site pass downloaded `gh api repos/thallylabs/thally-website/tarball/c44cde2f12d5170a2fbaf4e038b467b12efb161f`, extracted it only into the temporary directory, copied the five planner-generated files, symlinked the existing `/Users/ekene/Developer/thally-suite/thally-website/node_modules`, and ran `node node_modules/next/dist/bin/next dev --webpack -p 3948` in the temporary snapshot.

## Limits and recommendation

The initial lightweight browser fixture uses representative shared-component shims, but the final stronger pass uses the complete pinned destination source and genuine components with Next.js dev compilation. A destination production build and remote deploy preview remain **not run**. No authenticated Radar publish, real GitHub branch/PR write, merge or deployment was performed. Those external release checks remain **not run**, intentionally outside this task's mutation scope. Tenant/auth UI checks are **not applicable** to the server-only integration; existing connector auth regressions passed. Observed checks do not establish support for arbitrary repository layouts.

Recommendation: ready for code review and an authorized deployment-preview check on the supported destination layout. Production release should retain the PR's explicit preview review step. Existing already-open flat-file PRs are unchanged.
