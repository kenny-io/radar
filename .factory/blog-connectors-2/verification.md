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

## QA (C4): independent verification on ff37259a
Environment:
- The QA worktree `bc2-qa`, a detached HEAD.
- Its own Postgres container `radar-bc2-qa-db` on :54339, which has since been removed.
- The app on :3102 with `RADAR_DEV_STUBS=1`, plus a second run with `RADAR_REAL_CONNECTORS=framer,nextjs,webflow`.
- The built-in browser pane for Framer connect. Playwright (the repo's 1.64.1, Chromium) for the OAuth popups and the 375 px checks.

Evidence is in the PM scratchpad, under `evidence/` and `scripts/`. It includes 30 screenshots and is not committed.

| Check | Result |
|---|---|
| Typecheck, `npx vitest run`, `next build` | clean; 441 passed, 71 skipped, 1 failed (baseline only); pass |
| Real `@mdx-js/mdx` compile and render of `blocksToMarkdown` / `mdxFile` output | 24 of 25: every case compiled. Literal `&copy;`/`&amp;` were decoded (defect 1) |
| Real APIs with junk credentials | GitHub 401 → expired copy. Webflow 401 → expired copy. Wix token 401 → `auth-expired`. Shopify unknown store → readable 404. Framer fake key → `UNAUTHORIZED` → 401, not retried; a real Publish now made 1 attempt, then the connection showed "Needs reconnecting". Framer malformed project id → "404 Not Found — check the URL". Framer blank key → fails before connecting |
| All ten platforms on stubs: connect, picker, Test, Save; Publish now on the five tranche 2 stubs | all pass |
| Banner with a hint / without a hint (desktop and 375 px) | correct; unchanged without a hint |
| Contract spot-checks: Wix, Shopify, Webflow, GitHub, Framer `.d.ts` | all match (cited URLs in the QA report). The docs don't say whether Webflow `?slug=` includes drafts, or what content type the Webflow token request needs |
| GitHub ref with a slash in the branch (anonymous GET) | 200; per-segment encoding works |
| Docs: callbacks, Framer no-OAuth, review notes, live-suite env names, DIVERGENCES rows | match the code |

AC verdicts:
- BC2-1, 7, 8, 10 and 11: pass.
- BC2-2: pass, on stubs and real error paths.
- BC2-3 to 6: pass, but proven only by mocked tests, code review and stubs.
- BC2-9: not run. It is an owner step.

Minor defects:
1. MDX decoded literal named entities.
2. The Shopify summary dropped `&`.
3. The Webflow "didn’t publish" hint had no closing period.
4. The Wix fallback URL ignored the `-N` slug.
5. Shopify userErrors weren't hints.
6. The draft-reuse heuristic could adopt an owner's draft with the same slug and title. It is a documented trade-off, so it is accepted as logged.

Review notes, not defects:
- Shopify refresh single-flight is per process. This is safe because the old refresh token stays valid until the new one is used.
- Next.js taken-slug checks look only at the default branch.
- A failed Framer deployment (502) is retried, and the retry re-publishes the site.

## Fixes after QA, d2013b1b (PM)
Defects 1–5 are fixed, with regression tests. Results:
- `npx tsc --noEmit`: clean.
- `npx vitest run`: 442 passed, 71 skipped, 1 failed (baseline).
- QA's `mdx-check.mts` against the PM worktree: 25 of 25 pass.
- QA re-verification on d2013b1b: defects 1–5 fixed, no new problems. Typecheck clean; publishing suite 203 passed, 50 skipped; MDX 25 of 25; the banner and Test connection sentences read correctly. Defect 6 is accepted as logged.

Release status: release-ready once the PR's CI passes. Not merged and not deployed. Live platform checks remain owner steps (LAUNCH §7.9).
