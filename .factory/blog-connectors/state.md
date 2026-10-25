# State: blog-connectors (tranche 1)

Branch `kenny-dev/blog-connectors-1` from `main` @ `ea70ecb2`. Delivery: a PR to `main`; merging deploys and needs the owner's go-ahead.

| ID | Task | Owner | Owns | Status | AC |
|---|---|---|---|---|---|
| B1 | Webhook, WordPress (self-hosted) and Ghost against real local instances; dev-only real-connector switch; fixes | factory-engineer A, worktree `../bc-self` | `connectors/{index,wordpress,ghost,webhook}.ts`, `publishing/{http,publisher,render,store}.ts`, `env.ts`, the Docker test harness under `scripts/`, tests | active | 1–6, 8 |
| B2 | WordPress.com and Notion against current docs; mocked-HTTP tests; owner setup docs | factory-engineer B, worktree `../bc-oauth` | `connectors/{wpcom,notion}.ts`, `publishing/oauth.ts` (wpcom and notion sections), `docs/LAUNCH.md` §7, tests | active | 1, 2, 5, 7, 9 |
| B3 | Integrate, DIVERGENCES | PM | merges, `DIVERGENCES.md` | planned | 9 |
| B4 | Independent QA in the browser (real WordPress and Ghost, webhook receiver) | factory-qa | none | planned | 1–8 |

Shared files: `publishing/types.ts` and `http.ts` belong to A. B asks the PM before changing them.

## Next action
B1 and B2 in parallel.
