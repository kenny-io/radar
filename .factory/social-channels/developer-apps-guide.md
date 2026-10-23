# Developer apps for X and LinkedIn: owner setup guide

Researched and written 2026-10-23 from the official docs (links in §8). These platforms change often, so re-check anything marked **to confirm** before relying on it.

`{APP_URL}` means your production Radar URL, for example `https://app.yourdomain.com`.

**Names are placeholders.** `architecture.md` did not exist when this was written, so the provider names (`x`, `linkedin`, `linkedin_page`) and the env var names below are placeholders, **to confirm** against the architect's choice. Radar already builds every OAuth callback as `{APP_URL}/api/oauth/{provider}/callback` (`src/server/env.ts`).

---

## 1. Read this first

1. **X "Reply now" will almost always be refused.** Since 23 Feb 2026, on every self-serve plan (pay-per-use and the legacy Free, Basic and Pro), an API reply is allowed only when the author of the original post @mentioned your account or quoted one of your posts. Otherwise X rejects it with a 403 error. Daily Brief replies go to strangers' threads, so most will fail. Only Enterprise access lifts this rule.
   - X's guidelines also say AI-generated replies need **prior approval from X**. That section is headed "AI-Generated Content & Replies". Its text and checklist only mention replies, under "For Automated Accounts", so it is unclear whether AI-drafted posts that a person reviews are covered too (to confirm). Before launch, send one Policy Support request covering both.
   - **Workaround:** open X's own reply box, prefilled (`https://x.com/intent/tweet?in_reply_to={post id}&text=…`). It is free and has no reply restriction. ([integration guide](https://docs.x.com/x-api/posts/manage-tweets/integrate), [announcement](https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909), [guidelines](https://docs.x.com/developer-guidelines), [web intents](https://docs.x.com/x-for-websites/web-intents/overview))
