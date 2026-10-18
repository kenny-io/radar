# Radar

Search and social marketing for small businesses. Radar learns a business from its website, then plans and drafts
SEO articles, publishes them to the business's blog, builds social packs, finds conversations worth joining every
morning, tracks Search Console and AI-assistant visibility, and runs an opt-in, disclosed backlink network.

Built from the `design_handoff_radar` handoff. The UI is a faithful port of the approved prototype; everything the
prototype simulated is implemented for real (see `DIVERGENCES.md` for every place that differs and why).

## Quick start (local, no API keys)

```bash
cp .env.example .env.local
# set DATABASE_URL, and RADAR_DEV_STUBS=1 to run every integration against local stubs
docker compose up -d db          # Postgres 16 (or use your own)
npm install
npm run db:migrate
npx tsx scripts/dev-seed.ts      # optional: dev@radar.local / radar-dev-1 with a sample business
npm run dev                      # web on :3000 + worker
```

`RADAR_DEV_STUBS=1` is for development and tests only. It makes AI calls, crawling, Search Console, keyword data,
YouTube, blog connectors, social sources, AI-visibility engines and email deterministic and offline.

## Production

Two processes share one Postgres database:

| Process | Command | Notes |
|---|---|---|
| Web | `npm run build && npm start` | Next.js server (UI + API + OAuth callbacks + SSE) |
| Worker | `npm run worker` | Background jobs + the minute scheduler (drafting, publishing, Brief scans, GSC sync, AI visibility, backlink checks, auto social packs). Run 1+ replicas; scheduling is coordinated with a Postgres advisory lock. |

Required env: `DATABASE_URL`, `APP_URL`, `RADAR_SECRET_KEY` (encrypts OAuth tokens and CMS credentials).
Then add credentials for the integrations you want — every one is optional and listed in `.env.example`:

- **Google** OAuth client (sign-in + Search Console, scope `webmasters.readonly`)
- **AI models**: Anthropic, OpenAI, xAI (Settings → AI models picks per business; defaults: writing = GPT-6 Sol, research = Claude Opus 5.5)
- **AI Visibility** targets: OpenAI (ChatGPT), Perplexity, Gemini, Anthropic (Claude), xAI (Grok)
- **DataForSEO** (keyword volume/difficulty/related/competitor gaps), **YouTube Data API**, **OpenPageRank** (authority)
- **Reddit** app + **X API** bearer token (Daily Brief)
- Blog connector OAuth apps: **Webflow, Notion, Wix, Shopify, WordPress.com, GitHub** (WordPress, Ghost, Webhook and Framer use per-connection credentials)
- **Resend** (email), optional **S3**-compatible storage

Run `npm run db:migrate` on deploy.

## Docs
- `ARCHITECTURE.md` — code layout, the client `app` object, actions, jobs, AI layer, dev stubs
- `DIVERGENCES.md` — every divergence from the design, with status (some need product approval)
- `docs/webhook.md` — the signed webhook payload for the Webhook connector

## Scripts
`npm run typecheck` · `npm test` · `npm run db:generate` (after schema changes) · `npm run db:migrate`
