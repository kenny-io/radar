# State: marketing-trial-gating

Feature branch: `kenny-dev/marketing-trial-gating` (worktree `.claude/worktrees/radar-update-branch-cd9f3e`).
- Base: `origin/main` @ `ea70ecb2`.
- Delivery target: a PR to `main` on `kenny-io/radar` with `RADAR_BILLING` off. Merging needs the owner's go-ahead, because `main` deploys to Railway.
- Local dev: docker Postgres `radar-sc-db` on `:54329`, one database per worktree, `RADAR_DEV_STUBS=1`.

| ID | Task | Owner | Depends on | Owns | Status | AC covered |
|---|---|---|---|---|---|---|
| T1 | Gating and billing architecture | factory-architect | — | `architecture.md` | verified (424d255a, PM rulings §21) | G*, P*, S*, R* (design) |
| T1b | Shared contracts | PM | T1 | `src/lib/billing.ts`, `src/lib/types.ts` additions | done | — |
| T2 | Marketing site and app narrow-width fixes | factory-engineer, worktree `../mtg-site`, branch `kenny-dev/mtg-site`, DB `radar_mtg_site`, :3300 | — | marketing routes, `src/app/page.tsx`, `/login`, root layout, `public/marketing/**`, `ui.tsx` Section, Performance/Backlinks/Article fixes | verified by engineer (f9a2ad76, merged 9a1c2e4f); PM scrollbar scoping 68ed1d40 | M1–M7 |
| T3 | Backend: guests, claim, gates, billing, Stripe/stub, limits, cron, docs | factory-engineer, worktree `../mtg-server`, branch `kenny-dev/mtg-server`, DB `radar_mtg_server` | T1b | architecture §14 T3 row | verified by engineer (967784cd, merged 19d2be4f) | G3–G5, G9–G10, P3–P8, R1–R2 (server) |
| T4 | Frontend: /start, /onboarding, /start-trial, Signup, Onboarding, app shell | factory-engineer, worktree `../mtg-client`, branch `kenny-dev/mtg-client`, DB `radar_mtg_client` | T1b (T3 for integration) | architecture §14 T4 row | verified by engineer (578adcda, merged 1a4ed8d8) | G1–G2, G6–G9 (UI), P1–P3 (UI), S1–S2 |
| T5 | Integration and DIVERGENCES | PM | T2–T4 | `DIVERGENCES.md`, merges | done: origin/main 2ddfed16 merged 9f5c9736; integrated revision 876329bc (typecheck, 461/462 tests with the known baseline, build, schema in sync) | R2 |
| T6 | Independent QA (browser and regression) | factory-qa, worktree `../mtg-qa`, DB `radar_mtg_qa`, :3600 | T5 | read-only, plus `verification.md` | 876329bc: 45/48 (D1–D3 minor/cosmetic, O1 rollout). Re-verification of b9a21266 active | all |
| T7 | QA fix round | T3 (D1, D2, O1 docs: 77ab5f0b, bab0a8e3), T4 (D3: b05c8fd1), PM (DIVERGENCES 3ba58f48) | T6 | as T3/T4 | merged; integrated revision b9a21266 (typecheck, 469/470 with the known baseline, build, schema in sync) | P1, P7, G5, R1 |

## Owner decisions (answered 2026-10-25)
- Existing accounts: **grandfather** (data migration).
- Rollout: **`RADAR_BILLING` off** at merge.
- Stripe: **stubs now, keys later**. Live Stripe checks are not run.
- The $1: **credited to month one**.

## Blockers
- None for the build. Live Stripe verification waits on owner test keys.

## Notes for QA
- `radar.css` scrollbar rule is now scoped with `:has(.mk)`. Check that app pages still hide scrollbars (computed `scrollbar-width: none` on `html` and on inner scrollers) and that marketing pages show native ones.
- `origin/main` moved to `2ddfed16` (blog connectors). Merge it before the PR. T2 checked that `merge-tree` is clean against its branch.
- T2's reusable check scripts are in the PM scratchpad `pw/`. They need the prototype served on :8811 and the app port set.

## Known pre-existing (not this feature)
- Malformed JSON bodies return 500 `server` on every route (`src/server/http/handle.ts`). Left as is.

## PM rulings in the fix round
- Accepted T3's restart hardening: void an abandoned `incomplete` restart invoice before replacing it (no double charge, credit returns), and sync instead of cancel when already paid. The restricted key needs Invoices write (LAUNCH §7c).
- `GET /api/b/current` changes the current business on a GET. Accepted: it only switches to a business the user already belongs to and has access to.
- O2 (member caught mid-session by a lapsed owner goes to `/start-trial`) left as logged under Team members (Needs approval).
- The stub provider keeps its objects in memory, so a dev server restart loses stub subscriptions. Dev only, by design.

## Next action
T6 re-verifies b9a21266. Then push and open the PR (flag off). Merging waits for the owner.
