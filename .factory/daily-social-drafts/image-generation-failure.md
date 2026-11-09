# Image generation failure

November 9, 2026. Owner reported the deployed Generate image action failed after prompt prefill.

## Confirmed cause
Production web on d8ac2d3a, development stubs off. The user's request at 17:13:50 UTC failed through all configured routes: OpenRouter HTTP402/no credits; OpenAI HTTP429/insufficient_quota/no credits; xAI HTTP403/credits exhausted or spending limit. Credentials were inspected only for presence; no secrets copied. Private diagnostic logs remain ignored under the original checkout's .data/image-failure with restrictive permissions.

Existing OpenRouter image endpoint/model/response contract is valid per official documentation; no API migration is required. Explicit Generate requests intentionally require a real model and retain the previous image on failure. Template substitution would not satisfy the requested image.

## Scope and criteria
- AC1: Preserve existing images and never report a template as a successfully generated custom image.
- AC2: Classify all configured routes blocked by account errors/cooldowns as safe 503 image_unavailable with support-directed copy. Preserve transient/mixed failure retry behavior and successful fallback.
- AC3: Add meaningful provider-state regression checks and independently verify the affected UI/error/retention behavior with local fixtures.
- AC4: After the owner restores a provider, verify a real generated image and storage/readback. Do not claim generation is restored before this succeeds.

Owner was asked which provider they will fund. No payment, balance top-up, spend-limit change, credential replacement or customer publication is authorized/performed by this repair. Existing production deployment authorization covers a reviewed code fix; restoring funding is an external dependency.

Owners: architect resolves contract; backend engineer owns images.ts and regression tests; PM owns live diagnosis/release; independent QA validates repaired behavior. See image-generation-architecture.md.

## Code repair verification
Backend focused suite 60/60 and independent focused suite 68/68 passed. Independent real-browser reproduction through three dummy configured providers returned the recorded account errors, safe503 copy and unchanged existing image/prompt; three browser scenarios passed, including a second cooldown request with no additional provider fetches. Typecheck, production build and diff checks passed. See image-generation-backend.md and image-generation-qa.md. No billable provider requests were made by these checks.

Owner replied “I’ll add OpenRouter credits.” This is an intention, not confirmation that funds are available. Real render acceptance remains pending. The credits overview endpoint may require a management key; per-key limits do not prove account funds.

Release integration: main advanced with independent Reddit reply changes (PR32,0f4cf40e). Merged that current production base without conflicts; image fix source remained unchanged. Integrated typecheck, all60 focused tests and production build passed again. Credit overview read-only check returned200 and no positive account balance; this is actual funding evidence, not a per-key allowance inference. No inference/generation request was made.

PR33 https://github.com/kenny-io/radar/pull/33 merged as d66a456f6e5e427fef82ee81a73d7c3aa0b6401b. Railway web `d48395aa-dd43-4d82-8e31-b315a6059c49` and worker `10826f5e-01eb-44ed-a12a-3e4d382f1ed6` both SUCCESS on the merge SHA. This deploy changes failure classification only; actual image-generation recovery remains dependent on funding and a successful real render.

## Final disposition
Error-handling repair deployed and verified: actual web source hash matches the tested images.ts, production/stubs off confirmed, live health returned200/ok. Independent68-test/three-browser acceptance and integrated60-test/typecheck/build evidence remain valid; no source changed after those checks.

Real image recovery is **blocked by funding**, not complete. After deployment, a guarded production verification read the actual account credit totals and found no positive OpenRouter balance. It returned `renderAttempted:false` / `funding_not_restored`, without calling an image provider or storing an image. Owner intends to add credits but has not confirmed completion.

Resume with the ignored local helper `.data/image-failure/verify-render.py` from this release worktree after funding is restored. It checks actual account funds, generates at most one real1200×675 verification image through the deployed application image/storage functions only when funds are positive, verifies stored raster readback and removes only its own random-prefix verification object. It changes no customer data. A successful result is required before calling AC4 or image generation restored. Existing account cooldowns can last up to10minutes after funding; if actual funded generation succeeds but the serving process remains cooled down, use an authorized service restart or natural expiry rather than bypassing cooldown on every retry.
