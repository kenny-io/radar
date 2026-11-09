# #28 source dependency assessment (before implementation)

Read-only product inspection2026-11-10. Core branch inspected at `ebd34ae840b538adf80910a8af3a8e27143978aa`; PM owns subsequent main integration/core release. Original dirty checkout `/Users/ekene/Downloads/design_handoff_radar/radar-push` remains at HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` with extensive unrelated dirty work. No original files/staging/database/provider calls changed. Companion records read: companion-report-copy.md, founder-voice-companion.md, no-headings-companion.json and original measurement source/design records. Implementation will use a separate `kenny/email-weekly-report` worktree after approved architecture, leaving the shared core source frozen.

## Findings

Current integrated core contains latest-state `ai_results` and existing nightly measurement jobs, but none of `ai_observations`, report history, report preference, formatter or report trigger. Historical weekly denominators cannot be reconstructed truthfully from those latest-state rows. Collection must begin appending real observations after an additive migration; no invented historical baseline/backfill.

Original `visibility/digest.ts` registers `visibility.weeklyDigest` Monday after08UTC and a `visibility.digest` job. It sends each active business owner's report only when current-window collected answers exist. Event identity is `visibility-weekly:{businessId}:{exclusiveWindowEnd}:{ownerId}`. `cron_marks` and job insertion are atomic; jobs freeze recipient, subject, text, HTML and optionally sender. Explicit stored visibility_preferences.weekly_email=false is respected; missing preference means on. Its old sender path lacks canonical emailVerifiedAt, lifecycle cap/daytime/provider suppression/oneclick and safe23-hour attempted retry fencing; copying it as-is would regress the approved mail boundaries.

Report summary depends on pure `lib/recommendationShare.ts` (latest successful per UTC day/cell, current prompt series,7 completed UTC days and comparable prior7), append-only `ai_observations`, and a current prompt-series hash. `history.ts` also combines unrelated aggregate-study consent and optional proposed-topic mapping. `digestContent.ts` is pure except type-only history and founder constant imports; actual reviewed/no-H1 copy can be preserved. It conditionally promises a saved proposed topic only when a real mapping exists; missing topic is a valid reviewed variant.

Original `0009_recommendation_share.sql` collides with deployed canonical0009_signup_security and bundles public_checks/research consent alongside measurement tables. It must not be imported wholesale or renumbered over existing migrations. Original package/lockfile changes are unrelated; report integration needs no new dependency.

## Proposed bounded contract for architect approval

- Append0017 on the integrated0016 ancestry, limited to actual observation/report preference state (and topic mapping only if explicitly approved). Preserve earlier SQL/journal/checksums. No fake historical rows, production preferences import or auto-enrollment migration sends.
- Add append-only observation writes to existing visibility collection, capture series and exact UTC measurement day, preserve failed/uncollected semantics. Reuse pure daily/weekly arithmetic and focused tests.
- Keep #28 distinct from the finite education course/guides. Use a dedicated optional `ai_weekly_report` variant in the existing encrypted lifecycle outbox, rather than a second transport with weaker guarantees. Snapshot summary/body/subject/current verified recipient/sender/preferences and stable business-window-owner event key; never rerender or rekey attempted content. Recheck owned source/current recipient/verification/preference before POST and after network suppression lookup. Preserve existing23-hour/MAX8 and provider idempotency.
- Per-business report preference remains separate and default-on, with recorded false preserved. Signed purpose-scoped manage/disable plus RFC oneclick and authenticated account-accessible management must not require a paid workspace. No mutation on GET. No research consent implied by report enrollment.
- Reuse shared optional24-hour cap, daytime, lock and provider suppression. Architect must settle report priority, pending-window expiry/catch-up, per-account multi-business fairness, operational flag and prompt-series-change relevance. No new opt-in prerequisite; actual collected data remains required.
- PM-owned formatter keeps founder voice/no-H1 and needs a fixed business-bound guarded review URL into AI Visibility, avoiding arbitrary currently selected business. Auth/access gates remain intact.

## Proposed file ownership

Engineer: `src/lib/recommendationShare.ts` +tests; report history/collection integration under `src/server/services/visibility`; `src/server/services/lifecycle/{queue,dispatch,engagement,preferences}` plumbing as required; report preference API/management control; `src/server/db/{schema,workerReady}`; additive0017 and generated metadata; focused actual-DB/mock-provider tests; shipping evidence.

PM: reviewed report copy/formatter and catalogue/previews, plus any shared renderer copy/contract modifications by explicit handoff. No concurrent template edits. Architect: final scheduling/data/preference/retry contract. QA: independent DB/browser/transport proofs. Root: integration/release operations. No lockfile/package dependency change proposed.

## Baseline performed

Original six focused mocked/pure files: digest, digestPreferences, history, digestContent, digestSender and recommendationShare:42/42 pass using Node22.18.0 and fake mail responses. This proves the local companion baseline only, not production readiness or integrated real-DB boundaries.

No runtime implementation is authorized by this assessment alone; awaiting approved architecture. No merge/deployment/flag/real send was performed by this specialist.
