# Autopilot release integration

D2 engineer handoff, 9 November 2026. Release workspace `/Users/ekene/.codex/worktrees/autopilot-release/radar-push`, branch `kenny/autopilot`, production base `60c68af34c6f80eee8fd7efa8eb2f02c3794394d`.

The original tested feature lives in the dirty checkout at `/Users/ekene/Downloads/design_handoff_radar/radar-push`, base `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. That source checkout remains untouched. Only reviewed Autopilot deltas were ported; no broad branch snapshot or unrelated positioning/recommendation-share, support, or marketing changes were imported.

## Production contracts preserved

- Migration 0009 remains `0009_signup_security`; all prior journal entries are identical to production base. Migration `0010_autopilot` was regenerated against that snapshot and contains exactly the three original additive statements: `businesses.autopilot`, `calendar_entries.autopilot_activation_id`, `social_pubs.autopilot_activation_id`. Its SQL is byte-identical to the previously tested feature SQL. No original `0009_recommendation_share` migration or related tables are included.
- Production mailbox ownership column and token table are retained. The `AuthResult` verification-required union remains intact.
- Production `safeNext` control-character, whitespace and backslash checks remain unchanged; the feature adds only the exact authenticated business-hop allowlist and signed-out continuation.
- Existing `sendAuthMail` is byte-for-byte identical to production base. Only general `sendMail` receives the feature's durable outbox/provider idempotency option and timeout.
- `jobs/all.ts` adds only Autopilot registration. Unpublished public-check and visibility-digest jobs are excluded.
- Existing production daily-social generation, account routing, provider-error/unknown-outcome handling and manual publication stay in the base. Manual calendar/article adoption clears program provenance as in the tested feature.
- Package manifests and lockfile remain production-identical; no dependencies were added. The local QA workspace uses an ignored node_modules symlink to the identical installed source lockfile.

## Local release environment

Fresh local database `radar_autopilot_release_qa` on localhost:54329 was migrated using the complete production 0000–0009 chain plus additive 0010. No production database was accessed or changed by the engineer. All provider credentials are blank and adapters stubbed. Owner/member/outsider fixtures use verified emails, matching the released session security rules.

Ignored runtime paths: `.data/autopilot/local-env.json`, `fixture.json`, `migration.log`, `release-server.log`, `release-focused-tests.log`. Local browser server: http://localhost:3831. Start with `node .factory/autopilot/qa/server.mjs`; local commands can use `node .factory/autopilot/qa/check.mjs <command>` or the test wrapper.

The copied QA scripts were adapted only for the release database name, port 3831 and verified fixture users. Historical original-source verification records remain in this folder; independent release QA owns `release-qa.md` and `release-qa/*` and supersedes them for deployment readiness.

## Engineer verification

- `npm run typecheck`: passed on the integrated release source.
- `node .factory/autopilot/qa/tests.mjs src/server/services/autopilot/policy.test.ts src/server/services/autopilot/autopilot.db.test.ts src/server/services/social/proactive.db.test.ts src/server/services/social/publish/publish.test.ts src/server/billing/guard.test.ts src/server/auth/verification.test.ts src/server/auth/requests.test.ts src/server/auth/googleIdentity.test.ts src/server/auth/claim.test.ts --reporter=dot`: 110 tests passed across 9 files against the fresh release QA database.
- Tests cover actual stub publication; pause between media upload and external create; manual scheduling conflicts; revoked activations and re-enable; deduplicated/late owner handoffs; failed email retry; billing denial/errors; additive calendar preservation; sign-in continuation; existing signup verification, throttling, Google identity and guest claims.
- Migration journal ancestry, unchanged security-mail helper and preserved AuthResult union: explicit assertions passed.
- Scoped Git whitespace checks: passed.
- Exact integrated code hashes: `release-code-fingerprint.json`.

Next dev/build may add environment-specific dist/type includes to `tsconfig.json`; these generated additions are local validation state and should be omitted from the feature commit. No product tsconfig or dependency change is required.

## Delivery boundary

Engineer made no commit, push, merge, live migration, deployment, customer setting changes or external publication. PM owns the explicitly authorized migration/web/worker rollout and final artifact/CI verification. Independent QA and production smoke are separate evidence. No engineering blocker remains at this handoff.
