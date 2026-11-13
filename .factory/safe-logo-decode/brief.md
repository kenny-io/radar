# Safe logo and brand-colour reading

## Problem
During onboarding, `detectBrand` in `src/server/services/analysis/brand.ts` fetches up to six logo candidates from the site being analysed and hands their bytes to `loadImage` from `@napi-rs/canvas` inside the worker process (once to check the size, once to read colours). The site controls those bytes. With `@napi-rs/canvas` 0.1.100:

- some malformed files end the whole process with a segmentation fault instead of an error (checked 2026-11-13 on darwin arm64, each in its own process: `FF D8 FF D9`, the same padded to 200 bytes, a PNG with IHDR and IEND and no IDAT, the same with a tEXt chunk, a PNG with a wrong IHDR checksum, a JPEG with no scan: all `SIGSEGV`);
- a PNG cut in half decodes without an error;
- it also decodes SVG, GIF, ICO, BMP and AVIF.

Found on the way: the two colour patterns in `brand.ts` take quadratic time on text the site controls. 300 KB of `fill=rgb(` in an SVG logo blocks the process for 15 s, 1 MB for 167 s, and a logo may be 3 MB. 300 KB of `--a:rgb(` in a stylesheet takes 16 s. A blocked event loop stops every job in the process, so this is the same problem as the crash and is fixed here.

## Scope
`brand.ts`, one shared decode module, `realCover/picture.ts` changed only to use that module, tests, and these records. Started on pull request 56's branch at `24949528`; that pull request merged during the work, so the base is `main` `8e3a4da3`. No new dependency, no schema change, no UI.

Not in scope: other in-process `loadImage` calls (`services/images.ts`, `services/social/publish/media.ts`), how stored SVG files are served (`/api/files`), sanitising SVG.

## Decisions
- D1. One shared module, `src/server/services/untrustedImage.ts`, holds what both features need: `probeImage`, the pixel limits, and the child-process runner (start, time limit, output limit, answer format, one at a time). `picture.ts` keeps what a cover is (the draw, the blank check, its error codes) and `brand.ts` keeps what a logo is. Reason: the runner is the delicate part, and one queue means a cover and a logo are never decoded at the same moment (each can hold about 100 MB of pixels).
- D2. A raster logo is accepted only when its bytes are a complete PNG, JPEG or WebP, not animated, within the shared pixel limits, and at least 48 px on its shorter side. All of that is read from the bytes before any decode. The bytes decide the stored type and file extension; the response header only has to say `image/…`.
- D3. GIF, ICO, BMP and AVIF logo candidates are skipped and the next candidate is tried. This changes behaviour: the decoder accepted all four before. They are uncommon among the candidates Radar looks at (icons of 96 px or more, apple-touch-icon, header images, the share image), and the owner can upload a logo.
- D4. SVG is never decoded or drawn on the server, in any process. A candidate is an SVG logo when the header says SVG and the bytes are SVG text (`<svg` near the start). It is stored as it is, and its colours come from a scan of its text for declared fills and strokes, as before. SVG bytes under a PNG, JPEG or WebP header are skipped; so is an SVG header over other bytes. The inline header SVG fallback is unchanged.
- D5. One child process decodes an accepted raster candidate and answers with its decoded size and a 48×48 sample of its pixels; the worker computes the colours from the sample with the existing rule. The child gets `PATH` and `NODE_ENV` only, 10 seconds, and no bytes from the picture in its arguments. A crash, a timeout or a refusal skips that candidate.
- D6. When the decoder itself cannot run (the child cannot start, or the canvas library does not load in it), the candidate is kept as the logo, because the bytes already passed D2, with no logo colours, and one warning is logged. Onboarding must not lose every logo to an environment fault.
- D7. `detectBrand` never rejects because of what a logo or stylesheet contains.
- D8. The colour patterns get bounded repeats so they take linear time; what they match on ordinary CSS and SVG does not change.

