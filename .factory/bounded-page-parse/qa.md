# QA record: bounded-page-parse (T2, independent QA)

Revision under test: `1e6ecd47` on `kenny-dev/bounded-page-parse`, worktree `.claude/worktrees/vigorous-bun-88cc86`, tree clean apart from `.factory/bounded-page-parse/qa*`. Base: my own checkout of `main` `b3ad2d50` with its own `npm ci` (removed at the end). macOS arm64 (10 cores, 32 GB), Node 22.18, cheerio 1.2.0, throwaway Postgres 16 on `127.0.0.1:55473` (stopped at the end). No network: the site is a function behind a stubbed `fetch`, or the dev stub site. No UI is affected, so no browser was used. Date: 2026-11-14.

Every probe is in `.factory/bounded-page-parse/qa/` and was run with `npx tsx` from the checkout root (the way the worker is started), not under vitest, unless it says otherwise. Evidence is in `qa/evidence/`.

## Release recommendation

Not ready to merge as it is. The work does what the brief's table asks (AC2 to AC4 hold on every listed shape, results on ordinary pages are identical to the base, the reader's lifecycle is sound), but:

- **D1 is a regression against the base** and should be fixed and retested: a document that is being read while the *calling process* is busy for longer than the limit is reported unreadable. One site's known robots × links stall makes another, ordinary site's analysis fail for good with "couldn’t reach", or lose pages. On the base the other site is only delayed.
- **D2 is the base's behaviour too**, but it defeats the feature's stated aim: a site can still end the worker by memory, now through the reader's answer. The PM has to decide whether it is fixed here or recorded as a follow-up beside robots × links.
- D3 to D5 are for the PM to accept or schedule.

## Acceptance criteria

| AC | Verdict | Evidence |
| --- | --- | --- |
| AC1 no cheerio in the caller | pass | `crawl.ts`, `brand.ts` and everything they import (`devsite`, `env`, `publicNetwork`, `storage`, `untrustedImage`, `pageReader`) have no cheerio import; only the string the child runs has `require('cheerio')`. `robots.txt` is still parsed in the caller by `robots-parser` (text, not HTML or XML). |
| AC2 time | pass | The brief's table with the real limit, each shape through `readPage`, `readBrandPage`, `readSitemap`, `crawlSite` (home page, crawled page, sitemap) and `detectBrand`: 58 rows, longest read 5,002 ms, longest crawl with an ordinary home page in front 5,128 ms (`evidence/brief-shapes.jsonl`). My own 126 pages and 27 sitemaps, all at most 2 MB: longest single read 5,003 ms; nothing settles later than limit + 1 s (`reads-*.jsonl`, `crawl-*.jsonl`). |
| AC3 responsiveness | pass as written; exceeded by shapes outside the table (D2) | Brief's shapes: the caller's 10 ms timer was never more than 4 ms late. My shapes through the reader functions: at most 38 ms, except where the answer is large: 104 to 257 ms (D2). Through `crawlSite` the largest figures are the known robots × links cost (see "Known item"). |
| AC4 memory | pass as written; the cap is a heap cap, not a memory cap (D2) | 173 KB font page: `crashed` in 1.0 to 1.3 s, caller alive, next read works. 85,000 links, 180,000 paragraphs, 150,000 table cells: each read ten times running by one reader (`claims.jsonl`). The reader's resident memory is not bounded by the cap: 446 to 476 MB on those pages, up to 1,991 MB when its answer is large. |
| AC5 recovery, queueing | pass (D4 is a low-severity exception) | After timed_out, crashed, failed, a reader killed or frozen from outside, a closed channel and a reader that cannot run, the next read succeeds. Six reads behind a stalling one that is killed: only the one in flight fails. 300 reads of three kinds at once: 300 right, in order, one reader, listeners `message:1 exit:1 error:1`. No unhandled rejection or uncaught exception in the caller in any probe (`abuse.jsonl`, `queue.jsonl`). |
| AC6 outcomes | pass | Each outcome through `crawlSite`/`detectBrand` with the real 5 s limit (`strikes.jsonl`, `crawl-home.jsonl`, `crawl-page.jsonl`, `crawl-sitemap.jsonl`, `crawl-brand.jsonl`) and one level up through the real `analysis.site` job, real queue, real database (`e2e.json`, 7 tests): unreadable home page (stalls, out of memory, cheerio throws) → job `failed` at once, not put back for its second attempt, `error` and `progress.failed` = "Radar couldn’t reach {domain}. The site may be down or blocking crawlers.", nothing fetched after `/` and `/robots.txt`; another page stalls → job `done` without it; home page the crawler reads and brand detection cannot → `done`, "Logo not found", default colours; reader cannot run → job put back (`queued`) with "Radar couldn’t finish this. Try again.". The brief's "no failure alert" is not what the code does: see D5. |
| AC7 same results | pass | The stored record is from `b3ad2d50`: regenerated on my base checkout by the documented steps, the file is byte-identical (sha256 `c255751a…`). My own corpus (`qa/corpus.mjs`) through `crawlSite` and `detectBrand` on both checkouts: 8 crawls, 274 pages, 101 brand detections, 16,491 values compared, **0 differences** (`same-corpus.txt`). Dev stub site, 9 domains: 184 pages, 8 brand detections, 5,814 values, **0 differences** (`same-stubs.txt`). Mutation check of the engineer's test: 46 of 49 wrong statements noticed by `sameAsMain.test.ts`; the 3 not noticed change nothing observable (`mutants.jsonl`). `devsite.test.ts` is untouched and passes. |
| AC8 lifecycle | pass | 16 ways for the caller to end (return, `process.exit`, uncaught exception, unhandled rejection, SIGTERM, SIGINT, SIGHUP, SIGKILL; reader idle, mid-document, and cold): idle reader gone 0 to 27 ms after the caller; reader inside a document gone 7.03 to 7.05 s after the document began (limit + 2 s); never left running (`life.jsonl`). Caller with nothing left to do exits at once (it lived 0.38 s in all). Idle stop with the real clock: reader gone 30.01 s after its last read; the next read starts a new one (`idle.jsonl`). |
| AC9 regressions | pass | `npm run typecheck`: 0 errors (also with my `.ts` files present). `npx vitest run src/server/services/analysis src/server/services/realCover`: 10 files, 687 passed. Full suite: see "Regression runs". |
| AC10 documents | pass with one inaccurate sentence (D5) | `DIVERGENCES.md` O11, the headers of `crawl.ts` and `brand.ts` say what the code does. `pageReader.ts`'s header says the calling process "does no work per link, per element or per sitemap address": it does. |

