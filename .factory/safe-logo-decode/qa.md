# QA: safe logo and brand-colour reading

Independent QA (T2). Revision under test: `e38d0068` on `kenny-dev/safe-logo-decode` (one commit on `main` `8e3a4da3`), worktree `.claude/worktrees/awesome-wescoff-efedda`, tree clean apart from this folder. Base: a checkout of `8e3a4da3` with its own `node_modules`. macOS darwin arm64, Node 22.18, `@napi-rs/canvas` 0.1.100 in both, throwaway Postgres 16 on `127.0.0.1:55461`, no provider keys, no network. Date: 2026-11-14.

## Verdict

**Ship.** AC1–AC11 pass on my own probes, the defect reproduces on the base and is gone on `e38d0068`, and I found no regression outside the behaviour changes D2–D4 intend. One thing must not be claimed in the pull request: that the home page cannot stall the worker. It still can (defect 1 below). That defect is on the base too, with the same timings, and is outside AC1–AC11; whether it blocks is the PM's call.

## Defects

### 1. The home page can still block the process for many seconds (medium; on the base too; outside the acceptance criteria)
- Against: the outcome stated for this work ("a website that controls its … home page must not be able to … stall the web or worker process") and the header comment of `brand.ts` ("nothing it sends may stop or stall this process"). Not against any of AC1–AC11.
- Reproduce: `node --import tsx .factory/safe-logo-decode/qa/structures-run.ts "$PWD" <work dir> <out.json> 20` (each step is `detectBrand` in its own process, global `fetch` replaced, 20 s limit).
- Expected: time roughly in proportion to the page size (the HTML parse of these pages takes about 0.1 s).
- Actual, `detectBrand` on `e38d0068`, all pages under the crawler's 2 MB cap:

  | Home page | Size | HTML parse alone | `detectBrand` |
  | --- | --- | --- | --- |
  | 100,000 `<style>` elements | 1.8 MB | 0.1 s | 21 s (5.4 s at 50,000; 1.3 s at 25,000) |
  | 60,000 `<img>` in a `<header>` | 1.5 MB | 0.1 s | 7.6 s |
  | 45,000 stylesheet links | 1.9 MB | 0.1 s | 4.3 s |
  | 40,000 apple-touch-icon links | 1.7 MB | 0.1 s | 3.4 s |
  | 35,000 icon links with sizes | 1.8 MB | 0.1 s | 2.7 s |
  | header SVG nested 64,000 deep | 448 KB | 0.1 s | 11.7 s |
  | 16,000 nested `<div>` then 16,000 `<img>` | 368 KB | 1.2 s | 10.3 s |
  | 16,000 nested `<div class>` then 16,000 `<svg>` | 416 KB | 1.2 s | 11.1 s |

  The time is synchronous, so every job in the process waits. Cause as far as I traced it: cheerio's `.map()` copies its result array on every element (used for the style, icon, apple icon, header image and stylesheet lists), and each selector walks a deep tree in time that grows with the square of the depth.
- Base: the same rows give the same times (`evidence/structures-base.json`). Not a regression.
- Related, outside `detectBrand`: the HTML parse itself (`cheerio.load`, which the crawler runs on every page before brand detection) takes 19 s for 64,000 nested `<div>` (320 KB) and grows with the square of the depth. Same on the base.
- Evidence: `evidence/structures-new.json`, `evidence/structures-base.json`.

### 2. An animated PNG is kept as a logo (low; on the base too)
- Against: D2 ("not animated"). AC4 names only the animated WebP.
- Reproduce: fixture `png-apng-two-frames` in `fixtures.ts`, served as the only candidate (`hostile.qa.test.ts`).
- Expected: skipped. Actual: stored as `image/png`; the probe has no check for animation in a PNG. The base stored it too.

### 3. Some SVG logos the base kept are now skipped (low; new; not listed in the brief)
- An SVG whose `<svg` tag comes after the first 8 KB (a 9 KB comment, or a doctype with a 9 KB internal subset), an SVG whose root is `<svg:svg>`, and an SVG in UTF-16. Each gives no logo and no logo colours now; the base stored each.
- Reproduce: `compare.qa.test.ts` scenarios "SVG logo: comment of 9 KB first", "… doctype with an internal subset of 9 KB first", "… prefixed element name (svg:svg)", "… UTF-16 text"; listed in `evidence/compare-diff.json`.
- Ordinary exports (XML declaration, doctype, BOM, a generator comment, upper-case `<SVG`) are kept as before.

