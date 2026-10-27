# Production release

Owner explicitly authorized merging PR #13 and verifying production on 2026-10-27.

- PR: https://github.com/kenny-io/radar/pull/13
- Exact approved head: 957a40cb96b81237f4b349ba748024beb57bb335; clean/mergeable with no configured CI checks before merge. Prior independent QA/typecheck/build and baseline test exception recorded in verification.md.
- Merged at 2026-10-27T13:02:12Z (17:02:12 Asia/Dubai) using a merge commit: 5adb4ee4d43e4cf723e60159f2427527a526a537.
- Fetched origin/main and confirmed merge. Merged application source fingerprint matches independently tested 2f5044f06a193f394e0a44387569cb00f3abb9d9405ad67b72f3f860fd8c29ff.
- GitHub production deployment 7359154233 started at 2026-10-27T13:02:19Z, environment radar / production, exact merge SHA. Deployment currently in progress; not yet declared deployed.
- Public /signin and / return HTTP200 while rollout proceeds. These checks alone do not confirm the released revision.
- Railway CLI authorization unavailable; independent QA uses existing signed-in browser for read-only service/deployment checks, without reading environment secrets. Existing signed-in Radar production session and original article route confirmed.

## Worker confirmed
- Exact-merge GitHub status `radar - worker` reached success. Railway deployment `9e88c905-e554-467e-8b93-289f784326f9`, service `711ee076-4ac6-48f4-8721-91757f22cf7f`.
- Independent QA saw Railway ACTIVE / Deployment successful for Merge PR #13 on main, and `[worker] started` in its deploy log at 17:03:16 Asia/Dubai. No environment Variables were opened.
- Web deployment `4cad53d5-83eb-411a-8738-8ebebf95fc19`, service `0c4df5c5-938d-421e-a16a-1c0781ac5118`, still building at that check.
- Authorized production smoke is limited to adding body images on the original open draft `/article/e_mMDsBFf2`, after both deployments succeed and only if body images are absent. No rewrite, cover regeneration, approval or publication.

## Both production services confirmed
- GitHub deployment `7359154233` reached success at `2026-10-27T13:05:06Z` (17:05:06 Asia/Dubai). Exact merge SHA aggregate status is success; both `radar - worker` and `radar - web` report Success. Status responses preserved under ignored `.data/article-body-images/production/`.
- Independent Railway UI check: web deployment `4cad53d5-83eb-411a-8738-8ebebf95fc19` Active, `next start` then Ready in1073ms at17:04:58 Asia/Dubai. Worker Active with startup log as above.
- Post-rollout public home/signin checks return HTTP200. Independent authenticated original-article refresh shows no Edit/Preview switch and the new Media→Body images→Add body images controls.
- Authorized image-generation smoke started once on the original open draft, with progress0of2 and approval disabled. Pre-generation cover/title/intro screenshot and editable article-text hash captured by QA; waiting for generation completion/reload verification.

## Final production verdict
- PASS: independent QA confirmed both distinct body-image bitmaps visibly loaded after reload at the planned section boundaries, with nonempty accessible names. Original draft now offers Regenerate body images.
- All rendered article text/title SHA256 before vs after is identical: cbb4483fde5cff5ba8e719567118af82f2419c78ae4ba9afb5c67442959dc230. Cover preserved, status remains Ready for review, and no Edit/Preview tabs remain.
- Evidence (ignored local artifacts): `.data/article-body-images/production-qa/{before.png,progress.png,after-refresh.png,body-image-1.png,body-image-2.png,smoke-results.json}`. Full independent result is production-qa.md.
- Nonblocking visual observation: one generated image contains garbled small lettering despite the prompt requesting no labels; generation/storage/display and persistence are working. No additional regeneration was performed during this bounded smoke.
- Release is merged and deployed; no product code changes follow the tested merge. These release notes are documentation only and do not require another production deployment.
