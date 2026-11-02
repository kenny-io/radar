# Search engine submission and indexability

Requested: submit Radar's public sitemap to Google Search Console and Bing Webmaster Tools, and check new feature/blog indexability.

## Live technical audit

At 2026-11-02T22:22:09Z, robots.txt and sitemap.xml returned HTTP 200; sitemap contains 16 public URLs. All six feature URLs, /blog, and five posts passed 24 public probes (Googlebot and bingbot user agents): HTTP 200, allowed by robots, no blocking X-Robots-Tag, index/follow metadata, matching self canonical, one H1, and readable main content. Raw public audit: ignored `.data/indexing/indexability.json`. User-agent probes do not establish genuine crawler access or actual indexing.

## Google

Added URL-prefix property https://radar.thally.io/; Google auto-verified through existing domain-provider ownership. Submitted sitemap.xml. Initial table briefly said Couldn't fetch; opening the details subsequently showed **Sitemap processed successfully**, last read 11/3/26, **16 discovered pages**, zero videos. Submission succeeded; actual index inclusion is separate.

Daily Brief indexed-data inspection initially reported URL unknown to Google. Live test in progress.

## Bing

Signed in with existing Google identity (basic profile/email only). Manually added https://radar.thally.io. Bing requires ownership verification; did not grant Google Search Console import access. Added the public msvalidate.01 verification tag from Bing's Radar-specific panel to existing root metadata. No runtime variables, dependencies, account flow or billing changes.

Delivery / verification pending.
