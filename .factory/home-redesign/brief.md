# Radar homepage redesign

Request: update the homepage from the supplied 2026-10-31 home redesign handoff. Design source: `/Users/ekene/Downloads/design_handoff_radar 2/updates/2026-10-31-home-redesign/` (HTML copy deck, v2/v3 CSS and v3 interaction script). Adapt the reference to the existing React app; prototype file-copy directions are reference packaging, not repository commands.

Scope: public `/` homepage and its home-only styles and interactions. Preserve hero/network field, platforms, closing/footer, domain submission behavior, signed-in redirect, feature pages, and all unrelated billing work. Existing sample testimonials stay omitted per the prior product decision. Reuse bundled screenshots and brand marks; retain illustrative captions. No backend, new dependencies, billing behavior, publishing, merge or deployment. Follow-up fixes cover URL autofill styling and auth-logo navigation to the homepage.

## Acceptance

- H1: Order is hero, platforms, problem, statement, How it works, six-feature story, integrations, comparison, pricing, FAQ, closing/footer. Copy follows supplied HTML, with existing documented product-truth exceptions.
- H2: Home nav includes How it works, Features, Pricing, Questions, Sign in, Get started; four section links hide below 900px. Real signin/signup/domain-analysis routes work.
- H3: Problem panel, rhythm/type, integrations, four-column responsive comparison, single split pricing card and sticky FAQ match supplied direction. No horizontal scrolling at 360–1920px.
- H4: Statement words brighten progressively and reverse with native scrolling; accessible full sentence remains available.
- H5: How it works has three accessible tabs, arrow/Home/End keyboard navigation, active-only descriptions, timed demos (9/7/6 seconds), viewport start/pause at 35%, looping, and permanent autoplay stop on manual selection.
- H6: Feature story pins only at width >=1001px AND height >=640px; native scroll selects all six and updates index/pan. Buttons seek to each slide; inactive desktop slides are inert. At smaller sizes all six stack and the index is absent.
- H7: Reduced motion displays final demo states, no autoplay/pan, full statement, and instant transitions; effects/listeners clean up.
- H8: Hero/forms/footer and all three feature pages retain existing behavior and appearance; no third-party asset requests, missing images, console errors or hydration errors introduced.

## Delivery

Implement in existing checkout, preserving disjoint uncommitted Stripe billing work. Starting HEAD `5db796b5`, branch `kenny/stripe-billing`. Home-only file ownership avoids unrelated changes. User subsequently authorized committing the homepage updates and opening a PR. Final PR branch is `kenny/homepage-redesign`, based on `origin/main` at `2524537d`; unrelated Stripe billing commits are excluded. No merge or deployment authorized.

## Owner copy update before PR

Swap the homepage hero and closing-card headlines. Hero: "You built it. Let people and AI find it." Closing: "Be found by the people looking for you." Keep the orange period in the hero and retain the feature pages' existing closing headline via an optional shared Closing headline prop. This supersedes the handoff's instruction to preserve those two homepage headlines.
