# Blog connectors, tranche 1: five platforms proven end to end

Branch: `kenny-dev/blog-connectors-1` (from `main` @ `ea70ecb2`). Delivered as a PR; merging deploys.

## Where we start
All ten connectors in the "Add a blog connection" picker already exist in code (`src/server/services/publishing/connectors/*`): test connection, OAuth or credential setup, targets, draft, publish, refresh, images, retries, SSRF guard and dev stubs. They were built from the docs and have **only ever run against dev stubs**. No real WordPress, Ghost or Notion has received a post from Radar. The picker already hides OAuth platforms whose app isn't configured (`availablePlatforms()`).

## Problem
A founder approves an article in Radar and expects it to appear on their blog, correctly formatted, at the scheduled time. Until a connector has published to the real platform, we don't know that it does.

## This tranche (the easiest five)
| Platform | Why it's in tranche 1 | How we verify |
|---|---|---|
| Webhook | No third-party account; Radar signs and POSTs | Local receiver checks the signature and payload |
| WordPress (self-hosted) | Application Password + REST API, the most common blog | Real WordPress in Docker |
| Ghost | Admin API key, stable API | Real Ghost in Docker |
| WordPress.com | Free OAuth app, approved instantly; same post model as WordPress | Code checked against current docs and mocked-HTTP tests; live check once the owner creates the app |
| Notion | Free public integration, approved instantly | Same as WordPress.com |

**Next tranche:** Framer, Next.js (GitHub), Shopify, Webflow, Wix. They need paid plans, store or marketplace review, or newer APIs.

## Exclusions
New platforms, UI redesign, changing the publishing schedule model, and the next five.

## Acceptance criteria
- **BC-1.** For each of the five, a user can connect from Settings → Publishing (and from onboarding's publish step). **Test connection** creates a draft and deletes it, and a failure gives readable copy (401, 403, 404 and unreachable).
- **BC-2.** An approved article publishes to the platform at its time, or with **Publish now**:
  - the title, slug and meta/excerpt are set;
  - the body HTML renders correctly (headings, lists, links, embedded videos, sources);
  - the hero image is uploaded with its alt text;
  - the article shows **Published** with a working **View post** URL.
- **BC-3.** A **refresh** article updates the existing post in place (same URL), never a duplicate.
- **BC-4.** A **retry** after a failure reuses the saved remote draft. One article never makes two posts.
- **BC-5.** Platform errors are readable and mapped consistently:
  - a bad credential → "Needs reconnecting";
  - a taken slug is handled;
  - a rate limit or 5xx retries with backoff.
- **BC-6.** Webhook: the signed payload verifies with the documented scheme (`docs/webhook.md`) and has every documented field.
- **BC-7.** WordPress.com and Notion: requests match current official docs (scopes, endpoints, versions, block limits), and mocked-HTTP tests cover them. Live checks are listed as owner steps, not marked passed.
- **BC-8.** There are no regressions: typecheck, tests (baseline: the known `openrouter.qa.test.ts` snapshot failure) and build all pass, and the other five connectors are unchanged.
- **BC-9.** Docs: `docs/LAUNCH.md` covers the owner setup for WordPress.com and Notion (callback `https://radar.thally.io/api/oauth/{wpcom,notion}/callback`). `DIVERGENCES.md` logs anything that differs.

## Constraints
- Fix what breaks; don't rewrite. No new runtime dependencies.
- Dev stubs stay the default. A dev-only switch lets chosen connectors run for real locally (it is never active in production).
- Never read production env or secrets files.
