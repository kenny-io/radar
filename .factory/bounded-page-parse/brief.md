# Brief: a page cannot stall or end site analysis

## Problem
`analysis.site` runs in the worker process. `crawl.ts` parses every crawled page (up to 100 per site) and every sitemap with cheerio, and `brand.ts` parses the home page again, all on the worker's one JavaScript thread. A page under the crawler's 2 MB cap can keep that thread busy for tens of seconds, or end the process. Every other job in the process waits or dies with it.

## Measured on `main` `8e3a4da3` (macOS arm64, Node 22.18, cheerio 1.2.0)
Pull request 57 was merged while this work was under way (`main` is now `b3ad2d50`). It changed how logos are read, not the cheerio calls measured here: `crawl.ts` is untouched and `brand.ts` keeps the same selections, so the table holds for `b3ad2d50`.

`probe/run.mjs steps-main.mjs` runs each page in its own process with a 30 s limit and times every cheerio step that `extract`, `classifyPage` and `detectBrand` run. Full rows: `probe/evidence/main-steps.json`. Profiles: `probe/evidence/main-profile.jsonl`.

| Page | Size | What happened |
| --- | --- | --- |
| 100,000 `<style>` | 1.8 MB | crawler's `.remove()` 14 s, then stopped at 30 s inside brand's `$('style').map()` |
| 60,000 `<img>` in a `<header>` | 1.5 MB | brand's header image `.map()` 9.4 s |
| 45,000 stylesheet links | 1.9 MB | brand's stylesheet `.map()` 4.2 s |
| header SVG nested 64,000 deep | 448 KB | every selection 1.4 s or more, 28 s in all; `.text()` and `$.html()` throw "Maximum call stack size exceeded" |
| 64,000 nested `<div>` | 320 KB | `cheerio.load` 24 s; stopped at 30 s |
| 16,000 nested `<div>`, then 16,000 `<img>` | 368 KB | `cheerio.load` 1.2 s twice, header image selection 10 s twice |
| 100,000 nested `<span>` with text | 1 MB | parse is fast; every selection 3 s or more; stopped at 30 s |
| 300 open `<font>`, then 3,000 `<p>` | 17 KB | 8.4 s in all (the tree has 900,000 elements) |
| 3,000 open `<font>`, then 30,000 `<p>` | 173 KB | **the process ends**: "JavaScript heap out of memory" inside `cheerio.load` |
| ordinary: blog index, 4,000 cards | 1.5 MB | 0.31 s in all |
| ordinary: shop home page, 2,500 products | 1.5 MB | 0.34 s in all |

Where the time is (CPU profiles, self time):

| Step | Function | Why |
| --- | --- | --- |
| `cheerio.load`, deep tree | parse5 `startTagInBody` / `_startTagOutsideForeignContent` (87%) | each start tag walks the stack of open elements |
| any selection, deep tree | domutils `find` (89%) | its traversal stack uses `unshift`/`shift`, which move the whole stack |
| `.map()` | cheerio `map` (90%) | `elems = elems.concat(val)` per element |
| `.remove()` of many siblings | domutils `removeElement` (98%) | `lastIndexOf` + `splice` on the parent's children per element |
| `header img` and the like, deep tree | css-select `cachedDescendant` (97%) | each candidate walks all its ancestors |
| `cheerio.load`, unclosed formatting elements | garbage collector (69%), parse5 `_reconstructActiveFormattingElements` | each paragraph rebuilds every open formatting element: elements = paragraphs × open fonts |

QA's guess (`.map()` copies, selectors quadratic in depth) was right but partial: there are five separate causes in four libraries, and one page ends the process by memory, not time.

## Decision
All cheerio work on a site's documents (page, home page for brand, sitemap) moves into one reusable child process, the "page reader", with a time limit per document and a memory cap. The calling process only sends the text and receives plain data.

Why this and not the alternatives:
- A cheap scan of the text before parsing cannot know the depth or the element count the parser will build. End tags the parser ignores (`<div><object></div>` repeated), raw-text elements and formatting-element rebuilding all defeat a count of tags; a 173 KB page becomes 90 million elements. A sound scan would be a second HTML tree builder.
- Bounding the selections one by one means patching five causes in four libraries, and nothing bounds the next one. It also does not address memory.
- A worker thread bounds time, but one heap-out-of-memory abort in any thread ends the whole process. A child process cannot take the caller down, and the codebase already uses this pattern for untrusted pictures (`realCover/picture.ts`).
- A child per document costs about 130 ms each (measured: Node start plus loading cheerio), 13 s on a 100-page crawl. One reusable child costs that once.

