# Independent QA — Autopilot

Recommendation: locally verified for the implemented capabilities; no unresolved Autopilot regression found. No production activation/deployment was performed. Live social/CMS providers and real email delivery were outside this isolated QA run.

## Tested environment and revision

- Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`.
- Base HEAD: `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`, branch `kenny/signup-security`, integrated uncommitted working tree with pre-existing unrelated work preserved.
- Final source fingerprint: `f4d477a75f5c73eaebdbf32ecdcff3625fd7836d4f2eb393d9a0a32683969a70`. File-by-file SHA256 evidence: `qa/fingerprint.json`; checked unchanged after final program/browser/helper runs. Fingerprint was expanded to include `actions/article.ts` and `actions/publishing.ts`; this scope expansion changed the aggregate without changing source.
- Application: `http://localhost:3830`, Next.js development server, Chromium via local Google Chrome.
- Database: isolated `radar_autopilot_qa` at localhost:54329. Migration 0010 applied through normal migration runner.
- Synthetic Owner/Admin/Editor/Viewer/Outsider test accounts. Separate unique businesses exercised queue integration; no live/customer workspace was used. Fixture/session material stays in ignored `.data/autopilot/`.
- `RADAR_DEV_STUBS=1`, social publishing flag enabled, billing off except explicit lapsed-access scenario. External AI/mail/storage credentials blank; all published outputs used stub adapters and emails stayed in local outbox. Business-local program integration used Pacific/Honolulu; UI used UTC.

## Acceptance coverage

| Criterion | Result | Independent evidence |
| --- | --- | --- |
| AC1 Owner toggle/default/persistence/tenant scope | Pass | Real Owner keyboard toggle and refresh; Admin/Editor/Viewer disabled UI and API403; outsider404; actual business switcher keeps A/B settings independent. |
| AC2 Durable orchestration/local date/deduplication | Pass | Actual registered queue jobs create calendar, social pack and Brief; repeated/concurrent ticks retain one active run; repeated program does not duplicate packs, posts or owner handoffs. |
| AC3 Calendar preservation and autonomous articles | Pass | Empty program creates researched topics; additive calendar preserves exact existing proposal/article JSON; draft worker schedules without review, due scheduler publishes through stub connector. Only the synthetic article date was advanced to exercise the due condition. |
| AC4 Supported autonomous social publication | Pass | Coordinator schedules X/LinkedIn with provenance, caps at two feed posts per platform/day, existing social workers publish each exactly once. |
| AC5 Owner handoffs | Pass | Exact owner-edited Reddit reply/source delivered to Owner outbox without marking it posted; late arrivals create new deduplicated batch; outage retries identical persisted payload. Final social-generation failures, expired accounts and uncertain publication outcomes produce handoffs. Actual browser links switch to correct business; signed-out owner signs in and returns to intended business. |
| AC6 Disable/activation/manual work | Pass | Disable blocks already claimed social publication and pause injected during actual media upload prevents create; manual unmarked post still publishes. Reenable adopts untouched old proposals while old scheduled article remains held; manual schedules and explicit manual article adoption retain independent authorization. |
| AC7 Experience/accessibility/error/mobile | Pass | Real 1440px and390px browser flows, Space activation, save503 recovery, Run-now state, no horizontal overflow or runtime errors; modal deep-link opens/closes; active program with separate social drafts paused remains clear/editable; business switching during held save response does not replace new workspace state. |
| AC8 Existing authorization/billing/preflight | Pass | HTTP401/403/404 boundaries; arbitrary API next rejected through login; lapsed Owner creates no program work; independent affected Vitest includes fail-closed billing-check errors and existing social preflight/legacy regression coverage. |

## Commands and results

- `node .factory/autopilot/qa/browser.mjs`: 12/12 scenarios passed; `qa/browser-results.json`.
- `node --import tsx .factory/autopilot/qa/helpers.mjs`: 8/8 scenarios passed; `qa/helper-results.json`.
- `node --import tsx .factory/autopilot/qa/program.mjs`: 11/11 scenarios passed; `qa/program-results.json`.
- `node .factory/autopilot/qa/switcher.mjs`: 3/3 scenarios passed; `qa/switcher-results.json`.
- `node .factory/autopilot/qa/signedout.mjs`: 3/3 scenarios passed; `qa/signedout-results.json`.
- `node .factory/autopilot/qa/tests.mjs src/server/services/autopilot src/server/services/social/proactive.test.ts src/server/services/social/proactive.db.test.ts src/server/services/social/publish/publish.test.ts src/server/billing/guard.test.ts`: 6 test files,81/81 tests passed, including database tests. Log `.data/autopilot/qa-focused-tests.log`.
- `npm run typecheck`: passed; `.data/autopilot/qa-typecheck.log`.
- `node .factory/autopilot/qa/fingerprint.mjs --check`: final source unchanged.

37 independent browser/integration scenarios and81 affected tests passed. Focused checks were rerun after code freeze; the actual switcher and signed-out login tests ran against the same unchanged relevant source.

## Findings closed during implementation

- Email business links originally appended a query the app did not consume. Fixed by the existing authenticated business-selection hop. Retested in real browser with another business selected and through signed-out password login.
- Review identified missing final social child-generation failure escalation after generation moved into its own job. Added provenance-filtered failure handoff and independently reproduced with a terminal failed job.
- Initial switcher harness failures were corrected: HTTP response event occurs before React's render commit, and raw default JSON lacks an `enabled` key. Retested with rendered-state waits/default normalization; no product state bleed was found.

## Evidence and limits

Synthetic screenshots: `qa/settings-off-desktop.png`, `qa/settings-on-desktop.png`, `qa/settings-on-mobile.png`, `qa/settings-save-error.png`, `qa/social-autopilot-context.png`, `qa/handoff-correct-business.png`, `qa/switcher-business-b-on.png`, `qa/signedout-handoff-return.png`.

Full-suite baseline before feature work had one unrelated failure in `src/server/ai/openrouter.qa.test.ts` (golden image hash expected f883614e6a7dfb07 vs91d5409f50974af7); baseline had921 tests passed and211 skipped. QA did not change that fixture. PM owns the final full-suite/build result.

No live-provider publishing, real Resend delivery, production deployment or paid-marketing capability was tested. Community comments/replies intentionally remain Owner handoffs because existing adapters support feed posts only. Passing these checks does not establish performance or external-provider reliability.