## Defects

### D1. A read in flight fails as `timed_out` when the calling process is busy, not the document (High; regression: the base does not have it)
Against: Outcomes ("unreadable" is defined as the document's fault), AC7 (same results), and the header of `pageReader.ts` ("a document gets PAGE_READ_MS of it").

The limit is a timer in the calling process. When that process is busy past the limit, the timer is the first thing to run afterwards: it kills the reader and rejects, although the answer has been waiting in the channel since a few milliseconds after the request. The worker runs four jobs at once on one thread (`WORKER_CONCURRENCY`), so one job's synchronous stretch is every other job's.

Reproduce (each from the worktree root; the two-crawl runs also from a base checkout with the worktree's path to the file):
- `npx tsx .factory/bounded-page-parse/qa/busy.mjs unit`: an ordinary 100-byte page, warm reader, caller busy 6 s → `PageUnreadable(timed_out)`; busy 4 s → read. (`busy-unit.jsonl`)
- `npx tsx .factory/bounded-page-parse/qa/busy.mjs crawls`: two crawls in one process. A is the brief's known follow-up (robots.txt of 10,000 rules, home page of 100,000 links: the caller is busy 15 to 18 s checking them). B is an ordinary site of 13 pages whose analysis starts 150 ms after A's.
  - Expected: B gives 13 pages, however long A keeps the process.
  - Branch: B → `CrawlError('unreachable')`, warning `[crawl] https://b.example/ (the home page) could not be read (timed_out)`. In the job this is the permanent "couldn’t reach" failure, with no retry. Run three times, the same each time. (`busy-crawls-branch.jsonl`)
  - Base: B → 13 pages of 13, after 18 s. (`busy-crawls-base.jsonl`; taken before I corrected my fetch stub, see "The engineer's tests"; the base has no timer to be late, so its outcome does not depend on that)
- `npx tsx .factory/bounded-page-parse/qa/busy.mjs midcrawl`: B (41 pages) is already crawling when A starts. Branch: 40 pages, `/page-0` lost as `timed_out`, and it counts as one of B's three unreadable documents. Base: 41 of 41. (`busy-midcrawl-*.jsonl`)

Anything that keeps the worker's thread for 5 s does this to every read in flight: robots × links today, and the other in-process cheerio users the brief lists as follow-ups.

### D2. The reader's answer is not bounded, and the caller keeps it: a site can still end the worker by memory (High against the feature's aim; the base ends the same way, so not a regression)
Against: the brief's problem statement ("or end the process"), AC3 and AC4 beyond their listed shapes, and the header of `pageReader.ts` ("sends the text and gets plain data back").

What the reader sends back is proportional to things the site controls, and nothing caps it:
- `links`: one entry per `<a href>`, each the page's own address plus the link. A page at an address of 2,000 characters with 50,000 short links is 0.57 MB of HTML and a **97 MB** answer (read in 1.1 s, so never "unreadable").
- `urls` and `sitemaps`: `.text()` of every `<loc>`, and nested `<loc>` elements each repeat the text below them. A 1.81 MB sitemap of 100 nested `<url><loc>` gives a **181 MB** answer; a 1.81 MB sitemap index of 200 nested `<sitemap><loc>` gives **362 MB**, the largest I produced.

Measured (`answers.jsonl`, one case per process; `npx tsx .factory/bounded-page-parse/qa/answers.mjs` lists the cases):

| Document (all under 2 MB) | Answer | Read took | Caller's timer late | Reader peak RSS | Caller heap held |
| --- | --- | --- | --- | --- | --- |
| page, 20,000 links at a 2,000-character address (0.23 MB) | 39 MB | 0.5 s | 27 ms | 362 MB | 40 MB |
| page, 50,000 links at a 2,000-character address (0.57 MB) | 97 MB | 1.1 s | 104 ms | 798 MB | 98 MB |
| page, 12,000 links at an 8,000-character address (0.14 MB) | 92 MB | 0.8 s | 68 ms | 720 MB | 93 MB |
| sitemap, 100 nested `<url><loc>` (1.81 MB) | 181 MB | 1.2 s | 104 ms | 1,073 MB | 182 MB |
| sitemap index, 200 nested `<sitemap><loc>` (1.81 MB) | 362 MB | 1.6 s | 257 ms | 1,991 MB | 361 MB |

The caller keeps every page's `links` for the whole crawl (`pages[].links`, `seen`, `queue`), up to 100 pages:
- `node --max-old-space-size=1536 --import tsx .factory/bounded-page-parse/qa/grow.mjs 100 50000 2000` (caller's heap limited to 1.5 GB to spare the machine): the calling process ends with "JavaScript heap out of memory" inside `JSON.parse` of the reader's answer after 13 pages, exit status 134 (`grow-branch-1536.log`). The base ends at the same point (`grow-base-1536.log`).
- Without the limit, 13 pages: 1,160 MB of link text kept, heap 2.4 GB of this machine's default 4,144 MB limit, the caller's timer up to 347 ms late (`grow-branch-12-pages.log`). The crawl reads up to 100 such pages.

Expected: the calling process survives any site, and what it receives per document is bounded. Actual: as above. For the engineer, through the PM: cap what the reader returns (number and total length of `links`, `urls`, `sitemaps`, `candidates`; length of each string), and cap the length of an address the crawl will queue.

### D3. Pages that are slow but readable are not limited, and all analyses share the one reader (Medium; not a regression: on the base the same pages block the whole process)
Against: the brief's outcome "a hostile site costs at most 3 × 5 s of reader time, plus 5 s", and PM's question on delay.

Only *unreadable* documents count towards the stop after three. A page that takes the reader 3 to 4.9 s is read, and a crawl may read 100 of them.
- `npx tsx .factory/bounded-page-parse/qa/queue.mjs` (`queue.jsonl`): an ordinary site B (31 pages; 0.17 s alone) beside one crawl of 8 pages that take about 3 s each: B finishes after 26.3 s. Beside three such crawls: 78.5 s. Beside a crawl of stalling pages and a brand detection on a stalling home page: 20.3 s. B's result is identical to its result alone in every case, and the caller's timer was at most 16 ms late.
- Not run, by arithmetic: a site of 100 pages at 4.9 s holds the reader for about 8 minutes; three of them in the worker's four slots put about 15 s in front of each of B's reads, which for a 100-page B is past the job's 15-minute limit.

### D4. A reader ended from outside is reported as the document's fault (Low; new with the reader)
Against: the two failure kinds in the design (`PageUnreadable` = the document's fault).
- `npx tsx .factory/bounded-page-parse/qa/abuse.mjs "killed before"`: reader killed before its first message → `PageUnreadable(crashed)` for an ordinary page that was never read.
- `npx tsx .factory/bounded-page-parse/qa/abuse.mjs "killed between"`: reader killed between two reads, next read asked for in the same turn → `PageUnreadable(crashed)`. Asked for 100 ms later → read.
For a home page that is the permanent "couldn’t reach". It needs something outside to kill the reader (a container's memory killer, an operator). The reader reaching 1 to 2 GB resident (D2) makes it the likeliest process to be chosen.

### D5. Statements that do not match what I measured or read (Low)
- `pageReader.ts` header: the calling process "does no work per link, per element or per sitemap address". `crawl.ts` runs `links.forEach(push)`, `fromSitemap.forEach(push)` and `out.push(u)` there. Cost without a robots.txt: 59 ms for 160,000 links, small but not none; with one: see "Known item".
- Brief, Outcomes: "no retry and no failure alert". No retry is right (tested). By reading `jobs/queue.ts` and `observability/failures.ts`, every failed job, permanent ones included, goes through `reportFailure`, which delivers an alert when alerts are enabled (production); `shouldReportFailure` is not consulted on that path. The same is true of an unreachable site on the base. Read from the code, not run with alerts on.
- Brief, Outcomes: "a hostile site costs at most 3 × 5 s of reader time, plus 5 s": see D3.
- `READER_HEAP_MB` comment, "which then holds 340 to 470 MB in all": 446 to 476 MB on those three pages; 1.0 to 2.0 GB when the answer is large (D2).

### Known item, measured: robots rules × links (out of scope per the brief; numbers only)
`links-cost.jsonl`, the caller's longest late timer during a crawl whose home page has n links:

| n | no robots.txt | two-line robots.txt | 20 rules |
| --- | --- | --- | --- |
| 35,000 | 2 ms | 40 ms | 51 ms |
| 85,000 | 7 ms | 102 ms | 133 ms |
| 160,000 | 59 ms | 208 ms | 299 ms |

With 10,000 rules and 100,000 links: 15.1 to 17.6 s over three runs (the brief says 20 s). So the 100 ms of AC3 is passed by any site with a robots.txt and a page of some 85,000 links, and this is the stretch that sets off D1.

## Behaviour differences from the base

Intended (each is in the brief or follows from its design):
1. A document the reader cannot read: home page → `CrawlError('unreachable')` (base: the process stalls, ends, or `crawlSite` throws); other page → skipped; sitemap → ignored; `detectBrand` → nothing and one warning. Checked for all 126 + 27 hostile documents.
2. A crawl stops after three unreadable documents and returns what it has (`strikes.jsonl`: three stalling sitemaps → home page only after 15.0 s, the fourth sitemap never fetched; ten stalling pages → three read attempts, 15.0 s).
3. When the home page is unreadable no sitemap is fetched (base fetched sitemaps first). Otherwise the requests and their order are the same: the `asked` lists of all 8 corpus crawls are identical.
4. `300 open <font>, then 3,000 <p>` (17 KB): base reads it in 4.9 s (crawl) and 2.8 s (brand); branch → unreadable in 0.6 to 1.5 s. Accepted in the brief.
5. Flat pages of about 250,000 elements or more no longer fit under the heap cap as a crawled page, though the base reads them in about a second (`dense-branch.jsonl`, `dense-base.jsonl`): 250,000 `<p>x</p>` (1.9 MB), 290,000 `<b></b>`, 480,000 `<li>`, a `<select>` of 200,000 `<option>` → `unreachable` as a home page. 200,000 `<p>x</p>` (1.5 MB) is read. Brand detection (one parse, not two) still reads all of them. The brief accepts "a page of about 250,000 elements".
6. A home page brand detection needs more than 5 s over: 55,000 `<img class="logo">` (1.9 MB): base gives colours and language after 13.3 s; branch gives no logo, colours or language after 5.0 s, while the crawl reads the page.
7. Pages nested deeper than about 2,000 to 2,500 levels (properly closed): base throws `RangeError: Maximum call stack size exceeded` out of `crawlSite`; branch → `unreachable` for a home page, skipped otherwise. The depth at which it starts is the same on both (`depth.txt`).
8. `classifyPage` is no longer exported from `crawl.ts`; `ARTICLE_PATH`, `LISTING_PATH`, `uaToken`, `fetchUrl`, `crawlSite`, `CrawlError` are, and the two patterns are character for character the base's.

Unintended:
1. D1: ordinary documents reported `timed_out` when the calling process was busy. Base: delayed, complete.
2. D4: a reader ended from outside is an "unreadable document".
3. No difference of any kind on ordinary input: 0 differences in 22,305 compared values.

## Worst numbers measured

| What | Value | Where |
| --- | --- | --- |
| Longest settle time of one read | 5,003 ms (limit 5,000) | `reads-page.jsonl`, 200,000 foster-parented `<div>` |
| Longest crawl ended by an unreadable home page | 5,008 ms | `brief-shapes.jsonl` |
| Longest caller event-loop delay, reader functions, brief's shapes | 4 ms | `brief-shapes.jsonl` |
| Longest caller event-loop delay, reader functions, any shape | 257 ms | `answers.jsonl`, 362 MB answer |
| Longest caller event-loop delay through `crawlSite`, no robots.txt | 347 ms | `grow-branch-12-pages.log`, 97 MB answers |
| Same, with the known robots × links cost | 15.1 to 17.6 s | `busy-crawls-branch.jsonl` |
| Largest answer | 362 MB from a 1.81 MB sitemap index; 181 MB from a page | `answers.jsonl` |
| Reader peak resident memory | 1,991 MB (read); 1,645 MB (then crashed); 446 to 476 MB on dense ordinary pages | `answers.jsonl`, `claims.jsonl` |
| Caller peak resident memory | 1,266 MB for one answer; 2,488 MB after 13 pages, growing with each page until the heap limit | `answers.jsonl`, `grow-branch-12-pages.log` |
| Reader lifetime after its caller is gone | 27 ms idle; 7.05 s from the start of its document when busy | `life.jsonl` |

Stated numbers against measured (`claims.jsonl`): cold start "about 130 ms" → first read of a cold reader 115 to 118 ms (Node plus cheerio alone 95 to 104 ms). Ordinary 1.5 MB pages "0.3 s" → `readPage` 250 and 272 ms median, `readBrandPage` 114 and 148 ms, so 0.36 and 0.42 s for both reads of a home page. Watchdog "limit + 2 s" → 7.03 to 7.05 s. Open-fonts page ends the reader "in about a second" → 1.04 s. "Only a page of some 250,000 elements … does not fit" → confirmed at 250,000 `<p>x</p>`; 200,000 fits.

## The engineer's tests

They test what they claim. `pageReader.test.ts` uses a real child throughout and shortens the limit to 1 s for most stalling shapes, with two left at 5 s; I ran all of the brief's shapes at 5 s myself. `sameAsMain.test.ts` is a real comparison: the record is the base's, the fixtures cover every selection the reader makes, and 46 of 49 mutants are caught (the other three: `$('main, body').first()` is always `body`; `new URL` trims an address anyway; trimming the page's CSS changes no colour). One limit worth knowing: the AC3 test for a 35,000-address sitemap is written for a site with no robots.txt, as its comment says; with any robots.txt the same crawl is 38 to 52 ms late, and over 100 ms from about 85,000 addresses.

One mistake of my own, corrected before any number here was taken: my first `fetch` stub answered without letting the event loop turn, so a crawl of thousands of failing addresses ran from microtask to microtask and my timer read seconds late. The stub now yields once per request, as a real fetch does; the crawl-level files were rerun.

## Regression runs

| Command | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npx vitest run src/server/services/analysis src/server/services/realCover` | 10 files, 687 passed |
| `DATABASE_URL=… npx vitest run --config .factory/bounded-page-parse/qa/vitest.config.ts` | 7 passed (`e2e.json`) |
| Branch, full suite, with database (three runs, the third on a new database) | 215 files, 4,029 tests: 6, 7 and 16 failed. Always `ai/openrouter.qa.test.ts` (known) plus tests in the shared-database files `idle.cadence.db`, `idle.db`, `lifecycle/autopilotIntro`, `lifecycle/founderIdentity`, `lifecycle/dispatch`, `lifecycle/education`. Each of those six files passes when run alone. Nothing under `analysis` or `realCover` failed in any run. |
| Base, full suite, with its own database (three runs) | 212 files, 3,877 tests: 2, 4 and 3 failed. Always `openrouter.qa.test.ts`, plus `lifecycle/dispatch`, `idle.cadence.db`, `idle.db`, `lifecycle/founderIdentity`. |
| The shared-database files as a group, base and branch alternately, three times each (`npx vitest run src/server/services/lifecycle src/server/idle.db.test.ts src/server/idle.cadence.db.test.ts`) | The same files fail on both, the base no less often (base 18, 17, 18 failed tests; branch 14, 17, 16). So the larger counts in the branch's full runs are this flakiness, on a machine at load average 18 to 31 with three more CPU-heavy test files beside them, not a change in behaviour: none of these files imports changed code. |
| Branch and base, full suite, no database | Branch: 215 files, 2 failed files, 1 failed test, 3,368 passed, 646 skipped. Base: 212 files, the same 2 failed files and 1 failed test, 3,216 passed, 646 skipped. The 152 more are the three new test files. |
| Base and branch, no database: `realCover.db.test.ts`, `openrouter.qa.test.ts` | identical on both: `realCover.db.test.ts` fails in `afterAll` (ECONNREFUSED), the parity snapshot fails. Both claims confirmed. |

`realCover/page.ts` and `realCover/index.ts` are not in the diff; they import `ARTICLE_PATH`, `LISTING_PATH` and `uaToken` from `analysis/crawl`, which still exports the same values, and importing `crawl.ts` starts no process (the reader starts on first read). Their 4 test files pass.

## What I could not run
- Production's container: its memory limit is unknown to me, so "ends the worker" is shown with the caller's heap limited to 1.5 GB and by the growth per page, not at the default limit.
- Linux. Everything ran on macOS; signals, the memory killer and resident-memory figures may differ.
- Alerts turned on (D5 is from reading the code).
- Any real website (no network by instruction). No saved pages of real websites were found offline: the "saved" part of my corpus is the repository's 100-odd tracked HTML files (email previews) and one file from a dependency.
- `next build` (the PM's run).

## Outside this task (noticed, not chased)
- A crawl has no limit on failed fetches: a home page of 160,000 links to missing pages makes 160,003 requests to the site, four at a time (`MAX_PAGES` counts pages read). Base too.
- `analysis.site` stores `links.slice(0, 200)` per page; each of the 200 may be megabytes long. Base too.
- `classifyPage` counts words from `$('main, body').first()`, which is always `<body>`. Base too.
- `.factory/bounded-page-parse/verification.md` appeared untracked in the worktree during my run; it is not mine.

## Files
- Probes: `qa/lib.mjs` (harness), `docs.mjs` (hostile documents), `corpus.mjs` (ordinary corpus), `reads.mjs`, `crawl-hostile.mjs`, `brief-shapes.mjs`, `answers.mjs`, `grow.mjs`, `links-cost.mjs`, `busy.mjs`, `abuse.mjs`, `queue.mjs`, `life.mjs` + `life-child.mjs`, `idle.mjs`, `cwd.mjs`, `strikes.mjs`, `depth.mjs`, `dense.mjs`, `claims.mjs`, `same.mjs` + `same-compare.mjs`, `mutate.mjs`, `summ.mjs`, `e2e.db.qa.test.ts` + `vitest.config.ts`.
- Evidence: `qa/evidence/` (one file per probe, named after it).

## Cleanup
- No page reader of mine is running (`pgrep -f max-old-space-size=384`: none). My Postgres (port 55473) is stopped and its data directory removed.
- My base checkout (`…/scratchpad/qa/qa-base`) and my scratch copy for the mutation check (`…/scratchpad/qa/qa-mut`) are removed with `git worktree remove`; the PM's `pm-main` was not touched.
- The mutation check changed files only in that scratch copy; `git status --short` in the worktree shows only `.factory/bounded-page-parse/qa.md`, `.factory/bounded-page-parse/qa/` and the `verification.md` that is not mine. Nothing under `src/` was changed, nothing committed, pushed or stashed.
- `.data/` in the worktree (git-ignored; created by my end-to-end test and my full-suite runs at 03:23) is removed.
- Logs of the suite runs stay in the scratch directory `…/scratchpad/qa/`; their summary lines are in `qa/evidence/regression-runs.txt`.
