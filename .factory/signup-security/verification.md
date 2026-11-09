# Signup security verification

4 November 2026 (Asia/Dubai). Base `f9eb6178`; final isolated workspace `/Users/ekene/.codex/worktrees/signup-security/radar-push`, branch `kenny/signup-security-hardening`. Only this feature was copied from the shared checkout; concurrent support/AppShell/release work was excluded and preserved. QA confirmed all36 signup source/config/migration files exactly match independently tested fingerprint `eafe34c283eab27cb753880ff1c27e1d19699b182e36e8c9531ea60e9c27f966`.

## Final policy

The user authorized IP/rate protection when the reused Thally widget's hostname coverage could not be read. Default signup/resend protection therefore uses shared PostgreSQL limits:10/IP/hour across both endpoints,3/address/hour,300global/hour, plus route IP limits. Optional exact `RADAR_SIGNUP_TURNSTILE=1` adds strict server-validated challenge checks, never an automatic fallback. Mailbox confirmation and safe Google identity matching remain mandatory in either mode. Distributed callers can consume fixed quotas; no claim of absolute abuse prevention.

## Checks

- Isolated final full suite: **889 passed,65 external-harness skips,1 pre-existing raster snapshot failure** out of955. `vitest run --fileParallelism=false`; `.data/signup-security/integrated-tests.log`. Temporary test database removed.
- Sole failure: `src/server/ai/openrouter.qa.test.ts`, branded-image hash expected `f883614e6a7dfb07`, actual `91d5409f50974af7`. Same failure reproduced on clean archived main `f9eb6178` (73passed/1failed in that suite); `.data/signup-security/baseline-golden.log`. No golden expectation changed. A contended shared-checkout run also observed an unrelated brief progress assertion; final isolated full run passed that test without changing it.
- Backend final focused50/50 passed on a separate newly migrated database, removed afterward. Covers no-session signup, inbox-selected password, expiry/replay/races, legacy recovery, old session/token revocation, unverified admin/session/guest-claim denial, generic responses, sender errors/redaction, cryptographically verified Google JWTs and subject-only collision refusal, default rate-mode quotas and optional strict Turnstile.
- Independent QA focused50/50 plus final policy5/5 passed. Real pre-0009 migration test preserved entire business/member/billing rows, verified only prior Google identities, removed unsafe Google-attached passwords, revoked non-guest sessions, retained guests and proved migration idempotence.
- Real Chrome desktop/mobile core5/5 passed under final default rate-only policy, with no SDK request or token field. Optional-widget lifecycle3/3, hydration/keyboard2/2, explicit enabled-mode missing-key failure and five-state fragment/history navigation regression passed. SDK responses are fixtures; real challenge completion is not claimed. Local encrypted email capture and Google identity stub are clearly separated from production provider proof.
- QA found and closed a real confirmation defect: Next history retained token-bearing URLs and same-tab reopening was ignored. Final code handles incoming hash/popstate changes and scrubs nested router state/canonical URL. Invalid/replayed/scanner/refresh flows retain correct boundaries.
- Independent architecture review found and closed failed-challenge mail-quota exhaustion. Final combined-IP namespace avoids double-counting the existing resend throttle. No remaining high-confidence authentication bypass or migration data-loss defect identified.
- Final isolated typecheck and production build passed. Independent built-production Chrome smoke3/3 passed: noindex/no-referrer/no-store headers, fragment/nested-history scrubbing, refresh/same-tab reopening,390px layout, default rate-only UI without SDK and missing-sender503, zero browser exceptions. No real email/challenge or account activation performed.
- Scoped `git diff --check` passes; no new dependencies.

## Environment and evidence

Tests used local Docker Postgres port54329, separate synthetic identities and no worker. No production account, payment, email, migration or configuration was changed. Private logs/env/captures/screenshots remain ignored under `.data/signup-security/`; tracked reproducible QA harnesses/report are under `.factory/signup-security/qa/` and `qa.md`.

Thally's existing Netlify Turnstile pair was recovered read-only and kept only in ignored0600 storage. Real dummy-token Siteverify recognized its secret; widget hostname metadata was unavailable. Bundled Spin validator was run but incorrectly rejects expected boolean false through jq's fallback; an equivalent strict-boolean request verified recognition. These are not real successful challenge results. Hostname/challenge proof gates optional activation only, not default rate-mode operation.

## Delivery and production rollout

Reviewable implementation; unmerged and undeployed. Actual inbox receipt and real Google consent remain external acceptance checks. Production rollout must retain existing sender config and use the documented old-web traffic drain/final session-revocation procedure. Password users confirm their inbox and choose a password once; existing Google users sign in with Google again. Businesses/memberships/billing remain intact. Never restore revoked credentials or roll back to vulnerable auth. See `docs/LAUNCH.md` §13 and architecture/infrastructure records.
