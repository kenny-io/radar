# Postiz lessons for Radar's social channels

Research only. This compares Postiz's X and LinkedIn publishing against Radar's design in `architecture.md`, `developer-apps-guide.md` and `src/lib/socialPublish.ts`.

- **Source.** Postiz `main` at commit `8603fdc3` (2026-10-22), shallow clone, read only.
- **Tracker and docs.** The Postiz GitHub tracker and docs.postiz.com, read on 2026-10-23.
- **Licence.** Postiz is AGPL-3.0. Nothing below is copied code. Only identifiers, endpoint names and short strings are quoted.

`P/` is short for `https://github.com/gitroomhq/postiz-app/blob/8603fdc3e8873a0e48cb23ab7b3c18b95f67ec33/`.

---

## 1. Summary

- **LinkedIn profile images need a wait before the post is created.**
  - A `w_member_social` token can't poll `/rest/images`. Postiz therefore waits one ~20 s check cycle before attaching a profile image, and polls page images until they reach `AVAILABLE`.
  - Radar §9.2 creates the post straight after the PUT. With A7 (a manual transient failure fails at once), **Post now with an image on a LinkedIn profile is likely to fail often.**
- **Record "posted" first, and let no later step undo it.**
  - Postiz's worst bug was an endless repost loop (#1321): a side effect after a successful post threw, and the job retried the whole publish.
  - Postiz now guards with `posted`/`updated` flags.
  - Radar §9.2 step 6 should state that, once a create returns 2xx, the `posted` write comes first. Errors in the Brief write, the event or `notify` after that are logged and never reach the unknown or retry paths.
