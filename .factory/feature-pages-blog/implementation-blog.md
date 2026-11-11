# E2 blog and discovery implementation

Workspace confirmed at `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/feature-pages-blog`, base `f4e0ec581bc5c95330cb20e57fb579835b87e434`. Other engineers' shared UI/source work preserved. No commits, merges, deployments, database/API/provider calls or environment changes performed by E2.

## Delivered within ownership

- `src/lib/marketing-posts.ts`: pure, typed five-post metadata with supplied editorial dates, explicit reviewed modification date2026-11-03, read times, five-section TOCs, two related posts and feature CTAs. Unknown slugs return undefined by allowlist lookup; no file-path/content enumeration or customer records.
- `src/features/marketing/blog/`: complete supplied five article bodies as server JSX, three preserved semantic illustrative figure components, blog index/article layouts, scoped blog CSS and a client-only sticky TOC observer with listener/frame cleanup. Blog UI reuses E1's shared MkRoot/Nav/Footer and existing buttons; it never posts to customer services.
- Blog index and `[slug]` wrappers are force-static; exactly five generated slug params and dynamicParams=false plus notFound enforce the public allowlist. Root layout, homepage redirect, private appearance/auth/billing remain unchanged.
- Static `/blog/rss.xml`: escaped valid RSS2.0 with canonical permanent GUIDs, supplied dates represented consistently as RFC822, five ordered items and correct MIME. Blog metadata advertises the feed.
- SEO catalog now has16 indexable routes and18 distinct preview cards, preserving legal/bot/auth entries and indexing boundaries. Blog posts use article OG metadata and escaped BlogPosting JSON-LD with correct dates, image, mainEntityOfPage, Radar-team author and Thally/Fairspleet publisher. Sitemap automatically expands through the existing catalog; llms context links to the blog, five guides and feed.
- Nine new static1200×630 cards generated with the existing generator and design. Existing nine card files remain unchanged; curated short card headlines fit without generator changes.

## Copy/advice review applied

Followed PM content-review.md: narrowed universal AI-reporting/selection claims; removed domain-age/pagefive/difficulty-threshold and publication-frequency promises; revised the page-two title to **How to refresh pages ranking on page two** while preserving its slug/figures/section layout; explained average-position aggregation and export-based shortlist workflow; removed universal Reddit posting quotas/permission/ban guarantees; clarified reciprocal-link/spam risks and qualified-link limitations. Added primary references per guide. Backlink CTA allows optional rules-based auto-approval consistent with the deployed product. Product/marketing copy changes are limited to the new editorial content and approved metadata, not existing feature bodies.

## Checks performed

- Baseline `npm test -- src/lib/seo.test.ts`:9/9 passed before E2 edits.
- `npm run seo:cards`:18 generated; existing nine show no Git changes.
- `npm test -- src/lib/seo.test.ts src/lib/marketing-posts.test.ts`:12/12 passed, including expanded public allowlist/private exclusion, image validity/uniqueness, metadata/article type, post relations/unknown lookup, date/schema/canonical agreement and RSS XML round-tripping/GUIDs/no private data.
- `npm run typecheck`: passed twice against integrated E1/E2 source.
- `git diff --check`: passed.
- Visually inspected full-size AI-guide and Daily Brief cards: readable, no clipped text. Independent QA owns full browser/design/static/live verification; no claim of those checks is made here.

## Integration

No dependency/package/lock change, migration, new CMS or infrastructure. E1 owns all shared chrome/feature files; E2 did not edit those files. PM owns the integrated production build, source fingerprint, independent QA, release and deployment. Source is frozen for that build except explicitly reported defect fixes. Actual indexing, citations and platform preview caches are not established by these implementation checks.
