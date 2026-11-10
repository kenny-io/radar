# OPT-E2 handoff: lighter saves (LS-1 … LS-4)

Base `b2c33a50`. Worktree branch `worktree-agent-ac6bc35b94ff11c90`. Nothing pushed, merged or deployed.
Design: architecture.md §3 with the §12 rulings. Where this differs from them, see "Deviations".

## What each criterion does now, and where

**LS-1 Debounced autosaves get back only the new revision.**
`actLater` (`src/client/app.tsx`) always sends `reply: 'rev'`. The act route (`src/app/api/b/[bid]/act/route.ts`) answers
`{ ok, data, rev }` and never calls `loadWorkspace` for it. `bump()` (`src/server/workspace.ts`) returns the new revision.
Measured `article.save` reply: 78–79 bytes (the old reply on the same data: 51 KB with 2 drafts, 84 KB with 9).
The client's bookkeeping for a reply that carries no workspace is `RevSync` in `src/client/articleSync.ts`.

**LS-2 The workspace carries no article bodies.**
For the current client `Workspace.articles` is `Record<string, ArticleSummary>` (`generated`, `outline`, `v`), built by
`articlesOf()` in `src/server/workspace.ts` with a query that never selects `data`. The body is loaded by the read
action `article.get` (`src/server/actions/article.ts`, Viewer, tenant-checked) through `useArticle(entryId)`
(`src/client/articles.ts`). `src/features/article/ArticleLoad.tsx` is the skeleton and the error state with Retry.

**LS-3 No behaviour change in editing, autosave, streaming, body images, calendar, counts, publishing, social.**
`ArticleWorkspace.tsx` reads the article from the hook instead of `B.articles[id]`; saves keep their keys and go through
`app.actLater` / `app.act` as before, so `flushLater` still covers them. Draft streaming still reads job progress from
SSE (untouched). `ContentCalendar.tsx` reads `B.articles[id].outline` for Undo of Replace topic; `SocialFlow.tsx` reads
`B.articles[id].generated` and needed no edit (the summary has that field). Outline edits also patch the summary in `B`
(`patchOutline`), so the calendar's Undo sees an outline typed a moment ago, as it did before.

**LS-4 No lost or clobbered edits.**
Rules in `ArticleSync` (`src/client/articleSync.ts`), wrapped by `useArticle`:
- A fetched article is applied only if the app is not busy and no local edit happened since the request started;
  otherwise it is dropped and asked for again (short timer, and every revision change).
- A reload is wanted when the workspace's `v` for the open article *changes* to something other than what is on
  screen (§12.1). The tab's own revision-only saves do not move `v` in `B`, so they never trigger one.
- `article.save` and `article.source` return `{ ok, v, prev }`. The client moves its loaded version to `v` only when
  `prev` is the version on screen; a save whose `prev` is something else means a teammate saved in between, and the
  article is reloaded once idle (§12.2). Replies answered out of order are joined, not treated as foreign.
- Opening an article while saves are pending flushes them and waits for every call in flight before fetching (§12.3).
- A teammate's save: `rev` SSE event → idle refresh → new `v` → reload. If this tab is dirty the reload waits, the
  tab's save merges server-side (field-level patch, as before), and the merged article arrives after the save.
- A revision somebody else wrote between two of this tab's revision-only replies is detected (`RevSync.gap`) and
  triggers the existing idle refresh; before this, such a bump was silently swallowed.

## Wire contract as implemented

Request header `x-radar-client: 2` on every `api()` call (`src/client/api.ts`); `actCall(bid, action, input, reply?)`.

| Request | Reply |
|---|---|
| `GET /workspace`, header present | workspace; `articles[id] = { generated, outline, v }` |
| `GET /workspace`, no header (legacy tab) | workspace exactly as before: `articles[id]` is the whole article |
| `POST /act` read action, any client | `{ ok, data }` |
| `POST /act` write, header, `reply: 'rev'` | `{ ok, data, rev }`; no workspace is built |
| `POST /act` write, header, no `reply` | `{ ok, data, rev, workspace }` (summaries) |
| `POST /act` write, no header, with or without `reply` | `{ ok, data, workspace }` with whole articles and no `rev` |

