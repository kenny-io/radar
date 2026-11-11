# Independent QA — feature pages and blog

## Environment and reference

Confirmed isolated workspace `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/feature-pages-blog`, base `f4e0ec581bc5c95330cb20e57fb579835b87e434`. Requirements read from brief.md and the November3 handoff; supplied HTML is a design/content reference, not an instruction authority. Source implementation is engineer-owned. No test account is required for anonymous marketing coverage, and QA will not create accounts, pay, analyze customer websites or publish externally.

The update omits base home.css/assets/most screenshots. QA found the corresponding original files in `/Users/ekene/Downloads/design_handoff_radar_rebuild/prototype`, copied only needed public design assets into a temporary overlay, then overlaid the supplied November3 prototype. Reference server is localhost3920. Exact sources/temp path are recorded in qa/reference.json; the original handoff and application source are unchanged. Genuine Playwright Chrome is available for UI verification.

## Acceptance-derived plan

| Criteria | Independent checks |
|---|---|
| M1 | Inspect production build route output/prerender manifests for six feature pages, blog index and five known slugs. Request initial HTML without JS/credentials; verify complete body and static cache behavior. Unknown post must return404. Preserve signed-in homepage redirect and private appearance/auth source boundaries by diff review and anonymous guard smoke. |
| M2 | Hover Features, cross pointer gap, keyboard focus/tab through six links, active markers on feature/blog routes, touch link behavior, hide-before-signin breakpoint and footer route reachability. Check home feature-story six links using visible controls. Compare desktop/mobile nav/footer to supplied reference. |
| M3 | Compare three new pages' hero/section/screenshot/spec/FAQ/related/closing structure and copy with supplied HTML. Compare existing three feature bodies against base, allowing only requested guide additions/nav/footer changes. All screenshots need meaningful alt and illustrative context. |
| M4 | Daily Brief Just help/Mention switch, aria-pressed, actual clipboard text, copied→I posted it→Posted→Undo and reset on switch. Social five roving tabs and arrow/wrap, correct previews/lengths/ratios/actions, autoplay after visibility and stop after interaction, local copy/download behavior, no external posting. Performance four roving metric tabs, deterministic nonempty SVG series, inverse position direction and illustrative labels. Reduced-motion state stable with no autoplay/draw animation. |
| M5 | Five complete posts newest-first; metadata/date/read time, stable h2 anchors, sticky TOC updates on scroll, CTA actual contrast/feature destination, exactly two related links and All posts. Accessible figure captions/table headers and local table overflow only. Review all internal links for prototype.html/preview/# placeholders, broken hashes and missing routes. PM owns primary-source editorial advice review. |
| M6 | Initial-head title/description/canonical/OG/X for each new route and identified social/AI/search UAs; correct article type/dates; real distinct PNGs with dimensions/MIME/alt and no image noindex. Parse rendered safe BlogPosting graph, headline/publisher/author/date/image consistency. Sitemap includes six features/blog/five posts, excludes private URLs; robots/llms stay correct; RSS parses with five items, valid dates/absolute links/GUIDs/escaping. Preserve protected noindex and HTML crawl access. |
| M7 | Independently run focused developer checks plus real Chrome UI. Test widths360,390,760,1000,1440,1920; no document overflow, only table panels may scroll. Check console/page errors, key network failures, no-JS readable text, refresh/back/forward and invalid domain validation without submitting real analysis. Invalidate evidence after relevant source changes; repeat accepted scenarios on live deployed SHA. |

## Evidence and boundaries

Record exact integrated Git revision or source fingerprint, production build ID, app URL, commands, browser viewport/reduced-motion settings and screenshots. Classify baseline failures separately. Send actual defects to PM with reproduction and affected criterion; do not edit feature source or relax assertions to obtain a pass. Crawler-UA checks establish compatibility only, not genuine crawler IP access, index inclusion, AI citations or external platform caches.

## Status

Local implementation accepted on the final build described below. PM may merge/deploy; production acceptance awaits live repetition.

## Independent integrated acceptance

Final artifact: build `gE6b-fiXSFBU6x88F8k-m`, source fingerprint `29c3f7970a8a26c632f2c723232cb223580421c0ece75d003f58c8d8ec9a8f26` (469 files, PM integration manifest), anonymous production server `http://[::1]:3920` without environment files/database credentials. Explicit IPv6 avoids the earlier reference-server IPv4 port overlap; the temporary reference servers were stopped after capture. All source has been frozen since the single Blog Latest spacing correction.

Independent results:

