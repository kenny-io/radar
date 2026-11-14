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

---

# Round 2: the fixes for D1 to D5, on `283e71d0`

Revision under test: `283e71d0` (same branch, same worktree; round 1 above is as it was written, on `1e6ecd47`). Base: a fresh checkout of mine of `b3ad2d50`, removed at the end; the base's full-suite numbers are round 1's (the base has not changed). Same machine, Node and cheerio; throwaway Postgres 16 on `127.0.0.1:55473`, stopped at the end. No network, no browser (no UI is affected). Date: 2026-11-14.

Round 2 evidence is in `qa/evidence/r2/`; round 1's files are untouched. New probes: `busy2.mjs`, `busy3.mjs`, `kills.mjs`, `budget.mjs`, `caps.mjs` + `caps-compare.mjs`, `brandcost.mjs`, `mutate2.mjs`. Every round 1 probe was run again; `life.mjs`/`life-child.mjs` gained a frozen-reader case, `e2e.db.qa.test.ts` a slow-site case.

## Recommendation for `283e71d0`

**Ship.** D1 to D5 are fixed as decided, nothing that passed in round 1 has regressed, and results on ordinary input are still identical to the base. Two new low-severity findings are for follow-ups, not for this pull request. N1 is a narrower leftover of D1: it needs a calling process that is busy in pieces of a quarter of a second or more for 28 turns of its event loop in a row with no idle moment between them, which no job in the worker is known to do. N4: the 60 s a crawl gets is time by the clock, so on a machine where the reader gets a third of a core an ordinary site of a hundred 1.5 MB pages is cut at 84 pages; the PM should check that against the size of the production container. The two small test gaps (N3) and the wording points under D5 change nothing a user gets.

## Verdict per defect

| Defect | Verdict | Evidence |
| --- | --- | --- |
| D1 a busy caller made a document unreadable | fixed for every case of round 1 and for a caller busy in one stretch; one narrower case remains (N1) | `r2/busy-unit.jsonl`, `r2/busy-crawls-branch.jsonl`, `r2/busy-midcrawl-branch.jsonl`, `r2/busy2.jsonl`, `r2/busy3.jsonl` |
| D2 unbounded answer | fixed | `r2/answers.jsonl`, `r2/grow-branch-1536.log`, `r2/caps-compare.txt`, `r2/same-corpus.txt`, `r2/same-stubs.txt` |
| D3 slow readable pages, one reader | fixed as decided (60 s of the reader per crawl); analyses still share one reader, as accepted | `r2/budget.jsonl`, `r2/budget-spent.jsonl`, `r2/budget-sitemaps.jsonl`, `r2/queue.jsonl`, `r2/e2e.json` |
| D4 a reader ended from outside | fixed | `r2/kills.jsonl`, `r2/kills-signals.jsonl`, `r2/abuse.jsonl` |
| D5 wording | fixed, with four small points left | below |

### D1
My round 1 reproductions:
- `busy.mjs unit`: an ordinary page, caller busy 6 s in a callback of its own, in an I/O callback, and in the same turn: **read** each time (round 1: `timed_out`).
- `busy.mjs crawls` and `midcrawl`: B gets 13 of 13 and 41 of 41 pages. With links now bounded, A keeps the process only 3.3 s there, so I added `busy3.mjs`: A's stretch comes from a sitemap of 75,000 addresses against 10,000 robots rules (11.6 to 12.5 s of unbroken caller work, longer than the limit and the backstop). B (13 small pages and the 1.5 MB blog index), started 0, 150, 400 and 700 ms after A: **14 of 14 pages each time, the blog index with its 4,003 links**, no warning.

