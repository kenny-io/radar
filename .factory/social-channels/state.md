# State: social-channels

Feature branch: `kenny-dev/software-factory-feature-5a68c1` (worktree `.claude/worktrees/software-factory-feature-5a68c1`). Base: `main` @ `867e75c8`.
Delivery target: a PR to `main` on `kenny-io/radar`, with the flag off. Merging needs the owner's go-ahead, because `main` deploys to Railway.
Last integrated revision: `ceb158fc` (shared contracts + backend). Typecheck clean; 230/231 tests (baseline failure only).

| ID | Task | Owner | Depends on | Owns (files/modules) | Status | AC covered |
|---|---|---|---|---|---|---|
| T1 | Architecture and shared contracts | factory-architect | — | `architecture.md`, `src/lib/types.ts`, `src/lib/socialPublish.ts` (+test), `docs/CONTRACTS.md` § Social channels (now single owner: PM) | verified (7d7bcfa5) | all (design) |
| T1b | X/LinkedIn developer-app research and owner setup guide | research agent | — | `developer-apps-guide.md` | verified | 19, 22, 26 (input) |
| T2 | Backend per architecture.md §16 | factory-engineer (server), worktree `../sc-server`, branch `kenny-dev/sc-server` | T1 | architecture.md §15 Backend row | review (merged ceb158fc; sc-server @ eb45055d) | 2–4, 6–10 (server), 15–16 (server), 18–25 |
| T3 | Frontend per architecture.md §17 | factory-engineer (client), worktree `../sc-client`, branch `kenny-dev/sc-client` | T1 | architecture.md §15 Frontend row (no `src/lib/*` edits) | active | 1–17 (UI), 23 (flag-off UI) |
| T4 | Integration, DIVERGENCES section | PM | T2, T3 | `DIVERGENCES.md`, merges | planned | 26 |
| T5 | Independent QA (browser + regression) | factory-qa | T4 | none (read-only, plus evidence in `verification.md`) | planned | 1–25 |

## Blockers
- Live X/LinkedIn verification needs developer apps (owner). This doesn't block the build.

## Next action
T2 and T3 build in parallel. Then the PM integrates both branches (T4) and QA runs (T5).

## Owner decisions open (not blocking; defaults built)
1. X replies: X's prefilled reply box (default) or X Enterprise for API replies. Ask X Policy about AI-drafted content.
2. X posts with a link cost $0.20 vs $0.015: keep links (default) or drop them on X.
3. LinkedIn profile 60-day reconnect for v1 (default: Reconnect needed + held posts + a warning).
