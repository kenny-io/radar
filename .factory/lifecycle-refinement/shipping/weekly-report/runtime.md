# Weekly AI report #28 runtime handoff

Isolated worktree `/Users/ekene/.codex/worktrees/radar-email-weekly-report/radar-push`, branch `kenny/email-weekly-report`, implementation base `9b40b8a2a05495be663b36b9570af22986efdd8a`. PM approved this bounded follow-up separately from the released core. Original dirty checkout remains untouched. No real provider, customer/operator send, production write, flag change, merge or deployment performed by this engineer. PM requested a local freeze commit for integration.

## Implemented behavior

New `ai_weekly_report` uses the existing encrypted lifecycle outbox, founder identity, bounded provider suppression/pacing, global claims,23-hour/MAX8 retry and immutable attempted body/key/identity. Event identity is `visibility-weekly:{businessId}:{MondayPeriodEnd}:{ownerId}`. Source/current verified mailbox, actual ownership plus active Owner membership, active business, independent business report permission, current prompt series and source domain are checked at capture/send and again after suppression lookup. A previously accepted business-period also excludes a second owner-transfer report. In-flight provider requests remain an unavoidable existing limit.

New observations append real successful/failed collection attempts with UTC day, frozen prompt series and measurement timestamp. Success and latest-result update commit together; failure never copies an old success into a new day or counts as zero visibility. The report groups latest successful daily cells and compares preceding7 completed UTC days against prior7 in the same prompt series. No fake backfill from latest ai_results. No extra collection calls, provider routing changes, research consent or unrelated measurement dashboard/public-check port.

Monday at/after08UTC only: bounded collector requires actual collected data, queues while capped, preserves a fixed Monday period and expires before next Monday08UTC. It never creates historical Tuesday catch-up. Existing account24-hour optional cap and stable owner timezone/daytime apply; priority is essential→course→report→guides→founder→work. Multiple businesses queue least-recently-accepted first, with never-sent first and deterministic IDs. Overflow expires instead of bypassing the cap. Separate hourly scan-attempt cron marks prevent100 stale-series businesses monopolizing discovery and never count as delivery/opt-out history.

Only the weekly biggest miss creates one deterministic proposed calendar topic per business/prompt/series. No approval, generation or publication is initiated by this collector. A topic is described as awaiting review only while its mapped row remains proposed. Before first attempt, a topic which advances selects the reviewed no-topic copy while retaining original period/figures/series; after any attempt it suppresses the entire retry. Long generated questions get an explicit300-character display ellipsis while full stored prompt/series remains unchanged.

`RADAR_EDUCATION_EMAILS` is the existing operational pause flag for report collection/delivery. Report preference is independently default ON per business and does not inherit education opt-out; recorded report false remains off. Owner/Admin management uses `/api/me/ai-report-preferences` GET/PATCH `{businessId,weeklyEmail}` and is available from authenticated account Email preferences without a subscription requirement. Signed `/ai-email-preferences` GET only displays confirmation; strict bounded normal-form POST disables. `/api/ai-email-preferences?token=...` accepts only a bounded canonical RFC8058 one-click POST. Tokens authorize disabling only the named current owner's report and never change education/work/research/security/billing. Missing, foreign, Viewer and stale-owner authority fail closed.

Review-all-answers uses the fixed business hop to `/performance?tab=ai`, preserving the correct business through normal sign-in/access guards without arbitrary redirects or activation on GET. PM-owned email text/no-H1 is preserved. Canonical pure formatter now supports optional fourth argument `reviewUrl`: `recommendationDigestContent(summary,appUrl,preferencesUrl,reviewUrl?)` → `{text,html,preheader}`; renderer supplies the fixed hop. Root owns preview/catalogue/docs updates and removal of unrelated research wording from copied preference-page/new management UI copy after integration.

## Changed source groups

- `src/server/services/visibility/{history,digest,digestTypes,digestPreferences,digestContent}.ts` and focused tests; `collect.ts` append-only persistence.
- `src/lib/recommendationShare.ts` and arithmetic tests, ported without unrelated feature dependencies.
- `src/server/services/lifecycle/{templates,queue,dispatch,engagement,engagementJobs}.ts`: separate active family, encrypted snapshot, optional delivery rules and registered cron; existing variant fixture tests updated without weakening prior behavior assertions.
- `src/features/settings/{AiReportPreferences,EmailSettings}.tsx`, signed preference route and authenticated/oneclick APIs. Control includes loading/empty/failure/retry/busy/success, keyboard-native checkbox and generation guard against stale GET overwriting PATCH.
- `src/server/db/{schema,workerReady}.ts`, readiness tests and additive0017 generated SQL/snapshot/journal. Three narrow tables plus observation/history indexes; no package/lockfile changes.

## Verification performed

Node22.18.0, isolated local Postgres127.0.0.1:54329, `radar_weekly_report_eng_20261110`.

```
PATH=/Users/ekene/.nvm/versions/node/v22.18.0/bin:$PATH \
DATABASE_URL=postgres://postgres@127.0.0.1:54329/radar_weekly_report_eng_20261110 \
RADAR_DEV_STUBS=1 RADAR_FAILURE_ALERTS=off \
npx vitest run --no-file-parallelism src/server/services/lifecycle src/server/services/visibility src/lib/recommendationShare.test.ts src/server/db/workerReady.test.ts
npm run typecheck
git diff --check
```

Result:18 files /210 tests pass, including30 actual report integration cases,3 actual observation persistence/rollback tests,11 arithmetic/formatter cases and all affected existing lifecycle checks. Typecheck and whitespace checks pass. All external model/mail responses mocked. No broad unrelated suite/build performed; root owns final integration build/suite. Nonparallel files are intentional because production dispatch has a deployment-wide nonblocking advisory lock.

Clean0017 proof: new `radar_weekly_report_clean_eng_20261110` applied18 migrations. Upgrade proof `migration-proof.ts` creates core through0016 in another fresh DB, requires old worker startup rejection, seeds existing completed course/guide/attempted outbox/legacy sender metadata/opt-outs/latest AI result, applies0017, proves all prior17 ledger rows and SQL/journal unchanged, existing rows unchanged, new observation/report tables empty (no invented backfill), current readiness succeeds, explicit report false survives no-op rerun, and0017 snapshot chains0016. Results and exact runtime fingerprint are beside this record. This proof intentionally uses only local trusted Postgres and never starts collectors/transports.

## Integration instructions and limits

Cherry-pick the freeze commit onto root's released core follow-up branch, retain all current main fixes, apply ordinary predeploy0017 before admitting matching web/worker. Readiness requires new fields/indexes and existing guide CHECK before claiming jobs. Keep the current founder sending address/secret/provider configuration; do not introduce original general-mail sender overrides or original plain digest jobs. Operational flag is the existing education flag, already independently managed by PM; no setting was changed here.

Independent QA is a separate pass. Real browser/access/UI/render validation, integrated optimized build/full suite and release operations remain root/QA-owned. True history starts after rollout, so lack of comparable previous-week data is expected and disclosed. A first report requires real collected observations in its preceding completed UTC week and a Monday discovery opportunity; deployment itself does not manufacture data or send everyone a report immediately.
