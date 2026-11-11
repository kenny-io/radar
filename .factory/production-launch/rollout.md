# Launch rollout — target November 4, 2026

## Current disposition

PR20 contains tested launch hardening. Production remains main `0a9af070` with billing OFF until owner-authorized merge/deployment. Existing repository policy requires owner go-ahead before merging auto-deploying main. No migration was added. Local/stub results are distinguished from actual sandbox and production evidence.

## Deployment procedure

1. Review and merge PR20 after owner go-ahead. Confirm both web and worker deploy the exact merge SHA; web predeploy runs the existing idempotent migrations.
2. Reconcile Railway's deployed healthcheck override from `/privacy` to `/api/health`. Set runtime SUPPORT_INBOX to `support@thally.io` on both services. Preserve verified sender `radar@thally.io`, APP_URL `https://radar.thally.io`, development stubs OFF and billing OFF during the code rollout.
3. Confirm `/api/health` 200, public policies/contacts, signup/signin/Google return, saved profile/job completion and cross-service object storage. Monitor DB connections, oldest queued jobs/errors, provider 402/429/5xx, memory and response latency. A separate production-equivalent staging environment was not established by this task.
4. Review final actual sandbox payment/3DS/credit/webhook/portal evidence. Complete owner-controlled Google/Search Console consent and supported-connector checks. Verify real email receipt and an ongoing uptime monitor. Unrun checks are not passes.
5. Paid activation is separate. First gate an owner account, then set RADAR_BILLING=on on BOTH web and worker. To honor the existing grandfather decision, set RADAR_BILLING_GRANDFATHER_BEFORE on both to the actual activation instant in ISO format. Securely read back and restart both; verify an existing business stays complimentary and a new account receives the trial.

## Backup and capacity limits

The owner explicitly keeps Hobby and will arrange a private backup destination. Railway rejected native snapshots/schedules on this plan. An immediate production pg_dump restored successfully into an isolated local PostgreSQL 18 database and matched source aggregate counts; it is a manual local recovery point. See `qa/backups.md`.

The local production benchmark covers 200 unique authenticated sessions plus 200 SSE connections and mixed sparse-data GETs. It excludes signup CPU, simultaneous paid analyses, external provider quotas, payment throughput and Railway capacity. Live Postgres permits 100 connections. Default pools use 10 per web/worker process; reserve migration/admin headroom before scaling replicas. Default worker concurrency is four; do not increase it without provider quota/cost evidence. OpenRouter needs account funding; verified Anthropic fallback is currently working.

## Rollback

Restore the prior successful Railway web and worker deployments if core smoke fails. This changeset requires no schema rollback. Billing OFF reopens application access but DOES NOT stop existing Stripe subscription charges; cancellation/refunds need their own appropriate user intent. Preserve RADAR_SECRET_KEY and backup secrets. Restore support/health settings separately if they were changed.
