# Rollout and rollback

## Deployment requirements

1. Apply migrations using `npm run db:migrate` (0010 adds businesses.autopilot and publication provenance); existing businesses default off. Apply before restarting the web/worker code that selects these columns.
2. Deploy matching web and worker revisions. The persistent worker registers `autopilot.run` and the coordinator cron; the web process alone does not run the marketing program continuously.
3. Retain existing tenant billing gates and configure publishing destinations. Social sending additionally requires RADAR_SOCIAL_PUBLISHING for the business and live X/LinkedIn connections. Unsupported channels/comments become owner handoffs.
4. Configure RESEND_API_KEY and MAIL_FROM for real owner emails. Without Resend, sendMail uses the existing logged outbox behavior; no mail delivery is implied by the local QA logs.
5. The owner enables Settings → Autopilot for each business. No migration or rollout automatically enables customer businesses. Monitor last check, error/summary, jobs and outbox delivery status.

## Rollback

Turn off the affected business's master Autopilot setting first. This revokes pending autonomous work and leaves manual work/independent legacy automations intact. A provider request already underway may complete. Keep additive schema columns during an application rollback. Do not restore older workers while leaving master-autopilot publication rows eligible without the new authorization gates.

## Current delivery boundary

Local implementation and isolated verification only. No production migration, deployment, real customer activation, or external posting/email has been performed for this task.
