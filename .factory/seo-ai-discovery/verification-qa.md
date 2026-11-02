# Independent SEO / AI discoverability QA

**Final status: accepted live on November 3, 2026.** Corrected production merge `f4e0ec581bc5c95330cb20e57fb579835b87e434` passed the complete **78/78** independent HTTP/browser suite and **99/99** initial-head compatibility matrix, with zero failures. Historical checkpoints below retain the first deployment's streaming observation and its verified correction.

## Scope and baseline

Workspace: `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`; branch `kenny/seo-ai-discovery`; baseline `e981adb79b386687c9b57716c88aa775a9851a8b`. Requirements: brief.md S1–S7. No authenticated account supplied or required for public checks. All production checks are read-only; no signup, analysis, billing or publishing actions.

Baseline on November 3, 2026: 14 HTTP checks using an AI-search user agent confirmed missing discovery routes (404) and missing canonical/social metadata. Evidence: `qa/baseline.json`. A fresh isolated Playwright Chrome browser confirmed the rendered homepage has no OG/X tags, JSON-LD or canonical, one H1, and no desktop horizontal overflow. Chrome DevTools itself reported a profile conflict; Playwright Chrome successfully supplied genuine browser coverage instead.

## Planned acceptance coverage

- **S1:** Independent public-route inventory; unique titles/descriptions; one production absolute canonical per rendered page; account/onboarding/app and API indexing controls; anonymous redirect behavior preserved. No indexing policy is treated as authorization.
- **S2:** Parse initial response HTML with crawler identities, check OG/X consistency with page metadata, image URL/alt/dimensions/type, fetch/decode each image, and visually inspect branded cards. Check invalid card identifiers return 404.
- **S3:** Read robots/sitemap, parse XML, verify sitemap membership excludes transactional/auth/private URLs and includes all canonical public information pages; check listed URLs return 200 and agree with canonicals. Avoid conflicting Disallow/noindex rules.
- **S4:** Fetch llms and every linked public Markdown resource, validate product identity, plan/trial credit wording, limitations and contact addresses against visible pages. Verify no secret/customer/private app data and no invented guarantees. Check links resolve.
- **S5:** Inspect rendered JSON-LD in a real browser; parse each block and validate stable identifiers, relationships, price facts and visible-content consistency. Do not equate syntax checks with Google rich-result eligibility.
- **S6:** Independently run focused developer checks plus real-browser desktop/mobile navigation, reload, headings, overflow, console/network errors and public account-entry controls. Record source revision/fingerprint to invalidate stale results after source changes.
- **S7:** Repeat HTTP/browser checks on production after PM deploys. PM owns actual deployment/source and continued billing-ON readback. Real platform scraper caches and actual search index/citations remain unverified unless their first-party tools are exercised.

## Integrated local acceptance — passed

Tested artifact: production build `Z9EwPJaA3ZQ-rnutSxR4H`, running at `http://localhost:3910`; runtime source fingerprint (439 files, PM integration manifest) `597b6d64e02147defebe1e049c61f011ae67f23a2a76bc17c295642f1266736c`. PM started the production server without .env files/database credentials. Anonymous sessions only; no account or payment mutations. Baseline Git HEAD remains e981adb while this source is awaiting commit.

Independent verifier: **78 passed, zero failed**, including nine complete page metadata sets, nine actual 1200×630 PNG image responses and 18 genuine Chrome desktop/mobile page views. All image responses lack noindex, including `/social/home.png` after the architect's route-header collision fix. Checked 12 search/social user-agent identities including Facebook, LinkedIn, X/Twitter, Slack, Discord, WhatsApp and Telegram; page metadata and image access passed. These are UA smoke checks, not actual platform crawler IP or preview-cache verification.

Robots policy parsed successfully: information pages and HTML account/workspace routes remain crawlable; API paths excluded. Sitemap contains exactly seven public canonical URLs. All first-party context-file links resolve; the external Thally homepage was separately fetched successfully (200). No account/private resource appears in discovery. Text context returns correct MIME, public product facts, real ownership/contact information and actual $1 / three-day / $49 / $50 billing terms. No JavaScript is required to read product details, visible Thally identity, pricing or FAQs. Auth/private/API noindex headers, anonymous redirects and legacy login return-path preservation passed.

An additional **63/63 response matrix** (nine metadata pages × seven social user-agent identities) checked the actual initial HTML head for the canonical plus all OG title/description/URL/type/image and X card/title/description/image declarations. All occurred once in the initial head, rather than only in later streamed body content. This stronger assertion is retained in the reusable verifier for live checks.

Rendered homepage JSON-LD parses and describes Thally/Fairspleet LLC, Radar by Thally and Radar software with actual USD50 offer/trial-credit description and no invented ratings. Public desktop/mobile navigation through the visible footer, FAQ expansion and reload passed, with no browser runtime errors or horizontal overflow. Seven information-page cards were independently rendered as browser thumbnails and visually inspected: readable text, distinct page headlines, consistent branding, no clipping seen. The engineer's nine-card source contact sheet was also visually inspected, including account-entry cards.

Commands:

```sh
npx vitest run src/lib/seo.test.ts
npm run typecheck
git diff --check
BASE_URL=http://localhost:3910 QA_REVISION=597b6d64e02147defebe1e049c61f011ae67f23a2a76bc17c295642f1266736c QA_OUTPUT=.factory/seo-ai-discovery/qa/local-results.json QA_CARD_GALLERY=.factory/seo-ai-discovery/qa/local-card-gallery.png node .factory/seo-ai-discovery/qa/verify.mjs
```

Focused developer tests independently passed **8/8**; typecheck and whitespace check passed. Evidence: `qa/local-results.json`, `qa/local-card-gallery.png`, `qa/verify.mjs`.

