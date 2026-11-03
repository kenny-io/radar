# Launch readiness checkpoint — November 3, 2026

This checkpoint supersedes older launch records where they describe billing as off or PR20 as unmerged. It does not retroactively turn unrun checks into passes.

## Verified current production

- Web and worker both successful at `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` (PR24); web deployment `8a979ad1-0ead-4ce1-b10f-dc1e3da82b52`, worker `73105fc8-3065-4866-9dac-73e22a56fff8`.
- `/api/health` returns200 with `{ok:true}`. Public legal/feature/blog/SEO delivery and prior load/Stripe evidence are recorded in the earlier feature records.
- Billing is ON, stubs0, sender `Radar <radar@thally.io>`, service support `support@thally.io`, configured sending and encryption credentials. Current active-owner aggregate: two active business owners, both complimentary, none without access. All50 jobs recorded in the prior24h are done. Read-only aggregate checks only, no account or billing mutations.
- Thally sending domain is verified and sending enabled. Shared Resend plan has50,000 monthly sends and10requests/second;338 used before this feature's two simulator messages. Code-rendered Radar templates use the existing verified sender and preserve unrelated hosted Thally templates.
- All five project XML sitemaps are successful in Google and Bing. For Radar,11/12 requested Google pages and12/12 Bing pages accepted. Accepted requests do not guarantee indexing. Remaining follow-up across projects is paused for locked browser access, per the indexing record.

## New email release

Ten events are implemented on `kenny/lifecycle-emails`, with encrypted durable payloads, transactionally persisted triggers, duplicate protection, bounded retries and stale-notice suppression. Password recovery adds hashed single-use one-hour tokens and full session revocation. The founder check-in is a one-time service support note with an optional-email opt-out; this is not a launch campaign or historical-user backfill.

Actual application transport accepted and Resend marked delivered two controlled simulator messages (welcome/reset). No human recipient or production customer was contacted. Human inbox placement remains unverified. Production does not yet contain this feature; migration0009, source deployment and live post-deploy smoke require the reviewable PR and owner approval before auto-deploying main.

## Before a broad announcement

- **Scheduled private offsite backup:** still awaits the owner's destination. The prior actual Postgres snapshot restored successfully locally; that is a recovery drill, not an automated offsite policy. Hobby remains unchanged as instructed.
- **Google OAuth public availability:** earlier work did not prove public consent/Search Console sensitive-scope verification for users outside the allowed test group. Confirm Google Cloud consent status before promising universal connection access.
- **External monitoring:** an ongoing external uptime/worker-failure alert destination was not established by this work. A passing deployment healthcheck alone does not supply alerting.
- **Provider capacity:** prior OpenRouter account credit was exhausted; Anthropic fallback passed. Funding/primary-provider capacity has not been re-established in this checkpoint. The prior200-session local read/SSE benchmark does not prove200 simultaneous analyses or Railway capacity.
- **Real inbox receipt:** simulator delivery passes. Check one owner-controlled real account after authorized rollout to establish that welcome/reset arrive where expected.

Search-engine indexing can continue after announcing; crawl/index inclusion timing belongs to the engines. Remaining Lived fetch failures concern another project and are not a Radar launch result. Do not change billing, grandfathering, provider ownership, permissions or spend as part of this release.
