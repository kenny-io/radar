# Independent QA — daily social drafts

Recommendation: ready for authorized delivery in the workspace. No confirmed feature defects remain in observed acceptance checks. This is not a deployment or live-provider certification.

## Tested environment and revision
- Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`, base `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`, integrated uncommitted feature changes.
- Exact 13-file source/test fingerprint: `e782085b183649dbd30ed5e127338cfb60d6d5b848d46d3c260ccdd7b3e109b8`; per-file SHA-256 recorded in `qa/fingerprint.json`.
- Isolated local PostgreSQL database `radar_daily_social_qa`, Docker port 54329, migrated with repository migrations. Next development app at `http://localhost:3119` with dedicated `.next-daily-social-qa` output.
- Explicit development stubs, billing off, social publishing enabled, test-only encryption key; server launcher supplies no live provider credentials. Ordinary seeded owner `dev@radar.local`, Viewer `daily-viewer@radar.local`, and unrelated owner `daily-foreign@radar.local`; synthetic Fieldnote business only.
- Real headless Google Chrome through Playwright, desktop 1440×1000 and mobile 390×844/1000. Signed in through actual sign-in form. No real social posts, customer email or paid AI calls.

## Acceptance coverage

| Criterion | Result | Evidence |
|---|---|---|
| AC1 automatic daily draft | Passed | Concurrent/delayed cron calls without UI access queued one durable job; running that job produced one profile-only pack for LinkedIn/X. Default-on, timezone/custom day, explicit-off, onboarding/stale payload guards covered by independent focused tests. Existing billing skip gate was preserved; PM full suite covers it. |
| AC2 retry/idempotency/recovery | Passed | Repeated/concurrent ticks queued once; generation retry returned same pack. Actual owner text edit survived same-day retry. Independent DB tests cover enqueue rollback/recovery, concurrent generation, immutable prior-day completion, and pause during generation. |
| AC3 grounding/tenant bounds | Passed with stub limitation | Independent tests exercised real DB article body/calendar context, unpublished topic with no link, cached blog text, search failure/profile fallback, unreadable source fallback, bounded recent history, and foreign article exclusion. No live-model editorial quality claim. |
| AC4 review/publishing control | Passed | Zero publication rows after daily generation with connected accounts. Owner edited, scheduled, refreshed, unscheduled, manually generated another pack, then explicitly confirmed Post now to stub X; posted state persisted after refresh. Existing explicit-auto-schedule publishing regressions passed independently. |
| AC5 library/settings experience | Passed | Daily status/timezone/default review copy, empty/manual CTA, provenance, progress/failure, pause and custom-day persistence, invalid empty custom schedule, RPC failure retaining form and recovery, keyboard disabled fields, Viewer/foreign authorization, desktop/mobile screenshots. |
| AC6 independent verification | Passed | 71 focused automated tests, 16 browser scenarios plus separate cron-to-library harness. No browser runtime errors. |

## Commands and results

- `DATABASE_URL=<isolated local QA DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test -- src/server/services/social/proactive.test.ts src/server/services/social/proactive.db.test.ts src/server/services/social/social.test.ts`: **30/30 passed**, including all **19 new feature tests**. Log `qa/focused-tests.log`.
- Same local environment, `npm test -- src/server/services/social/publish/publish.test.ts src/features/social/channels/logic.test.ts`: **41/41 passed**. Log `qa/publish-tests.log`.
- `node .factory/daily-social-drafts/qa/ui-browser.mjs`: **8/8 passed**. Results `qa/ui-results.json`.
- `node --import tsx .factory/daily-social-drafts/qa/cron-generate.mjs`: concurrent/delayed cron scheduling, durable-job completion, profile-only grounding, default no publications and same-day retry all passed. Results `qa/cron-results.json`.
- `node --import tsx .factory/daily-social-drafts/qa/core-browser.mjs`: **8/8 passed**. Results `qa/core-results.json`.
- PM reports integrated build passed and full suite has only the pre-existing branded-raster hash mismatch; QA did not independently rerun the broad build/full suite. The focused QA checks above had no failures or skips.

## Browser evidence and observations

Reviewed `qa/library-desktop.png`, `qa/prepared-pack-mobile.png`, and settings captures. Core controls fit the incumbent visual system; mobile document width equals viewport width (390px), settings dialog width 370px. Additional captures: `empty-desktop.png`, `empty-mobile.png`, `settings-mobile.png`, `preparing-desktop.png`, `failure-desktop.png`, `reviewed-pack-desktop.png`, `stub-posted-desktop.png`.

Real RPC boundaries: Viewer changing automatic settings returned 403; unrelated owner's workspace access returned 404; an unrelated owner mutating this pack through their own otherwise-authorized business returned 404. UI disables Viewer manual-generation controls and hides Draft settings.

Harness corrections, not product defects: waited for unschedule RPC completion before querying DB because UI is optimistic; reselected X after reload because existing tab selection is local state; selected the Daily tab by visible text because incumbent Field/Seg nesting gives its first control a combined accessible name. Earlier HMR-interrupted runs were discarded. Final stable runs above all passed.

## Limits and cleanup

No live AI-provider content-quality evaluation or real X/LinkedIn authorization/send was performed; these deliberately use development stubs. No deployment requested or performed. Source grounding and prompt inclusion are covered through DB tests and inspected code, not inferred from stub editorial output.

Stopped the QA web server and confirmed port 3119 is no longer listening. Removed only the generated `.next-daily-social-qa/types/**/*.ts` tsconfig include, preserving unrelated pre-existing changes. Removed temporary debug files and obsolete failure captures. Local synthetic QA database and reproducible harness/evidence remain.