## Decisions after implementation (2026-11-14, PM, from the engineer's report)
- D9. The CSS pattern reads a custom property name only from where it starts (`--` not preceded by a name character), as well as having bounded repeats. Bounds alone still took 1.4 s on 2 MB of `-`. What no longer matches: `--` in the middle of an identifier (`a--b:#fff`, not a custom property), names over 128 characters, more than 64 whitespace characters around the colon, more than 100 characters inside `rgb(…)`.
- D10. Two more ways the home page could make `detectBrand` reject are closed (D7): an icon link with about 300,000 `sizes` tokens, and a header SVG nested too deep to be written out. Both were reproduced first.
- D11. SVG text means: after an optional byte order mark and whitespace the file starts with `<`, and `<svg` followed by whitespace, `>` or `/` appears in the first 8 KB. A UTF-16 SVG is skipped. An accepted SVG is stored as `image/svg+xml` whatever the header's exact wording.
- D12. The answer from the child is an envelope, `{ head }` from the caller's work or `{ fault }` from the runner, so a work's answer cannot be taken for a runner fault.
- Accepted limit: a site whose six candidates each make the decoder run out of time holds the decode queue for up to 60 seconds. No file that does this is known; a crash takes about 140 ms.

## Decisions after QA (2026-11-14, PM; `qa.md`, verdict: ship)
QA found no defect against AC1–AC11. Four findings, none fixed in this change:
- Q1 (medium, on the base too, outside the criteria). A home page with tens of thousands of elements, or nested thousands deep, still blocks the process for seconds inside cheerio: up to 21 s for a 1.8 MB page through `detectBrand`, and 19 s in `cheerio.load` alone for 64,000 nested `<div>` (320 KB), which the crawler runs on every page. This is the crawler's problem as much as brand detection's and needs its own change. The comment at the top of `brand.ts` now says so, and the pull request does not claim otherwise.
- Q2 (low, on the base too). An animated PNG is kept as a logo; the check from the bytes knows animated WebP only. Accepted: it is stored, not a safety problem. D2's "not animated" means WebP.
- Q3 (low, new). SVG logos that are skipped now and were kept before: `<svg` later than the first 8 KB, a root written `<svg:svg>`, UTF-16 text. Accepted as the cost of D11.
- Q4 (low, new). A whole PNG with bytes after its end chunk is skipped, because "complete" for a PNG means it ends with its end chunk. Covers have the same rule. Accepted.

Other differences QA recorded and the PM accepts: a logo over 2 MB is skipped (the crawler cuts every response at 2 MB, so it arrives cut short; the 3 MB check in `brand.ts` cannot be reached); a header written `image/SVG+XML` is read as SVG.

Open for the owner: logos use the same 25-megapixel limit as covers. QA measured the decoding child at about 180 MB for a picture at the limit and 322 MB for one small progressive JPEG declaring 10000×2500. A lower limit for logos would cost the rare very large logo.

## Acceptance criteria
- AC1. `brand.ts` does not import `@napi-rs/canvas` and nothing in the web or worker process decodes fetched logo bytes.
- AC2. Each crashing file above (padded to pass the 80-byte floor where needed), served as the only logo candidate: `detectBrand` resolves with `logo: null`, colours still come from the page's CSS, language is still read, and the test process goes on to detect a good logo afterwards.
- AC3. A crashing or refused first candidate does not stop the second: the second becomes the logo and gives the colours.
- AC4. No child process starts for: SVG, GIF, ICO, BMP, AVIF or HTML bytes under a raster header; a cut-short PNG, JPEG or WebP; an animated WebP; a declared size over the limits; a shorter side under 48 px. Each is skipped.
- AC5. A good PNG, JPEG or WebP logo is stored with the type and extension its bytes say, and its colours equal what the old in-process histogram gives for the same file.
- AC6. An SVG logo (header and bytes agree) is stored as SVG with colours from its declared fills, and no child process starts. An SVG header over non-SVG bytes is skipped.
- AC7. A 3 MB SVG of `fill=rgb(` and 300 KB stylesheets of `--a:rgb(` and of `-` finish in under 2 seconds through `detectBrand`; hex, `rgb()` and `rgba()` values in ordinary CSS and SVG give the same colours as before.
- AC8. Decoder unavailable (spawn throws; canvas library not found): `detectBrand` resolves, keeps the logo, has no logo colours, logs one warning; the next call works.
- AC9. The child's environment is exactly `PATH` and `NODE_ENV`; its arguments hold nothing from the picture; a child that does not answer in time is stopped and counts as refused; a logo and a cover requested together are decoded one after the other.
- AC10. `src/server/services/realCover/*.test.ts` and `.factory/real-subject-covers/qa/*` pass without being edited.
- AC11. `npm run typecheck` passes. The full suite has no failure that the base does not have.

## Delivery
Pull request to `main`. No merge, no deploy: `main` deploys to Railway on merge.
