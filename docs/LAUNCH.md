# Launch checklist — running Radar as a live product

Everything you need to create, configure and provide. Env var names match `.env.example`.
`{APP_URL}` = your production URL. Radar's production URL is **`https://radar.thally.io`** (set `APP_URL` to exactly this on web and worker), so e.g. the X callback is `https://radar.thally.io/api/oauth/x/callback`.

---

## 1. Infrastructure (required)

- [ ] **Domain** for the app (e.g. `app.yourdomain.com`) and a **sending domain** for email.
- [ ] **Postgres 16** — managed (Neon, Supabase, Railway, RDS…). → `DATABASE_URL`
- [ ] **Host with two always-on processes** (Railway, Render, Fly.io, a VM…):
  - Web: `npm run build && npm start`
  - Worker: `npm run worker` (jobs + the minute scheduler — drafting, publishing, Brief scans, GSC sync, AI visibility, link checks, auto packs)
  - Not a fit: serverless-only hosting (e.g. Vercel alone) — the worker must run continuously. You can put the web on Vercel and the worker elsewhere, sharing the DB.
- [ ] **Object storage** (logos, generated images) — S3, Cloudflare R2 or any S3-compatible bucket with public read on objects. → `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT` (R2/others), `S3_PUBLIC_URL`, plus `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Local disk only works on a single persistent server.
- [ ] Core env: `APP_URL`, `RADAR_SECRET_KEY` (generate: `openssl rand -base64 48` — keep it forever; it decrypts stored tokens), `NODE_ENV=production`. Make sure `RADAR_DEV_STUBS` is **unset/0**.
- [ ] Run `npm run db:migrate` on every deploy.
- [ ] `CRAWLER_USER_AGENT` — point the URL at a real page describing the Radar bot (e.g. `RadarBot/1.0 (+https://yourdomain.com/bot)`).

## 2. Google — sign-in + Search Console (required)

- [ ] Google Cloud project → enable **Google Search Console API**.
- [ ] OAuth consent screen: app name, logo, support email, privacy policy + terms URLs, authorized domain.
- [ ] Scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/webmasters.readonly`.
- [ ] OAuth client (Web application). Authorized redirect URIs:
  - `{APP_URL}/api/auth/google/callback`
  - `{APP_URL}/api/oauth/gsc/callback`
- [ ] → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [ ] **Submit for Google verification.** `webmasters.readonly` is a sensitive scope: until verified, only listed test users (max 100) can connect, and they see an "unverified app" warning.

## 3. AI models (required — at least the defaults)

Defaults per business: writing = GPT-6 Sol (OpenAI), research = Claude Opus 5.5 (Anthropic). Users can switch in Settings → AI models, so add all three if you want every option to work.
- [ ] **OpenAI** API key (also used for Photography/Illustration images and the ChatGPT visibility column) → `OPENAI_API_KEY`
- [ ] **Anthropic** API key (also the Claude visibility column) → `ANTHROPIC_API_KEY`
- [ ] **xAI** API key (Grok models + the Grok visibility column) → `XAI_API_KEY`
- [ ] Verify model ids against your live keys (DIVERGENCES #4); override with `AI_MODEL_MAP` if any differ. Image model: `OPENAI_IMAGE_MODEL` (default `gpt-image-1`).
- [ ] Set billing limits/alerts on each provider. Cost per call is logged in the `ai_calls` table.
- [ ] *(Optional, recommended)* **OpenRouter** API key → `OPENROUTER_API_KEY`. Makes OpenRouter the first route for every AI call, image and AI Visibility check; the direct keys above become automatic fallback (and can be left out — models then run on OpenRouter only). Keep `PERPLEXITY_API_KEY` (§5) even with OpenRouter: Daily Brief's Reddit/LinkedIn/Quora/X search calls Perplexity's Search API directly (without it, the Brief falls back to the research model's web search, which finds fewer real threads). Optional overrides: `OPENROUTER_MODEL_MAP` (catalogue id → OpenRouter id, `""` disables one), `OPENROUTER_IMAGE_MODEL` (default `google/gemini-nano-banana-2.1`), `OPENROUTER_VIS_MODELS` (engine → model). Set a credit limit on the OpenRouter key; `ai_calls.provider` reads `openrouter` for calls it served.

## 4. Data providers

- [ ] **DataForSEO** (keyword volume, difficulty, related keywords, competitor gaps) — required for the calendar and keyword estimates. → `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`. Without it, keywords stay "Estimating…".
- [ ] **YouTube Data API v3** — enable in the same Google Cloud project, create an API key (restrict it to that API). → `YOUTUBE_API_KEY`
- [ ] **Open PageRank** (free 30k domains/month, backlink authority) — now run by Keywords Everywhere: sign in at keywordseverywhere.com/openpagerank and create an Open PageRank key (`opr_live_…`; old DomCop keys no longer work) → `OPENPAGERANK_API_KEY`

## 5. AI Visibility engines

ChatGPT, Claude and Grok reuse the keys from §3. With `OPENROUTER_API_KEY` set, all five engines (Perplexity and Gemini included) are asked through OpenRouter first, so the two keys below become fallbacks for the visibility columns. `PERPLEXITY_API_KEY` is still used directly by Daily Brief search either way (§3). Add:
- [ ] **Perplexity** API key → `PERPLEXITY_API_KEY`
- [ ] **Google Gemini** API key (AI Studio) → `GEMINI_API_KEY`
- [ ] Check the queried model ids: `VIS_CHATGPT_MODEL`, `VIS_PERPLEXITY_MODEL`, `VIS_GEMINI_MODEL`, `VIS_CLAUDE_MODEL`, `VIS_GROK_MODEL`.
- Missing keys aren't fatal — those cells show "No data", never "not mentioned".

## 6. Daily Brief sources

- [ ] **Reddit** app (reddit.com/prefs/apps, type "web app"; app-only OAuth) → `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT` (format `web:radar:1.0 (by /u/youraccount)`). Commercial use requires Reddit's data API agreement — apply.
- [ ] **X API** project on a paid tier with recent search → `X_BEARER_TOKEN`
- Hacker News needs nothing. LinkedIn and Quora use the research model's web search (needs approval — DIVERGENCES #1/#2).

## 7. Blog connectors (per platform you want to offer)

WordPress (self-hosted), Ghost, Webhook and Framer need nothing from you — users enter their own credentials. For the OAuth platforms, create an app on each and set its redirect URI to `{APP_URL}/api/oauth/{provider}/callback`:

| Platform | Where | Redirect provider | Scopes / permissions | Env |
|---|---|---|---|---|
| Webflow | Webflow workspace → Apps & integrations → create Data client app | `webflow` | `sites:read sites:write cms:read cms:write` | `WEBFLOW_CLIENT_ID/SECRET` |
| Notion | Notion Developer portal → new **public** connection (steps in §7.2) | `notion` | Read, Update and Insert content; no comments; no user information | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` |
| Wix | Wix Dev Center → new app with Blog permissions (manage blog/draft posts) | `wix` | Wix Blog | `WIX_CLIENT_ID/SECRET` |
| Shopify | Shopify Partners → app (public or custom distribution) | `shopify` | `read_content,write_content` | `SHOPIFY_CLIENT_ID/SECRET`, `SHOPIFY_API_VERSION` |
| WordPress.com | developer.wordpress.com/apps → Create New Application (steps in §7.1) | `wpcom` | `global` (Radar sends it; nothing to tick in the app) | `WPCOM_CLIENT_ID`, `WPCOM_CLIENT_SECRET` |
| Next.js blog (GitHub) | GitHub → Developer settings → OAuth App | `github` | `repo` | `GITHUB_CLIENT_ID/SECRET` |

Public Shopify and Wix apps go through store/marketplace review before arbitrary merchants can install them.

A platform whose app isn't configured is hidden from the "Add a blog connection" picker, so nothing shows until its env vars are set on **web and worker**. The callback only matches when `APP_URL` is exactly `https://radar.thally.io`.

### 7.1 WordPress.com

- [ ] Sign in at **developer.wordpress.com/apps** with the WordPress.com account that will own the app, then choose **Create New Application**.
  - **Name:** Radar. **Description:** "Publishes articles you approve in Radar to your WordPress.com site." **Website URL:** `https://radar.thally.io`.
  - **Redirect URL:** `https://radar.thally.io/api/oauth/wpcom/callback` (exact match, https).
  - **Type:** Web.
- [ ] Open the app and copy **Client ID** → `WPCOM_CLIENT_ID` and **Client Secret** → `WPCOM_CLIENT_SECRET`. Set both on web and worker, then redeploy.
- Radar requests the `global` scope so its site picker can list every site the account can publish to. WordPress.com's own docs advise least privilege; a narrower scope would give a single-site token chosen on WordPress.com's consent screen instead.
- Tokens have no refresh token. If WordPress.com expires or revokes one, the connection shows **Needs reconnecting** and the user reconnects.
- WordPress.com shares posts to the site's connected social accounts (Jetpack Social / Publicize) when they're published, as it does for posts published in its own editor.

### 7.2 Notion

- [ ] In the **Notion Developer portal** (app.notion.com/developers/connections, reachable from notion.so/profile/integrations), create a **new public connection**.
  - **Installation scope:** **Any workspace**. This can't be changed later.
  - **Basic information:** name Radar, logo, website `https://radar.thally.io`, plus the privacy policy, terms of use and support email the form asks for (see §9).
  - **OAuth configuration → Redirect URIs:** `https://radar.thally.io/api/oauth/notion/callback`.
  - **Capabilities:** **Read content**, **Update content** and **Insert content**. Leave the comment capabilities off and set user capabilities to **No user information**.
  - No template is needed.
- [ ] Open the **Configuration** tab and copy **OAuth Client ID** → `NOTION_CLIENT_ID` and **OAuth Client Secret** → `NOTION_CLIENT_SECRET`. Set both on web and worker, then redeploy.
- Radar builds its own authorize URL, so it doesn't need the portal's "Authorization URL" field. Listing in the Notion Marketplace is optional and separate.
- Users must choose the database in Notion's page picker during Connect; Radar only sees what they share. Radar finds the title property itself, and also fills a rich-text **Slug** property, a rich-text **Description/Summary/Excerpt/Meta** property and a **Date** property when the database has them. If it has a **Status** (or a select named Status), Radar sets it to **Published** (or the nearest option, such as Live or Done) when it publishes.
- **View post** shows the page's public URL when the page is shared to the web. Otherwise it shows the `notion.so` URL, which only workspace members can open.
- The hero image becomes the page cover, using Radar's public image URL. Notion covers have no alt text.
- Radar uses Notion API version `2026-03-11`, where pages live in a database's *data source*.

### 7.3 Live checks (run once the env is set; dev stubs can't cover these)

Use a throwaway WordPress.com site and a throwaway Notion workspace. Record each result in `.factory/blog-connectors/verification.md`.

**WordPress.com**
1. Settings → Publishing → Add a blog connection → WordPress.com: the popup shows WordPress.com's consent screen, closes, and the site picker lists your sites.
2. **Test connection** succeeds, and the site's Posts → Trash has no "Radar connection test" left behind.
3. **Publish now** on an approved article. Check the post: title, slug, excerpt, headings, lists, links, the YouTube embed and the Sources list. Check the **featured image** and its **alt text** (Media library → the image).
4. Publish a second article with the same slug. The new post gets `-2`, and **View post** opens that URL.
5. A **refresh** entry for a post on that site updates the same post (same URL, no new post).
6. Revoke Radar at wordpress.com/me/security/connected-applications, then **Test connection**. Expect "The authorization expired. Reconnect and try again." A scheduled publish should mark the connection **Needs reconnecting**. Note the HTTP status WordPress.com returned (logged as `[blog.test]`).
7. Note in `verification.md` whether a connection still works after 2–3 weeks (whether code-flow tokens expire).

**Notion**
1. Add a blog connection → Notion. In the page picker, share one database. The Radar picker lists it by name.
2. **Test connection** succeeds and leaves only a trashed "Radar connection test" page.
3. **Publish now** on an article longer than 100 blocks. The page has the title, Slug, Description, Date and Status = Published, headings, bullets, the video, and Sources with links. The cover shows the hero image.
4. **View post** opens the notion.so page. Then share the database to the web, publish another article, and confirm **View post** shows the public URL.
5. A **refresh** entry whose URL ends in a page's Slug (or a notion.so URL) updates that page in place, with no new page.
6. Remove Radar under the workspace's Settings → Connections, then **Test connection**. Expect the expired-authorization copy. Remove only the database's access and expect a 404 message.
7. Note whether Notion returned a `refresh_token` (it is stored), and whether tokens expired over the following weeks.

## 7b. Social channels — post to X and LinkedIn (optional, behind a flag)

Full owner walkthrough: `.factory/social-channels/developer-apps-guide.md`. Design: `.factory/social-channels/architecture.md`.

- [ ] **Flag.** `RADAR_SOCIAL_PUBLISHING` — empty/`off` (default): nothing changes anywhere. `all`: on for every business. Otherwise a comma-separated list of business ids and/or owner emails (the opt-in group). Set the same value on **web and worker**. Turning it off stops all sends at once (scheduled posts stay in the database and resume when it is turned back on; anything more than 24 h late fails as "couldn’t go out on time").
- [ ] **Same `APP_URL` and `RADAR_SECRET_KEY` on web and worker** — the worker decrypts the stored tokens.

| App | Where | Redirect URI | Scopes | Env |
|---|---|---|---|---|
| X ("Radar"; plus a separate "Radar Dev" app for local work) | console.x.com → app → User authentication: **Web App** (confidential client), Read and write | `{APP_URL}/api/oauth/x/callback` | `tweet.read tweet.write users.read media.write offline.access` | `X_CLIENT_ID`, `X_CLIENT_SECRET` (or `XAPP_CLIENT_ID`, `XAPP_CLIENT_SECRET`) |
| LinkedIn profile ("Radar", App 1) | linkedin.com/developers → Products: **Share on LinkedIn** + **Sign In with LinkedIn using OpenID Connect** | `{APP_URL}/api/oauth/linkedin/callback` | `openid profile w_member_social` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (or `LINKEDINAPP_CLIENT_ID`, `LINKEDINAPP_CLIENT_SECRET`) |
| LinkedIn page ("Radar for Pages", App 2) | A **new** app with **Community Management API only** (needs LinkedIn approval: Development tier, then Standard tier) | `{APP_URL}/api/oauth/linkedin_page/callback` | `w_organization_social rw_organization_admin r_basicprofile` | `LINKEDIN_PAGE_CLIENT_ID`, `LINKEDIN_PAGE_CLIENT_SECRET` |

- A channel whose app isn’t configured shows "Not available yet" in Settings → Social accounts. There is no fallback between the two LinkedIn apps.
- **LinkedIn page approval takes longest — apply first.** Until Standard tier is approved, only connect your own pages (Development tier: 500 calls/app/day, 100/member/day). Page admins and content admins can both connect a page.
- **LinkedIn profile connections last 60 days** (no refresh token for self-serve apps). Radar warns about 7 days before, then shows "Reconnect needed" and holds that account’s scheduled posts until the user reconnects. Page connections refresh for 365 days, then need a reconnect too.
- **`LINKEDIN_API_VERSION`** (default `202610`). LinkedIn retires each version about 12 months after release; a retired version fails every LinkedIn post ("LinkedIn didn’t respond.") and logs `[social] LinkedIn API version … retired (426)`. **Bump it at least every 11 months** (next: before Oct 2027) and redeploy web + worker.
- **X is pay-per-use** (prepaid credits): about $0.015 per post and $0.20 per post with a link. Set a **spending limit** and consider auto-recharge in the X console. When credits run out, X posts fail with "X isn’t accepting posts from Radar right now." (code `quota`, never retried) and the logs show `[social] X quota`; `/api/admin/metrics` → `derived.social.quotaFailures` counts them.
- **X replies are never posted by Radar.** Self-serve X plans refuse API replies unless the original author mentioned the account (since Feb 2026), so Reply now opens X’s own prefilled reply box. Before launch, send X one Policy Support request about AI-drafted posts that a person reviews and sends.
- **Local X testing:** X wants `http://127.0.0.1` callbacks, so run with `APP_URL=http://127.0.0.1:3000` and the Radar Dev app’s credentials in `.env.local` only.
- **Metrics:** `/api/admin/metrics` → `derived.social` reports `scheduledSuccessRate`, `expiries`, `reconnects`, `accountsConnected` and `expiriesPerAccount`.
- [ ] Live checks (not possible with dev stubs): the checklist in `developer-apps-guide.md` §6 for X, the LinkedIn profile and the LinkedIn page.

## 7c. Billing — $1 card check, 3-day trial, $50/month (behind a flag)

Design: `.factory/marketing-trial-gating/architecture.md` (§7 Stripe, §8 limits, §21 owner decisions). Until the owner supplies keys, only the in-memory stub has been exercised; every live Stripe check below is **not run** yet.

- [ ] **Migrations.** `npm run db:migrate` applies `0007_trial_gating` (additive tables and columns) and `0008_grandfather`, a data migration that gives every account owning an active business at that moment a complimentary account (`billing_accounts.comp`, reason `grandfather`), so nobody using Radar today meets the trial page. Deploy with `RADAR_BILLING=off`.
- [ ] **Stripe, test mode first.**
  - A product "Radar" with one **recurring price, $50.00 USD per month** → `STRIPE_PRICE_ID`. The first billing call per process checks it and logs `[billing] STRIPE_PRICE_ID … the pages show 5000 usd/month` on a mismatch.
  - API keys → `STRIPE_SECRET_KEY` (a restricted key: write Customers including balance transactions, PaymentIntents, PaymentMethods, Subscriptions; read Invoices, Prices) and `STRIPE_PUBLISHABLE_KEY`.
  - `STRIPE_API_VERSION`: keep the pinned `2026-05-27.dahlia` (later Dahlia versions are additive). Stripe's newest major line is Endive (`2026-09-30.endive`, possibly breaking); read its changelog before moving the pin. The code reads `items.data[0].current_period_end` and the invoice `confirmation_secret`, which need Basil (2025-03-31) or later.
- [ ] **Webhook endpoint** `{APP_URL}/api/billing/webhook` (`https://radar.thally.io/api/billing/webhook`) with exactly these seven events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Its signing secret → `STRIPE_WEBHOOK_SECRET` (unset = every delivery refused with 400). Don't add `customer.subscription.trial_will_end`: no email is designed. Deliveries are deduplicated by event id (`billing_events`); a handler failure answers 500 so Stripe retries, and `billing_events.last_error` keeps the message (never the payload).
- [ ] **Failed payments:** in the Stripe Dashboard's subscription retry settings (Billing → Revenue recovery → Retries; the menu path may move), set "If all retries for a payment fail" to **Cancel the subscription** (owner decision). Either way the account loses access while `past_due` and the app shows "Restart your subscription"; paying the open invoice restores it.
- [ ] **The $1** is charged once per account to confirm the card, then credited back to the customer balance ("Card confirmation credit", −$1.00), so the first $50 invoice is **$49**. Nothing to configure.
- [ ] **Test-mode run** (each needs real Stripe; the stub can't prove them):
  - `4242 4242 4242 4242` → trial page success. In the Dashboard: a $1.00 payment succeeded, the customer has a −$1.00 balance, a `trialing` subscription whose trial end matches the date the page showed, and seven webhook deliveries answered 200.
  - `4000 0000 0000 0002` → the decline copy, no subscription. `4000 0027 6000 3184` → Stripe's 3-D Secure modal; Complete → success, Fail → the decline copy.
  - The same card on a second account → "This card has already been used for a free trial. Try a different card."
  - Close the tab right after paying: the webhook alone starts the trial and commits the Business Profile.
  - Advance a test clock past the trial end: the $49 invoice is paid → `active`. With `4000 0000 0000 0341` as the default card instead → `past_due` → "Restart your subscription" → paying restores access.
  - Cancel the subscription in the Dashboard → `canceled` → the restart charges today, with no trial: $50, or $49 if it was canceled during the trial (the unused −$1 credit applies to the new invoice). The page's "Today" amount must equal the charge.
- [ ] **Go live:** replace the secret key, publishable key, price id and webhook secret with live-mode values (the live endpoint has its own `whsec_…`), then redeploy web and worker.
- [ ] **Decide who joined in between — required before `RADAR_BILLING=on`.** `0008` comps only owners who had an active business when the migration ran (the merge deploy). Owners who finish onboarding after that, while the flag is still off, use Radar free and have no comp row, so at the flip they would be sent to `/start-trial`. Choose one and record it:
  - **(a) Recommended, matches the owner decision to grandfather existing accounts:** set `RADAR_BILLING_GRANDFATHER_BEFORE` to the flip time (ISO, e.g. `2026-11-02T09:00:00Z`) on web and worker. Owners of active businesses created before it get a comp row on first use (`[billing] grandfathered N account(s)` is logged); everyone who starts after the flip gets the trial.
  - **(b)** Leave it unset: only the migration's rows are comp, and the in-between owners are asked to start a trial (the $1 card check, then $50/month).
- [ ] **Flip `RADAR_BILLING`** (read at call time; same value on web and worker; restart both):
  1. Your own account first: `RADAR_BILLING=you@yourdomain.com`. Only listed accounts are gated.
  2. Everyone: `RADAR_BILLING=on`, only after the step above. With `on` but no `STRIPE_SECRET_KEY`, billing stays off and `[billing] RADAR_BILLING is on but no payment provider is configured` is logged.
  3. Rollback: `RADAR_BILLING=off`. Stripe keeps billing existing subscribers; everyone gets in again.
- [ ] **Lapsed accounts do no background work** (owner decision): queued jobs for an active business whose owner has no access finish as `{skipped: 'no_access'}` (crawls, AI-visibility queries, drafts, syncs); posts the user already scheduled still go out. No effect while the flag is off.
- [ ] **Abuse limits** on anonymous onboarding (Postgres, no extra infrastructure): analyses by guests and accounts without access, 5 per IP per hour, 20 per IP per day, 10 per domain per day; new guests 10 per IP per hour; billing calls 5 per account and 10 per IP per hour; `RADAR_ANALYSIS_GLOBAL_PER_HOUR` (default 300) answers "Radar is busy right now" past it. `TURNSTILE_SECRET_KEY` is a seam only (no widget ships): leave it unset.
- [ ] **Verify `X-Forwarded-For` on Railway** at the first deploy. The first proxied request in production logs `[abuse] x-forwarded-for has N entries; using 1 from the right` (counts only, never addresses). Behind Railway's edge alone `RADAR_TRUSTED_PROXY_HOPS=1` is right; with a CDN such as Cloudflare in front, the CDN adds an entry: set `2`. Too few hops makes every visitor share one limit; too many lets clients choose their own IP.
- [ ] **Guest cleanup** runs in the worker hourly (minute 17): guests older than 24 h with no live session are deleted with their drafts (Search Console tokens revoked), rate-limit windows older than two days and processed webhook events older than 30 days are pruned. Known gap: a deleted draft's uploaded logo stays in storage.

## 8. Email

- [ ] **Resend** account, verify your sending domain (SPF/DKIM) → `RESEND_API_KEY`, `MAIL_FROM`
- [ ] Support inbox for feature requests → `SUPPORT_INBOX`
- Without Resend, emails (team invites, backlink partner notices) are only logged — invites won't arrive.

## 9. Legal and policy (before real users)

- [ ] Privacy policy and terms (Google verification needs them).
- [ ] A public "Radar bot" page (crawler identity + opt-out via robots.txt).
- [ ] Backlink network terms (disclosure, `rel="sponsored"`, removal process).
- [ ] Data-use agreements: Reddit, X, DataForSEO terms for commercial use.

## 10. Product decisions to make (from DIVERGENCES.md)

- [ ] Approve or change the 82 "Needs approval" items — especially: LinkedIn/Quora via web search, no sign-out button, invite-link policy, Next.js "published = PR opened", source-removal styling.
- [ ] Brand assets: replace platform logos with each brand's official kit if required.
- [ ] Billing: the $1-then-trial flow is built behind `RADAR_BILLING` (§7c). Usage credits are not designed (AI costs are logged per business in `ai_calls`).

## 11. Go-live checks

- [ ] Sign up, onboard your own site, connect real Search Console, wait for the 16-month sync.
- [ ] Generate a calendar, draft one article, publish to a test blog on each connector you offer.
- [ ] Run a Daily Brief scan, generate a social pack, collect one AI-visibility cell.
- [ ] Invite a teammate (email arrives, link works).
- [ ] Error monitoring (Sentry or similar) and uptime checks on web + worker; Postgres backups on.
