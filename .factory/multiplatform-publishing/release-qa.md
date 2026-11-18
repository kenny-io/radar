# Independent release QA: multiplatform publishing

Local release acceptance passed on 2026-11-19 (Asia/Dubai). No unresolved feature defect was observed. The isolated release implementation is suitable to proceed through the user's authorized merge/deployment; production confirmation remains pending below.

## Actual tested release

Workspace `/Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push`, branch `kenny/multiplatform-publishing`, clean main base `3c3ded28945394df71fc49c41a4d8d066b445662` plus the isolated feature port. The original dirty feature checkout was not modified or used as the release runtime. The verified content was subsequently committed as `e81d816bc628c9d3be7a2658df94e1394a0224b3`; the full fingerprint check confirms identical tested source/configuration/public files at that commit. Exact source/config/public SHA256 `3bc90cbbd941a042f9d32ce890a3cafddec53c66ff63349e5969bb8382730435` over783 files, with per-file map in `release-qa/fingerprint.json`. Checked unchanged after all local verification and server shutdown.

Local app `http://localhost:3841`, Node22.18.0, real Google Chrome through Playwright at1440×1000 and390×844. Dedicated `radar_multiplatform_release_qa` PostgreSQL database on localhost54329, synthetic verified-email Owner/Editor/Viewer/Outsider accounts, owned JPEG and real two-second MP4. External providers stubbed or fully mocked; billing and external mail/AI disabled. Runtime/session configuration is ignored under `.data/multiplatform-release-qa`. No real account publication or customer setting was changed.

## Independent results

| Area | Result | Evidence |
|---|---|---|
| Connections, YouTube media/options, TikTok choices/consent/restrictions, mobile/keyboard, Post now all five providers/history, permissions |19/19 real Chrome scenarios | `release-qa/browser-results.json` |
| Actual generated three-platform job, caption consent invalidation, creator restrictions refresh, processing versus posted, rejection, schedule/unschedule, expiration/reconnect/disconnect/history |8/8 real Chrome scenarios | `release-qa/flow-results.json` |
| Unified Login explicit asset picker, no default account, empty assets, keyboard/390px, encrypted selection persistence, tenant/user/role isolation, stable reconnect, callback state/user/replay checks |8/8 real Chrome scenarios | `release-qa/unified-browser-results.json` |
| Accepted-reference recovery, unknown outcomes, status permissions, real-byte duration limit, scheduled new providers, foreign media refusal |8/8 DB/mock scenarios | `release-qa/integration-results.json` |
| Anonymous/Viewer/outsider, Origin, malformed/HEIC/header-only files, actual MIME/duration, foreign pack/account |7/7 HTTP scenarios | `release-qa/api-results.json` |
| Server-bound Unified config/mode, Meta credentials/client business and cursor discovery, encrypted pending, Never/finite expiry, no legacy SUAT refresh/revoke, correct host/durable publication, saved-version legacy compatibility |6/6 DB/mock scenarios | `release-qa/unified-integration-results.json` |
| Current-main master Autopilot schedules X/LinkedIn/Instagram, leaves TikTok/YouTube without individual choices in drafts, repeated runs dedupe; program pause revokes only its queue and manual scheduling still works |2/2 integration scenarios | `release-qa/automation-results.json` |
| Business deletion or master pause during Instagram status-read await blocks final media_publish; accepted reference remains locked, recovery never creates another container/post |2/2 integration scenarios | `release-qa/lifecycle-results.json` |
| Focused feature, current-main Autopilot/email-cadence, lifecycle publishing/engagement, verified-email and regression tests |249/249 tests across14 files | `.data/multiplatform-release-qa/focused-tests-final.log` |
| Typecheck before/after shutdown, whitespace check, unchanged source/configuration |Passed | `.data/multiplatform-release-qa/typecheck.log`, `typecheck-after-stop.log`, fingerprint check |

Total: **35 real-browser scenarios plus25 integration/HTTP scenarios passed**. Browser exception checks found none. Latest desktop YouTube editor and mobile Unified picker screenshots were visually inspected.

The prior old-checkout Q1/Q2 results are historical; these checks exercised the actual latest-main release port. Current-main deletion and lifecycle hooks, active-business gates, verified-email sessions and owner email cadence were included in this verification.

## Baseline and environment distinctions

An initial diagnostic run used the shell's ambient Node24 and observed248 passes plus one existing time-sensitive Autopilot test failure. This was not counted as final release verification. The engineer reproduced that same test on unmodified3c3ded2: the current UTC time had passed the23:30 daily-email fallback. The test fixture now pins Date at noon for that case; production cadence and assertions were preserved. The independent supported Node22 rerun passed all249 tests, including the daily email cadence cases.

No production implementation changes were made by QA. The dev server used the already-included default `.next` path; `tsconfig.json` remained exactly equal to clean main, and no generated include cleanup was needed. QA server stopped and localhost3841 was confirmed clear. Runtime fixture/session files are ignored. Reports, scripts and synthetic result JSON contain no real credentials or customer data.

## Reproduction

From the release worktree, use Node22 in PATH:

```sh
node .factory/multiplatform-publishing/release-qa/setup.mjs
node .factory/multiplatform-publishing/release-qa/server.mjs
node .factory/multiplatform-publishing/release-qa/release-final.mjs
node .factory/multiplatform-publishing/release-qa/run.mjs npm test -- src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts src/server/services/social/publish/instagramUnified.test.ts src/server/services/social/publish/instagramUnified.db.test.ts src/server/services/social/publish/multiplatform.test.ts src/server/services/social/publish/multiplatform.db.test.ts src/server/services/social/publish/video.test.ts src/server/services/social/publish/publish.test.ts src/server/services/social/social.test.ts src/server/services/autopilot src/server/services/lifecycle/engagementPublishing.test.ts src/server/services/lifecycle/autopilotIntegration.test.ts src/server/auth/verification.test.ts
node .factory/multiplatform-publishing/release-qa/run.mjs npm run typecheck
node .factory/multiplatform-publishing/release-qa/fingerprint.mjs --check
```

The browser upload fixture is a real MP4 generated by ffmpeg, retained in ignored `.data/multiplatform-release-qa/fixture.mp4`. Start the server in a separate process before `release-final.mjs`. Individual checks and logs are named `{browser,flows,integration,api,unified-browser,unified-integration,automation,lifecycle}-final.log` under that ignored runtime directory. Screenshots under `release-qa/` are ignored and synthetic only.

## Production confirmation

Pending PM-confirmed deployed SHA and completed web/worker deployment. Prepared anonymous read-only smoke script `release-qa/live-smoke.mjs` requires `LIVE_DEPLOY_SHA`; it checks readiness, sign-in boundaries and OAuth/callback fail-closed behavior using GET only, without cookies, form submissions, customer preference changes or publishing. Public health does not expose a revision; deployment SHA must be established independently by PM deployment evidence.

Authenticated production settings/connection screens require an existing legitimate session and coordinated ownership of the user's Chrome through CUA. No fake production authentication will be created. Actual external Instagram/TikTok/YouTube authorization and real publishing remain unrun unless specifically performed and recorded. Missing developer-app approval/target-account access must not be inferred from local stub success.
