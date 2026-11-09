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

## Recovery confirmed during Add visuals rollout
The previous funding-blocked disposition is resolved. On deployed revision `1473f55971273a85df22165dee011b943de0311d`, the guarded account overview observed positive funds and allowed one real model-required render. Generation, exact1200×675 raster decoding and storage/readback succeeded (782680bytes). Its temporary verification object was removed, and no customer data changed. No account-cooldown events appeared in either current web or worker deployment. AC4 is verified; the image-generation incident is resolved. Funding was restored externally; this agent performed no billing/top-up/limit mutations.
