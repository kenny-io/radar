# E1 implementation handoff

Base e981adb79b386687c9b57716c88aa775a9851a8b, branch kenny/seo-ai-discovery. No commits or deployments performed by the implementation engineer. Other agents' records preserved.

## Implemented

- Pure src/lib/seo.ts public catalog: seven indexable pages and two nonindexable account-entry pages, fixed HTTPS origin, unique descriptions/titles/canonicals and complete per-page OG/X large-image metadata.
- Root noindex/follow default; explicit public opt-in. next.config.ts adds bounded X-Robots-Tag headers to existing account/workspace/API route prefixes, including redirect responses. Authentication, billing guards and API logic unchanged.
- Nine physical 1200×630 branded PNGs under public/social, 60–80KB each. Reproduce with npm run seo:cards using existing canvas and bundled Geist fonts; no runtime image generation or new dependency.
- Pure robots/sitemap metadata routes and force-static llms.txt, llms-full.txt and pricing.md handlers, with no session/DB/environment/provider imports. The sitemap is an explicit seven-page allowlist; no fabricated last-modified timestamps. HTML remains crawlable for noindex; API crawling excluded. Existing model-training access defaults unchanged.
- Homepage escaped JSON-LD Organization/WebSite/SoftwareApplication graph, with real Thally/Fairspleet LLC identity and a USD50 offer explaining actual trial/card-credit terms. No ratings, invented claims or search actions.
- Public Markdown pricing derives $1 confirmation, three-day trial, $49 first invoice and $50 recurring price from existing billing constants. Homepage visibly clarifies the first-invoice credit; shared marketing footer links Thally.

## Checks performed

- npm run typecheck: passed twice after integration edits.
- npm test -- src/lib/seo.test.ts: eight tests passed twice. Covers public allowlist/private exclusion, metadata completeness and uniqueness, physical PNG signature/dimensions/size, redirect noindex headers, robots policy, billing arithmetic, authoritative-only links, text MIME/no-cookie headers and script-breakout-safe JSON serialization.
- git diff --check: passed.
- Viewed full AI-visibility card and nine-card contact sheet: readable, branded, no clipped titles or descriptions.

Source fingerprint after source edits: SHA256 e96eb867cd23d411e788f4195d1ed97ae3450703c8c43db6e9a706a0b8013580 across 425 sorted source/static-card/config/package/generator files (file path + NUL + bytes). Independent QA/build/live verification is owned by PM/QA and is not claimed here.

## Integration and limits

No migration, runtime variable or secret change needed. Commit the static PNGs together with metadata and generator. Keep billing ON. External platform cache refreshes, search-index inclusion and AI citations cannot be established solely by valid metadata or crawler-user-agent probes. Optional llms/Markdown files carry noindex,follow to avoid duplicate search entries while remaining fetchable. Pricing remains the homepage #pricing section; no invented standalone pricing page.

## A2 architecture correction

The social workspace header is exact `/social`, rather than `/social/:path*`, so the public PNG assets under `/social/` do not inherit noindex. Regression coverage asserts this boundary. After the correction, typecheck, all eight focused tests and whitespace checks passed again.

## E2 production metadata-streaming correction

Production QA found AI/search identities received metadata streamed into body despite social crawlers receiving a complete head. Architect approved Next's documented top-level `htmlLimitedBots: /.*/` configuration. The correction disables metadata streaming for normal nonempty user-agent identities, ensuring AI/search/social consumers receive metadata in the initial head. Root/account privacy guards, routes, prices and assets are unchanged.

Added a regression invoking the installed Next `shouldServeStreamingMetadata` decision function against 13 AI, search, social, browser and future-crawler identities. Typecheck, all nine focused tests and whitespace checks passed. Source fingerprint across the same 425-file set: `271e5a6532471d504dc0197f27ec8b5e85e445153c31ba987332957cc0f076e9`.

Installed Next internally treats an empty/missing User-Agent separately (streams despite the configured regexp); this bounded documented fix covers normal identified crawlers and browsers. PM/QA own production-mode rebuild and live initial-head matrix; no deployment or acceptance claim is made by the engineer.
