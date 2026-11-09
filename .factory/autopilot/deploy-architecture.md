# Autopilot deployment architecture audit D1

Read-only audit on 9 November 2026 (Asia/Dubai). Source checkout `/Users/ekene/Downloads/design_handoff_radar/radar-push`, HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. User subsequently authorized deploying Autopilot, its migration, and both web/worker. PM owns all deployment, Git and database writes. Architect changed only this record; no production data, flags, settings, source or infrastructure were changed.

## Confirmed live target

`railway status --json`, `git ls-remote origin refs/heads/main`, and an actual running web-container metadata query agree:

| Item | Value |
|---|---|
| Project | radar, `863ea66d-04b9-40e8-b27f-89a4f75c026e` |
| Environment | production, `168aae6e-c038-4198-910a-e388afaac157` |
| Web service | `0c4df5c5-938d-421e-a16a-1c0781ac5118` |
| Worker service | `711ee076-4ac6-48f4-8721-91757f22cf7f` |
| Postgres service | `00a7f660-385f-4d6b-b425-d8fac4ac0f0a` |
| Current main/live commit | `60c68af34c6f80eee8fd7efa8eb2f02c3794394d` |
| Web deployment | `05529a13-0ad7-4abb-b7f7-04fdea7062e0`, SUCCESS |
| Worker deployment | `47fbb446-45af-4bce-89a2-c6f1f40317db`, SUCCESS |
| Public target | https://radar.thally.io |

Current live web builds `npm run build`, runs `npm run db:migrate` predeploy, starts `npm start`, healthcheck `/api/health`. Worker builds `echo worker`, starts `npm run worker`, restart ALWAYS, has no predeploy. Each has one Singapore-region replica. Running web confirmed Node22.23.4, production mode, development stubs off, and Resend configured (presence only; no credentials printed). Other live provider configuration/worker variable parity remains PM verification.

## Critical source and migration baseline

Do not deploy the dirty original checkout wholesale. Production main includes later signup-security, support, daily social, image status and Reddit changes. The dirty checkout is based on an older commit and contains unrelated unpublished positioning/visibility work. Its schema/journal does not describe live production.

Actual production `drizzle.__drizzle_migrations` has ten rows (0000–0009). Latest:

- Tag in exact deployed source: `0009_signup_security`.
- `created_at`: `1793808223880`.
- SQL hash: `8d86dadf2209699bbd4c6e3a67d2b5ea2c766c36e13bf308e18066de2ea1ed5b`.
- `users.email_verified_at` exists. None of the three Autopilot columns exists.

Dirty local journal instead records idx9 `0009_recommendation_share`, timestamp1794092779255, then0010_autopilot. Never replace production0009 with it or include its unrelated tables. Production0009 includes session/security data changes and must never be replayed. Clean release preserves all production migration files and existing journal entries byte-for-byte; add only the three Autopilot columns and newly generated metadata based on the production schema. Current0010_autopilot SQL content is additive and appropriate, but its original snapshot depends on the wrong0009 and must be regenerated in the clean release.

Separate local lifecycle/weekly-education branches already contain0010_lifecycle_emails,0011_engagement_updates,0012_weekly_education. They were not on origin/main or live at this audit. Recheck main before release and coordinate concurrent release work. Installed Drizzle0.45 migrator compares only latest database `created_at` against each journal `when`; a newly applied later timestamp can cause subsequently merged older-timestamp migrations to be silently skipped. If another migration lands first, rebase/renumber/regenerate Autopilot. If Autopilot lands first, later lifecycle changes must regenerate their numbering and timestamps against the new main. A filename rename alone is insufficient.

## Packaging and integration

Use a clean native release worktree from freshly confirmed origin/main. Port the Autopilot-only delta, preserving original dirty checkout. PM has assigned an engineer for this integration. Feature source allowlist is `.factory/autopilot/qa/fingerprint.json`; shared baseline copies are `.data/autopilot/baseline/{schema,workspace,types,settings,all}.ts`. Treat the original fingerprint as a scope guide, not a command to replace whole newer files.

- Apply targeted additions to current schema, Workspace projection/types, settings actions, job imports, API business-link auth behavior and existing UI; preserve live signup verification, human-checks and support/lifecycle behavior.
- Other feature runtime files can be copied only after comparing deployed/main versions and merging intervening edits. Especially preserve image loading/error handling, social/brief user edits and publishing connector work.
- Do not copy original package/lock/config/env sample, unrelated marketing/pages/visibility code,0009 recommendation-share files, dirty full schema or old journal/snapshots over main.
- No new dependencies, environment variables or providers are needed for Autopilot.
- Run clean-release typecheck, focused DB/authorization/publishing tests, build and independent affected UI checks. Re-run migration against a fresh database using production0009+new0010 and verify signup columns are retained. Original dirty-checkout QA does not prove a correctly extracted clean release.

