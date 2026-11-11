# Independent QA — image provider account errors

Software repair verification **passed**. Real image generation recovery remains **unverified / dependent on a funded provider**. The repair provides an accurate unavailable state; mocked success is not evidence that production generation is restored.

## Provenance and environment

Release worktree `/Users/ekene/.codex/worktrees/daily-social-release/radar-push`, branch `kenny/image-provider-errors`, base `d8ac2d3a537c9d970e493d2e3940e8b6aba33c11` plus the reviewed repair. Exact tested `images.ts` SHA-256 `beb717a60965d3deb0dc5afade8e5f811047046d861ba0c46cffebdc5cf6dc45`; new test SHA-256 `366c0d8384a11bcc47915a99c08816481e2b8e178d4ae268e27c63f3e9a516eb`. Full affected-file hashes in `image-failure-qa/fingerprint.json`.

Local database `radar_daily_social_release_qa` on Docker PostgreSQL localhost54329, previously migrated from current main. Ordinary locally verified synthetic `dev@radar.local` account, existing synthetic prepared social pack. Next development web at localhost3120, dedicated `.next-image-failure-qa` output, billing off. No worker running.

Browser used real headless Chrome/Playwright at desktop1440×1000 and mobile390×844. QA supplied only dummy provider keys with development stubs off so actual image routing/classification ran. A QA-only Node fetch preload returned the recorded response shapes for the three image endpoints: OpenRouter402 insufficient credits, OpenAI429 insufficient_quota, xAI403 credits/monthly limit. It blocked every other external fetch. No live provider call, payment, account funding/configuration change, customer mutation, email or social send occurred.

## Acceptance coverage

| Criterion | Result | Evidence |
|---|---|---|
| AC1 original image and honest failure | Passed | Explicit prefilled Generate image produced503/image_unavailable. Prior image URL, seed, style, metadata and post text stayed unchanged. Browser still displayed the stored original image after reload, with no canvas/template replacement and no `Image generated` success toast. Edited prompt remained saved for retry. |
| AC2 provider-state classification | Passed | Nine independently rerun regression tests cover recorded account errors, account cooldown with zero new requests, cooldown expiry/raster recovery, successful direct fallback, mixed transient500/ordinary429 failures, breaker skip remaining transient, shared OpenRouter cooldown and existing optional background-template fallback. Existing OpenRouter tests cover moderation/account distinction. |
| AC3 independent automated and browser verification | Passed |68/68 focused tests and3/3 bounded real-browser scenarios passed. Server-action RPC returned safe support-directed copy. Initial request hit exactly3 mocked routes; retry hit zero routes during cooldown. |
| AC4 real generated image/storage after funding | Blocked externally / not exercised | Owner intends to add OpenRouter credits; actual funding confirmation is pending. PM owns any authorized operational recovery and real funded render/readback. This local pass makes no claim of production generation recovery. |

## Commands and evidence

`DATABASE_URL=<isolated local QA DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test -- src/server/services/imageAvailability.test.ts src/server/ai/openrouter.test.ts src/server/actions/customImages.db.test.ts` — **68/68 passed**, three files, no skips. Log `image-failure-qa/focused-tests.log`.

`node .factory/daily-social-drafts/image-failure-qa/server.mjs` then `node .factory/daily-social-drafts/image-failure-qa/browser.mjs` — **3/3 passed**:
1. Prefilled field submitted its displayed prompt; all three mocked account failures yielded503 `image_unavailable`, exact safe text `Image generation is temporarily unavailable. Your previous image is kept. Please contact support.`, unchanged prior image fields and no false success.
2. User edited the prompt and retried;503 persisted, cooldown made zero further provider calls, edited prompt and old image survived refresh, mobile had no horizontal overflow.
3. No browser runtime errors.

Machine-readable evidence: `image-failure-qa/browser-results.json`, sanitized `provider-calls.jsonl` (provider/status/time only). Screenshots: `unavailable-desktop.png` and `retained-prompt-mobile.png`. Reviewed the desktop unavailable screenshot; it shows the existing visual and support message rather than a fake generated image.

PM reports production build passed on the final source. QA did not rerun a broad build/full suite, real provider request, or unrelated prefill flows; those limits are deliberate. No confirmed regression was found within the observed scope.

## Cleanup

Stopped QA server and confirmed localhost3120 no longer listens. Restored only the Next-generated tsconfig changes to the pristine pre-QA gitHEAD version; no feature configuration change. Original dirty checkout untouched. Reproducible QA scripts/evidence and the synthetic local database remain.
