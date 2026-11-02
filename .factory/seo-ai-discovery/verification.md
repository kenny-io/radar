# Verification

## Baseline

Audit of production main e981adb: homepage and three feature pages have unique title/description; privacy/terms/bot/signup/signin inherit generic description. Checked pages lack canonical, Open Graph and X card tags. robots.txt, sitemap.xml, sitemap_index.xml, llms.txt, llms-full.txt and pricing.md return 404. Homepage text including FAQs and pricing is server-rendered and accessible with search/AI crawler user-agent strings. These probes do not establish actual crawler IP access or search indexing.

Previous launch baseline: 855 tests passed, 65 external skips and one unchanged platform-dependent raster golden failure (openrouter.qa.test.ts). This feature will run appropriate focused checks and a production build; preserve unrelated baseline behavior.

## Isolated baseline

Dependencies installed from unchanged lockfile with npm ci --ignore-scripts. Host Node24.1 (production declares Node22). Typecheck passed before source implementation. Focused auth/billing-copy/limiter baseline: 11 passed, 13 skipped (external/database harness absent). An initial test invocation used nonexistent filter paths and ran zero tests; corrected to actual repository paths. No test expectation was changed.

Independent QA baseline records discovery 404s and absent metadata in qa/baseline.json.

## Integrated build and review

Production build passed twice; final build includes the architecture correction narrowing the social workspace noindex header to exact /social, so preview PNGs remain indexable. Final local BUILD_ID: Z9EwPJaA3ZQ-rnutSxR4H. Build confirms robots/sitemap/llms/full/pricing routes are prerendered static artifacts. Local production server on port3910 uses no environment file or database credentials.

Engineer and independent QA each ran the eight SEO regression checks successfully, plus typecheck and whitespace checks. PM reviewed the integrated source, preview home card, robots body and PNG response headers; public PNG returns200 image/png and no X-Robots-Tag.

PM integration fingerprint: 439 sorted files comprising every file under src/ and public/, plus next.config.ts, package.json, package-lock.json and scripts/generate-social-cards.ts; SHA256(path + NUL + bytes) 597b6d64e02147defebe1e049c61f011ae67f23a2a76bc17c295642f1266736c. Engineer's narrower425-file handoff fingerprint is separately documented in implementation.md. No source change after the final build.

Independent local acceptance:78 checks passed,0 failed;9 public/account-entry pages,9PNG images,18 desktop/mobile browser pageviews, navigation/refresh, no-JavaScript readability,12 search/social crawler identities, static discovery link validity and protected redirect/API noindex rules. QA normalized equivalent root URLs and selected a visible footer navigation link after two initial harness assumptions failed; no source expectations were weakened and no source change was required. Full results and card gallery are in qa/local-results.json and qa/local-card-gallery.png. No deployment yet.

## Production rollout — November 3, 2026

PR21 merged as `84316883d4ad3aef16be5eea8c5a3f2f5d57e450`; head `f4fb9eca` contains a documentation-only QA record after source `8a209067`. GitHub reported no configured status checks. PM confirmed merge and local tested source/static/config/generator files are identical with git diff --exit-code.

Railway web `88e3a34b-c062-42d6-ae88-cc52f9e6be4f` and worker `73111f04-04f3-47ec-8aff-883f634b504b` both SUCCESS. Actual SSH container readbacks on both: correct merge SHA, Node22.23.3, production true, RADAR_BILLING=on, RADAR_DEV_STUBS=0, APP_URL=https://radar.thally.io, SUPPORT_INBOX=support@thally.io, lazy grandfather cutoff unset. No runtime settings changed.

PM live probes: readiness200 {ok:true}; robots200 text/plain with expected public allow/API exclusion/sitemap. All9 live social PNGs returned200 image/png, no X-Robots-Tag, and exactly matched local tested bytes (60124–77853 bytes each). Independent live browser/HTTP acceptance underway.

### Initial live result and E2 correction

Initial live verifier74/78: all9 images and18 browser pageviews passed; social crawler initial-head matrix63/63 passed. Four AI/search UAs received correct tags in the complete HTML body but not the initial head. QA recorded raw byte positions in qa/live-streaming-observation.json. This is compatibility risk for head-only readers, not missing tags in the rendered browser. Do not erase this evidence or relax the identified-crawler assertion.

E2 adds documented htmlLimitedBots: /.*/. Nine focused tests pass, including the installed Next streaming decision function for13 nonempty crawler/browser identities. The installed Next version still streams metadata for truly empty User-Agent requests; the fix makes identified crawler/browser behavior consistent without adding middleware or changing authentication. A3 architecture and official Next documentation support this decision. New439-file PM fingerprint:6c09a50b3f5d20bd42399c8024f84988485fa0d137ec49eb6c6e30b1ca3bdca3. Rebuild/local verification pending.

E2 production build `F4OinTfBN-CfkTDOH59qG` passed. New anonymous local server port3911, no database/env credentials. Independent full verifier78/78 and initial-head matrix99/99 passed across9 pages and11 social/AI/search identities;9 PNGs and18 real browser pageviews passed. QA independently ran9 focused tests. Ready for corrected-source deployment; final live acceptance pending.
