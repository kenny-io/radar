# Search engine submission and indexability

Requested: submit Radar's public sitemap to Google Search Console and Bing Webmaster Tools, and check new feature/blog indexability.

## Live technical audit

At 2026-11-02T22:22:09Z, robots.txt and sitemap.xml returned HTTP 200; sitemap contains 16 public URLs. All six feature URLs, /blog, and five posts passed 24 public probes (Googlebot and bingbot user agents): HTTP 200, allowed by robots, no blocking X-Robots-Tag, index/follow metadata, matching self canonical, one H1, and readable main content. Raw public audit: ignored `.data/indexing/indexability.json`. User-agent probes do not establish genuine crawler access or actual indexing.

## Google

Added URL-prefix property https://radar.thally.io/; Google auto-verified through existing domain-provider ownership. Submitted sitemap.xml. Initial table briefly said Couldn't fetch; opening the details subsequently showed **Sitemap processed successfully**, last read 11/3/26, **16 discovered pages**, zero videos. Submission succeeded; actual index inclusion is separate.

Daily Brief indexed-data inspection initially reported URL unknown to Google. Google live tests passed for /features/daily-brief and /blog/does-chatgpt-recommend-you: URL available to Google; Page can be indexed. Blog detail confirmed smartphone Inspection Tool, crawl allowed Yes, page fetch Successful, indexing allowed Yes, correct user canonical. Google-selected canonical is only determined after indexing.

## Bing

Signed in with existing Google identity (basic profile/email only). Manually added https://radar.thally.io. Bing requires ownership verification; did not grant Google Search Console import access. Added the public msvalidate.01 verification tag from Bing's Radar-specific panel to existing root metadata. No runtime variables, dependencies, account flow or billing changes.

Production build, typecheck and all nine existing focused SEO tests passed. Local production GETs on home, Daily Brief and the AI guide each contained exactly one correct initial-head Bing tag. PR24 merged as f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49 after checking CLEAN/MERGEABLE and no configured CI checks. Web deployment 8a979ad1-0ead-4ce1-b10f-dc1e3da82b52 and worker 73105fc8-3065-4866-9dac-73e22a56fff8 in progress. No source diff between tested tree and merge.


## Production verification

Both deployments SUCCESS at f9eb6178. Public home HTTP200 contains the exact Bing verification meta tag in initial head. Postdeploy technical audit at 2026-11-02T22:32:04Z again passed all24 probes across12 feature/blog URLs, with sitemap16 entries and no failures. Readiness, robots and sitemap HTTP200. Local test server stopped. Bing accepted ownership verification and opened the Radar dashboard. Submitted https://radar.thally.io/sitemap.xml. The persisted Sitemaps table shows one known sitemap, Submitted 11/2/2026, status Processing, no last crawl yet, zero errors and zero warnings. URL discovery and actual indexing remain pending.

## Per-page indexability after deployment

| Public URL | Googlebot | Bingbot |
| --- | --- | --- |
| /features/organic-search | Pass | Pass |
| /features/ai-visibility | Pass | Pass |
| /features/backlinks | Pass | Pass |
| /features/daily-brief | Pass | Pass |
| /features/social-marketing | Pass | Pass |
| /features/performance | Pass | Pass |
| /blog | Pass | Pass |
| /blog/does-chatgpt-recommend-you | Pass | Pass |
| /blog/rank-a-new-website | Pass | Pass |
| /blog/reddit-without-getting-banned | Pass | Pass |
| /blog/page-two-refresh | Pass | Pass |
| /blog/safe-backlinks-new-sites | Pass | Pass |

Google Search Console: https://search.google.com/search-console/sitemaps?resource_id=https%3A%2F%2Fradar.thally.io%2F

Bing: https://www.bing.com/webmasters/sitemaps?siteUrl=https://radar.thally.io
