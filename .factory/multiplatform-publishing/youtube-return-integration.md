# E5 YouTube OAuth return integration

19 November 2026. Engineer workspace `/Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push`, branch `kenny/youtube-oauth-return`, starting revision `4d3a72b38d25b3b6343297b61af1732f0e59f136`. Existing dirty factory release/verification records preserved. No commit, push, deployment, Google Cloud action, real post, or production data/preference change performed by this engineer.

## Evidence and implementation

Architect A5 found two successful production YouTube authorizations and encrypted pending grants, with no connected account. Independent QA reproduced the defect using the real helper through a local COOP provider hop: opener lost, pending grant created, no account, silent return to intro. This establishes a client completion delivery failure; it does not establish a broken token exchange or insufficient provider app configuration.

Implemented the approved A5 contract:

- Each synchronous `openOAuth` call generates a UUID before opening the popup and installs listeners first. `radar_flow` is persisted inside the existing OAuth state query data. The callback derives its return nonce only from validated stored state. Existing session/provider/business binding and one-time state consumption are preserved.
- Callback retains exact-origin direct `postMessage` and adds a nonce-named BroadcastChannel and same-origin localStorage event. Public payload is allowlisted to success/error plus opaque pending reference/channel/picker flag. No provider code/token/credential is transported. Storage is immediately removed after writing, while the queued storage event retains its newValue.
- Client requires provider/nonce/timestamp agreement; direct messages additionally require popup source and exact origin, storage requires matching origin/storage area. Stale, wrong-attempt, malformed, duplicate and late results are ignored. Completion cleans listeners, channel, own storage and timeout once.
- The helper does not interpret WindowProxy.closed as cancellation because COOP can report true during consent. It waits at most ten minutes and supports AbortSignal. Social modal Cancel/Close/unmount, Search Console Cancel sign-in/unmount and blog Cancel/close/unmount abort pending transport. Waiting guidance explains how to recover after a closed or unresponsive provider window.
- Social/blog/GSC errors now provide visible recovery guidance. YouTube partial known scopes and missing channel have safe distinct codes; generic exchange/HTTP failures remain generic. Required scopes remain unchanged and partial known grants cannot create a pending authorization.
- Privacy and terms dated November 19 describe the actual two YouTube scopes, channel/upload data, user-approved publishing, AI data boundary, disconnect semantics, Google Privacy and YouTube Terms links. No unimplemented retention deadline or Google verification approval is asserted. Published history may remain, remote videos are removed through YouTube controls.

Instagram picker semantics unchanged. The reported Instagram screenshot was resolved by PM completing the already selected account's final Connect account step; no Instagram-specific fix was justified.

## Changed source inventory

Transport: `src/lib/oauthReturn.ts`, `src/client/api.ts`, `src/app/api/oauth/[provider]/{start/route.ts,callback/route.ts,popup.ts}`.

Callers: `src/features/social/channels/ConnectSocial.tsx`, `src/features/gsc/GscConnect.tsx`, `src/features/publishing/BlogConnect.tsx`.

Provider failures: `src/server/services/social/publish/{youtube.ts,oauth.ts}`.

Disclosures: `src/app/(public)/{privacy,terms}/page.tsx`.

Tests: rewritten `src/client/api.test.ts`; new `src/lib/oauthReturn.test.ts`, `src/app/api/oauth/[provider]/popup.test.ts`, `src/app/api/oauth/[provider]/callback/route.test.ts`, `src/server/services/social/publish/youtubeOAuth.test.ts`.

No migration, dependency, requested-scope, environment contract or global COOP header change.

## Engineer verification

Node v22.18.0 used explicitly. Focused command:

```sh
npx vitest run src/client/api.test.ts src/lib/oauthReturn.test.ts 'src/app/api/oauth/[provider]/popup.test.ts' 'src/app/api/oauth/[provider]/callback/route.test.ts' src/server/services/social/publish/youtubeOAuth.test.ts src/server/services/social/publish/multiplatform.test.ts src/server/services/social/publish/adapters.test.ts src/server/services/social/publish/instagramUnified.test.ts src/server/services/publishing/oauth.test.ts --maxWorkers=1
npm run typecheck
git diff --check
```

Results: **104/104 tests passed across nine files**, typecheck exit 0, diff check clean. Logs `/tmp/radar-youtube-return-focused.log` and `/tmp/radar-youtube-return-typecheck.log`. Client tests include real helper behavior for COOP-closed proxy, concurrent reverse completion, storage-only, direct-only, unavailable transports, exact source/origin/provider/nonce/timestamp, abort, timeout and cleanup. Server tests execute actual popup script and actual route handler with mocked storage/provider boundaries; provider tests exercise the actual callback/exchange/channel logic and verify failed grants are never saved. No new engineer DB fixture required; independent QA separately exercises real encrypted pending state and final account persistence.

Tested base plus all 17 modified/new `src` files SHA256: `5f8e7f969eee6017d1c67e7a997f33fd700aee128a453ebb74f84a7d854db65f`. Computed as sorted relative path + NUL + file bytes + NUL. All source/test files frozen for independent QA/build; only this handoff record written afterward.

## Limits and integration

Independent QA/build are separate passes owned by QA/architect. Engineer did not run a live Google consent or claim Google verification completion. Local provider simulations cannot prove Google review approval. Browser environments blocking both fallback transports and losing opener time out visibly; explicit Cancel remains available.

The architect's YouTube API-derived data retention/freshness cleanup design remains a separate verification prerequisite. This urgent transport patch does not implement or attest that cleanup and does not erase production history. PM owns Google verification/demo, final scope justification, merge and deployment. No new configuration or migration is needed for this patch; deploy normal web source and validate an authorized real connection afterward without publishing content.
