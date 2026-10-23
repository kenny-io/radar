# Cross-area contracts (actions, components, job kinds shared between feature areas)

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

## Social channels (connected X / LinkedIn accounts: post now, schedule, calendar)

The design is in `.factory/social-channels/architecture.md`, and the types are in `src/lib/types.ts` (`SocialAccount`, `Pub`, …).

The shared rules live in `src/lib/socialPublish.ts`: ids, preflight, locking, time zones, routing and copy. The client and the server both call these functions, and neither re-implements them. That file, `types.ts` and this section belong to the architect, through the PM.

Everything in this section is behind the business-level flag `RADAR_SOCIAL_PUBLISHING`, surfaced as `B.social.publishing`. With the flag off, every action below returns 404 `not_enabled` (`COPY.notEnabled`) and the UI renders exactly as before.

### Workspace fields (publishing on)
- `B.now`: the server time in ISO format.
- `B.social.publishing`, `B.social.accounts: SocialAccount[]` (at most one per channel; `expiresAt` is set on LinkedIn accounts), and `B.social.channels: SocialChannel[]` (channels this deployment can connect).
- `pack.posts[k].pub`, `.imageMeta` and `.compressed`.
- On brief items, `item.pub` is set, and `item.st === 'scheduled'` while the pub is scheduled or sending. `counts.briefOpen` excludes scheduled items.
- `brief.img.meta[]` is on the item's images.
- Stable ids (`sid`) are `s:{packId}:{platform}` and `b:{YYYY-MM-DD}:{itemId}`. Item ids may contain `:`, so always use `parseSid` and never `split(':')`.

### OAuth providers (`openOAuth(provider, bid, { reconnect: '1' }?)`)
- `x` connects the `x` channel, `linkedin` the `li_profile` channel, and `linkedin_page` the `li_page` channel. The provider name is `chOf(ch).provider`.
  - `linkedin` and `linkedin_page` are separate LinkedIn apps, so `LINKEDIN_CLIENT_*` and `LINKEDIN_PAGE_CLIENT_*` hold different credentials.
- The popup result is `{ ok, result: { oauthRef, ch } }`. Finish it with `social.connect`. For a first-time `li_page`, call `social.pages` first.

### Actions (all role Editor; inputs are zod-validated; rules and error copy are in architecture.md §6)
- `social.pages` (read) `{ oauthRef }` → `{ pages: SocialPage[], error? }`
- `social.connect` `{ ch, oauthRef, pageId? }` → `{ account: SocialAccount, reconnected: boolean, released: number }`
  - A reconnect keeps the account id and refuses a different remote account.
- `social.disconnect` `{ acctId }` → `{ ch, unscheduled: number }`
- `social.postNow` `{ sid, acctId? }` → `{ pub: Pub }` (`posted` or `failed`)
  - Use it for pack posts, Brief posts, **Try again**. Never for replies: the server refuses `social.postNow` on a reply with `COPY.replyNotAllowed`.
  - X **Reply now** always uses X's own reply box: `replyMode === 'intent'` whenever the thread URL has a status id, connected or not. The client opens `xReplyIntentUrl(id, text)` in a new tab from the click and calls `brief.item { st: 'copied' }`. No pub is created.
- `social.schedule` `{ sid, date, time, acctId? }` → `{ pub }`
  - Use it for Schedule, Reschedule and the Move post window. Replies are refused.
- `social.move` `{ sid, date }` → `{ pub }`
  - Drag only. It keeps the stored time, and its refusals are the `moveCheck` copy.
- `social.unschedule` `{ sid }` → `{ ok: true }`
- `social.scheduleAll` `{ packId, date, rows: { platform: 'x'|'linkedin', time, acctId }[] }` → `{ scheduled: number }` (all or nothing)
- `social.compress` `{ sid }` → `{ compressed: number }`
- `social.devSimulate` `{ acctId, what: 'expire' | 'lapse' }` → `{ ok: true }` (`RADAR_DEV_STUBS=1` only)
- Changed existing actions:
  - `social.auto` accepts `auto.post: 'library'|'schedule'`. `'schedule'` needs a live account.
  - `social.text`, `regenText`, `regenImage`, `style`, `brief.item`, `brief.rewrite` and `brief.visuals` refuse with `COPY.lockedEdit` (409 `locked`) while the post is locked.
  - `brief.item` refuses `st` or `pl` changes while scheduled (`COPY.unscheduleFirst`).

### Job kinds and cron
- `social.send` (ref = sid, payload `{ pubId }`, `maxAttempts: 1`): sends one claimed pub, or verifies a stuck one. No UI progress, because the UI reads `pub` from the workspace.
- Cron `social.publisher` (every minute): enqueues due rows, fails rows more than 24 h late as `stale`, and re-checks stuck `sending` rows.
- Cron `social.tokens` (once per account per day): token refresh.
- `social.autoRun` (existing) also schedules X and LinkedIn when `auto.post === 'schedule'`.

### Components (frontend, `src/features/social/channels/*`; all read `useApp()`)
- `SocialAccounts()` is the Settings section body.
- `ConnectSocial({ ch: SocialChannel | null, open: boolean, onClose(): void, onConnected?(a: SocialAccount): void, reconnect?: SocialAccount | null })`
- `PublishBox({ pack: SocialPack, k: Platform, post: SocialPost, nImg: number, onCopy(): void, onDownload(): void })`
- `ScheduleModal({ open, onClose, title: string, sub?: string, initial: { date, time }, onSave(v: { date, time }): void, extra?: ReactNode, acct?: SocialAccount | null })`. With `acct`, shows `expiryNote(acct, B.tz)` as a warn Status when `expiresBefore(acct, dueMs)`.
- `src/client/laterQueue.ts`: the pure queue behind `actLater` / `flushLater()` on `useApp()`. `flushLater` covers `actLater` only; the Daily Brief sends its own pending edit (`brief.item {edit}`) before `social.postNow` / `social.schedule`.
- Settings accepts `?social=1` (scrolls to Social accounts); Connect/Reconnect links elsewhere use it.
- `packPanelState`: `posted` wins over `not_connected`, so a published post keeps its history ("As {account}", View on) after a disconnect. The panel must render it when the account is gone (use `pub.acctLabel` when the account is gone; omit the "As …" line if that is empty too).
- `ScheduleAll({ pack: SocialPack })` renders nothing unless `showScheduleAll`.
- `SocialChip({ it: SocialItem, onOpen(it: SocialItem): void, compact?: boolean })`. The drag payload is `it.id` (the sid). A tap on `pointer: coarse` opens Move post.
- `WeekStrip()` is the Dashboard "This week" body.
- `LogoLabel({ k: string, children })`
- Hooks and helpers in `useSocial.ts`:
  - `useNowMs()` gives `Date.now()` corrected by `B.now`, re-rendering every 30 s.
  - `moveSocial(app, sid, date)` runs a client-side `moveCheck`, toasts, then calls `social.move`.
  - `openSocial(go, it)` routes to the pack (`go('social', { pack, plat })`) or the Brief (`go('brief')`).
- `useApp().flushLater(): Promise<void>` sends pending autosaves now. Call it before `postNow`, `schedule` or `scheduleAll`.
