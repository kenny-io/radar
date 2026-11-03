# State

| Task | Owner | Status | Next |
| --- | --- | --- | --- |
| EMAIL-A1 audit/design | factory-architect | verified | architecture.md |
| EMAIL-E1 template/durable transport | factory-engineer | verified | 31 focused checks pass; independent in-process dispatcher |
| EMAIL-E2 auth/recovery | factory-engineer | verified | 28 auth checks pass, including independently discovered stale-claim defect fixed |
| EMAIL-E3 billing/readiness wiring | factory-engineer | verified | 74 focused checks pass; eight new lifecycle scenarios |
| EMAIL-Q1 independent verification | factory-qa | verified | 45/45 dev +45/45 optimized production browser;190 focused tests; two defects closed; all owned servers stopped |
| EMAIL-P1 integration/launch handoff | PM | review | [PR25](https://github.com/kenny-io/radar/pull/25), source57b69edb. Build/typecheck/diff pass; full suite920 pass/65 external skips/one unchanged raster baseline failure. Await owner approval for auto-deploying main |

Isolated existing worktree, branch `kenny/lifecycle-emails`. Test database `radar_lifecycle_20261103` created on local Postgres port54329. No production writes, real recipients or deployment in this task so far. Verified connected Resend: Thally sending domain enabled/verified; 50,000 monthly limit,338 used, no daily cap,10 requests/second. No Radar hosted templates found; Thally templates belong to Thally and are preserved.

Controlled provider smoke: actual application queue and dispatcher sent only welcome and reset fixtures to Resend's documented simulator. Both provider records report delivered; both sent once with durable acknowledgment. The separate local simulator account and encrypted payloads were deleted. This does not establish human inbox placement. Production remains unchanged; main merge requires owner's approval under existing repository policy.

Release candidate verified. No runtime configuration changes required. Apply migration0009 on web predeploy and ship matching web/worker source. No customer backfill, announcement campaign, billing change or live payment mutation. Remaining launch checks are in launch-readiness.md. The only unrelated worktree modification is the existing search-indexing log, preserved and unstaged.

Delivery checkpoint: implementation commit `57b69edba3f570c371a877cdfd1cdfbc2c5f5e4a`, [PR25](https://github.com/kenny-io/radar/pull/25). No GitHub status checks are configured/reported for this head; local and independent evidence above supplies verification. Production remains successful at `f9eb6178`; no merge/deployment of this release has occurred. Next action is the owner's merge/deploy decision, then live health/recovery/email smoke without changing billing.