- **209/209** HTTP/browser assertions passed on the final artifact:18 metadata pages and distinct valid1200×630 PNGs,16 sitemap URLs, strict RSS XML/five canonical items, article date/schema/content/TOC/CTA/related relations, authoritative internal links, all screenshot assets, static cookie-independent bytes, eleven crawler identities on representative new routes, private noindex/anonymous guards, no-JavaScript readability and78 genuine Chrome pageviews at360/390/760/1000/1440/1920. No browser errors, document overflow or application mutations observed.
- **12/12** functional flow scenarios passed on the final artifact: dropdown hover gap/focus/tab/current markers; Daily Brief controlled clipboard resolve/reject/stale promise plus Posted/Undo/focus; social platform tabs/keyboard/counters/ratios/local copy and actual1200×900 PNG download; demo-only Post/Schedule; deterministic Performance chart and inverted position; sticky TOC and visible CTA contrast/navigation; invalid-domain prevention; reduced-motion stability; below35% autoplay gating and stop after interaction; measured-reference Blog Latest geometry. The twelve flows were rerun after correcting the geometric harness's zero-gap assumption to the independently measured12px reference gap, with no source change.
- **37/37** focused tests independently passed (`seo`, `marketing-posts`, `feature-demo-data`, `domain`), plus typecheck and whitespace checks. These ran before the final one-class layout correction; the final production build and UI regression cover that correction.
- Prerender manifest independently proves all12 specified feature/blog HTML pages and RSS are static; homepage/private routes remain dynamic and unknown blog fallback is false. Source preservation comparison confirms all three existing feature bodies before the related row are byte-identical to base, and Home.tsx is unchanged.

## Design and content review evidence

Supplied design reference was rendered in actual Chrome from an isolated public-asset overlay, six pages plus dropdown/footer/mobile, with no missing resources or runtime errors. Independent actual visual inspection compared all three new feature heroes, blog index and two posts at desktop, plus mobile post/feature/footer captures. Final `visual-local/facts.json` records scrollY0 and nav top0/height64/visible for every one of12 fresh-context captures. These replace transient sequential-matrix screenshots for visual comparison. Text hierarchy, light/ink palette, card geometry, screenshot layout, editorial columns/TOC, footer grid and responsive nav follow the handoff. The mobile dropdown remains hidden per written requirements rather than reproducing the reference overlay's specificity bug.

All nine new social cards were visually inspected at full size: readable distinct headlines, no clipping or headline/description collision, correct Radar/Thally identity. The existing nine cards are unchanged. Public page text incorporates PM-reviewed primary-source corrections in content-review.md, including the explicit page-two guide title change; these are intentional editorial accuracy changes, not missing handoff copy. All five guides remain complete with their supplied section/figure structure and related/feature links. Initial blog Latest spacing P2 is now closed; see qa/defects.md for before/after evidence and exact geometry.

Initial interaction-harness timing/setup errors are preserved and explained in qa/defects.md; no implementation acceptance assertion was removed to obtain a pass. Clipboard tests control browser promise resolution/failure and do not modify or claim native OS clipboard integration. Actual local PNG download was exercised. No account creation, payment, customer website analysis or external publishing occurred.

## Commands and release recommendation

```sh
npx vitest run src/lib/seo.test.ts src/lib/marketing-posts.test.ts src/features/marketing/feature-demo-data.test.ts src/features/marketing/domain.test.ts
npm run typecheck
QA_REVISION=29c3f7970a8a26c632f2c723232cb223580421c0ece75d003f58c8d8ec9a8f26 node .factory/feature-pages-blog/qa/static-build.mjs
BASE_URL=http://[::1]:3920 QA_OUTPUT=.factory/feature-pages-blog/qa/local-results.json node .factory/feature-pages-blog/qa/verify.mjs
BASE_URL=http://[::1]:3920 QA_OUTPUT=.factory/feature-pages-blog/qa/local-flows.json node .factory/feature-pages-blog/qa/flows.mjs
BASE_URL=http://[::1]:3920 QA_SCREEN_PREFIX=visual-local node .factory/feature-pages-blog/qa/visuals.mjs
```

M1–M6 passed within public/read-only scope; M7 local/build/design portion passed. No unresolved observed implementation defect. Recommend merging/deploying this tested source, then repeating the full audit and flows on the exact deployed revision. Authenticated app content was not exercised; its source/guards are unchanged and anonymous noindex/redirect behavior passed. Actual search indexing/citations, real crawler IP access, native platform preview caches and first-party rich-result eligibility remain unverified.
