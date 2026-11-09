# Independent #28 follow-up acceptance

Read shipping/architecture.md and weekly-report-assessment.md before runtime handoff. Core production evidence remains separately scoped. Implementation is in the isolated radar-email-weekly-report worktree; QA does not edit implementation or the original checkout. All writes/tests below are on a fresh local QA database with fake provider/collection responses. No paid collection, customer email or production account mutation.

## Data and report truth

- Fresh schema and core0016→0017 upgrade/no-op: prior SQL/hash/journal/history/prefs/encrypted mail/sender metadata unchanged, exactly the approved three tables/indexes added, no historical observation or mail backfill. Old schema readiness fails before jobs/cron/collect; current schema succeeds.
- Existing real collection boundary appends success and latest-cell update atomically. Rollback cannot leave one side. Failed collection appends not-collected, preserving actual latest-state behavior without cloning old successes into a fresh day. Preserve provider concurrency/access/reporting.
- UTC midnight and Monday08 boundaries; only seven completed days included. Multiple same-day observations use the latest success once per day/cell; failure/missing are not zero visibility. Exact numerator/denominator and previous-week percentage-point comparison. No prior observations means unavailable comparison. Prompt-set change uses one current series and cannot mix historical series. Frozen period does not shift on Tuesday dispatch.
- No-data, first-comparison, no-miss, biggest-miss, saved proposed topic and absent/advanced/deleted topic branches have truthful copy. Collector may create one deterministic proposed idea for the weekly miss, with no invented volume/difficulty/approval/draft/publication. Existing topic mapping is reused; concurrent collectors do not duplicate it.

## Finite source, dispatch and scheduling

- Monday>=08UTC only new capture; no Tuesday retrospective capture. Missing preference defaults on; stored false, operational flag off, guest, unverified, inactive source, owner/member mismatch and changed owner/recipient suppress. Current Owner membership and verification are rechecked before send and after suppression network lookup.
- Concurrent collectors produce one stable business/window/owner lifecycle key. Separate hourly scan mark cannot count as delivery; >100 empty/old-series candidates cannot starve a later valid candidate. Same-hour pages progress, next-hour ready data can be discovered, and no Monday scan creates a Tuesday backlog.
- Priority essential→weekly course→report→guides→founder→work. Strict rolling24h account cap/daytime covers owned businesses. Least-recently-accepted/never-sent business fairness across weeks. Queue under cap, never burst or bypass if business count exceeds slots. Course progress remains unchanged by report acceptance.
- First attempt expires by next Monday08UTC; bounded23h/MAX8 after an ambiguous request. Same complete envelope, founder identity, signed footer and provider key on retries. Current-series mismatch stops old period. Before attempt, an advanced topic drops only topic-dependent instructions while frozen figures/period remain; after attempt inapplicability stops rather than rewrites. Sent rows never POST again.
- Independent report preference and disable token affect neither education/work nor essential/Autopilot operational mail. Uncertain suppression lookup defers without firstAttemptAt; exact restricted key fallback only; suppression/opt-out/source change during lookup stops POST.

## Real local browser

- Ordinary Owner/Admin management with selected-business mismatch, refresh/persistence and mobile keyboard controls. Viewer/foreign mutation denied. Access states retain usable account preference management.
- Signed public GET is nonmutating. Normal disable form and RFC8058 one-click POST work without paid sign-in, require the exact owner-bound purpose token, reject malformed/oversized/ambiguous fields/hostile origin, and become invalid after ownership change. Category independence and privacy headers.
- Actual rendered Review all answers CTA selects its fixed business/AI section through sign-in. Foreign/deleted source returns404 without selected-cookie mutation. No arbitrary redirect, GET generation/approval/payment/Autopilot enablement or token leakage.
- Actual formatter/rendered family#28 variants retain founder/no-H1/no fabricated result semantics and working catalogue references. Exercise no-comparison, no-miss, no-topic and proposed-topic cases. Browser failure handling and reload reflect persisted values.

Final evidence binds exact integrated source/build and fresh QA DB to developer tests independently rerun, newly derived cases, migrations/readiness, real browser and render results. PM owns production follow-up deployment and supplies hosted proof; no all-emails-live claim until matching web/worker/schema/config and actual registration are verified. Natural future weekly delivery needs real observations; do not fabricate or accelerate production history.