Prefer an ordinary feature branch/PR merge deployment once checks pass and authorization is confirmed by PM. If using Railway local upload, upload only the reviewed clean release root to explicitly named project/environment/service; the original checkout has no `.railwayignore`, so a direct upload risks unrelated source and records. Never include `.env*`, `.data`, local builds, node_modules or private artifacts. Record exact source commit/fingerprint and both deployment IDs.

## Migration-first ordering

Do not rely on simultaneous GitHub deployment order. Worker has no predeploy and can start faster than the web migration; its ordinary `getBiz` queries select the new business column immediately even while Autopilot is off. Missing schema can therefore disrupt existing jobs.

Recommended sequence:

1. Freeze clean release SQL/journal and confirm remote main/live baseline remains expected. Preserve a current private production recovery point according to existing operator procedure; no customer data in feature records.
2. Apply the exact additive migration once through the standard installed Drizzle migrator in an existing running service, before merge/source deployment. Reuse runtime DATABASE_URL internally; do not export credentials to logs or files.
3. A narrow remote script can create a private temporary migration directory containing the exact final SQL and journal entry, invoke `migrate(drizzle(pgPool), {migrationsFolder: temp})`, then remove the temporary files. A full clean-release journal+SQL bundle also works. Assert the expected live latest hash/timestamp and absence of all new columns before applying; reject unexpected partial state. A rerun may proceed only when exact new hash/timestamp and all expected column types/defaults are already present, in which case report already applied.
4. Use a small pool, bounded connection wait, lock timeout and statement timeout for this maintenance operation. Existing table sizes are small, and these additive nullable columns plus constant JSON default require brief DDL locks; avoid indefinite blocking. Execute migrations serially. Drizzle has no built-in migration advisory lock and must not race another live migrator/deployment.
5. Standard Drizzle migrator records SHA256 of the exact SQL file and journal `when` in the same database transaction as all statements. Prefer it over hand-written ledger INSERT. Do not call the application's old db:migrate expecting it to discover an absent new file. The standalone migrator need not import current schema/services or run event backfill.
6. Read back column names/types, businesses.autopilot non-null default `{}`, nullable provenance, new latest ledger hash/timestamp, and aggregate enabled-business count zero. No customer settings are activated.
7. Merge/deploy matching clean source to both services. Web's normal db:migrate predeploy now sees0010 already recorded and is a no-op for schema, then runs its existing event-backfill path. Wait for both actual deployments to report SUCCESS and matching new source before declaring complete.

The equivalent safe alternative is sequential manual source deployment: deploy web and wait until migration/readiness success, then deploy worker. That must also prevent a simultaneous GitHub worker deployment from starting early. Adding identical predeploy migrations to both services without serialization introduces a race and is unnecessary for this release.

CLI note from a safe SSH read: Railway's passthrough command is joined by a remote shell; a raw node -e string containing parentheses fails parsing. Quote the complete JS argument with actual shell quoting (Python shlex.quote used successfully), not JSON.stringify. No secret-bearing code or output is needed.

## Post-deploy evidence

- `/api/health`200 and public auth/marketing smoke; verify migration predeploy succeeded, worker startup/cron registration and absence of missing-column/unknown-job errors.
- Read both actual containers' source revision and safe mode/config-presence booleans; do not infer runtime propagation from desired variables alone.
- Authenticated Settings → Autopilot visible for chosen business and default off; switch businesses and verify independent state. Verify signed-out owner email deep link reaches login and returns to the intended business using the feature's guarded hop.
- Aggregate jobs and outbox status can establish registration/absence of unexpected failures without printing content or customer identifiers. No real business opt-in, generated campaign, external post or real email is necessary merely to deploy this default-off feature.
- Existing default daily social drafts and separately authorized legacy automations continue; deploying code must not change their preferences or flags.

## Rollback

Leave additive schema and ledger in place; old application code tolerates the additional columns. Restore both web and worker to the recorded prior successful deployments/source if needed. If nobody has enabled Autopilot, no program-owned publication rows exist and source rollback is straightforward.

If a business has enabled Autopilot after release, revoke master settings through the new control before restoring old workers. Disable removes unsent program social schedules and returns scheduled program articles to review; sending rows require outcome recovery. Old workers do not understand provenance gates and could otherwise publish revoked rows. Verify no eligible program-owned rows remain before running old workers. Preserve manual schedules, generated drafts, ledger, signup-security state, billing settings, provider connections and RADAR_SECRET_KEY. Do not drop columns or restore an entire DB snapshot as a routine application rollback. Already accepted remote publish requests cannot be recalled.
