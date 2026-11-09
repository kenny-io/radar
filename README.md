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
- **X** and **LinkedIn** (profile + page) apps for connected social accounts: post now and scheduling, behind `RADAR_SOCIAL_PUBLISHING` (off by default; see `docs/LAUNCH.md` §7b)
- **Resend** (email), optional **S3**-compatible storage
- **Stripe** (optional paid access): existing $1 card confirmation, three-day trial, then $50/month; Settings → Billing opens customer self-service. See `docs/LAUNCH.md` §7c for sandbox provisioning, verification and grandfathered rollout. Billing stays off until configured.

Run `npm run db:migrate` on deploy.

### Daily social drafts

The worker prepares one social pack per active business each day, from 08:00 in the business timezone. Unconfigured
businesses default to LinkedIn and X drafts with branded visuals. Radar uses the Business Profile, content calendar,
published Radar articles, cached blog content and search ideas, with profile-based topics when other sources run out.
Drafts appear in Social Marketing for review and editing; manual generation remains available at any time.

Social Marketing → Draft settings controls time, platforms, selected days and pause. Explicitly saved preferences
are preserved, including an existing opt-in to automatic scheduling. New defaults save to the library; connecting a
social account alone never enables automatic publishing. The worker catches up later the same day after downtime;
daily packs are deduplicated across retries. No schema migration is needed for daily drafts.

### Marketing Autopilot

Settings → Autopilot lets a workspace owner delegate Radar's supported marketing work. It is off by default.
Turning it on authorizes calendar planning, article drafting and publication, and social post generation and
publication without individual review. The program uses the Business Profile, saved cadence and business timezone.
It retains existing calendar entries, drafts, edits, manual schedules and individual automation preferences.

Blog publication needs a connected publishing destination. Social publication uses connected X and LinkedIn
accounts and requires `RADAR_SOCIAL_PUBLISHING` for the business. Comments and replies, including Reddit comments,
require the owner; Radar emails prepared text and actionable links, together with missing-connection or failure
handoffs. Configure `RESEND_API_KEY` and `MAIL_FROM` to deliver email; without Resend, messages remain in the local
outbox log. Search/visibility monitoring and separately opted-in backlink workflows retain their existing behavior.

Deploy migration `0010_autopilot` with `npm run db:migrate` before updating both web and worker processes. The worker
runs the program continuously; no browser session is required. Disabling stops future Autopilot work, including
pending publications from earlier activations. Manual schedules and separate automations continue; an external send
already in progress may finish. See `.factory/autopilot/architecture.md` for authorization and recovery details.

### Failure alerts

Radar reports failed actions, background jobs, provider attempts and degraded generation/publishing flows to
`kenny@thally.io`. Provider credit errors and outages are reported before retry/fallback, so an incident is visible
even if another provider completes the action. Alerts include sanitized diagnostics and action/job correlation;
failed email attempts are retained in the existing Postgres job queue and retried by the worker.

Production enables alerts by default. Configure `RESEND_API_KEY` and a verified `MAIL_FROM` on both web and worker;
`RADAR_FAILURE_ALERT_EMAIL` overrides the recipient and `RADAR_FAILURE_ALERTS=off` disables email. Development/tests
require explicit `RADAR_FAILURE_ALERTS=on`; development stubs never send alerts. No migration or new vendor is needed.
See [failure alert operations](docs/OBSERVABILITY.md) for coverage, a smoke test and failed-delivery recovery.

## Docs
- `ARCHITECTURE.md` — code layout, the client `app` object, actions, jobs, AI layer, dev stubs
- `DIVERGENCES.md` — every divergence from the design, with status (some need product approval)
- `docs/LAUNCH.md` — everything to set up to run Radar live (accounts, keys, OAuth apps, hosting)
- `docs/webhook.md` — the signed webhook payload for the Webhook connector
- `docs/CONTRACTS.md` — actions, components and job kinds shared between feature areas
- `docs/SUPPORT.md` — dashboard AI assistant, email handoff, configuration and verification

## Scripts
`npm run typecheck` · `npm test` · `npm run db:generate` (after schema changes) · `npm run db:migrate`
