# Verification

Deliverable: branch `kenny-dev/radar-optimization-review-dda3f5`. Not pushed. Everything below ran on stubs
(`RADAR_DEV_STUBS=1`, stub billing); nothing was checked against real Stripe, real AI or real social providers.

## Automated checks

| Revision | Check | Result |
| --- | --- | --- |
| `2d41a801` (base) | `npm run typecheck`; `npm test` | clean; 1 failed: `src/server/ai/openrouter.qa.test.ts` golden snapshot (pre-existing) |
| `3c48df20` | `npx tsc --noEmit` | exit 0 (PM and QA) |
| `3c48df20` | `npx vitest run --no-file-parallelism`, fresh database migrated from zero | 1650 passed, 65 skipped, 1 failed (baseline) (PM and QA) |
| `3c48df20` | `npm run build` | exit 0 (PM and QA) |
| `3c48df20` | upgrade from main's 0017 schema with rows to `0018_first_five` | clean; `last_active_at`, `activity_seen_at` = migration time; `past_due_at`, `acted_at` NULL; no jobs created (QA) |
| `aaf9eea1` | `npx tsc --noEmit` | exit 0 (PM and QA) |
| `aaf9eea1` | `npx vitest run --no-file-parallelism`, fresh database | 1655 passed, 65 skipped, 1 failed (baseline); QA ran it twice with the same result |
| `aaf9eea1` | `npx vitest run` without a database | 1215 passed, 491 skipped, 1 failed (baseline) |
| `aaf9eea1` | `npm run build` | exit 0 (PM) |

Database suites must run with `--no-file-parallelism` (lifecycle tests share one advisory lock; true on the base too).
The 65 skipped tests need live connector credentials.

## Independent QA

- OPT-Q1 on `3c48df20`: `qa-report.md`. 25 criteria: 23 pass, 2 partial (IS-3 defect D1, LS-2 defect D2), 0 blocked.
  Cosmetic D3 (RL-6), D4 (RL-2). Real browser (system Chrome through Playwright), real worker scheduler on the real
  clock, development and production builds for hard loads.
- Fixes in `aaf9eea1`: D1 catch-up run takes the night's mark; D2 finished draft jobs carry no streamed text; D3 phone
  toast above the support button; D4 the sheet's history entry carries its own mark; plus `laterV()` so
  `calendar.replace`, the draft job and the publish cover always move `articles.updated_at` forward (a full-suite run
  failed once on `calendar.replace` stamping 65 ms earlier than the stored value).
- OPT-Q2 on `aaf9eea1`: `qa-rerun.md`. D1 to D4 and the version hardening pass; regression smoke passes. Workspace
  22,416 / 22,622 / 23,450 B with 0 / 1 / 5 drafted articles (207 B per article, was about 1.9 KB). Two new cosmetic
  findings: N1 toast overlaps the support button by 2 px at 601 to 640 px; N2 with the support panel open at 375 px the
  toast covers the panel footer.
- After OPT-Q2 (CSS only, `radar.css`): N1 and N2 fixed. PM measurement in the browser pane, not re-run by QA:
  375 px toast region ends at y 732, button starts at 744; 620 px ends at 706, button starts at 716; panel open at
  375 px the region is back at `bottom: 12px` (the OPT-Q1 position, panel footer clear); 641 px and wider unchanged
  at `bottom: 24px`.

## Not verified

- Real Stripe: hosted portal behind "Update card", retry schedule against the 48-hour grace, delivered webhooks.
- Real AI, crawl and social providers; the worker in a production build.
- A screen reader, a real phone (safe-area insets), dark theme for the trial chip and signed-in footer.
- A real night passing for the visibility cadence (dates were moved by SQL); return through an email link by a
  non-owner member; Autopilot businesses on the return path.
- A legacy (pre-deploy) tab in the browser; checked at the HTTP level only. A new client against an old web instance.
- IS-7 Undo and "scheduled or posted from Radar" as earning actions in the browser (covered by database tests).
- Trial chip wording at "1 day left" and "ends today".

Evidence (scripts, logs, screenshots; no credentials): session scratchpad `qa/` and `qa/rerun/`. It is outside the
repository and will not survive the session.