Spike (`scratchpad`, not kept): reader child with IPC, 256 MB cap, 5 s limit. Ordinary 1.5 MB pages 0.2–0.3 s; a 1.9 MB page of 85,000 links 0.43 s; stalling pages stopped at 5.0 s; the memory page ended the child in 0.8 s; the caller's longest event-loop gap was 6 ms; the caller exits without waiting for the child.

What an ordinary large page still gets: everything it gets today. Nothing is truncated or refused by size or shape; the only limits are 5 s of the reader's time and its memory cap, and the two ordinary 1.5 MB pages use 0.3 s.

## Design
New module `src/server/services/analysis/pageReader.ts`:
- The reader's code is a plain JavaScript string run with `spawn(process.execPath, ['--max-old-space-size=…', '-e', CODE], { cwd: process.cwd(), env: { PATH, NODE_ENV }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })`, as `picture.ts` does (a string, so neither Next's bundler nor a TypeScript loader is involved). It `require`s cheerio, answers one message at a time, and exits on `disconnect`.
- One child per process, started on first use, reused, `unref`'d together with its channel so it never keeps the caller alive, stopped after 30 s idle.
- Requests are queued, one in flight. The time limit starts when a request is sent. On the limit: `SIGKILL`, the request fails, the next request starts a new child. A child that exits mid-request fails that request only.
- The reader also watches itself: a second thread inside it ends the reader two seconds past a document's limit. The caller's timer normally fires first; this covers a caller that has gone away or is itself busy (measured without it: a reader inside a stalling page ran 33 s after its parent was killed).
- Two failure kinds: `PageUnreadable` (reason `timed_out` | `crashed` | `failed`: the document's fault) and a plain `Error` when the reader cannot be started (ours; stays loud).
- Exports: `readPage(html, url, origin)`, `readBrandPage(html, origin)`, `readSitemap(xml, base, host)`, each with an optional `{ timeoutMs }` for tests, and `PAGE_READ_MS = 5000`.
- The reader's statements are the ones in `main`'s `extract`, `classifyPage`, `cssColors` (its three selections), `logoCandidates` and `inlineHeaderSvg`, in the same order. Regular expressions shared with the caller (`ARTICLE_PATH`, `LISTING_PATH`, the asset-extension pattern) are written once and placed into the string by their `.source` and `.flags`. No `Function.prototype.toString`. `normUrl` and `sameSite` are needed on both sides: the reader's copies sit beside the TypeScript ones, and a test holds them equal on a table of addresses.

`crawl.ts`: no cheerio import. `extract` awaits `readPage`. `parseSitemaps` awaits `readSitemap(xml, base, host)`, which returns the child sitemaps' addresses as written and the page addresses already normalized and filtered to the site, so the caller only queues them (35,000 addresses cost the caller 55 ms when it did that work itself). The home page is read before the sitemaps, so unreadable sitemaps cannot use up the crawl's count before the home page has had its turn; the order of requests to the site is unchanged. `classifyPage` is no longer exported (nothing else uses it). `ARTICLE_PATH`, `LISTING_PATH`, `uaToken`, `fetchUrl` stay exported from `crawl.ts`.

`brand.ts`: no cheerio import. `detectBrand` awaits `readBrandPage` once and works from its data: `{ css, stylesheets, theme, candidates, svg, htmlLang }`. The logo reading that pull request 57 added (`readLogo`, `../untrustedImage`) is not touched.

Outcomes when a document is unreadable (`PageUnreadable`):
- Home page: `crawlSite` throws `CrawlError('unreachable')`. The job fails once, permanently, with the designed copy and no retry.
- Any other page: skipped, as a failed fetch is.
- Sitemap: ignored, as a failed fetch is.
- A crawl stops reading after 3 unreadable documents (pages and sitemaps together) and returns what it has, so a hostile site costs at most 3 × 5 s of reader time, plus 5 s if brand detection also gives up.
- `detectBrand`: no logo, no colors, no language, one `console.warn`, nothing fetched.
- Reader cannot start: the plain `Error` propagates from `crawlSite` and `detectBrand` (job retry and alert, as for any unexpected failure).

## Acceptance criteria
- AC1. `crawl.ts` and `brand.ts` do not import cheerio; no site-controlled HTML or XML is parsed in the calling process by `crawlSite` or `detectBrand`.
- AC2. Time: for every stalling page in the table above (and the same shapes served as a crawled page, as the home page, and the deep and wide shapes as a sitemap), each of `readPage`, `readBrandPage`, `readSitemap` settles within its limit plus 1 s. With the default limit that is 6 s.
- AC3. Responsiveness: while any of those reads runs, a 10 ms timer in the calling process is never late by more than 100 ms.
- AC4. Memory: the 173 KB font page fails its read (`crashed`) within the limit and the calling process is still running; the reader has a fixed heap cap under which a dense ordinary 2 MB page still reads, ten times in a row in the same child.
- AC5. Recovery and queueing: after a failed read the next read succeeds; of several reads queued behind a stalling one, only the stalling one fails.
- AC6. Outcomes as listed under "Outcomes", each covered by a test through `crawlSite` or `detectBrand`.
- AC7. Same results: a fixture site and a set of home pages run through `crawlSite` and `detectBrand` give results identical to `main` `b3ad2d50`, compared against a stored record produced by running the same harness on `main`. The fixtures cover every signal the reader computes (see T1). The existing `devsite.test.ts` crawl passes unchanged.
- AC8. Lifecycle: the reader does not keep its parent alive, exits when its parent goes away (at once when idle, within its document's limit plus 2 s when busy), and stops after 30 s idle.
- AC9. `npm run typecheck` passes. Full suite: no failure that is not on `main` (`openrouter.qa.test.ts` parity snapshot is known; the shared-database files are flaky and are rerun alone).
- AC10. `DIVERGENCES.md` O11 and the file headers say what now happens.

## Decided during implementation
- Heap cap 384 MB. Measured by the engineer: 2 MB pages of 85,000 links, 180,000 paragraphs or 150,000 table cells read ten times running in one reader; only a page of about 250,000 elements of eight bytes each does not fit (512 MB would read it for 130 MB more). The 173 KB font page ends the reader in about a second.
- The 17 KB font page (900,000 elements) was readable on `main` in 8.4 s; it is now unreadable. Accepted: it is not a page anyone publishes.
- A reader that cannot load cheerio reports that as the plain `Error`, so a wrong working directory does not make every site look unreachable.

## Decided after QA round 1 (`qa.md`, defects D1–D5 on `1e6ecd47`)
- D1, the limit is kept by the reader, not the caller. A caller that was itself busy for more than the limit failed an ordinary read as `timed_out` (its timer fired before it read the waiting answer), which made an ordinary site "unreachable" beside a crawl that kept the worker busy. Now the reader's own watchdog ends it at the document's limit, with a signal that only the watchdog uses, and the caller decides a read from what the channel delivers: an answer the reader wrote in time is used however late the caller reads it. The caller keeps a timer at the limit plus two seconds that only kills (for a reader whose watchdog did not), never decides.
- D2, the answer is bounded. A 0.57 MB page at a long address returned 97 MB of links, a 1.8 MB nested sitemap index 362 MB, and the caller keeps links for every page: thirteen such pages ended the caller by memory, as on `main`. Now, in the reader: an address longer than 2,048 characters is not a link or a sitemap entry; a page gives its first 500,000 characters of links (about 8,000 ordinary addresses; the crawl reads at most 100 pages); a sitemap gives its first 2,000,000 characters of page addresses (no more than the largest sitemap that can be fetched holds, so an ordinary sitemap loses nothing) and its first 100 distinct child sitemaps (the crawl follows at most 12); brand detection gets the first six logo candidates, which is all it ever used; and an answer over 8 MB is a failed read.
- D3, a crawl has 60 s of reader time in all. Only unreadable documents counted, so a site of pages that each take three seconds held the one reader for minutes and other analyses waited (an ordinary 31-page site: 0.17 s alone, 78 s beside three such crawls). Time is counted by the reader's clock. When it is used up the crawl stops reading and returns what it has, as after three unreadable documents. The heaviest ordinary site measured (1.5 MB pages, 0.25 s each) would use 25 s for 100 pages. Still true and accepted: analyses share one reader, so one can wait for another's 60 s.
- D4, a reader that ends without the document being the cause is tried once more. A reader killed from outside (an operator, the kernel under memory pressure) gave `crashed` for an ordinary page, and for a home page that is the permanent "couldn't reach". A read whose reader ended for any reason but its watchdog is repeated once in a new reader; the second ending is the document's fault.
- D5, wording: the caller's work per link is small and bounded, not absent; a permanent job failure is still reported to the failure log as on `main` (the brief's "no failure alert" was wrong: what is avoided is the retry); the heap cap bounds the heap, and the reader's whole memory is re-measured after D2.
- Found while fixing D1: the caller's kill-only timer could not be a wall-clock timer either. A caller busy for 8 s ran it before reading the channel and killed a reader whose answer was larger than the pipe holds (9 of 12 ordinary reads lost in the engineer's measurement, the 1.5 MB blog index among them). It now counts 250 ms turns of the caller's own event loop up to the limit plus two seconds, so a busy caller never fires it; it still only kills.
- Consequences accepted: a document that ends two readers (the out-of-memory page) takes two tries, 2.2 to 2.5 s, so AC2's bound for such a document is twice its limit; a home page whose `<style>` text is megabytes of control characters is a failed read (its answer is over 8 MB as JSON) where it was read before.
- Not run on Linux: the watchdog's signal (SIGALRM) and the pipe's size differ there. If the signal did not end the reader, the caller's kill at the limit plus two seconds would, and the read would still be `timed_out`.
- Correction to "Outcomes": "a hostile site costs at most 3 × 5 s" holds for unreadable documents only. With D3 the bound for one crawl is 60 s of reader time plus one document's limit, plus 5 s for brand detection.