- **X 402 "credits depleted" needs its own error.**
  - Postiz users saw "Unknown Error" (#2231).
  - Radar runs one paid X app for every business, so depleted credits stop all X posting at once. Radar §9.4 would map it to "other 4xx → `rejected`" and blame the user's post.
  - Map it to its own copy and alert the operator.
- **LinkedIn API version sunsets caused Postiz's most frequent LinkedIn outage.** It happened twice (#1187, #2005: `426 NONEXISTENT_VERSION`), because the version was hard-coded.
  - Radar's `LINKEDIN_API_VERSION` env var is the right idea.
  - Add a 426 mapping, an operator alert and a yearly bump reminder.
- **Radar's X weighted counter is close, but wrong in two directions.** Postiz uses `twitter-text` `parseTweet` with the same weight ranges plus emoji parsing.
  - Radar counts emoji per code point. `❤️`, `👍🏽` and flags count 4 where X counts 2, and ZWJ families count 8 where X counts 2, so Radar blocks valid posts.
  - Radar only treats `http(s)://` as a URL. A bare domain such as `radar.app` counts 9 in Radar but 23 on X, so Radar lets through posts that X rejects.
  - The same gap makes `publishCostUsd` miss bare-domain link posts.
- **Two LinkedIn apps (A13) and matching on the organization URN (A10) are confirmed right.**
  - Postiz uses one app for profile and page. Self-hosters can't connect profiles (#1582, #1580, #1197, #1243): org scopes plus `prompt=none` give `unauthorized_scope_error` or "Bummer, something went wrong".
  - A page connect also overwrote and deleted the personal channel and its scheduled posts (#1516, #2089).
- **List pages for `CONTENT_ADMINISTRATOR` as well as `ADMINISTRATOR`.** Users with only the content role couldn't connect their page (#1234).
- **Radar's double-post protection is stricter than Postiz's. Keep it.**
  - Postiz has the same "never re-run an unknown create" rule (an arm → confirm → publish handshake, and no automatic retries of mutations).
  - However, its shared `fetch` still retries a **500 on the create call itself**, which can duplicate a post. Retrying a 429 is safe, because nothing was created.
  - Radar's X read-back is a step Postiz doesn't have. Postiz just says "may have already published, check your account".
- **X `made_with_ai` is a real `POST /2/tweets` field** that discloses AI-generated media. Postiz sends it on every post. Radar should set it to true when the image came from the image model.
- **Postiz's hosted service strips every link from X posts because of X's $0.20 link price** (maintainer's comment on #1939). That supports §20 Q2.
  - Users were angry because the links vanished **silently**.
  - If Radar ever drops links, it must show that in the preview, not silently.

---

## 2. Recommended changes to Radar

| # | Lesson | Evidence | Radar today | Recommended change | Area | Priority |
|---|---|---|---|---|---|---|
| 1 | LinkedIn media is processed asynchronously. Profile tokens can't poll it; page tokens can | `P/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` L293–466 (`uploadPicture`: `poll` for org, `grace: true` for personal); L888–1006 (`checkPostStatus` waits for `AVAILABLE`, then grace cycles) | §9.2 step 4→5 creates right after the PUT. §9.4 treats "image still processing" as transient, which means it fails at once on Post now (A7) and waits 1 min when scheduled | Between the media and create stages: a **profile** waits about 10–20 s after the last PUT. A **page** polls `GET /rest/images/{urn}` until `AVAILABLE` (cap about 60 s; `PROCESSING_FAILED` gives `media`). If that GET returns 403 (it is unconfirmed whether the page scopes allow it), fall back to the profile grace wait. Apply this to manual and scheduled sends. Keep the transient mapping as a backstop | backend (`publish/linkedin.ts`, `send.ts`) | **must** |
| 2 | Once a post is live, nothing after it may trigger a resend or an "unknown" result | #1321 (an endless duplicate loop after a post-publish side effect threw); `P/apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts` L430 (`posted`/`updated` guards); `social.abstract.ts` L106 (`PublishedWithError` keeps the URL) | §9.2 step 6 lists the success write, then the brief write, the event and `notify`, with no stated error boundary | In §9.2.6: (a) the conditional `posted` write with `remote_id`/`remote_url` is the first thing after a 2xx. (b) Retry that write in process a few times. If it still fails, log `remote_id` (LinkedIn can't be read back). (c) The brief write, events and `notify` go in a try/catch that only logs. Add a test: `notify` throws after a create → the row is `posted`, with one send | backend (`send.ts`) | **must** |
| 3 | X pay-per-use 402 "credits depleted" and `usage-capped` | #2231; `x.provider.ts` L152–297 (`handleErrors`: `usage-capped`) | §9.4 has no 402 row, so it becomes `rejected` ("X rejected the post") | Add a 402 / `usage-capped` row with a new `PubErrCode`, e.g. `quota`: "Radar can’t post to X right now. Try again later." It is not retried. It also raises an operator alert (log plus admin metric `derived.social.quotaFailures`). Needs a PM change to `types.ts`/`socialPublish.ts` | shared helper + backend | **must** |
| 4 | LinkedIn version sunset (`426 NONEXISTENT_VERSION`) | #1187, #2005. Postiz still hard-codes `202601`, and `202306` for comments (`linkedin.provider.ts` L278, L799) | `LINKEDIN_API_VERSION` defaults to `202610`. A 426 falls under "other 4xx → `rejected`" | Map a 426 to `unavailable` copy plus an operator alert ("LinkedIn API version {v} retired"). Add to `docs/LAUNCH.md`: bump the version every ≤ 11 months, since `202610` sunsets around Oct 2027 | backend + docs | **must** |
| 5 | X weighted length: emoji sequences and bare domains | `P/libraries/helpers/src/utils/count.length.ts` L1–48 (`parseTweet` with `emojiParsingEnabled`, `transformedURLLength: 23`, the same 4 ranges as Radar) | `charCount` (socialPublish.ts L79–85) weighs each code point (emoji sequences overcount). `URL_RE` needs a scheme (bare domains undercount) | Either add `twitter-text` (Apache-2.0; needs the owner to waive §1 "no new runtime dependencies"), or: (a) iterate graphemes with `Intl.Segmenter`, so a grapheme containing `\p{Extended_Pictographic}` or a regional-indicator pair weighs 2; (b) also count scheme-less `label.tld[/path]` as 23 for common TLDs. Add tests for `❤️`, `👍🏽`, `🇺🇸`, a family ZWJ, `radar.app`, and `see example.com/x`. Also make `publishCostUsd` use the same URL detector | shared helper (`socialPublish.ts` + test) | **must** |
| 6 | Never send `prompt=none`. Verify the granted scopes | #1580, #1582 (`prompt=none` → "Bummer" error, or missing scopes); `linkedin.provider.ts` L186, L228 (`checkScopes`); `social.abstract.ts` L662 | §7 doesn't say either way | §7: the authorize URL carries no `prompt`. On callback, compare the token response's `scope` with the required set. If one is missing, fail with "{LinkedIn} didn’t grant the permissions Radar needs. Try again." and store nothing. Do the same for X | backend (`oauth.ts`) | should |
| 7 | List pages for content admins too | #1234; `linkedin.page.provider.ts` L138–167 (filters `ADMINISTRATOR`, `CONTENT_ADMINISTRATOR`) | §7 queries `role=ADMINISTRATOR` only, and the reconnect re-check uses the same. The dev guide's appendix says `CONTENT_ADMIN` | Query both roles (two calls, or drop the `role` filter and filter on the client). Use LinkedIn's spelling `CONTENT_ADMINISTRATOR` and fix the guide. The reconnect re-check accepts either role | backend (`social.pages`, `social.connect`) + guide | should |
| 8 | AI-media disclosure on X | `x.provider.ts` L1333; docs.x.com create-post (`made_with_ai`: "discloses AI-generated media") | Not sent | In §9.2.5, send `made_with_ai: true` when the attached image was made by the image model (Photography/Illustration). Leave it off for canvas templates. This also supports the policy note in guide §3.5 | backend (`publish/x.ts`) | should |
| 9 | Match X errors on the body text, not just the status | `x.provider.ts` L152–297: "duplicate content", `duplicate-rules`, `user-suspended`, "temporarily locked", "Crypto addresses are prohibited", "Your media IDs are invalid", "maximum of one cashtag", "invalid URL" | §9.4 maps on status (403 duplicate, 400 length) | Add body-substring rules ahead of the status rules. Duplicate (both strings) → `duplicate`. Suspended or locked → `auth`, with copy "Your X account is locked or suspended. Sign in to x.com to fix it." Cashtag, invalid URL and crypto → `rejected` with specific copy. Invalid media ids → `media`. Keep the excerpt in `err_detail` | backend (`publish/x.ts`) + `errCopy` | should |
| 10 | Tell people when a channel needs reconnecting, outside the dashboard | `refresh.integration.service.ts` L71–105 (`refreshNeeded` + `informAboutRefreshError` → in-app and email with a reconnect link) | §7 emits the `social.expired` event and shows Needs attention. No `notify` | On `social.expired` with `held > 0`, `notify(bid, "{Channel} needs reconnecting. {n} scheduled posts are on hold.", {tone:'bad', action: Reconnect})`. Also send a LinkedIn profile warning about 7 days before `expires_at` | backend (`accounts.ts`) | should |
| 11 | Short retry on 429/503 during media upload | `x.provider.ts` L702–716 (`uploadWithRateLimitRetry`: 3 tries, 5 s and 10 s; "Nothing is published at upload time") | A manual media-stage 429 fails at once (A7) | Inside the media stage only, retry 429/503 up to twice, honouring the reset header when it is ≤ 15 s. Never retry the create | backend (`send.ts`) | nice |
| 12 | X Premium long posts | `x.provider.ts` L95–108 (`maxLength`: 4000 when "Verified", 280 otherwise) | 280 fixed | Store `subscription_type` (or `verified`) from `GET /2/users/me` and allow the higher limit when it's Premium. Confirm the current Premium limit first (Postiz's 4000 may be out of date) | backend + shared helper | nice |
| 13 | Who can reply | `x.provider.ts` L1316–1323 (`reply_settings`: following, mentionedUsers, subscribers, verified) | Not offered | Nothing for v1. Revisit if owners ask | — | nice |

**Deliberate differences, where Radar should not follow Postiz:**

| Postiz practice | Evidence | Radar | Why Radar differs |
|---|---|---|---|
| X over **OAuth 1.0a** (`X_API_KEY`/`X_API_SECRET`, app type "Native App"). Tokens never expire | `x.provider.ts` L448–512 (`expiresIn: 999999999`); docs.postiz.com/providers/x-twitter | OAuth 2.0 PKCE with rotating refresh (A12) | 2.0 gives scoped consent and revocation, and it is X's current path. Postiz gives **no evidence** for or against A12's rotation handling. Keep the row lock and daily refresh. 1.0a is a possible fallback if rotation causes trouble in live tests |
| A refresh failure of any kind (including a network error or 5xx) sets `refreshNeeded` and emails the user | `refresh.integration.service.ts` L71–105 | A11 marks the account expired only on `invalid_grant`/401 | Radar's split is better. Postiz users see false "reconnect" prompts |
| A post whose channel needs reconnecting **fails** at publish time ("Refresh channel needed") | `post.workflow.v1.1.2.ts` L191–208 | A4 holds it, with the 24 h stale rule | Holding plus reconnect release is kinder. Keep it |
| One LinkedIn app for both profile and page, with an identical scope set | `linkedin.provider.ts` L65–73; `linkedin.page.provider.ts` L28–36; docs.postiz.com/providers/linkedin | Two apps (A13) | It caused #1582 and #1516/#2089. Postiz's docs get org scopes from the **Advertising API** product, not Community Management, which is a restricted-use risk for organic posting |
| Every X image is re-encoded as a GIF, 1000 px wide (it enlarges small images, and the declared mime is wrong) | `x.provider.ts` L740–770; #2018 | Uploads the file as is. `social.compress` is explicit | Avoids quality loss and type mismatches |
| `fetch` retries 500/429 on **every** call, the create included (3 × 5 s) | `social.abstract.ts` L564–618 | §9.3: a 5xx on create is unknown → verify or fail | Radar is safer. Don't loosen it |
| Every `#` is escaped in LinkedIn `commentary`, so hashtags become plain text | `linkedin.provider.ts` L496–527 (`fixText`) | `liCommentary` keeps a word-starting `#` | The little format grammar allows `HashtagElement ::= '#' SINGLE_WORD`, so Radar's approach is valid. Keep it, and add a live test (`#tag_name`, `#1`) |
| LinkedIn auto-resize at send time (fit 6000×6000; WEBP → JPEG) | `linkedin.provider.ts` L657–688 | Blocks at preflight, with Compress (never auto-compresses at send) | Radar's rule makes changes visible. Its own renders are PNG within limits |
| Links silently stripped from X posts (hosted) | #1939, #1581 | Keeps links (§20 Q2 open) | If the owner chooses to drop links, show it in the X preview and counter. Never strip silently |

**Housekeeping (not Postiz-derived).** Several parts of `architecture.md` still describe the API reply path that §14 dropped:
- A16, the `[[radar:noreply]]` stub marker, the §9.4 `reply_restricted` row, the §16 test item, §17.7 `'api'` mode and §20 Q1;
- in `socialPublish.ts`, `errCopy('reply_restricted')` and `X_COST_USD.reply`.

---

## 3. X

- **OAuth.** OAuth 1.0a three-legged, via `twitter-api-v2` `generateAuthLink(..., {authAccessType:'write'})`, with one instance-wide app (`X_API_KEY`, `X_API_SECRET`). That is per app, not "bring your own keys".
  - The token is stored as `token:secret`, with `expiresIn 999999999` and no refresh (`x.provider.ts` L448–512).
  - Users want per-customer credentials because of shared rate limits and the blast radius (#1016, #2120, open).
  - The docs require the app type "Native App" for 1.0a, because other types fail with error 32.
- **Scopes.** Not applicable (1.0a "Read and Write"). Radar's 2.0 scope set (A9) is not exercised by Postiz.
- **Media.**
  - Images go through the v2 upload (`client.v2.uploadMedia`) after the GIF re-encode. That confirms v2 media upload works with user context in production. Article images go up as JPEG `tweet_image`.
  - Video uses the v2 chunked endpoints: `media/upload/initialize` → `/{id}/append` (1 MB segments) → `/{id}/finalize` (L581–647). Then it polls `STATUS` using `check_after_secs`, for up to 7 min (L652–700). Uploads run one at a time.
- **Threads and comments.** These are self-replies to the post just created (`comment`, L1441–1502, `reply.in_reply_to_tweet_id`), with an optional delay between them.
  - #1581 was a delay-unit bug, not the reply restriction.
  - **Nothing in the code or the tracker handles the Feb 2026 reply restriction.** There is no 403 mapping for it. Postiz never replies to third-party threads, so it wouldn't hit it. Radar's intent-only decision (§14) stands.
- **Settings.** Who can reply (`reply_settings`), community posting (`community_id` + `share_with_followers`), `made_with_ai`, `paid_partnership`, and long-form Articles (`/2/articles/draft` → `/publish`, Premium only).
- **Character count.**
  - `twitter-text` v3 `parseTweet`: emoji parsing on, every URL (including bare domains) = 23 (`count.length.ts`).
  - The limit is 280, or 4000 when the "Verified" checkbox captured at connect is ticked (L95–108).
  - The preview shows where the text gets cut (`textSlicer`).
- **Rate limits and 429.**
  - The generic `fetch` waits 5 s and retries up to 3 times. It ignores `x-rate-limit-reset`.
  - Media uploads have their own 5 s / 10 s retry.
  - The worker caps X at 10 concurrent jobs, with a comment that limits are per user, "300 posts / 3 hours" (L80–86). That agrees with the integration-guide figure noted in Radar's guide §7.
- **Duplicates.** Matched on the body text "You are not allowed to create a Tweet with duplicate content" and `duplicate-rules`, mapped to a non-retried bad-body.
- **Error mapping** (`handleErrors`, L152–297).
  - Body-substring rules for: not permitted, Service Unavailable or Too Many Requests (retry), cashtag, more than 4 items, Unsupported Authentication or `"title":"Unauthorized"` (reconnect), `usage-capped`, `user-suspended`, account locked, crypto addresses (blocked for 7 days after connecting), invalid media ids, invalid URL, video length, article Premium.
  - A 402 is not mapped, hence #2231.
- **Unknown outcome.** The create runs only after an "armed" state has been saved durably (L910–1000, L1290–1358).
  - If an armed create died, the next check stops with "X may have already published this post, please check your account".
  - There is no read-back. Radar's `GET /2/users/:id/tweets` verify goes further.
- **Post URL.** `https://twitter.com/{username}/status/{id}`. Radar's `x.com` form is fine.
- **Analytics.** `singleTweet` `public_metrics` per post (L1632). Account totals come from the user timeline. There is a `DISABLE_X_ANALYTICS` switch for plans without reads.
- **Link stripping.** `STRIP_LINKS_FROM_X_POSTS`, on in the hosted service, removes scheme and bare-domain URLs to avoid X's link price (#1939, closed as intended).

---

## 4. LinkedIn

- **Providers and apps.** There are two providers, `linkedin` and `linkedin-page`. The page provider extends the profile provider and shares **one app**, the same `LINKEDIN_CLIENT_ID`, and an **identical scope list**:
  - the scopes are `openid profile w_member_social r_basicprofile rw_organization_admin w_organization_social r_organization_social`;
  - the identical list avoids the "new scope set revokes old tokens" rule;
  - Postiz's docs get the org scopes and refresh tokens from the **Advertising API** product, alongside Share on LinkedIn and OpenID Connect;
  - self-hosters who only have Share and OpenID Connect can't connect profiles (#1582 open, PR #1657 pending).
- **Page picking** (`linkedin.page.provider.ts` L138–208).
  - `GET /v2/organizationalEntityAcls?q=roleAssignee&state=APPROVED`, with a decorated projection for name, vanity name and logo in one call. That is the legacy v2 API; Radar's `/rest` one-call-per-page plan is right for Development tier.
  - It keeps `ADMINISTRATOR` and `CONTENT_ADMINISTRATOR`.
  - The connection sits in `inBetweenSteps` until a page is picked. #1516 came from the placeholder's id colliding with the personal channel, and was fixed by namespacing it.
- **Tokens.**
  - The token and refresh token come from `/oauth/v2/accessToken`. A refresh goes through the same endpoint with `grant_type=refresh_token`.
  - A daily sweep refreshes tokens that expire within a day (`integration.repository.ts` L433). A 401 at publish time triggers an on-demand refresh, then the publish runs again.
  - After any LinkedIn refresh, Postiz waits **10 s** (`refreshWait`) before using the new token. The reason isn't documented.
  - `oneTimeToken` copies a refreshed token to every channel from the same member grant.
  - A failed refresh sets `refreshNeeded` and sends an in-app message and an email: "Could not refresh your … channel … connect it again". The channel shows a reconnect state.
  - **There is no 60-day profile expiry handling beyond that.** Postiz assumes refresh tokens exist (Advertising API approval).
- **Headers and author.** `LinkedIn-Version: 202601` (hard-coded) and `X-Restli-Protocol-Version: 2.0.0`. The author is `urn:li:person:{sub}` or `urn:li:organization:{id}`.
- **Body and post id.** The `/rest/posts` body matches Radar §9.2.5 exactly. The id is read from `x-restli-id` on a 200 or 201.
- **Post URL.** `https://www.linkedin.com/feed/update/{urn}`.
- **Text escaping** (`fixText`, L496–527). It backslash-escapes the same 15 reserved characters as `liCommentary`, but also every `#`. That kills hashtags, which Radar avoids.
  - Organization mentions in the form `@[Name](urn:li:organization:id)` are preserved. They are found by vanity-name lookup.
  - Applying the same escaping to **comments** (`socialActions/.../comments`, plain text) printed literal backslashes (#1847, open). Radar has no LinkedIn comments, so it isn't affected, but the lesson is to escape for `commentary` only.
  - #442 (posts cut off at `1)`, `--` or `•`) is the failure that escaping fixes.
- **Media** (L293–466, L657–720).
  - Images and documents: `/rest/{images|documents}?action=initializeUpload {owner}`, then **one PUT of the whole file**. Chunked PUTs to the same URL corrupted files over 2 MB.
  - Video: `/rest/videos` init (with `fileSizeBytes`), 2 MB parts, an etag per part, then `finalizeUpload`.
  - One media → `content.media.id`. Two or more → `content.multiImage.images[]`.
  - "Carousel" mode turns the images into a PDF `document` post.
  - Processing wait: see row 1 of §2.
- **Errors.**
  - Only two body rules: "Unable to obtain activity" and "resource is forbidden" / Service Unavailable, both treated as retries. Everything else is "Error posting to LinkedIn".
  - No duplicate, length or 422 mapping. #1058 was an image post failing with an empty BadBody.
- **Analytics.** Pages only, via `organizationalEntityShareStatistics` and `socialActions`. Profile analytics are an open request (#1680, `memberCreatorPostAnalytics`).

---

## 5. Scheduling, retries and reconnect

- **Finding due posts.**
  - One Temporal workflow per post, with workflow id `post_{id}`, which deduplicates. It sleeps until `publishDate`.
  - An hourly sweep (`searchForMissingThreeHoursPosts`, `posts.repository.ts` L36) re-signals posts that are still `QUEUE`, from healthy channels, due within the last **2 days**. That is effectively Postiz's stale window; Radar's is 24 h.
- **Avoiding double posts** (`post.workflow.v1.1.2.ts`).
  - Mutation activities have `maximumAttempts: 1` and a heartbeat timeout (L83–92).
  - A heartbeat timeout with no heartbeat at all means the activity never ran, which is safe to retry. Any other timeout gives `markUnconfirmed` (L312–330, L546): the post is set to ERROR with the copy "couldn't confirm it was published … check … before posting again".
  - Once `posted` is set, a later error never re-runs the publish (L430+).
  - Radar's design matches this, and its X read-back adds a step.
- **Retries.**
  - Workflow-level: up to 5 passes, but only after a token refresh, or when the activity never started.
  - `bad_body` errors fail with an in-app notification.
  - In-request: `fetch` retries 429/500 three times at 5 s (the hole noted in §2).
  - Status checks poll every 20 s, up to 90 times (about 30 min, L118).
- **What the user sees.**
  - Every terminal outcome sends an in-app notification, and failures send an email digest.
  - Success also notifies, with the URL.
  - A post card in the calendar is marked as failed and shows the error in a tooltip.
- **Reconnect state.**
  - Flags: `refreshNeeded` (reconnect needed), `inBetweenSteps` (page not picked yet, or a refresh error during reconnect) and `disabled`.
  - The sweep and the publish skip channels with any of these. A reconnect clears `refreshNeeded`.
  - A `Disconnect` error class exists for "the platform will keep refusing" (e.g. TikTok caps).
- **Per-platform text.** There is a global editor plus a per-channel override (`store.ts`, `current: 'global'`). Radar packs already hold text per platform.

---

## 6. Recurring issues in Postiz's tracker

| Theme | Issues | Takeaway for Radar |
|---|---|---|
| LinkedIn version sunset (426) | #1187 (closed), #2005 (open, 2026-09) | Make the version configurable, alert on 426, bump it yearly |
| LinkedIn OAuth on one app: scopes and `prompt=none` | #1197, #1243, #1580, #1582 (open), #844 | Two apps, no `prompt`, and check the granted scopes |
| LinkedIn page connect overwrote the personal channel, losing scheduled posts | #1516, #2089 (open) | Keep `(business_id, ch)` separate and match by URN (A10) |
| Page listing missed content admins | #1234 | Include `CONTENT_ADMINISTRATOR` |
| LinkedIn special characters truncating or showing backslashes | #442, #1847 (open) | Escape `commentary` only. Live-test reserved characters |
| LinkedIn image posts failing | #1058, #2196 (open) | Processing wait (row 1). Single PUT |
| Duplicate posting from retries | #1321 (critical) | Persist `posted` first. Never retry around a create (row 2) |
| Unknown outcome on long uploads | #2011 (YouTube) | Radar's `unknown` copy is the right UX |
| X credits depleted shown as "Unknown Error" | #2231 (open), #1513 | 402 mapping plus operator alert (row 3) |
| X links stripped for cost | #1939, #1581 | Never alter text silently |
| X shared-app limits and blast radius | #1016, #2120 (open) | One app for all businesses is fine for v1. Watch per-user limits; one restricted app stops every business |
| X connect or auth breaks after upgrades | #1328, #1354, #1178 | Log the provider body excerpt (`err_detail`) on connect failures too |

**Not found:** no Postiz issues about X's Feb 2026 reply restriction, X 429 storms, or LinkedIn 60-day expiry.

---

## 7. Could not confirm

- **Rotating X OAuth 2.0 refresh tokens.** Postiz uses OAuth 1.0a, so it gives no real-world evidence about rotation races, the ~6-month lifetime, or "one live grant per app and user".
- **The Feb 2026 reply restriction.** There is no Postiz code or issue about it.
- **Bare domains on X.** Whether X bills a post with a bare domain (no scheme) at the $0.20 link price, and whether X always counts bare domains as 23 (`twitter-text` does).
- **The 10 s wait.** Why Postiz waits 10 s after a LinkedIn refresh, and whether a fresh LinkedIn token can briefly return 401.
- **Polling page images.** Whether a page token with Radar's scopes (`w_organization_social rw_organization_admin r_basicprofile`, without `r_organization_social`) can `GET /rest/images/{urn}`. Postiz's page token also carries `r_organization_social`.
- **LinkedIn errors.** The duplicate-post and text-too-long error shapes (status, code). Postiz doesn't map them.
- **LinkedIn's 3,000-character count.** Whether it counts UTF-16 units (Postiz uses `text.length`) or code points (Radar), and whether escape backslashes count.
- **The Advertising API route.** Whether the Advertising API product (Postiz's docs route) would give Radar's **profile** app refresh tokens without Community Management. That would remove the 60-day reconnect, but it may be a restricted use for organic posting. This is for the owner to ask LinkedIn, not to adopt.
- **Two businesses, one LinkedIn member.** Whether a second Radar business connecting the same LinkedIn member to the same page app invalidates the first token. Postiz's `oneTimeToken` sharing hints that grants are per member. Add it to the live-test list.
- **X Premium limit.** The current long-post limit (Postiz uses 4000).

---

## 8. Sources

**Postiz code** (prefix `P/` = `https://github.com/gitroomhq/postiz-app/blob/8603fdc3e8873a0e48cb23ab7b3c18b95f67ec33/`):
- `libraries/nestjs-libraries/src/integrations/social/x.provider.ts`:
  - `maxLength` L95;
  - `handleErrors` L152;
  - OAuth 1.0a L448–512;
  - chunked video L581;
  - upload retry L702;
  - image upload L718–790;
  - `checkPostStatus` L910;
  - `finalizePost` L1290;
  - `comment` L1441;
  - `postAnalytics` L1632.
- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`:
  - scopes L65;
  - `oneTimeToken`/`refreshWait` L62/L75;
  - `handleErrors` L108;
  - `refreshToken` L130;
  - `prompt=none` L186;
  - `checkScopes` L228;
  - `uploadPicture` L293–466;
  - `fixText` L496;
  - `prepareMediaBuffer` L657;
  - `buildPostContent` L690;
  - `createMainPost` L741–780;
  - comments L782;
  - `checkPostStatus` L888;
  - `finalizePost` L1008.
- `libraries/nestjs-libraries/src/integrations/social/linkedin.page.provider.ts`: scopes L28, `companies` L138, `reConnect` L169, `authenticate` L210.
- `libraries/nestjs-libraries/src/integrations/social.abstract.ts`: error classes L63–133, `fetch` L564–660, `checkScopes` L662.
- `libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`: the pending, ready and completed contract.
- `libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts`: L71–105.
- `libraries/helpers/src/utils/count.length.ts`.
- `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.2.ts`: L83, L118, L191, L312, L430, L546.
- `apps/orchestrator/src/workflows/missing.post.workflow.ts`.
- `apps/orchestrator/src/workflows/refresh.token.workflow.ts`.
- `apps/orchestrator/src/activities/post.activity.ts`: L578–640.
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts`: L36.
- `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts`: L400–444.
- `.env.example`: L68–72.

**Postiz docs:**
- https://docs.postiz.com/providers/x-twitter
- https://docs.postiz.com/providers/linkedin

**Postiz issues** (https://github.com/gitroomhq/postiz-app/issues/N): #442, #844, #1016, #1058, #1178, #1187, #1197, #1234, #1243, #1321, #1328, #1354, #1513, #1516, #1580, #1581, #1582, #1680, #1847, #1939, #2005, #2011, #2018, #2089, #2120, #2196, #2231.

**Platform docs checked for this note:**
- X create post (`made_with_ai`, `reply_settings`, `community_id`): https://docs.x.com/x-api/posts/create-post
- LinkedIn little text format (`HashtagElement ::= '#' SINGLE_WORD`; reserved characters): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
