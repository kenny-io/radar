# Autopilot production release

User explicitly authorized deployment, including migration, web and worker, on November 9, 2026 (Asia/Dubai).

## Release source

Clean native workspace `/Users/ekene/.codex/worktrees/autopilot-release/radar-push`, branch `kenny/autopilot`, based on current production/main `60c68af34c6f80eee8fd7efa8eb2f02c3794394d`. Original dirty checkout preserved. Only Autopilot integrated; existing signup/email security and released social functionality preserved. No unrelated recommendation-share migration or marketing changes imported.

## Baseline and recovery

Railway project radar (`863ea66d-04b9-40e8-b27f-89a4f75c026e`), production environment (`168aae6e-c038-4198-910a-e388afaac157`). Prior web deployment `05529a13-0ad7-4abb-b7f7-04fdea7062e0`, worker `47fbb446-45af-4bce-89a2-c6f1f40317db`, both SUCCESS at60c68af3. Both use production mode and development stubs disabled. Existing flags, secrets and business preferences remain unchanged.

Read-only live baseline: production migration ledger ends at0009_signup_security (when1793808223880), signup-security schema present, no Autopilot columns. New migration0010 is exactly three additive columns, SHA256df6995cf7d0268cd918c917a28348f2049d879a8a8bf25a76d0b8c9a85888881, when1794254096992. Standard installed Drizzle migrator will apply the exact release SQL/journal before code merge, preventing the faster worker rollout from selecting missing columns. Web's normal pre-deploy migrate subsequently becomes a no-op for0010.

Pre-migration private local PostgreSQL18 snapshot: 7,415,438bytes, SHA2567474b65df2e238cc05f75a42162a9a873b19f2445e3579397cacccf7e95aad1a, archive listing validated with PostgreSQL18 in a network-disabled local container. Archive remains ignored/private0600; not offsite and no production restore performed.

Rollback: stop/revoke any master Autopilot activation before source rollback, return both services to prior known-good source, and retain additive schema columns/data. No migration rollback or business preference rewrite is required. Do not let older unguarded publishers send already-authorized marked rows.

## Verification and rollout

Engineer110/110 focused/security tests and typecheck passed. Independent clean-release QA passed29/29 browser/integration scenarios plus74/74 relevant auth/security and Autopilot tests. PM optimized production build passed. Full clean-release suite:915passed,227skipped, exactly the documented pre-existing raster golden failure (1failed), with expectations unchanged. Final typecheck and staged whitespace checks passed. Tested changed-source fingerprint d9a60ee91fb6b36fe7d709d5836b68c8ea42c07d38e0ae9754a542eedacc4b39 is unchanged. No GitHub Actions workflows or repository rulesets are configured. Use feature-only PR merge into main and observe existing Railway auto-deployment for both services at the matching merge SHA.

Status: pre-deployment checks complete; authorized migration and source deployment pending. Customer Autopilot remains opt-in per business; deployment will not enable it for anyone.
