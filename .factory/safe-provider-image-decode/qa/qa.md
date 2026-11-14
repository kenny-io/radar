# Independent QA: safe decoding of image providers' pictures (T2)

Revision under test: `0d2739c1` on `kenny-dev/frosty-snyder-ec6225`, one commit on `main` `b3ad2d50`. Tree clean at the start; the only files added by QA are under this folder.
Environment: macOS (darwin arm64, Darwin 25.5.0), Node 22.18.0, `@napi-rs/canvas` 0.1.100, vitest 3.2.7. A throwaway Postgres 16 of QA's own on `127.0.0.1:55477` for the database probe (stopped afterwards). No provider keys, no Linux container. No interface code changed, so no browser run.

## Verdict: ship, with noted limits

Every acceptance criterion passes on what was observed. No defect was found in the change. The limits are: the behaviour change D3 is wider than the brief's list (below, "Good files now refused") and was not checked against a live provider; three properties of the change are not pinned by the engineer's tests; the result was measured on macOS only.

## Acceptance criteria

| | Result | How |
| --- | --- | --- |
| AC1 | pass | `grep -n loadImage src/server/services/images.ts` prints nothing. Every `loadImage` under `src/`, `scripts/`, `sandbox/` outside tests: `untrustedImage.ts` (the child's program), `social/publish/media.ts` (2), `scripts/generate-email-brand.ts`. At run time: 0 calls to `loadImage` inside the calling process over the whole corpus and all caller paths (counted by wrapping the library). |
| AC2 | pass | 77 good files, 429 crops, every one byte-identical to the base's in-process `coverCrop`. `corpus.qa.test.ts`: `5 passed`. |
| AC3 | pass | 108 files as the provider's answer, the brief's four among them, 89 of which end the base's process: for the 104 that are refused, the cover gets the template with `placeholder: 'failed'`, a strict request rejects with a plain `Error` and stores nothing, a pack's shared image gets the template with no mark; a good image afterwards is the base's bytes. `paths.qa.test.ts`: `13 passed`. Through the real actions and jobs with a database: `callers.db.qa.test.ts`, `4 passed`. |
| AC4 | pass | 445 of 445 plain truncations (PNG, JPEG, progressive JPEG, lossy and lossless WebP, at up to 89 lengths each) refused with no child; also SVG, GIF, BMP, TIFF, AVIF, HEIC, ICO, JPEG XL, JPEG 2000, HTML, JSON, PDF, animated WebP, 24 files declaring no size or a size over the limits. |
| AC5 | pass | 1,340 crops reached a child; 317 children crashed; each was one refused picture. 683 of the 1,642 corpus files end the base's process; none of them ends this one and none gives a picture. |
| AC6 | pass | Five ways the decoder cannot run (spawn throws `EAGAIN`, `ENOMEM`, a non-Error; the Node binary is missing so the child reports `ENOENT` after spawn returns; the child starts where the canvas library cannot be found): a plain `Error` "The picture decoder could not run: …", template on the not-strict paths, a rejection on the strict one, 0 in-process decodes, and the next call returns the base's bytes. |
| AC7 | pass | The command in the task: `Test Files 1 failed | 12 passed (13)`, `Tests 1 failed | 752 passed (753)`. The one failure is the parity snapshot in `openrouter.qa.test.ts`; it fails the same way on a copy of `b3ad2d50` (`f883614e6a7dfb07` expected, `91d5409f50974af7` received). With QA's database: `spendRecords.db.test.ts`, `src/server/services/social`, `customImages.db.test.ts`, `bodyImages.db.test.ts`: `11 files, 153 passed`. `git diff b3ad2d50 0d2739c1 --name-status`: two `.factory` files added, `images.safeDecode.test.ts` added, `images.ts` modified; no existing test touched. |
| AC8 | pass (typecheck); full suite not run by QA | `npm run typecheck` exits 0. The full suite is the PM's run. |

## 1. Where the bytes come from

No path was found that hands `pixels` or `compressBytes` anything Radar did not render. The brief's table holds.

- Writers of a pack post's `imageUrl`: `createPack` (`social/generate.ts:132`), `changeImage` (`actions/social.ts:51`), `ensureImages` (`social/publish/pubs.ts:87`), `social.compress` (`actions/socialPublish.ts:245`). Each stores the URL returned by `renderImageFile` or `compressIfNeeded`. `setPost` (`actions/social.ts:30`) is only called with `{ text }`, `{ copiedAt }`, `{ text, v }`. `social_packs` is inserted and updated only in `generate.ts:146,163`.
- Writers of a Daily Brief item's `img.urls`: the `brief.visuals` action (`actions/brief.ts:146-147`: empty, nulls, or the previous set kept), the `brief.visuals` job (`brief/visuals.ts:44,46`: URLs from `renderImageFile`), `social.compress` (`socialPublish.ts:252-254`). Items are built field by field in `brief/draft.ts:214` and the scan; the text model's output cannot add an `img`.
- No zod input of any social or brief action carries a URL or image bytes for a post. `GET /api/b/[bid]/media` only reads. Dev-only `social.devSimulate` touches tokens.
- `readObjectBytes` (`storage.ts:30`) does fetch any http(s) URL, but it is only reached with those two fields.
- Other decoders: none. `next/image` optimisation is off (`images: { unoptimized: true }`), `sharp` is installed by Next and imported nowhere, there is no `ImageResponse`.

Three things to know, none of them a path:
1. Radar's bucket also holds bytes Radar did not render: the owner's uploaded logo (`actions/profile.ts:39`) and logos copied from analysed sites (`analysis/brand.ts:130,137`), under `<bid>/logo/`. Nothing points a post at them. "Only Radar writes to its bucket" is true; "everything in the bucket is Radar's canvas output" is not.
2. `pixels` and `compressBytes` have no check at all, so they rely on storage returning the file whole. Radar's own PNG cut to 4–68 bytes, or its JPEG cut before the scan (3–840 bytes in the corpus), ends a process that decodes it (`evidence/old.json`, files `cut-png-*`, `cut-jpg-*`). A storage fault that returns a header-only file with status 200 would end the worker at send time. Unlikely; exists on the base.
3. A fourth caller of the strict path that the brief's table does not list: `ensureImages` at send time (`pubs.ts:86`) renders a pack post that has no file yet, strict when the post has its own image prompt. A refused picture there fails the send as `media` with the user copy for that code; the reason goes to `errDetail` only. Same as a decode error before.

## 2. Good pictures (AC2)

`evidence/compare.txt`. 77 files: canvas PNG, JPEG and WebP at 12 sizes (1536×1024, 1024×1536, 1024×1024, 1792×1024, 1344×768, 2048×2048, 301×199, 64×48, 3×2, 1×1, 4000×250, 250×4000); transparent PNG and WebP; JPEG quality 30 and 100, progressive, optimised, restart markers, greyscale, 4:4:4, CMYK, arithmetic coding, EXIF orientation 1 to 8; PNG 16-bit with and without alpha, palette with and without tRNS, greyscale, 1-bit, grey with alpha, Adam7, with gAMA/tEXt, many small IDATs, a 200 KB `caBX` chunk; WebP lossless with and without alpha, lossy with alpha, with metadata, with an unknown trailing chunk; JPEG with four 65 KB APP11 segments, with a comment and fill bytes, with a second JPEG after it. Sizes asked: 1200×628, 1200×675, 1200×900 for all; also 400×900, 628×1200, 1×1, 37×1200, 3000×2000, 1200×1 for 33 of them. 429 crops, 429 identical to the base.

## 3. Malformed files (AC3 to AC5)

Corpus: 1,642 files made by `make-corpus.mjs` (good 77, unusual 34, limits 48, malformed 1,483). On the base, each in its own process (`old-decode.mjs`): 683 end the process (681 `SIGSEGV`, 2 `SIGTRAP`).

On `0d2739c1` (`corpus.qa.test.ts`, 2,062 crop requests): the process survives; 722 refused before any child, 1,340 reached a child, 317 children crashed; 1,016 crops returned, all byte-identical to the base's crop of the same file; no file the base died on gives a picture; at most one child at a time; one constant child program.

| Malformed group | Base | Now |
| --- | --- | --- |
| 445 plain truncations | 196 end the process, 215 give a partial picture, 34 throw | all refused, no child |
| 385 cut and given their end marker back | 270 end the process, 115 give a partial picture | 121 refused by the bytes, 149 crash the child and are refused, 115 give the same partial picture as the base |
| 410 flipped or overwritten bytes | 54 end the process, 356 give a picture | 19 refused by the bytes, 39 crash the child, 352 give the base's bytes |
| 204 PNG, JPEG, WebP structure files (wrong checksums, zero-length chunks and segments, impossible headers, 4 GB chunk lengths, a 64 MB zlib bomb, two IHDRs, two frame headers) | 119 end the process, 85 give a picture | 9 refused by the bytes, 115 crash the child, 80 give the base's bytes |
| Declared sizes (0, over the limits, 2³¹, a WebP canvas that disagrees with the picture inside) | 29 of 48 end the process | 24 refused with no child; the mismatched WebPs crash the child in 140 ms at 81 MB |
| Polyglots (SVG or HTML after a PNG, JPEG or WebP header; after a whole file; inside metadata) | throw, end the process, or give the picture | none is rendered as SVG: 7 are rejected by the decoder in the child, 1 crashes it, 2 give the real picture they contain |

Caller paths (`paths.qa.test.ts`): 108 files (the brief's six, every ninth file the base died on, 31 named others) as the provider's answer. 104: template marked `failed` | strict rejects, nothing stored | shared image template, no mark. 4 that the decoder accepts (an APNG, a JPEG with an HTML page after its scan header, two PNGs with odd IDAT data): the base's crop on all three. `createPack` with 12 refused files and five platforms: every post its own template, one provider call. 60 crops asked for together (good, refused, crashing): all settle, one child at a time. A child that never answers is stopped at 20.0 s and the crop queued behind it then returns the right bytes.

## 4. What a person sees on the strict paths

`callers.db.qa.test.ts` runs the real actions and jobs against a database on both revisions. With an HTML page as the provider's answer (on the base: `loadImage` throws "Unsupported image type") the results are identical on base and head, and on head a crashing PNG gives the same results as the HTML page:

| Caller | Result (base with HTML = head with HTML = head with a crashing file) |
| --- | --- |
| `social.regenImage` with a prompt | 502 `image_failed`, "Radar couldn’t generate this image. Your previous image is kept. Try again."; the post is unchanged |
| `social.style` (not strict) | resolves; the template is stored |
| `brief.visuals` with a prompt (job) | 502 `image_failed`, "Radar couldn’t generate these images. Your previous images are kept. Try again."; item `failed`, previous images kept |
| `brief.visuals` without a prompt (job) | `made: 2`, two templates, status `ready` |
| `article.regenerateImage`, typed prompt, and model style with no new prompt | 502 `image_failed`, "…Your previous cover is kept. Try again."; cover unchanged |
| `article.save` with a new model style | saved; template with `placeholder: failed` |
| `article.save`, cover requires the model | 502 `image_failed`; cover and style unchanged |
| `generateArticleBodyImages` | rejects with a plain `Error`; the queue turns any non-`RadarError` into "Radar couldn’t finish this. Try again." (`jobs/queue.ts:109`) |

The only differences are internal: the message text (`Unsupported image type` → `The image model's picture was refused: …`) and the base error's `code: 'InvalidArg'`, which no caller reads. Read, not run: `drafting/draft.ts:222-228` (keeps an existing cover, rethrows for a required model, otherwise no cover) and `publishing/publisher.ts:51` only test `instanceof RadarError` or nothing, so they behave as for a decode error before.

## 5. Good files now refused (D3)

Decoded by the base, refused now (`evidence/compare.txt`, 250 files, 215 of them plain truncations whose partial picture the base stored):

| File | Now | From OpenAI, xAI, OpenRouter? |
| --- | --- | --- |
| A whole PNG with any byte after IEND (one newline is enough) | "cut short" | Not expected: the bytes are a base64 field, so nothing is appended in transit. Not in the brief. |
| A whole JPEG with more than 4,094 bytes after its end marker, or with no end marker | "cut short" | Not expected. A second picture appended after the first (multi-picture, gain map) ends in its own end marker and is accepted. |
| A WebP whose RIFF size is larger than the file, even by 2 | "cut short" | Not expected. |
| GIF, AVIF, BMP, ICO, JPEG XL | "not a PNG, JPEG or WebP" | OpenRouter documents `png`, `jpeg`, `webp`, `svg`, `gif` and says the provider's default applies when `output_format` is omitted (Radar omits it); `gif` is for animation-capable models, `svg` for vector models. OpenAI documents PNG as the default with JPEG and WebP on request. xAI's own pages do not name the format; third-party pages say JPEG. |
| SVG, a `data:` URL as the bytes | refused | The base rendered both. Intended. |
| Animated WebP | "animated" | Not expected. |
| A real picture over 25 million pixels or 10,000 on a side | "larger than the decoder is given" | Providers answer at about 1 to 4 million pixels. |

Still accepted, as on the base: APNG (first frame), JPEG with up to 4,094 trailing bytes, WebP with bytes after the RIFF chunk, PNG with large metadata chunks.
Improved: TIFF (two ordinary ones), HEIC and JPEG 2000 ended the base's process; now refused.

Sources (read 2026-11-14, no API called): OpenRouter image generation guide `https://openrouter.ai/docs/features/multimodal/image-generation`; OpenAI image generation guide `https://developers.openai.com/api/docs/guides/image-generation`; xAI `https://docs.x.ai/docs/guides/image-generation` (does not state a format). None says whether bytes can follow the end of a PNG.

What happens if a provider does answer in a refused form: every not-strict image becomes the template (covers marked `failed`), every strict request fails, and the provider's call is still recorded as paid (D6). The reason is in the failure report's message ("The image model's picture was refused: …", `degraded: true` on the not-strict path), so it would show there and nowhere else. One live answer per provider would settle it; QA had no keys.

## 6. Cost and limits

- Time: 181–215 ms per crop through the child (30 runs each, `evidence/paths.json`), against 50–80 ms in a warm process on the base (`evidence/cost.txt`): about 135 ms more. A file refused by its bytes: 0.004 ms. A crashing file: 136 ms.
- Memory: the child peaks at 91 MB for 1536×1024, 102 MB for 2048×2048, 182 MB for a picture on the pixel limit (real, or a 1.8 KB file that declares it). On the base that memory was the web or worker process's own.
- Queue: one child at a time per process. Two processes cropping together run two children at once (`two-processes.mjs`: at most 1 per process, 2 overall); worst case about 2 × 182 MB. The time limit starts when the child starts, so a crop waits for everything ahead of it: behind a stuck child, 20 s (measured 20.2 s).
- A child killed from outside (as when memory runs out) is reported as "the decoder could not read it (crashed)", the picture's fault.
- The child's arguments are `-e`, one constant 1,155-character program, and `{"w":…,"h":…}`. Its environment is `PATH` and `NODE_ENV`. A marker placed in the picture, in two environment variables and the provider key appear in none of them. The picture goes in on stdin only; stderr is discarded.
- Not capped: the size of the provider's answer before it is piped to the child. The calling process has already buffered it, as on the base.

## 7. The engineer's tests

`images.safeDecode.test.ts`, 52 tests, pass. 19 deliberate breakages on a scratch copy (`mutations.py`, `evidence/mutations.json`): 16 noticed. Decoding in-process again (M01, M09) ends the test run, as the file's header says it would.

Not noticed:
- M16: the crop's limits changed to 10 minutes and 2 GB. Nothing pins D4's 20 s and 32 MB.
- M17: bytes of the provider's picture added to the child's arguments. Nothing checks what the child is given.
- M13: an unknown type refused by a `TypeError` from the next line instead of by the check. Same outcome for callers; the tests accept any `Error` there.

QA's `paths.qa.test.ts`, run on the same scratch copy, fails on all three (M13: 2 tests, M16: 3, M17: 1).

## Findings

No defect that should stop the release. In order of weight:

1. (Limit, new) D3 refuses more than the brief lists: a whole PNG followed by any byte, a JPEG with more than 4,094 trailing bytes or no end marker, a WebP whose RIFF size overstates the file. PNG is stricter than JPEG here. Reproduce: `coverCrop(Buffer.concat([goodPng, Buffer.from('\n')]), 1200, 628)` rejects with "the file is cut short"; the base returns the crop. Through the app: section 4's probe with `QA_ANSWERS=trailing`. Expected by the brief: refusal of a cut-short file. Actual: also refusal of a whole file with a trailer. Likelihood from the three providers: low, unverified. Severity if it happened: every model image for that provider becomes a template or a failed request while still being paid for.
2. (Minor, new) The reason says "the file is cut short" for a file that is whole with extra bytes after it. Internal text only.
3. (Test gap) M16 and M17 above.
4. (Existing on the base) A malformed file the decoder accepts is stored as the model's picture with no mark: 115 of 385 cut-and-closed files give a partial picture, and across the corpus 93 accepted files give an entirely transparent crop and 18 a single flat colour (`evidence/what-was-stored.txt`). Identical bytes on the base. Covers have a blank check; this path has none.
5. (Existing on the base) A pack post whose image fell back to the template is still stored with `photo: true` (`social/generate.ts:105`), which is what marks a post as made with AI on X.
6. (Existing on the base) The decoder treats any file containing the text `<svg` as SVG: a good PNG with that text in a tEXt chunk, or a good JPEG with it in a comment, is refused ("Invalid SVG image" on the base, `not_loaded` now). It never rendered one that passed the bytes check.
7. (Existing on the base) Section 1, point 2: `pixels` and `compressBytes` trust storage to return whole files.

## Not tested

- A live provider answer (no keys): the actual bytes OpenAI, xAI and OpenRouter return.
- Linux and the Railway container: the crash signals, the child's start time and memory, and whether the child can start there were measured on macOS arm64 only. Covers and logos already depend on the same child in production.
- The drafting pipeline's cover step and the `article.bodyImages` job end to end (they need the text model); their error handling was read, and `generateArticleBodyImages` was run directly.
- A built Next.js server: whether the one-at-a-time queue is one instance across server bundles.
- The full suite (the PM's run).

## How to run

From the worktree root. `<corpus>` is any empty scratch directory; `magick`, `cwebp`, `gif2webp`, `jpegtran`, `sips`, `ffmpeg` add files when installed.

```
node .factory/safe-provider-image-decode/qa/make-corpus.mjs <corpus>
node .factory/safe-provider-image-decode/qa/old-decode.mjs <corpus> .factory/safe-provider-image-decode/qa/evidence/old.json      # about 1 minute
QA_CORPUS=<corpus> npx vitest run --config .factory/safe-provider-image-decode/qa/vitest.config.ts corpus paths                    # about 6 minutes
node .factory/safe-provider-image-decode/qa/compare.mjs            # add --list for every file
bash .factory/safe-provider-image-decode/qa/cost.sh <corpus>
node .factory/safe-provider-image-decode/qa/two-processes.mjs <corpus>
node .factory/safe-provider-image-decode/qa/what-was-stored.mjs <corpus> .factory/safe-provider-image-decode/qa/evidence/new.json
```

The database probe, on a migrated throwaway database, for this revision and for a copy of the base (`git archive b3ad2d50 | tar -x -C <base>`, link `node_modules`, copy `callers.db.qa.test.ts` and `vitest.config.ts` to the same path there; never give the base the crashing file):

```
DATABASE_URL=… QA_ANSWERS=good,html,crasher,trailing QA_OUT=…/callers.head.json npx vitest run --config .factory/safe-provider-image-decode/qa/vitest.config.ts callers.db
DATABASE_URL=… QA_ANSWERS=good,html,trailing        QA_OUT=…/callers.base.json npx vitest run --config .factory/safe-provider-image-decode/qa/vitest.config.ts callers.db   # in <base>
```

The breakages: `git archive 0d2739c1 | tar -x -C <mut>`, link `node_modules`, then `python3 .factory/safe-provider-image-decode/qa/mutations.py <mut> <out.json>`.

Evidence is in `evidence/`: `old.json`, `new.json`, `compare.txt`, `paths.json`, `callers.base.json`, `callers.head.json`, `cost.txt`, `two-processes.txt`, `what-was-stored.txt`, `mutations.json`, `child-program.js`.
