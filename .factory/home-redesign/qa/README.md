# Homepage browser verification

The verification summary and exact tested source hashes live in `../verification.md` and `../implementation-fingerprint.json`. Generated screenshots, logs and JSON results remain local and ignored.

Run the Next app on port 3900 for the original acceptance/regression harnesses. The final `q2-followups.mjs` and `q2-copy-visual.mjs` target the current review preview on port 3901. Scripts use the locally installed Google Chrome executable and Playwright. `baseline.mjs` captures the pre-change feature-page geometry before running `regression.mjs`; generated PNGs and result JSON files are described in the verification record.

Final coverage includes the six-feature scroll story, reduced motion, keyboard tab behavior, viewport pause, responsive layouts, form navigation, autofill, auth-logo navigation, and the owner-requested hero/closing copy swap. The earlier `production-smoke.mjs` covers the production build at the time recorded in the verification summary.