- `v` = `articles.updated_at` in epoch ms; `0` when the entry has no article row yet.
- `article.get { entryId }` → `{ article, v }`. `article.save` / `article.source` → `{ ok: true, v, prev }`, `prev` read
  under the article lock. `save()` writes `updated_at = max(now, prev + 1)`, so a save always moves `v`.
- `touchActive(biz, actor)` still runs on every non-read reply (before `bump`), revision-only replies included.

## Files changed

| File | Change |
|---|---|
| `src/app/api/b/[bid]/act/route.ts` | `reply` in the body; three reply shapes; legacy branch |
| `src/app/api/b/[bid]/workspace/route.ts` | passes the articles mode from the header |
| `src/server/workspace.ts` | `bump` returns `rev`; `articlesMode`, `articleV`, `articlesOf`; `loadWorkspace(…, opts?)`. F0 calls untouched |
| `src/server/actions/article.ts` | `article.get`; `save()` returns `{ v, prev }`; `article.save` / `article.source` return it; `load()` filters the article by business too |
| `src/lib/types.ts` | the one `articles` line |
| `src/client/api.ts` | `CLIENT_HEADER`; `actCall` takes `reply` |
| `src/client/app.tsx` | `busy()`, `ActOpts.reply`, `actLater` `done` callback and `reply: 'rev'`, `RevSync` in `act` and `refresh`, `Pending` behind `busy` / `flushLater`. `useSeenPing`, `routeToUrl`, the SSE listeners are untouched |
| `src/client/articleSync.ts` (new) | `RevSync`, `Pending`, `ArticleSync`, `draftLanded`, `bodyImagesLanded`: no React |
| `src/client/articles.ts` (new) | `useArticle(entryId)` |
| `src/features/article/ArticleWorkspace.tsx` | article from `useArticle`; `setA` patches the hook; reload after cover style, cover regenerate, video suggestions, draft and body-image completion; loading and error returns |
| `src/features/article/ArticleLoad.tsx` (new) | skeleton and error state with Retry |
| `src/features/calendar/ContentCalendar.tsx` | line 201: `.outline` |
| `src/client/articleSync.test.ts`, `src/server/lighterSaves.db.test.ts` (new) | tests, below |

## Tests added

`src/client/articleSync.test.ts` (30 tests, no database):
- RevSync: own save moves the revision by one · a foreign revision between two saves marks stale until a refresh
  lands · out-of-order replies are not a gap · a held and then dropped workspace reply is not a false gap, and a
  teammate's write next to it still is · last write in flight applies the newest workspace, `keepLocal` only moves the
  revision · a workspace older than an already answered save is never applied.
- Pending with the real `LaterQueue`: busy while a save waits and while it is in flight · busy through a flush (no idle
  tick) · an article opened in that tick is fetched only after the flushed save finished.
