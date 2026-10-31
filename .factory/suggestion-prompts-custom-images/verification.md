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

Application implementation and verification are complete. Independent QA also passed a smoke test using the completed production build (`next start`): sign-in, persisted Brief mobile prompt and reachable social generation controls. All QA web/worker processes stopped and browser session storage files deleted.

- Product commit: `960d5bc10b8b848a5859d5485443bb1d2f1de699`. Its application source matches the tested fingerprint.
- Draft PR: https://github.com/kenny-io/radar/pull/16 targeting main. Created and attached to this chat. GitHub confirms OPEN, draft and MERGEABLE/CLEAN; no configured status checks.
- Final follow-up commit contains delivery/QA documentation only; application source remains unchanged.
- Release status: implemented and locally verified, with the documented pre-existing test exception. Unmerged and undeployed; production remains unchanged.

## Production release — 31 October 2026
- User authorized merge and deployment. PR #16 marked ready and merged with expected head `0b83753338c0201c0a5d1daba15f88de6398c87a`; main merge commit `2524537da22eae7644829c05069b3b3320995c83`. Main application/contract source matches the tested revision.
- Railway worker deployment `53c7689b-3dc7-4466-8200-f48ca7e868d5`: success at 10:12:32 UTC / 14:12:32 Asia/Dubai.
- Railway web deployment `7110231c-a208-46e0-9832-b9762eb2613a`: success at 10:14:04 UTC / 14:14:04 Asia/Dubai. Aggregate GitHub production deployment `7457248098`: success at 10:14:07 UTC.
- Production home/sign-in return 200; protected routes redirect signed-out visitors to signup. An initial connection reset during rollout resolved on retry.
- Independent release QA: desktop/mobile public page rendering passes; five protected routes respect authentication; all 23 actual referenced assets return 200, including the exact served Performance, Social, Brief and Article bundles containing the new controls. See release-qa.md.
- Authenticated production interactions remain untested because no signed-in session was available. No customer content was modified and no live image generation or publishing was triggered.
- Evidence: ignored `.data/suggestion-prompts-custom-images/production/` and `production-qa/`. Railway CLI authentication was unavailable; successful deployments were confirmed through GitHub/Railway statuses and the deployed site.
- Final status: merged and deployed to production.
