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

## Status

Baseline complete. Implementation and integrated local URL pending. Release recommendation withheld until integrated and live checks complete.
