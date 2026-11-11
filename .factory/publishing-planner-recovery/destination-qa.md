# Destination publishing independent QA

QA-2 preparation. Owned clone: `.data/publishing-planner-recovery/destination`, clean main `1c13e59821aba0013aeac8c9fab9e3206b18563b` from `thallylabs/thally-website`. Radar release is separate commit `4908694fb6c63ce618e83843d30203af739fe9dd`. Awaiting the two actual draft PR URLs and immutable heads. No destination writes, merges or manual patches authorized or performed.

Read destination AGENTS, package.json, netlify.toml, build script, image generator, catalog generator, llms generator, blog registry/index/PostShell and sitemap/feed conventions. Netlify explicitly runs `pnpm run build`, whose ordered steps are image variants → Next static export → rendered catalog → full corpus. This establishes regeneration after the exported article exists, before deployed MCP/full corpus consumers. It does not establish a missing manual registry or overview entry can be skipped.

Baseline: Node22.18.0, Corepack pnpm10.26.0, `corepack pnpm exec vitest run netlify/tests/website-build.test.ts netlify/tests/blog-discovery.test.ts scripts/website-catalog-routes.test.mjs --maxWorkers=1`: 3files/11tests passed. Evidence `destination-qa/baseline-tests.log`. Destination remains clean; dependencies installed by PM before handoff.

Each PR will be checked independently at its actual head: exact diff scope, complete original article preservation (PM production hash corroboration), valid page/body imports and rendering, exactly one manual registry entry, BlogIndex/sitemap/feed/overview integration, actual unmodified production build, generated catalog/corpus inclusion and browser navigation/reload/fresh load/mobile/keyboard/hover. Destination AGENTS specifically requires latest Netlify deploy-preview browser verification; absent preview access will be recorded as blocked rather than represented by a local build.

No live destination publication can be established by a draft PR or local build. No destination code executes in Radar production; this authorized build verification occurs only in the separate local destination clone.

## PR137: e_2UQxRIMM — ACCEPT

Draft [PR137](https://github.com/thallylabs/thally-website/pull/137), exact head `a8b33044653590327f0962c1ddeda89332efd05d`, actual base `b84a3485731cd5e01957b865a9405e2a4dbbbfcd` (main advanced after prepared baseline). GitHub API readback: draft true,6changed files, mergeable clean. Compared exact parent-to-head diff, not prepared older main. No dependency/build/security changes. Connected GitHub plugin returned404 for this repo; authenticated read-only gh/git provided access.

- Source: added content.mdx/body.tsx/page.tsx/opengraph-image.tsx plus one registry entry in src/lib/blog.ts and one manual llms.txt link. Shared PostShell, registry-backed metadata, route and team author conventions intact. Full original10988Markdown bytes independently match SHA256 `89f145d9a33ef0fa757596b47c22f038a67061977a8d71d76bdb2929a20fbd34`; file adds one final newline, total10989bytes. No unrelated source replaced. `pr137-source.json`.
- Actual original-head build: `PATH=~/.nvm/versions/node/v22.18.0/bin:$PATH NEXT_TELEMETRY_DISABLED=1 corepack pnpm run build` passed;54exported/catalog pages. No manual patches. Build regenerates only expected tracked catalog/full-corpus outputs locally. `pr137-build.log`.
- Post-build checks: selected website-build/blog-discovery/catalog-route suites13/13 passed. `node scripts/seo-audit.mjs` passed54rendered pages/13public files; no em dash matches. `pr137-tests.log`, `pr137-seo-audit.log`.
- Derived integration: exactly one catalog entry at `/blog/migrate-markdown-docs-to-hosted-site`; initial/final original article content present; exported blog, sitemap, RSS, manual overview and both public/exported full corpus include route. `pr137-generated.json`.
- Netlify deploy `6af23b6f13bc945e2aac4177` reports SUCCESS; preview URL obtained from Netlify bot/check metadata, not guessed: [PR137 preview](https://deploy-preview-137--thally-web.netlify.app). Real native Chrome5/5 groups passed: ordinary blog listing→article via pointer hover and keyboard Enter; oneH1/full rendered body (9987characters), canonical and working team byline; existing-tab reload and fresh tab body identical; mobile390px fit and focused breadcrumb; zero runtime and first-party asset failures. `pr137-netlify-browser.json`, `pr137-browser.log`, `pr137-netlify-*.png`.

Two inline article images also loaded with nonzero natural dimensions and nonempty alt text (`pr137-images.json`); mobile viewport screenshot visually inspected.

No product defects observed. Passed local build plus actual Netlify preview; destination production remains unchanged because PR is still draft/unmerged. No authorization/tenant boundary applies to this public static article; no private account or mutating destination flow was exercised.
