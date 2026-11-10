# Email preference footer correction

Scope: one visible Email preferences link per email, rendered as underlined text. Remove separate lessons/guides, work-reminder and founder setup opt-out links from both HTML and plain text. Apply text styling to shared lifecycle, invitation and weekly AI report HTML. Existing signed destinations, preference behavior, one-click unsubscribe headers and delivery/retry identities are unchanged.

Verification on the PR source:
- Baseline: 32 affected template/content tests passed before edits.
- Final: same 32 tests passed; existing expectations updated for the requested single-link behavior.
- Typecheck passed.
- Regenerated both complete catalogues and the seven-message nurture alias gallery.
- Audited all 72 variants: exactly one preferences entry in each text part; all 62 HTML variants have exactly one underlined text preference link without padding, borders or button styling. Ten variants are plain text only. No removed opt-out labels remain in the generated email bodies.
- Real installed Chrome through Playwright: lifecycle lesson, invitation and AI report at 375px and 1000px; six checks passed for exactly one inline underlined link with zero padding/border and no duplicate lessons/guides link.
- git diff --check passed.

No customer email or preferences were changed during verification. Already attempted messages retain their immutable provider retry body. Unattempted lessons/guides/reports/work updates render current templates before delivery.
