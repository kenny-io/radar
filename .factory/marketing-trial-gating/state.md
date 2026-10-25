# State: marketing-trial-gating

Feature branch: `kenny-dev/marketing-trial-gating` (worktree `.claude/worktrees/radar-update-branch-cd9f3e`).
- Base: `origin/main` @ `ea70ecb2`.
- Delivery target: a PR to `main` on `kenny-io/radar` with `RADAR_BILLING` off. Merging needs the owner's go-ahead, because `main` deploys to Railway.
- Local dev: docker Postgres `radar-sc-db` on `:54329`, one database per worktree, `RADAR_DEV_STUBS=1`.

| ID | Task | Owner | Depends on | Owns | Status | AC covered |
|---|---|---|---|---|---|---|
| T1 | Gating and billing architecture | factory-architect | — | `architecture.md` | verified (424d255a, PM rulings §21) | G*, P*, S*, R* (design) |
| T1b | Shared contracts | PM | T1 | `src/lib/billing.ts`, `src/lib/types.ts` additions | done | — |
| T2 | Marketing site and app narrow-width fixes | factory-engineer, worktree `../mtg-site`, branch `kenny-dev/mtg-site`, DB `radar_mtg_site`, :3300 | — | marketing routes, `src/app/page.tsx`, `/login`, root layout, `public/marketing/**`, `ui.tsx` Section, Performance/Backlinks/Article fixes | active | M1–M7 |
| T3 | Backend: guests, claim, gates, billing, Stripe/stub, limits, cron, docs | factory-engineer, worktree `../mtg-server`, branch `kenny-dev/mtg-server`, DB `radar_mtg_server` | T1b | architecture §14 T3 row | planned | G3–G5, G9–G10, P3–P8, R1–R2 (server) |
| T4 | Frontend: /start, /onboarding, /start-trial, Signup, Onboarding, app shell | factory-engineer, worktree `../mtg-client`, branch `kenny-dev/mtg-client`, DB `radar_mtg_client` | T1b (T3 for integration) | architecture §14 T4 row | planned | G1–G2, G6–G9 (UI), P1–P3 (UI), S1–S2 |
| T5 | Integration and DIVERGENCES | PM | T2–T4 | `DIVERGENCES.md`, merges | planned | R2 |
| T6 | Independent QA (browser and regression) | factory-qa | T5 | read-only, plus `verification.md` | planned | all |

## Owner decisions (answered 2026-10-25)
- Existing accounts: **grandfather** (data migration).
- Rollout: **`RADAR_BILLING` off** at merge.
- Stripe: **stubs now, keys later**. Live Stripe checks are not run.
- The $1: **credited to month one**.

## Blockers
- None for the build. Live Stripe verification waits on owner test keys.

## Next action
Start T3 and T4 in parallel from the contracts commit. T2 is running.
