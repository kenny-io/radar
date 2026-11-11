# Suggestion prompts and custom image direction

## Problem and delivery
Radar explains website improvements but offers no ready-to-paste implementation prompt. Its image controls mainly regenerate styles instead of letting a user request a specific subject, such as Sobha Sapphire. Extend the established product UI using the two supplied screenshots as references. Work in the clean existing checkout, feature branch `kenny/suggestion-prompts-custom-images`, base `9d6c4016` (origin/main `4e1cd23f` differs only by merge history).

Deliver a reviewable implementation, focused regression coverage, independent browser QA, and a draft PR if GitHub access is available. No authorization to merge or deploy; main deploys production.

## Scope and resolved experience
- Performance suggested changes: visible Copy prompt actions for individual SEO title, description, and content changes, plus one prompt covering the whole recommendation. Prompts carry business/site/page context, current/proposed values when available, rationale, implementable directions, and verification expectations. Copy remains a local read-only action, available to Viewers.
- Social library post image controls: a labeled custom direction textarea and explicit generation button for the current platform. Keep style choice and existing regenerate action, retain directions across reload, and preserve other platforms and post text.
- Daily Brief post visuals and article media: offer the same custom direction capability in the established image workflows, including retry and persisted direction. Article coverage includes the cover; architect will resolve proportionate body-image direction support.
- Use existing image providers and object storage. Explicit custom generation must invoke a model even if the prior style was a static template. If providers are unavailable or fail, show a useful error; retain the previous complete image instead of silently returning a template as a completed custom request.
- Named buildings can be requested as generated subjects. Do not claim an invented image is a verified photograph. Reference-photo upload or web image retrieval is excluded unless architecture establishes an existing supported path.
- Use existing font, controls, spacing and colors, accessible labels, sensible narrow-screen layouts, disabled/loading/success/error states, and keyboard access.

## Acceptance criteria
- SP1: Every displayed website suggested change has an easy Copy prompt action; the entire suggestion can also be copied. The exact copied text includes the relevant target and recommendation and can be pasted directly into a coding agent.
- SP2: Copy success is announced only after clipboard success; failure has recovery feedback. Copy does not mutate, accept, dismiss, publish or enqueue the suggestion.
- IM1: Social pack users can request an image subject with their own prompt. It reaches the image provider, renders to platform dimensions and replaces only the selected post image after success. The prompt and image persist on reload; text and other platforms remain unchanged.
- IM2: Daily Brief visual creation and article media support user image direction in their existing flows and preserve it for retries/regeneration. Existing default generation and legacy saved content stay usable.
- IM3: Blank/overlong input is validated; generation exposes loading and retryable errors. Custom requests cannot silently fall back to style templates; failures retain existing complete media.
- IM4: Tenant and role checks, scheduled/publishing locks, job ownership/concurrent-change protections, and existing image metadata/storage conventions remain effective.
- UX1: Controls are discoverable within the existing relevant surfaces, keyboard accessible, and usable on desktop and 390px mobile without new overflow.
- QA1: Meaningful tests cover prompt content, action input/persistence/locks, provider routing/failure behavior, plus full typecheck/build and independent real-browser core-flow checks. Distinguish stubbed/local evidence from live provider verification.

## Constraints and baseline
No new dependencies or schema migration unless demonstrated necessary. No production data changes. No redesign or unrelated fixes. Existing image provider credentials stay server-side. Initial full suite:585 passed,161 skipped,1 known pre-existing raster hash snapshot mismatch in `src/server/ai/openrouter.qa.test.ts` (`f883614e6a7dfb07` vs local `91d5409f50974af7`); do not change that unrelated golden.
