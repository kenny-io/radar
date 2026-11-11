# Homepage FAQ accuracy refresh

User asks to align homepage FAQ with current Radar features, specifically automatic writing/publishing of blog and social posts, plus other stale claims. Copy-only change on `kenny/homepage-faq-refresh`, based on current `origin/main` `29c3fe36` (includes homepage PR18 and billing PR17). Preserve unrelated homepage release records and tsconfig drift.

## Acceptance

- F1: Explain review-first default versus acknowledged Daily autopilot for blog writing/publishing; connected destination and schedule required.
- F2: Explain separate Social Marketing Automatic generation, Save to library versus Schedule posts; enabled publishing workspaces can automatically schedule connected X/LinkedIn posts for next day, without another approval. Do not imply enabling blog autopilot enables social automation.
- F3: Explain platform/availability limits, manual community replies and X Reply now opening the native reply box. Personal reply mentions default to when someone asks for a recommendation, with disclosure; Reddit drafts contain no links. No blanket claim that default replies never mention the business.
- F4: Distinguish blog publishing pause from social generation and existing social schedules. Explain ten blog connectors/GitHub PR step, nightly AI checks with unavailable vs not-mentioned distinction, optional GSC with up to16 months available history, optional disclosed backlinks with manual or rule-based auto-approval and weekly checks.
- F5: Preserve approved $50/month,3-day trial,$1 credit policy; describe account-wide plan and current Stripe self-service accurately. No billing or feature-flag changes. Billing enforcement remains off by owner decision; this refresh does not change the published offer.
- F6: Correct adjacent homepage approval-only statements so they agree with FAQ: comparison, trust, integrations, inclusion copy and How it works note. Avoid promising exactly30 suitable topics/month for every cadence. Preserve design, owner-swapped hero/closing, feature pages, routing and demo functionality.
- F7: Concise natural copy, accessible native details/summary; desktop/mobile FAQ expansion, keyboard focus, no overflow, typecheck and source evidence review pass.

## Product truth / evidence

- Blog: src/server/actions/publishing.ts applyMode; services/drafting/jobs.ts canAuto/runDue; services/publishing/jobs.ts scheduler. Review default; Daily autopilot requires acknowledgment. Blog pause holds publishing; drafting continues.
- Social: src/server/services/social/auto.ts; publish/schedule.ts autoSchedule; features/social/AutoModal.tsx. Separate auto-generation and auto-schedule opt-ins, next-day send, connected live accounts. Turning generation off does not cancel already scheduled posts.
- Replies: src/lib/constants.ts BRIEF_DEFAULT mention=asked; services/brief/draft.ts; features/brief/DailyBrief.tsx; lib/socialPublish.ts xReplyIntentUrl. Replies are manual; X uses its native box.
- Live configuration was read only through a filtered nonsecret projection: social publishing is a limited rollout; X and LinkedIn profile apps configured; LinkedIn page app not configured. Explain capabilities with workspace connection availability rather than obsolete rollout-history wording or universal availability. Never expose identifiers or secrets in copy/records.
- Billing: lib/billing.ts; server/billing/activate.ts; features/billing/BillingSettings.tsx and overviewCopy.ts. One account subscription covers all owned businesses; Stripe portal handles cards/invoices/cancellation; $1 is credited, not refunded.
- Other: services/gsc/sync.ts backfill; visibility/jobs.ts + collect.ts; backlinks/jobs.ts and matching.ts165,233 plus features/backlinks/Backlinks.tsx112 (optional rule-based auto-approval, can still decline); publishing/connectors/nextjs.ts opens PR, merge publishes.

Delivery: update and verify local preview on :3901. Commit/PR/production release of this follow-up has not been requested yet; existing release authorization applied to PR18.

Release authorization: the owner subsequently said “ship it,” authorizing a scoped commit, PR and guarded merge with the automatic Railway production deployment. Independent read-only production verification follows deployment.
