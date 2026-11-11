# Autopilot clean-release architecture review

Read-only D1 final integration review at `/Users/ekene/.codex/worktrees/autopilot-release/radar-push`, release base `60c68af34c6f80eee8fd7efa8eb2f02c3794394d`. Architect edited this record only. PM owns build, migration/deployment writes and release; QA owns independent acceptance checks.

Reviewed tracked and new feature files against production base. No accidental runtime rollback or unrelated feature source inclusion found. Integration preserves current signup-security schema/authentication, human-check handling, support, daily social generation, image behavior and publishing code outside Autopilot additions. Existing strict safeNext is retained; the one narrowly validated authenticated business-selection hop is added for email links. Existing authentication result/verification behavior remains in place.

Schema diff is exactly three additive columns:

- businesses.autopilot JSONB NOT NULL default `{}`;
- calendar_entries.autopilot_activation_id nullable text;
- social_pubs.autopilot_activation_id nullable text.

Production0000–0009 SQL/snapshots and journal entries remain untouched. New snapshot prevId matches production0009 snapshot id. Recursive structural comparison differs only in snapshot id/prevId and those three columns; no recommendation-share or unrelated tables entered the release.

Exact0010_autopilot.sql SHA256: `df6995cf7d0268cd918c917a28348f2049d879a8a8bf25a76d0b8c9a85888881`. New journal idx10 timestamp: `1794254096992`. Apply this exact artifact using the migration-first sequence in deploy-architecture.md; reject an unexpected live migration baseline. The separate pending lifecycle migration timestamp/numbering concern remains as previously recorded; this review performs no other branch coordination.

Generic sendMail adds optional idempotency key, deterministic outbox identity, reuse of persisted payload, skip of already completed delivery and bounded provider request. It retains the security-specific sendAuthMail function byte-for-byte against production base, including redacted production storage, encrypted dev-only capture and safe error handling. Autopilot handoffs use owner identity, tenant-specific guarded links and the stable mail job id as the idempotency key. Existing callers without keys retain normal behavior.

Reviewed activation/billing/feature-flag/pause guards, manual adoption and conflict-protected social schedules in the integrated tree; no new architectural blocker identified. `git diff --check` passed. Engineer reported110/110 focused/security tests; architect did not rerun those tests. PM build and QA acceptance remain separate evidence. Incidental tsconfig addition for `.next-autopilot-qa` generated types can be removed from the final source commit; it does not change runtime behavior.

This is a clean-source integration review, not confirmation of migration, live provider delivery, deployment or customer activation.
