# Autopilot

User problem: Radar has separate marketing workflows that require the owner to keep initiating and approving work. The owner wants one switch that delegates execution and emails only work Radar cannot perform.

Scope: per-business Owner-controlled Autopilot, off by default; coordinate existing calendar, article, social and Daily Brief services; create/extend a calendar without replacing existing work; draft and publish supported content at business-local times; handle supported social actions through existing adapters; email owner manual actions (including Reddit comments), missing connections and failures. Existing search/visibility jobs and separately opted-in backlink workflows continue. Never enroll a business into the reciprocal backlink network automatically.

Experience: Settings → Autopilot in the Content category, using existing Section/Row/Status/Btn styles. One accessible switch with explicit copy explaining autonomous publication; Owner controls, read-only status for other roles; saving and error states; current status, last run summary and owner-email destination; link to connections and existing calendar/social frequency controls. Existing publishing and social settings must explain Autopilot when active. Mobile stacks the existing rows.

Acceptance:
- AC1: Each business has independent Autopilot settings, activation, accounts and execution history. A multi-business owner can enable one business and leave another off; the selected business is explicit in Settings. Only the business Owner can enable/disable; defaults off, persists and is tenant-isolated. Toggle enables execution immediately without another approval gate.
- AC2: Enabled program is durably scheduled and resumes through the worker. It uses business timezone and saved frequency; repeated ticks/retries do not duplicate calendars, packs, posts or handoffs.
- AC3: Create a content calendar if none exists and replenish forward coverage while retaining existing entries and user edits. Draft and schedule/publish due articles through existing connectors and validation.
- AC4: Generate daily social posts; choose a current useful slot or a future slot, publishing only supported platforms with valid connected accounts. Preserve manual publication choices and existing preferences.
- AC5: Process today's actionable Daily Brief using supported posting/reply capabilities; email owner manual actions with reason, actionable link and prepared text. Missing/expired accounts and final failures reach the owner. No unsupported action is marked posted.
- AC6: Disable stops future program actions, including queued autonomous publications from earlier activations. Manual schedules and legacy independent automation remain intact; externally in-flight publication may finish.
- AC7: Settings explains scope and status accurately; accessible controls, busy/error handling, desktop/mobile browser verification.
- AC8: Billing, deployment feature flags, existing account routing, preflight and publication deduplication continue to apply; cross-tenant and non-owner requests are refused.

Delivery: implement and verify locally in current checkout, preserving extensive pre-existing dirty work. No production deployment or activation of a real customer business is requested. Add migration and rollout instructions.
