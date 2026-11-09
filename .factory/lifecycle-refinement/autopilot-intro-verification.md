# Autopilot introduction verification

Accepted no-headings baseline: `22267d421851bde1504282a9b0375d2e1713ecbf`. Scope: founder introduction #30, four access variants, once-per-account observed eligibility +48 hours, existing education transport and settings controls, additive guide allowlist migration0016. Prior #1–#29 review numbers and retired #5 remain. Separate local AI report keeps its earlier companion boundaries. Architecture: `autopilot-intro-architecture.md`; implementation: `autopilot-intro-runtime.md`; acceptance: `autopilot-intro-brief.md`.

## Integrated checks

Node22.18.0, local PostgreSQL at127.0.0.1:54329, isolated database `radar_autopilot_intro_full_20261110`, developer stubs, no real provider sends. Clean migration through0016:17 ledger entries; `autopilot-intro-migrate.log`.

- Focused runtime lifecycle/readiness:14 files,164 tests pass, including17 new real-DB introduction cases. Developer evidence: `evidence/autopilot-intro/affected-tests.log`.
- Fresh full suite:119 passing files,9 external skipped files,1 baseline-failing file; **1371 tests passed,65 skipped,1 pre-existing failure**. The unchanged native-raster snapshot expects `f883614e6a7dfb07` and produces `91d5409f50974af7`, independently established on the main-family baseline before this feature. No golden adjustment or hidden exclusion. `autopilot-intro-full-suite.log`.
- `npm run typecheck`:pass, `autopilot-intro-typecheck.log`. Next-generated tsconfig drift was restored to the actual persisted source and typecheck rerun.
- Optimized build:pass, `NEXT_DIST_DIR=.next-autopilot-intro`, BUILD_ID `tf8NPjH3mJSdrM-Of5Leo`; `autopilot-intro-build.log`.
- Clean0016,0015→0016 upgrade, old CHECK/startup rejection, new CHECK/startup admission, unchanged prior preferences/course/guide/mail/ledger and no-op rerun:pass, `evidence/autopilot-intro/migration-results.json`.

Independent acceptance in `qa/autopilot-intro/report.md`:16 newly derived backend cases,105 affected developer tests,18 optimized-browser checks,6 CHECK-specific readiness probes,8 new mobile/desktop renders and12 catalogue controls pass. All136 prior HTML/text files (68 variants) and their metadata are unchanged. Final source fingerprint: `e3f95c8bf39df1d1cd185a05bbadeca741bb1333d5fadc3506e90150ee8d291e`,639 files, using the prior no-headings lexical/raw-file scope. Four-gallery artifact fingerprint: `171fbac00af9f0d2225234ca508de8e98a2dcb9069b6d8d6044a78d4a9f0c47f`,370 files. Independent acceptance has no unresolved product findings. The preceding no-H1 point edit is separately accepted in `qa/no-headings/report.md`, preserving68 strict body comparisons and136 renders.

## Release boundaries

PR25 is the existing delivery target, branch `kenny/lifecycle-emails`; local branch `kenny/weekly-education`. No merge, deployment, customer/operator send, production write, billing action or education-flag activation. Apply0011–0016 after unchanged canonical main0010, then matching web/worker. Worker checks the validated guide allowlist;0015 columns alone cannot start it. Stop/drain dispatch or keep this guide-ID-aware worker paused before older code; preserve history, attempted bodies, sender identity and retry keys. Real inbox/client delivery and hosted migrations are not claimed.

Main advanced independently to108d6e1a during acceptance; the delta after integrated4908694f is operational observability formatting and public publishing citation filtering, with no lifecycle/schema/shared-mail/Autopilot overlap. It was inspected without another unrelated merge. Final remote PR mergeability is checked at push.
