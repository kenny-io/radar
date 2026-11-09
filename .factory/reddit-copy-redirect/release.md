# Release — concise replies and Reddit copy

Owner authorized deployment on November 9, 2026. Release branch `kenny/reddit-copy-concise-replies`, clean current-main base `d8ac2d3a537c9d970e493d2e3940e8b6aba33c11`. Only six feature source/test files plus scoped feature records are included; unrelated original checkout changes are preserved.

Implemented: successful Reddit copy saves current text/state then opens the same thread's comments; top Copy reply action before the variant switch; correct current-variant keyboard shortcuts; generated/re-written community responses capped at three short paragraphs with required disclosures preserved. No schema, dependency, runtime-variable or infrastructure changes.

Release-base verification: 133 focused tests, typecheck and actual production build passed. Independent browser acceptance is recorded in release-qa.md. All six files match the independently verified feature source (combined fingerprint in release-integration.md).

Production target: https://radar.thally.io, Railway radar / production. Read-only inventory confirmed valid GitHub-main triggers on both web and worker, with no check-suite gating. GitHub main has no branch protection/rulesets/workflows; existing deployment statuses are web and worker success. Merge triggers both deployments. PM must verify final source revision and SUCCESS on both plus live health/browser evidence before marking released.

Prior active release: `d8ac2d3a537c9d970e493d2e3940e8b6aba33c11`; web `da936ae3-dfc3-419e-9040-b7503612b28a`, worker `3afcb73e-68f6-489e-bedf-929f97cba0de`. Rollback: revert the scoped merge and verify both services redeploy to the revert, or restore both prior successful deployments. No data rollback required. Preserve all runtime variables and existing data.
