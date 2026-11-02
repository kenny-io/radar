# SEO and AI discovery architecture

Confirmed isolated workspace `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/seo-ai-discovery`, clean base `e981adb79b386687c9b57716c88aa775a9851a8b`. Source review was read-only. No infrastructure, dependency, database, session or billing changes are needed.

## Shared contract and ownership

The implementation engineer owns a pure `src/lib/seo.ts` catalog, metadata integration, discovery route handlers, structured data helper, and reproducible social image assets/generator. Architect owns this record; QA owns independent checks. Existing unrelated work is in the original checkout and must remain untouched.

- Fixed canonical production origin: `https://radar.thally.io`. Do not derive public URLs from an incoming Host/query, session, database or development APP_URL.
- Seven indexable canonical pages: `/`, `/features/organic-search`, `/features/ai-visibility`, `/features/backlinks`, `/privacy`, `/terms`, `/bot`. Signup/signin may have complete branded metadata/cards but remain noindex and outside the sitemap. Login remains a redirect, start-trial remains guarded/dynamic, and onboarding/app metadata remains noindex.
- Catalog fields: path, title, description, deterministic social-image slug/headline/alt, indexability. A factory emits unique title/description/canonical and complete Open Graph and X `summary_large_image` declarations, including absolute image URL, PNG width1200/height630 and alt.
- Root metadata provides metadataBase and a safe `noindex,follow` default. Each public entry explicitly sets `index:true,follow:true`. Never set a root homepage canonical that private children could inherit. Next merges metadata shallowly; page-level Open Graph/Twitter objects must include all required fields rather than depend on inherited images.
- Physical PNG cards at `/social/<slug>.png`, generated once from this catalog with existing canvas/bundled fonts, avoid runtime image cost and provider/network dependence. Preserve a generator and inspect long titles at native size and as thumbnails.

## Discovery and indexing

`src/app/robots.ts` allows `/`, disallows `/api/`, and links the absolute sitemap. Wildcard access already permits ordinary search and AI search crawlers; retain today's permissive model-training default rather than making a new consent choice. Do not disallow account/onboarding/app HTML in robots: crawlers need access to observe noindex. Auth guards remain the privacy boundary. A bounded `X-Robots-Tag` header for operational/API responses can supplement HTML metadata without changing access.

`src/app/sitemap.ts` emits only the seven allowlisted canonical indexable URLs. Do not invent request-time lastModified values, include query strings, or enumerate business/article/media/session IDs.

`/llms.txt`, `/llms-full.txt`, `/pricing.md` are pure static route handlers (text/plain or text/markdown with UTF-8), independent of the root layout/session/database. Their links resolve to public first-party content. Markdown/context resources may carry `X-Robots-Tag:noindex,follow` to avoid duplicate search entries without restricting fetch access. Derive prices/trial from the existing pure `src/lib/billing.ts`, not the server billing subsystem. Include Radar by Thally, Fairspleet LLC, support@thally.io, team@thally.io, $1 credited confirmation, three trial days, $49 first monthly invoice and $50 thereafter, account-wide owned-business coverage, approval/autopilot distinctions, optional disclosed backlinks and no ranking/citation guarantees. Publishing/scheduling social posts is subject to enabled channel availability.

## Entity data

Emit server-rendered homepage JSON-LD graph with stable IDs: Organization (name Thally, legalName Fairspleet LLC, URL thally.io, real contacts), WebSite (Radar, canonical Radar URL, organization publisher), SoftwareApplication/WebApplication (Radar, BusinessApplication, operatingSystem Web, same publisher and USD50 monthly offer). The offer description includes the actual trial/credit terms. Do not add fake reviews, awards, search actions, availability promises or Google/AI endorsement claims. Serialize trusted data with JSON.stringify and escape `<` as `\\u003c`; never insert customer data. Legal/feature pages can reference the same entities; account pages do not need schema.

## Validation and rollout

1. Implement pure catalog/helper, generation and discovery endpoints; integrate metadata and accurate visible product identity/pricing where needed.
2. Focused tests verify allowlist/indexability, canonical/social relationships, pricing consistency, parsed sitemap/robots, and JSON-LD escaping. Build/typecheck the combined revision.
3. Independent HTTP/browser QA covers all public pages, signup/signin noindex, redirects/gates, JavaScript-disabled readable content, server-rendered metadata for social crawler user agents, actual PNG signatures/dimensions/content types and visual quality, endpoint links, entity graph and absence of private data.
4. Deploy with existing authorization; verify live bytes/endpoints and effective source deployment. Keep billing ON and grandfathering unchanged. A source rollback reverses this changeset on both services; no migration or external provider change exists.

SEO implementation establishes discovery eligibility, not actual indexing, platform preview cache refresh, rankings or AI citations. Real crawler IP access cannot be proven by spoofing a User-Agent; report that check precisely. Search Console verification, sitemap submission or platform debugger authentication are separate operational checks when access exists.

## Primary documentation checked

- Next.js metadata generation/inheritance: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- Next.js robots and sitemap conventions: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots and https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Google AI inclusion needs ordinary SEO, not special AI files: https://developers.google.com/search/docs/appearance/ai-features
- OpenAI search/training controls are independent: https://developers.openai.com/api/docs/bots
- llms.txt remains a proposed website context convention: https://llmstxt.org/

No unresolved architecture decisions require owner input.

## A2 implementation integration review

Read-only source review of the integrated working tree checked `src/lib/seo.ts`, all nine page integrations, root metadata, `next.config.ts`, robots/sitemap, the three discovery route handlers, generator and focused tests against S1–S5. The catalog uses fixed trusted URLs and complete Open Graph/Twitter objects. Public pages explicitly opt into indexing; accounts inherit/declare noindex. The seven-entry sitemap excludes private resources. Discovery endpoints are force-static, depend only on pure constants, and have no session/database/provider import. Schema JSON parses safely, uses real entity relationships, derives USD price/credit/trial values from billing constants, and invents no reviews. Visible homepage copy now includes the first-invoice credit result.

One bounded finding was sent to the PM: the recursive private-page header pattern `/social/:path*` also matches the nine public social PNG assets under `/social/`, giving those images unintended `X-Robots-Tag:noindex,follow`. Prefer an exact `/social` private-page pattern (or exact flat-page patterns with recursive article/API exceptions). This does not prevent ordinary image fetch/unfurl but should be corrected to avoid accidental public-image indexing restrictions. No other architecture defect was found. Build/browser/live results remain owned by PM/QA and are not claimed by this source review.
