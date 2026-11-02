# Feature pages and blog release — November 3, 2026

**Merged, deployed and independently verified on https://radar.thally.io.**

PR: https://github.com/kenny-io/radar/pull/23. Production merge: `c0e6c5861d3d66a816c564b736102ef65f2318ff`. Tested source head: `2ae8a5db9530103d325d1010ae873a904462c2cb`. Existing launch/SEO delivery authorization covered merge and deployment.

## Delivered

- New complete Daily Brief, Social Marketing and Performance feature pages, following the supplied November3 handoff. Existing Organic Search, AI Visibility and Backlinks body copy remains intact apart from related guides. Homepage body remains intact apart from its three specified feature-story links.
- Shared keyboard/hover Features navigation, Blog link, active-page markers and responsive four-column footer with all six features, resources and real legal destinations. Thally identity and accurate trial/pricing are preserved.
- Three interactive illustrative demos: clipboard/copied/posted/undo states; five social platforms with keyboard tabs, visibility-gated autoplay and local image download; deterministic Search Console chart with inverted position. Reduced motion and failure feedback are covered. Demo actions do not publish externally.
- Blog index and five full guides, related posts/feature CTAs, sticky contents, accessible illustrative figures and responsive tables. Editorial advice was reviewed against primary sources and narrowed where the prototype overpromised; see content-review.md. Supplied editorial dates remain, with explicit November3 modification dates for reviewed edits.
- Expanded SEO/discovery:16 canonical indexable URLs,18 distinct1200×630 social cards, article Open Graph and BlogPosting JSON-LD, updated llms links and a five-item RSS feed at /blog/rss.xml. Existing nine cards remain unchanged.

The six feature pages, blog index, five posts and RSS are prebuilt. The existing homepage signed-in redirect and private application rendering remain dynamic. Public editorial posts are separate from private customer articles.

## Verification

Final local production build `gE6b-fiXSFBU6x88F8k-m`, source fingerprint `29c3f7970a8a26c632f2c723232cb223580421c0ece75d003f58c8d8ec9a8f26` across469 source/static/config/generator files. Build/typecheck and37 focused tests passed. GitHub reported no configured CI/status checks; PM inspected mergeability and confirmed merged source exactly matches the tested tree.

Independent local and live acceptance both passed:

- **209/209** HTTP/browser checks, including18 metadata/card sets,16-entry sitemap, strict five-item RSS, article schema/content/relations, static cookie-independent responses, identified-crawler initial heads, noindex/guards, no-JavaScript content and78 real Chrome pageviews across360,390,760,1000,1440 and1920px.
- **12/12** interaction checks: keyboard/focus/dropdown bridge, clipboard resolve/reject/stale completion, Posted/Undo, social counters/ratios/copy/download/demo actions, chart determinism/inversion, TOC/CTA, invalid domain, reduced motion, below35% autoplay gating and reference-matched Blog card spacing.
-18/18 live PNGs match committed assets byte-for-byte, with correct MIME/dimensions and no image noindex. RSS returns200, application/rss+xml, five items; readiness200 {ok:true}. Twelve fresh-context desktop/mobile visual captures match the accepted design with scrollY0/navtop0.

The one visual P2 defect was corrected before merge: duplicate section padding pushed the Blog Latest card140px too low. Final card top526.47px matches reference526.47px. Initial harness timing and zero-gap assumptions are retained separately; no implementation assertion was removed to obtain a pass.

Railway web `d92f7407-2071-4f82-b6f5-ba66d4908847` and worker `0dda54c3-f527-49bd-9854-0e5f04836bc9` both SUCCESS at the final merge. Actual containers confirm Node22.23.3, production mode, billing ON, stubs0, correct app/support settings and unset lazy grandfather cutoff. Actual web prerender manifest confirms all12 public feature/blog pages plus RSS static, unknown-post fallbackfalse, home/dashboard dynamic. No env, schema, billing, worker or dependency changes were made.

Evidence: verification-qa.md; qa/live-results.json; qa/live-flows.json; qa/live-asset-proof.json; qa/visual-live/; qa/static-build.json. No account/payment/customer analysis/external publishing mutation was performed during QA.

## Limits and rollback

Authenticated private page content was not exercised; its source/guards are unchanged and anonymous redirect/noindex checks passed. Actual search indexing, AI citations, genuine crawler-IP access, native social-platform preview caches and first-party rich-result eligibility remain unverified.

Source rollback must target both services to the prior successful source `f4e0ec58`, preserving billing ON, existing complimentary access and RADAR_SECRET_KEY. No database or variable rollback is needed. A rollback removes these new public pages/feed; it does not modify customer articles or cancel subscriptions.
