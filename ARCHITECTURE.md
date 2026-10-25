# Radar — architecture and conventions

Radar is a Next.js (App Router) + TypeScript app on Postgres, with a separate worker process for background jobs.
The UI is a faithful port of the approved prototype (`design_handoff_radar/prototype`). The handoff docs
(`01-screens.md`, `02-system.md`, `03-design-system.md`) are the spec.

```
src/
  app/                    Next routes. (app)/* are thin client pages that render a feature component.
    api/auth/*            email+password and Google sign-in (sessions in Postgres, httpOnly cookie)
    api/me, api/b         current user, businesses; POST /api/b creates an onboarding business
    api/b/[bid]/workspace GET the per-business Workspace ("B")
    api/b/[bid]/act       POST {action, input} → RPC into src/server/actions/*
    api/b/[bid]/events    SSE: workspace revisions ('rev'), job progress ('job'), toasts ('toast')
    api/oauth/[provider]  popup OAuth for integrations (GSC, blog connectors)
    api/files/[...key]    local object storage
  components/             ui.tsx (primitives ported from radar-ui.jsx), RadarField, Visual, brand marks
  client/                 app.tsx (useApp(): B, act, actLater, go, toast, jobFor…), api.ts (fetch, openOAuth)
  features/<area>/        screens ported from prototype/*.jsx
  lib/                    shared, isomorphic: types.ts (THE contract), constants.ts, format.ts, visual.ts
  server/
    db/                   Drizzle schema + client
    actions/<area>.ts     RPC actions (role-checked, zod-validated)
    jobs/                 queue.ts (Postgres queue), cron.ts (minute scheduler), all.ts (registry)
    ai/                   ai.run(task, input) + provider adapters (Anthropic, OpenAI, xAI) + dev stub
    services/<area>/      business logic, integrations, jobs.ts (job + cron definitions)
    oauth/                OAuth provider registry
  worker/main.ts          runs jobs + scheduler
```

## The client "app" object
Every screen calls `const app = useApp()` — the real-data equivalent of the prototype's `app`:

- `app.B` — the current business `Workspace` (see `src/lib/types.ts`). Same shape as the prototype's `B`, plus server-computed fields (`today`, `counts`, `measured`, `jobs`, `site`).
- `app.act(action, input, {optimistic})` — call a server action; the response carries the fresh workspace, which replaces `B`. Use `optimistic: B => newB` for instant UI.
- `app.actLater(key, action, input, {optimistic, ms})` — debounced save for text fields (autosave).
- `app.go(page, params)` — navigation with the prototype's route names (`'calendar', {open: id}`, `'article', id`, `'social', {pack}`…).
- `app.toast(msg, {tone, action})` — toasts exactly as designed.
- `app.jobFor(kind, ref)` — live state of a background job (progress is streamed over SSE).

"Today" is always `B.today` (business timezone) — never `new Date()` on the client for business logic.

## Server actions
`src/server/actions/<area>.ts` exports `actions: ActionMap`. Define with
`action({ role, input: z.object(...), read?, run: async (ctx, input) => data })`.
Writes default to role `Editor` and bump the business revision automatically; reads (`read: true`) default to `Viewer`.
Roles: Owner > Admin > Editor > Viewer (02-system.md §14). Throw `RadarError(userCopy)` for user-facing errors —
copy says "Radar", never a model or provider name.

## Jobs
Everything long-running is a job: `defineJob({ kind, run: async ctx => { await ctx.progress({...}); } })` in
`src/server/services/<area>/jobs.ts`, enqueued with `enqueue(kind, payload, { businessId, ref, singletonKey })`.
The UI follows progress via `app.jobFor(kind, ref)`. Scheduled work registers `defineCron(name, async now => …)`;
hooks run every minute and must be idempotent (`once(key)`). All schedules use the business timezone
(`todayIn(tz)`, `nowHMIn(tz)` from `lib/format`).

## AI
`ai.run('writing' | 'research', { purpose, system, prompt, schema?, webSearch?, onDelta? }, { businessId })`.
The model comes from Settings → AI models. Every generation prompt includes `profileContext(profile)`.
Structured output is validated with zod. Model names appear only in Settings → AI models.

## Integrations and dev stubs
Each external integration reads its credentials from `src/server/env.ts`. When `RADAR_DEV_STUBS=1`, integrations
use deterministic local stubs so every flow runs without keys (AI: `registerStub(purpose, fn)`). Stubs are for
development and tests only and never run in production. `RADAR_REAL_CONNECTORS=wordpress,ghost,webhook` (only read
with dev stubs on) lets the listed blog connectors call the real platform while the rest stays stubbed; the local
WordPress, Ghost and webhook-receiver harness lives in `scripts/connectors/` (see its README). It suits credential-based
connectors only: OAuth start/callback stay stubbed, so an OAuth type listed there has no real token.

## Running locally
```
cp .env.example .env.local      # set DATABASE_URL; RADAR_DEV_STUBS=1 to run without keys
docker compose up -d db         # or any Postgres 16
npm install
npm run db:migrate
npx tsx scripts/dev-seed.ts     # optional: dev@radar.local / radar-dev-1
npm run dev                     # web + worker
```
