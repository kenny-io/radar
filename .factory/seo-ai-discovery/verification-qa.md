# Independent SEO / AI discoverability QA

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

Robots policy parsed successfully: information pages and HTML account/workspace routes remain crawlable; API paths excluded. Sitemap contains exactly seven public canonical URLs. All context-file links resolve; no account/private resource appears in discovery. Text context returns correct MIME, public product facts, real ownership/contact information and actual $1 / three-day / $49 / $50 billing terms. No JavaScript is required to read product details, visible Thally identity, pricing or FAQs. Auth/private/API noindex headers, anonymous redirects and legacy login return-path preservation passed.

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
