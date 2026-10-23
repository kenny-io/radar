# Verification: social-channels

## Environment
- macOS (Darwin 25.5), Node 22.18.0. Postgres 16 runs in Docker as container `radar-sc-db` on `localhost:54329`. Each worktree has its own database.
- `RADAR_DEV_STUBS=1`. No live provider keys are used, and no production env files are read.

## Baseline (main @ 867e75c8, before any change)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Tests | `DATABASE_URL=… npm test` | 156/157 pass. **Pre-existing failure:** `src/server/ai/openrouter.qa.test.ts` › "parity: OPENROUTER_API_KEY unset…" golden snapshot. The stored branded-image hash `f883614e6a7dfb07` ≠ `91d5409f50974af7`, because the golden predates 170cd136 ("Branded graphic: five layouts"). Not related to this feature. |
| Migrate + seed | `npm run db:migrate`, `npx tsx scripts/dev-seed.ts` | pass |

## Feature checks
### Integrated revision dcba6fcc (PM)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Tests | `DATABASE_URL=…/radar npm test` | 249/250 (baseline openrouter.qa snapshot only). Includes 35 backend tests (DB-backed `publish.test.ts` needs `DATABASE_URL`, else it skips), 18 frontend logic tests, 42 shared-helper tests |
| Production build | `npm run build` | pass |
| Migrate | `npm run db:migrate` on radar, radar_qa, a throwaway fresh DB (backend engineer) | pass |
| Engineer evidence | backend HTTP smoke on 3101 (scheduled send by worker, failure, retry, expire/held/reconnect, other-account refused, disconnect counts, flag off); frontend flag-off pixel diff 35/36 identical (1 = animation timing), 30 flag-on flows against a temporary local shim | reported by engineers, see handbacks |

## Not run / blocked
- Live X OAuth + posting and live LinkedIn OAuth + posting (profile and page) are blocked: no developer apps or credentials, and LinkedIn page scopes need approval.
