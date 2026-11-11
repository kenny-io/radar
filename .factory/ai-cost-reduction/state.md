# State

| Task | Owner | Status | Covers | Next |
| --- | --- | --- | --- | --- |
| ACR-A1 architecture and work split | factory-architect | verified | all | `architecture.md` accepted with PM resolutions (section 15) |
| ACR-E1 AI core: tiers (Fable 5.2 premium), effort, recorder, prices, refusals | factory-engineer | verified | UT, EF, MT, PR, LG-4 | QA pass on mocks; DEF-2 fixed and re-verified |
| ACR-E2 spend records for visibility, images, search; one image per pack | factory-engineer | verified | LG-1..3, LG-5, IM | QA pass on mocks; real usage fields and crops need a staging pass |
| ACR-E3 weekly AI Visibility and cadence copy | factory-engineer | verified | VW | QA pass; DEF-1 and DEF-4 fixed and re-verified |
| ACR-Q1 independent QA with browser checks | factory-qa | verified | all | `qa-report.md`: no criterion failed; DEF-1 medium, DEF-2 and DEF-4 low, DEF-3 informational |
| ACR-Q2 QA rerun of the fixes | factory-qa | verified | VW-1, VW-1a, VW-1b, MT-5, regressions | `qa-rerun.md`: DEF-1, DEF-2, DEF-4 fixed; nothing regressed; 2051 passed with Postgres |
| ACR-P1 integration and delivery | PM | review | all | tested on stubs and mocks; nothing committed, pushed or deployed; next: owner's commit and PR decision, then one staging pass with real keys |

Branch `kenny-dev/radar-ai-cost-audit-ec7d70`, base `b8bbdd0e`. Work stays uncommitted in the working tree until the
owner asks for a commit.

Baseline at `b8bbdd0e` (2026-11-10): `npm run typecheck` passes; `npm test` 1314 passed, 522 skipped (DB tests
without `DATABASE_URL`), 1 failed (`src/server/ai/openrouter.qa.test.ts` golden snapshot, failing before this work).

## PM decisions

- "Nightly runs" in the owner's request means scheduled AI Visibility collection (the only nightly AI job).
- "Dynamically use stronger models" is implemented per task from one table, not per request.
- Owner decision: the premium tier's first model is Claude Fable 5.2 ($8/$40 per million tokens against 5.1's
  $10/$50). Fable 5.1 stays in the catalogue.
- Initial premium purposes: `article.draft`, `suggestions.refreshDraft`, `calendar.topics`. The owner may revise.
- An explicit Settings choice still wins for standard and premium tasks; removing models from the catalogue stays
  an open owner decision.
- Production `ai_calls` could not be read (blocked as a production read), so cost figures are estimates until the
  new records exist.
