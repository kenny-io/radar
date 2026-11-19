# A7A implementation handoff — YouTube automatic publishing

Implementation complete in the shared generated-media worktree, starting revision `40e0f092a73a54fed0bc826208e46f1af024d21e`. No commit, merge, deployment, production preference edit, credential read or public provider post by this engineer. PM/QA records were preserved. Independent acceptance remains a separate pass.

## Implemented behavior

- Owner-only `social.youtubeDefaults` accepts explicit visibility and required boolean audience, validates a live same-business local YouTube account, and serializes expected-version saves against reconnect/clear. Identical nonempty saves retain version; clear/material change/reconnect/A6 scrub rotate it. No provider identifiers are stored in defaults. Routine token refresh preserves choices.
- Editor ordinary `social.auto` saves preserve the latest database Owner fields under business lock. Normalized workspace projection hides malformed choices. Saving choices does not select YouTube, enable drafts, change post mode, enable master Autopilot, enqueue or backfill.
- Existing Social draft settings contain empty Visibility/Audience selectors, Owner Save/Clear, current account label, Connect/Reconnect, failure/reload states, explicit Public summary, and read-only Editor/Viewer saved state. The Autopilot settings link reaches it. YouTube-only live channels qualify for ordinary Schedule posts setup; TikTok remains per-post privacy/consent.
- New auto-created YouTube posts snapshot eligible defaults and local provenance; manual posts get an editable grounded title without inferred visibility/audience. Reviewed plan.topic updates only the unchanged generated title using options revision captured at Prepare. Human options/title edits clear standing provenance and survive attachment.
- Master and standalone scheduling use the existing resolve/preflight/write pipeline. Fresh in-transaction business/account/default version/platform/day/time/mode checks authorize YouTube only; existing publication history, A6 holds/noResend/approval and pending media remain protected. Missing/stale choices leave drafts with an Owner setup handoff; other platforms continue.
- Scheduled rows retain a local authorization snapshot through sender payload updates. Before a NEW automatic upload, the final provider boundary rechecks current standing choices and mode. Pause/clear/version change blocks init. Already accepted refs continue status observation after defaults clear/master pause, with no second init. Explicit manual publishing/scheduling sheds the standing dependency while retaining A6 predicates.
- Required integration fix: both Prepare and Generate admission take scoped business FOR KEY SHARE before publication/pack/generation locks. Actual concurrent admission/A6 scrub tests observe PostgreSQL lock blocking then both transactions complete without deadlock.
- Required context fix: bounded per-pack voice notes enter planning and both reviews as presentation direction, separate from claim evidence and subordinate to hard source/generation rules. Renderer, captions, paid cache and style presets were not changed.

## Verification

Node22; synthetic local PostgreSQL only. Initial broad check on the older shared fixture database exposed an expected YouTube setup-link assertion change, A6 automatic-hold admission ordering and aggregate report contamination by concurrent fixtures. Updated the setup assertion to the approved deep link, restored A6 history refusal before default admission, and reran in a freshly migrated isolated database `radar_media_a7a_tests` with file parallelism disabled. No useful lifecycle assertion was removed.

- 11-suite integrated pass: 177/177, including A6 retention, multiplatform/TikTok publishing, real media pipeline, master Autopilot and existing social publishing.
- Additional 8-suite pass: 91/91, including OAuth/lifecycle, timeline, durable media job recovery, shared channel rules and reverse-proxy origin route.
- Final focused run: 37/37 passed (`/tmp/radar-a7a-freeze.log`): 25 actual DB race/settings/accepted-ref cases, 11 pure normalization/title cases and one planning/review prompt-capture case.
- Full `tsc --noEmit`: clean. `git diff --check`: clean.
- Actual localhost headless browser: 7 checks passed with no page errors: empty explicit choices, Owner save with false persisted, Editor/Viewer readonly saved choices, Public summary, Clear/setup-required state and 390px no horizontal overflow. Screenshots: `/tmp/radar-youtube-auto-settings.png`, `/tmp/radar-youtube-auto-mobile-controls.png`; script `.data/media-ui/youtube-auto.mjs`. Local server 3861 stopped after smoke.

Test env runner `/tmp/run-radar-a7a.mjs` loads whitelisted synthetic env from ignored `.data/media-ui-a7a-env.json` and runs Node22 Vitest. Logs: `/tmp/radar-a7a-regressions-final.log`, `/tmp/radar-a7a-additional.log`, `/tmp/radar-a7a-freeze.log`; typecheck `/tmp/radar-youtube-a7a-tsc-final.log`. Real provider init is replaced with an adapter that executes the same beforeCreate boundary and records exact title/privacy/audience. Title-attach race tests mock narration/render while using actual durable DB preparation/attach transactions; the unchanged renderer also passes its real pipeline regression.

## Integration and remaining limits

No migration or new credentials/scopes. Preserve all A6 cleanup/token/pending cutoff guards, noResend/needsApproval predicates, plus mediaRevision/pending/ordered-slide guards when integrating later changes. AutoMode main switch stays off unless the Owner chooses it. Existing auto posts/schedules are not rewritten or silently reauthorized by saving defaults. Clearing choices stops future unstarted automatic YouTube uploads; it does not delete remote videos or remove accepted tracking.

No real public YouTube init, real reconnection, paid speech or fresh paid render was performed for this A7A pass. PM owns production provider/demo verification and delivery. Five selectable styles are a subsequent phase. Current phase retains the approved drawing renderer.

## Working-tree fingerprint

HEAD: `40e0f092a73a54fed0bc826208e46f1af024d21e`

24 source paths, SHA256 manifest fingerprint `71ced612e480ffe4750bd06d7282ad4bc9cb5ba72d5da8a55381c2080c308432`. Manifest `/tmp/radar-youtube-a7a-fingerprint.json`.

Changed source paths:

- `src/features/settings/AutopilotSettings.tsx`
- `src/features/social/AutoModal.tsx`
- `src/features/social/SocialMarketing.tsx`
- `src/features/social/YouTubeAutoSettings.tsx`
- `src/lib/types.ts`
- `src/lib/youtubeAutomation.test.ts`
- `src/lib/youtubeAutomation.ts`
- `src/server/actions/index.ts`
- `src/server/actions/social.ts`
- `src/server/actions/socialPublish.ts`
- `src/server/actions/youtubeDefaults.ts`
- `src/server/services/autopilot/autopilot.db.test.ts`
- `src/server/services/autopilot/run.ts`
- `src/server/services/social/generate.ts`
- `src/server/services/social/media/index.ts`
- `src/server/services/social/media/model.ts`
- `src/server/services/social/media/planner.context.test.ts`
- `src/server/services/social/media/planner.ts`
- `src/server/services/social/publish/schedule.ts`
- `src/server/services/social/publish/send.ts`
- `src/server/services/social/publish/youtubeAutomation.db.test.ts`
- `src/server/services/social/publish/youtubeAutomation.ts`
- `src/server/services/social/publish/youtubeRetention.ts`
- `src/server/workspace.ts`
