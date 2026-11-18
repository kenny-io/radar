# Production release

User authorized shipping and production deployment on November 19, 2026 (Asia/Dubai).

Clean managed worktree: /Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push, branch kenny/multiplatform-publishing, based on production/main 3c3ded28945394df71fc49c41a4d8d066b445662. Original dirty checkout is retained unchanged. Only the requested publishing feature and necessary integration changes are permitted in this release.

Baseline: web 52673210-f203-4ac5-b589-a0a221540d01 and worker d27676e9-f0c3-4c83-a543-b864e5addff0 both SUCCESS on base SHA. Existing GitHub-main auto-deploy covers both services. Repository has no configured workflows/rulesets and main is unprotected, confirmed read-only on November 19.

Provider credentials were staged and exact-match verified on both services using stdin/skip-deploys before this release. No credentials belong in source, logs or screenshots. No database migration or dependency change is expected. Reconfirm against final integration.

Release gates: architecture/dependency review, clean-main feature port, focused regressions, typecheck, production build and independent browser/integration QA. Merge only the verified head. Observe both services at matching merge SHA and check live health/connection routes/worker start without making unspecified posts or changing customer preferences.

Rollback reference: both prior successful deployment IDs and base SHA above. Preserve saved account credentials and already accepted provider operation references; avoid reverting workers to code that could resend pending media without inspection. No irreversible database change is planned.

Status: preparing feature-only integration; not yet merged or deployed.

## Validated candidate

PR https://github.com/kenny-io/radar/pull/63, runtime code e81d816bc628c9d3be7a2658df94e1394a0224b3. Engineer257 tests, independent249 tests plus60 browser/integration scenarios and final Node22 production build passed. Broad-suite retry304/305 has only the identical existing main raster golden failure. See verification.md for complete counts and baseline distinction.

No production defect remains identified. No package/config/migration or business preference mutation is included. Final evidence commit contains documentation and reproducible synthetic QA only; runtime source remains the tested candidate.

Status: release-ready; user-authorized merge/deployment is next. No live posts performed for verification.
