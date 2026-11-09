# Daily social drafts architecture

Confirmed workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, base `f9eb6178`. Extensive unrelated working-tree edits already exist; preserve them. This record implements the PM decisions in `brief.md` and does not authorize a release.

## Design

Extend the existing `social.auto` minute cron, `social.autoRun` durable job, social pack generator and social library. No new service, schema migration or publication path is required. Daily proactive output uses the existing editable `social_packs` JSON and the existing user-initiated publication controls.

`socialAutoOf` defaults unset settings to `{on:true,freq:'daily',days:['Mon','Wed','Fri'],platforms:['linkedin','x'],style:'branded',time:'08:00',post:'library'}` before merging saved preferences. Explicit `on:false`, custom weekdays, platform/style choices and legacy `post:'schedule'` survive. Existing JSON `{}` immediately adopts the new default. Cron must select all active businesses and evaluate merged settings, rather than filter JSON `on=true` (which excludes defaults).

`isDue` retains business-local date, weekday and time evaluation but allows every tick after the due time until local midnight. There is no historical backfill: an outage catches up today's pack when the worker returns. The date in the queued payload is immutable even if execution/retry crosses midnight.

## Shared contracts

- Keep job kind `social.autoRun`, payload `{date:string}` with an ISO business-local calendar date, result `{packId:string|null}`. Pass the payload date into `autoRun(bid,date?)`; the optional argument preserves internal callers. Runtime reads current active/on/platform settings again, so an opt-out after enqueue prevents generation. Existing queue billing gate applies; do not bypass it.
- Daily stored pack ID is `auto-${bid}-${date}`. UUID business IDs produce 52-character IDs, within the existing action max of 64. Read the tenant-scoped pack before AI work; return its ID if already present. A retry may complete idempotent legacy auto-scheduling, but must never regenerate or overwrite the existing draft.
- Extend `createPack` with an internal options argument for deterministic pack ID, logical created date, trusted grounding and bounded recent-history guidance. Do not expose these options in `social.generate` input. Existing manual inputs/callers remain compatible. Insert deterministic packs with `ON CONFLICT DO NOTHING`; on conflict return the existing ID after tenant-scoped lookup. Never replace data: a user may already have edited that pack. Primary-key uniqueness is the final duplicate guard, independent of cron/job status. The generator can incur duplicate AI cost in unusual timeout/recovery overlap, but it cannot save duplicate packs.
- Keep existing public source kinds. Radar/article packs use `article`; crawled blog sources can use `url` with stored trusted grounding, avoiding another fetch; profile-derived and search-derived angles use `suggest`. Change the generator's suggestion description from universally search-backed to generic Radar suggestion, because profile angles have no search measurements. Optional stored proactive provenance may describe source and reason; UI must not mislabel profile angles as measured search opportunities. No type/schema migration is needed for JSON optional fields.
- Make mark insertion and job insertion one short database transaction in `autoTick`: insert `cron_marks` key `social.auto:${bid}:${date}` on conflict do nothing; only a returned mark permits insertion of `jobs` with kind/payload/businessId/singletonKey/maxAttempts=3. Any enqueue failure rolls back the mark. A direct scoped transactional insert is sufficient; no generic queue refactor is required. Merely catching enqueue failure and deleting a prior mark leaves a crash gap and is weaker than atomic insertion. Existing advisory cron lock remains useful, but uniqueness must not depend on it.

## Grounding and source selection

Read bounded tenant-scoped inputs: business profile, recent social packs, recent published Radar entries with article content, approved/scheduled calendar entries near the target date, cached crawl pages with `kind='article'`, and existing search/keyword suggestions. Bound history (for example latest 12 packs, short excerpts per platform) and prompt size. Existing `readArticle` already scopes both entry and article to business; reuse it. Never copy another tenant's content based on a bare ref.

Prefer unused recent published Radar articles; include their real body/summary and only attach a published link when available. Choose near-term approved/scheduled calendar topics without stating they are published or fabricating URLs. Use unused business blog pages from the latest crawl, with title/description/text bounded to a few thousand characters and their known URL. The crawl schema stores `fetchedAt`, not publication date: it cannot prove a post was recently published. Sort by latest available crawl data and do not present fetch time as publication time. Cached text avoids fresh network/SSRF work; if a live read is needed, reuse `readUrl` and its existing safe fetch.

