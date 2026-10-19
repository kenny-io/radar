# Build brief for area engineers (read fully before starting)

You are one of seven engineers building Radar in parallel in the same repo (`/home/claude/radar`). The platform core
already exists. Your job: build ONE area end to end — real server logic, jobs, integrations, and a pixel-and-word-exact
port of the prototype UI for that area.

## Read first
1. `/mnt/user-data/uploads/design_handoff_radar/README.md` (rules — especially §2 and the principles in §2.5)
2. The sections of `01-screens.md` and `02-system.md` for your area, and `03-design-system.md`
3. Your prototype files in `/mnt/user-data/uploads/design_handoff_radar/prototype/` — they are the copy deck and the markup/inline-style source of truth. Port them line by line.
4. `/home/claude/radar/ARCHITECTURE.md`, then the core code: `src/lib/types.ts` (the contract), `src/lib/constants.ts`, `src/lib/format.ts`, `src/components/ui.tsx`, `src/components/{Visual,RadarField,brand}.tsx`, `src/client/app.tsx`, `src/client/api.ts`, `src/server/{workspace,access,errors,env,crypto}.ts`, `src/server/actions/define.ts`, `src/server/jobs/{queue,cron}.ts`, `src/server/ai/index.ts` + `adapters/stub.ts`, `src/server/services/{storage,mail,images}.ts`, `src/server/services/gsc/metrics.ts`, `src/server/services/keywords/provider.ts`, `src/server/oauth/registry.ts`.

## How to port a prototype component
- Keep markup, class names, inline styles and copy exactly. TypeScript, `'use client'`, import primitives from `@/components/ui`.
- `const app = useApp()`; replace `app.B` reads as-is (Workspace has the same shape). Replace every `updB(...)` with a server action via `app.act(name, input, { optimistic })` (or `app.actLater` for text fields). Replace `sleep()`-based fakes with real jobs; show progress from `app.jobFor(kind, ref)`.
- Replace `RD.TODAY` with `B.today`. Replace `RD.*` / `RB.*` fixtures with real data from the workspace or read actions.
- REMOVE prototype-only things (README §2.4): `<Sample/>` badges, "Sample data", "PHOTO/VIDEO PLACEHOLDER", tweaks (`tw.errors`), seeding/migration logic, `window.claude.complete`, the "Try fieldnote.app…" hint, the drawn Google consent card.
- Do not add or remove UI. Where real behavior forces a UI difference (e.g. an error state the prototype lacks), implement the closest faithful option and log it (below).
- Principles (README §2.5) are requirements: no social posting, approval before publish, Inferred vs Edited, "not collected" ≠ zero, `~` estimates, substantiated suggestions, no model names outside Settings → AI models, human-first replies, status = dot + text (`<Status>`), honest backlinks.

## Server side
- Actions in `src/server/actions/<your file>.ts` (already created, empty). Jobs/crons in `src/server/services/<area>/jobs.ts` (already imported by the worker). Put integration code under `src/server/services/<area>/`.
- Every external integration: real implementation using credentials from `src/server/env.ts` (add new env vars there AND to `.env.example`), plus a deterministic dev stub used when `env.devStubs` is true. For AI calls use `ai.run(...)` with a distinct `purpose` and register a realistic stub via `registerStub(purpose, fn)` (import from `@/server/ai/adapters/stub`) so the whole flow works with `RADAR_DEV_STUBS=1`.
- When a required credential is missing in production, fail gracefully with designed states/copy (never crash, never show zeros for missing data, never mention providers).
- Long-running work = jobs with `ctx.progress(...)` that the UI renders. Toasts that happen in the background (e.g. "drafts ready") use `notify(bid, msg, {tone, action:{label, href}})` from `src/server/notify.ts`.
- Encrypt tokens/credentials with `encrypt()`; never return secrets to the client.

## Shared files — careful
Other engineers edit in parallel. You OWN only the files/dirs listed in your assignment. For shared files
(`src/lib/types.ts`, `src/lib/constants.ts`, `src/server/db/schema.ts`, `src/server/workspace.ts`, `.env.example`, `src/server/env.ts`)
make only small, additive edits with the Edit tool (never rewrite the file; re-read right before editing). Don't edit other areas' files.
If you need something another area owns, code against the contract placeholder (e.g. `src/features/publishing/BlogConnect.tsx`
props) and mention it in your report. Do not run `drizzle-kit generate` and do not `git commit` — the lead does both.

## Your sandbox
- Postgres is running at `localhost:5432` (user `postgres`, no password). Your own database `radar_<area>` already exists, migrated and seeded (dev@radar.local / radar-dev-1, an active "Fieldnote" business).
- After schema changes: `DATABASE_URL=postgres://postgres@localhost:5432/radar_<area> npm run db:push`
- Web: `NEXT_DIST_DIR=.next-<area> DATABASE_URL=postgres://postgres@localhost:5432/radar_<area> RADAR_DEV_STUBS=1 APP_URL=http://localhost:<port> npx next dev -p <port>` (run in background, log to a file)
- Worker: `DATABASE_URL=... RADAR_DEV_STUBS=1 APP_URL=... npx tsx src/worker/main.ts` (background)
- Screenshots: `node scripts/shot.mjs <path> <out.png> [width] --base=http://localhost:<port> [--full] [--wait=3000]` then view the PNG with the Read tool. Check desktop (1440) and mobile (390). For multi-step flows write a small Playwright script (chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- `npx tsc --noEmit` checks the whole repo; others' in-progress files may error — make sure YOUR files are clean.
- Kill your own background processes when done (only yours — match on your port / dist dir).

## Divergences
Write every divergence to `docs/divergences/<area>.md` as a markdown table with columns:
`| Area / screen | Designed behavior | What was built instead | Why | User-visible? | Status |`
Status: `Needs approval` (user-visible) or `Logged` (implementation-only). Also confirm/close any of the known risks in the handoff's `DIVERGENCES.md` that belong to your area.

## Done means
Every screen/state/copy in your area matches the prototype; every action works against the real server with dev stubs;
real integrations implemented behind env credentials; your files typecheck; you verified visually with screenshots.
Finish with a concise report: what you built (files), actions/jobs/crons, contracts you provide/consume, anything left unfinished, divergences.

## RESOURCE LIMITS (the container has 8 GB RAM and restarted twice from memory pressure)
- Run at most ONE `next dev` and ONE worker at a time, always with `NODE_OPTIONS=--max-old-space-size=700`.
- Stop your web server and worker as soon as you finish a round of testing (kill by your port / dist dir). Never leave them running while you write code for a long stretch.
- Launch chromium with `--single-process`/`--no-zygote` args off, but keep ONE browser instance at a time and close it after each script.
- Prefer API-level checks (curl / small tsx scripts) and `npx tsc --noEmit`; take screenshots only for final visual verification.
