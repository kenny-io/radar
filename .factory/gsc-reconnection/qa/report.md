# Independent release QA — Search Console reconnection

Verified November 27, 2026 (Dubai), on `kenny/gsc-reconnection-banner`, based on production main `ba78a2cfd413428ec1ef3e69708e299dc3aecdea`. This supersedes the earlier dirty-workspace QA for release purposes. Exact SHA-256 fingerprints for the nine tested product sources are in `browser-results.json` and matched current source after testing.

## Environment and scope

Node 22.18.0, Playwright bundled Chromium (headless), `http://localhost:3846`, separate `.next-gsc-reconnection-release-qa` output. Distinct isolated database `radar_gsc_reconnection_release_qa` on local PostgreSQL port 55470. Synthetic verified Owner, Editor, Viewer and Outsider accounts and two synthetic businesses. Integrations stubbed, external failure alerts disabled, no worker run. No production writes or real Google consent in these local checks. Local session fixture and logs are ignored by the adjacent `.gitignore`.

Current main's nonce-bound OAuth/COOP transport and lightweight workspace response contracts were retained. QA used the actual application OAuth state/callback and reconnection routes for success cases; failure/cancel fixtures supply the current `radar_flow` nonce and timestamp. Main's existing client/OAuth files and tests were not replaced with the earlier implementation.

## Acceptance coverage

**18 of 18 required browser groups passed. No product failures found.**

- **GSC-AC1:** visible top banner for invalid authorization across Dashboard, Performance/Search, Settings and Profile, including reload. No false banner for connected, syncing, skipped or unconnected states. Rate-limit, service-outage and network failures retain Resume in Performance/Search.
- **GSC-AC2:** actual local nonce-bound stub OAuth and reconnect HTTP action clear the warning, retain the original property, saved date, historical row and cursor, and enqueue the appropriate incremental or remaining-backfill job. Blocked popup, closed popup with explicit **Cancel sign-in**, declined permission, missing property access and server failure keep recovery actionable. Cancel followed by another real stub attempt succeeds. No disconnect or property picker is required.
- **GSC-AC3:** authorization states do not render the old temporary-error/Resume message in affected surfaces. Settings agrees with the banner. Raw provider diagnostics are not shown.
- **GSC-AC4:** desktop 1440px and mobile 390/320px are readable with the action near the top and no horizontal overflow. Keyboard focus works. Light/dark copy contrast is 5.19:1 / 7.15:1. Shared Settings/banner pending state prevents duplicate attempts. A correct-nonce postMessage from the wrong window is ignored. Switching businesses during consent prevents stale recovery or replacement of the newly selected workspace.
- **GSC-AC5:** Viewer sees editor/admin guidance and no reconnect button; actual write returns 403. Editor reconnects successfully. Outsider reconnect and workspace access return 404.
- No browser runtime exceptions observed.

Independent focused tests: **48 of 48 passed across six files**, including existing current-main OAuth client, return validation, popup, and callback tests plus the new classification and recovery action tests.

## Optional fixture limitation

One additional synthetic COOP-severing browser experiment is **blocked/unverified**: its cross-origin consent fixture never displayed, before the callback or recovery path. One bounded correction to a local alternate origin gave the same fixture timeout. The original failed attempt and stack remain in `browser-results.json` with explicit `status: blocked` and `required: false`; it is not counted as a product pass. Main's OAuth transport is unchanged and covered by its passing independent tests, and the real local nonce-bound callback/reconnect flow passed. No claim is made that this additional browser experiment verified COOP severing.

## Commands and evidence

```sh
node .factory/gsc-reconnection/qa/setup.mjs
node .factory/gsc-reconnection/qa/server.mjs
node .factory/gsc-reconnection/qa/browser.mjs
npx vitest run src/lib/gsc.test.ts src/server/actions/gsc.reconnect.test.ts src/client/api.test.ts src/lib/oauthReturn.test.ts 'src/app/api/oauth/[provider]/popup.test.ts' 'src/app/api/oauth/[provider]/callback/route.test.ts'
```

Use Node 22 (tested binary `/Users/ekene/.nvm/versions/node/v22.18.0/bin/node`). The setup creates only the named isolated local database and synthetic users. Successes use actual local stub routes and database writes. Failure fixtures are local. No worker processes imported Search Console data; queued work and retained rows were verified directly.

Evidence: `browser-results.json` (scenario results, limitation, exact source hashes), `banner.png` (clean synthetic element preview), `banner-keyboard-focus.png`, `desktop.png`, `mobile-390.png`, and `mobile-320.png`. All screenshots contain synthetic local content. QA server stopped after verification; generated Next TypeScript include was handed to PM/engineer for cleanup.

Initial seed setup was updated for main's newer email-verification authentication requirement. This was a local fixture compatibility correction, not a product defect or relaxed acceptance criterion.

## Recommendation

Accept for release with the stated optional fixture limitation. Existing main build/typecheck and broader release checks belong to PM/engineer evidence. Actual Google consent, Safari, physical-device and assistive-technology validation were not performed. Production verification is recorded separately after deployment. Do not force a production connection failure to demonstrate the banner.
