# Autopilot release QA

## Local release recommendation

Independent release-base checks pass. No unresolved Autopilot or signup-security integration defect was found. The release is suitable to proceed through the user's authorized migration and deployment, with production confirmation still pending below.

Workspace `/Users/ekene/.codex/worktrees/autopilot-release/radar-push`, branch `kenny/autopilot`, clean production base `60c68af34c6f80eee8fd7efa8eb2f02c3794394d` plus the isolated Autopilot integration. The original feature checkout's unrelated unpublished changes were not used as the release source. Exact changed-source SHA256 map: `release-qa/fingerprint.json`, aggregate `d9a60ee91fb6b36fe7d709d5836b68c8ea42c07d38e0ae9754a542eedacc4b39`; checked unchanged after verification.

Application `http://localhost:3831`; isolated database `radar_autopilot_release_qa` on localhost:54329; development stub providers; external mail/AI credentials blank. Synthetic test users include `email_verified_at`, preserving the production verified-email session requirement. No production customer account was changed or activated.

## Independent checks

| Area | Result | Evidence |
| --- | --- | --- |
| Owner setting, persistence, keyboard/mobile, save failures, permissions | 12/12 browser scenarios pass | `release-qa/browser-results.json`, synthetic desktop/mobile screenshots |
| Real multi-business switcher, independent activation/preferences/job payloads, switching during pending save | 3/3 browser scenarios pass | `release-qa/switcher-results.json` |
| Empty program to calendar/social/Brief workers, scheduled social publication, autonomous article publication, Reddit email, dedupe, reenable/pause, billing, failed-generation/expired-account/unknown-outcome escalation and manual adoption | 11/11 integration scenarios pass | `release-qa/program-results.json` |
| Signed-out email link through password login to intended business, anonymous POST401, arbitrary API next rejected | 3/3 browser scenarios pass | `release-qa/signedout-results.json` |
| Existing signup security and Autopilot tests | 74/74 tests pass across7 files | `.data/autopilot/release-qa-tests.log` |

29 independent browser/integration scenarios passed. The due-article integration scenario advances only its synthetic fixture publication date so the real scheduler and connector execute. Social/CMS outputs use local stub adapters; owner messages remain in the local outbox.

Commands run from the release worktree:

- `node .factory/autopilot/release-qa/browser.mjs`
- `node .factory/autopilot/release-qa/switcher.mjs`
- `node --import tsx .factory/autopilot/release-qa/program.mjs`
- `node .factory/autopilot/release-qa/signedout.mjs`
- `node .factory/autopilot/release-qa/tests.mjs src/server/auth/requests.test.ts src/server/auth/verification.test.ts src/server/auth/googleIdentity.test.ts src/server/auth/claim.test.ts src/server/billing/guard.test.ts src/server/services/autopilot`
- `node .factory/autopilot/release-qa/fingerprint.mjs --check`

The initial signed-out browser request hit a transient404 while the development server simultaneously compiled the sign-in route; the server subsequently served it200. Repeating the complete signed-out/login flow on unchanged source passed. No implementation change was required.

PM additionally reports the production build passed and the full release suite passed915 tests with227 skipped, retaining the same pre-existing OpenRouter golden-image hash failure. Those broader results belong to the PM's release evidence, not independent QA's74-test result.

## Production confirmation

Pending PM confirmation of deployed commit and both services. Prepared read-only script: `release-qa/live-smoke.mjs`; it requires `LIVE_DEPLOY_SHA` and blocks browser non-GET/HEAD/OPTIONS requests. Planned health, anonymous access/privacy, signed-out email-hop authentication redirect, desktop/mobile rendering, static assets and verification-page privacy/header smoke. No form submission, customer Autopilot activation, publishing or email will occur.

Live authenticated settings require an existing legitimate session. Chrome DevTools session discovery reported its profile locked by an existing browser and native CUA discovery timed out; QA cannot currently access such a session. Unless access becomes available, production authenticated UI is explicitly unverified and supplemented by the verified-user isolated browser evidence and PM read-only runtime/database checks.
