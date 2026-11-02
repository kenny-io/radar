# QA findings

## M5 / P2 — duplicate padding before Blog Latest card

Tested production build `h5XRdRNHRKZeCQsyU_cym`, source fingerprint `a096b9c552a11efbfd2c2c9243b9cf253ce9bb6801bf9be74997ba6a8b4e66c9`, anonymous Chrome1440×1000 with reduced motion.

Reproduction: open /blog at settled scrollY0. The supplied reference starts Latest card at approximately526px; implementation starts at666.47px because the Latest section adds pg-sec's140px top padding after bl-hero already supplies its bottom gap. Much of the Latest card falls below the fold. Expected: card follows the hero's existing gap, matching supplied layout. Source: BlogPages.tsx used pg-sec bl-posts where the prototype section has no pg-sec. Reported to PM; E2 removed only that class. Fresh-build visual retest pending.

Evidence: reference/blog-index.jpg, local-blog.jpg, visual-before-gap-fix/1440-blog.jpg and visual-before-gap-fix/facts.json. A browser geometry regression now checks that Latest top directly follows the hero box, rather than asserting an implementation class.

Closed on build `gE6b-fiXSFBU6x88F8k-m` / source `29c3f7970a8a26c632f2c723232cb223580421c0ece75d003f58c8d8ec9a8f26`: independent final desktop card top526.47 matches the reference526.47. The reference hero bottom514.47 leaves an intentional12px gap; an initial geometric test wrongly assumed zero gap, then was corrected to use the measured reference rather than relax the actual design requirement. That assumption is preserved in local-flows-geometry-assumption.json. Final desktop/mobile visual captures use fresh contexts and settled scrollY0; Latest card no longer has the extra140px desktop/88px mobile section padding.

## Reference-only quirk

The temporary supplied prototype overlay leaves Features visible at390px because appended .dd display:flex overrides the original .hide-sm rule. Written handoff requires it hidden below900px. Implementation correctly overrides that policy; the source prototype quirk is not an application defect.

## Harness corrections, no source relaxation

First flow run had timing/setup mistakes: focus is intentionally applied on requestAnimationFrame, focus-within styling requires a rendering update, and programmatic focus does not activate a manually selected tab. Harness now waits for the specified focus/style state and activates the first tab before testing left-arrow wrap. The subsequent dependent hidden-button timeout was caused by the first failed flow leaving Posted state active. Initial evidence retained in local-flows-initial-harness.json. Corrected run passed11/11 on unchanged source, including clipboard rejection/stale completion and real local download. Native OS clipboard is deliberately not modified; controlled browser promises verify async/error behavior explicitly.

Sequential viewport-matrix screenshots occasionally captured a transient scroll state. Fresh-context visual captures independently recorded scrollY0/nav top0/height64/visible on all12 desktop/mobile screenshots; there is no missing-nav source defect. Final visual evidence will use that settled capture method.
