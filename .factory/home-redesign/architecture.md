# Approved implementation contract

Architect reviewed HEAD `5db796b5` and the supplied October 31 handoff. Implement in place with disjoint ownership; do not switch the active billing branch or change unrelated work.

Engineer owns Home.tsx, new HomeStory.tsx and home-redesign.css, and the home-nav branch of MkRoot.tsx only. Scope every new style under `.mk.home`, namespace keyframes, preserve shared demos and feature-page styles. Reuse bundled assets, Geist fonts, brand marks, hero/forms/closing/footer. Keep true React lifecycle cleanup rather than running prototype DOM mutation scripts.

Native passive scroll and a shared rAF update statement and feature story. Pin only >=1001px width and >=640px height. Small sizes stack every slide and remove inertness. Inactive pinned slides are inert. Index uses aria-current and native smooth scroll seeking (instant reduced-motion).

Three-step player owns accessible tabs, panel links, roving keyboard controls, 9/7/6-second timelines and pause at intersectionRatio<.35. Manual interaction ends autoplay permanently. Reduced motion finishes demos without autoplay, removes pan, lights all words and uses immediate transitions. Listen to preference changes and clean up timers/observers.

Deliberate product-truth exceptions to reference: sample testimonials stay omitted; GitHub label/logo stays (the prototype calls this connector Next.js); the $1 trial payment is credited to month one per the ongoing approved billing architecture rather than the prototype refund claim. New comparison copy is implemented for review, without inferring deployment authorization from handoff notes.
