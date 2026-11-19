# Saved social content: discoverability and navigation

User wants a fresh unpublished YouTube demo and a reliable way to find saved draft pages again through Radar, without chat deep links. Actual PM browser reproduction and source audit find that Social Marketing already lists saved tenant packs. The issue is discoverability: generic thumbnails, no clear draft/posted distinctions, no search/status filters, no explicit native open links. Do not claim records were missing or fix an unproven query bug.

Scope N1 extends the existing design system: URL-backed search/status filters, accurate per-platform publishing summaries (including mixed packs), actual generated-media previews where available, obvious Open pack native links, preserved library context/back navigation and explicit unavailable-pack state. Keep all-pack tenant query and publishing/media behavior unchanged. Generic duplicate-as-draft is deferred.

Acceptance:
- N1: Saved packs are reachable from sidebar Social Marketing and Content library; Settings away/return, refresh and browser back work. Native pack links support normal open-in-new-tab/bookmark behavior.
- N2: Search and status filters have explicit labels, stable URL state and an All packs/reset path. Opening/returning retains library context. New or out-of-filter packs are not silently lost.
- N3: Per-platform counts distinguish draft/scheduled/processing/posted/failed as appropriate; mixed pack summaries never label a partly posted pack fully posted. Clear Draft/Scheduled/Posted/Mixed discoverability.
- N4: Video/carousel packs visibly indicate actual media and do not masquerade as generic generated still thumbnails. Previews must not autoplay audio or eagerly fetch entire libraries of video.
- N5: Missing/unknown pack IDs show an explicit unavailable message and library path rather than silently becoming an unrelated page. Existing tenant/access boundaries remain.
- N6: Keyboard and narrow/mobile layouts work with existing components; no nested interactive card controls or misleading disabled Open action.
- N8: A live, nonexpired Posted receipt exposes a native HTTP(S) external link; actual click/keyboard opens the correct YouTube page. Scrubbed/null/invalid receipts show a clear explanation instead of an inert View action. Retention/no-resend/history remain unchanged.
- N7: No publication, new generation/model/narration, broad rollout/default/master change, history reset or unrelated provider work. Existing media/publishing regressions remain covered.
- D2: A separately scoped fresh manual YouTube-only draft reuses the exact accepted Blueprint media/plan/narration. Original packs/history and business preferences remain unchanged. Actual UI video metadata and enabled Post now/Schedule persist after refresh; leave final publishing to user. Verify this new draft can be found through the improved library.

Delivery: current isolated worktree, branch kenny/social-draft-navigation from deployed main13e22728. Existing session authorizes implementation, checks, PR/merge and deployment. Preserve unrelated .factory operational notes. Google scope verification remains unsubmitted pending a complete actual recording. Rich new video production families requested in another-agent handoff are outside N1.
