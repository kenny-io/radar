# Launch checklist — running Radar as a live product

Everything you need to create, configure and provide. Env var names match `.env.example`.
`{APP_URL}` = your production URL, e.g. `https://app.radar.yourdomain.com`.

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
| Notion | notion.so/my-integrations → **public** integration (OAuth) | `notion` | Read/insert/update content | `NOTION_CLIENT_ID/SECRET` |
| Wix | Wix Dev Center → new app with Blog permissions (manage blog/draft posts) | `wix` | Wix Blog | `WIX_CLIENT_ID/SECRET` |
| Shopify | Shopify Partners → app (public or custom distribution) | `shopify` | `read_content,write_content` | `SHOPIFY_CLIENT_ID/SECRET`, `SHOPIFY_API_VERSION` |
| WordPress.com | developer.wordpress.com/apps | `wpcom` | `global` | `WPCOM_CLIENT_ID/SECRET` |
| Next.js blog (GitHub) | GitHub → Developer settings → OAuth App | `github` | `repo` | `GITHUB_CLIENT_ID/SECRET` |

Public Shopify and Wix apps go through store/marketplace review before arbitrary merchants can install them.

## 7b. Social channels — post to X and LinkedIn (optional, behind a flag)

Full owner walkthrough: `.factory/social-channels/developer-apps-guide.md`. Design: `.factory/social-channels/architecture.md`.

- [ ] **Flag.** `RADAR_SOCIAL_PUBLISHING` — empty/`off` (default): nothing changes anywhere. `all`: on for every business. Otherwise a comma-separated list of business ids and/or owner emails (the opt-in group). Set the same value on **web and worker**. Turning it off stops all sends at once (scheduled posts stay in the database and resume when it is turned back on; anything more than 24 h late fails as "couldn’t go out on time").
- [ ] **Same `APP_URL` and `RADAR_SECRET_KEY` on web and worker** — the worker decrypts the stored tokens.

| App | Where | Redirect URI | Scopes | Env |
|---|---|---|---|---|
| X ("Radar"; plus a separate "Radar Dev" app for local work) | console.x.com → app → User authentication: **Web App** (confidential client), Read and write | `{APP_URL}/api/oauth/x/callback` | `tweet.read tweet.write users.read media.write offline.access` | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| LinkedIn profile ("Radar", App 1) | linkedin.com/developers → Products: **Share on LinkedIn** + **Sign In with LinkedIn using OpenID Connect** | `{APP_URL}/api/oauth/linkedin/callback` | `openid profile w_member_social` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
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
- [ ] Billing/credits (not designed — AI costs are logged per business in `ai_calls`).

## 11. Go-live checks

- [ ] Sign up, onboard your own site, connect real Search Console, wait for the 16-month sync.
- [ ] Generate a calendar, draft one article, publish to a test blog on each connector you offer.
- [ ] Run a Daily Brief scan, generate a social pack, collect one AI-visibility cell.
- [ ] Invite a teammate (email arrives, link works).
- [ ] Error monitoring (Sentry or similar) and uptime checks on web + worker; Postgres backups on.
