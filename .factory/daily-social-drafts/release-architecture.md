# Daily social drafts: release architecture review

Read-only review on November 9, 2026 (Dubai). Original checkout remains `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, HEAD `f9eb6178`, with extensive unrelated local work. PM reports explicit user authorization to deploy this feature. Architect made no Git, infrastructure, configuration, database or publication mutations.

## Production baseline

`railway status --json` confirms project `radar`, production environment, GitHub source `kenny-io/radar`, branch `main`:

| Service | Deployment | Status | Commit |
|---|---|---|---|
| web | `a290ce75-4e95-4993-977d-3fc7ed160ad0` | SUCCESS | `13f0697321302b2cc47384eb58520950c342985c` |
| worker | `a08e0c7b-06d2-4859-ab3a-d1245072e894` | SUCCESS | `13f0697321302b2cc47384eb58520950c342985c` |

This is also the inspected local `origin/main`. Confirm the remote is still current immediately before release. Web uses `npm run build`, existing `npm run db:migrate` predeploy, `npm start`, and `/api/health`. Worker uses `npm run worker`, starts the existing durable queue and minute scheduler, and has restart policy ALWAYS. Both are one replica in the same Railway region. These observations establish the current source/configuration baseline; they are not post-release readiness evidence.

## Feature-only integration

All ten changed production files for this feature are unchanged between original HEAD and inspected `origin/main`: `src/server/workspace.ts`, `src/server/actions/social.ts`, social `auto.ts`, `generate.ts`, `jobs.ts`, and UI `SocialMarketing.tsx`, `AutoModal.tsx`, `PackThumb.tsx`, `PackView.tsx` (nine existing production files), plus new `services/social/proactive.ts` (tenth production file). The three focused test files are also isolated from intervening main changes. The original feature changes can therefore apply as a narrow patch onto current main without architectural dependency on unrelated dirty files.

`docs/CONTRACTS.md` changed independently on main for signup security. Apply only the three social feature additions; preserve main's newer auth contract. Never copy the old full document over main.

Preserve main's newer signup-security, support and GitHub-publishing releases. In particular, do not copy the dirty original checkout's database schema, migration journal/snapshot, package files, environment sample, README, Next config, unrelated feature records or marketing assets. Production main already contains migration `0009_signup_security`; the original dirty checkout has a different uncommitted `0009_recommendation_share`. This feature needs neither. No new migration, dependency, secret or environment variable is required.

Release branch/PR creation, merge and deployment belong to the PM. Use the feature source/tests/contracts/records allowlist; inspect the final diff before commit. The original working tree must remain untouched apart from this feature's established files and records.

## Runtime behavior and safeguards

- Previously unset active-business preferences become daily at 08:00 in each business timezone, using LinkedIn/X branded library drafts. Saved opt-outs/custom schedules/styles/platforms remain authoritative. This intentionally increases AI work for eligible businesses with unset settings.
- Both services must deploy the same new merge SHA. The worker begins ticking shortly after startup and can generate today's overdue drafts immediately, with no UI visit. A short mixed-version deployment window is compatible with the current JSON schema/API; do not call it complete until both services match.
- Cron mark and job insert are atomic. Deterministic `auto-${businessId}-${date}` pack IDs and conflict-safe persistence prevent duplicate stored packs and preserve user edits on retries. Legacy cron marks/packs from earlier in the same day remain authoritative; no forced backfill or deletion is needed. Unstarted previous-day jobs skip rather than generate backlog.
- Existing queue subscription gates remain in place; this feature introduces no billing changes. Confirm worker billing and development-stub modes remain the existing production values, without exposing secrets or changing configuration.
- New default packs create no publication rows. Existing explicit `post:'schedule'` preferences remain intentionally honored. User-operated posting/scheduling and deployment publishing flags retain their existing checks. A source rollout must not change publishing flags/accounts/preferences.
- Source reads are tenant-scoped and bounded. Blog grounding uses cached text, not fresh network requests, and crawl timestamps are never advertised as publication dates. Upcoming calendar topics have no published link or availability claim. Search failure falls back to profile facts. Source/profile strings are treated as data in writer instructions.
- Current code rechecks active/on/platform/current-day/custom-day eligibility before persistence. AI/image work may already have incurred cost when a user pauses during generation, but the final draft is withheld. Rare overlapping worker recovery may duplicate provider work, while database uniqueness permits only one stored daily pack.

## Validation and rollout recommendation

The dirty-checkout integrated evidence is useful but does not replace testing the extracted current-main release tree. Run typecheck, the 30 focused daily/social tests, publishing/UI/billing-skip regression coverage, and a production build on that exact tree. Current main's auth test fixtures now enforce email verification; use its fixtures and do not regress them to the older source. The known raster golden discrepancy may remain a baseline exception, but new failures require investigation.

After merge, confirm both Railway deployments succeed and report the same merge commit; check `/api/health`, public auth entry, and an authorized ordinary user's Social Marketing library/settings. Inspect worker startup/cron/job errors and aggregate queued/running/failed/done `social.autoRun` state. Read-only aggregate verification of default drafts/publication counts is appropriate; do not create real social posts to smoke-test. If a live UI session is unavailable, report that coverage explicitly and use deployed source plus safe runtime/job readbacks; do not claim a live authenticated flow passed.

Do not manually enqueue all businesses to force an immediate result or modify their settings. The deployed scheduler already catches up eligible businesses during their local day. No infrastructure/configuration rollout step is otherwise necessary.

## Rollback and residual risks

Restore both services to their prior successful main deployment if core smoke fails, or revert only this feature on main and deploy both. Preserve user data, preferences, existing scheduled publications, billing state, secrets and the current signup migration. No schema rollback is involved. Already-generated packs remain valid editable user content; deleting them is unnecessary.

Residual risks: increased daily AI/image spend; provider exhaustion/fallback can affect draft quality/availability; no publication-date metadata exists for crawled blog posts; growing social-library retention remains unchanged. Existing records describe an earlier exhausted OpenRouter credit balance and working Anthropic fallback, but this review did not recheck current provider balances or make live model calls. These are operating considerations, not evidence of a release blocker. No architectural integration blocker was found.
