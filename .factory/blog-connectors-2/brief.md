# Blog connectors, tranche 2: Framer, Next.js (GitHub), Shopify, Webflow, Wix

Branch: `kenny-dev/blog-connectors-2` (from `main` @ `2ddfed16`, which includes tranche 1). Delivered as a PR; merging deploys and needs the owner's go-ahead.

## Where we start
Tranche 1 (`.factory/blog-connectors/`, PR kenny-io/radar#3) proved Webhook, WordPress and Ghost against real software, and checked WordPress.com and Notion against current docs. It found real bugs: redirects that turned POSTs into GETs, refresh lookups that created duplicate posts, a WordPress.com hero image that never appeared, and an outdated Notion API version. The five connectors below were built from the docs and have **only ever run against dev stubs**.

A first read of the code found these gaps:
- **No refresh handling (all five).** No connector reads `mode`/`refreshUrl`, so a refresh entry creates a second post, or on Framer and GitHub overwrites whatever has the same slug.
- **Taken slugs overwrite other posts.** Framer upserts onto the item that has the same slug. GitHub PUTs over the existing file with its sha.
- **Swallowed errors.** GitHub's contents lookup is `.catch(() => null)`. Shopify maps every GraphQL error code to 400, so internal errors never retry.
- **Framer can't be contract-tested.** It loads `framer-api` with a `new Function` import (vitest can't mock it) and types everything as `any`. The package is now a real dependency (5.1.0).
- **Wix.**
  - It attributes posts to whichever member the members query returns first.
  - It mints a fresh token on every request.
  - Its media import may be asynchronous.
- **OAuth details to confirm against current docs:**
  - Shopify: app creation in Partners vs the Dev Dashboard, expiring offline tokens, and the HMAC check.
  - Wix: the install flow and whether the code exchange is still current.
  - GitHub: the OAuth app with the `repo` scope.
  - Webflow: whether the scopes are minimal.

## Acceptance criteria
- **BC2-1. Contract audit.** Each connector and its OAuth provider is checked against a fetched current doc page:
  - Framer Server API (`framer-api` types);
  - GitHub REST: repos, git refs, contents, pulls;
  - Shopify Admin GraphQL: blogs, articles, files;
  - Webflow Data API v2: sites, collections, items, publish;
  - Wix: OAuth, Blog draft posts, Ricos, media, members.

  Every mismatch is fixed or logged in `DIVERGENCES.md`. Each test file's header cites the doc URLs it checks against.
- **BC2-2. Test connection** creates something and removes it, leaving nothing behind. Failures read clearly: 401/403 → credentials or "Needs reconnecting", 404 → the "can't see that {target}" copy, unreachable, and platform-specific setup errors (Webflow required fields, Wix Blog not installed, GitHub no push access).
- **BC2-3. Publish.**
  - Title, slug and meta/summary are set.
  - The body renders: headings, lists, links, video and sources.
  - The hero image has alt text where the platform supports it.
  - **View post** is the real public URL (for Next.js, the PR, per DIVERGENCES #10).
- **BC2-4. Refresh** updates the existing post in place, never a duplicate. The post is found from `refreshUrl`. Only a real "not found" creates a new one; any other lookup error is rethrown.
- **BC2-5. Taken slug** on a new article never overwrites or replaces another post. It gets a free slug, or fails readably.
- **BC2-6. Retry** after a failure reuses the saved remote draft, branch or item. One article never makes two posts or two PRs.
- **BC2-7. Error mapping.**
  - A bad or expired token → 401/`auth-expired` → "Needs reconnecting".
  - 429/5xx (including GraphQL `THROTTLED`/`INTERNAL_SERVER_ERROR`) are retried.
  - Other 4xx are not retried.
- **BC2-8. Mocked-HTTP contract tests** in the style of `wpcom.test.ts`/`notion.test.ts` for all five connectors and the four OAuth providers. They are regression tests for each defect fixed.
- **BC2-9. Live checks where free.** Env-gated `*.live.test.ts` suites (skipped by default) for platforms where a token can drive the data calls without OAuth review: GitHub (a repo the owner names), Webflow site token, Shopify custom-app token, Framer project API key, and Wix where practical. Runs that couldn't happen are listed as owner steps, not marked passed.
- **BC2-10. No regressions.** Typecheck, tests (baseline: the `openrouter.qa.test.ts` snapshot) and build pass. The tranche 1 connectors are unchanged. Dev stubs still work for all ten.
- **BC2-11. Docs.**
  - `docs/LAUNCH.md` §7 has owner setup per platform, with callbacks `https://radar.thally.io/api/oauth/{webflow,wix,shopify,github}/callback`. Framer has no OAuth.
  - It notes the review or marketplace steps each platform needs.
  - It has live-check steps.
  - `DIVERGENCES.md` has a tranche 2 section; row 139 and #10 are revisited.

## Exclusions
New platforms, UI redesign, merge polling for GitHub PRs, and tranche 1 connectors except shared helpers.

## Constraints
- Fix what breaks; don't rewrite. No new runtime dependencies (`framer-api` is already one).
- Dev stubs stay the default. `RADAR_REAL_CONNECTORS` runs chosen connectors for real locally.
- Never read production env or secrets files. Never create accounts or third-party repos without the owner.

## Baseline (main @ 2ddfed16)
Typecheck clean; `npx vitest run` 301 passed, 51 skipped, 1 failed (`openrouter.qa.test.ts` snapshot).
