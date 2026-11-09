# Backend handoff — E1

Implemented on `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, starting HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. Existing unrelated edits preserved; no schema, migration, dependency or environment changes.

## Behavior / acceptance
- AC1: Unset automatic settings default to on/daily/08:00/business timezone/LinkedIn+X/branded/library. Explicit saved preferences survive. Cron evaluates all active businesses with merged settings and catches up through local midnight. Existing worker billing gates remain unchanged.
- AC2: Cron mark and queued job are committed atomically. Job `ref` and payload retain the local date. Deterministic `auto-{business UUID}-{date}` IDs, early tenant-scoped lookup and final `ON CONFLICT DO NOTHING` prevent duplicate saved packs or replacement of reviewed content. Old completed jobs return their original pack; unstarted previous-day jobs skip rather than backfill. Runtime checks and a final pre-insert check honor a pause/inactive status/current-day or custom-day change during drafting.
- AC3: Added bounded local grounding from recent published Radar body/metadata, cached business blog text, near-term approved/scheduled topics, keyword/search suggestions, and rotating business-profile facts. Calendar and blog summaries plus recent post excerpts guide relevance and variety. Unavailable article/search sources fall through. Upcoming topics never attach links or claim publication; crawl discovery timestamps never become publication dates. Tenant scope applies to all reads. Writer system instruction treats source/profile/calendar/blog text as reference data and rejects embedded instructions.
- AC4: New defaults create only editable library packs, even with publishing enabled. Existing explicit scheduling opt-in and publication controls remain. Existing manual generator API and progress callback retain compatibility via a fourth internal options argument. URL packs now use their grounded headline as a readable library name.
- AC6 developer evidence below; independent QA belongs to the separate QA agent.

## Files owned/changed
- `src/server/workspace.ts`: `socialAutoOf` only.
- `src/server/actions/social.ts`: reject enabled custom schedules without days.
- `src/server/services/social/auto.ts`: atomic scheduling, immutable dates, runtime guards and proactive generation.
- `src/server/services/social/jobs.ts`: forward job payload date.
- `src/server/services/social/generate.ts`: internal generation options, history/context prompt, stable persistence and URL headline naming.
- New `src/server/services/social/proactive.ts`, `proactive.test.ts`, `proactive.db.test.ts`: bounded source/context selection and behavior coverage.

## Verification performed
Environment: existing local Docker Postgres port 54329, isolated `radar_daily_social_engineer` database, migrations applied, development stubs, billing off; no real AI calls or social publication.

- `npm run typecheck`: passed before and after final changes.
- `git diff --check -- src/server/actions/social.ts src/server/services/social/auto.ts src/server/services/social/generate.ts src/server/services/social/jobs.ts src/server/workspace.ts`: passed.
- `DATABASE_URL=<isolated local DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test -- src/server/services/social/proactive.test.ts src/server/services/social/proactive.db.test.ts src/server/services/social/social.test.ts`: **30/30 passed** (4 policy, 15 DB integration, 11 existing social). Covers atomic rollback/recovery, concurrent ticks and runs, edited draft preservation, old-day retries, profile-only creation, actual Radar text and upcoming context, cached blog naming, source/search failure fallback, cross-tenant isolation, recent-history prompts, settings validation and pause during model work.
- `DATABASE_URL=<isolated local DB> RADAR_DEV_STUBS=1 RADAR_BILLING=off npm test -- src/server/services/social/publish/publish.test.ts src/features/social/channels/logic.test.ts src/lib/socialPublish.test.ts src/server/jobs/billingSkip.test.ts`: **82/82 passed**, including 21 DB publishing tests (legacy auto scheduling and feature-off compatibility) and 2 DB billing-gate tests.
- PM full integrated suite/build and independent browser QA are separate passes, not claimed here. PM baseline reports only the existing OpenRouter raster golden mismatch.

Final implementation fingerprints (SHA-256):
- auto.ts: `8f2b726b8b97271c7513941852d458ca486ef40574a6f9b6e9bb5637a27f9aae`
- generate.ts: `ec211fe8dc8f913dc65edb0e993d07633eaab48428494cca1d546f1a495ad317`
- proactive.ts: `ec76c41a347d2e1cffc08e1ffc8d90b593846dd19d369a4ff38b6958e750ea01`
- proactive.db.test.ts: `cf64c364817f8352fdfb4e539c366a4b25213f6ba8a248a7d0f65a6549d6ed9b`

## Limits and integration
No migration or new environment variables. Restart/deploy the existing worker along with web code when release is authorized. Default-on increases AI usage for active businesses with previously unset settings. Rare overlapping job recovery can duplicate AI/image work, but database uniqueness permits only one stored daily pack. Backlog retention is unchanged. Cached blog publication dates are unavailable. No production rollout or live-model content quality claim is made. Existing auto-schedule choices continue intentionally; new users default to reviewable drafts.
