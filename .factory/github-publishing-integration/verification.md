# Verification

## Generalized stage (scope correction; current work)

The initial adapter-stage evidence below is historical. The corrected requirement uses one repository-reasoning path for all layouts, with no flat-file fallback. `nextjs-agent.ts` performs bounded discovery, exact original-source edits, host-owned article insertion, syntax/provenance validation, one corrective proposal and a fresh independent review. `nextjs.ts` owns pinned reads, atomic commits and draft PRs with truthful validation status.

Intermediate evidence (superseded by final checks below):

- Generic planner: 39 focused tests passed; transport: 42 tests passed. Typecheck passed.
- Independent generalized contract checks, actual Astro/Jekyll/custom builds and 15 browser checks passed on their recorded intermediate revision.
- Actual configured `ai.run` provider testing used existing provider credentials only in a temporary owner-only file; no production database credentials were exported. The initial real-model custom monorepo plan succeeded and its actual output built and passed five browser checks. A source-proof mismatch in Astro failed safely; after adding a bounded strict repair, the real-model Astro plan passed and built successfully. Final pinned actual Thally reasoning remains in QA progress.
- Configured OpenRouter returned 402 and OpenAI 429; existing Anthropic failover served the successful live model calls. Final child-only tests omit unavailable routes after recording those errors. No remote provider configuration was changed.
- One unchanged HTTP deadline test failed under concurrent framework/tests load and passed in isolation. Independent broad publishing/action rerun with two workers passed 292 tests (51 reported skipped) before the final legacy-draft migration fix.
- Final transport review found persisted legacy remote drafts could bypass discovery; safe source-replanning migration is being completed before PR creation. No warning-only legacy fallback will remain.

Final source freeze: planner `c94c066afec620714c5e75bf5735547197cd1625edfd375fc20e7f8eb38b28ac`, connector `5f3356c321d4f683f99a2d484fdb4737380db6964b37e5805915fb470d3087b6`.

- Independent final combined publishing/action run with two workers: **312 passed, 51 reported skipped**. Independent generalized contract/citation/replay checks: **47 passed**. Final typecheck passed. No additional source edits after these checks. Earlier unchanged HTTP deadline timing failures occurred under concurrent build load; the final idle-build combined run passed without changing HTTP code/tests.
- Architecture final source review approved. Persisted legacy bypass is fixed by validated source replanning/migration; no warning-only old export fallback remains. Semantic review failures can receive the same single bounded correction as validator errors, with additional source inspection and a fresh final review within eight reasoning calls.
- PM isolated Radar production build: **passed**, including compilation, type validation, 34 static pages and build tracing. Source/config/public/docs/scripts copied into temporary `/var/folders/bj/3s47mgg94953kh5fty4qz3g80000gn/T/radar-github-build.kp5wyxyc`; node_modules symlinked to existing install. Command: `NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://postgres@127.0.0.1:1/radar_build APP_URL=http://localhost:3000 npm run build`. No environment files copied, no production DB or provider credentials used; original tsconfig untouched.
- Source review now explicitly separates pending runtime checks from code defects, follows observed build-generator ordering, treats expanded final files as authoritative, and identifies the business-name author fallback accurately. This did not waive host body, path, SHA, source-proof or independent-review requirements.
- Literal multiline excerpt citations resolve only when 2–4 exact, unique, ordered, nonoverlapping source fragments yield a complete actual source span within 8 KB. Invented, ambiguous, reordered and oversized citations still fail. This addresses real reviewer elision without rewriting model answers or accepting non-source text.
- Final Thally verification: **eight unchanged captured real-model responses** (including the fresh approved reviewer) passed through the final production host guards with **zero new HTTP calls**. Purpose order, exact file hashes against the actual fresh review prompt and production build, original body bytes, and routing/listing source roles were independently asserted. This is an offline response replay, not a new full provider run. Actual normal `pnpm run build`, **149 destination tests** and **eight production Chrome checks** passed on those identical six generated source files. Normal build regenerated catalog/full corpus; no manual generated-artifact source patches.
- Diverse coverage: actual Astro/Jekyll/custom builds and **15 browser checks** on model-boundary fixture outputs; actual real-model Astro/custom builds and **10 browser checks**. No confirmed material defects. Detailed distinctions and failed intermediate experiments are retained in [general-qa.md](general-qa.md).
- Ephemeral provider credential file deleted and independently confirmed absent. No secrets in repository evidence, no production DB access, no remote configuration changes and no GitHub writes/merge/deployment. Final source hashes and all relevant file hashes: `qa/general-fingerprint.json`. Deliverable is verified locally and ready for review; external GitHub/CI/deployment-preview publication remains unrun.

## Initial adapter stage (historical)

- Baseline HEAD `f9eb6178`, with pre-existing dirty files recorded in initial git status.
- `npm test -- src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/connectors.test.ts src/server/actions/publishing.test.ts`: 3 files, 70 tests passed.
- Broader baseline `npm test -- src/server/services/publishing src/server/actions/publishing.test.ts`: 246 tests passed; 51 reported skipped, with environment-dependent live connector/database suites not exercised.
- Baseline `npm run typecheck`: passed.
- Authenticated read-only GitHub inspection confirmed `thallylabs/thally-website` uses `<slug>/{page.tsx,body.tsx,content.mdx}` plus `src/lib/blog.ts` (`blogPosts: BlogPost[]`). Index page imports `blogPosts`; registry comments identify sitemap/RSS/JSON-LD/OG consumers.
- Connected GitHub tool lacked access to that repo (404); authenticated `gh` CLI provided read access. No destination mutations performed.

## Final integrated verification

- Implementation: deterministic AST planner for the supported Next.js route-folder/manual-registry convention; atomic Git tree/commit/ref update; explicit unsupported-layout errors; refresh/collision/retry handling; flat-content compatibility and accurate PR disclosure. Existing TypeScript dependency moved to runtime for AST parsing. Existing GitHub connection help updated.
- Architect approved the integrated implementation after strict registry/import/refresh/retry-marker review. Actual Thally snapshot `c44cde2f12d5170a2fbaf4e038b467b12efb161f`: new post generates 5 files; refresh changes content and registry only.
- Independent QA broad publishing/action suite: **265 passed; 51 reported skipped**. Environment-dependent live suites were not enabled. Typecheck passed.
- Independent planner probes: **8 passed**. Complete actual destination snapshot in a temporary directory with genuine Next.js/components: **7 real-browser checks passed**, including index card keyboard navigation, article rendering/reload, breadcrumb, mobile layout, direct load and generated 1200×630 OG PNG. No browser errors or failed local responses.
- PM integration review: expected source/package/docs changes only, unrelated dirty work preserved; `git diff --check` passed. No source changes after final QA fingerprint.
- Exact evidence and tested file SHA-256 values: [QA record](qa.md), `qa/fingerprint.json`, `qa/edge-result.json`, `qa/real-destination-result.json`.
- Limits: destination production build, live GitHub writes, remote deploy preview and production deployment were not run. No remote repository changes, merge or release. Existing open PRs unchanged. Verified local deliverable, ready for review.
