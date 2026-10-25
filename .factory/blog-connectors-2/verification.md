# Verification: blog-connectors tranche 2

Baseline (main @ 2ddfed16): typecheck clean; `npx vitest run` 301 passed, 51 skipped, 1 failed (the known `openrouter.qa.test.ts` snapshot).

## Engineer evidence
| Task | Revision | Typecheck | Tests | Build | Live suites |
|---|---|---|---|---|---|
| C1 Framer + Next.js (A) | `kenny-dev/bc2-git` @ 2147937e | clean | 362 passed, 62 skipped, 1 baseline failure | pass | written, not run (no repo or project named) |
| C2 Shopify, Webflow, Wix, OAuth (B) | `kenny-dev/bc2-oauth` @ c21f10ad | clean | 379 passed, 60 skipped, 1 baseline failure | — | written, not run (no accounts) |

## Integrated revision ff37259a (PM)
Contents: C1 and C2 merged; the setup-error `hint` (config 422/403) shown in Test connection and the article banner; Next.js 404 copy names the repository; LAUNCH §7.4–7.9; DIVERGENCES tranche 2.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 441 passed, 71 skipped (live), 1 failed = baseline `openrouter.qa.test.ts` |
| `npx vitest run src/server/services/publishing` | 202 passed, 50 skipped |
| `NEXT_DIST_DIR=.next-pm npx next build` | pass (it rewrites `tsconfig.json`; reverted, not committed) |

## Not run
- No live suite has run against a real platform.
  - GitHub is waiting on the owner to name a throwaway repository.
  - Framer, Shopify, Webflow and Wix need owner accounts; see LAUNCH §7.9.
- The OAuth consent and install screens for GitHub, Shopify, Webflow and Wix have not been checked, because no apps exist yet.

## QA (C4)
Pending.
