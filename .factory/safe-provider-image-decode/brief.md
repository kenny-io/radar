# Safe decoding of image providers' pictures

## Problem
`loadImage` from `@napi-rs/canvas` 0.1.100 ends the whole process with a segmentation fault on some malformed files instead of throwing (`FF D8 FF D9`, a PNG with IHDR and IEND and no IDAT, others; measured in `.factory/safe-logo-decode/verification.md`). It also renders SVG and accepts a cut-short file without an error. Covers (`realCover/picture.ts`) and site logos (`analysis/brand.ts`, pull request 57) already decode in a child process through `src/server/services/untrustedImage.ts`. Three in-process `loadImage` calls were left: `coverCrop` in `services/images.ts`, and `pixels` and `compressBytes` in `services/social/publish/media.ts`.

## Where the bytes come from (traced 2026-11-14, before any change)

| Decode | Reached from | Where the bytes come from | Made by Radar? | Decision |
| --- | --- | --- | --- | --- |
| `coverCrop` (`images.ts`) | `generatePhoto` ← `renderImageFile`, strict request (`modelRequired`): a cover a person regenerates (`actions/article.ts`, `drafting/draft.ts`), article body images (`drafting/bodyImages.ts`), a social post or Daily Brief visual with custom directions (`social/generate.ts`, `brief/visuals.ts`) | base64 from the OpenRouter, OpenAI or xAI response (`generatePhotoRaw`) | No: an image provider | Move. Refused picture: throws, as a decode error does today; the caller's existing "couldn't generate" answer |
| `coverCrop` | the same strict and not-strict branches ← `ensureImages` in `social/publish/pubs.ts`: a pack post with no rendered file is rendered just before it is checked or sent (found by QA) | the same | No | Move. Refused picture: strict → the send fails as `media`, as a decode error does today; not strict → the brand template |
| `coverCrop` | `generatePhoto` ← `renderImageFile`, model style, not strict: article covers (`publishing/publisher.ts`, `drafting/draft.ts`), social posts, Daily Brief visuals | the same | No | Move. Refused picture: the existing fallback, the brand template with `placeholder: 'failed'` |
| `coverCrop` | `renderImageFile(r, { raw })` ← `createPack` in `social/generate.ts`: one model image shared by a pack, cut once per platform | the same (`generatePhotoRaw`) | No | Move. Refused picture: the existing fallback, the brand template |
| `pixels` (`media.ts`) | `mediaProblem` ← `send.ts` (at send time), `compressIfNeeded` ← the `social.compress` action | `readObjectBytes(url)`, where `url` is a pack post's `imageUrl` or a Daily Brief item's `img.urls[i]`. Every writer of those two fields stores the result of `renderImageFile` (a PNG from Radar's canvas: the template, or `coverCrop`'s output) or of `compressBytes` (a JPEG from Radar's canvas). No action takes an image or an image URL from the client for a post | Yes: Radar's canvas output, read back from Radar's storage | Stays |
| `compressBytes` (`media.ts`) | `compressIfNeeded` ← `social.compress` | the same | Yes | Stays |
| `scripts/generate-email-brand.ts` | run by a developer; not in the web or worker process | `public/brand/radar-mark.svg` from the repository | Yes | Stays |
| `untrustedImage.ts` | the child process itself | — | — | This is the safe decoder |

Checked and not a decode: `analysis/devsite.ts`, `publishing/connectors/live-fixtures.ts`, `scripts/generate-social-cards.ts` and `lib/visual.ts` only draw (`createCanvas`); `connectors/ghost.ts` uploads stored bytes without decoding. The only owner upload is the logo (`profile` action → `putDataUrl`); it is stored and never decoded on the server. Every other `loadImage` in the repository is in a test or a QA script.

The social-posting rows hold as long as two things stay true: only Radar writes to its bucket, and no action lets a person attach their own image to a post. If either changes, `pixels` and `compressBytes` must move too.

## Scope
`coverCrop` in `src/server/services/images.ts`, tests, these records. Started on pull request 57's branch at `472bdfd8`, which adds `untrustedImage.ts`; that pull request merged during the work with no other change, so the base is `main` `b3ad2d50`. No new dependency, no schema change, no UI. `untrustedImage.ts`, `picture.ts`, `brand.ts` and `media.ts` are not edited.

## Decisions
- D1. Only `coverCrop` moves; see the table.
- D2. `coverCrop(raw, w, h)` keeps its signature and, for a good PNG, JPEG or WebP, returns the same PNG as before (the same draw, run in the child).
- D3. Before any decode the bytes must be a complete PNG, JPEG or WebP, not animated, with a positive size within the shared pixel limits (`probeImage`, `overPixelLimits`). Anything else is refused and no child starts. This changes behaviour for a provider that answers with GIF, AVIF, BMP, TIFF or SVG bytes, or a cut-short file: the decoder took those before (SVG already was refused by its label on the OpenRouter route). The three providers answer with PNG, JPEG or WebP for the requests Radar sends; this was not checked against a live provider here (no keys).
- D4. The decode and the draw run in `decodeInChild` (20 s, 32 MB of output, as covers). The parent checks that the answer is a complete PNG of exactly `w`×`h`.
- D5. A refused picture, and a decoder that cannot run, both make `coverCrop` reject with an `Error` that is not a `RadarError`. Nothing ever falls back to decoding in-process. The callers are unchanged, so: not strict → brand template, `placeholder: 'failed'` for a cover and no placeholder for a pack's shared image, and the failure is reported as degraded; strict → the error reaches the caller as it does today.
- D6. The `ai_calls` row for the provider call is written before the crop and is unchanged: the provider answered and billed.
- D7. Crops share the one-at-a-time queue with covers and logos. A pack's shared image is cut once per platform, one after another; each takes about 150 ms more than in-process.

## Decisions after QA (2026-11-14, PM; `qa/qa.md`, verdict: ship with noted limits)
QA found no defect against AC1–AC8, checked the trace table independently and found no way for bytes Radar did not render to reach `pixels` or `compressBytes`. On its own 1,642-file corpus, 683 files end the base's process and none ends this one; 429 crops of 77 good files equal the base's bytes.
- Q1 (limit, new, accepted; the owner may want it changed). "Complete" is `probeImage`'s rule, the one covers and logos use, so three kinds of whole file are refused that the decoder took before: a PNG with any byte after its end chunk, a JPEG with more than about 4 KB after its end marker or with no end marker, and a WebP whose declared size is larger than the file. None is expected from an image model, and none was checked against a live provider. If a provider did answer this way, every image from it would become the brand template (or a failed strict request) while still recorded as paid, and it would show only as failure reports reading "The image model's picture was refused: …". Loosening it means changing `probeImage` for covers and logos too, or giving provider images their own rule.
- Q2 (fixed). The refusal text said "cut short" for a whole file with extra bytes. Reworded.
- Q3 (fixed). Two deliberate breakages went unnoticed by the engineer's tests: the 20 s and 32 MB limits (D4), and bytes of the picture in the child's arguments. Tests added for both.
- Q4 (on the base too, not changed). A damaged file the decoder accepts is stored as the model's picture, unmarked: part of a picture, or a fully transparent crop. Covers have a blank check; provider images do not.
- Q5 (on the base too, not changed). A pack post that fell back to the template is still marked `photo: true` (`social/generate.ts`), which labels it as AI-made on X.
- Q6 (on the base too, not changed). `pixels` and `compressBytes` trust storage to return Radar's file whole. Radar's own PNG cut to a few dozen bytes ends the process that decodes it. Reading the size with `probeImage` and refusing a file that is not whole before `compressBytes` would close it without a child process.
- Q7 (shared module, not changed). A child killed from outside, as when memory runs out, is reported as the picture's fault. The queue is one per process: the web and the worker process can each run one child at the same moment.
- OpenRouter documents PNG, JPEG, WebP, SVG and GIF outputs and says the provider's default applies when no format is asked for; Radar asks for none. A GIF answer was decoded before and is refused now (D3).

Not tested by anyone: a live provider's answer (no keys), Linux and the Railway container (the child starts the same way as for covers, which run there), the built Next server.

## Acceptance criteria
- AC1. No `loadImage` in `images.ts`; nothing in the web or worker process decodes a provider's bytes.
- AC2. For a good PNG, JPEG and WebP, `coverCrop` returns a PNG of exactly `w`×`h` whose bytes equal what the old in-process code gives for the same file.
- AC3. Each crashing file (`FF D8 FF D9`; a PNG with IHDR and IEND and no IDAT; a PNG with a wrong IHDR checksum; a JPEG with a frame header and no scan), sent as the provider's image: the test process survives; not strict → `renderImageFile` resolves with the brand template and `placeholder: 'failed'`; strict → it rejects; pack shared image → every post gets the template. A good image generated afterwards in the same process works.
- AC4. No child process starts for: SVG, GIF, BMP, TIFF, AVIF or HTML bytes; a cut-short PNG, JPEG or WebP; an animated WebP; a declared size over the limits. Each takes the same failure path as AC3.
- AC5. A file that passes the bytes check and crashes the decoder in the child (at least one is known from pull request 57's QA) is refused; the process survives.
- AC6. Decoder unavailable (spawn throws): `coverCrop` rejects with a plain `Error`, the not-strict path stores the template, the next call works.
- AC7. The existing image and social tests pass unedited: `images.records.test.ts`, `imageAvailability.test.ts`, `articleImagesFallback.test.ts`, `social/packImage.test.ts`, `ai/openrouter.test.ts`, `ai/openrouter.qa.test.ts` (except its known parity snapshot), `spendRecords.db.test.ts`, `untrustedImage.test.ts`, `realCover/*.test.ts`, `analysis/brand.test.ts`, the social publishing tests.
- AC8. `npm run typecheck` passes. The full suite has no failure that the base does not have.

## Delivery
Pull request to `main`. No merge, no deploy: `main` deploys to Railway on merge.
