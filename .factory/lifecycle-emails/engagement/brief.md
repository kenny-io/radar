# Useful work updates

Extend PR25's durable lifecycle transport with optional emails that bring owners back to completed or pending work: Daily Brief conversations worth joining, a content plan awaiting approval/scheduling, a generated article that can become social posts, and social content still awaiting scheduling or posting. No repetitive workspace notice, generic reactivation campaign, invented results, or change to billing/recovery.

The owner confirmed35% is an internal target, not measured performance. Do not promise numerical uplift or describe it as an individualized forecast.

## Resolved experience

Use the existing email design (crisp actual logo, compact CTA and plain language). Collect nearby events into one actionable work update, including up to3 sections, rather than mailing for each article or scan. Each section names its business and points to the actual relevant feature. Show no empty sections. Users explicitly choose Daily Brief updates, calendar reminders and article-to-social suggestions in Settings; all new categories start off, without historical backfill. Each optional work email provides a free opt-out, leaving security and billing enabled.

Conservative starting policy: at most one work update per rolling24h per owner across their businesses, business-local daytime9–18, wait one hour after a brief run without a copied/posted reply, calendar wait24h and send once per generated plan, social wait2h and send once per article despite generation/approval replays. State is rechecked before sending, so acted-on/expired/inaccessible work is dropped. Final architecture records exact timings/contracts and safe deferral behavior.

## Acceptance criteria

- EN1: Successful Daily Brief runs with actionable reply conversations that remain unengaged for one hour produce an eligible owner update; any copied/posted reply suppresses that run; empty/failed/expired/rescan replay outcomes produce no duplicate mail.
- EN2: A generated content plan still awaiting approval/scheduling after24h creates one reminder per plan. Publishing/approval resolves it. No35% result promise.
- EN3: A newly generated/approved real article creates one suggestion to reuse it for social posts; existing social pack, deletion, ungenerated topic or duplicate event prevents mail. A separate social-pack follow-through reminder waits24h and is suppressed once any post in that pack is scheduled/posted (or copied where supported).
- EN4: Related work is grouped with a per-owner cross-business daily cap, useful time window, dedupe and expiry. Jobs do not send provider requests. Retry behavior preserves existing provider idempotency.
- EN5: Explicit per-category settings, persisted consent time, optional-email opt-out and send-time preference checks; no historical broadcast. Authentication, owner access and tenant checks apply.
- EN6: Correct deep links select the named business and relevant feature. Mobile/desktop rendering, keyboard settings, loading/save/error/refresh and safe preference GET/POST are independently checked.
- EN7: Existing welcome/founder/recovery/billing behavior remains intact. Additive migration only; no new service/dependency, live recipient send, account/billing setting mutation, merge or deployment without existing owner go-ahead.

Deliver to existing kenny/lifecycle-emails PR25. PM owns copy/templates/preview integration and records; architect defines contracts before dependent implementation; engineers own agreed backend and settings modules; independent QA verifies integrated behavior.
