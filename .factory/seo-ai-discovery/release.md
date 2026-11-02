# SEO and AI discovery release — November 3, 2026

**Deployed and verified on https://radar.thally.io.**

PR21 https://github.com/kenny-io/radar/pull/21 delivered page metadata, social cards and discovery resources. PR22 https://github.com/kenny-io/radar/pull/22 corrected framework metadata streaming discovered during live verification. Final production source: `f4e0ec581bc5c95330cb20e57fb579835b87e434`. Both source merges were explicitly authorized by the owner.

## Delivered

- Unique titles, descriptions, absolute canonicals and complete Open Graph/X large-image metadata for home, three feature pages, privacy, terms, RadarBot, signup and signin.
- Nine distinct static 1200×630 PNG cards with Radar/Thally branding. Cards are public and indexable; account-entry pages remain noindex. Seven information pages are indexable and listed in the sitemap.
- Public robots.txt, sitemap.xml, llms.txt, llms-full.txt and pricing.md. Discovery files contain only public product information and authoritative links. Prices derive from existing billing constants: $1 card confirmation credited toward the first month, three trial days, $49 first monthly invoice and $50 thereafter.
- Homepage Organization/WebSite/SoftwareApplication JSON-LD identifying Radar, Thally and Fairspleet LLC, with accurate contacts and pricing and no invented reviews or ratings. Visible footer/pricing support the machine-readable facts.
- Safe default noindex and bounded headers for account/workspace/API responses, including redirects. HTML remains crawlable so noindex is observable; API crawling is excluded. Authentication remains the privacy boundary. Model-training access defaults were preserved.
- Identified browsers and crawlers receive canonical/social metadata in the initial HTML head. Static cards/discovery routes require no provider calls or runtime image generation.

## Production evidence

Railway web `72b405c0-8047-4948-88fb-df5f3402bb71` and worker `c3031d0d-8aa8-4897-b33e-1164758c8775` both SUCCESS at the final source SHA. SSH readbacks on both confirmed Node22.23.3, production mode, billing ON, development stubs0, correct APP_URL/support inbox and no lazy grandfather cutoff. No runtime variables, billing guards, subscriptions or database schema were changed.

Independent final live QA:

- **78/78** browser/HTTP acceptance checks, zero failures: nine metadata pages, nine PNGs,18 real Chrome desktop/mobile pageviews, navigation/reload/FAQ, no-JavaScript readability, discovery links, robots/sitemap, schema and anonymous guard/noindex behavior.
- **99/99** initial-head responses: nine pages × eleven social/AI/search identities, including the four AI/search cases that failed on the first rollout. Full verifier additionally covers Bing and12 crawler identities overall. These are user-agent compatibility probes, not proof of requests from real crawler IP ranges.
- All nine live PNGs are valid1200×630 image/png, lack noindex and match committed assets byte-for-byte. Readiness returns200 {ok:true}.

Local production build `F4OinTfBN-CfkTDOH59qG`, typecheck and nine focused tests passed. Final439-file source/static/config/generator fingerprint: `6c09a50b3f5d20bd42399c8024f84988485fa0d137ec49eb6c6e30b1ca3bdca3`. PM confirmed the merged source exactly matches the tested tree. GitHub had no configured CI/status checks; local and live checks supply the verification evidence.

Evidence: verification-qa.md; qa/live-results.json; qa/live-head-matrix.json; qa/live-asset-proof.json; qa/live-card-gallery.png. Original streaming observations remain preserved separately for audit. Local QA did not use production database credentials or mutate accounts/payments.

## Limits and rollback

Actual Google/Bing index inclusion, Search Console/Bing submission or ownership verification, AI citations, first-party rich-result eligibility and cached social-platform previews were not established by these checks. The installed Next version still permits streamed metadata for truly empty/missing User-Agent requests; the initial-head compatibility checks cover identified clients. Public discovery text remains fetchable without a user agent.

No migration or variable rollback is needed. A source rollback must target both web and worker while preserving existing billing ON/complimentary access and RADAR_SECRET_KEY. Reverting only PR22 returns the earlier metadata-streaming behavior; reverting PR21 removes the discovery resources and cards. A rollback does not cancel Stripe subscriptions or alter database records.
