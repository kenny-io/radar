# Verification

Completed November 27, 2026 (Dubai). Production diagnosis from the previous turn established invalid Google refresh authorization and retained historical rows through November 16, 2026. New-feature verification below used isolated synthetic data only.

Acceptance GSC-AC1–5 verified locally. No live Google consent or production mutation in QA.

Baseline: factory-engineer ran `npm run typecheck` successfully before feature edits. Factory-QA prepared isolated local `radar_gsc_reconnection_qa` with synthetic users/businesses and a stub-only Next web server at `http://localhost:3846`; no live Google or production writes.

Implementation milestone:
- Focused developer checks: `npx vitest run src/lib/gsc.test.ts src/server/actions/gsc.reconnect.test.ts src/client/api.oauth.test.ts` — 35/35 authorization-classification, reconnect server-action and OAuth popup regressions passed; independently repeated by QA with the same result.
- Architect independently reviewed classification, exact-property recovery, history/cursor preservation, Editor enforcement, popup source binding and business-switch protections. Approved with no actionable defects.
- PM ran `/Users/ekene/.agents/skills/impeccable/scripts/impeccable detect --json` on the six affected UI/CSS files; returned `[]` (no mechanical design findings).
- Independent Chromium browser and actual isolated-DB HTTP verification: 18/18 groups passed. Includes original property/date/history/cursor preservation, incremental/backfill queue selection, cancelled/blocked/denied popup, missing property, server failure/retry, roles, source identity, cross-page/reload persistence and business-switch races.
- Desktop 1440px and emulated phone 390/320px verified; no overflow, keyboard focus, light/dark contrast 5.19/7.15. PM inspected clean banner and mobile screenshots. No product defects found.
- Final `npm run typecheck` passed after removing the Next-generated QA include from tsconfig; scoped `git diff --check` passed. All nine source hashes in `qa/browser-results.json` still match the deliverable.

Evidence: [QA report](qa/report.md), [machine results and source hashes](qa/browser-results.json), [banner preview](qa/banner.png), desktop/mobile and keyboard screenshots adjacent. Local server stopped. Synthetic sessions/logs ignored. Unrelated pre-existing work preserved.

Limits: local stub Google success and locally intercepted failures; no live Google/production, Safari, physical phone or assistive-technology verification. No worker ran in QA: correct queueing was verified, not a completed Google import. No merge or deployment performed.

## Authorized production release validation

User approved shipping after reviewing the banner. Transplanted only feature hunks into isolated release branch `kenny/gsc-reconnection-banner` on current production base `ba78a2cfd413428ec1ef3e69708e299dc3aecdea`.

Current main already provides nonce/source-bound, COOP-safe OAuth and centralized revision/pending-edit handling. These files were preserved unchanged; recovery now uses its existing OAuth API, explicit Cancel sign-in/AbortController cleanup, safe OAuth error copy and immediately guarded `app.act`. Existing shell billing/activity features preserved. Architect's final current-main review approved without actionable findings.

- Node 22.18.0 baseline TypeScript and 17 existing OAuth tests passed.
- Integrated and independently repeated feature + current OAuth tests: 48/48 in six files passed.
- Isolated safe-environment `npm run build` under Node 22 passed: compilation, type checking, all 41 static pages, routes/traces complete. Output `.next-gsc-release-build` is ignored.
- Real Chromium release QA: 18/18 required groups passed on synthetic accounts in distinct isolated `radar_gsc_reconnection_release_qa`. Existing main consent nonce/callback, actual local stub success, explicit cancellation/immediate retry, shared pending controls, wrong source, exact-property/history/cursor preservation, roles, failures and business-switch safety all checked. Desktop and 320/390px phone widths passed.
- PM reran mechanical UI detector: `[]`; scoped diff whitespace check passed. Generated QA/build tsconfig includes restored to production baseline after both processes stopped. Final TypeScript rerun recorded before commit.
- Product source hashes in `qa/browser-results.json` identify this release build; original-working-tree hashes above describe the earlier reviewed concept only.

Additional COOP-severing synthetic browser fixture could not navigate to its test origin before reaching the callback after a bounded correction; it remains unverified, with no product failure demonstrated. Actual nonce-bound local callback passed and the production OAuth transport is unchanged. No claim of live Google consent, real Google data import, Safari/physical phone or assistive-technology validation.

Before merge: no branch protection/rules or checked-in GitHub Actions workflows on main; inspect actual PR checks. Main and live services still at the tested base. Public `/api/health` returned `{ok:true}`. Read-only baseline shows Thally already connected, error null and data through November 24; live smoke should verify no banner for that healthy state without changing the connection.
