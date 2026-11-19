# A7A — Owner-configured YouTube automation

Status: bounded implementation contract for PM approval; no code/provider calls or preference changes. Extends the approved generated-media feature to satisfy the original request to automate live posting. Current media worktree `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, base `a8956315d30c64c0427b2c962bbf06f90cb8bf83` plus authorized dirty A7 implementation. Implement only after main/A6 integration; preserve lifecycle/tombstone and newer origin guards. Five later presets are outside this change.

## Gap and decision

Current `createPack` creates no YouTube publishOptions. `autoSchedule` loops only X/LinkedIn/Instagram. Master Autopilot sees YouTube but preflight always rejects its missing title/privacy/madeForKids. Generated YouTube videos therefore never progress to unattended posting. Fix this with explicit Owner-configured future-video defaults and an editable generated title, using the existing master/standalone authorization and publish pipeline. No default visibility/audience is inferred. Generation and draft creation continue without these settings. TikTok still requires fresh per-post privacy/consent/brand choices and is excluded from the new standing defaults.

## Additive persisted contract

Use existing business socialAuto JSON; no migration:

```ts
interface YouTubeAutoDefaults {
  acctId: string; // local Radar account UUID, never an API channel ID
  privacy: 'private' | 'unlisted' | 'public';
  madeForKids: boolean;
  version: string; // server UUID, changes when defaults materially change
}
// SocialAuto.youtubeDefaults?: YouTubeAutoDefaults | null; absent/null = unset.
// SocialAuto.youtubeDefaultsVersion?: string; persists even when defaults cleared.
// SocialPost.youtubeAutomation?: { defaultsVersion: string; acctId: string };
```

Account UUID alone is insufficient if a connection path reuses its row. Every successful YouTube OAuth connect/reconnect MUST clear youtubeDefaults and rotate persistent youtubeDefaultsVersion under the SAME business -> account transaction, even if the UUID/channel appears unchanged. Routine token refresh does neither. A6 disconnect/delete also clears defaults and rotates the version. The cleared state retains its version, preventing an ABA/stale-modal save. This invalidates standing choices conservatively; the owner explicitly saves them again after reconnect. Version and account UUID are local authorization metadata, not API channel identity. No channel ID/name is copied into long-lived defaults. Missing/malformed JSON is unset, never false/private defaults.

New `social.youtubeDefaults` action is Owner-only, input `{expectedVersion:string|null, defaults:null|{acctId,privacy,madeForKids}}`, strict enums and required boolean (false is a valid explicit choice). It locks business, compares expectedVersion to the persisted youtubeDefaultsVersion (initial absent means null; mismatch is409/reload-settings), then validates the same-business connected, unexpired `ch=youtube` account before storing; accept no provider/channel ID. Server supplies both the persistent root version and defaults.version, retaining them on identical save and rotating both on material change/clear; defaults.version must equal root version for automatic eligibility. Update only the nested field; do not replace other automatic settings or master state. Return normalized public defaults. No provider call, posting, preference activation, backfill or automatic retry is caused by saving defaults.

Existing `social.auto` stays at its existing role for ordinary preferences but must preserve database youtubeDefaults AND youtubeDefaultsVersion when saving its full object. Do not accept this nested field as an Editor-writable substitute for the Owner-only action. A stale modal payload cannot erase/revert owner choices; read/update under business lock or use JSONB update preserving the field atomically. `socialAutoOf` and workspace projection expose only validated defaults. No secret/API channel metadata added.

## UI contract

Add `YouTube automatic publishing` within existing Social draft settings (linked from AutopilotSettings). Show the connected channel's current label and these controls:

- Visibility: empty `Choose visibility`, then Private / Unlisted / Public. No option selected initially.
- Audience: empty `Choose audience`, then `Made for kids` / `Not made for kids`. No unchecked checkbox interpreted as consent.
- Owner-only Save choices / Clear choices; Editor/Viewer may see saved state and `Ask the owner to configure YouTube automatic publishing`.

Explain: `These choices apply to future automatically generated YouTube videos. Radar generates an editable title from the explanation. Videos publish automatically only while Marketing Autopilot or your separate Schedule posts automation authorizes it.` Display Public in the save summary when selected; do not invent an additional confirmation flow. Missing/expired channel gives Connect/Reconnect action and no save against another tenant/account. Existing per-post PublishOptions remains editable and authoritative for manual posting.

Configuration does not toggle master, automatic drafts, generateMedia, platforms or post mode. Ordinary Save drafts and generation are valid without YouTube defaults. If automatic publishing is requested while YouTube is selected and defaults are missing/stale, keep other eligible platforms functioning and show a specific `YouTube will remain a draft until the owner chooses visibility and audience` state with setup link. Do not block all drafts or silently set choices to make preflight pass. Include YouTube among live account candidates in AutoModal; a YouTube-only configuration must be saveable. Existing requirement for some live account in Schedule posts mode remains, with accurate channel copy.

Update Autopilot/AutoModal descriptions: eligible YouTube videos use saved owner visibility/audience; TikTok still requires each post's privacy/consent. No claim that a connected YouTube account alone authorizes posting. Standalone pause/master-off meanings remain explicit: master off leaves separate automations/manual schedules alone; missing defaults are a platform handoff, not an operator error.

## Applying choices and generated title

Introduce one small pure helper that returns eligible saved defaults for a business + selected live YouTube account; a second helper applies them ONLY to a newly auto-created YouTube post without prior publication/user choices. Use shared helper in automatic pack creation and ready/scheduling checks, avoiding divergent master/standalone behavior.

During `autoRun`/`createPack` when input.auto is true, snapshot validated defaults/provenance for YouTube. Set `publishOptions.privacy` and madeForKids only if the current account matches defaults. Generate an initial title from the grounded topic/headline, max100characters and no angle brackets. When the reviewed explanation plan exists, use its actual plan.topic as the final generated editable title, still enforcing100characters. This is Radar-generated text; never truncate or rewrite a title entered by a person. Use a title/request revision guard: if the title/options changed since generation began, preserve the user's values and do not rewrite them at attach. A manual pack without owner-selected per-post options receives no standing automatic authorization.

The post's title/privacy/audience appear before publication in existing PublishOptions. Future defaults do not rewrite existing packs, schedules or explicit manual edits. If defaults change during generation, the stale automatic snapshot may finish its media but stays a draft/needs-review; do not silently replace its choices with the new values and autoqueue. An explicit future daily pack gets the new defaults. Invalid/missing defaults still allow the rendered video and library draft. Keep TikTok consent reset on media/text changes.

## Queue and late-worker contract

At mediaReady re-read current business/access, current settings, defaults version/account, existing pub history, media completion and all existing generation guards. Never schedule from a stale settings snapshot. Preserve active-day/custom-days, selected platforms, matching daily pack ID, onlyMissing, billing, social flag, expired account, locked/posted, A6 approval/noResend and pending-media checks.

- Master path: only matching current Autopilot activation (`canRun`) may enqueue `autopilot.run`; existing scheduler loops selected eligible platforms and adds YouTube only when its options/defaults provenance are valid. No takeover of existing publication rows. Master-off during rendering leaves generated drafts and queues nothing from that activation.
- Standalone path: master currently off, `auto.on=true`, `auto.post='schedule'`, YouTube still selected and current ordinary cadence/access permits it. Add YouTube to `autoSchedule`'s candidate list; use existing resolve -> scheduleChecks -> writeScheduled. Re-read business/settings within the scheduling transaction before write so a pause while checking cannot queue a new YouTube publication. A `platforms` filter passed by mediaReady is a hint, not authorization; always intersect current stored settings. Existing X/LinkedIn/Instagram semantics need not be broadened/refactored.
- Missing default/title/video, stale provenance or absent account: leave YouTube draft; return owner-fixable configuration/preflight reason, with a useful handoff/setup link. Do not log an operator incident for a normal missing choice. Other eligible platforms continue.

For automatic YouTube publication, persist the local authorization snapshot with the scheduled row/payload: `{youtubeAutomation:{defaultsVersion,acctId,mode:'master'|'standalone'}}`; preserve it when the sender builds its processing payload. Immediately before NEW YouTube upload initiation, re-read current account, matching owner defaults and mode authorization. Master continues its activation check; standalone requires current auto.on/post=schedule/platform includesYouTube and master off. If changed/unset, refuse a new upload and retain the draft for explicit review. This protects paused/changed policy between scheduling and send without changing existing manual schedules. Manual posts/schedules with explicit per-post choices carry no standing-default dependency.

An upload already accepted may finish remotely after a pause/default change. Retain providerRef and normal resume/status observation; never delete tracking or create a second upload. A6 noResend/approval markers remain stronger than any default change/reconnect and must never be cleared by this helper. Do not make an already accepted upload appear safely unpublished. Clearing defaults stops future unstarted automatic YouTube uploads, not remote video deletion. No provider revoke/API/privacy mutation is part of saving/clearing defaults.

Existing manually edited per-post values are never overwritten. For an auto draft whose choices were edited, retain the current manual options and require an explicit manual schedule/post if it no longer matches the saved auto snapshot; do not treat arbitrary valid options as standing authorization from owner defaults.

## Exact affected seams and order

1. Shared `src/lib/types.ts`, `workspace.socialAutoOf` and small pure YouTube default/eligibility helper; Owner action in `actions/social.ts` or separate media action module. Preserve Editor auto-save semantics atomically.
2. `features/social/AutoModal.tsx` Owner controls/status + include liveYouTube; `AutopilotSettings.tsx` truthful copy/deep link; current per-post PublishOptions needs no new provider flow.
3. `services/social/auto.ts`, `generate.ts`, `media/index.ts` plan-final title/attach CAS, `publish/schedule.ts`, `autopilot/run.ts`: source-generated title + selected default snapshot; eligibility and ready continuation both modes.
4. `publish/send.ts` new-upload guard/provenance payload preservation, leaving existing A6 lifecycle, beforeCreate and accepted status-resume logic intact. Integrate after final main/A6 merge so no stale guard is overwritten.

UI and backend engineers coordinate shared fields first. Required additional integration seam: the current A6 YouTube social.connect/disconnect transactions rotate/clear the settings revision as above, preserving all existing pending/cutoff/token guards. No migration, new platform credential, new permission scope, video preset or general billing change. Preserve existing defaults, master state and all unrelated automation behavior.

## Meaningful acceptance scenarios

- New business defaults absent: generate YouTube MP4 and library draft successfully; no auto pub row or provider POST; useful setup state. Both explicit booleanfalse andtrue are retained, no implied public/private/audience value.
- Only Owner can save/clear; Editor's ordinary social.auto save preserves configured defaults; stale payload cannot clobber latest owner settings. Cross-business acctId and wrong/expired channel refused. Saving choices never enables master, selects platform, enables generation or queues work.
- Owner chooses YouTube account +Unlisted +Not made for kids, then explicitly enables existing master or standaloneSchedule mode. New auto pack gets editable grounded title and exact options; ready callback schedules once; fake provider init sees exact title/privacy/audience. Repeat jobs/ready callbacks create no duplicate pub/upload.
- Standalone YouTube-only live channel passes setup and schedules next-day slot; master daily run schedules through its current policy slot. Platformsremoved/autooff/postlibrary/masterpause mid-render or before scheduling produces no new automatic queue; manual schedules remain unchanged. Pause/default clear before new upload blocks it; accepted ref still resumes without reinit.
- Defaults/version change during rendering leaves old snapshot draft/needsreview; no silent replacement. Existing owner title/choices survive plan attach. New daily pack uses new defaults; no backfill old packs/publication history.
- Account disconnect/replacement invalidates local binding; no defaults apply to a new channel implicitly. Any OAuth reconnect clears standing defaults and requires an explicit fresh Owner save; routine token refresh preserves them. Concurrent old UI save versus reconnect fails expectedVersion, including same UUID/new channel. No path bypasses A6 approval/noResend. Retention scrubbed uncertain operations cannot auto-reupload.
- TikTok never obtains standing consent or privacy values; generated TikTok remains draft until normal per-post choices/consent. Existing Instagram/X/LinkedIn automation and owner preferences remain green.
- Independent browser verifies unset selectors, Owner save/Editor read-only, setup-required state and truthful copy; focused DB tests verify both automatic paths and late policy races. No real public provider POST required for the regression.