### 4. A whole PNG with bytes after its end chunk is skipped (low; new; follows from the "complete" rule of D2, not listed)
- Reproduce: fixtures `png-trailing-bytes` (two bytes after `IEND`) and `polyglot-whole-png-then-html`. Base: stored. Now: no logo, no child.

## Behaviour differences from the base

From 108 scenarios run through both revisions' `detectBrand` with the same inputs (`evidence/compare-diff.json`: 69 the same, 39 different; one of the 39, a TIFF, cannot be run on the base because an ordinary TIFF ends its process).

Intended (D2–D4):
- GIF, ICO, BMP, AVIF candidates are skipped. Visible case: a site whose only large icon is `<link rel="icon" href="/favicon.ico" sizes="any">` had a logo and logo colours on the base and has neither now; with an apple-touch-icon PNG after it, the PNG is now the logo instead of the ICO. A GIF header logo with an inline header SVG beside it: the inline SVG is now the logo.
- An animated WebP is skipped.
- Cut-short PNG, JPEG and WebP files are skipped; the base stored them (it stored a PNG cut in half as the logo).
- The bytes decide the stored type and extension: PNG under `image/jpeg`, `image/webp`, `image/x-icon`, `image/gif` or a made-up `image/…` type is stored as `image/png` `.png` (the base stored `.jpg`, `.webp`, `.ico`, `.gif`, `.x-qa-unknown`); JPEG under `image/png`, `image/jpg`, `image/pjpeg` is stored as `image/jpeg` `.jpg`; WebP under `image/png` or `image/jpeg` as `.webp`.
- SVG text under a raster header is skipped (the base decoded it and stored SVG bytes as `.png` or `.jpg`). PNG, JPEG, GIF or HTML bytes under an SVG header are skipped (the base stored them as `.svg`).

Not listed in the brief:
- Defects 3 and 4 above.
- A logo over 2 MB: the crawler's fetch cuts every response at 2 MB, so the file arrives cut short and is now skipped; the base stored the cut file. The 3 MB check in `brand.ts` cannot be reached. An SVG over 2 MB is still stored cut short, as on the base.
- Header `image/SVG+XML` (capitals) is now read as SVG; the base decoded it and stored it as `.SVG+XML`.
- The base rejected (the job would fail) on an icon link whose `sizes` attribute has 450,000 entries and on a header SVG nested 4,000 or more deep. `e38d0068` resolves on both.
- Colour patterns, three differences, none in ordinary CSS or SVG (see the next section).

The same on both (recorded, not defects of this change):
- All 23 good PNG, JPEG and WebP files (RGBA, RGB, palette, 16-bit, interlaced, grey; baseline, progressive, CMYK, grey, 4:4:4, arithmetic; lossy, lossless, with alpha; 48×48, 400×48, 48×400, 512, 1200×630): same logo, and the full colour list equals what the base's own `logoColors` gives for the file.
- EXIF rotation at the limit: 48×100 rotated a quarter turn is kept, 47×100 is not.
- Damaged files that decode without an error are stored as the logo: 42 of my 157 malformed files, for example a PNG whose picture data is noise or empty, a WebP header followed by noise, a PNG declaring 10000×2500 over data for 256×128. Logos have no blank check (covers do).
- A valid PNG, JPEG or WebP that contains the four bytes `<svg` anywhere (a text chunk, a comment segment, bytes after the end) is refused: the decoder takes it for SVG and fails. It is never rendered as SVG (`evidence/svg-sniff.json`, 13 cases).
- Only the first six candidates are tried.

## The colour patterns (D8, AC7)

Each revision's own code was used (cut from its `brand.ts` and evaluated, `internals.ts`), not a copy.
- 24 realistic CSS examples (plain and minified `:root` blocks, comments, `rgb()`/`rgba()` with commas, spaces and slash alpha, upper-case hex and functions, 3/4/5/7/8-digit hex, tabs and new lines around the colon, Bootstrap-, WordPress-, Shopify- and Tailwind-like sheets, names with `text`/`bg`/`border`, `var()` fallbacks, dark-mode overrides, BEM selectors, three- and four-dash names, non-ASCII names, unclosed `rgb(`) and 14 SVG examples (attributes with either quote or none, style attributes, style elements, gradients, `rgb` forms, Illustrator and Inkscape exports): identical output, 24 of 24 and 14 of 14.
- 4,000 generated CSS strings (2,220 with colours) and 4,000 generated SVG strings (2,745 with colours). Every difference falls in one of these:
  1. **Lost:** a name glued to a preceding name character or dash is no longer read: `x--primary:#0f766e`, `-webkit--primary:#123456`, `.a--main:#123456{}`. None of these is a custom property. 1,035 of the generated CSS strings.
  2. **Lost:** past the bounds: a name over 128 characters, over 64 whitespace characters before or after the colon (or after `fill=`), an `rgb(…)` holding over 100 characters. Exactly at 128, 64 and 100 the result is unchanged.
  3. **Gained:** after an `rgb(` whose closing bracket is more than 100 characters away, the base read everything up to that bracket as one value and so hid the declarations in between; the new pattern reads them. 16 of the generated SVG strings.
