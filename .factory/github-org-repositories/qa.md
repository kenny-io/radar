# Independent QA — GitHub organization repositories

**Recommendation:** Accept the local implementation for review. No regression observed in exercised behavior. Real GitHub organization approval/SSO is still a user-controlled prerequisite and was not changed or verified end to end.

## Tested revision and environment

- Workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`; branch `kenny/github-org-repositories`; HEAD/base `8dc6f8440864e820350844f44a9b6f3b98809221` plus integrated uncommitted changes. Final source fingerprint `86a393d451eac379cd49fa51c9c8cc5925300bbe8465c13f178f63421572089e` over the 8 source/test paths in `.data/github-org-repositories/tested-source-fingerprint.json`.
- Read `brief.md` GOR-1…6, `state.md`, `verification.md`, README local-development instructions, `docs/CONTRACTS.md` publishing contract, changed connector/action/client/UI code and developer tests. Design: existing modal/select with refresh, optional manual field and separate feedback; no supplied additional design artifact.
- Actual browser: Chrome via CUA, tab `1749354223`, `http://localhost:3031/settings`; desktop and 390×844 viewport. Read CUA `local-web-development` documentation. Final account-reset/reauthorization and Webflow scenarios repeated after final helper change and page reload.
- Next dev, `RADAR_DEV_STUBS=1`, separate dist `.data/github-org-repositories/next`, throwaway DB `radar_gor_qa_20261030` on existing local Postgres container `radar-sc-db:54329`; seeded local `dev@radar.local` Owner. No worker, real OAuth credentials, remote grants, real publishing, or production mutations. QA server stopped; viewport reset; QA's generated tsconfig include removed. PM build's generated include remains for PM cleanup.

## Acceptance coverage

| Criterion | Result | Evidence / limitation |
|---|---|---|
| GOR-1 | Passed automated | Independently ran pagination beyond 500 (700), dedup, ranking/order, 4-request bound, out-of-order arrival, required-page errors and malformed response checks. Browser lists stub personal repositories; live organization listing not tested. |
| GOR-2 | Passed core; partial blocked | Browser new authorization shows loading; refresh preserves selected `fieldnote/blog` and `content/org-posts`. Saved missing-list `qa-org/editorial` retained during edit/refresh. Loading feedback and disabled refresh observed. Empty and listing-error presentation not forced: existing stub always returns two options, no QA hooks added. |
| GOR-3 | Passed | Browser manually entered `https://github.com/qa-org/editorial.git/`, tested, saved in review-first mode, reloaded and edited normalized `qa-org/editorial` with folder retained. Invalid foreign-host URL rejected 400 by actual local action. Developer tests reject endpoint escapes and credential-host tricks. |
| GOR-4 | Passed copy/automated; live blocked | Browser approval/SSO/push instructions visible; connector tests cover restricted-org 403, SAML 403, rate limits and hidden-repository 404 diagnostics. No real restricted-org token used or approval granted. |
| GOR-5 | Passed exercised paths; partial blocked | Browser changing folder during pending test prevents late success from enabling Save. Stub `qa-org/fail-repo` failure shows 401 and prevents save. Final switch account removes auth/select/test and disables Save; reauth picks new suggested stub repo, keeps folder, does not restore old manual repo. Webflow authorize/list/test/save passes with final shared popup helper. Unit tests verify reverse-order OAuth source correlation. Arbitrary response-order UI races and legacy pre-picker connection not directly browser-tested. |
| GOR-6 | Passed local verification | 102 focused tests pass, typecheck passes, actual browser scenarios above. PM separately reports successful production build and full suite baseline classification. |

## Commands and evidence

Independent commands:

```sh
npm test -- src/client/api.test.ts src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/oauth.test.ts src/server/actions/publishing.test.ts src/server/services/publishing/connectors.test.ts
npm run typecheck
```

Logs: `.data/github-org-repositories/final-focused-tests.log` (5 files, 102 passed), `typecheck.log` (exit 0), `server.log`.

Additional actual local API boundary checks in `boundary-checks.json`: unauthenticated listing 401, nonmember business listing 404, invalid manual host 400, Viewer listing 403. Membership restored to Owner in `finally`. These supplement browser evidence, not replace it. Server continues to use tenant-scoped `connRow`/`readPending`; no changes to auth boundaries.

Screenshots (all local test content, ignored evidence):

- `manual-test-success.png`: manual URL with successful branch test and folder.
- `stale-test-invalidated.png`: edited folder after pending test; Save disabled.
- `final-reauth.png`: final OAuth helper completes; old manual selection absent and Save disabled.
- `mobile-manual.png`: 390×844 modal and manual input fit, no horizontal overflow (document width 390). Label accessible; Tab moves from manual input to approval link; Escape dismisses modal.
- `webflow-smoke.png`: selected collection and successful draft test; subsequent save completed.

No failed acceptance check found. Baseline full-suite failure is separately known: `src/server/ai/openrouter.qa.test.ts` golden assertion, also fails at base (PM baseline log `.data/github-org-baseline-tests.log`); not a regression from this fix. PM final full-suite report: 596 passed, 161 skipped, same 1 failure.

Not applicable: database schema migrations, live article publishing, real organization grants and production rollout for this local connector recovery fix. General modal focus trapping/accessible-name completeness was not expanded into a full accessibility audit; keyboard field use and Escape were exercised. Passing observed checks does not establish every provider or race behavior correct.
