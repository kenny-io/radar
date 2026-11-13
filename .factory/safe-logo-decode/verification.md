# Verification

Environment: macOS (darwin arm64), Node 22.18, `@napi-rs/canvas` 0.1.100, throwaway Postgres 16 on `127.0.0.1:55461`, no provider keys.

## The problem, measured (PM, 2026-11-13, before any change)
Each file decoded with `loadImage` in its own Node process:

| File | Result |
| --- | --- |
| good PNG, JPEG, WebP | decoded |
| AVIF, ICO (PNG inside), GIF, BMP, SVG | decoded |
| `FF D8 FF D9` (4 bytes) | process killed, `SIGSEGV` |
| `FF D8 FF D9` padded to 200 bytes | `SIGSEGV` |
| PNG with IHDR and IEND, no IDAT (45 bytes) | `SIGSEGV` |
| the same with a tEXt chunk (125 bytes) | `SIGSEGV` |
| PNG with a wrong IHDR checksum | `SIGSEGV` |
| JPEG with tables and frame header, no scan | `SIGSEGV` |
| PNG cut in half | decoded without an error |
| HTML | threw "Unsupported image type" |

One decode in a fresh process takes about 145 ms.

The colour patterns in `brand.ts`, on hostile text:

| Input | Time |
| --- | --- |
| SVG pattern, 100 KB of `fill=rgb(` | 1.7 s |
| SVG pattern, 300 KB | 15 s |
| SVG pattern, 1 MB | 167 s |
| CSS pattern, 300 KB of `--a:rgb(` | 16 s |

## Baseline
`main` `8e3a4da3` (the base), fresh database, in a separate checkout: 3,674 passed, 75 skipped, 1 failed: the parity snapshot in `src/server/ai/openrouter.qa.test.ts` (known).

`24949528` (where the work started, before pull request 56 merged), fresh database: 3,672 passed, 75 skipped, 2 failed.
- `src/server/ai/openrouter.qa.test.ts`, the parity snapshot: known on `main`.
- `src/server/services/lifecycle/autopilotIntro.test.ts`, "does not reset a completed course or prior guide history": passes alone (17 of 17). One of the files known to fail in varying sets when the whole suite shares a database.

There were no tests for `brand.ts` before this work.

## Revision `e38d0068` (PM, 2026-11-14)
| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| Full suite, fresh database | 3,801 passed, 75 skipped, 1 failed: the known parity snapshot. 127 more tests than the base, all new (`brand.test.ts` 104, `untrustedImage.test.ts` 23). |
| `grep -n "napi-rs/canvas\|loadImage" src/server/services/analysis/brand.ts` | prints nothing |

Engineer, on the same source before it was replayed onto `main`: `src/server/services/analysis`, `src/server/services/realCover` and `untrustedImage.test.ts` 558 passed; the cover feature's QA probes (`.factory/real-subject-covers/qa/`) 494 passed with no file edited; `realCover.db.test.ts` 57 passed. Six deliberate breakages of `brand.ts` (no SVG text check, no animated check, no completeness check, decoder fault treated as refusal, header deciding the stored type, sample drawn unscaled) each made the matching tests fail.

## Independent QA (factory-qa, on `e38d0068`; full report in `qa.md`)
Verdict: ship. Own probes under `qa/` (566 passed), own malformed files (204), and the base checkout for comparison.
- The defect on the base: 60 of QA's 204 files end the decoder's process (59 `SIGSEGV`, 1 `SIGTRAP`), an ordinary TIFF among them. The base `detectBrand` ends its process on 8 of 8 crash cases, and the base onboarding job's process ends inside the brand step, leaving the job `queued` at phase `brand`.
- On `e38d0068`: 157 malformed files as the only candidate all resolve (slowest 165 ms) with CSS colour and language still read; 36 of the 80 that reached a child ended it with `SIGSEGV`.
- End to end, the real `analysis.site` job through the real queue and database in stub mode, with only the stub site's answers changed: three crashing candidates give job `done`, no logo, colours from the site's CSS; with no CSS colours, the defaults.
- 23 good PNG, JPEG and WebP files give the same logo and the same full colour list as the base.
- Colour patterns: 24 CSS and 14 SVG realistic examples identical to the base; hostile text at the crawler's caps takes 282 ms at most (base: 14 to 16 s for 300 KB, and over 40 s for 300 KB of dashes).
- Cover tests unedited: `src/server/services/realCover` 399 passed; `.factory/real-subject-covers/qa` 494 passed.
- Full suite: 3,798 passed, 75 skipped, 4 failed: the known parity snapshot, and 3 tests in `lifecycle/dispatch.test.ts` and `lifecycle/engagement.test.ts` that pass alone (14 of 14, 15 of 15).
- No interface code changed, so no browser run.

## After QA
One comment at the top of `brand.ts` was reworded (finding Q1); no behaviour changed. Rerun by the PM with that edit: `brand.test.ts`, `untrustedImage.test.ts` and `src/server/services/realCover` 526 passed; typecheck passes. The full suite and QA's probes were not rerun after the comment edit.

## Not verified
- Linux and the production platform: crash signals, the child's environment and the canvas build were checked on darwin arm64 only.
- That the deployed web and worker processes find the canvas library from the child's working directory. If they do not, logos are kept without logo colours and a warning is logged (D6).
- A real crawl over the network, real AI providers, S3 storage, the onboarding screen in a browser.
