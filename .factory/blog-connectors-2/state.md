# State: blog-connectors tranche 2

Branch `kenny-dev/blog-connectors-2` from `main` @ `2ddfed16`. Delivery: a PR to `main`; merging deploys and needs the owner's go-ahead.

| ID | Task | Owner | Owns | Status | AC |
|---|---|---|---|---|---|
| C1 | Framer + Next.js (GitHub): audit, fix, contract tests, gated live tests | factory-engineer A, worktree `../bc2-git` | `connectors/{framer,nextjs}.ts` + tests, `blocksToMarkdown` in `render.ts`, `next.config.ts` (if Framer import needs it) | verified by dev, merged (bc2-git @ 2147937e) | 1–10 |
| C2 | Shopify, Webflow, Wix + all OAuth providers: audit, fix, contract tests, gated live tests | factory-engineer B, worktree `../bc2-oauth` | `connectors/{shopify,webflow,wix}.ts` + tests, `oauth.ts`, `oauth.test.ts`, `env.ts`/`.env.example` (Shopify version); also `types.ts`/`store.ts` (`saveCreds`, PM-reviewed) | verified by dev, merged (bc2-oauth @ c21f10ad) | 1–10 |
| C3 | Integrate; LAUNCH §7; DIVERGENCES | PM | merges, `types.ts`, `http.ts`, `connectors/index.ts`, `actions/publishing.ts` (copy), `docs/LAUNCH.md`, `DIVERGENCES.md` | done (ff37259a) | 11 |
| C4 | Independent QA | factory-qa, worktree `../bc2-qa` @ ff37259a, re-verified d2013b1b | none | verified | 1–11 |

Owner question open: which GitHub repo to use for the live check (asked via the parent session; no answer yet).

Owner decisions logged in DIVERGENCES: Shopify App Store install flow, GitHub OAuth `repo` scope vs a GitHub App, Framer site-wide publish, Next.js refresh replacing the whole file.

## Next action
PR to main is open; merging needs the owner's go-ahead. Then: the owner names a GitHub repo for `nextjs.live`, and creates each platform's app and test account per LAUNCH §7.4–7.9.
