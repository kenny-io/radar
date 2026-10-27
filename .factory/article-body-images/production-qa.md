# Production release QA — PR #13

## Revision and environment
- Read the feature brief, AC1–8, architecture, independent local QA, final verification, task contract and supplied repository instructions before production checks.
- Integrated release: merge commit `5adb4ee4d43e4cf723e60159f2427527a526a537` (PM confirmed merged 2026-10-27 17:02:12 Asia/Dubai).
- Production URL: `https://radar.thally.io`; exact original article confirmed from the user's existing native Comet tab: `https://radar.thally.io/article/e_mMDsBFf2`.
- Real authenticated browser session: Comet, Ekene Eze / Thally workspace. No local development authentication reused. CUA inventory contained no existing IAB tabs; native Comet had the original article and settings tabs.
- QA ownership is this report plus ignored `.data/article-body-images/production-qa/` evidence only. No implementation or test edits.

## Rollout observations
- Railway authenticated through existing GitHub login, without new permission grants. No Variables or credentials opened.
- Project `863ea66d-04b9-40e8-b27f-89a4f75c026e`, production environment `168aae6e-c038-4198-910a-e388afaac157`.
- Worker service `711ee076-4ac6-48f4-8721-91757f22cf7f`, deployment `9e88c905-e554-467e-8b93-289f784326f9`: Railway UI ACTIVE / Deployment successful, source GitHub commit link `5adb4ee4d43e4cf723e60159f2427527a526a537`, main, PR #13 merge. Deploy log 17:03:16 GMT+4: `[worker] started`; start command `npm run worker`.
- Web service `0c4df5c5-938d-421e-a16a-1c0781ac5118`, deployment `4cad53d5-83eb-411a-8738-8ebebf95fc19`: Railway Active / Deployment successful. Details source links to exact merge SHA `5adb4ee4d43e4cf723e60159f2427527a526a537`, main. Deploy logs at 17:04:58 GMT+4 show `next start` then `Ready in 1073ms`; service domain `radar.thally.io`. PM independently confirms both GitHub service statuses Success for the same SHA.

## Browser smoke
- Initial original-article tab was cached pre-release: Edit and Preview tabs present, Ready for review, generated existing article with Media panel. No content changes during discovery.
- Hard-refreshed original article after web rollout: exact title and Ready for review status retained; no Edit/Preview tabs; inline text editable; Media contains Body images explanatory text and enabled Add body images. Original article has zero body images. Screenshot `.data/article-body-images/production-qa/before.png`; metadata `before-summary.json`.
- Bounded Add body images clicked once under PM authorization. Actual UI showed `Creating body images · 0 of 2`; Approve article and conflicting cover controls disabled. Screenshot `progress.png`.
- **Pass:** generation completed with two distinct body images. Refreshed the actual production page; both persisted and Media changed to Regenerate body images. Nonempty accessible image names: `Illustration of What syncing with code should mean` and `Illustration of Evidence-backed update PRs with human approval`.
- **Pass:** inspected each figure bitmap in the actual browser after refresh: both visibly loaded at their respective complete-section boundaries (before Tracing a merged PR and before What to look for). Both Media thumbnails also visibly loaded. Saved `body-image-1.png`, `body-image-2.png` and `after-refresh.png`; Media thumbnail inspection is in CUA tool output (a final redundant screenshot save was unavailable once the Mac locked).
- **Pass:** rendered title and all article body text remained exactly the same by SHA256 of the normalized article accessibility subtree, excluding new image nodes: before and after `cbb4483fde5cff5ba8e719567118af82f2419c78ae4ba9afb5c67442959dc230`. Status remains Ready for review. Cover illustration and alt text retained. No rewrite, cover regeneration, approval, publication or other article changed.
- Evidence metadata: `.data/article-body-images/production-qa/smoke-results.json`. Only hashes and nonsecret observations saved; no session credentials exported.

## Acceptance summary and recommendation
- **Passed in production:** exact merge SHA deployed to both web and worker; worker and web startup logs; authenticated original article loading; AC2 image refresh/persistence and text preservation; AC3 explicit legacy Add and actual progress; AC4 two loaded/distinct section images, nonempty accessible descriptions and loaded Media thumbnails; AC8 unified inline article view.
- **Failed functional checks:** none observed.
- **Blocked:** no required deployment/core desktop smoke check remains blocked. A final redundant thumbnail evidence save was interrupted by the Mac locking after the thumbnails were already visually inspected.
- **Not applicable to this bounded production smoke:** full new-article/rewrite generation, intentionally induced failures, cross-tenant/Viewer mutations, mobile emulation and real external CMS publication. These were not repeated against production; local coverage and external-service limits remain in `qa.md`. No test files changed and no feature tests were rerun for this documentation-only release pass.
- **Quality observation (P3, nonblocking):** the first generated illustration has some garbled/cut-off model-rendered labels. Reproduction: inspect the image after What syncing with code should mean in original article on this release. Expected editorial illustration is readable; actual bitmap contains distorted small lettering. This is a live generation-quality limitation, not missing-image or browser-loading failure. Evidence `body-image-1.png`. No regeneration attempted outside the single authorized Add action.
- **Recommendation:** production deployment and core smoke accepted at merge SHA `5adb4ee4d43e4cf723e60159f2427527a526a537`. Passing this observed smoke does not establish all production behavior correct.

## Limits
- Production content writes limited by PM to original article's Add body images once, only after both services succeed and only if original article remains open/Ready for review with no existing body images. No rewrite, cover regeneration, approval or publication authorized for QA.
- Full local acceptance coverage is in `qa.md`; this report covers the actual production release smoke.
