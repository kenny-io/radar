# State

Branch `kenny/homepage-faq-refresh`, base `29c3fe36`.

| Task | Owner | Scope | Status |
|---|---|---|---|
| A1 | factory-architect | Product-truth audit: autopilot/social/replies | verified |
| P1 | PM | FAQ evidence, copy contract, integration and release | active |
| E1 | factory-engineer | Copy-only Home.tsx/HomeStory.tsx updates | verified |
| Q1 | factory-qa | Independent claim/source and browser verification | verified |

Implemented14FAQs and corrected adjacent conflicting claims. F1–F7 independent QA passed, including5 browsergroups at1440/360, all14keyboard-accessibleaccordions, demo tabs, nooverflow/errors, and sourceclaim review. Final typecheck/diffcheck passed; exact source fingerprints match implementation-fingerprint.json. Current preview http://localhost:3901/#faq. The owner has now authorized shipping: scoped commit/PR/merge and Railway deployment are in progress. Preserve unrelated release records/configuration.

Baseline `npm run typecheck` passed on latest main before copy edits. Source audit also confirmed optional backlink auto-approval and GitHub merge-to-publish behavior.
