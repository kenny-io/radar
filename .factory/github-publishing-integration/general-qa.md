# Generalized publishing QA (QA-2)

This record supersedes QA-1 for the corrected framework-independent request. Prior `qa.md` and adapter evidence remain historical baseline only. Their fixture scripts reference the retired adapter and are not final regression commands.

## Environment and scope

Repository `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, starting HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` plus uncommitted feature and unrelated user work. Node 22.18.0; real Chrome through Playwright; anonymous generated-site browsing. Production source was not edited by QA. No GitHub writes, PRs, merges or deployment.

Synthetic destination fixtures exercise three materially different contracts: Astro 5.13.8 automatic Markdown collection inside a nonstandard monorepo; Jekyll 4.4.1 dated posts with custom permalink; and a custom Node static site with HTML articles and arbitrary JSON catalog fields. Source/outputs, installed framework dependencies and Ruby gems stayed in `/tmp/radar-github-general-qa.vGu6Qx`. Fixtures and reproduction scripts are in `qa/general-*`.

## Independent deterministic checks

- `QA_GENERAL_TEMP=/tmp/radar-github-general-qa.vGu6Qx npx vitest run --config .factory/github-publishing-integration/qa/general-vitest.config.ts`: **47 passed** on final planner `c94c066a…` and connector `5f3356c3…`: 31 independent planner/security/recovery checks, 15 strict citation-format challenges and one unchanged real-response replay. Exact tested hashes are in `qa/general-fingerprint.json`.
- Scenarios cover discovery beyond the hint, automatic collections, dated posts, HTML/JSON integration, standalone HTML refresh retaining route/original issued date, retry identity and no-op body, invisible-content review rejection, forged source/review evidence, prompt injection, protected paths, stale SHAs, nonunique/overlapping patches, ancestor conflicts, symlinks, route traversal, malformed JSON/TypeScript and article preservation.
- `npm run typecheck`: **passed** at the final tested revision.
- `npm test -- src/server/services/publishing src/server/actions/publishing.test.ts --maxWorkers=2`: **312 passed; 51 reported skipped** on the final hashes, including 51 transport tests (positive/invalid/interrupted persisted-legacy-draft migration) and 50 planner tests. Earlier runs concurrent with CPU-heavy production builds exposed the unchanged 40ms HTTP-deadline baseline test's timing sensitivity; that file passed isolated (17 tests), and the final complete two-worker rerun with the build idle passed. No HTTP implementation/test changes were made for this feature.

## Actual framework builds and browser evidence

Mocked model responses were passed through production planner checks, and the returned files were built by the actual destination runtimes. Astro generated its new article route from the collection; Jekyll generated its dated post route; the custom builder generated the article and index from the modified JSON catalog.

- Astro: `node node_modules/astro/astro.js build` in the isolated fixture root: **passed**.
- Jekyll: isolated-gem `jekyll build`: **passed**.
- Custom: `node build.mjs`: **passed**.
- `QA_GENERAL_TEMP=/tmp/radar-github-general-qa.vGu6Qx node .factory/github-publishing-integration/qa/general-browser.mjs`: **15 browser checks across 3 built sites passed**. Each checks one public index link, keyboard navigation to complete content, reload, fresh direct load and mobile navigation without horizontal overflow. No browser page errors. Evidence `qa/general-browser-artifacts.json`.

These builds and browsers run only in QA against synthetic local repositories; Radar itself does not execute destination commands.

## Configured real-model experiments

The PM supplied existing configured provider credentials through an ephemeral external mode-0600 file. Values were never printed or saved in repository artifacts. Child processes explicitly used an unreachable loopback database URL and omitted `businessId`, preventing production data reads/writes. Real calls went through production `ai.run`; credentials were not included in prompts. Intermediate actual/private source remains temporary only.

First bounded experiment used existing configured failover. OpenRouter returned 402 and OpenAI 429, then the existing Anthropic `claude-sonnet-5.5` route served requests. Total 10 HTTP requests including the initial stopped attempt. The custom monorepo produced a complete HTML-plus-JSON plan with a fresh approval despite malicious README instructions; actual build and 5 Chrome checks passed. Astro safely rejected a source-evidence quote mismatch before writes. Evidence `qa/general-live-first-attempt.json`, `qa/general-live-result.json`.

The PM authorized a separate final budget of at most 12 requests. Its child omitted the documented unavailable OpenRouter/OpenAI routes and used the existing configured Anthropic model without remote configuration changes. Ten requests ran. Astro's initial listing proof incorrectly joined two real source regions with literal ` ... `; the host rejected it, supplied path-specific exact-quote feedback, and the single proposal repair fixed it. Fresh review approved the result; actual Astro build and Chrome checks passed. Together with the real-model custom output, **10 browser checks across 2 real-model-generated sites passed** (`qa/general-browser-live-artifacts.json`).

The pinned original Thally repository (`c44cde2f12d5170a2fbaf4e038b467b12efb161f`) was also inspected by the generalized real-model pipeline. Its fresh reviewer rejected the proposed route/content/registry integration because generated discovery catalogs were omitted and build-before-test ordering was not established; it also flagged inconsistent author metadata. That rejection is not counted as an approved original-target plan. Evidence `qa/general-live-final-result.json`; private source/proposal/review details remain only in temporary files.

