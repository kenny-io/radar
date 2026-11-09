# Verification

## Baseline
- Revision f9eb6178 plus pre-existing uncommitted workspace changes.
- `npm run typecheck`: passed.
- `npm test -- src/server/services/social/social.test.ts src/features/social/channels/logic.test.ts src/server/services/social/publish/publish.test.ts`: 31 passed; 21 DB tests skipped (DATABASE_URL not supplied).

Integrated verification pending.

- Full pre-change DB suite: `DATABASE_URL=<local radar_daily_social_tests> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test`: 989 passed, 65 skipped, one known pre-existing `openrouter.qa.test.ts` raster golden failure (expected f883614e6a7dfb07; actual 91d5409f50974af7). Log: `/tmp/radar-daily-social-baseline-tests.log`.

## Integrated checks
- Full suite: 1006 passed, 65 skipped, same single pre-existing `openrouter.qa.test.ts` raster golden failure. Log `/tmp/radar-daily-social-integrated-tests.log`; 17 new tests loaded before 2 final fallback tests were added.
- Engineer final focused tests: 30 passed (4 proactive policy, 15 proactive DB, 11 existing social); 82 publishing/UI/shared-helper/billing-skip regressions passed. See backend.md.
- Build snapshot: `/var/folders/bj/3s47mgg94953kh5fty4qz3g80000gn/T/radar-daily-social-build-4xr4yxhq`; production code fingerprints match integrated workspace. No environment files copied; unreachable local build-only DATABASE_URL, no live provider keys. Compile/type validation passed; completion pending.

- Production build: **passed**, including optimized compilation, type validation, page generation and tracing. Log `/tmp/radar-daily-social-build.log`. All 10 changed production files matched the working tree snapshot by SHA-256.

## Independent acceptance
- QA final focused suite: **30/30 passed**, including all 19 new tests.
- Real headless Chrome at desktop and 390px: **8 settings/UI scenarios +8 core flow scenarios passed**. Covered background cron generation without UI visit, same-day deduplication, default zero publication rows, provenance, manual generation, editing/autosave/reload, preserved edits on retry, schedule/refresh/unschedule, explicit confirmed stub X publication/refresh, mobile layout, failed settings save recovery, custom days, pause, keyboard disabled fields, Viewer/foreign-tenant boundaries and no runtime errors. See `qa.md` and `qa/` JSON/screenshots. All providers used development stubs; no real social posts or live AI quality claims.
- Final production source matches tested build snapshot and fingerprints.json; only a stale existing test-description label changed after snapshot.
- Delivery: workspace implementation verified; no merge/deploy requested or performed. The existing worker remains required.
