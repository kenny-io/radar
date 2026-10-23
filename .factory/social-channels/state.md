# State: social-channels

Feature branch: `kenny-dev/software-factory-feature-5a68c1` (worktree `.claude/worktrees/software-factory-feature-5a68c1`). Base: `main` @ `867e75c8`.
Delivery target: a PR to `main` on `kenny-io/radar`, with the flag off. Merging needs the owner's go-ahead, because `main` deploys to Railway.
Last integrated revision: `fd1956dd` — QA passed (T5, T5b, T5c). Typecheck clean; 258/259 tests (baseline failure only); build passes. **Release-ready behind the default-off flag**; live X/LinkedIn not verified.

| ID | Task | Owner | Depends on | Owns (files/modules) | Status | AC covered |
|---|---|---|---|---|---|---|
| T1 | Architecture and shared contracts | factory-architect | — | `architecture.md`, `src/lib/types.ts`, `src/lib/socialPublish.ts` (+test), `docs/CONTRACTS.md` § Social channels (now single owner: PM) | verified (7d7bcfa5) | all (design) |
| T1b | X/LinkedIn developer-app research and owner setup guide | research agent | — | `developer-apps-guide.md` | verified | 19, 22, 26 (input) |
| T2 | Backend per architecture.md §16 | factory-engineer (server), worktree `../sc-server`, branch `kenny-dev/sc-server` | T1 | architecture.md §15 Backend row | verified (sc-server @ 5e510589) | 2–4, 6–10 (server), 15–16 (server), 18–25 |
| T3 | Frontend per architecture.md §17 | factory-engineer (client), worktree `../sc-client`, branch `kenny-dev/sc-client` | T1 | architecture.md §15 Frontend row (no `src/lib/*` edits) | verified (sc-client @ fd1956dd) | 1–17 (UI), 23 (flag-off UI) |
| T4 | Integration, DIVERGENCES section | PM | T2, T3 | `DIVERGENCES.md`, merges | done (DIVERGENCES 2fcd15b1, merges ceb158fc + dcba6fcc) | 26 |
| T5 | Independent QA (browser + regression) | factory-qa | T4 | none (read-only, plus evidence in `verification.md`) | verified (T5 42eb9318, T5b 7e8e6238, T5c fd1956dd) | 1–25 |

## Blockers
- Live X/LinkedIn verification needs developer apps (owner). This doesn't block the build.

## Next action
PR to main with the flag off; merge and deploy need the owner's go-ahead. Then: owner sets env on Railway, flag = owner's business, live checklist in developer-apps-guide.md §6.

## Known, accepted
- R1 (cosmetic): a stale "Image is N MB" warning can linger after Compress changes nothing (only reachable by editing stored sizes).
- D4 (baseline, pre-existing): shared `Modal` doesn't move focus into the window or restore it on close.

## Owner decisions open (not blocking; defaults built)
1. X replies: X's prefilled reply box (default) or X Enterprise for API replies. Ask X Policy about AI-drafted content.
2. X posts with a link cost $0.20 vs $0.015: keep links (default) or drop them on X.
3. LinkedIn profile 60-day reconnect for v1 (default: Reconnect needed + held posts + a warning).