The initial verifier run exposed two test assumptions, corrected without changing implementation: equivalent root URLs with/without the trailing slash are now normalized before comparison; browser navigation now clicks the actual visible footer link rather than an inactive overlapping scroll-story panel. The full final verifier was rerun successfully after those harness corrections.

**Acceptance:** S1–S6 passed within the public/read-only scope; no unresolved implementation defect observed. Authenticated account content was not exercised and is protected by unchanged guards plus inherited root noindex policy/source review. S7 awaits authorized deployment and production verification. Recommend merging/deploying this tested source, then repeat the verifier live. Actual indexing, citations, first-party rich-result eligibility and external platform caches remain unverified.

## First deployment / streaming compatibility finding

First deployed merge `84316883d4ad3aef16be5eea8c5a3f2f5d57e450`: seven social identities × nine pages passed **63/63** initial-head checks; full public/browser checks passed except four strengthened AI/search head assertions (**74/78**). OAI-SearchBot, PerplexityBot, Claude-SearchBot and Googlebot received correct canonical/OG/X tags in the full response body, after `</head>`, rather than in the initial head. Rendered Chrome still saw correct metadata. This is a compatibility risk for head-only consumers, not evidence that real search engines cannot index the pages.

Evidence preserved in `qa/live-before-streaming-fix.json`, `qa/live-head-matrix-before-streaming-fix.json` and `qa/live-streaming-observation.json`. The architect approved disabling Next metadata streaming for normal nonempty user-agent strings via `htmlLimitedBots: /.*/`; implementation is now awaiting rebuilt local and follow-up live acceptance. **Final release recommendation is withheld until those checks pass.** The installed Next framework still has a special empty/missing user-agent path; no middleware/framework patch or claim for that case is in scope.

## Streaming correction — rebuilt local acceptance passed

Production build `F4OinTfBN-CfkTDOH59qG`, tested at `http://localhost:3911`, runtime fingerprint `6c09a50b3f5d20bd42399c8024f84988485fa0d137ec49eb6c6e30b1ca3bdca3` (439 files). The full verifier passed **78/78**, including all strict initial-head assertions, nine metadata pages, nine valid PNG responses and 18 real desktop/mobile Chrome page views. The separate nine-page × eleven social/AI/search user-agent initial-head matrix passed **99/99**. Focused SEO tests independently passed **9/9**, including the installed-Next decision regression. No implementation acceptance assertion was removed to obtain these results.

Evidence: `qa/local-results.json`, `qa/local-head-matrix.json`, `qa/local-card-gallery.png`; reusable matrix command is `BASE_URL=http://localhost:3911 QA_REVISION=6c09a50b3f5d20bd42399c8024f84988485fa0d137ec49eb6c6e30b1ca3bdca3 QA_OUTPUT=.factory/seo-ai-discovery/qa/local-head-matrix.json node .factory/seo-ai-discovery/qa/head-matrix.mjs`. Recommend deploying this corrected source, then repeating both suites live. S7 remains pending the follow-up deployment.

## Final live acceptance — passed

Environment: `https://radar.thally.io`, corrected deployed merge `f4e0ec581bc5c95330cb20e57fb579835b87e434` (PR22, following PR21). Live checks ran on November 3, 2026, around 01:35 Dubai. PM confirmed both deployments SUCCESS and the actual web/worker runtime source SHA, production mode, stubs disabled and billing still ON. The PM also confirmed final merge runtime/assets match the locally tested fingerprint. QA independently confirmed production readiness `200 {"ok":true}` with the expected operational noindex header.

- **78/78** full-suite checks passed: nine complete unique metadata sets, correct absolute canonical/OG/X URLs, nine valid public 1200×630 PNGs, seven canonical sitemap entries, correct robots policy, all discovery files and linked first-party URLs, safe context/accurate pricing and ownership, explicit account/private/API noindex, anonymous redirects and preserved legacy return path.
- **99/99** initial-response checks passed: nine pages × eleven identified social/AI/search user agents. Canonical plus OG title/description/URL/type/image and X card/title/description/image occur once in the initial head. The four previously streamed AI/search cases now pass unchanged strict assertions.
- **18 real Chrome page views** passed at desktop 1440×1000 and mobile 390×844, plus navigation, FAQ expansion, refresh, no-JavaScript readability and runtime-error checks. Rendered JSON-LD parses with correct entity relationships and pricing; visible homepage Thally identity and $49 first invoice match the machine-readable facts. No horizontal overflow or runtime error was observed.
- All **nine live PNGs match committed source bytes exactly**, and none carries a noindex response header. The live browser card gallery was visually inspected; branded headlines and supporting copy remain readable without clipping.

Evidence: `qa/live-results.json`, `qa/live-head-matrix.json`, `qa/live-asset-proof.json`, `qa/live-card-gallery.png`. Reproducible scripts are `qa/verify.mjs` and `qa/head-matrix.mjs`; set `BASE_URL=https://radar.thally.io`, `QA_REVISION=f4e0ec581bc5c95330cb20e57fb579835b87e434` and an appropriate `QA_OUTPUT` path.

**Acceptance coverage:** S1–S7 passed within the authorized public/read-only scope. No unresolved implementation defect was observed. No signup, account creation, analysis, payment or publishing mutation was performed. Authenticated private-page content was not independently opened; unchanged guards and inherited noindex policy were inspected, and anonymous responses were verified. Search Console/Bing submission or actual indexing, AI citations, real crawler IP access, first-party rich-result eligibility and native social-platform publication/preview caches remain unverified and are not inferred from user-agent probes. The documented empty/missing-UA Next behavior remains a narrow framework limitation; normal identified crawlers all passed. Recommend accepting the deployed release.