QA then applied the exact rejected proposal to an isolated complete destination source archive, without manually patching catalogs. **Normal `pnpm run build` passed**, generated the article route and refreshed the catalog/full corpus automatically. **`pnpm run test --maxWorkers=2` passed 149 tests in 16 files** afterward. **Eight Chrome checks passed on the actual production export**, including public index/card navigation, article content, reload/fresh load, mobile, OG PNG and generated full corpus. Evidence `qa/general-thally-build-proposal.json` (proposal-source hashes) and `qa/general-thally-browser-thally-proposal.json`. The deploy source confirms Netlify runs `pnpm run build`; no GitHub CI workflows exist in the pinned source. Thus normal generated artifacts do not need AI patches merely because tracked. The production build does not itself resolve the author metadata review issue.

After this diagnosis, the PM authorized one final Thally-only live plan (eight requests ran) on planner `1830e519…`, with one bounded semantic correction, additional evidence inspection and a fresh review. Review still rejected the unrun build/test requirements, business-name/default-team attribution and raw-versus-expanded token representation. The host correctly applied no publishing changes. Evidence `qa/general-live-thally-final-result.json`.

The PM then authorized exactly **one fresh reviewer request**, replaying the seven actual captured discovery/proposal/review/repair responses through the final host (`cc738598…`). The source-only review contract now explicitly distinguishes business-profile author fallback from an explicit writer byline, intended raw substitution tokens from authoritative expanded final bytes, and pending runtime checks from source defects. The fresh reviewer **approved with zero issues**, but the host still rejected two evidence strings containing literal newline-ellipsis-newline joins rather than a contiguous exact quote. Each joined part separately matches the real source; the other ten evidence strings matched. This is recorded as a safe host rejection, not an approved full integration. No AI answer or proof was rewritten to force approval. Evidence `qa/general-thally-review-replay-result.json`; full private response remains temporary only.

The exact final repaired source files also passed a new clean normal production build, 149 repository tests and eight production Chrome checks. Their hashes are in `qa/general-thally-build-final-proposal.json`; browser evidence is `qa/general-thally-browser-thally-final-proposal.json`. Those runtime results establish the proposed source behavior independently and do not override the host's evidence-format rejection.

The ephemeral provider credential file was deleted immediately in the final reviewer process's `finally` block and independently confirmed absent. No credentials were saved into repository evidence, remote configuration was unchanged, and no further provider calls are authorized by QA.

## Final source-bound citation interpretation and offline acceptance

PM/engineering added a deterministic interpretation of explicit multiline excerpt citations. A contiguous exact source quote remains unchanged. Otherwise, only standalone newline-ellipsis-newline markers can separate 2–4 fragments, each at least 16 trimmed characters, each an exact unique source substring in the same file and in order without overlap. The host returns the complete actual source span, including its real intervening bytes, bounded to 8,000 UTF-8 bytes. It does not accept the model's spliced string as literal source. Inline ellipses, invented or reordered fragments, ambiguous repeats, overlapping fragments, excessive fragments, short anchors, whitespace rewrites and oversized UTF-8 spans are rejected.

Fifteen independent citation challenges passed. The eight actual captured discovery/proposal/review/repair responses, using the actual fresh approved reviewer response for the last step, then passed through the **final host with zero network requests**. Raw model response bytes were unchanged, purposes matched in order, final routing/listing proofs resolved to actual source, the exact original body was preserved once, and computed file hashes matched both the fresh review's own final proposal and the identical production-built/tested/browsed files. This is an accurately labeled replay of actual real-model work, not a claim that another complete provider run occurred. Evidence `qa/general-thally-offline-replay-result.json`.

The final accepted plan contains all six required authored source changes for the target: raw MDX, page/body/OG route wrappers, manual blog registry and manual llms overview. The destination's existing normal build regenerates derived catalogs/corpus. Its production build, 149 repository tests and eight Chrome checks cover the exact accepted file bytes (`qa/general-thally-build-final-proposal.json`, `qa/general-thally-browser-thally-final-proposal.json`). No remaining confirmed integration defect was found.

## Acceptance coverage

| Criterion | Result | Evidence |
|---|---|---|
| GPI-1 general entry point, no fixed framework adapter | Passed | Every-hint transport regressions and Astro/Jekyll/custom source fixtures |
| GPI-2 immutable source discovery beyond hint | Passed | Independent discovery fixtures, actual multi-round model observations, SHA/read guards |
| GPI-3 complete integration, body/refresh identity | Passed | Actual builds/browser flows, body byte assertion, refresh/date/route probes |
| GPI-4 protected paths/provenance/budgets | Passed | Independent adversarial checks and strict source-bound citation challenges |
| GPI-5 fresh review, rejection and bounded correction | Passed | Separate real review, negative/forged proof tests, semantic correction and unchanged-response replay |
| GPI-6 atomic files and retry/legacy behavior | Passed locally | Transport state-machine tests including interrupted writes, legacy migration and invalid records |
| GPI-7 honest draft PR and validation disclosure | Passed locally | Draft flag/PR-body assertions; planner keeps runtimeVerified=false despite separate QA runtime evidence |
| GPI-8 diverse independent verification | Passed | 47 independent checks, 312 publishing regressions, actual framework builds and browser evidence |

## Current disposition

**Ready for code review and an authorized deployment-preview check.** Generalized deterministic, multi-framework build and browser checks pass, including persisted-legacy-draft regressions. The actual original-target source plan is now accepted by the final host with exact source-bound proof and matches independently verified production bytes. Final source fingerprint is `qa/general-fingerprint.json`; no known confirmed defects remain in the tested scope.

External GitHub mutation, real authenticated Radar publishing, repository CI and remote deployment-preview checks were intentionally **not run**. Automatic discovery/review is bounded and may fail visibly on a repository that cannot be understood within its budgets; observed fixtures do not prove every possible website build. No merge or deployment occurred, and no remote release is authorized by these QA results. The PM separately owns the Radar production-build evidence and overall delivery decision.
