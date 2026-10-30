# Verification

## Baseline and environment
- Clean base `9d6c4016`; `origin/main` is merge commit `4e1cd23f` with identical source. Fetched again before delivery: unchanged.
- Baseline typecheck passed. Baseline full suite: 585 passed, 161 skipped, 1 failed out of 761. The existing OpenRouter template raster golden expects `f883614e6a7dfb07`; this environment renders `91d5409f50974af7`. Earlier feature records document the same failure.
- Local PostgreSQL 15 on `127.0.0.1:55439`: isolated UI database `radar_custom_images`, separate test database `radar_custom_images_tests`. Migrations and dummy dev seed passed. No production data or publishing used.
- Browser environments: port 3043 with deterministic integrations and no image provider; port 3044 with a deterministic image-provider fetch mock and a real no-cron queue worker. Provider output alone is mocked; authentication, RPC, persistence, cropping, storage, queue and SSE run normally.

## Exact source
Fingerprint `207e6244c8f3424f9ab9c189933ad95a573cb7d3f867d5205adb2b5c09debbfa` covers 26 changed/new source and contract-document paths. SHA-256 input is sorted relative path + NUL + bytes + NUL. Manifest: ignored `.data/suggestion-prompts-custom-images/source-fingerprint.json`. PM and independent QA computed the same fingerprint; subsequent source comparison is unchanged.

## Checks
- Engineer E1 focused prompt/clipboard tests: 12/12 passed; PM independently reran them.
- Engineer E2 focused provider, real-Postgres action/job and article-body tests: 38/38 passed. Independent QA combined focused suite: 50/50 passed.
- Integrated `npm run typecheck`: passed.
- Integrated `DATABASE_URL=<isolated test DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test`: 728 passed, 65 skipped, 1 failed out of 794. The sole failure is the exact baseline raster hash difference above. No new failing test. Log: `.data/suggestion-prompts-custom-images/full-tests.log`.
- `NEXT_DIST_DIR=.next-custom-images-build DATABASE_URL=<isolated test DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm run build`: passed compilation, type validation, static generation and tracing. Log: `.data/suggestion-prompts-custom-images/build.log`.
- `git diff --check`: passed. Impeccable mechanical scan of the five changed UI components returned `[]`.
- Restored `tsconfig.json` to its exact baseline after Next automatically added temporary development/build type includes. No configuration or dependency change ships.

## Independent browser evidence
See `qa.md` for final recommendation, scenarios and evidence. Ignored scripts, result JSON and desktop/mobile PNGs are in `.data/suggestion-prompts-custom-images/qa/`.

- All four suggestion kinds: 10 individual/all copy actions, exact context and scope, real clipboard readback, Enter activation, denied clipboard/manual recovery, no write RPCs or changed suggestion rows.
- Viewer copying and disabled image controls; direct Viewer writes rejected with 403. Blank/overlong input 400, foreign tenant 404 and publication locks 409 without provider calls.
- Social current-platform generation, actual platform dimensions, saved direction and asset reload, other-platform/text preservation, failure retention, retry and stale overlapping request rejection.
- Immediate article prompt generation, saved cover and strict regeneration, shared body direction after custom cover success, failure retention and publication lock transition while rendering.
- Daily Brief complete-set success, partial failure without losing the previous set, saved direction retry, Change/Remove during generation, remove/re-add staleness protection, and real queue retry after aged failed/done/missing jobs.
- Desktop and 390px mobile core flows pass without horizontal overflow. Generate image is reachable by scrolling on mobile; full-page sticky screenshot artifacts were checked against the actual viewport.

## Limits and delivery
Live-provider image quality and likeness are unverified. Reference-photo upload/search is excluded. No external CMS/social publish, merge or deployment occurred. Existing optional live suites without credentials remain skipped.

Application implementation and verification are complete. Commit, draft PR and final release state will be recorded below after delivery.
