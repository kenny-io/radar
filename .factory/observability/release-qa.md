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

## Authorized live read-only verification — PASS

Executed only after PM confirmed both Railway services SUCCESS at merge commit `8b0fc3462c2709788cfa730d2f80c3ffee014a30` (tested head `8eb03772`; PM verified identical Git trees). PM-reported deployed IDs: web `a1d27185-bca3-4879-a37b-f7960c9a9d86`, worker `e14bd6ce-2434-4990-a9a5-1af7dc17db42`. PM independently read worker startup, enabled alerting, Kenny recipient, Resend configuration, alert-job registration and runtime source hashes. Public endpoints do not expose source SHA, so these deployment/runtime details are explicitly PM-supplied evidence rather than inferred from an HTTP200.

QA ran `node .factory/observability/qa/release-browser-smoke.mjs 8b0fc3462c2709788cfa730d2f80c3ffee014a30` against `https://radar.thally.io` at `2026-11-09T21:10:48Z` (November10,01:10Asia/Dubai):
- `/api/health`:200, `{ok:true}`.
- Real installed Chrome: homepage, `/signin`, `/privacy`, `/terms` all200 with expected page headings/titles and no unexpected error page.
- Actual sign-in UI has one email field, one password field and one Sign in button; current confirm-email entry remains visible. No form submitted.
- Zero browser page errors. Homepage and sign-in screenshots visually inspected after capture.

Evidence: `qa/release-browser-results.json`, `qa/release-home.png`, `qa/release-signin.png`. No account creation, authenticated action, AI generation, configuration change, production database write or email send was performed by QA. The only network activity was public/unauthenticated health and browser page loading.

Live public release gate: GREEN. Authorized marked-email delivery verification remains PM-owned and separate; QA does not claim personal inbox observation. Independent local acceptance/receipt tests and live read-only application checks found no blocking defect.

PM final operational evidence: actual web runtime also confirmed merge SHA and matching six source hashes, alerting enabled, Kenny recipient, configured sender and registered `observability.alert`. PM sent exactly one authorized marked test through the deployed worker: alert `26afa389-4d2f-4dae-a61f-2136e06e8cbf`, Resend message `01a1c226-8ec2-7a51-994c-58298a716fad`, created `2026-11-09T21:11:09.413Z` (November10,01:11Asia/Dubai). PM's exact Resend get-email record reports **delivered**, to `kenny@thally.io` from `Radar <radar@thally.io>`, matching the alert ID/body. This is provider-confirmed delivery, not a claim that QA personally viewed Kenny's inbox. No extra synthetic replay or email was sent.

Final release recommendation: PASS for the authorized deployment. Both matching-sha services, enabled runtime alert path, provider-delivered marked test and actual public browser/readiness checks have evidence. No unresolved blocking feature defect was found. Known local baseline canvas golden mismatch is unchanged and recorded separately; no live provider outage or customer generation was intentionally triggered.
