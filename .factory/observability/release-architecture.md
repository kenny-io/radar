# Observability release architecture audit

Audit date: 2026-11-10 (Asia/Dubai). Release worktree `/Users/ekene/.codex/worktrees/radar-observability-release/radar-push`, branch `kenny/observability-release`, verified base `b38b67a4d48c51f39bd5fc68e1fc4143a9633060` (`origin/main`, Autopilot PR37). Original implementation worktree is dirty and based on `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`.

Scope: read-only comparison of the original 74-path feature manifest and current production base; only this architecture record is owned by architect. The user now authorizes production release of web and worker plus a marked test email to Kenny. PM owns delivery; engineer owns the transplant. No production mutations or email were performed by architect.

## Required transplant decisions

**Do not copy the whole original checkout or manifest files indiscriminately.** The original working tree combines observability with unrelated unreleased product work, and some files predate recent production security fixes.

| File(s) | Verified difference and precise release action |
| --- | --- |
| `src/app/api/auth/google/callback/route.ts` | Production uses remote JWKS + `jwtVerify` (audience, issuer, RS256), validates verified email/guest exclusions, matches accounts by Google subject, refuses email-only linking, sets verification timestamps and revokes legacy sessions/passwords. Local file reverts these protections. Keep production code; add report import and narrow exchange/operational catch only. Never restore `decodeJwt` or email-based account auto-linking. |
| `src/server/services/mail.ts` | Production exports `sendAuthMail`, preserves redacted production auth-email content/encrypted stub capture, and fails closed when delivery unavailable. Local file deletes this entire security sender. Keep it intact, transplant `sendMail` reporting wrapper and log-only operational alert only. If adding auth-mail failure reporting, use a bounded generic diagnostic/context without recipient, confirmation link, plaintext body or provider raw body. |
| `src/server/services/images.ts` | Production tracks every configured route, `accountBlocked`, account cooldown vs transient OpenRouter breaker, and returns safe `image_unavailable` when all routes are account-blocked. Local file removes these behaviors. Keep production loop/accountBlocked handling; add numeric provider error status and per-attempt/fallback/render/store report hooks around it. Test all-account-blocked behavior remains intact. |
| `src/server/services/visibility/collect.ts` | Local includes unshipped history imports, `aiObservations`, prompt-series arguments, missed-topic generation and `nextActions`. Production lacks these features/schema. Start from production and add only report import + caught configured-cell failure reporting. Do not add history or observation persistence. |
| `src/server/actions/visibility.ts` | Local adds history import and `visibility.summary/preferences` actions. Transplant only report import and `ensurePrompts` catch reporter. |
| `src/server/jobs/all.ts` | Add only `../observability/jobs`. Do not add local `../services/check/jobs` or `../services/visibility/digest`, which are absent production features. |
| `src/server/services/check/service.ts` | Entire file is an unrelated public-check implementation absent production and dependent on unshipped schema. Exclude it from this release. Remove public-check coverage claims in release documentation. |
| `src/server/observability/jobs.ts` | Required new runtime module exists locally but is missing from `.factory/observability/files.txt`. Include explicitly; worker registration is necessary for durable alert retry. |
| `src/server/services/autopilot/run.ts` | Direct content comparison against production shows only reporter import and the three intended swallowed-stage/scheduling catch hooks. Safe to transplant the observability changes. |
| `src/server/services/social/proactive.ts` | Direct comparison shows only reporter imports and guarded catch hooks. Safe to transplant; retain `shouldReportFailure` guards for expected missing/unwritten source errors. |
| `.env.example` | Add only `RADAR_FAILURE_ALERTS` and `RADAR_FAILURE_ALERT_EMAIL` docs. Keep production account-confirmation requirement and signup Turnstile variables (`RADAR_SIGNUP_TURNSTILE`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `GUEST_TURNSTILE_SECRET_KEY`). Exclude unrelated recommendation-check/IndexNow configuration. |
| `README.md` | Add Failure alerts section only. Preserve production product introduction. Do not add the local recommendation-positioning link to an absent feature. |
| `docs/LAUNCH.md` | Replace the error-monitoring checklist line only. Preserve production §13 signup-security rollout and security rollback guidance. |
| New observability docs/tests/script | Copy only observability-owned modules and focused tests; verify test mocks match production modules. Amend documentation's old statement that deployment is not authorized: owner has now explicitly authorized this release. |

Other manifest differences were inventoried with direct `git show origin/main:<path>` versus original filesystem contents, rather than relying on the original index (Autopilot/proactive files appear untracked there). Remaining existing runtime diffs are reporter imports, operational catch hooks, RPC/request JSON handling, cause/status metadata, queue/context instrumentation or worker startup handling. Engineer must review the final release diff against `b38b67a4` and run production-base security regression checks alongside observability checks.

## Runtime and rollout

- Existing production `jobs` schema provides nullable business ID, JSON payload, retries, locks, result/error and run-at fields needed by alerts. No observability schema migration, new provider, dependency or credential is required.
- PM verified both deployed services run `b38b67a4`, `NODE_ENV=production`, development stubs off, Resend configured and verified sender `Radar <radar@thally.io>`. Absent alert flags enable the new production default and default recipient `kenny@thally.io` after code rollout. Keep both runtimes configured consistently.
- Internal `observability.alert` rows have null business ID and immutable sanitized envelope. New worker must import its job definition. Immediate web sends work during mixed-version rollout; pending retries wait until a worker capable of the alert kind starts. Preserve current publication claims and unknown-send protection; observability must not retry social publication itself.
- Deploy the reviewed, tested release commit to both web and worker through the authorized normal workflow. Verify both successful deployment revision IDs equal that commit, web `/api/health` remains healthy and worker startup/register/retry behavior is present.
- Run one clearly marked `scripts/test-failure-alert.ts` using the intended production configuration after rollout. Match its unique alert ID to the durable `observability.alert` row and Resend email record. A `done` job proves provider acceptance only. Verify Resend's delivery/bounce state as a separate step; distinguish provider-confirmed delivery from a human seeing the inbox. Do not deliberately break customer AI/provider credentials to test capture.
- Preserve the actual tested release revision/fingerprint in verification. A build from the original dirty checkout does not establish release compatibility with production's newer security code.

## Rollback

Prefer turning `RADAR_FAILURE_ALERTS=off` consistently on both services to stop new email attempts while retaining structured failure diagnostics. Existing alert jobs may be marked permanently failed when delivery is explicitly disabled; inspect/replay deliberately after a fix rather than assume all old jobs automatically resume.

If binary rollback is required, roll back both services to the immediately preceding secure `b38b67a4` production revision or a reviewed forward fix, never the original stale `f9eb6178` feature base. No database rollback is required. Alert-kind rows are retained; older workers do not claim unregistered kinds. Forward recovery respects the 23-hour delivery guard and Resend idempotency window; do not blindly replay expired notifications with a fresh key.

## Remaining review evidence

Architect conflict findings were sent to PM/core engineer before transplant. Final runtime/test diff, production deployment state and email delivery evidence remain owned by engineer, independent QA and PM. This audit does not claim those release steps have occurred.
