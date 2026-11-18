# Instagram, TikTok and YouTube publishing

Radar extends its existing Social Marketing accounts, content packs, Post now and Schedule flow to Instagram, TikTok and YouTube. Enable `RADAR_SOCIAL_PUBLISHING` for the intended businesses on both the web service and worker. The worker must run for scheduled posts and processing checks.

## User flow

1. Open Settings → Social accounts and connect the account. Channels are connectable only when their developer app credentials are configured; development stubs expose every channel.
2. Generate a content pack with the desired platforms. Review and edit each caption.
3. Instagram can publish a generated JPEG image or an uploaded MP4 Reel. TikTok can publish a photo or uploaded video. YouTube requires an uploaded video: a generated image does not become a video.
4. Attach video using Upload video. Radar accepts MP4 and WebM up to 100 MB; Instagram Reels require MP4. Provider codec, duration and account limits still apply.
5. For YouTube, enter a title, choose visibility and whether the video is made for kids. The post text becomes the description.
6. For TikTok, select an audience from the connected creator's current choices, choose allowed interactions, disclose commercial content where applicable, and explicitly accept the linked music confirmation and branded-content policy. No audience or consent is preselected. Review again after changing the content.
7. Use Post now or Schedule. Schedule all includes only eligible posts. TikTok's accepted upload remains processing until TikTok confirms publication. Processing continues through the worker without creating a second post. Automatic scheduling supports eligible X, LinkedIn and Instagram posts; TikTok and YouTube drafts wait for the required per-post choices.

An expired account needs reconnecting. Reconnecting preserves its scheduled posts; switching identities requires disconnecting first. Unknown publish outcomes ask the user to check the provider before another manual attempt. Existing X/LinkedIn flows remain available, and Facebook/Reddit/Quora remain copy-and-paste.

## Developer applications

Use separate development and production apps as appropriate. Register the exact callback URL produced from `APP_URL`; use a public HTTPS origin for production. Keep credentials on the server, identically configured on web and worker. OAuth credentials are separate from `YOUTUBE_API_KEY`, which only supports public video search.

### Instagram

New Meta apps use Instagram API with Unified Login, built on Facebook Login for Business. The Meta app must belong to a business portfolio and have the Instagram management use case. Create a manual, Instagram Login Compatible configuration with the Instagram asset and only `instagram_basic` and `instagram_content_publish` for publishing. Choose the System-user access token (SUAT) type and the desired expiry (the configured Radar app uses Never). Register `{APP_URL}/api/oauth/instagram/callback` exactly.

Set `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_CONFIG_ID`, and `META_GRAPH_API_VERSION` (default `v27.0`) identically on web and worker. Unified Login is enabled only when all three credentials/configuration values exist. Radar opens the versioned Facebook business login dialog using that configuration; the configuration supplies the scopes. The server exchanges the returned code with the Meta app credentials, reads the real client business ID, then lists every assigned Instagram account. The user chooses the account Radar will publish to; the system-user `/me` identity is never used as an Instagram account. Multiple shared accounts are shown in the existing account picker.

Tokens, grant mode, client business ID, configuration ID and API version stay encrypted on the server. Unified grants use `graph.facebook.com`; existing Instagram Login grants keep using `graph.instagram.com` even after deployment settings change. Never-expiring SUAT grants have no synthetic expiry or legacy refresh token. If Meta invalidates the grant, Radar asks for reconnect rather than sending it to the Instagram Login refresh endpoint. Expiring Unified grants also require reconnect when they end; Radar does not currently use Meta's optional token management API.

Disconnecting a Unified account deletes Radar's saved grant and unschedules its queued posts. Radar does not call the legacy Instagram permissions-revocation endpoint for a SUAT grant; remove the integration in the client's Meta business settings when remote grant removal is required. Remote SUAT revocation is not implemented because a supported endpoint has not been verified for this flow.

Existing Instagram Login apps remain supported using `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET` and `INSTAGRAM_API_VERSION` (default `v24.0`). Those grants use `instagram_business_basic` and `instagram_business_content_publish`, and keep their legacy long-token exchange/refresh behavior. New authorizations prefer Unified Login when it is fully configured. Advanced Access/App Review and Live mode are required for clients outside the app's roles.

Instagram fetches media from public URLs. Images must be JPEG; generated Instagram visuals are converted automatically, and Compress images can fix unsupported older files. Reels require a valid MP4. Personal consumer accounts cannot use this publishing integration.

Sources: [Unified Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started), [authentication](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication), [permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions), [manual login flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow), [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing).

### TikTok

Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. Enable Login Kit and Content Posting API Direct Post. Register `{APP_URL}/api/oauth/tiktok/callback`. Request `user.info.basic` and `video.publish`. Complete TikTok's audit and register the media URL domain or URL prefix in the developer portal. Unaudited Direct Post clients are restricted to private viewing, with the provider's testing/user caps. Sandbox connections also require the target account to be enrolled in the app's sandbox.

Radar stores media on its server and uses `PULL_FROM_URL` for photos and videos. The public media origin/prefix must be verified for the TikTok app. The creator information request determines current audience options, interaction restrictions and maximum video duration. The server checks those permissions again when sending. Private posts can link to the creator profile when TikTok does not return a public post ID.

Sources: [sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/), [creator information](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info/), [photo posting](https://developers.tiktok.com/doc/content-posting-api-reference-photo-post/), [direct video posting](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/), [processing status](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status/).

### YouTube

Set the dedicated `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Enable YouTube Data API v3 in Google Cloud. Configure the YouTube OAuth client and consent screen, register `{APP_URL}/api/oauth/youtube/callback`, and request `https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.readonly`. Add test users when the consent screen is in testing and complete Google verification where required. The selected Google identity must have a YouTube channel.

Radar sends the selected title, visibility, audience metadata and actual video bytes through `videos.insert` multipart upload, then durably records the returned video ID and checks processing status. The upload remains processing until YouTube confirms completion; the worker resumes that status check after restarts. Radar always sends the user's explicit public, private or unlisted choice. Google's November 2, 2026 API update removed the old rule that forced uploads from unverified API projects to private; OAuth consent verification, project quota and channel restrictions still apply. See the [YouTube revision history](https://developers.google.com/youtube/data/revision_history).

Sources: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [Google web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

## Media hosting and rollout

Local files use `/api/files/<business>/...`; production URL-pull providers require that URL to resolve to a publicly reachable HTTPS `APP_URL`. S3-compatible deployments should configure their public storage origin with `S3_PUBLIC_URL` and verify it with TikTok. Media uploads are authenticated and business-scoped. Do not pass arbitrary remote URLs as attachments.

No database migration is required: account/channel/platform columns are text and per-post options/media are JSONB. Start the worker with the same configuration as the web process. Roll back channel availability by removing its developer credentials and disabling the social publishing flag for the intended businesses; inspect already accepted provider operations before resending anything.

Development: use `RADAR_DEV_STUBS=1` with synthetic accounts and `RADAR_SOCIAL_PUBLISHING=all`. Stubs are disabled in production. Automated tests mock provider HTTP calls; local QA uses stubs and must not be treated as evidence of live OAuth/app-review approval. Live posting verification requires configured apps and explicitly authorized test accounts.
