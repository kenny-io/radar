# State: blog-connectors tranche 2

Branch `kenny-dev/blog-connectors-2` from `main` @ `2ddfed16`. Delivery: a PR to `main`; merging deploys and needs the owner's go-ahead.

| ID | Task | Owner | Owns | Status | AC |
|---|---|---|---|---|---|
| C1 | Framer + Next.js (GitHub): audit, fix, contract tests, gated live tests | factory-engineer A, worktree `../bc2-git` | `connectors/{framer,nextjs}.ts` + tests, `blocksToMarkdown` in `render.ts`, `next.config.ts` (if Framer import needs it) | active | 1–10 |
| C2 | Shopify, Webflow, Wix + all OAuth providers: audit, fix, contract tests, gated live tests | factory-engineer B, worktree `../bc2-oauth` | `connectors/{shopify,webflow,wix}.ts` + tests, `oauth.ts`, `oauth.test.ts`, `env.ts`/`.env.example` (Shopify version) | active | 1–10 |
| C3 | Integrate; LAUNCH §7; DIVERGENCES | PM | merges, `types.ts`, `http.ts`, `connectors/index.ts`, `docs/LAUNCH.md`, `DIVERGENCES.md` | planned | 11 |
| C4 | Independent QA | factory-qa | none | planned | 1–11 |

Owner question open: which GitHub repo to use for the live check (or may we create a throwaway one).

## Next action
Engineers A and B work in parallel; the PM integrates.