The fix attacked (`busy2.mjs`; every answer is compared with the same document read while idle):
- Caller busy 8 s in one stretch, starting in the same turn (before the document is handed over), 0.1 s later (reader at work), 0.5 s later (answer in the channel), and in an I/O callback; seven documents whose answers are 0.2 KB, 0.15, 0.54, 1.16, 1.89, 3.62 and 7.44 MB: **28 of 28 read, the same answer as when idle**, no second reader.
- During a retry (reader killed from outside 50 ms in, caller busy 8 s from then): read, by the second reader. Five reads queued, then busy 8 s: all five read.
- A stalling page while the caller is busy 9 s: `timed_out`, and the reader had ended itself 5.1 s after it got the page, by `SIGALRM`. A stalling page with an idle caller settles in 5,019 to 5,031 ms. Nothing outlives its limit by the grace when the caller is free; the only document that takes longer than one limit is one that ends two readers (the accepted two tries: 2.2 to 2.7 s for the out-of-memory page, 8.0 s for a page I had killed at 4 s twice).
- The calling process itself frozen for 9 s (SIGSTOP, then SIGCONT): the blog index is read; a stalling page is `timed_out`.
- The reader frozen and left frozen: killed by the backstop, `timed_out` after 7,050 ms. Frozen before it gets the page and thawed 6 s later: read.
- A reader whose watchdog is broken (in a scratch copy I made the watchdog do nothing): a stalling page is `timed_out` after 7,056 ms by the backstop, the next page is read, three stalling pages in a row take 7.06 s each; with the caller busy 12 s as well the reader worked on for 18.9 s, since the backstop only counts while the caller is free (`r2/broken-watchdog.jsonl`).
- Kept alive for ever? No. A caller with nothing else to do and a frozen reader ends 7.5 s after it started; with a stalling page, at 5.5 s (`r2/life.jsonl`).
- Clock jumps: not simulated by changing the clock. `pageReader.ts` reads no wall clock (no `Date`); the limit is a timer in the reader, the backstop counts turns. Freezing either process is the nearest I could get, above and in N2.

### D2
- `answers.mjs` again: the page that answered 97 MB now answers 0.48 MB; the sitemaps that answered 181 and 362 MB answer nothing (each "address" is megabytes of text); reader peak 84 to 262 MB (was up to 1,991), the caller holds 0 to 2 MB of it (was up to 361).
- `grow.mjs` again, caller heap limited to 1.5 GB as in round 1: **all 100 pages read, 47 MB of links kept, heap 68 MB, resident 180 MB, timer at most 19 ms late, exit 0** (round 1: dead after 13 pages).
- Largest answer I could produce: 7.44 MB (a home page with 1.3 MB of control characters in a `<style>`; 1.4 MB of them is over 8 MB as JSON and is a failed read, as accepted). The largest page answer in my corpus is 0.54 MB and the largest sitemap answer 2.05 MB.
- Peak memory over the whole hostile corpus (126 pages, 27 sitemaps, every way in): reader 547 MB, caller 264 MB (`r2/reads-*.jsonl`, `r2/crawl-*.jsonl`).
- Ordinary results unchanged: my corpus and the dev stub site against the base again, **0 differences in 22,305 values**.
- Each bound from both sides, branch against base (`caps.mjs`, 24 cases): 15 identical. The 9 that differ are the bounds doing what they say:
  - a page of 10,001 or 30,000 links of 50 characters: the page's list ends at 10,000; the pages crawled, what each gives and the 200 links the job stores are identical;
  - an address of 2,049 characters or more is not a link, a sitemap entry or a child sitemap (2,048 is): that page is not crawled;
  - 1.4 MB of control characters in a `<style>`: no colours or language.
  - The one case where a bound changes which pages are crawled without anything being over-long: a page of 12,000 links where only numbers 11,000 to 11,049 lead anywhere: base 51 pages, branch 1. An ordinary site does not look like that; I list it so it is known.
- Nothing is cut that an ordinary large site would notice: a full sitemap of 35,000 addresses, 17,000 Japanese addresses that are 3.9 million characters once encoded (cut to 8,810, of which the crawl uses 100), an index of 150 sitemaps (the crawl follows 12), seven logo candidates (six were ever tried), a 0.5 MB `data:` logo: all identical to the base.
- What still grows in the caller with something the site controls: the robots × addresses check (known, out of scope; now at most about 21,000 addresses a page and 83,000 a sitemap: 3.3 s and 11.6 to 12.5 s with 10,000 rules), and brand detection's own colour scan (see "Worst caller delay").

