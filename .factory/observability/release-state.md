# Observability production release

Owner authorization: deploy observability to both production web and worker, then send a marked test alert to kenny@thally.io and verify delivery. Authorization received November 10, 2026 (Asia/Dubai); no additional merge/deploy approval needed.

Release workspace: /Users/ekene/.codex/worktrees/radar-observability-release/radar-push, branch kenny/observability-release, secure current-main base b38b67a4d48c51f39bd5fc68e1fc4143a9633060. Original extensive dirty checkout remains intact.

- OBS-REL-1: verified, factory-engineer core. Transplant only observability onto current main; preserve current JWT/account-linking protections, sendAuthMail, image account cooldown behavior, signup config and schema. Omit unshipped check/history features. Retain provider message receipt for exact delivery verification.
- OBS-REL-2: verified architecture audit, factory-architect. See release-architecture.md.
- OBS-REL-3: locally verified independent release QA, factory-qa. Delta review/tests then live read-only browser smoke after both deployments match new source.
- PM: owns release commit, PR/merge, production deployment verification, marked test email and provider delivery evidence.

Preflight: Railway radar project 863ea66d-04b9-40e8-b27f-89a4f75c026e, production environment 168aae6e-c038-4198-910a-e388afaac157. Web deployment 586385d0-d21e-4e8d-b336-41a684780ea9 and worker 99522406-9439-42ea-ae0b-bbb66a93895c both SUCCESS at b38b67a4. Both desired configs: NODE_ENV production, RADAR_DEV_STUBS 0, Resend present, verified sender Radar <radar@thally.io>, no alert override so new default enabled to Kenny. Actual worker runtime readback confirms these fields. No secret values stored.

No observability schema migration, dependency or new service required. Current GitHub main has no branch protection or Actions workflows. Local baseline exception (pre-existing image snapshot) remains explicit; require all new feature checks and production/security regressions before merge.

Release validation: build PASS (36/36 pages, type validation), final typecheck/diff check PASS. Full suite 982 passed, 231 skipped, one unchanged baseline raster hash failure; baseline was 915 passed/227 skipped/one same hash. Independent actual PostgreSQL 55/55 and focused provider/security-mail/transport 39/39 PASS. Immediate and queued Resend receipt persistence verified with exact payload/key replay. Feature-only 75-file SHA256 77d045cf017150d33eb2b9d5e57b6ad79447bc357d1fdafce1177dd48c7cc954 independently matches engineer and QA.

Next: commit/push/create+merge PR; wait for both Railway deployments SUCCESS at merge SHA; verify runtime code/config/worker registration and web health; send one marked alert via deployed production path and verify matching provider message delivered status.

Rollback: immediately preceding secure b38b67a4 on both services, or disable failure email consistently with RADAR_FAILURE_ALERTS=off while retaining logs. Do not roll back to original stale feature base. Preserve billing/auth/provider credentials and unrelated business settings.
