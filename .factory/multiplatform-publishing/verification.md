# Release verification

Clean production/main baseline 3c3ded28945394df71fc49c41a4d8d066b445662: 84 focused tests and typecheck passed.

Feature-only integration adds provider adapters, Unified Login, secure video upload, direct/scheduled publishing and durable status recovery. Current-main deletion/activation/email guards are retained. Independent release QA, broad suite and final Node22 build are in progress; see release-qa.md and release-architecture.md for exact final evidence. Prior source evidence is retained in development-verification.md and must not be substituted for release checks.

## Final release gates

- Exact production feature code committed as e81d816bc628c9d3be7a2658df94e1394a0224b3 on current-main base.
- Engineer final Node22 bundle: 257/257 tests across15 files; typecheck and diff check passed. See release-integration.md.
- Independent QA: 249/249 tests, 35 real Chrome desktop/mobile scenarios and25 integration/API scenarios passed. Final typecheck/fingerprint unchanged. PM inspected YouTube desktop and Instagram mobile picker evidence. See release-qa.md.
- Final isolated Node22 production build passed compilation/types/lint/41 pages/optimization/traces. BUILD_ID APAFrw3QrNPvPoKC-FAmM. All782 source/config/public/package files match checkout; runtime548-file SHA256 f9706282ff396314366c0325375f79e7c579e58a61d7f121c5adc6171e50f31b. See release-architecture.md.
- Initial complete concurrent suite: 4,246 passed,75 skipped,23 failures in9 files. Resource-sensitive reader timing and shared-global-cron DB fixtures interfered under concurrent verification. Re-ran all9 failed files sequentially in a fresh isolated database:304 passed,1 failed. Every initial failure cleared except the known OpenRouter raster golden mismatch. Assertions were preserved.
- The remaining golden mismatch reproduced identically on unchanged production/main3c3ded2: expected f883614e6a7dfb07 versus actual91d5409f50974af7. Purge16/16 passed separately on release and unchanged main. No feature regression remains identified. Logs /tmp/radar-multiplatform-release-full-suite.log, /tmp/radar-multiplatform-release-failed-isolated.log, /tmp/radar-multiplatform-release-baseline-purge-golden.log.
- Clean-main baseline84/84/typecheck, no dependency/Next-config/migration changes, real-runtime-secret scan passed. Repository has no CI workflows/rulesets; current head has no statuses/workflow runs. No unrun CI was counted as passed.

Release is ready for the authorized merge/deployment. Real provider OAuth grants and publication are not implied by mocked acceptance; production confirmation follows deployment.
