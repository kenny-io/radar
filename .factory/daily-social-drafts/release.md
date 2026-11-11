# Daily social drafts release

User explicitly authorized production deployment on November 9, 2026 (Asia/Dubai).

## Scope and baseline
- Feature-only release on `kenny/daily-social-drafts`, based on production/main `13f0697321302b2cc47384eb58520950c342985c`.
- Isolated native release workspace; original dirty checkout preserved. No schema, lockfile, infrastructure, secret or runtime-variable changes.
- Prior production web `a290ce75-4e95-4993-977d-3fc7ed160ad0` and worker `a08e0c7b-06d2-4859-ab3a-d1245072e894`, both SUCCESS on base SHA.
- Actual worker runtime baseline: production, stubs0, billing on, APP_URL https://radar.thally.io. Read-only aggregate: 3 active businesses, all 3 unset social preferences, none explicitly paused or opted into scheduling.
- Existing Railway GitHub-main auto-deployment covers both web and worker. No GitHub Actions workflows or branch rulesets configured.

## Pre-release validation
- All 13 source/test files match prior approved feature fingerprints.
- Main-based focused suite: 71/71 passed; typecheck passed; diff check passed.
- Main-based production build: passed. Log `/tmp/radar-daily-social-release-build.log`.
- Main-based full suite: 996 passed, 65 external-harness skips, one unchanged pre-existing branded-image golden failure (`openrouter.qa.test.ts`). Log `/tmp/radar-daily-social-release-tests.log`.
- Independent main-based local UI smoke: passed (daily status/provenance/manual action/settings and persisted edited draft at desktop/390px; no runtime errors). Synthetic current-schema fixture only. See release-qa.md.

## Rollout
Commit feature-only changes, open/attach PR, verify current checks/head, merge authorized PR, and observe both Railway services at matching merge SHA. Preserve existing billing, publishing and AI configuration. Let the normal scheduler catch up; do not bulk-enqueue jobs or change business preferences. Confirm readiness, runtime/source hashes, aggregate daily-job outcomes and independent live read-only browser smoke.

## Recovery
Prior source and successful deployments above are the rollback reference for both services. No new schema exists to roll back. Keep stored packs and explicit user scheduling/publishing decisions intact.

Release disposition: not merged/deployed yet.