- Hostile text, through `detectBrand`: 14 SVG units at 2 MB and at 3 MB (largest: 3 MB of `fill=rgb(`, 93 ms; 150,000 different colours, 130 ms); 15 CSS units as three 2 MB stylesheets plus 1.9 MB inline (largest 282 ms, of which the HTML parse is 94 ms). Nothing over 2 seconds. On the base: 300 KB of `fill=rgb(` 14.1 s, 300 KB of `--a:rgb(` 15.9 s in a stylesheet and 15.9 s inline, 300 KB of dashes not finished after 40 s.

## Acceptance coverage

| | Result | How |
| --- | --- | --- |
| Defect on the base | reproduced | `base-loadimage.mjs`: 60 of my 204 files end the base decoder's process (59 `SIGSEGV`, 1 `SIGTRAP`), among them an ordinary TIFF. `run-base-repro.mjs`: base `detectBrand` ends its process with `SIGSEGV` on 7 files and `SIGTRAP` on 1. `e2e.db.base.test.ts`: the base onboarding job's process ends inside the brand step and the job row is left unfinished. |
| AC1 | pass | Source check, and at run time: after a full `detectBrand` with a good PNG the canvas library's native code is not in the process on `e38d0068` and is on the base (`evidence/ac1-canvas-in-process.txt`). Nothing else on the server decodes a stored logo. |
| AC2 | pass | 157 malformed or mislabelled files, each the only candidate: all resolve, CSS colour and language still read, slowest 165 ms, longest gap between two 20 ms ticks of the test process 25 ms, a good logo read afterwards. 80 reached a child: 36 ended it with `SIGSEGV`, 44 exited normally. |
| AC3 | pass | The same 157 files as the first of two candidates: the good second one becomes the logo and gives the colours unless the first was itself kept; never two children at once. |
| AC4 | pass | 77 files refused from the bytes with no child: other formats under their own and under a raster header, SVG and HTML under raster headers, cut-short files, animated WebP, declared sizes over the limits, shorter side under 48, zero sizes. |
| AC5 | pass | See "the same on both" above; 23 files, full colour lists equal. |
| AC6 | pass | SVG under an SVG header stored unchanged as `.svg` with its declared colours, no child; inline header SVG the same; SVG under raster headers and other bytes under an SVG header skipped, no child. |
| AC7 | pass | See the colour patterns section. |
| AC8 | pass | Spawn throws, program missing, canvas library not found: logo kept under the type its bytes say, no logo colours, one warning, next call normal; page colours still read. |
| AC9 | pass | Child sees `PATH`, `NODE_ENV` (plus `__CF_USER_TEXT_ENCODING`, added by macOS) and nothing planted in the parent; with `NODE_ENV` unset it has none. Arguments are identical for two different logos and hold no marker planted in either. Three kinds of stuck child are killed at the limit and gone from `ps`; through `detectBrand` a stuck decode costs 10.2 s, the process keeps ticking, the next candidate is used. Output over the limit is refused, also from a child that writes for ever. Three covers and five logos asked together: one child at a time, in order, a `SIGSEGV` in the middle holds nothing up. |
| AC10 | pass | `npx vitest run src/server/services/realCover`: 4 files, 399 passed. `DATABASE_URL=… npx vitest run --config .factory/real-subject-covers/qa/vitest.config.ts`: 6 files, 494 passed; evidence files restored. The commit edits neither. |
| AC11 | pass | `npm run typecheck`: exit 0 (also with the QA files present). Full suite, fresh database: 3,798 passed, 75 skipped, 4 failed in 3 files. `openrouter.qa.test.ts` parity snapshot fails the same way on the base (1 failed, 73 passed, rerun there). `lifecycle/dispatch.test.ts` (2) and `lifecycle/engagement.test.ts` (1) pass alone, 14 of 14 and 15 of 15. No failure the base does not have. |
| End to end | pass | `e2e.db.qa.test.ts`: the real `analysis.site` job through the real queue and a real database, stub site and stub AI. All three logo candidates crash the decoder: job `done`, no logo, "Logo not found — you can upload one", colours from the site CSS. Same with no CSS colours: default colours `#17181C` and `#EF6A2E`. First candidate crashes, second is a PNG under a JPEG header: stored as `image/png`. 2 MB hostile SVG and stylesheet: done in the same time as the control. Animated WebP, GIF, ICO: done, no logo. |
| Engineer's tests | pass | `brand.test.ts` and `untrustedImage.test.ts`: 127 passed. |
| Browser | not applicable | The commit changes no interface code. |

