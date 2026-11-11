# Verification

## Baseline before feature changes

Repository HEAD f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49 with extensive pre-existing working changes (captured before implementation).

- `npm run typecheck`: passed.
- `npm test -- --reporter=dot`: 78 files passed, 25 skipped, 1 failed; 921 tests passed, 211 skipped. Existing failure: `src/server/ai/openrouter.qa.test.ts` parity golden image hash expected f883614e6a7dfb07, actual 91d5409f50974af7. Full log /tmp/radar-autopilot-baseline-tests.log. Unrelated golden fixture left intact.

## Integrated checks
Pending implementation and independent QA.

## Integrated implementation checks

- Isolated local migration to a fresh `radar_autopilot_qa` Postgres database applied through 0010 successfully. Provider keys blanked, development stubs on, no real email/social/CMS side effects.
- Engineer focused Autopilot/proactive-social/publishing DB suites: 47/47 passed; final auth-hop + Autopilot DB suites: 21/21 passed. Logs in ignored `.data/autopilot/focused-backend.log` and `.data/autopilot/final-backend.log`.
- PM integrated policy + Autopilot + proactive-social + publishing DB tests: 67/67 passed, `/tmp/radar-autopilot-integrated-db.log`.
- Full final suite: 80 files passed, 26 skipped; 948 tests passed, 223 skipped. Exactly the same pre-existing OpenRouter golden-image hash failure as baseline remains (1 failed). `/tmp/radar-autopilot-final-tests.log`.
- Final engineer typecheck and scoped `git diff --check` passed.
- Independent QA initial results: browser 12/12, helper integration 8/8, full program 9/9, real multi-business sidebar-switcher 3/3, signed-out email-link/login 3/3. Exact final fingerprint and recheck in QA report (pending final handoff).
- Full program executed registered jobs with a synthetic business: generated 12 calendar topics, a daily social pack and 7 brief items; published 3 social posts exactly once through stub providers; drafted/scheduled/published an article through existing stub CMS; manual Reddit reply delivered only to local outbox, with exact edited draft and source link. No manual action marked posted.
- Disable during real stored-media upload prevented final create. Revocation held earlier activation publications; manual schedules survived. Lapsed billing and access-check errors failed closed.
- Two-business owner flow used actual sidebar: A on left B off; B on and A off persisted independently. Delayed A save response did not replace B state. Signed-out email flow restored exact intended business after sign-in and retained 401/404 boundaries.

Production build and independent final source-fingerprint verification pending.

## Final handoff

- Independent QA final: **37/37** browser/integration scenarios (Settings12, helper8, complete program11, real multi-business switcher3, signed-out email links3) plus **81/81** affected Vitest tests and typecheck. See `qa-report.md` and QA result JSONs.
- Complete Next production build passed, exit0, with no warnings/errors: `/tmp/radar-autopilot-build.log`. Build ran with isolated local configuration and provider credentials blanked.
- Final tested working-tree fingerprint: `f4d477a75f5c73eaebdbf32ecdcff3625fd7836d4f2eb393d9a0a32683969a70`; `node .factory/autopilot/qa/fingerprint.mjs --check` confirmed no source changes after QA. HEAD remains f9eb617; no feature commit was made within the pre-existing dirty checkout.
- Temporary QA web server on 3830 stopped. Only the two Next-added QA/build type-directory includes were removed from tsconfig; pre-existing configuration changes retained.
- No unresolved Autopilot defects. Live provider delivery and production runtime remain untested; no production migration, deployment, customer activation, live post, or real email was performed.
- Rollout: apply 0010 before matching web+worker deployment; configure existing publishing/social/Resend connections; each business owner opts in independently. See rollout.md.