- ArticleSync: skeleton then article · leave and return flushes and waits · failed first load shows the error and
  Retry loads · a failed background reload keeps the article · late response after close is ignored · a teammate's
  save reaches an idle article · typing during an in-flight reload is not overwritten (both "still saving" and "already
  saved") · a write with no local edit also drops an in-flight copy · a dirty article is left alone and gets the
  change after its save · the timer alone picks up a held reload · own saves never reload · `prev`/`v` adoption and the
  teammate-in-between case · two own saves out of order · no loop on a stale workspace · a change during a load is
  fetched afterwards · `reload()` works with an unchanged `v` · draft and body-image completion predicates.
- Mutation check: 14 deliberate breaks of the rules (drop the edit guard, fetch while busy, plain inequality, always
  adopt `v`, ignore the gap, apply an outdated workspace, ignore a flush in `busy`, …) each fail at least one test.
  One of them (dropping the busy-on-arrival guard) survived the first round and got its own test.

`src/server/lighterSaves.db.test.ts` (9 database tests + 1 source scan), through the real route handlers:
- revision-only reply: keys `ok,data,rev`, `rev` = previous + 1, under 1 KB also for a whole-body save, and
  `loadWorkspace` is not called · a write without `reply` carries `rev` and a workspace of summaries · v2
  `GET /workspace` contains no body text · a headerless request gets whole articles and no `rev`, even if it sends
  `reply: 'rev'` · `article.get` for a Viewer, no revision bump, version `0` for an entry without a row ·
  another business's entry id is 404 and leaks nothing; a non-member and a signed-out caller get 404 / 401 · a Viewer
  cannot save · `prev` chains across own saves and breaks when another member saves in between, with both edits
  stored · every writer moves `v`: `article.save`, `article.source`, `article.videos`, `article.regenerateImage`, cover
  style, the publisher's cover write, the body-image job, the draft job, `calendar.replace`; the workspace summary and
  `article.get` agree on `v` throughout.
- Source scan (runs without a database): every statement that updates `articles` sets `updatedAt`, no raw SQL writes,
  and the list of writer files is pinned so a new writer is noticed.

## Check results

- `npm run typecheck`: clean.
- `npm test` (no database), final tree: **1107 passed, 380 skipped, 1 failed**. Baseline 1076 / 371 / 1 (re-measured
  here before editing: same). The one failure is `src/server/ai/openrouter.qa.test.ts` (golden snapshot, untouched).
  +31 passed are the 30 client tests and the source scan; +9 skipped are the database tests.
- Database suite (`RADAR_DEV_STUBS=1 npx vitest run --no-file-parallelism`, throwaway database, final tree):
  **1436 passed, 65 skipped, 1 failed** (the same golden snapshot). Baseline 1396 / 65 / 1; +40 are the new tests.
  The database baseline is the PM's figure; I did not re-run it on the untouched base.
- Browser (Playwright driving headless Chrome, app on :3422 against the throwaway database, dev stubs): 29 of 29
  checks in the main pass on the final tree, 4 of 4 at phone width, 10 of 10 in the second pass, 3 of 3 for Undo.
  Earlier runs of the main pass failed in ways that were the script's (caret placement, a too-strict stream count)
  and in one way that was a real defect, fixed: see deviation 2.

## Browser pass (real app)

Main pass: calendar generated and approved · article opens with the skeleton, then the undrafted article · "Draft
now": partial text with caret streams in, then the finished article replaces it after one `article.get` · angle edit:
debounced `article.save` reply `{ok,data,rev}`, 78 bytes, text stays · body paragraph edited and saved on blur ·
neither save refetched the article · reload: both edits persisted · type, leave, return in 214–288 ms: the edited
text is shown, the save went out first and exactly one `article.get` followed it · a second session's save reached the
idle article (2.2–6.3 s across runs, bounded by the SSE poll) · typing during a second session's save kept every character, the other
session's change arrived after this tab's save, and the server holds both · error state with Retry, Retry loads ·
every `/act` and `/workspace` request from the page carried the header.
Phone width (390 px): skeleton and error state without horizontal overflow; `role="status"` / `role="alert"` present;
Tab reaches Retry and Enter retries.
Second pass (§3.4 actions, on a drafted article): remove and restore a source (shown at once, saved, no refetch) ·
embed and remove a suggested video (renders in the draft with its credit line) · cover style change (saved, the
select shows it, one reload) · alt text typed then Regenerate (the typed text is saved first and stays, seed
advances, one reload) · regenerate body images (the new set appears in the editor without a manual refresh) · an
outline section added on the article screen is in the workspace summary · calendar and social pages render.
Calendar: Replace topic, then Undo, restores the previous outline including a section added just before. That run
reached the calendar by a full page load, so it proves the server summary, not the optimistic `patchOutline` path
on its own.

## Measured sizes

Same business and data, one request each. "Before" is the headerless request, which is byte-for-byte the old reply
(the test asserts it equals the stored article).

| | Before | After |
|---|---|---|
| `article.save` reply, debounced (119-byte request) | 51,341 B with 2 drafts · 84,310 B with 9 drafts | **78–79 B** |
| `article.save` reply, immediate (block edit on blur) | same as above | 25,321–27,938 B (the workspace, no bodies) |
| `GET /workspace`, 30 entries | 51,259 B with 2 drafts · 84,228 B with 9 drafts | 25,229–27,847 B, does not grow with drafts |
| `article.get` (one drafted article) | n/a | 5.5–5.9 KB |

## Deviations from architecture.md, and why

1. **No `article-load.css` file; the loading frame's CSS is an inline `<style>` in `ArticleLoad.tsx`.** A stylesheet
   that only a page imports made the article page load twice. Measured: with `import './article-load.css'` (in the
   component, or in `client/app.tsx`, which every page also imports) Next emits `article/[id]/page.css`; it is inserted
   when the workspace arrives and the page first renders; React suspends that commit, the `<Suspense>` around
   `AppProvider` in `(app)/layout.tsx` falls back, and on reveal the provider's effects run again: `setBState(null)`,
   a second `GET /workspace`, a second EventSource, and the article fetched again. Without a page-level stylesheet:
   one of each. The effect re-run is React StrictMode (development); in production I expect only the brief blank
   fallback, **not verified** (no production build was run). The existing `support.css` does not have this problem
   because `SupportWidget` is rendered by the shell, so its CSS is in the layout's stylesheet.
   **This applies to any page-level CSS import under `(app)`**, e.g. E3's `features/dashboard/first-week.css` if
   `FirstWeek.tsx` imports it: please check `/dashboard` for two `GET /workspace` on a hard load after integration.
   If you prefer a `.css` file for this screen, it has to be imported from a module only the layout reaches
   (`AppShell.tsx` or `(app)/layout.tsx`, neither mine): move the `CSS` string from `ArticleLoad.tsx` into
   `src/features/article/article-load.css` and add `import '@/features/article/article-load.css';` there.
2. **`busy()` is `later.size > 0 || inflight > 0 || a flush is under way`.** A flushed save leaves the queue one
   microtask before its request starts (`laterQueue.ts`), so the two-term definition reads "idle" in the middle of
   `flushLater()`. The browser trace showed the article being fetched concurrently with the save it was meant to wait
   for. `Pending` (articleSync.ts) adds the third term; `laterQueue.ts` is unchanged.
3. **The revision-gap verdict is taken when the tab goes idle, from the set of the tab's own reply revisions**, not
   as `reply === local + 1` per reply. Two saves in flight at once (angle, then SEO title) can be answered out of
   order, which the per-reply rule reads as a gap. The outcome is the same idle refresh; `B.rev` still moves on every
   revision-only reply.
4. **`refresh()` does not apply a workspace older than a revision the tab already holds**; it asks again (at most
   twice). With revisions now moving without a workspace, an older snapshot would otherwise put `B.rev` back and its
   SSE event would already have been skipped.
5. **A workspace reply older than an already answered revision-only save is not applied** (it would undo that save's
   optimistic state on any screen); the tab refreshes instead. A held workspace followed by a revision-only reply is
   dropped as before, with no refresh.
6. **`article.get` is called with `actCall`, not `app.act`**, so the fetch does not count as the app being busy (it
   could then never be applied). A 402 still goes to `/start-trial`; other failures show the error state, no toast.
7. **`useArticle` returns `saved(r)` in addition to the specified fields**; a debounced save reports through
   `actLater(…, { done: art.saved })`.
8. **Legacy `data` is not byte-identical for two actions**: `article.save` and `article.source` now return
   `{ ok, v, prev }` to every client. The legacy envelope (`{ ok, data, workspace }`, no `rev`) and its workspace are
   unchanged, and the old client ignores this `data`.
9. **Body-image completion reloads the article on `bodyImagesLanded`** (job result newer than what is on screen)
   instead of on every `done` status, so opening an article within two minutes of a finished job does not fetch
   twice. The draft-completion effect keeps its `app.refresh()` next to the new `reload()`.
10. A failed immediate save (`then(art.saved, art.reload)`) reloads the article; before, `act` refreshed the
    workspace, which contained it. Same result: the optimistic edit is replaced by the server's copy.

## Changes needed in files I do not own

None required for this to work. Two for the PM to decide:
- Optional, deviation 1: a `.css` file for the loading frame, imported from the shell or the `(app)` layout.
- Docs I did not touch: `ARCHITECTURE.md` ("The client app object") still says every `act` response carries the fresh
  workspace and does not mention `busy()`, the `done` option of `actLater`, or that `B.articles` holds summaries and
  the article screen uses `useArticle`. `docs/CONTRACTS.md` needs `article.get`, the `reply` field, the three reply
  shapes and the `{ v, prev }` result (§7.2 leaves that file to integration).

## For E4: what not to break

- `ArticleWorkspace.tsx`: `A` comes from `useArticle`; it is `null` while loading and the component returns the
  skeleton or error *after all hooks*. Add hooks above those two returns. Do not read article fields from
  `B.articles[id]`: only `generated`, `outline`, `v` exist there. For the review pager, order and status come from
  `B.calendar.entries`, and `generated` from the summary.
- Every local change to the article goes through `art.patch(...)` first, then the save. An immediate save ends with
  `.then(art.saved, art.reload)`; a debounced one passes `done: art.saved`. A new action that changes the article
  server-side in a way the client cannot derive calls `art.reload()` after it.
- "Approve and next" changes the route param. `useArticle` restarts per entry and flushes pending saves before
  fetching, so no extra flush is needed; do not cache articles between entries.
- Keep `patchOutline` on brief saves: the calendar's Undo of Replace topic reads that summary.
- `ContentCalendar.tsx`: `B.articles[id]` is a summary (`.outline`, not `.brief.outline`).
- `app.tsx`: `act` hands every reply to `revs.current.reply(...)`, and `refresh` calls `revs.current.reset(...)`;
  `busy` / `flushLater` go through `pending`. The toast listener and `routeToUrl` are as they were. A new
  `actLater` caller gets a revision-only reply (it already discarded the workspace).
- `article.get` is fetched twice per open in development (StrictMode double mount; the first is discarded). One in
  production.

## Untested or uncertain

- No production build (`next build`) was run. The stylesheet finding in deviation 1 is measured in development only.
- Two different members were simulated as two sessions of the same user in the browser, and as separate members
  (Owner / Editor / Viewer) in the database test.
- All drafting, images and videos ran on dev stubs. A stub draft finishes in about 2 s, so the stream shows one or two
  progress updates; how much streams depends on the SSE poll (5 s idle, 1.5 s while a job runs), which is unchanged.
- New client against an old web instance during the switch: the old instance sends whole articles in the workspace
  and does not know `article.get`. The article screen shows the error state with Retry (as §8 says); in addition
  `B.articles[id].outline` is undefined there, so Undo of Replace topic would restore an empty outline during that
  window. Not handled.
- Reads sent through `app.act` still do not release a held workspace reply when they are the last call in flight.
  That is as before this change, and the next revision event recovers it.
- `v` has millisecond resolution. Two writes to one article in the same millisecond by writers other than
  `article.ts` (`calendar.replace`, the publisher, the jobs) would share a `v`; `article.ts` itself always adds at
  least 1 ms. Not observed.
- Rich-text blocks save on blur, as before: text being typed in a block (not yet blurred) is not protected from a
  reload that changes that same block. Unchanged behaviour, and reloads are now rarer than the old per-revision
  workspace replacement.
