# State: blog-connectors (tranche 1)

Branch `kenny-dev/blog-connectors-1` from `main` @ `ea70ecb2`. Delivery: a PR to `main`; merging deploys and needs the owner's go-ahead.

| ID | Task | Owner | Owns | Status | AC |
|---|---|---|---|---|---|
| B1 | Webhook, WordPress (self-hosted) and Ghost against real local instances; dev-only real-connector switch; fixes | factory-engineer A, worktree `../bc-self` | `connectors/{index,wordpress,ghost,webhook}.ts`, `publishing/{http,publisher,render,store}.ts`, `env.ts`, the Docker test harness under `scripts/`, tests | verified (merged 538e934c; bc-self @ f15d475c) | 1–6, 8 |
| B2 | WordPress.com and Notion against current docs; mocked-HTTP tests; owner setup docs | factory-engineer B, worktree `../bc-oauth` | `connectors/{wpcom,notion}.ts`, `publishing/oauth.ts` (wpcom and notion sections), `docs/LAUNCH.md` §7, tests | verified (merged 8b559a4a) | 1, 2, 5, 7, 9 |
| B3 | Integrate, DIVERGENCES | PM | merges, `DIVERGENCES.md` | done (87b488ed) | 9 |
| B4 | Independent QA in the browser (real WordPress and Ghost, webhook receiver) | factory-qa | none | verified (QA on e999e58d; final 87b488ed: live suite 105/106, full suite baseline only) | 1–8 |

Shared files: `publishing/types.ts` and `http.ts` belong to A. B asks the PM before changing them.

## Next action
PR to main; merge needs the owner's go-ahead. Then the owner creates the WordPress.com and Notion apps (LAUNCH §7.1–7.3) for the live checks. Tranche 2: Framer, Next.js (GitHub), Shopify, Webflow, Wix.
