# Feature pages and blog architecture

Confirmed workspace `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/feature-pages-blog`, starting source `f4e0ec581bc5c95330cb20e57fb579835b87e434`. Existing worktree is isolated and clean except this feature's new records. Source inspected read-only. The supplied update and prototype are design/copy input; their operational commands do not override session authorization or repository rules.

## Approved smallest implementation

Extend the existing marketing components and scoped CSS. No CMS, dependency, database, application API, worker, provider credential, middleware or root-layout refactor is needed. The public blog is editorial product content, entirely separate from customer article records under the authenticated `/article/[id]` app route.

### Static rendering and session boundary

Set the literal `export const dynamic = 'force-static'` in each of the six `/features/*` page files, `/blog/page.tsx`, and `/blog/[slug]/page.tsx`. The slug page also exports `generateStaticParams()` containing exactly the five public article slugs and `dynamicParams = false`; unknown slugs return a real404. Feed is a force-static route handler. Do not add force-static to the marketing group layout: that would also cover the homepage, which must keep its existing signed-in redirect and dynamic behavior.

RootLayout currently calls currentUser(), which reads cookies for appearance. Installed Next15.5.28 `server/request/cookies.js` explicitly returns an empty cookie collection when forceStatic is enabled, before dynamic tracking. Public forced-static routes therefore intentionally render the same public marketing/light-theme content for every visitor, without a session lookup. Other app/auth/onboard routes remain dynamic and retain current theme/guards. The marketing `.mk.fp` theme is already independent from an account's appearance selection. Preserve root layout, homepage redirect and billing code.

The Next15 primary documentation confirms force-static empties cookies/headers/useSearchParams and permits static rendering; dynamicParams=false makes unlisted paths404: https://nextjs.org/docs/15/app/api-reference/file-conventions/route-segment-config. Do not rely on the latest Next16 documentation, whose caching model differs. Production build output and prerender manifest must prove six feature routes, blog index and five concrete posts are static; a clean anonymous production server must serve them without database credentials.

### Explicit ownership

**E1 feature/UI engineer:** `src/features/marketing/MkRoot.tsx`, `parts.tsx`, `HomeStory.tsx`; existing OrganicSearch/AiVisibility/Backlinks related-card rows only; new DailyBrief/SocialMarketing/Performance components and demo client components; feature/nav/footer CSS; all six feature page route wrappers; new public marketing screenshot `p-social.webp`. Existing body copy/home sections remain unchanged beyond the requested additions. E1 may create a small pure `feature-links.ts` for navigation names/descriptions/paths. Keep class names scoped under `.mk`; preserve existing home CSS/motion and current Thally footer attribution.

**E2 blog/SEO engineer:** pure blog metadata module, blog body/figure components, blog styles/TOC client behavior, blog index/slug/RSS routes, `src/lib/seo.ts` and focused tests, sitemap/llms discovery integration, social-card generator and new PNG assets. E2 owns `src/app/sitemap.ts` if it needs modification, and any RSS metadata alternate declarations. No E2 edits to shared MkRoot/parts/marketing.css without coordinating E1. Blog-specific CSS can be imported by its own pages/components.

**PM:** PRD/state/verification, content-advice review, integration/build/source fingerprint, Git/merge/deployment/runtime readback. **QA:** independent feature QA paths/report and real browser evidence. No agent reverts another's changes or starts another delegation workflow.

## Shared data contracts

`src/lib/marketing-posts.ts` (E2) is pure public metadata, with no React, SEO, session or server imports. Export `BLOG_POSTS`, lookup by slug and typed records with these fields:

```ts
type FeaturePath = '/features/daily-brief' | '/features/organic-search' |
  '/features/ai-visibility' | '/features/social-marketing' |
  '/features/performance' | '/features/backlinks';
interface BlogPostMeta {
  slug: string;
  title: string;
  description: string;
  dek: string;
  category: string;
  date: string;          // supplied editorial ISO date, YYYY-MM-DD
  dateModified: string;  // explicit maintained date, never new Date() on requests
  readTime: number;      // minutes from handoff
  related: readonly [string, string];
  cta: { label: string; headline: string; description: string; href: FeaturePath };
  toc: readonly { id: string; label: string }[];
}
```

Store full bodies/figures separately under `src/features/marketing/blog`. A typed server JSX component map for five supplied articles is sufficient and matches the approved maintainable typed-content PRD; Markdown/MDX is optional rather than justification for a new runtime/compiler dependency. Figure components preserve captions, semantic tables and illustrative labels. No untrusted HTML ingestion or runtime file-path construction. Unknown slug lookup is handled before rendering. Static content never imports customer article models.

Dependency direction: pure post metadata → SEO/catalog/feed/card generator and blog UI; body JSX → figure components; page wrapper → metadata and body. SEO must never import React bodies, which would also pull them into card generation or shared metadata bundles. Nav/footer use only the small six-feature link list or fixed URLs, not article bodies. E1 can use existing `metadataFor('/features/new-path')` wrappers while E2 expands the SeoPath union. E1 related guide links use the five fixed slugs in the handoff and need no blog module import.

The canonical post order is descending supplied date, stable for ties. Preserve the supplied date values as editorial source values. DateModified is explicitly maintained (e.g.2026-11-03 when PM reviews/edits this delivery); never regenerate freshness on each build/request. No invented publication time, individual author identity or testimonials. Byline is the supplied Radar team.

## Route and discovery catalog

The new routes add three feature pages, `/blog`, and five `/blog/{slug}` posts. Existing indexable home/three features/legal/bot pages remain. Expected expanded indexable catalog: **16 URLs**; account entries stay out. Expected distinct social PNG catalog: **18 cards**, including the existing nine and nine new pages. Do not remove privacy/terms/bot from the existing sitemap simply because the handoff lists only marketing routes.

