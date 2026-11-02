# SEO and AI discoverability

## User problem and delivery

Radar's public pages lack canonical URLs, social preview metadata/images, crawler discovery files and entity structured data. Implement and deploy all fixes, then verify the live site. User explicitly authorizes merge and production deployment. Base: main e981adb79b386687c9b57716c88aa775a9851a8b; branch kenny/seo-ai-discovery in an isolated managed worktree. Preserve existing billing ON and all unrelated work.

## Scope and decisions

Extend the existing dark Radar visual identity with deterministic, legible branded social cards; no website redesign. Cover home, three feature pages, privacy, terms, RadarBot and public account-entry routes as appropriate. Add robots.txt, sitemap.xml, llms.txt, useful optional Markdown context/pricing, and accurate entity/product JSON-LD. Do not invent testimonials, review ratings, rankings, citations or platform indexing. Keep existing training access defaults while making search crawler policy intentional. No customer or authenticated content belongs in discovery artifacts.

## Acceptance criteria

- S1: Every public page has accurate unique title/description and absolute canonical URL; authenticated/transactional pages have explicit noindex without breaking authentication or redirects.
- S2: Public shareable pages expose server-rendered Open Graph and X large-image metadata, correct page URLs and accessible branded preview images with accurate MIME, dimensions and alt text.
- S3: robots.txt and sitemap.xml return 200 with valid content; sitemap lists only canonical indexable public pages and is referenced by robots. Crawling policy avoids hiding noindex directives from compliant crawlers.
- S4: llms.txt and linked Markdown resources return 200, accurately describe Radar by Thally/Fairspleet LLC, supported features, pricing ($1 confirmation credited toward first month; three-day trial; $49 first invoice then $50/month), contacts and limits, and link only to authoritative public pages.
- S5: Rendered public JSON-LD accurately describes the organization, website and software with no invented claims and no private data. Visible content and machine-readable facts agree.
- S6: Integrated production build and focused checks pass; independent browser and HTTP QA verifies metadata, card images, discovery files, public navigation and noindex behavior.
- S7: Merge/deploy the tested revision and verify live endpoints, source/deployment status and continued billing ON. Report any external indexing/platform-cache checks honestly as unverified.

## Exclusions

No promise of ranking or AI citation, paid indexing services, model-training consent change, new blog/content strategy, account/payment changes, Search Console verification without available access, or posting to social platforms.