## Accepted limits and observations

- One decode at the pixel limit peaks at 180 MB in the child, and 322 MB for a 4 KB progressive JPEG that declares 10000×2500 (`evidence/child-peak-memory.txt`). The brief says about 100 MB. A logo does not need the 25-megapixel limit covers have.
- "One at a time" holds inside a process. The web process and the worker each have their own queue.
- D6: while the decoder cannot run, a file that would crash it is stored as the logo unseen.
- Up to six candidates at ten seconds each can wait on the decode queue; I found no file that makes the decoder hang (slowest decode 164 ms).
- Stored SVG is kept as sent, scripts included (out of scope here).

## Not verified

- Linux, where production runs: crash signals, the child's environment and the canvas build were checked on darwin arm64 only.
- The deployed web and worker processes finding the canvas library from the child (reasoned from `package.json` and the Railway files, not run).
- A real crawl over the network, real AI providers, S3 storage.
- A file that makes the decoder hang rather than crash: the time limit was tested with a stand-in child.
- The onboarding screen in a browser.

## Commands

From the worktree root; `BASE` is the base checkout, `DB` a fresh migrated database (`createdb … && DATABASE_URL=… npm run db:migrate`). My databases (`radar_qa_safelogo_*`) are dropped.

| Command | Result |
| --- | --- |
| `bash .factory/safe-logo-decode/qa/gen-good.sh` | 33 good files in `qa/fx/good` (ImageMagick, cwebp, img2webp, jpegtran; the AVIF with the canvas encoder) |
| `node --import tsx .factory/safe-logo-decode/qa/dump-fixtures.ts <dir>` then `node .factory/safe-logo-decode/qa/base-loadimage.mjs <dir> $BASE <out>` | 204 files: 60 end the process, 132 decoded, 12 threw |
| `node .factory/safe-logo-decode/qa/run-base-repro.mjs $BASE <dir> <work> <out> 40` | base: 8 crashes, stalls of 14–16 s and over 40 s |
| the same with `"$PWD"` in place of `$BASE` | `e38d0068`: 15 of 15 resolve, slowest 169 ms |
| `QA_BASE_CHECKOUT=$BASE DATABASE_URL=$DB npx vitest run --config .factory/safe-logo-decode/qa/vitest.config.ts` | 6 files, 566 passed, 0 failed |
| `QA_BASE_CHECKOUT=$BASE npx vitest run --config .factory/safe-logo-decode/qa/vitest.base.config.ts compare` then `node .factory/safe-logo-decode/qa/compare-report.mjs` | 108 passed; 69 the same, 39 different |
| `QA_BASE_CHECKOUT=$BASE DATABASE_URL=$DB npx vitest run --config .factory/safe-logo-decode/qa/vitest.base.config.ts e2e` | the test process ends inside the job (expected on the base) |
| `node --import tsx .factory/safe-logo-decode/qa/structures-run.ts "$PWD" <work> <out> 20` (and with `$BASE`) | defect 1 |
| `node --import tsx .factory/safe-logo-decode/qa/svg-sniff.ts` | 13 cases, none rendered as SVG |
| `npx vitest run src/server/services/realCover` | 399 passed |
| `DATABASE_URL=$DB npx vitest run --config .factory/real-subject-covers/qa/vitest.config.ts` | 494 passed |
| `npx vitest run src/server/services/analysis/brand.test.ts src/server/services/untrustedImage.test.ts` | 127 passed |
| `npm run typecheck` | exit 0 |
| `DATABASE_URL=$DB npx vitest run` | 3,798 passed, 75 skipped, 4 failed (base-class, see AC11) |

Evidence is in `.factory/safe-logo-decode/qa/evidence/`. Nothing outside `.factory/safe-logo-decode/` was changed, nothing committed.
