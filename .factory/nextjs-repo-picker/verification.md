# Verification: Next.js repository picker

Baseline `main` @ b854e86d: `npx vitest run` 517 passed, 144 skipped, 1 failed (the known `openrouter.qa.test.ts` golden snapshot).

## Engineer (f9089e48, df657c11)
- tsc clean; vitest 535 passed, 144 skipped, 1 failed (baseline); `next build` pass (on f9089e48).
- Playwright headless against `next dev` with `RADAR_DEV_STUBS=1` and a throwaway Postgres: NRP-1…7, including an old-style row edited and re-saved.

## QA (df657c11), independent
Environment: `next dev -p 3021`, `RADAR_DEV_STUBS=1`, own Postgres container (removed), seeded dev user; built-in browser pane plus Playwright (the pane can't follow the OAuth popup).

| Check | Result |
|---|---|
| tsc, vitest, next build | clean; 535 / 144 / 1 failed (baseline only; base re-run 517 / 144 / 1); pass |
| NRP-1 Next.js sign-in enabled at open; Shopify still needs its store | pass |
| NRP-2 Repository select after sign-in, domain match preselected | pass on stubs; real data gave the wrong repo (D2) |
| NRP-3 Content folder value `content/posts` with hint | pass |
| NRP-4 `tree/main/public/blog` stored as `public/blog`; URL and slashes normalized | pass |
| NRP-5 picker help line and link; org/SAML 403 copy | line pass; 403 copy unit-tested only (stubs can't return 403) |
| NRP-6 old rows (fields.repo, no targetId) preselect, test, save canonical | pass; never-re-saved publish checked at connector level |
| NRP-7 stub repos are valid owner/repo | pass; 10 malformed targetIds rejected with 400 |
| 375 px, keyboard, Settings row, Webflow and Ghost regressions | pass (pre-existing modal focus gaps noted, not from this branch) |
| Real GitHub `targets` (gh CLI token, read only, domain thally.io) | 475 repos, push filter correct; `thallydocs` preselected (D2); ~16 s (D3) |

Findings: D1 medium, `..` in the content folder could steer writes to another repo or endpoint (also on main). D2 medium, wrong preselection. D3 low, 16 s listing. D4 low, 403 copy named only the owner path. D5 low, `tree/posts` was stripped.

## PM fixes after QA
- D1: `unsafeFolder` rejects "." and ".." segments at save (400) and before any write (422 config hint).
- D2: ranking is named for the site (`thally-website`, `thally.io`), then exactly the label, then containing it, then the rest.
- D3: page 1 first; a full page fetches pages 2–5 in parallel.
- D4: "Ask an organization owner to approve it, or request access under GitHub Settings → Applications → Radar, then test again."
- D5: without a github.com URL, `tree/<x>/` is stripped only when a folder follows it.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 537 passed, 144 skipped, 1 failed (baseline) |
| Real GitHub `targets` re-run (same token, thally.io) | 475 repos in 2.7 s; `thallylabs/thally-website` first |
| `next build` | not re-run after the fixes (server-only TS changes; tsc clean) |

Not run: the 403 copy in a browser, Radar's own GitHub app end to end (thallylabs hasn't granted it), a worker publish.
