# Independent QA plan

Read source PRD and architecture before engineer handoff. Test current integrated working tree on base f9eb617 in /Users/ekene/Downloads/design_handoff_radar/radar-push. Use localhost:3830, isolated radar_autopilot_qa Postgres database on localhost:54329, development stubs, billing off, external email/AI disabled. Test users are synthetic Owner/Admin/Editor/Viewer/Outsider roles; sessions remain in ignored .data/autopilot/fixture.json.

- AC1,7,8: Real Chromium browser verifies default-off, explicit publication permission, Owner email destination, keyboard operation, simulated save failure retaining persisted state, enable + refresh persistence, last activity/run-now, mobile width and non-owner disabled controls. API verifies all non-owners 403 and unrelated user 404.
- AC2,3: Execute coordinator and queued calendar worker directly through registered job definitions in isolated test process. Verify empty calendar creates topics, existing proposed/user content persists exactly, repeated tick/retry does not duplicate work, article job uses ownership provenance.
- AC4: Valid stub X/LinkedIn accounts receive due/future publications; generation/platform restrictions, preflight and no-account/expired handling retain drafts. Deduplication uses durable IDs.
- AC5: Synthetic current-day Reddit reply with user edits produces owner email containing selected prepared text/source/business link, not posted state; repeat no duplicates, late item new handoff, missing prerequisites/final errors included. Inspect outbox only: no external emails.
- AC6,8: Stale activation jobs and queued marked social/article publications cannot send after off or off→on. Manual unmarked publication remains independent. Billing checks fail closed for marked work. Existing prefs unchanged.
- Regression: baseline typecheck and focused existing publishing/daily-social suites, plus newly added tests. Known baseline full-suite OpenRouter parity fixture image hash failure is not a new Autopilot regression.

Evidence: browser.mjs + browser-results.json + synthetic desktop/mobile screenshots; integration scripts/results; exact source fingerprint. Re-run affected scenarios after implementation fixes. No merge/deploy requested.