Reuse `suggestIdeas` for search-backed angles; its current candidates require keywords or Search Console. Catch source-specific failures and continue to another viable source rather than retrying an unreadable blog forever. Finally construct a profile-derived angle from offerings, differentiators, audience needs, description or positioning. Rotate the fact/topic and lens using the target date and recent labels. Supply bounded recent text to the writer with explicit fresh-opening/structure guidance. Profile fallback is necessary for businesses with no calendar, crawl or search data; it must not invent measurements or customer claims. Preserve existing post rules and profile brand/language context.

## Publication and UI behavior

New default packs stay in the library. Preserve the existing explicit legacy `post:'schedule'` behavior through `autoSchedule`; it remains an opt-in and must never be inferred from connected accounts. Manual `social.generate`, text autosave, regeneration, copy/download, schedule/post actions and deployment feature flags remain unchanged.

Extend established Social Marketing components rather than introducing a new screen: page copy explains daily preparation and review; generation settings expose frequency/time/platforms/pause; empty state explains when drafts arrive and retains Generate; existing busy/error job state is shown where available; automatic pack badges/provenance are legible. Library-mode copy must make clear that scheduling/publication is the user's choice. Legacy auto-schedule mode must accurately describe its existing behavior. Use existing accessible Modal, Toggle, Btn and Field components. Dashboard already shows recent packs through the shared thumbnail, so changing that component can improve discovery without touching the already-modified dashboard file.

## Implementation order and ownership

1. Backend engineer owns `workspace.ts`, `services/social/auto.ts`, `jobs.ts`, `generate.ts` and source/history helpers plus focused tests. Coordinate before touching shared `types.ts`; avoid the already-dirty database schema and jobs/all modules.
2. UI engineer, if separately dispatched, owns `features/social/SocialMarketing.tsx`, `AutoModal.tsx`, `PackThumb.tsx` and `PackView.tsx`, using agreed optional provenance fields and existing UI styles. Manual flow is a regression target.
3. PM integrates; independent QA exercises cron-to-library flow, manual generation, persistence/editing, settings/pause and publication controls in an actual browser. Tests must use a controlled test database/account and avoid real publication.

## Meaningful validation

- Empty saved preferences are due after 08:00 locally; explicit off, onboarding businesses, empty platform lists, disallowed custom weekdays and pre-due ticks do no work. Cover date boundaries/timezones and a tick several hours late.
- Repeated/concurrent ticks queue once. Simulated insert failure rolls back its mark and a later tick recovers. Existing singleton semantics alone are insufficient because completed jobs leave the partial unique index.
- Retry after pack persistence and concurrent `autoRun` calls return the same stable ID; edited draft text remains intact. Retry across midnight retains original date. Settings disabled after enqueue prevent work.
- Radar body, approved upcoming topic, crawled blog, search suggestion and profile-only cases all produce grounded packs. Upcoming copy has no fabricated published link. Broken source/search provider falls through; bounded recent history reaches the writer. Cross-tenant source refs fail.
- Default path creates no `social_pubs` rows; legacy explicit scheduling and publishing-off behavior retain current tests. Lapsed access continues to skip jobs. Manual source creation, edit/regenerate and authorization tests remain green.
- Real-browser desktop/mobile smoke covers default daily status, settings and pause persistence, generating/failure/empty state, provenance, manual generate and edit refresh. Scheduling/posting can be verified with dev stubs; no real external posts.

## Rollout, observability and limitations

The existing worker is required (`npm run worker` or `start:all`); UI visits are not a scheduling dependency. Job errors/results, existing `social.autoRun` outcome events and business rev bumps provide observability; do not log drafted text or secrets. Backlog grows by one pack per enabled business per day; no deletion/retention policy is introduced in this change. Default-on increases AI usage for previously-unconfigured active businesses; explicit opt-outs survive. Roll back generator/default/cron changes to stop new work without deleting existing packs. No deployment or migration is required to review local implementation; operational rollout remains PM/user-owned.