## Decided after QA round 2 (`qa.md`, "ship" on `283e71d0`, low items N1–N4)
- N1, fixed: a caller busy in pieces (250 ms or more of work in every turn of its event loop for seven seconds) could still lose an answer of megabytes, because the kill-only timer counted those turns. A turn now counts only when the caller spent less than half of it working (`performance.eventLoopUtilization`). QA's probe `busy2.mjs choppy`: 23 of 30 read before, 30 of 30 after.
- N2, accepted: a reader frozen from outside for longer than the limit, or sent the watchdog's own signal from outside, counts as the document's fault.
- N3, fixed: two of the three tests that survived mutation now catch it; the third guarded a `ref()` nothing could observe, which is removed.
- N4, accepted and stated: the crawl's 60 s is the reader's clock time, so on a crowded machine a very heavy ordinary site can stop short (100 pages of 1.5 MB stopped at 84 with the reader on a third of a core). It returns the pages it has.
- The timer checks inside the test suite allow 500 ms, not 100: one failed at 168 ms with the machine at load 32. The 100 ms criterion is held by QA's probes (33 ms at worst across the hostile corpus).
- Still true: the caller's longest block that is not the robots check is its own colour scan in `brand.ts`, 202 to 225 ms on 1.95 MB of the shortest custom properties plus three stylesheets (236 ms on `main`). It is linear and was not in this work.

## Out of scope (follow-ups)
- `robots.txt` rules × links: `crawlSite` checks every discovered link against robots in the calling process. Measured: 10,000 rules (440 KB) cost 0.2 ms per link, so one page of 100,000 links costs 20 s there. Not HTML parsing; needs its own change.
- Other in-process cheerio users: `realCover/page.ts`, `realCover/index.ts` (sitemaps), `social/source.ts`, `backlinks/linkcheck.ts`.
- A crawl has no limit on failed fetches: a home page of 160,000 dead links makes 160,003 requests (QA, on `main` too).
- `fetchUrl` returns an empty body, not a truncated one, when a single chunk is over 2 MB (engineer, on `main` too).

## Delivery
Branch `kenny-dev/bounded-page-parse` from `main` `b3ad2d50`. Pull request to `main`. No merge, no deploy (`main` auto-deploys to Railway).
