# Image generation failure: A3 architecture diagnosis

Workspace confirmed: `/Users/ekene/.codex/worktrees/daily-social-release/radar-push`, branch `kenny/social-image-prompt`, HEAD `26c47f76`. Production prompt-prefill deployment is `d8ac2d3a` / PR31 per PM. This is a bounded read-only architecture pass; no provider generation requests, account/funding/configuration changes or source edits were made. Other agents' work is preserved.

## Incident evidence and conclusion

PM's sanitized production evidence for the user's request at 17:13:50 UTC on November 9, 2026 (21:13:50 Dubai): all three image-provider keys are configured, with default models. OpenRouter returned HTTP402, insufficient credits, `limit_source=openrouter_credits`; OpenAI returned HTTP429 with `type=insufficient_quota` and no credits remaining; xAI returned HTTP403, all credits used/monthly spending limit reached.

Confirmed: all three configured image-provider routes are blocked by account credits/spending limits. An API migration or a client prompt change cannot restore those accounts. OpenAI's exact body distinguishes account exhaustion from an ordinary rate-limit429. Restoring one eligible route is sufficient. No additional paid probes are needed to diagnose the recorded request.

The newly prefilled prompt causes the existing explicit custom-image action to be used more readily. `renderPostImage` sets `modelRequired=true` whenever `imagePrompt` is present. That deliberately surfaces model failures instead of silently substituting a brand template. Previously displayed branded images could be local templates; they never proved that a paid image route was working. Keep this strict behavior.

## Current primary API documentation

The existing OpenRouter implementation uses a supported contract: `POST /api/v1/images`, a model/prompt plus aspect ratio and one output, and `data[].b64_json`/`media_type` decoding. The current dedicated Image API guide documents that request/response; its model catalog supplies endpoint capabilities. Do not switch every image request to chat completions on the assumption that `/images` is invalid. [OpenRouter Image Generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [image model discovery](https://openrouter.ai/docs/api/api-reference/images/list-image-models).

The configured default `google/gemini-nano-banana-2.1` also has a current official model page. Existence of a model does not establish account access, quota or funds. [Official Nano Banana2.1 model page](https://openrouter.ai/google/gemini-nano-banana-2.1).

No public catalog or generation API call was made in this pass; documentation browsing only. A chat-compatible override absent from the dedicated Image API would require a separately selected contract, but the recorded402 does not indicate that condition.

## Smallest useful software change

1. Preserve provider order, existing headers/models, explicit-prompt model requirement, original-image protection and template behavior for ordinary branded visuals. No migration, new secret, dependency, infrastructure, endpoint or model selection is justified by this incident.
2. When every configured image route is account-unavailable or already in its account cooldown, return a safe `RadarError` with HTTP503 and existing code `image_unavailable`. PM-approved copy: `Image generation is temporarily unavailable. Your previous image is kept. Please contact support.` This avoids instructing immediate retries against known exhausted accounts and avoids exposing named providers, account balances or credentials in the product UI. Keep transient/request errors on the existing retryable `image_failed` path.
3. Keep account cooldowns. OpenRouter's shared text/image cooldown and direct image cooldowns may continue for up to10minutes after funding is restored; natural expiry is sufficient. Do not bypass cooldown on each customer retry. A PM-authorized deployment/restart also resets process memory, but is not intrinsically required to add funds.
4. `changeImage` already preserves `RadarError` and image fields when rendering fails. `PackView` already displays the server message for `image_unavailable`. Reuse these paths; no UI redesign is required. The attempted prompt may remain saved by the reservation step, which is desirable for retry, while image URL/seed/style/metadata stay unchanged until a successful render is persisted.
5. Classify account exhaustion from existing helpers/status+body. OpenRouter moderation403 must not poison the shared account cooldown. For direct providers, distinguish quota/billing429 from ordinary rate429. Avoid widening unrelated text-provider routing in this fix.

### Exact all-routes-unavailable contract

Build descriptors for every configured image route before filtering. A route with an active account cooldown yields outcome `account` without a fetch. OpenRouter's shared `openrouterDown()` is an account outcome; a breaker skip with alternatives is `other` (transient), not account exhaustion. Each attempted route yields `account` only for `e.account`, otherwise `other`; a valid success returns immediately through existing rendering. After no route succeeds, throw503 only when the configured list is nonempty and every configured route yielded `account`. All other cases retain the existing last/generic error. Never infer all-route exhaustion from the last caught error alone: a transient first-provider failure followed by an exhausted last provider is a mixed failure and must stay retryable. Keep existing cooldown writes and provider ordering. This design requires no additional provider calls or shared text-adapter refactor.

Root-cause recovery remains operational: the account owner must restore credits/increase the spending limit or select an already-funded eligible route. The application must not add credits, raise financial limits or replace credentials without the user's consequential financial authorization. PM owns that conversation and any authorized follow-up; architect performs no account operation.

## Focused tests

- All three mocked routes return account exhaustion: clear503 `image_unavailable`, no upload or replacement, no fake success/template generated for an explicit prompt.
- Repeated request during all-account cooldown fails promptly without new outbound requests; advancing beyond the cooldown and returning a real PNG succeeds and crops to platform dimensions.
- OpenRouter402 followed by valid direct-provider output still succeeds; a single provider account failure does not suppress viable alternatives.
- Ordinary transient429/500/timeout stays retryable rather than being mislabeled account exhaustion; moderation403 does not disable the OpenRouter account for all text/image calls.
- Action-level failure retains existing image URL/seed/style/image metadata and edited prompt; browser shows actionable unavailable copy and lets the user keep/edit/retry their prompt.
- Existing no-key `image_unavailable`, background-template fallback, custom-image strictness and concurrent image-request guards remain compatible. Run provider tests, custom-image DB tests, typecheck and a production build on the exact release tree. No real provider calls are necessary for these tests.

## Separate pre-existing hardening opportunity

`generatePhoto` currently accepts provider bytes and breaks its fallback loop before `loadImage` decodes them. A nominal200 containing corrupt/unsupported raster bytes therefore fails outside provider fallback. Moving decode/crop validation into the per-provider try would fix that case, with a test for corrupt first-provider bytes and valid second-provider output. This is not supported as the cause of the recorded funding failures; keep it out of the minimal incident fix unless PM explicitly includes it. Similarly, direct OpenAI/xAI fetches lack the OpenRouter route's bounded abort timeout; improving that is separate from credit restoration.

No architectural blocker prevents the small error-handling improvement. Real image generation remains unverified/unavailable until a provider route is restored; mocked success must not be reported as live recovery.
