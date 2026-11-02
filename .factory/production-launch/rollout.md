# Launch rollout — target November4,2026

## Current disposition
Code hardening is tested locally. Production remains main0a9af070 with billingOFF until owner-authorized merge/deployment and provider acceptance. Do not describe local/stub results as live validation. Repository policy requires owner go-ahead before merging auto-deployingmain. No migration was added.

## Completed safeguards
Auth throttling/input limits, atomic browser-bound Google state, signup conflict recovery and hydration readiness; retry-safe$1credit; bounded Stripe calls; accurate policies and trial price; strict per-hop/public-DNS-pinned crawler/publishing requests; production stubs disabled; shared SSE polling and finite DB checkout; readinessAPI; patched PostCSS (runtime audit zero). SharedS3 production configured.

## Deployment procedure
1. Review/merge production-launchPR only after owner go-ahead. Main auto-deploys web+worker; web predeploy runs existing idempotent migrations.
2. Reconcile Railway deployed healthcheck from/privacy to/api/health; actual config settings may override railway.web.json. Runtime support inbox= support@thally.io on both services; do not change sender identity without verifying its existing domain. Retain APP_URL=https://radar.thally.io, stubs0 and billingOFF through code rollout.
3. Confirm both servicesSUCCESS for exact mergedSHA; GET/api/health=200, public policies/contacts, signup/signin/Google return, saved profile/job completion, file upload/read across services. Monitor DB connections, oldest queued jobs/errors, provider402/429/5xx, memory and response latency. This app has no separate production staging environment established by this task.
4. Recheck real sandbox payment/3DS/credit/webhook/portal evidence. Confirm Google OAuth verification and real supported connectors with owner-controlled accounts. No test means no pass.
5. Paid-gate activation is separate: owner account first, thenRADAR_BILLING=on on BOTH web/worker. Existing owner decision grandfathers current accounts: setRADAR_BILLING_GRANDFATHER_BEFORE to the actual flip instantISO on both before activation. Read back values securely; restart both; verify an existing business stayscomplimentary and a new account receives trial. Do not turn gateon while provider/payment acceptance is blocked.

## Backup and capacity boundaries
Owner explicitly keepsHobby and will arrange private backup destination. Native Railway snapshots/schedules are unavailable on this plan (API rejection). Immediate owner-only local productionpg_dump was restored successfully into network-isolated disposablePG18 and checked against source counts. It is not scheduled/offsite recovery. Seeqa/backups.md.

Final productionbuildfQAS3QW-qLMiPPO_ayayr local200unique accounts/businesses+200SSE:155.2GET/s,p95~125ms,zeroerrors. This covers sparse readonly data on localmachine/Postgres; excludes signupCPU,200onboarding jobs,AIquotas/paidcost,realpaymenttraffic andRailwaycapacity. LiveDBmax100connections; atmost10perweb/workerprocessbydefault, reserveadmin/migrationheadroom. Do not raise workers beyond providerquota/cost capacity; default4jobs atonce.

## Rollback
Restore prior successful Railway web+worker deployments if core smoke fails; no schema rollback required for this changeset. Billing gateOFF reopens app access but DOES NOT stop existing Stripe subscription charges. Cancel/refund actual subscriptions through Stripe only with appropriate user intent. PreserveRADAR_SECRET_KEY and backupsecrets. Rollback support/healthsettings separately if changed.
