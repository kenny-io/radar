# Independent email copy review

Reviewed the revised ten emails against Radar's current homepage wording in `Home.tsx` and `HomeStory.tsx`, using the copy-editing skill. This pass covers copy and local HTML previews only; it does not replace the earlier workflow/security QA.

The revised copy is ready for owner review. It uses the product's concrete language—website, Business Profile, articles and conversations—rather than generic onboarding advice. The founder note gives one useful piece of advice and invites a reply without inventing a founder story or promising personal response times. Receipts now say what was paid; reset mail keeps only the useful expiry, device sign-in and unsolicited-request details. There are no ranking guarantees or promotional claims.

Two review suggestions were addressed by the PM: failed-payment mail now explains that access may be paused; cancellation mail states the access end date and renewal outcome without adding a generic arrears warning. Billing emails retain the actual UTC end date, $1 credit, usual $49 first month and $50/month afterward, tax/adjustment caveat, automatic continuation and cancel-before-trial-end instruction. Receipt amounts still come from event data. Welcome now links to `/dashboard`, whose existing guard routes unfinished accounts into setup and finished accounts into their workspace.

All ten HTML previews passed at390px and600px (**20/20**): no horizontal overflow, one H1, English language and app-hosted/mailto links. Inspected welcome, founder and trial screenshots visually. No remaining wording correction is required by this pass; the owner can assess the tone directly from the new side-by-side artifact.

Evidence is in `qa/copy-refinement/`: `results.json`; mobile and desktop screenshots for welcome, founder, trial and receipt; and `welcome-founder-desktop.png`. The reproducible renderer uses installed Google Chrome with local `setContent`, no server, account session or provider. No sends, merge, deployment or product source edits by QA.

Current source fingerprint: **`8da069a6563db18e50d9c9c5b7a1f2fcdfcbe1f5ef42646b80379b972cb50f04`**,476 files; scope/algorithm retained in `qa/copy-refinement/source-fingerprint.json`. Earlier full-flow results remain attached to prior fingerprint `3beebabab50b13b7629a49df808231ee6e52cc6b8232f55220817e3c432b2d50`. No broad backend or recovery suite was repeated for this copy-only change.
