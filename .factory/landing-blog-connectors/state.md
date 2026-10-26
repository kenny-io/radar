# State: landing-blog-connectors

| ID | Task | Owner | Owns | Status | AC |
|---|---|---|---|---|---|
| L1 | Implement LBC-1…6, 8 | factory-engineer | `src/features/marketing/Home.tsx`, `OrganicSearch.tsx`, `marketing.css`, `DIVERGENCES.md` | verified by dev (ffa004de), PM copy edit to LBC-4 | 1–8 |
| L2 | Independent QA | factory-qa | none | verified (22d95f47) | 1–7 |

Next action: the owner reviews the PR and approves the merge (merging deploys).

## Released (2026-10-26)
- Merged: PR kenny-io/radar#7 into `main` as `3fe684ea`, after #9, on the owner's go-ahead. The copy says GitHub, not Next.js (owner request).
- Deployed: `radar - web` success 17:04:22Z.
- Production check, signed out (built-in browser):
  - `/` and `/features/organic-search` return 200 with no "Next.js".
  - The logo row reads Framer, Ghost, GitHub (GitHub mark), Notion, Shopify, Webflow, Wix, WordPress, WordPress.com, Webhook.
  - Content Calendar line, pricing item, FAQ ("GitHub (a pull request to your site’s repository)") and the Organic search Refreshes and Publishing lines match.
