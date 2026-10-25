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
- Live suites for Framer, Shopify, Webflow and Wix need owner accounts; see LAUNCH §7.9. GitHub ran live (below).
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

Release status: release-ready (no CI checks are configured on the repo). Live platform checks remain owner steps (LAUNCH §7.9).

## GitHub live check (Next.js connector), 2026-10-25
The owner approved it via the parent session: "Create kenny-io/radar-connector-test (private) for the Next.js connector's live check."

**Setup**
- Created the private repo `kenny-io/radar-connector-test` (`main` with a README).
- Seeded `content/posts/hello-radar.mdx` so the refresh and taken-slug cases have a post to find.
- The token came from `gh auth token` at runtime. It was not written anywhere.
- Command: `RADAR_IT_GITHUB_REPO=kenny-io/radar-connector-test RADAR_IT_GITHUB_TOKEN=… RADAR_IT_GITHUB_REFRESH_URL=https://example.com/blog/hello-radar npx vitest run src/server/services/publishing/connectors/nextjs.live.test.ts`

**Results**

| Run | Result |
|---|---|
| 1 | 4 passed, 3 failed. The 3 failures were vitest's default 5 s test timeout, a fault in the test file: each case makes about 8 GitHub calls. The calls still completed and were cleaned up. |
| 2 | Suite timeout raised to 60 s (Framer, Shopify, Webflow and Wix live suites raised to 120 s). **7 of 7 passed** against real GitHub. |

Run 2 covered:
- Test connection leaves no branch.
- Draft + publish opens a PR with the MDX on `radar/{slug}-{id}`.
- A retry reuses the same branch and PR (exactly one PR).
- A refresh modifies `content/posts/hello-radar.mdx` in place on a PR branch.
- A taken slug becomes `hello-radar-2.mdx` and the existing file is untouched.
- A bad token gives 401 `auth-expired`.
- An unseen repo gives 404.

**State afterwards**
- 0 `radar/*` branches.
- PRs #1–#8 are closed.
- `main` holds only the README and the seed post.
- The repo is kept, as the owner asked.

## Release, 2026-10-25
**Before merging**
- Synced with `main` @ `caf979d8` (#5). The only conflict was `DIVERGENCES.md`; both sections were kept.
- On `fd50811c`: typecheck clean; tests 517 passed, 144 skipped, 1 failed (the baseline snapshot); build passes.

**Merge and deploy**

| Step | Result |
|---|---|
| Merge | `c8410f97` on `main` |
| GitHub deployment "radar / production" | `success` at 07:54:57Z |
| `radar - web` | Success (radar.thally.io) |
| `radar - worker` | Success |
| Smoke check | `https://radar.thally.io/` returns 200; `/login` returns 307 |

The new connectors stay hidden in the picker until their env vars are set, so this release changes nothing users can see yet.

