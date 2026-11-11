# LC2 verification history

**Final current-main integration:** see [main-integration-verification.md](main-integration-verification.md) and [independent report](qa/main-integration/report.md). Those records supersede this pre-Autopilot checkpoint, including migration numbering and catalogue counts.

Source begins at `f616862c7dcefb1aabec9155972466f7b3aeaf36` on `kenny/weekly-education`. LC2 source/copy/frame is frozen for the final checks. No customer mail, external provider send, production mutation, merge, deployment or billing action was performed. Local Postgres on port 54329 and synthetic accounts/provider captures were used.

## PM and engineer checks

- Engineer baseline: 11 files / 111 focused tests and typecheck pass at the starting revision.
- Integrated lifecycle regression: 12 files / 127 tests pass. Later guide-expiry regression and final dispatch/course checks: 3 files / 56 tests pass. Full commands and migration assertions are in `runtime.md`.
- Full database-backed suite on a fresh migrated local DB: **1,193 pass, 65 external skips, one unchanged native-image golden mismatch** across 110 files. `full-suite.log` records the actual failing result; it is not called a clean suite. Expected raster hash `f883614e6a7dfb07`, actual `91d5409f50974af7`, matching the previously independently reproduced baseline in `.factory/weekly-education/qa/baseline-golden.log`. No image implementation or snapshot was changed.
- Node 22.18.0 optimized Next build: **pass**, build ID `C1S8bizZyLvuOZ63lrg6L`; complete `build.log`. Runtime/copy/frame were frozen before this build. The compatibility preview entry point changed afterward and was generated/typechecked; it does not enter the deployed application bundle.
- Typecheck: pass. Source `git diff --check`: pass, excluding raw `.factory` logs and exact patch context.
- Actual renderer previews: canonical catalogue **28 user-facing families / 55 access, role and data variants**, plus complete plaintext copy and trigger/cadence metadata. Compatibility lifecycle, weekly and former-nurture galleries regenerated from current source, replacing stale duplicate editorial copy.
- Clean and 0012→0013 migration proofs preserve opted-out preferences, course position, attempted body/key/attempt timestamp, and FK protections/account cleanup. Schema-readiness probes require the additive guide fields. See `runtime-migrations.json` and independent QA evidence.
- Separate original-checkout AI report: pure formatter/caller rewrite, 39 tests / 5 files and original typecheck pass; copy-only exact patch recorded. Patch SHA256 `ef8f571115fef39c79b0db0ae13f5d4eeee203f78509e563405cd34690d45022`. Its unmerged measurement feature still requires verified-mailbox and migration integration; it is not imported or release-approved by these checks.

## Independent acceptance

Final independent results, visual evidence, production-build smoke and exact integrated source fingerprint are recorded in `qa/report.md`. The accepted check totals are 23 independent backend/API/transport tests, 56 final developer regressions, 42 development-browser checks, two billing-CTA checks, six optimized-build browser checks, 112 renders across 56 QA variants, three stress renders, 39 companion tests and clean/upgrade migration plus two worker-readiness probes. The user-facing gallery has 55 editorial variants; the independent QA manifest intentionally exercises additional adversarial render context. They cover the guide lifecycle and adversarial conditions, real legacy sender captures, signup/confirmation/invitation/settings/unsubscribe flows, billing CTA routing without payment mutations, mobile/desktop render quality, long unbroken text, the separate report, and clean/upgrade migrations/readiness. A local host-alias configuration mismatch and fixture rerun collision were corrected in the test environment; no product assertion was relaxed. The mobile overflow defect was fixed and retested with identical inputs.

Final independent aggregate source SHA256: `7612426fe3a009c85a5eb1b9dd8add02729f463a6086edcb4e38d61ac3797e08` across 599 files. Final restored-config typecheck is recorded in `typecheck.log`.

## Release boundaries

PR #25 remains a reviewable, unmerged release. Apply migrations through 0013 before matching web/worker; activate the existing education flag only after approved release review. Keep the guide-aware dispatcher for pause/rollback, or stop/drain dispatch before running an older guide-unaware worker against guide rows. Do not delete progress, recreate keys or backfill historical email events. Existing in-flight payloads remain frozen.

Real inbox receipt/deliverability, native Gmail/Outlook rendering, hosted migrations and production activation remain unverified here. Provider acceptance, local captures and browser rendering do not establish inbox delivery. The six production sender families retain their live/local inventory boundary until this release ships.