2. **X has no monthly plans for new developers. You prepay credits.**
   - **Prices:** $0.015 per post, **$0.20 per post that contains a link**, $0.01 per allowed ("summoned") reply. Reading posts (the Daily Brief search) costs $0.005 per post returned.
   - **No monthly post cap.** Rate limits still apply.
   - **One app can serve both jobs.** The app behind your existing `X_BEARER_TOKEN` can also handle sign-in and posting. ([pricing](https://docs.x.com/x-api/getting-started/pricing), [changelog](https://docs.x.com/changelog))
3. **The X scopes need `tweet.read` as well.** The official reference lists `tweet.read tweet.write users.read` for `POST /2/tweets` and `tweet.read users.read` for `GET /2/users/me`. Request `tweet.read tweet.write users.read media.write offline.access`. ([create post reference](https://docs.x.com/x-api/posts/create-or-edit-post), [scope map](https://docs.x.com/resources/fundamentals/authentication/guides/v2-authentication-mapping))
4. **Use a separate X app for local testing.**
   - **Localhost:** X's app docs say to use `http://127.0.0.1` for local callbacks, not `localhost`.
   - **One live connection per account:** one X docs page (the Ads MCP setup) says X keeps one live connection per app and per X account, so connecting the same X account from a second place cancels the first connection's tokens. This is stated only there, so treat it as to confirm. A separate dev app is sensible either way.
   - **Tokens rotate:** X tokens last 2 hours. Each refresh token works once, lasts about 6 months, and is replaced on every refresh. ([apps](https://docs.x.com/resources/fundamentals/developer-apps), [token exchange guide](https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange), [Ads MCP setup](https://docs.x.com/x-ads-api/mcp))
5. **LinkedIn needs two apps.**
   - LinkedIn says to request the Community Management API (company pages) only on a **new app that has no other products**.
   - Profile posting ("Share on LinkedIn") and sign-in ("Sign In with LinkedIn using OpenID Connect") therefore go on a second app. That means two sets of credentials.
   - Whether Community Management can share an app with Share/OpenID Connect **after** approval is not confirmed. ([Community Management overview FAQ](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview))
6. **LinkedIn profile connections expire after 60 days and can't be renewed in the background.**
   - LinkedIn gives programmatic refresh tokens only to approved Marketing Developer Platform partners. The self-serve "Share on LinkedIn" app gets a 60-day access token and no refresh token.
   - When it expires, the person must click Reconnect. Posts scheduled after that date are held until they do.
   - The page app (Community Management) should get refresh tokens that last 365 days. ([refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens), [authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow))
7. **The planned LinkedIn page scope is wrong.** Community Management grants `rw_organization_admin`, not `r_organization_admin`, which belongs to the Advertising and Lead Sync products. Use `w_organization_social rw_organization_admin`. ([Increasing access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access))
8. **Page posting needs two approvals from LinkedIn. Apply first; it takes longest.**
   - **Development tier** comes first. LinkedIn checks for a registered legal organization, a verified business email (not Gmail), a website and privacy policy, and an app verified by your Page's super admin. It allows 500 calls per app per day, for building and testing.
   - **Standard tier** (production) can only be requested **after Radar's page posting is built**. It needs a narrated screencast and a test login for LinkedIn's reviewers.
   - A rejection means starting again on a **new app**. LinkedIn publishes no review timeline. ([App review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review))
9. **LinkedIn images and text have their own rules.**
   - **Images:** JPG, PNG or GIF only. **No WEBP** (X accepts it). A multi-image post takes 2 to 20 images.
   - **Text:** post text uses LinkedIn's "little" format, where characters such as `( ) [ ] { } < > @ # * _ ~ | \` must be escaped.
   - **API version:** every call needs a `LinkedIn-Version` header. The latest is `202610`, and `202511` stops working on 16 Nov 2026. ([Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [little format](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format), [versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning))
10. **Costs.** LinkedIn's API is free. X is pay-as-you-go, so set a spending limit in the X Developer Console on day one.

---

## 2. Before you start

### What you need

| Item | Why | Notes |
|---|---|---|
| **The production `APP_URL`**, final domain | Every callback URL is built from it. Change the domain and you must update all three apps. | Use HTTPS. |
| **An X account that Radar the company controls** (for example your brand handle) | It owns the X developer account, the apps and the billing. | Use a human-managed account with two-factor sign-in. |
| **A payment card** for X credits | X API calls are prepaid. | Credit or debit card; prepaid cards don't earn X's $20 welcome credit. |
| **A LinkedIn Company Page for Radar** | Every LinkedIn developer app must be tied to a Page. Community Management requires the app to be verified by that Page's **super admin**. | Create one at linkedin.com/company/setup if you don't have one. |
| **A personal LinkedIn account** that is the Page's super admin, or can reach one | They approve the "verify app" link. | The approver sees your name, photo and title. |
| **A business email on your company domain** (for example `you@yourdomain.com`) | Required and verified for the Community Management application. "Personal email addresses won't pass." | Its domain should match your website. |
| **A registered legal organization**: legal name, registered address, website | Community Management is "only available to registered legal organizations for commercial use cases". | Have the exact registered name and address ready. |
| **Public `{APP_URL}/privacy` and `{APP_URL}/terms` pages** | Both platforms ask for them. LinkedIn checks for a "valid privacy policy" at Standard tier. | Radar already serves both. Before applying, add a few lines on what Radar does with X and LinkedIn data, and that disconnecting deletes the tokens. |
| **A square app logo**, PNG, at least 100 × 100 px (300 × 300 or larger is safer) | LinkedIn requires one. X shows the app name on every post. | **Must not contain any part of the LinkedIn or Microsoft names or logos** (for example "Linked" or "In"). |
| **A Radar test login for LinkedIn's reviewers** (later, for Standard tier) | LinkedIn asks for "test credentials" to try the app. | A demo business with Owner or Editor rights. |

### Budget

- **X:** start with $20–$50 of credits. Each plain post costs $0.015, each post with a link $0.20, and each Daily Brief scan about $0.50 (100 posts at $0.005). See §7 for a per-business estimate. New paying accounts get a one-time $20 credit after their first purchase, plus a match of the first auto-recharge up to $50. These free credits expire after 3 months. ([free credits](https://docs.x.com/x-api/getting-started/free-credits))
- **LinkedIn:** $0. No API fee.

### Order of work and timeline

| When | Step | Typical time |
|---|---|---|
| Day 1 | **LinkedIn page app (App 2)**: create it, get it verified by the Page super admin, submit the Community Management Development tier form. Do this first because review time is unknown. | 30 min of work, then wait. No official timeline; third-party reports range from 1–2 weeks to months. |
| Day 1 | **X**: developer account, credits, production app, dev app. | 30–45 min. Works immediately. |
| Day 1 | **LinkedIn profile app (App 1)**: create, add Share on LinkedIn and OpenID Connect. | 15 min. Both products are self-serve and instant. |
| Day 1 | Put the credentials in Railway (§5). | 10 min |
| After the build lands | Test each connection (§6). | 1 hour |
| After Development tier approval **and** the page feature is built | Record the screencast and submit the **Standard tier** form. | 1–2 hours of work, then wait. No official timeline. |
| After Standard tier approval | Turn page posting on for real customers. | — |

Until Standard tier is approved, only use page posting with your own pages, for testing. LinkedIn describes Development tier as being for building and testing, with Standard tier "for live production".

---

## 3. X: step by step

**What Radar will use:**
- OAuth 2.0 Authorization Code with PKCE, as a confidential client (Web App).
- Scopes: `tweet.read tweet.write users.read media.write offline.access`.
- Endpoints: `POST /2/tweets`, `POST /2/media/upload` (or the chunked upload) and `GET /2/users/me`.

**Plan to buy:** pay-per-use. It is the only plan the current docs describe. It covers posting, media upload, replies (within the restriction above) and recent search.

**Legacy plans:** the Feb 2026 launch post said Basic and Pro "remain available", but third-party sources say new sign-ups can't buy them. If your `X_BEARER_TOKEN` already sits on a legacy Basic or Pro plan, you can keep it. The reply restriction applies to those plans too.

### 3.1 Developer account and billing
1. Go to **https://console.x.com** and sign in with Radar's company X account.
2. Accept the **Developer Agreement and Policy**.
3. Complete the profile ("how you'll use the API"). Suggested text:
   > Radar is a content marketing tool for small businesses. Business owners connect their own X account and Radar posts the posts they write or approve, now or at a time they choose. Radar also reads recent public posts (recent search) to suggest conversations to the owner. Radar never posts without the user's action and never auto-replies.
4. **Billing:**
   1. Add a payment card and buy a first batch of credits (for example $25).
   2. Set a **spending limit per billing cycle**. Requests stop when it is reached, so pick a number you are comfortable with.
   3. Optional: turn on **auto-recharge** (amount plus threshold). Without it, posting stops when the balance reaches $0, and scheduled posts fail with "Try again later".

### 3.2 Production app ("Radar")
1. **Reuse the existing app if you can.** If an app already issued your `X_BEARER_TOKEN`, open it and use it here. One app can do both search and posting, and shares one credit balance.
2. **Otherwise create one.** In the Console, click **New App** (some accounts are asked to create a Project first; if so, create one named "Radar"). Name it **Radar**.
   - The app name and website URL appear as the "source label" on every post Radar creates.
3. Open the app → **User authentication settings** → **Set up** (or Edit).

   The field names below are those last documented for the X portal, so they are **to confirm** in the new Console.

   | Field | Choose / enter |
   |---|---|
   | App permissions | **Read and write** (not Direct Messages) |
   | Request email from users | Off |
   | Type of App | **Web App, Automated App or Bot**. This makes Radar a *confidential client*, which gets a Client Secret. |
   | Callback URI / Redirect URL | `https://{APP_URL host}/api/oauth/x/callback`, for example `https://app.yourdomain.com/api/oauth/x/callback`. **Exact match**, including any trailing slash. Up to 10 are allowed. |
   | Website URL | Your public marketing site, for example `https://yourdomain.com` |
   | Organization name / URL | Your company name / website |
   | Terms of service | `{APP_URL}/terms` |
   | Privacy policy | `{APP_URL}/privacy` |

4. Save.
5. Go to **Keys and tokens** → **OAuth 2.0 Client ID and Client Secret**.
   - Copy the **Client ID** into `X_CLIENT_ID` and the **Client Secret** into `X_CLIENT_SECRET` (names to confirm).
   - **Credentials are shown only once.** Store them in your password manager right away. If you lose them you must regenerate, which invalidates the old ones.
   - Don't confuse them with:
     - the **API Key & Secret**: OAuth 1.0a, not used by this feature;
     - the numeric **App ID**;
     - the **Bearer Token**: that one is `X_BEARER_TOKEN`, used by the Brief's search.
6. **Bearer token:** leave `X_BEARER_TOKEN` as it is if it came from this app. If you regenerate it, update Railway, because the old one stops working.

### 3.3 Development app ("Radar Dev")
Create a second app for local testing, with the same settings except the callbacks.

**Why a separate app:** X's docs recommend separate apps for development and production. One X page also says X keeps one live connection per app and per X account (to confirm). If so, connecting your own X account on your laptop with the production app would cancel your production connection for that account.

1. **New App** → name it **Radar Dev** → User authentication settings, as above.
2. Callback URLs (register both):
   - `http://127.0.0.1:3000/api/oauth/x/callback`. X's app docs say to use `127.0.0.1` for local work, not `localhost`.
   - `http://localhost:3000/api/oauth/x/callback`. Other X pages show `localhost` working, so register it too.
3. Put this app's Client ID and Secret in your **local** `.env` only, never in Railway.
4. When testing X locally, set `APP_URL=http://127.0.0.1:3000` and open Radar at that address. Don't use `localhost:3000`, because cookies set on one name aren't sent to the other.
5. Both apps draw on the same account credit balance (to confirm in the Console).

### 3.4 Scopes and what each one does
You don't pick scopes in the Console. Radar asks for them when someone connects. For reference:

| Scope | Why Radar needs it |
|---|---|
| `tweet.read` | Required alongside `tweet.write` for `POST /2/tweets`, and for `GET /2/users/me` |
| `tweet.write` | Create posts and replies |
| `users.read` | Read the connected account's name, handle and photo (`GET /2/users/me`) |
| `media.write` | Upload images (`POST /2/media/upload`) |
| `offline.access` | Get a refresh token so the worker can keep posting. Without it, access ends after 2 hours. |

### 3.5 Policy points the owner is agreeing to
- **Scheduled posts:** scheduled and on-behalf posting is fine. The guidelines treat scheduled informational posts as allowed, with two conditions: "No unsolicited @mentions. No identical cross-posting."
- **Same text on many accounts:** don't let Radar post the same text to many accounts. That counts as spam under the Developer Policy.
- **@mentions and quotes:** since Feb 2026, self-serve apps may only @mention or quote users who are already part of the conversation, in replies and in normal posts. Quote-posting through the API was removed from self-serve in April 2026.
- **Replies:** see §1, item 1. Two options:
  - Keep **Reply now** by opening X's reply box. No API call, no approval needed.
  - Keep API replies only for posts where the user's account was @mentioned or quoted, and request X's approval for AI-drafted replies through the Policy Support form (https://help.x.com/forms/platform) before launch.
- **AI-drafted posts (to confirm):** the guidelines' "AI-Generated Content & Replies" section says "Requires prior approval from X" before deployment. Its examples are all about replies, and Radar's posts are drafted by AI but reviewed and sent by a person. To be safe, use the same Policy Support form before launch. Describe both AI-drafted posts and replies, and say that a person reviews and clicks to send each one. Keep X's answer on file.
- **Source label:** your app name and website show on every post. Keep them accurate.

---

## 4. LinkedIn: step by step

**What Radar will use (plan: two apps):**

| | App 1: profile ("Radar") | App 2: company page ("Radar for Pages") |
|---|---|---|
| Products | Share on LinkedIn + Sign In with LinkedIn using OpenID Connect (self-serve, instant) | **Community Management API only** (needs LinkedIn's approval) |
| Scopes Radar requests | `openid profile w_member_social` | `w_organization_social rw_organization_admin` (plus `r_basicprofile` if Radar shows who connected the page) |
| Callback | `{APP_URL}/api/oauth/linkedin/callback` | `{APP_URL}/api/oauth/linkedin_page/callback` (name to confirm) |
| Env vars (to confirm) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `LINKEDIN_PAGE_CLIENT_ID`, `LINKEDIN_PAGE_CLIENT_SECRET` |
| Token life | Access token 60 days, **no refresh token** | Access token 60 days + refresh token 365 days (expected for approved Community Management apps) |

> **Option for the architect, not for you to decide:** the Community Management product also grants `w_member_social` and `r_basicprofile`. A single approved App 2 could therefore post as the person *and* as the page, with refresh tokens for both. The cost is that profile posting would also wait for LinkedIn's approval. App 1 is still worth creating now either way.

### 4.1 Before either app: your LinkedIn Page
1. Make sure Radar has a LinkedIn Company Page that shows the same legal name and website as your application details.
2. Make sure you know who the Page's **super admin** is (Page → Admin tools → Manage admins).

### 4.2 App 1: "Radar" (post as the person)
1. Go to **https://www.linkedin.com/developers/apps** → **Create app**.
2. Fill in the form:
   - **App name:** `Radar`. It must not include "LinkedIn", "Linked" or "In".
   - **LinkedIn Page:** pick Radar's Company Page.
   - **Privacy policy URL:** `{APP_URL}/privacy`.
   - **App logo:** your square logo.
   - **Legal agreement:** tick to accept the API Terms of Use.
   - Click **Create app**.
3. **Settings** tab → **Verify** → **Generate URL** → copy the link → send it to the Page super admin → they approve.
   - The link is valid for 30 days, unless the admin denies it.
   - A denial cancels every link for that app.
   - When it's done, the app shows as verified.
4. **Products** tab:
   - **Share on LinkedIn** → **Request access** → accept the terms. It is granted at once and gives `w_member_social`.
   - **Sign In with LinkedIn using OpenID Connect** → **Request access**. It is granted at once and gives `openid`, `profile` and `email`; Radar won't request `email`.
5. **Auth** tab → **OAuth 2.0 settings** → **Authorized redirect URLs for your app** → add:
   - `https://app.yourdomain.com/api/oauth/linkedin/callback` (your real `APP_URL`)
   - `http://localhost:3000/api/oauth/linkedin/callback` (local testing; to confirm the portal accepts `http://` for localhost, as LinkedIn's docs only mention HTTPS)

   The rules are that URLs must be absolute, can't contain `#`, and any `?query` is ignored. Click **Update**.
6. **Auth** tab → **Application credentials**:
   - copy **Client ID** into `LINKEDIN_CLIENT_ID`;
   - copy **Primary Client Secret** into `LINKEDIN_CLIENT_SECRET`.

   Keep them secret. Never put the secret in a URL.
7. On the **Auth** tab, check that **OAuth 2.0 scopes** lists `openid`, `profile`, `email` and `w_member_social`.

What to expect: LinkedIn does not give this app refresh tokens. Each person's connection lasts **60 days**, then they must click Reconnect in Radar. If they're still signed in to LinkedIn and the old token hasn't expired yet, LinkedIn skips the consent screen. It is still a click in the browser, though, so the background worker can't do it on its own.

### 4.3 App 2: "Radar for Pages" (post as the company page)
**Do this on a brand-new app, and add no other product to it.** LinkedIn's FAQ: "Only request Community Management API Development Tier access with new developer applications that don't have access to other API products."

1. **Create app** again. Same LinkedIn Page, privacy URL and logo. Name it, for example, `Radar for Pages`.
2. **Settings** → **Verify** → send the new link to the Page super admin, as in 4.2 step 3. Verification is per app.
3. **Products** tab → **Community Management API** → **Request access**. If the button is greyed out, the app already has another product; start a fresh app.
4. Fill in the **Development tier access request form**. Have ready:
   - **business email** on your domain (LinkedIn emails a verification link, so check spam, promotions and social tabs);
   - **legal organization name**, **registered address**, **website**;
   - **privacy policy URL** (`{APP_URL}/privacy`);
   - **use case**: choose **Page Management**. Choose **Profile Management** as well only if the architect picks the single-app option.
5. **Suggested use-case description** (edit to taste; keep it factual):
   > Radar (https://yourdomain.com) is a content marketing application for small businesses, operated by {Legal name}. A business owner connects a LinkedIn Company Page they administer through LinkedIn OAuth. Radar lists the Pages where the member is an ADMINISTRATOR (organizationAcls) so the owner can pick one, then lets the owner publish organic posts to that Page as the organization: text plus optional images, either immediately or at a time the owner schedules. Each post is written or approved by the owner in Radar; Radar does not post without the owner's action. Radar stores only the access and refresh tokens (encrypted), the organization URN, name and logo, and the URNs of posts it created, so it can link to them. Radar does not read, store or display comments, reactions, member profiles or follower data, does not export LinkedIn data, and does not use LinkedIn data for advertising, sales, recruiting or lead generation. Owners can disconnect at any time, which deletes the tokens.
6. Submit and wait for the email.
   - **If it's rejected,** read the reason, fix it, then **create a new app** and apply again. LinkedIn won't let you re-apply on the same app.
7. **After Development tier approval:**
   1. **Auth** tab → add the redirect URLs:
      - `https://app.yourdomain.com/api/oauth/linkedin_page/callback`
      - `http://localhost:3000/api/oauth/linkedin_page/callback`
   2. **Auth** tab → copy the credentials into `LINKEDIN_PAGE_CLIENT_ID` and `LINKEDIN_PAGE_CLIENT_SECRET`.
   3. Check that the **OAuth 2.0 scopes** include `w_organization_social` and `rw_organization_admin`.
8. **Development tier limits:**
   - 500 API calls per app per day and 100 per member per day; batch lookups and webhooks are off.
   - You're expected to finish building within 12 months.

   This is enough for testing on your own Page.

### 4.4 Standard tier (production page posting)
Request this only when Radar's page posting works end to end. In the Developer Portal, go to **My Apps → App 2 → Products** and open the **Standard tier access request form**.

**Prepare:**
- **Overviews:** a company overview, a product overview and the use-case description (reuse the text above).
- **Test credentials:** a Radar login LinkedIn's reviewers can use. Use a demo business with Owner or Editor role and nothing sensitive in it.
- **A screen recording.** It must be high resolution and downloadable, show only Radar's screens, and narration is recommended. Show, in order:
  1. In Radar: Settings → Social accounts → **Connect LinkedIn page** → the full LinkedIn consent screen → back in Radar → pick the Page.
  2. Write a post, then **Post now** to the Page: text, then one with images. Open **View on LinkedIn** to show the live post.
  3. **Schedule** a post and show it on the Calendar. Optionally, show it after it went out.
  4. Say clearly that Radar does **not** display comments on the post and does not show any commenter's profile data. LinkedIn's checklist asks you to demonstrate these, and says to note it in the recording if your app doesn't have the feature.
  5. Show the only LinkedIn data Radar displays: the Page name and logo (and the connecting member's name, if shown).
  6. **Disconnect**, and show that the Page is gone from Radar.
- Note that LinkedIn may re-review if the app's functionality changes significantly later.

---

## 5. Put the credentials in Railway

**Never paste real values into this guide, a ticket or chat.** Use your password manager, then Railway's Variables screen.

Both the **web** and the **worker** service need the same values:
- The web service runs the connect and callback flow and "Post now".
- The worker sends scheduled posts and refreshes tokens.

| Variable (names to confirm) | Value from | web | worker |
|---|---|---|---|
| `X_CLIENT_ID` | X Console → Radar (production app) → Keys and tokens → OAuth 2.0 Client ID | ✓ | ✓ |
| `X_CLIENT_SECRET` | same place → Client Secret | ✓ | ✓ |
| `X_BEARER_TOKEN` | existing; unchanged unless you regenerated it | ✓ | ✓ |
| `LINKEDIN_CLIENT_ID` | LinkedIn App 1 → Auth → Client ID | ✓ | ✓ |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn App 1 → Auth → Primary Client Secret | ✓ | ✓ |
| `LINKEDIN_PAGE_CLIENT_ID` | LinkedIn App 2 → Auth → Client ID (after Development tier approval) | ✓ | ✓ |
| `LINKEDIN_PAGE_CLIENT_SECRET` | LinkedIn App 2 → Auth → Primary Client Secret | ✓ | ✓ |
| `LINKEDIN_API_VERSION` (suggested, to confirm) | `202610` today. Bump it at least once a year, because each version is supported for about one year. | ✓ | ✓ |
| The social feature flag (name to come from the architect) | Off until you're ready | ✓ | ✓ |

**Already set; must be identical on both services:** `APP_URL` and `RADAR_SECRET_KEY`. The worker can't decrypt stored tokens without the same key.

**How:**
1. In Railway, open the project, then the **web** service → **Variables** → **New Variable** (or **Raw Editor** to paste several at once).
2. Repeat for the **worker** service. Alternatively, define them once as project **Shared Variables** and add the references to both services.
3. Railway redeploys the services after a variable change. Wait for both to finish.
4. Put the **Radar Dev** X credentials only in your local `.env`, never in Railway.

---

## 6. Test checklist (once the build lands)

Use a real account you own, and post to it, not to a customer's account.

### X
- [ ] **Connect** X → the X consent screen shows the app name "Radar" and the permissions → Radar shows "● Connected" with your handle.
- [ ] **Post now** with text only → **View on X** opens `https://x.com/{handle}/status/{id}`.
- [ ] Post now with 1 image, then with 4 images. Try a PNG, a JPG and a WEBP.
- [ ] Post now with an image over 5 MB → Radar blocks it with **Compress images**.
- [ ] Post with a link → in the X Console usage page, the cost is about $0.20 (and about $0.015 without a link).
- [ ] **Schedule** a post 10 minutes ahead → the worker sends it on time, once.
- [ ] Wait **more than 2 hours**, then schedule another → it still sends. This proves token refresh works.
- [ ] **Reply now** on a post that does **not** mention your account → Radar shows a readable error (or opens X's reply box, if the design changes). It must not show a silent failure.
- [ ] Revoke Radar on X's connected apps page (https://x.com/settings/connected_apps) → the next send fails, the account shows "Reconnect needed", and **Reconnect** restores held posts.
- [ ] **Disconnect** → the toast counts the unscheduled posts.
- [ ] Check the X Console for usage and cost per endpoint, and that the spending limit is set.

### LinkedIn profile (App 1)
- [ ] **Connect LinkedIn profile** → the consent screen shows "Radar" → your name and photo appear.
- [ ] Post now with text only, then with text containing `( ) [ ] # @ * _ ~` and a bullet list → the post on LinkedIn shows every character, with nothing cut off.
- [ ] Post with 1 image, 2 images and 9 images. A WEBP must be converted or blocked before sending.
- [ ] **View on LinkedIn** opens `https://www.linkedin.com/feed/update/{post URN}/`.
- [ ] Schedule a post 10 minutes ahead → it sends once.
- [ ] Radar shows when the connection expires (60 days) or warns when you schedule past it (exact behaviour per the final design).
- [ ] Remove Radar at **LinkedIn → Settings → Data privacy → Permitted services** → the next send fails → "Reconnect needed" → Reconnect works.

### LinkedIn page (App 2, Development tier)
- [ ] **Connect LinkedIn page** → consent → a picker lists the Pages where you are an admin → pick one.
- [ ] Sign in with a LinkedIn account that manages **no** Pages → Radar shows the "no pages" message and connects nothing.
- [ ] Post now to the Page (text, then images) → View on LinkedIn opens the post on the Page.
- [ ] Schedule a Page post → it sends once.
- [ ] Developer Portal → App 2 → **Token Inspector**: the token shows as active, and you can see that a refresh token was issued (TTL about 365 days).
- [ ] Developer Portal → App 2 → **Analytics**: daily call count stays well under 500.
- [ ] Connect the profile, then the page, for the same LinkedIn member → **both** keep working. This catches the "new scope cancels old tokens" problem if both ever run on one app.

---

## 7. Limits and costs

### Summary

| | X (pay-per-use) | LinkedIn profile (App 1) | LinkedIn page (App 2) |
|---|---|---|---|
| Plan or tier | Pay-per-use credits (default since 6 Feb 2026). Enterprise by application only. | Self-serve: Share on LinkedIn + OpenID Connect | Community Management: Development tier, then Standard tier (approval each) |
| Cost | Post $0.015; **post with a link $0.20**; summoned reply $0.01; post read $0.005; user read $0.010. Media upload has no listed price. Spending limit and auto-recharge available. | Free | Free |
| Monthly post cap | None stated for writes. Reads are capped at 3M posts per month. | Not published | Not published |
| Rate limits, posting | `POST /2/tweets`: **100 per 15 min per user** and **10,000 per 24 h per app** (rate-limit page). The integration guide instead says 200 per 15 min and 300 per 3 h, so the pages disagree. | Not published; visible in the app's **Analytics** tab, which resets at midnight UTC | **Development tier: 500 calls per app per day and 100 per member per day**, no batch calls. Standard tier: "no restrictions" (real limits in Analytics). |
| Rate limits, media | `POST /2/media/upload`: 500 per 15 min per user, 50,000 per 24 h per app. Chunked init/append/finalize: 1,875 per 15 min per user, 180,000 per 24 h per app. | Counted with the calls above | Counted with the 500/100 per day above |
| Access token | 2 hours | 60 days | 60 days |
| Refresh token | With `offline.access`: about 6 months, **single use, rotates on every refresh** | **None** (MDP partners only). The person reconnects every 60 days. | Expected: 365 days, fixed from first sign-in; refreshing doesn't extend it. Then the person reconnects. |
| Revocation | `POST https://api.x.com/2/oauth2/revoke` (app side); users at x.com connected apps | Users at LinkedIn Permitted services; LinkedIn may also revoke at any time | Same as App 1 |
| Images per post | Up to 4 photos (or 1 GIF, or 1 video) | 1 image (`content.media`), or 2–20 with MultiImage | Same as App 1 |
| Image formats and size | JPG, PNG, GIF, WEBP; **5 MB** per image (animated GIF 15 MB) | **JPG, PNG, GIF only**; under 36,152,320 pixels; GIF ≤ 250 frames; no byte cap documented | Same as App 1 |
| Text | 280 characters (standard accounts) | 3,000 characters in LinkedIn's app. The API doc gives no number, only a `FIELD_LENGTH_TOO_LONG` error. Reserved characters need escaping. | Same as App 1 |

### X cost examples (per business, per month)
- 30 posts, half with a link to the article: 15 × $0.015 + 15 × $0.20 ≈ **$3.23**.
- Daily Brief X search, 30 scans × 100 posts × $0.005 ≈ **$15.00**. Repeat reads of the same post within a UTC day aren't charged twice, so it can be less.
- Connect, refresh and `users/me` calls are small. A user read is $0.010.

---

## 8. Sources

All read on **2026-10-23**. Where pages contradicted each other or looked out of date, it is noted.

### X
- Pricing (pay-per-use rate card, 3M read cap, spending limits, auto-recharge, deduplication): https://docs.x.com/x-api/getting-started/pricing
- Free credit incentives ($20 / up to $50; expire after 3 months; rule updated 13 Oct 2026): https://docs.x.com/x-api/getting-started/free-credits
- Changelog (6 Feb 2026 pay-per-use launch; 23 Feb 2026 reply restriction; 20 Apr 2026 price change, $0.20 URL posts, quote-posts removed; 21 Sep 2026 token exchange; 2 Oct 2026 free credits): https://docs.x.com/changelog
- Announcement, 23 Feb 2026, "Addressing LLM-generated spam" (replies, @mentions, quotes; self-serve only): https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909
- Announcement, 16 Apr 2026, pricing update: https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025
- Announcement, 6 Feb 2026, pay-per-use launch ("Basic & Pro Plans: These tiers remain available"; third-party sources say they're closed to new sign-ups, unconfirmed): https://devcommunity.x.com/t/announcing-the-launch-of-x-api-pay-per-use-pricing/256476
- Manage Posts integration guide ("Post creation restrictions (self-serve)"; rate limits 200/15 min and 300/3 h, which differs from the rate-limit page; its line saying v2 can't fully upload media is **out of date**): https://docs.x.com/x-api/posts/manage-tweets/integrate
- Manage Posts introduction (summoned replies, 1 cashtag): https://docs.x.com/x-api/posts/manage-tweets/introduction
- Create Post reference (OpenAPI scopes `tweet.read users.read tweet.write`; `media_ids` max 4; quote-posting Enterprise only): https://docs.x.com/x-api/posts/create-or-edit-post
- v2 authentication mapping (scopes per endpoint): https://docs.x.com/resources/fundamentals/authentication/guides/v2-authentication-mapping
- OAuth 2.0 Authorization Code with PKCE (2-hour token, `offline.access`, confidential clients, exact-match redirect, 30-second auth code): https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
- OAuth 2.0 user access token steps (token, refresh, revoke endpoints): https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
- OAuth 1.0a → 2.0 token exchange (refresh token about 6 months, single use): https://docs.x.com/fundamentals/authentication/oauth-2-0/oauth-1-0a-token-exchange
- Apps (app types, callback rules: exact match, max 10, `127.0.0.1` not `localhost`): https://docs.x.com/resources/fundamentals/developer-apps
- Ads MCP setup (single live grant per app and user; `localhost` callbacks listed, which conflicts with the Apps page; X rejects `client_secret_post`): https://docs.x.com/x-ads-api/mcp
- Getting access (console.x.com, credentials shown once): https://docs.x.com/x-api/getting-started/getting-access
- Developer Console: https://docs.x.com/resources/fundamentals/developer-portal
- Rate limits (per endpoint): https://docs.x.com/x-api/fundamentals/rate-limits
- Media introduction and best practices (5 MB images; JPG/PNG/GIF/WEBP; 4 photos): https://docs.x.com/x-api/media/introduction and https://docs.x.com/x-api/media/quickstart/best-practices
- Upload media reference (`POST /2/media/upload`, scope `media.write`): https://docs.x.com/x-api/media/upload-media
- Chunked media upload (initialize/append/finalize): https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- Developer guidelines (scheduled posts; AI-generated replies need prior approval). The "Allowed?" icons don't render as text, so the statuses were read from the "Why" notes: https://docs.x.com/developer-guidelines
- Developer Policy (Automation Rules, no cross-account duplicates): https://docs.x.com/developer-terms/policy
- Web Intents (reply intent, no app needed): https://docs.x.com/x-for-websites/web-intents/overview
- X Automation Rules: https://help.x.com/en/rules-and-policies/x-automation. **Could not be read** (bot check); the policy points above come from docs.x.com.

### LinkedIn
- Getting access (open self-serve permissions: `profile`, `email`, `w_member_social`; page updated 2025-06-26): https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
- Authorization Code Flow (redirect URL rules; 30-minute auth code; 60-day tokens; a new scope set cancels earlier tokens; programmatic refresh "for a limited set of partners"): https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- Programmatic refresh tokens ("for all approved Marketing Developer Platform (MDP) partners"; 365-day refresh; the sample shows `expires_in: 86400` although the text says 60 days; page updated 2025-05-31): https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- Token introspection / Token Inspector: https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection
- Sign In with LinkedIn using OpenID Connect (`/v2/userinfo`, pairwise `sub`): https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
- Share on LinkedIn (`w_member_social`; still documents the older `/v2/ugcPosts`; Radar should use `/rest/posts`): https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- Profile API (`/v2/me` with `r_basicprofile`; member IDs are unique per app): https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api
- Community Management overview (tiers; FAQ: request only on new apps with no other products; Development tier 500/100 calls; page updated 2026-05-15): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- Community Management migration guide FAQ (Community Management and the Ads API can share one app after approval; says nothing about Share or OpenID Connect): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide
- Increasing access (product → permission table; Community Management grants `rw_organization_admin`, `w_organization_social`, `w_member_social`, `r_basicprofile`, …; tier limits): https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
- Community Management App Review (vetting requirements, screencast checklist, reapply only with a new app; page updated 2026-02-11): https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- Marketing Quick Start (Standard tier needs a form, a screen recording and test credentials; page updated 2026-08-17): https://learn.microsoft.com/en-us/linkedin/marketing/quick-start
- Integration requirements for Community Management (technical sign-off list, applies to partners working with LinkedIn's business development team): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/integration-requirements-community-management
- Tips to get started (up to 5 test profiles and their rules; versioning header): https://learn.microsoft.com/en-us/linkedin/marketing/tips-to-get-started
- Restricted uses: https://learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases
- Data storage requirements (authenticated member's profile: no limit; organization profile data: 8 weeks): https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements
- Posts API (`/rest/posts`, headers, `x-restli-id`, post URL `https://www.linkedin.com/feed/update/{urn}/`; page updated 2026-05-13): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- Posts API schema: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema
- Images API (`initializeUpload`; JPG/PNG/GIF; pixel limit; a `w_member_social`-only token can't GET images on the versioned API): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
- MultiImage API (2–20 images): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api
- little Text Format (reserved characters): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format
- Organization Access Control (`/rest/organizationAcls?q=roleAssignee`, roles): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- Versioning (latest `202610`; 202511 sunsets 16 Nov 2026): https://learn.microsoft.com/en-us/linkedin/marketing/versioning
- Rate limiting (daily, reset at midnight UTC, shown in the Analytics tab): https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
- LinkedIn Help: send an app verification request to a Page super admin: https://www.linkedin.com/help/learning/answer/a1665329
- Logo size (square, at least 100 px), from a different LinkedIn product's quickstart: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/verified-on-linkedin/guides/quickstart
- Third-party, unverified: Community Management review times (vendor blogs report 1–2 weeks to several months), for example https://www.getphyllo.com/post/linkedin-api-access-in-2026-partner-program-approval-timeline-alternatives and https://postproxy.dev/blog/linkedin-api-automate-company-page-publishing/

---

## Appendix: notes for the build team

Short version of the findings that affect the design. Each has a source in §8.

- **X replies.** Self-serve `POST /2/tweets` replies return 403 unless the original author @mentioned or quoted the replying account. AI-generated replies need X's prior approval. Fallback: the web intent `https://x.com/intent/tweet?in_reply_to={id}&text={urlencoded}`.
- **X: AI-drafted content (to confirm).** The guidelines' "AI-Generated Content & Replies" section requires prior approval from X. It is unclear whether reviewed, AI-drafted posts are covered as well as replies. The owner should ask X before launch.
- **X @mentions and quotes.** These are restricted in ordinary posts too, and `quote_tweet_id` is Enterprise-only. Preflight should warn about @handles.
- **X scopes.** Add `tweet.read`. Full set: `tweet.read tweet.write users.read media.write offline.access`.
- **X token endpoint.** `POST https://api.x.com/2/oauth2/token` with an HTTP Basic auth header (client id:secret); `client_secret_post` is rejected. The auth code expires in **30 seconds**, so exchange it immediately. Authorize URL: `https://x.com/i/oauth2/authorize`. Refresh tokens are single use and rotate (about 6 months). Serialize refreshes per account (web and worker) and save the new pair atomically, or a race will mark the account expired.
- **X: one live grant per app and X account (to confirm).** Stated only on the Ads MCP setup page, in the context of MCP clients. If it holds for Radar, connecting the same X account in a second Radar business (or on a dev machine using the production app) cancels the first connection's tokens. Use a separate Radar Dev app either way. Test this before deciding whether to warn when the same X user id is connected in two businesses.
- **X local callbacks.** The docs say `127.0.0.1`, not `localhost`. `oauthRedirect()` is built from `APP_URL`, so local X testing needs `APP_URL=http://127.0.0.1:3000`.
- **X cost.** Posts containing a URL cost $0.20 against $0.015. Consider logging per-post cost the way `ai_calls` logs AI costs.
- **X media.** Simple `POST /2/media/upload` (multipart or base64 JSON, `media_category=tweet_image`) is fine for images ≤ 5 MB; chunked is required for video. Use the string media id. Up to 4 per post.
- **X post URL.** `https://x.com/{username}/status/{id}` (or `https://x.com/i/web/status/{id}`).
- **LinkedIn: two apps** (Community Management requested only on a clean app). Person IDs are **unique per app**, so the same person has different `urn:li:person` IDs in App 1 and App 2. Match page reconnects by organization URN, and profile reconnects by App 1's `sub`.
- **LinkedIn page scopes.** Use `w_organization_social rw_organization_admin`, not `r_organization_admin`. `/v2/userinfo` needs `openid profile`, which the Community Management app doesn't have; use `/v2/me` with `r_basicprofile` if you need the connecting member's name there.
- **LinkedIn: a new scope set cancels earlier tokens for that member on the same app.** If profile and page ever share App 2, both connect flows must request the identical scope string.
- **LinkedIn profile tokens.** No refresh token on App 1; the access token lasts 60 days. Store `expires_at`, warn before expiry, warn when scheduling past expiry, and hold posts (the existing "expired" state) rather than failing them. Page tokens on App 2: refresh token 365 days, fixed from first consent, so a reconnect is still needed yearly. Docs suggest a "heartbeat" check (`introspectToken` or `/v2/me`).
- **LinkedIn posting.** Use `POST https://api.linkedin.com/rest/posts` with headers `LinkedIn-Version: 202610` (suggest a `LINKEDIN_API_VERSION` env var, like `SHOPIFY_API_VERSION`), `X-Restli-Protocol-Version: 2.0.0` and `Content-Type: application/json`.
  - **Author:** `urn:li:person:{sub}` or `urn:li:organization:{id}`.
  - **Post id:** comes back in the `x-restli-id` response header (`urn:li:share:…` or `urn:li:ugcPost:…`).
  - **Post URL:** `https://www.linkedin.com/feed/update/{urn}/`.
- **LinkedIn text.** `commentary` is "little" format. Escape `| { } @ [ ] ( ) < > # \ * _ ~` with a backslash, or posts fail or render cut off. Article link previews are not scraped; set `content.article` fields yourself, or just leave the link in the text.
- **LinkedIn images.**
  - **Upload flow:** `POST /rest/images?action=initializeUpload` with the owner set to the author URN, then PUT the bytes to `uploadUrl`, then reference `urn:li:image:…`.
  - **Image count:** 1 image → `content.media.id`; 2–20 → `content.multiImage.images[]`.
  - **Formats:** JPG, PNG and GIF only (convert WEBP); under 36,152,320 pixels.
  - **Processing check:** a `w_member_social`-only token can't GET `/rest/images` on the versioned API, so you can't poll processing status for profile posts. Retry the post on a processing error instead.
  - **Expiry:** upload URLs expire, so upload at send time, not at schedule time.
- **LinkedIn page list.** `GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`. Note that `w_organization_social` also allows CONTENT_ADMIN and DIRECT_SPONSORED_CONTENT_POSTER roles to post, if the product wants to include them. Development tier forbids BATCH_GET, so fetch organization names and logos one at a time. Organization name and logo may be stored for 8 weeks, so refresh them periodically.
- **LinkedIn Development tier.** 500 calls per app per day and 100 per member per day. Fine for testing; not for production.
