# Verification — custom post scheduling

## Baseline (main 467749c7, 2026-11-24)
- `npm run typecheck`: clean.
- `vitest run src/server/services/social src/server/actions src/lib src/features/social src/app/api/b` with one shared DB: 812/816 pass. Failures in `youtubeAutomation.db.test.ts` (3) and `youtubeRetention.db.test.ts` (1); each file passes alone on a fresh DB (39/39, 22/22) → known shared-DB flakiness, not regressions.
- Environment: Homebrew Postgres 16, 127.0.0.1:55432, DBs `radar_custom`, `radar_b`.

## Integrated (E1 + E2), PM run 2026-11-24
- `npm run typecheck`: clean.
- Fresh DB `radar_int`: `vitest run src/lib src/server/actions src/server/services/social src/features src/client src/app/api/b` → 91 files, 1119/1119 pass.
- E2 engineer browser run (dev stubs, 13 checks) passed; independent QA pending.
