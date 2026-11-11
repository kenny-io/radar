# Authorized production release QA

QA scope: independently review the observer-only transplant onto current production main, run focused regressions, then perform read-only live health/browser smoke after PM confirms matching web/worker deployment commits. PM exclusively owns commits, merge, deployment, runtime configuration and the authorized test email/provider delivery verification.

Release baseline: clean worktree `/Users/ekene/.codex/worktrees/radar-observability-release/radar-push`, branch `kenny/observability-release`, base `b38b67a4d48c51f39bd5fc68e1fc4143a9633060`. This production base is newer than the original dirty checkout. Preserve its signup security, image progress, publishing and Autopilot behavior; transplant observers only. No production mutations by QA.

Preflight: baseline verified clean at b38b67a4 before engineer transplant. No observability module/records existed yet. Read-only smoke prepared in `qa/release-browser-smoke.mjs`; requires a full PM-confirmed deployed SHA before running. No live request has been made by this QA task yet.

Status: awaiting engineer transplant handoff and then PM deployment-ready message. Delta review/tests, final source SHA and runtime evidence pending. Prior unrelated image golden hash mismatch remains a known baseline exception until checked on this release base.

Live email limitation: QA will not claim personal inbox receipt. PM may verify the explicitly authorized marked test email through Resend delivered status, which is separate evidence from browser/runtime checks.

## Independent delta review and local verification

Reviewed current-main delta after observer transplant:
- No schema/migration, product UI, signup/security policy, article image-progress or deployment configuration replacement. Google JWT signature verification/no-email-auto-link behavior, secure auth-email encrypted development capture/redacted production content, current image accountBlocked/cooldown checks and Autopilot cancellation/authorization remain intact.
- Observer additions preserve action responses, queue retry transitions, fallback behavior and local disconnect success. Production Node/Edge hook uses the previously verified positive compile-time runtime branch. `sendAuthMail` has a generic diagnostic wrapper without recipient/bearer links/provider bodies; its original hardened implementation is retained.
- This release intentionally omits dirty-checkout public-check/history integrations that do not exist on production main. No unrelated feature is being introduced to satisfy a stale branch's imports.
- Resend provider message receipt is an internal job result only, enabling PM's authorized provider delivery verification. Immutable envelope/idempotency and safe HTTP errors remain unchanged.

Independent focused run: provider/image fallback + real reporter/transport/redaction + operational/security-email tests:5files39tests PASS. Separate initial compatibility subset: support mail7, social generation11, publishing adapters14 PASS; signup verification11 skipped without database and is being rerun against an isolated migrated PostgreSQL database.

Actual-database run in progress on isolated `radar_observability_release_qa` (Docker IPv6localhost54329), never production: QA8, signup verification11, Autopilot11, social publishing21, Brief4. Final counts and tested commit pending engineer/PM handoff. `git diff --check` passed at the review point.

Independent local release gate: GREEN, no blocking defect found.
- Actual PostgreSQL run:5files55tests PASS (QA8, signup verification11, Autopilot11, social21, Brief4). Log `/tmp/radar-observability-release-qa-db.log`. No production database or provider calls.
- Independent receipt probe `npx tsx .factory/observability/qa/release-receipts.ts`: PASS. Real isolated Postgres stores the immediate Resend message ID and the queued worker message ID after a simulated503; retry body/key stay identical; raw transport response body is excluded. All fetches mocked before module imports.
- Independent final typecheck and diff check: PASS.
- Independently recomputed engineer's75-file source/config/docs/test manifest fingerprint (excluding .factory): `77d045cf017150d33eb2b9d5e57b6ad79447bc357d1fdafce1177dd48c7cc954`. Definition: lexically sorted changed/untracked feature paths, filename+NUL+bytes+NUL; base `b38b67a4d48c51f39bd5fc68e1fc4143a9633060`. Fingerprint matches engineer handoff exactly.
- Engineer final production build: PASS exit0 (36pages and type validation), generated include cleanup complete; current tsconfig diff empty. Engineer default full suite982PASS/231SKIP/1baselinePNGparity mismatch; its clean-main baseline915PASS/227SKIP/1same mismatch. This is distinct from old dirty-checkout counts and no new failure is reported.

PM may proceed with the explicitly authorized release. Live verification is still pending: QA will wait for matching deployed web/worker commit confirmation before running the public browser smoke. No inbox/delivery or deployment claim is made by these local checks.
