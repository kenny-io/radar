# State: social-channels

Feature branch: `kenny-dev/software-factory-feature-5a68c1` (worktree `.claude/worktrees/software-factory-feature-5a68c1`). Base: `main` @ `867e75c8`.
Delivery target: a PR to `main` on `kenny-io/radar`, with the flag off. Merging needs the owner's go-ahead, because `main` deploys to Railway.
Last integrated revision: `867e75c8` (nothing integrated yet).

| ID | Task | Owner | Depends on | Owns (files/modules) | Status | AC covered |
|---|---|---|---|---|---|---|
| T1 | Architecture and shared contracts | factory-architect | — | `.factory/social-channels/architecture.md`, `src/lib/types.ts` (social additions), `docs/CONTRACTS.md` (social section) | active | all (design) |
| T2 | Backend: accounts, OAuth, tokens, publish adapters, scheduler, actions, workspace projection, flag, audit, metrics, tests, LAUNCH/.env docs | factory-engineer (server) | T1 | `src/server/**`, `drizzle/**`, `scripts/dev-seed.ts`, `docs/LAUNCH.md`, `.env.example` | planned | 2–4, 6–10 (server), 15–16 (server), 18–25 |
| T3 | Frontend: channels module, PublishBox, Settings section, Connect/Schedule/Schedule all/Move post windows, calendar chips + drag, This week strip, Needs attention, Daily Brief actions, Auto modal, copy, CSS | factory-engineer (client) | T1 | `src/features/**`, `src/components/**`, `src/client/**`, `src/app/radar.css`, `src/lib/*` except `types.ts` | planned | 1–17 (UI), 23 (flag-off UI) |
| T4 | Integration, DIVERGENCES section | PM | T2, T3 | `DIVERGENCES.md`, merges | planned | 26 |
| T5 | Independent QA (browser + regression) | factory-qa | T4 | none (read-only, plus evidence in `verification.md`) | planned | 1–25 |

## Blockers
- Live X/LinkedIn verification needs developer apps (owner). This doesn't block the build.

## Next action
T1: the architect delivers the design and contracts.
