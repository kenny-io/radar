# Article body images architecture

Approved by PM on 2026-10-27. Architecture owns this record only; PM owns UI, assigned engineer owns application/shared changes. Other agents are working in the checkout.

## Baseline and scope

Actual workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`; branch `kenny/article-body-images`; HEAD and local `origin/main` both `2ab6149eb7f22bd5a482bd7646063d9e2fd4e04f`. PM fetched and fast-forwarded production main before dispatch. Read `.factory/article-body-images/brief.md`, `docs/CONTRACTS.md`, and existing article, drafting, queue, storage, render and connector implementation. No repository AGENTS.md found; supplied user AGENTS instructions apply. Specialist role does not launch another PM workflow.

The body is currently text-only Block tuples. Keep this contract: claim indexing, parse/stream/selection rewriting and existing autosave all rely on its indices. Add generated media alongside text instead of widening every Block consumer. No SQL migration, dependencies, providers or infrastructure.

## Shared data and helper contracts

`src/lib/types.ts`:

```ts
export interface ArticleBodyImage {
  id: string;
  after: {
    heading: string; // h2 text, normalized when matched; '' for unsectioned body
    occurrence: number; // zero-based occurrence among matching h2 headings
    block: number; // original h2 index, or original content-block index when heading === ''
  };
  url: string; // server-created stored image; never submitted by the client
  alt: string; // nonempty plain description of the section illustration
  prompt: string;
  seed: number;
}
// On Article:
bodyImages?: ArticleBodyImage[];
bodyImagesGeneratedAt?: string;
```

Legacy absent values mean `[]` and no timestamp. No automatic backfill or publication requirement for legacy drafts. New full drafts/rewrites require their complete planned image set before success.

`src/lib/articleImages.ts` is pure and safe in client/server. Export `articleBodyImageAnchor(body: Block[], image: ArticleBodyImage): number | null` (return null when no valid placement) and an image-plan helper with typed anchor/section-title/section-text output. All UI and serializers must consume the same anchor helper; no independently copied heading algorithm.

Resolve exact normalized heading plus occurrence first. Image follows the last content block before the next h2, or article end; h3 stays within its h2 section. On heading rename, use original index only if it still names a nonempty h2 section. If the heading was removed and original index is no longer h2, return null. For heading `''`, use the original in-range paragraph/list boundary; never attach to a heading, negative index or beyond article end. Thus paragraph editing and section reordering preserve placement where the heading identity survives. Arbitrary external structural replacement can orphan media; an explicit regeneration restores the plan. Current editor changes block contents but does not insert/delete/reorder blocks.

Plan 2 images for 900/1400-word briefs, 3 for 2200, capped by nonempty h2 sections. Choose evenly spaced sections, preserving document order and avoiding duplicate anchors. Prefer sections across the body, not introduction. With no nonempty h2 sections, choose up to the target number of distinct paragraph/list boundaries distributed across body. Tiny articles can yield one; empty article is rejected. Distinct image ids/seeds and prompts contain each section heading plus bounded local text, article title, style/direction and brand context. Use section-specific headline for the existing template fallback, so it is distinct from cover and other sections. Alt describes the illustration without invented facts. Default body dimensions 1200×675, kind `article-body`.

## Generation and explicit repair contract

Action `article.regenerateBodyImages`, default Editor write role:

```ts
input: { entryId: string }
output: { jobId: string }
```

Uses existing business-scoped entry load; require generated, nonempty body and editable state (`draft`, `review`, `approved`, or recoverable `failed`). Reject `proposed`, `drafting`, `scheduled`, `publishing`, `published`; return 409 `locked` for locked state and 409 `busy` for incompatible active content work. Same-action repeated click returns the existing job id.

Job `article.bodyImages`, businessId set, ref=entryId, payload `{entryId}`; use existing durable queue with finite timeout and two attempts. Progress `{stage:'images', completed:number, total:number}`. Result `{entryId, bodyImagesGeneratedAt:string, count:number}`. No new persistent status on Article: job supplies queued/running/failed/retry UI, timestamp identifies workspace refresh completion. Never report success for partial storage. Preserve old media until all replacements are safely stored, then replace the array atomically. Storage/total failure throws a user-facing RadarError; previous copy, cover, SEO, sources, videos and media remain intact. Failed final job remains visible for retry.

`draftArticle` calls the same body-image generator after final validated text exists, independently of cover. Carry streamed text progress through image generation, and do not mark review/scheduled until the expected planned count has stored successfully. Rewrite from brief replaces media from the new text. Existing cover behavior stays intact; explicit body regeneration never changes cover.

`renderImage` already retries providers and falls back to a generated template (`images.ts:renderImageFile`). Reuse it unchanged. Persist its returned URL only after successful object storage. Render at most two concurrently or sequentially (only 2–3), with progress after each stored image. Do not make another AI planning call: deterministic section planning is sufficient and avoids an extra failure dependency.

## Concurrency, authorization and storage

The current article actions load and then overwrite the full Article, while the queue singleton only deduplicates the same operation; neither alone prevents a concurrent publish/draft/autosave from losing images. Hard server protection is required, even though UI also disables conflicting buttons.

Use short transactions locking the business-scoped calendar entry (`SELECT ... FOR UPDATE`) as the common admission/commit lock. Under this lock:

- Image-job admission checks status and active `article.draft`/`article.bodyImages` jobs. Draft admission similarly rejects an active image job. Dedupe each kind with the queue's partial unique singleton index (`draft:<id>` and `body-images:<id>`); enqueue must participate in admission transaction (small optional executor/transaction overload to existing enqueue is acceptable). Never hold a DB row lock across provider/network work.
- Approval/scheduling and manual publication acquire the same entry lock, then reject either active content job. Drafting start always moves valid editable states to `drafting`, including rewrite from review/draft, and refuses scheduled/publishing/published. This also blocks cron publication without extending publisher networking.
- Image job snapshots body (and generation inputs) under the lock, performs rendering outside it, then locks/reloads entry and Article. Recheck tenant, state, snapshot body equality and active job ownership/attempt. Reject stale body edits with useful retry error. Commit only `bodyImages` and `bodyImagesGeneratedAt` onto the latest article so concurrent SEO/source/video/cover edits survive.
- Any action currently doing load/modify/full-Article save must avoid overwriting the new fields from stale snapshots. Either use the common short lock for final re-read/merge/save, or update only the fields owned by that action using JSONB paths. `article.save` writes submitted fields only; source, videos and cover regeneration write only their own fields. A pure final job merge cannot protect against a later stale whole-document save; cover this race in tests.
- Draft commit similarly rechecks status/job ownership and prevents overwriting newly published content. Prefer refusing mutations while a full draft is active; never overwrite text changed by another tab without detecting the stale snapshot.

Job timeout/recovery does not cancel an underlying promise in existing queue. Before committing generation results, verify persisted job is still active and owned by this attempt (`attempts` and worker lock identity where available). Otherwise discard results. This prevents a timed-out older attempt from writing after retry or completion. Tests invoking jobs inline may need an explicit equivalent ownership seam.

Storage uses `objectKey(bid, 'article-body', 'png')` and existing `storedKey(bid,url)`. Client cannot set media URLs, ids or anchors through autosave. Publishing validates that each stored body URL belongs to this business before converting relative `/api/files/…` to `env.appUrl` absolute URL. Reject invalid/cross-tenant media as a configuration/media publishing error instead of silently publishing text-only. HTTP(S) URLs only; no data, file, javascript or arbitrary external fetch. Public generated assets already use bearerless storage serving; this feature does not introduce private content in URLs or expose provider credentials.

## Rendering and publishing

Extend `RenderOpts` with `bodyImages?: ArticleBodyImage[]`. After each original text block, render resolved body images, then existing videos when they share a boundary. Editor and Preview use same order and normal responsive `<img alt=…>` (width:100%, display:block, stored aspect ratio); generated images are not contentEditable. Empty alt must not be synthesized from a URL.

HTML: `<figure class="radar-body-image"><img src="…" alt="…" width="1200" height="675" loading="lazy" /></figure>` using existing HTML escaping and safe HTTP(S) URLs. Markdown/MDX: `![escaped alt](encoded URL)` using existing escaping/destination rules. Store raw URLs; escape only at serialization. Ensure Markdown punctuation/JSX and quote/script-like alt text cannot break structure.

Extend `PublishPayload` with optional `bodyImages?: ArticleBodyImage[]` so old connector/test fixtures remain valid. `buildPayload` normalizes/validates URLs once, then passes the same list to HTML, Markdown and payload. Retain separate featured `image` unchanged.

Native Notion is the one connector that consumes `p.blocks`, so update `toNotionBlocks` to consume optional bodyImages and insert `image: {type:'external',external:{url},caption:rt(alt)}` after matching text blocks. Preserve image order and existing request batching. External URL must be publicly reachable HTTPS; refuse unusable body images with a clear publishing error (do not silently drop them). Existing `publicHttps` can be reused; no private-host fetch should be introduced.

All other connectors use rendered HTML/Markdown. Specifically Wix uses HTML→Ricos with the IMAGE plugin already enabled, GitHub/Next.js uses Markdown/MDX, webhook consumers receive rendered bodies, and Framer receives HTML. Add Wix conversion request regression coverage with an img node rather than implementing another image path. WordPress/Ghost/Webflow/Wix/Shopify/wpcom body images reference Radar's public storage; only the featured image uses CMS-specific upload. No migration to uploading each body image required.

Notion current primary docs verified 2026-10-27: [image blocks](https://developers.notion.com/reference/block#image) allow external images with URLs and captions; [request limits](https://developers.notion.com/reference/request-limits) retains URL/text/batch constraints. Existing 100-child batching and `rt` chunking remain in use.

## Implementation order and validation

1. Engineer settles shared types and `src/lib/articleImages.ts`, plus plan/anchor tests. Notify PM so UI can import the helpers.
2. Engineer builds reusable generator, additive persistence, action/job and concurrency guards; integrate new draft/rewrite generation. Add meaningful DB integration tests for tenant isolation, lock/dedupe, edit-during-render and stale worker attempts.
3. In parallel after shared contracts exist, PM implements Media controls and editor/preview; UI calls `flushLater()` before starting content work, tracks `app.jobFor('article.bodyImages',id)`, refreshes while successful result timestamp differs from Article, and disables conflicting actions in queued/running/catching state.
4. Engineer integrates payload serializers and native Notion; assert exact same placements and escaped URLs across HTML/Markdown/Notion, with featured image retained. Test Wix HTML conversion and existing connector regression suite.
5. Independent QA: real browser new draft→cover+2 body images; long draft→3; legacy draft→explicit Add body images without copy/SEO/cover changes; regenerate, reload, mobile Media/Preview; failure/retry and locked states. Run integrated typecheck/build and focused tests.

Specific meaningful scenarios: duplicate and renamed headings; section reordering; no headings, one section and empty text; failed provider uses stored template images; one storage failure preserves previous set and marks job failed; concurrent body edit aborts rather than overwrites; concurrent SEO save and cover regen preserve new media; simultaneous approval/publish/draft cannot enter while body job active; other-business entry and URL rejected; stale/late worker cannot commit; HTML/Markdown injection-like alt and URL characters remain escaped; published payload body media are absolute, supported and present in Notion.

## Risks and rollback

Additional model calls add latency/cost (2–3 images per draft). Bounded counts and existing templates limit it. A partial failed generation can leave unused public objects, as current image regeneration already does; cleanup is future work, not a reason to overwrite old media early. Public storage/app URL reachability must be correct for remote CMS readers; local browser QA proves markup, not external CMS access. Full arbitrary structural edits can orphan anchors; explicit regeneration repairs them. No production deployment or content edits are authorized here.

Rollback is reverting application code; additive JSON fields remain harmless to old text-only readers. Existing articles and cover fields are backward compatible. No PM/user decision remains unresolved for this scope.

## Bounded implementation review (2026-10-27)

Reviewed the first integrated implementation read-only while engineer added tests. Shared placement helper returns `number | null`; missing anchors are `null`. Guard error codes are `article_busy` / `article_locked` as used by the implementation.

Aligned implementation: section/image planning is shared across UI and serializers; legacy fields remain optional; action admission uses short tenant-scoped calendar-row locks with transactional job insert; replacement commits onto the latest Article; autosave/source/video/cover paths merge current data instead of dropping media; image success commits verify queue attempt/worker ownership; public body URLs are validated with `storedKey(bid,url)` before rendering; Notion explicitly inserts external image blocks, other connectors inherit HTML/Markdown.

Concrete findings delivered to PM and engineer:

1. `src/server/services/drafting/jobs.ts` final-error cleanup (initial lines 62–67) updates drafting→approved without rechecking attempt ownership. A timed-out final attempt can finish late, fail the owned success check, then demote a newer draft through its catch block. Cleanup and notification must occur only for the current owned attempt, under the same article/job locks. Stale output must have no state effects.
2. `src/server/services/publishing/publisher.ts` reads Article (initial line 115) before final publication admission transaction (initial line 119), then builds from that old object. A save, or unschedule→image regeneration→reapproval before admission, can yield a published body with stale media. Load the authoritative Article together with the admitted entry snapshot inside the final transaction and use that snapshot for payload construction.
3. `src/server/services/drafting/bodyImages.ts` admits `failed` entries even when the entry retains `publishRemote` from a partially completed publication. Subsequent retry reuses the remote draft; WordPress/Ghost publish change status only, so regenerated body images remain absent from that draft. Smallest safe policy is refusing regeneration/full rewrite while a failed entry retains an unresolved remote publication, with a clear instruction to finish retrying publication. Updating every platform's saved draft is broader work; clearing the marker risks duplicate publication after an uncertain send. PM resolves recovery policy.

No application edits were made by architecture review. Findings require re-review after fixes; passing browser generation alone does not establish these concurrency and retry guarantees.

## Unified article view (owner follow-up)
The owner requested one view because Edit and Preview looked the same. Remove the mode switch and render the final article layout once, with inline text editing for open drafts. Article text is read-only for queued/publishing/published entries, Viewers, and active generation. The same body-image placement/rendering contract applies. QA must verify autosave/reload and mobile after this change (AC8).

Review resolution: all three findings above are fixed. Final draft failure cleanup checks attempt ownership before status changes/notification; publication loads the current Article and entry under its admission lock; failed+saved remote drafts are blocked from new image/full-draft generation pending publication recovery. Real-Postgres regressions cover late draft attempts and locked publisher snapshots, and failed pending-remote admission. Shared source fingerprint and final verification are recorded in verification.md.
