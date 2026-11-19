# Q4 independent YouTube OAuth return QA

19 November 2026. **Recommend shipping the urgent OAuth transport fix.** No unresolved regression observed in this bounded verification. Google review approval and YouTube retention compliance are separate work; this report does not attest either.

## Tested integration

Workspace `/Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push`, branch `kenny/youtube-oauth-return`, base HEAD `4d3a72b38d25b3b6343297b61af1732f0e59f136` plus frozen E5 working-tree changes. Final source/config/public fingerprint: **`a4a663b2f9948e2c8e5247a9df684d112fd86bd3ff8e96cfa810023c717ae3b7`**, 788 files, sorted path + NUL + bytes + NUL; per-file manifest `/tmp/radar-youtube-return-qa/fingerprint.json`. Reviewed A5 architecture and E5 integration contracts, transport/callback/caller/provider changes and focused tests. Existing factory records preserved. No implementation, credentials, deployment or real-account changes made by QA.

Local Chromium/Playwright at `http://localhost:3841`, separate provider-hop origin `http://localhost:3842`, Node v22.18.0, dedicated synthetic Postgres DB `radar_multiplatform_release_qa` at localhost54329. Ordinary synthetic verified workspace owner; no fabricated production authentication. Local provider fetch adapter returns synthetic Google responses and rejects unexpected Google calls. Real start, stored OAuth state, callback, encrypted pending grant and final connect execute; positive regression does **not** fake an openOAuth result.

## Baseline failure and retest

Baseline actual modal/start/callback through a COOP `same-origin` provider hop reproduced the reported failure: popup opener lost, encrypted pending grant created, zero account rows, intro silently remained with no useful error. `/tmp/radar-youtube-return-qa/baseline.json` and `baseline.png`. This is a high-severity connection completion failure; fixed retest reaches exactly one connect and survives page refresh. The local hop demonstrates the isolation failure mechanism; it does not claim inspection of live Google response headers.

## Acceptance coverage

**Passed: 21 browser scenarios**, recorded individually in the JSON evidence below:

- YouTube UI 9/9: actual normal return; COOP opener lost; storage fallback without BroadcastChannel; BroadcastChannel fallback with OAuth storage unavailable; explicit Cancel followed by late real callback (no account and no localStorage residue); actual exchange failure, missing channel and partial scopes with useful visible errors and no account; no unhandled browser exceptions. Successful connections persist after refresh and connect once.
- Protocol 5/5 using bundled actual client helper and real popup/callback: wrong origin/source/provider/flow, stale/future/malformed messages ignored; callback query nonce cannot override stored state; duplicates resolve once; abort ignores late callback; bounded ten-minute timeout; blocked popup; direct path with both fallback transports unavailable. Several assertions are grouped in each recorded scenario.
- Shared callers/disclosures 7/7: Search Console real COOP return reaches property picker; explicit cancellation prevents late completion; scope failure explains read-only permission; GitHub blog real COOP return loads repository choices; Blog Cancel ignores late return; public privacy/terms show actual YouTube scopes/data uses and policy/revoke links without invented retention promises; no shared-caller runtime exceptions.

**Passed: 93/93 independent focused tests across 9 files**, including callback session/provider/state replay boundaries, popup payload sanitization/no residue, provider failures, legacy publishing OAuth, multiprovider and Unified Instagram DB regressions. Node22 typecheck passes. Diff whitespace check passes; `tsconfig.json` and `next-env.d.ts` remain identical to HEAD.

**Failed:** none after integrated fix. Baseline failure above is reproduced and resolved. No unrelated baseline test failures encountered in this selected run.

**Blocked/not performed:** actual live Google consent and production owner confirmation (PM owns browser/Google console); Google verification approval; real posting. These are not established by local provider simulation. Mobile layouts, keyboard traversal and screen-reader behavior were not independently rerun for Q4; earlier release UI evidence is separate and does not substitute for these checks. Retention cleanup was explicitly outside urgent transport scope and is not marked passed. No new migration, scope or dependency changes require migration QA.

## Reproducible commands and evidence

All Q4 artifacts are in `/tmp/radar-youtube-return-qa/` (synthetic data, no real secrets):

- `baseline.mjs`, `browser-final.mjs`, `transport.mjs`, `shared.mjs`; run each with Node22 from the workspace while `server.mjs` is running. Runtime settings/session fixtures are ignored under `.data/multiplatform-release-qa/` and are not release artifacts.
- `browser-results.json` / `browser-final.log`, `transport-results.json` / `transport.log`, `shared-results.json` / `shared.log` contain per-scenario outcomes.
- Screenshots: `success-coop.png`, `success-normal.png`, `success-storage.png`, `success-broadcast.png`, `qa-exchange-failed.png`, `qa-channel-missing.png`, `qa-partial-scope.png`, `github-authorized.png`. COOP success screenshot visually inspected by QA.
- `provider-requests.jsonl` records only mocked endpoint/scenario labels.
- `focused-tests.log`, `typecheck.log`, `typecheck-final.log`, `fingerprint.json`.

Focused command (using explicit Node22 PATH and existing isolated QA env wrapper):

```sh
node .factory/multiplatform-publishing/release-qa/run.mjs npm test -- src/client/api.test.ts src/lib/oauthReturn.test.ts 'src/app/api/oauth/[provider]/popup.test.ts' 'src/app/api/oauth/[provider]/callback/route.test.ts' src/server/services/social/publish/youtubeOAuth.test.ts src/server/services/social/publish/multiplatform.test.ts src/server/services/social/publish/instagramUnified.test.ts src/server/services/social/publish/instagramUnified.db.test.ts src/server/services/publishing/oauth.test.ts
node .factory/multiplatform-publishing/release-qa/run.mjs npm run typecheck
git diff --check
git diff --quiet HEAD -- tsconfig.json next-env.d.ts
```

QA's local Next/provider-hop processes were stopped after browser completion. PM owns merge/deploy and authorized post-deploy real consent confirmation. Passing these observed checks does not establish correctness in every browser or provider account configuration.