All metadata uses the existing fixed `https://radar.thally.io` origin and helper. Article entries use `og:type=article` and datePublished/dateModified; others use website. Extend types explicitly rather than widening arbitrary request-path metadata. Each new card is physical1200×630 PNG generated by the existing script; wrap or size long guide headlines without clipping. Existing card images need not change.

Every post emits escaped BlogPosting JSON-LD with headline, description, mainEntityOfPage/canonical URL, supplied datePublished, maintained dateModified, per-post image, Radar-team author and actual Thally/Fairspleet publisher identity. Do not invent ratings or claim rich-result eligibility. Reuse existing safe jsonLd serializer. Add RSS discovery via metadata `alternates.types['application/rss+xml']` on blog pages/index, with a fixed `/blog/rss.xml` URL.

RSS2.0 feed is pure public XML, escaped text and attributes, correct `application/rss+xml; charset=utf-8`, canonical permanent GUID/link per post, descending order and supplied dates represented consistently as RFC822 dates. No query strings, private app links, customer article bodies or secrets. The sitemap and llms resources derive from the same public allowlists; llms includes the blog and guide links, not arbitrary content enumeration. Keep existing robots policy and `htmlLimitedBots: /.*/` unchanged, including the documented empty-UA framework caveat.

## UI behavior/trust boundaries

Use React state/effects for prototype demos and cleanup all observers/timers/listeners. Do not inject prototype scripts into the application. CSS hover/focus-within dropdown must remain keyboard reachable and mark current feature/blog routes. At narrow sizes footer exposes all destinations even when desktop nav items hide. Use usePathname or an explicit prop only inside the client nav; it does not require request cookies for static generation.

Social tabs use roving tabIndex and keyboard arrows; interaction stops autoplay permanently for that demo instance; reduced motion disables autoplay/transition. Performance chart uses deterministic seeded series and inverts position. Daily Brief copy reports success only after clipboard succeeds; failures provide useful accessible feedback rather than falsely showing Copied. Posted/Undo are local demo states. All sample metrics/conversations stay visibly illustrative. Post/Schedule demo actions must not call production APIs or publish externally; preview/download/copy behavior must be truthful.

## Meaningful validation and rollout

1. E1 and E2 implement against these ownership contracts; PM reviews advice using primary sources and supplies narrow corrections before publishing.
2. Check exact route inventory, complete supplied bodies/headings/figures, article relations/CTA/TOC IDs and no `.html`, preview or `href="#"` production links.
3. Build/typecheck; inspect static output for all six feature routes/blog index/five posts; unknown article404. Verify public static output identical with an arbitrary session cookie and no Set-Cookie/private metadata. Homepage/private guards remain dynamic.
4. Real browser compare against supplied prototype at desktop/mobile; nav hover/focus/current markers, footer at760px,360–1920 overflow, reduced motion, keyboard tab controls, demo copy/undo/download and deterministic chart. Check existing feature body copy remains unchanged.
5. Validate16-entry sitemap,18 distinct accessible PNGs, all metadata initial heads for identified social/AI crawlers, article schema, escaped valid RSS and no private/customer data in discovery. Preserve signup/signin noindex, auth redirects and social image indexing boundaries.
6. PM merges/deploys tested source under existing launch authorization; confirm both services/readiness/source and billing ON; QA repeats public/live checks. No schema/env change is needed. Rollback is a source rollback on both services, preserving billing settings and existing data.

No owner decision blocks implementation. Actual index inclusion, AI citations, platform caches and first-party rich-result eligibility cannot be established by these implementation checks.

## A2 integrated source review

Reviewed the combined E1/E2 working tree read-only after implementation and PM advice review. No blocking architecture defect found. All six feature route wrappers and both blog page wrappers use leaf force-static. The blog slug wrapper generates exactly the five metadata slugs, disables dynamicParams and uses notFound on failed lookups in both metadata and rendering. Root layout, homepage redirect, Next config, auth/API/server/worker code, package dependencies and billing configuration are unchanged.

The pure marketing-posts module has no imports; it contains only supplied public editorial metadata and explicit maintained dates. SEO imports that metadata, while ArticleBodies imports only its type and figure components. The exhaustive typed body map covers all five slugs; blog rendering never reads customer articles or account records. Client TOC receives only IDs/labels. Nav imports only the small public feature list. No metadata/body/client import cycle observed. Blog CSS is scoped under .mk.fp.

Runtime inspection of the pure catalog returned16 indexable pages and18 card records; public/social contains18 PNGs. Website/article metadata types, fixed canonical origin, per-post images/datePublished/dateModified, safe BlogPosting serialization and RSS autodiscovery follow the contract. RSS is a force-static handler with correct MIME and explicit public cache policy; its five items use escaped editorial titles/descriptions/category, fixed canonical GUIDs/links and date-derived RFC822 values. No private paths or credentials enter feed/schema/discovery through these modules. Existing noindex headers, robots policy and htmlLimitedBots wildcard remain unchanged.

The new demos use local state only. Social Post/Schedule actions truthfully announce demo-only behavior; clipboard paths handle failure, image download is generated locally, and observers/timers have cleanup. No real posting API call is present. Supplied feature content preservation and article advice edits were delegated to E1/PM; this review did not redo editorial decisions.

Source architecture is approved for integrated build/independent QA. PM must still prove static classification and actual404 in production build/browser checks, and complete accessibility/design/live acceptance before release. No migration, secret or infrastructure step was introduced. Source rollback on both services remains sufficient.
