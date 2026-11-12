# Contextual article images

## Problem
Owner report, 2026-11-12 (article "Wasl 611 Reviews: Tenant Ratings and What to Check First", business lived.ae): the cover and the body images are abstract circles that say nothing about the post. The owner wants images that show the topic of the post, and at the very least a picture of the property the post is about.

## What was found
1. Production fell back to the brand template for every image. Worker logs for 2026-11-11 and 2026-11-12 show all three image routes refused on account credit: OpenRouter `402 Insufficient credits`, OpenAI `429 You have no credits remaining`, xAI `403 used all available credits or reached its monthly spending limit`. `renderImageFile` then draws the template and reports the result as a normal image. Nothing in the article tells the owner a placeholder was used.
2. Even when a model answers, the direction is generic. The cover prompt is `Calm, editorial image about <keyword>`, set when the calendar entry is created, before the article exists. Body images ask for "a concrete visual metaphor", which steers away from showing the real subject.
3. Nothing identifies the real-world subject of a post (a building, a product, a place), so no image is ever asked to depict it.

## Scope
- Image directions come from the written article: one AI step reads the finished draft and returns what the cover and each body image should literally show.
- When the post is about a specific real-world subject, the cover depicts that subject (for a building: its exterior in its real setting), described from the facts the article and its sources state.
- When a real picture of the subject can be found on the business's own site, use it to ground the image (design to be settled by the architect).
- Abstract template shapes never go into an article body. A cover that had to fall back is marked as a placeholder, and the article shows that and offers a retry.
- Existing drafted articles get the same contextual directions when the owner regenerates the cover or the body images.

## Exclusions
- Social pack images and Daily Brief visuals.
- Adding credit to provider accounts (owner action; nothing here produces real images in production until at least one image route has credit).
- New image providers, new dependencies, SQL schema migrations.
- Changing a direction the owner typed themselves.

## Acceptance criteria
- AC1: After a new draft or "Rewrite from brief", the cover direction saved on the article names what the article is about in concrete visual terms taken from the article (subject, setting, notable physical details). It is not the keyword in a fixed sentence.
- AC2: When the article is about one specific real-world subject (for example a named building), the cover direction asks for a depiction of that subject, and the alt text names it. The direction contains no detail that the article or its sources do not state.
- AC3: Each body image direction describes a scene specific to its section and to the article's subject, different from the cover and from the other body images. Alt text describes what is shown.
- AC4: If the image-direction step fails or returns nothing usable, drafting still completes, using directions built from the title, section heading and section text.
- AC5: A direction the owner typed (custom prompt) is used as written for the cover, and still guides the body images.
- AC6: When no image model can produce a body image, no template image is inserted in the article body. The draft still completes; the Media panel says the images could not be generated and offers a retry. Published output contains no template body images.
- AC7: When the cover falls back to the brand template, the article records that it is a placeholder, and the Media panel says so in plain words with the regenerate action next to it. A later successful generation clears the mark.
- AC8: "Regenerate" on the cover (without a typed prompt) and "Regenerate body images" on an existing drafted article use contextual directions derived from the current article text, including articles drafted before this change.
- AC9: Articles saved before this change open, edit, and publish exactly as before. No migration is required.
- AC10: Tenant and role restrictions, publication locks, AI call recording and failure reporting keep working for the new step. Fetching any page or image from the open web is protected against internal-address requests and oversized responses.
- AC11: Focused tests cover direction generation, the fallback, the placeholder mark, body-image omission, regeneration on legacy articles, and publishing. Typecheck and the full suite pass apart from documented baseline failures. Affected UI is checked in a real browser.

## Constraints
- One extra text call per draft at most, on the cheap model tier, recorded in `ai_calls`.
- Dev stubs (`RADAR_DEV_STUBS`) must keep working offline.
- No text, logos or invented statistics in generated images (existing rule).

## Delivery
Owner asked to ship. Branch `kenny-dev/radar-contextual-images-6eb35c` from origin/main `4f1bcf83`; PR to `main`; merge after verification (main auto-deploys web, worker and model-proxy on Railway). Confirm on production afterwards. Real images in production also need provider credit, which is the owner's action.

## Decisions after the design (2026-11-12, PM)
Design: `architecture.md`. Accepted as written, with these consequences for the criteria above.

- D1. Real-subject pictures: description only in this change (architecture §3). The cover is an illustration of the subject as the article describes it, named in the direction and the alt text. It is not a picture of the real building. Grounding with a real picture from the business's site is a follow-up that needs the owner's answer on who owns the photos on lived.ae property pages. Scope item 3 moves to that follow-up.
- D2. AC2's "no detail the article does not state" is enforced by instruction, the number check and the subject-name check. It is best effort.
- D3. AC6 applies to images generated from now on. Template body images stored during the outage stay until regenerated.
- D4. AC7 applies to covers rendered from now on. Older silent fallbacks carry no mark until redrafted, restyled or regenerated.
- D5. AC8 applies to model styles. Template styles (Branded graphic, Infographic) are drawn from the title.
- D6. AC10's fetch sentence is void: no open-web fetch is added.
- D7. Cover Regenerate on a model style is strict: on failure the old cover is kept and an error is shown, never a template with a success message.
- D8. `article.imageDirections` joins the utility tier (supersedes UT-1 of the cost brief).
- D9. Any body-image failure inside a draft, storage included, leaves the set out and the draft completes.
- D10. Dev-stub drafts have no body images (no image model in stubs).
- D11. Not in this change: the OpenAI image default `gpt-image-1`, which OpenAI's documentation says was shut down on 2026-10-23. Reported to the owner; OpenRouter is the first route and is unaffected.
