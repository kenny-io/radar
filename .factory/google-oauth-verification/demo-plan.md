# Verification demonstration plan

Use a dedicated, owned test channel/account. Final submission must use actual live functionality, not mocked QA footage. Avoid including secrets, other users' content, customer drafts, private channel statistics or unrelated browser windows.

1. Show Radar homepage and its Privacy/Terms links. Explain that users connect a channel and choose videos/options for direct or scheduled upload.
2. Show Google sign-in with the existing Radar Web OAuth client and return to the signed-in Radar app, as this project includes that client. Show the browser address bar/client ID without exposing credentials.
3. Settings > Social accounts > Connect YouTube. Show the dedicated YouTube OAuth client in the consent address bar, Radar branding, the expected unverified-app screen on the test account and requested upload/read-only scopes. Owner must complete any security/consent handoff personally when required.
4. Complete authorization. Show the connected channel name returned by channels.list(mine=true), illustrating readonly use and the repaired return-to-app behavior.
5. Use the normal generated-first Radar journey to generate a harmless explainer from owner-selected business/social context, then preview it. Users should not need to upload a video. Use title 'Radar verification upload test', explicit Private visibility and not-made-for-kids setting. Review the exact generated clip/channel before sending. Show videos.insert upload and videos.list processing/completion status in Radar. The manually attached internal endpoint test clip is not the final product demonstration.
6. Show the private upload in the owned YouTube channel/Studio. Do not publish customer or reputational content as a demonstration.
7. Show how users disconnect/revoke access and where privacy/deletion information is available. Avoid disconnecting a useful account without reviewing queue effects.
8. Upload the screen recording as Unlisted for Google reviewers and supply its real URL in Data Access. Review any visibility/data disclosure or legal attestations at the actual final action.

Primary requirements: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification and https://support.google.com/cloud/answer/13461325

Current operator state: Data Access uses the generated-content justification and has no demo URL. This worktree is now the active recording/submission record; the earlier release worktree contains historical setup notes only. Actual production generation is verified: use the normal draft media-099ade32e56238eb7745134e7d4afcf3 and its generated106.959s video, not the old manually attached fixture. Native recorder foreground request remains pending.
