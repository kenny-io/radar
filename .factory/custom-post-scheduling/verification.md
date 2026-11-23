# Verification — custom post scheduling

## Baseline (main 467749c7, 2026-11-24)
- `npm run typecheck`: clean.
- `vitest run src/server/services/social src/server/actions src/lib src/features/social src/app/api/b` with one shared DB: 812/816 pass. Failures in `youtubeAutomation.db.test.ts` (3) and `youtubeRetention.db.test.ts` (1); each file passes alone on a fresh DB (39/39, 22/22) → known shared-DB flakiness, not regressions.
- Environment: Homebrew Postgres 16, 127.0.0.1:55432, DBs `radar_custom`, `radar_b`.

## Integrated (E1 + E2), PM run 2026-11-24
- `npm run typecheck`: clean.
- Fresh DB `radar_int`: `vitest run src/lib src/server/actions src/server/services/social src/features src/client src/app/api/b` → 91 files, 1119/1119 pass.
- E2 engineer browser run (dev stubs, 13 checks) passed; independent QA pending.

## Independent QA (factory-qa) on 6bb0a1cc, 2026-11-24
- C1–C11 pass in a real browser (Playwright + Chrome, dev stubs, real worker process). C1: LinkedIn 14:00 / X 12:00 tomorrow (GST) scheduled via UI, survive reload, shown in library/Calendar/WeekStrip; worker sent each at its own due time (due_at moved in the test DB), text verbatim, uploaded image attached; text-only post sent with no media.
- Typecheck clean; 1118/1119 (one known shared-DB flake, passes alone).
- Defect D1 (low): pack title with an unbroken string overflowed at 375px → fixed with `overflow-wrap:anywhere` on `.h1` (CSS only; not re-run in browser by QA).
- Not tested: live provider calls (AI-label flags not seen on the wire), TikTok/YouTube sends with uploaded video, deleted-business gates end to end, screen readers.
- Pre-existing observations left out of scope: Viewer sees an enabled Schedule all (server refuses 403); text of a posted post stays editable; uploaded files are public at unguessable URLs (existing storage model).
- Evidence: `.factory/custom-post-scheduling/qa/` (probes + result JSON).
