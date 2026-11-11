# Engagement QA defects

## EN6-D1 — Signed-out reminder target lost after password signin

Severity: P1, release-blocking for the new reminder link flow. Observed against base a96ebd9d plus current uncommitted engagement UI/backend work; local Next dev3935 and isolated radar_engagement_qa_20261104 database.

Reproduction: open an article_social email link in a signed-out browser, verify signin includes the same-site /email/open target, sign in with a real local password user who owns the addressed business. Expected: return through /email/open, select that business and open Social Marketing with the addressed article preselected. Actual: signin redirects to /dashboard. The signed-in version of the same link succeeds.

Cause: src/server/billing/guard.ts `entryAfterAuth` permits APP_PATH destinations, but APP_PATH excludes the new /email/open route. This strips the validated target after successful authentication. Fix should permit only the expected landing route while preserving same-site/route restrictions; do not allow arbitrary return URLs.

Initial observed evidence:18 preceding checks passed, then browser navigation to /dashboard and an expected-dialog timeout. This was reported to the PM and UI owner during the run. The current browser-results.json and logs contain the successful final retests; they supersede the original failed-run files. QA harness browser.ts retains the reproducing flow. Sent to PM and UI owner. Fixed with a narrow validated /email/open return-path allowance and password/Google regression checks. Closed after independent complete browser retests:21/21 in dev and22/22 in configured optimized production, including signed-out signin roundtrip. Current frozen fingerprint is recorded in source-fingerprint.json. No runtime edits by QA.
