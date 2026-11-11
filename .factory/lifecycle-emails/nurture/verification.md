# Pre-trial draft verification

Seven original editorial drafts were reviewed against the supplied competitor screenshots, the owner's pre-trial audience clarification, actual Radar feature/action code and the already-approved founder story. Independent critic returned PASS after fixing the backlink-direction wording, Daily Brief subject and AI preheader; weakest theme remains the optional-interest backlinks email. See review.md.

`node --import tsx scripts/preview-nurture-emails.mjs` generated seven HTML/plain-text drafts and an offline-capable review gallery. `node .factory/lifecycle-emails/nurture/render.mjs` passed14/14 local Chrome viewport checks (390/600px), plus a seven-card served-gallery inventory check. Checks cover no overflow, one heading/primary action, actual224px logo displayed at28px, the intended fixed CTA, actual $1/3-day/$49/$50 trial terms where applicable, and absence of competitor names, invented35%gain, free-trial or high-DR claims. PNGs and results are in qa/. The AI visibility desktop email was visually inspected.

The initial gallery check found the prior local preview server had stopped; it was restarted on127.0.0.1:3934 and the complete check rerun passed. This was a preview-server availability issue, not an email-layout defect. Rendering uses local HTML and fulfills the logo URL from the deployable local file; no live-site/inbox claim.

No runtime source, schema, queue, consent or sending behavior changed. Recomputed src/**,drizzle/**,next.config.ts fingerprint remains036e3bd7c87d8cde09acaf00694df4418fa5fdd13501f6049614d741fa87f784, matching the prior tested implementation. Existing tests/build are not relabeled as new marketing-sequence verification. No new tests were added to mirror editorial copy; checks are local visual/artifact inspection only. Diff check passed.

The drafts are neither scheduled nor sent. Proposed timing and future eligibility/consent constraints are in README.md; the activation and founder versions must map to existing messages rather than create duplicates. Original source copy for those core messages remains untouched. This work does not merge/deploy PR25.