### D3
- What is counted (`budget.mjs spent`): the reader's own time for a read (3 ms, 290 ms, 3,186 ms), not the time a read waited in the queue (0 ms counted, 3.2 s waited); a failed read its real time; a timed-out one 5,000; the out-of-memory page 5,000 (it took 2.5 s in two readers); a page whose first reader was killed from outside, the second reader's time only.
- 40 pages of about 3 s each: **20 pages read, the crawl ends after 60.6 s**, one warning `has had its 60 s of the page reader: stopped with 20 page(s) read`. With two stalling pages among them: 17 pages, 61.8 s. Twelve sitemaps of 3.3 s each and then such pages: 7 pages, 60.9 s (a sitemap's time counts).
- Through the job (`r2/e2e.json`): a stub site with 30 such pages added: job `done` after 67 s, "20 pages on …".
- `queue.mjs` again: unchanged where the other crawls need less than 60 s (B, 31 pages: 0.18 s alone, 26 s beside one crawl of eight 3 s pages, 78 s beside three, 20 s beside stalling ones; identical results). Where they need more: two 40-page crawls at once each stop at 20 pages after 119 and 122 s, and B beside them finishes at 122 s. So the wait is now bounded by the other crawls' 60 s each, as the brief says, where it was minutes each.
- An ordinary heavy site, 100 pages of 1.5 MB: all 100 read, crawl 21.9 and 24.7 s in two runs, 21 to 22 s of the reader's time (0.20 to 0.27 s a page), so a margin of about 2.8 times on this machine. The allowance is time by the clock, though, and the margin goes with the machine's speed: see N4.

### D4
- A warm reader killed at 41 moments from 0 to 400 ms into the 1.5 MB blog index, a new reader killed at 41 moments from 0 to 200 ms after it is started, a reader killed at 26 moments while its 3.8 MB answer is on its way: **108 of 108 read, 0 wrong answers**.
- SIGTERM, SIGINT, SIGHUP, SIGQUIT, SIGSEGV, SIGABRT, SIGUSR2 from outside, 100 ms in: read by a second reader each time.
- Twice in a row: `crashed`, the next page read, three readers started. Three kills with six pages asked for at once: the first `crashed`, the other five read, settled in the order asked. A kill while six reads wait behind a 3 s page: all seven read, in order.
- Not retried for ever: the out-of-memory page ends exactly two readers (2.2 to 2.4 s, five times running), then ordinary pages are read. A timed-out document is not tried again.
- Both of round 1's reproductions now read the page.

### D5
The header of `pageReader.ts`, the comments on its constants, `crawl.ts` and `DIVERGENCES.md` O11 now say what the code does, and the numbers in them agree with mine (document written out as JSON: 22 to 38 ms for 2 MB of control characters; 20,888 shortest links a page; reader 364 to 477 MB on dense pages; 100 heavy pages about 22 to 25 s; the brief's "no failure alert" is withdrawn). Four small points:
- `READER_GRACE_MS`: "It counts only time in which this process was free to read the reader's answer", and the header's "This process keeps no limit of its own … a document is not unreadable because its answer was read late". True for a caller busy in one stretch; not for one busy in pieces (N1).
- Header: the answer is bounded "so a document cannot make this process hold more than it sent". A 1.3 MB page can answer 7.4 MB. Bounded, at 8 MB.
- Header: "6 ms for 72,000 sitemap addresses" with no robots.txt. I measured 32 and 37 ms for 75,000 (2 ms for 35,000; 3 to 5 ms for a page's 20,888 links, as it says). Well under 100 ms either way.
- `crawl.ts`: "one crawl costs the reader at most that plus one document's limit". A document that ends two readers has two tries and is counted as one limit, so up to three such documents add their second try: at most 15 s more.

## New findings

### N1. A caller busy in pieces, not in one stretch, can still make an ordinary large document `timed_out` (Low; a narrower leftover of D1)
The backstop counts turns of the caller's event loop that are at least 250 ms apart, 28 of them. A caller that does 250 ms or more of work in every turn, with no idle turn between, moves only one channel-buffer of the document or the answer per turn (about 64 KB here), so a document and answer of more than about 1.8 MB together are not through after 28 turns, and the reader is killed with the answer on its way.
- `npx tsx .factory/bounded-page-parse/qa/busy2.mjs choppy` (`r2/busy2.jsonl`): the caller does 20, 60, 120, 260, 500 or 1,000 ms of work in every turn for 15 s.
  - a 100-byte page, and the 1.5 MB blog index: read in all 12 cases (the blog index needs 24 to 25 turns: 3 short of the backstop);
  - a 1.97 MB sitemap of 45,000 addresses: `timed_out` at 260 and 500 ms a turn;
  - a home page whose answer is 3.6 MB: `timed_out` at 260 and 500 ms; one whose answer is 7.4 MB: at 120, 260 and 500 ms.
  - 7 of 30 lost. Expected: read, as with a caller busy 8 s in one stretch.
- Why Low: between two pieces of real work a job normally waits for something (a fetch, a query), and in any idle moment the transfer finishes at once; the known robots × addresses stretch is one stretch per page with a fetch after it, and it does not trigger this (`busy3.mjs`). It needs something that yields with `setImmediate` or already-settled promises between pieces for 7 s or more. Linux's channel buffer is larger than macOS's, so it should take a larger document there; not measured.
- For the engineer, through the PM: count a turn only when the turn before it was idle, or start the count again whenever the channel has moved.

### N2. Two ways a reader's end is still read as the document's fault (Low; by design, listed so they are known)
- A reader frozen from outside for longer than the limit in the middle of a document and then thawed is ended by its watchdog at once: `timed_out` for a page that needs half a second (`busy2.mjs frozen`: frozen 0.15 s in, thawed 6 s later). Thawed after 2 s: read. Frozen before it gets the page: read. The reader's clock runs while it is frozen.
- `SIGALRM` sent to the reader from outside is `timed_out` with no second try (`r2/kills-signals.jsonl`); every other signal gets the second try. The code says nothing else sends it.

### N3. Two parts of the fixes that no test holds (Low; tests only)
`mutate2.mjs` undoes one part of a fix at a time in a scratch copy and runs `pageReader.busy.test.ts`, `pageReader.test.ts` and `unreadable.test.ts`. **24 of 27 are noticed** (`r2/mutants.jsonl`): every bound of D2, every rule of D3, the watchdog's signal, its time and its being told a document is done, the backstop's existence and its counting turns instead of time, the second try and there being only one. So the new tests do fail without the fixes. Not noticed:
- a failure decided on the reader's exit alone, before its channel has closed. The test written for exactly this ("an answer the reader wrote before it was killed is used") passes either way here, because on this machine the answer is delivered before the exit is; nothing holds the rule.
- links past a page's total being skipped instead of ending the list: in the test, the late short link does not fit either way.
- the reader not keeping the caller alive while it has a document: the backstop's own timer keeps the caller alive, so the `ref()` changes nothing that can be observed. Not a gap.

### N4. The crawl's 60 s is time by the clock in the reader, so a slow or crowded machine shortens an ordinary heavy crawl (Low; for the PM to weigh against production's size)
- `npx tsx .factory/bounded-page-parse/qa/budget.mjs heavy`: 100 ordinary pages of 1.5 MB: 100 read, 21 to 22 s of the reader.
- `npx tsx .factory/bounded-page-parse/qa/budget.mjs heavy-loaded`: the same site while 20 other processes each keep a core busy on this 10-core machine: the reader takes 0.62 to 0.84 s a page, and the crawl stops with **84 of the 100 pages** and the 60 s warning (`r2/budget-heavy-loaded.jsonl`). The job goes on with 84 pages.
- It takes both an unusually heavy site (a hundred pages of 1.5 MB of markup; a hundred pages of 150 KB need about 3 s) and a reader that gets a third of a core. I do not know the production container's size, so I cannot say how near that is.

## Regressions from round 1's passes

| AC | Round 2 | Evidence |
| --- | --- | --- |
| AC1 | pass | no cheerio import in `crawl.ts`, `brand.ts` or their imports; unchanged |
| AC2 | pass, with the accepted change | The brief's table at 5 s, 58 rows: a timed-out read settles after 5,010 to 5,178 ms (the mutation run was going on beside it; 5,019 to 5,031 ms alone), longest crawl 5,209 ms, nothing at 6 s (`r2/brief-shapes.jsonl`). Hostile corpus: longest read 5,228 ms with seven other processes of mine running. A document that ends two readers takes two tries: 1.5 to 3.7 s for the 17 that do, never over two limits. |
| AC3 | pass | Brief's shapes: at most 12 ms late (other runs of mine going on beside it). Hostile corpus through the reader functions: at most 33 ms. Through `crawlSite` with a two-line robots.txt: at most 35 ms for pages (round 1: 228 ms; links are bounded), 161 ms for a sitemap of 75,000 addresses (robots × addresses, known). |
| AC4 | pass | Out-of-memory page: `crashed` after two readers, caller alive, next read works. Dense pages ten times in one reader, 364 to 477 MB. |
| AC5 | pass | `r2/abuse.jsonl`, `r2/kills.jsonl`: 300 reads at once right and in order, listeners `message:1 exit:1 error:1 disconnect:1`, 0 unhandled rejections or exceptions in any probe. |
| AC6 | pass | `r2/strikes.jsonl`, `r2/crawl-*.jsonl`, and the job: 8 tests (`r2/e2e.json`): unreadable home page → `failed` at once with the designed copy (out-of-memory home page now after 2.6 s); other page stalls → `done` without it; brand cannot read the home page → no logo, default colours; slow site → `done` with 20 pages; reader cannot run → `queued`. |
| AC7 | pass | 0 differences in 22,305 values against the base; the engineer's record is unchanged and still passes. |
| AC8 | pass | 17 ways for the caller to end: idle reader gone 25 to 27 ms after it; a reader inside a document gone 5.04 to 5.06 s after the document began (round 1: 7.05 s); none left. Idle stop at 30.02 s. From another directory: the plain "could not run" Error. |
| AC9 | pass | `npm run typecheck`: 0 errors. `npx vitest run src/server/services/analysis src/server/services/realCover`: 11 files, 715 passed. Full suite, 216 files, 4,057 tests (28 more than round 1, all in the three analysis test files). No database, two runs: the two failures of the base (`realCover.db.test.ts` in `afterAll`, `openrouter.qa.test.ts`), 3,395 and 3,396 passed. With a database, two runs: `openrouter.qa.test.ts` both times; in the first also five tests in the shared-database files `idle.cadence.db`, `idle.db`, `lifecycle/dispatch`, `lifecycle/guides` (the class the base shows, round 1), in the second nothing else (3,981 passed). One thing to know: in the first no-database run one test of `pageReader.test.ts` failed once, its own timing check ("with the limit every document gets": this process's timer 168 ms late where it allows 100), with the machine at load average 32 from the PM's runs and mine together. It passed in the other three full runs and in three runs of the file alone, and my own measurements of the same thing are 4 to 12 ms. I take it for the machine, not the code, but that check can fail on a crowded machine. `r2/regression-runs.txt` |
| AC10 | pass, with the four points under D5 | |

Outcome changes in the hostile corpus since round 1, all of them explained: a `<style>` of 2 MB of control characters is now a failed read (accepted); a sitemap index of 1,000 nested sitemaps is read (it ran the reader out of memory); a home page of 50,000 apple-touch-icon links, which brand detection read in 4.7 s in round 1, was `timed_out` this time at 5.0 s (it sits at the limit; the machine was busier).

## Worst caller delay (the PM's question 3)
The engineer's figure is for the right place but is low for the worst content. With no robots.txt, the longest the caller's 10 ms timer was late:

| What | Late |
| --- | --- |
| `brand.ts` colour scan, 1.95 MB of CSS in the page and three stylesheets of 300,000 characters, all `--a:#f00;` | **202 to 225 ms** (four runs); 236 ms on the base, which has the same code (one run, read off the screen, not kept as a file) |
| the same, colours close to one another | 151 to 165 ms |
| 1.9 MB of CSS in the page alone, `--a:#f00;` | 132 ms |
| a sitemap of 75,000 addresses queued | 32 to 37 ms |
| writing a 2 MB document of control characters to the reader | 22 to 38 ms |
| a page of any number of links (20,888 kept) | 3 ms |
| a lang of 1.9 MB; a stylesheet address of 1.9 MB | 18 ms; 31 ms |

So about 200 to 225 ms, not 150, in the place the engineer names; I found nothing worse without a robots.txt. It is caller code the base has too (`r2/brandcost-branch.jsonl`, `r2/brandcost-max.jsonl`).

## Worst numbers, round 2

| What | Value |
| --- | --- |
| Longest settle of one read that is not a second try | 5,228 ms (other runs beside it); 5,019 to 5,031 ms alone |
| Longest a document held the reader | 8.0 s (a 4.5 s page whose reader I killed at 4 s, twice) |
| Longest caller event-loop delay, reader functions | 33 ms |
| Longest caller event-loop delay, `crawlSite`/`detectBrand`, no robots.txt | 202 to 225 ms (brand colour scan) |
| Largest answer | 7.44 MB |
| Reader peak resident memory | 547 MB |
| Caller peak resident memory | 264 MB; 180 MB over a 100-page crawl of the round 1 memory shape |
| Reader lifetime after its caller is gone | 27 ms idle; 5.06 s from the start of its document |

## What I could not run
- Linux and the production container: the watchdog's signal, the channel's buffer (N1 depends on it) and memory figures are macOS's.
- A changed system clock (see D1).
- Alerts turned on; any real website; `next build` (the PM's).

## Cleanup
- No page reader, Postgres or helper process of mine is running. My Postgres (port 55473) is stopped and its data directory removed.
- My base checkout and my two scratch copies for the mutation checks are removed with `git worktree remove`; the PM's `pm-main` was not touched. The mutation checks changed files only in those scratch copies.
- In the worktree, `git status --short` shows only files under `.factory/bounded-page-parse/qa.md` and `.factory/bounded-page-parse/qa/` as mine (three probes changed, nine added, `evidence/r2/` added), and `.factory/bounded-page-parse/verification.md` modified by someone else. Nothing under `src/` was changed; nothing committed, pushed or stashed.
- `.data/` in the worktree (git-ignored; made by my job-level test and suite runs) is removed. Logs of the suite runs stay in the scratch directory; their summary lines are in `qa/evidence/r2/regression-runs.txt`.
