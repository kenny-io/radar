# Cross-area contracts

Areas are built in parallel. These names and shapes are fixed so areas can call each other. If you own an item, implement
it exactly as listed (you may add optional fields). If you consume one, call it exactly as listed.

## Actions (POST /api/b/:bid/act — `app.act(name, input)`)

### onboarding area
- `profile.update` `{ profile: Profile, editedKeys: string[] }` — saves the profile, marks keys edited (e.g. `'business.positioning'`, `'keywords.list'`, `'brand.logo'`), enqueues `keywords.estimate` if any keyword has null vol/kd. Logo data URLs are uploaded to storage.
- `profile.reanalyze` `{}` → `{ jobId }` — re-runs analysis keeping edited fields.
- Job kind `keywords.estimate` payload `{}` (businessId set) — fills `vol`/`kd` for profile keywords that are null (and intent when missing). Any area may enqueue it: `enqueue('keywords.estimate', {}, { businessId, singletonKey: 'kw-est:' + bid })`.

### performance area (Search Console, Performance, AI Visibility)
- `gsc.properties` (read) `{}` → `{ properties: { v, l, note, recommended, otherSite }[] }` — after the `gsc` OAuth popup succeeds.
- `gsc.connect` `{ property }` — saves property, status `syncing`, queues the 16-month backfill.
- `gsc.resume` `{}` · `gsc.disconnect` `{}`
- `gsc.summary` (read) `{ days: 7|28|90 }` → `{ cur: Totals, prev: Totals|null, series: DayPoint[] } | null` (types in `src/server/services/gsc/metrics.ts`)
- `suggestions.list` (read) `{}` → `{ id, prio, title, why, impact, page, kind, state: 'open'|'calendar'|'dismissed' }[]` sorted by impact. Dashboard uses the top open High one.
- OAuth provider name: `gsc` (via `openOAuth('gsc', bid)`).

### content area (Calendar, Article)
- `article.approve` `{ entryId, withoutPublishing?: boolean }` — review/draft/approved (generated) → `scheduled`; with `withoutPublishing` → `approved` (the "Not now — approve without publishing" path). Requires a blog connection unless `withoutPublishing`.
- `article.unschedule` `{ entryId }` — scheduled → review.
- Drafting: entries move `approved → drafting → review` (or `scheduled` when autopilot && a connection exists && !paused).

### publishing area
- `blog.test` `{ type, id?, fields, target?, targetId?, oauthRef? }` → `{ ok, http?, message? }` (creates then deletes a draft)
- `blog.saveConnection` `{ type, id?, fields, target?, targetId?, oauthRef?, mode?, ack?, time?, tz? }` → `{ connection }`
- `blog.disconnect` `{ id }` · `blog.setDefault` `{ id }` · `blog.pause` `{ paused: boolean }`
- `blog.setMode` `{ mode: 'review'|'autopilot', ack?: boolean, time?, tz? }` (autopilot requires `ack`)
- `blog.schedule` `{ time?: 'HH:MM', tz?: string }` — Settings → Publishing → Schedule
- `publish.now` `{ entryId }` · `publish.retry` `{ entryId }`
- Components: `PublishIntro`, `BlogConnect`, `PublishingSettings` (props in their placeholder files).
- Server helper: `src/server/services/publishing/render.ts` → `blocksToHtml(blocks, opts)` / `blocksToMarkdown(blocks)`.

### social area
- Component `PackThumb` (props in placeholder).
- Generate flow opens from `app.go('social', { generate: true })`.

### platform area (Dashboard, Settings, Team, Backlinks)
- `settings.ai` `{ task: 'writing'|'research', model }` · `settings.calendarDefaults` `{ market?, language?, cadence?, perWeek? }`
- `team.invite` `{ email, role }` · `team.role` `{ memberId, role }` · `team.remove` `{ memberId }`
- `feature.request` `{ text }`
- `backlinks.*` (internal to the area)
- Server helper for publishing: `src/server/services/backlinks/outbound.ts` → `applyApprovedOutboundLinks(bid: string, entryUrl: string | null, html: string): Promise<string>` (inserts approved outbound links with rel + disclosure). Publishing calls it before sending HTML (import it; the platform area creates it).

## Workspace fields everyone can rely on
See `src/lib/types.ts` → `Workspace`. Notably `B.today`, `B.tz`, `B.counts`, `B.measured`, `B.kwSuggestions`, `B.site`, `B.jobs`.

## Job kinds (for `app.jobFor(kind, ref)`)
- `analysis.site` (ref = businessId) — progress `{ phase: 'site'|'biz'|'content'|'aud'|'brand'|'done', results: { site?: string, biz?: string, content?: string, aud?: string, brand?: string }, colors?: [p, s], logoMissing?: boolean, failed?: string }`
- `calendar.generate` (ref = businessId) — progress `{ phase: 0..6, results: string[], keep: boolean }`
- `article.draft` (ref = entryId) — progress `{ blocks: Block[], partial: string }` (streaming)
- `gsc.backfill` (ref = businessId) — progress `{ pct }`
- `brief.scan` (ref = date) — progress `{ step, threadsRead, failed?: platform }`
- `social.generate` (ref = client token) — progress `{ done: number }`, result `{ packId }`
- `visibility.collect` (ref = resultId)
