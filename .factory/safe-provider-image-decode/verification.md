# Verification

Environment: macOS (darwin arm64), Node 22.18, `@napi-rs/canvas` 0.1.100, vitest 3.2.7, throwaway Postgres 16 on `127.0.0.1:55473`, no provider keys. Nothing here ran on Linux, in the Railway container, or against a live image provider.

## Baseline
`main` `b3ad2d50` has the same files as pull request 57's tip `472bdfd8`. Its recorded full run (`.factory/safe-logo-decode/verification.md`, fresh database): 3,801 passed, 75 skipped, 1 failed, the known parity snapshot in `src/server/ai/openrouter.qa.test.ts`. A later run there also saw 3 lifecycle tests fail that pass alone.

Engineer, before any change, on the image, cover, logo and OpenRouter test files: 700 passed, 1 failed (the parity snapshot).

## Engineer (T1), on `0d2739c1` and then `e88c6f53`
- `src/server/services/images.safeDecode.test.ts`: 52 tests on `0d2739c1`, 58 on `e88c6f53`, all passing.
- The same files as the baseline plus the new one: 752 passed, 1 failed (the parity snapshot, same difference as on the base).
- `npm run typecheck` passes.
- Byte equality with the old in-process crop holds for PNG, JPEG and WebP (four crops each, plus a transparent PNG and an EXIF-rotated JPEG).
- Where the crashing files stop: `FF D8 FF D9` at the bytes check; a PNG with no IDAT, a PNG with a wrong IHDR checksum, a JPEG with no scan, a PNG with bit depth 3, a JPEG with a damaged Huffman table and two damaged WebP files reach the child and are refused as `crashed`.
- Deliberate breakages of `images.ts`, each restored afterwards: no bytes check (16 tests fail), no check of the child's answer (6), crop not centred (31), no pixel limit (4), in-process fallback when the child cannot run (2), the base's in-process `coverCrop` (the test worker dies). After the follow-up: limits of 10 minutes and 2 GB (2 fail), 21 s or 19 s (1), 16 MB (1), bytes of the picture in the options (1), a program built from the picture (1).

## Independent QA (T2), on `0d2739c1`
Verdict: ship, with noted limits. Report and probes: `qa/qa.md`, `qa/`, evidence in `qa/evidence/`.
- Its own corpus of 1,642 files: 683 end the base's process (681 `SIGSEGV`, 2 `SIGTRAP`); none ends this one. 1,340 crops reached a child, 317 children crashed, each one refused picture.
- 77 good files, 429 crops: all equal the base's bytes.
- 445 of 445 plain truncations refused with no child; the same for SVG, GIF, BMP, TIFF, AVIF, HEIC, ICO, HTML, animated WebP and 24 no-size or over-limit files.
- 108 files as the provider's answer through the not-strict, strict and shared-image paths: 104 refused as specified, 4 accepted with the base's crop.
- Five ways the decoder can be unavailable: a plain `Error`, the template on not-strict paths, no in-process decode, the next call works.
- The real actions and jobs against a database on both revisions (`callers.db.qa.test.ts`): with an HTML page as the provider's answer, every result a person sees is the same on base and head; on head a crashing PNG gives the same results as the HTML page.
- The trace table checked independently: no way found for bytes Radar did not render to reach `pixels` or `compressBytes`.
- One crop through the child: 181–215 ms, against 50–80 ms in-process. The child peaks at 91 MB for 1536×1024 and 182 MB for a picture on the pixel limit. Its arguments are `-e`, one constant program and `{w,h}`; its environment is `PATH` and `NODE_ENV`.
- 19 breakages on a scratch copy: 16 noticed by the engineer's tests. The three that were not are findings Q2 and Q3 in the brief; two are now covered by tests, the third (an unknown type refused by an accidental error instead of the check) has the same outcome for callers.
- Also run by QA against its own database: `spendRecords.db.test.ts`, `src/server/services/social`, `customImages.db.test.ts`, `bodyImages.db.test.ts`: 153 passed.

## PM
On `0d2739c1`, database `radar_a`, while QA's probes were running on the same machine: full suite 3,849 passed, 75 skipped, 5 failed: the parity snapshot, and 4 tests in `lifecycle/dispatch.test.ts` and `lifecycle/guides.test.ts`, which pass alone (29 of 29).

On `e88c6f53` (the delivered source), fresh database `radar_b`:
- `npm run typecheck`: passes.
- Full suite: 3,856 passed, 75 skipped, 4 failed: the parity snapshot (known on `main`), and 3 tests in `lifecycle/engagement.test.ts` and `visibility/digest.integration.test.ts`, which pass alone (55 of 55). Both are among the files known to fail in varying sets when the whole suite shares a database, and neither touches images. 58 more tests than the base, all in the new file.
- QA's `corpus` and `paths` probes rerun unedited against this revision: 18 passed. QA's database probe and its breakage script were not rerun after the follow-up, which changed one message text, one comment and tests.
- `git diff b3ad2d50 e88c6f53 --stat -- src`: `images.ts` and the new `images.safeDecode.test.ts` only. No existing test was edited.

## Not verified
- A live answer from OpenRouter, OpenAI or xAI.
- Linux and the Railway container. Covers already start the same child there.
- The built Next server (`next start`): whether the one-at-a-time queue is a single instance across its bundles.
- The drafting cover step and the article body images job end to end (they need the text model); QA read those paths.
