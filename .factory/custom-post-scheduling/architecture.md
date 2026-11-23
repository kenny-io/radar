# Architecture: custom posts (A1)

Status: proposed by the architect for PM approval. Contract: `brief.md` (C1–C11). UI: `design.md`.
Workspace: worktree `thally-custom-post-scheduling-dfb0dc`, branch `kenny-dev/thally-custom-post-scheduling-dfb0dc`, base `main` @ `467749c7`.

## 1. The design in one page

- **What's new.** A *custom pack* is an ordinary `SocialPack` row in `social_packs.data` (JSONB) with `source.kind: 'custom'` and `auto: false`. Every post in it carries `author: 'user'`. There is no migration, no job, no AI call and no new scheduler.
- **Creating the pack.** The new action `social.createCustom` creates it synchronously from a name, platforms and text for each platform, and returns `{ packId }`.
- **Where everything else happens.** The composer only collects the name, the platforms and the text. After saving, the user lands in the existing `PackView` (`?pack=ID`), which has a *custom mode*. Text editing, media upload and Post now / Schedule / Schedule all happen there, through the existing `PublishBox`, `ScheduleModal`, `ScheduleAll`, `social_pubs` rows and worker sender.
  - Reason: the upload route needs a `packId`.
  - Reason: PackView already has the account picker, TikTok/YouTube `PublishOptions`, preflight issues, the expiry note, locks and the posted link. Building any of these inside the composer would duplicate them.
- **Images.** One image per platform. The new route `POST /api/b/[bid]/social-image` validates the file with the untrusted-image pipeline (probe, then decode in a child process). It stores Radar's re-encoded copy in `imageUrl`/`imageMeta`. There is a remove action, `social.imageRemove`.
- **Video.** Instagram, TikTok and YouTube use the existing `POST /api/b/[bid]/social-video` and `social.videoRemove`. The client upload control, deleted in `d6106456`, comes back for custom packs only.
- **What `author: 'user'` changes.** Three things need it:
  - The shared preflight input stops counting a missing image as one image.
  - `loadTarget` stops rendering a Radar image at schedule or send time.
  - `aiMedia` is always false.
- **AI guards.** The services refuse to rewrite custom packs. Text regeneration, image regeneration, style and every explainer-media entry point are refused.

## 2. Verified facts that drive the design

| # | Finding | Evidence |
|---|---|---|
| F1 | **Text-only custom posts would go out with a Radar image.** `loadTarget` sets `needsRender` whenever a pack post has no `imageUrl`, video, slides or mediaGeneration. `ensureImages` then calls `renderPostImage`, stores the result, and sets `t.aiMedia = r.photo` (X `made_with_ai`). This runs in `preflightGate` (schedule and post now) and again in `runSend`. | `pubs.ts:79,100-105`; `schedule.ts:62-66,83`; `socialPublish.ts` actions `:238`; `send.ts:221` |
| F2 | **Client and server disagree about missing images.** On the client, `packPreflightInput` returns `[imageMeta ?? null]` when there is no image. That counts one unknown image, so for Instagram and TikTok the client never shows `media_required`, while the server's `loadTarget` returns `[]`. PackView also passes `nImg = 1`, so the Post now confirm says "with 1 image". | `src/lib/socialPublish.ts:174-177`; `PackView.tsx:86` |
| F3 | **Preflight already runs at schedule, post now and send.** At send it uses the latest content: `runSend` reloads the target and calls `ensureImages` and `preflight`. Edits made after scheduling are what gets sent, and they are checked again. `social.move` does not run preflight, but send does. Allowed edits stop at the 5-minute lock. | `schedule.ts:75-84`; `actions/socialPublish.ts:226-258,261-278`; `send.ts:218-224`; `guards.ts:20`; `social.ts:31,107` |
| F4 | **The existing path sends multiple images on Instagram only.** The adapters accept N images: `x.ts:84`, `linkedin.ts:138-139` (multiImage), `instagram.ts:108-113` (carousel) and `tiktok.ts:78-79`. But `ensureImages` refuses `slides` unless the platform is Instagram with 2–10 JPEG slides at 4:5–1.91:1. `slides` is also the explainer-carousel field: library labels, `social.compress` and media generation all read it that way. So the brief's condition fails, and **v1 has one image per platform**. | `pubs.ts:99,116-122`; `actions/socialPublish.ts:334-347`; `library.ts:55`; `PublishBox.tsx:84` |
| F5 | **Uploaded bytes are untrusted.** `@napi-rs/canvas` can crash the process on malformed JPEG/PNG/WebP headers. Radar's rule is: probe the bytes, check pixel limits, then decode only in a child process. Several downstream paths decode in-process: `mediaProblem` (LinkedIn pixel count), `compressBytes`, and the slide checks. `probeImage` supports only JPEG, PNG and WebP; GIF returns `null`. | `untrustedImage.ts:1-9,20-54,135`; `media.ts:26-48`; `images.ts:200-215` |
| F6 | **Stored files are public at unguessable URLs, served with the stored content type.** The type must be the sniffed or re-encoded one, never the type the client declared. `storedKey` refuses any URL outside `<bid>/…`, and send re-checks it. | `api/files/[...key]/route.ts`; `storage.ts:16-27,49-57`; `pubs.ts:113` |
| F7 | **The video upload exists but has no client.** The route and `attachVideo` exist and are gated by publishing. `VideoAttachment.tsx` was deleted in `d6106456` (`git show d6106456^:src/features/social/channels/VideoAttachment.tsx`). | `api/b/[bid]/social-video/route.ts:17`; `publish/video.ts:17-36` |
| F8 | **Automatic code never touches packs other than the daily ones.** Autopilot touches only `dailyPackId` = `auto-<bid>-<date>`. `autoSchedule` is called only with that id. `mediaReady` requires `pack.auto` and the daily id. Read-only use: the last 12 packs and their labels feed AI "recent posts" and topic de-duplication. That is read-only, inside the same business, and acceptable. | `auto.ts:24,64,79,96,93`; `autopilot/run.ts:140-159`; `proactive.ts:31-37` |
| F9 | **Widening `source.kind` breaks the build until `KIND_L` has the new key.** `KIND_L` is `Record<SourceKind,string>`. `social.generate`'s zod enum stays without `'custom'`, so generation can never create or overwrite one. | `generate.ts:23,34`; `actions/social.ts:65` |
| F10 | **`createPack` records a `social_publish` reminder.** Packs Radar prepares get a reminder email after 24 hours. | `generate.ts:177`; `engagement.ts:16,102-108` |
| F11 | **The act route already logs action input to events.** That input includes text, as `social.text` does today. | `act/route.ts:33` |
| F12 | **Instagram feed images:** JPEG only, at most 8 MB, aspect ratio 4:5–1.91:1, width scaled into 320–1440. **TikTok photos:** JPEG and WebP only, at most 20 MB, "Maximum 1080p". `IMAGE_TYPES.tiktok` currently also lists PNG, which TikTok's docs do not. | Sources below |

## 3. Data contract (no migration)

### 3.1 Type changes in `src/lib/types.ts` (shared file, single owner: Engineer A, first commit)

```ts
// types.ts:195
source: { kind: 'idea' | 'url' | 'article' | 'suggest' | 'custom'; label: string; ref?: string | null };

// SocialPost (types.ts:162-191): add
/** 'user': the text and media were written or uploaded by a person (custom pack). Radar never writes, renders,
 *  regenerates or labels this post's media as AI. Set once by social.createCustom; never changed. Absent: Radar's. */
author?: 'user';
```

### 3.2 A stored custom pack

```ts
{
  id: 'c' + Date.now().toString(36) + randomToken(4),   // made on the server; never starts with 'auto-'; no ':'; ≤ 64 chars
  name,                                                  // §4.1
  source: { kind: 'custom', label: name, ref: null },
  created: bizToday(biz), style: 'branded', custom: '', voice: '', auto: false,
  order: platforms,                                      // PackExtra.order: tab order = the user's pick order
  posts: { [k]: { author: 'user', text, style: 'branded', seed: 0, imageUrl: null, imageMeta: null, copiedAt: null, v: 0,
                  ...(k === 'youtube' ? { publishOptions: { title: youtubeTitle(name) }, publishOptionsRevision: 0 } : {}) } },
}
```

- The pack has no `headline` and no `grounding`.
- `youtubeTitle(name)`: the name with `<` and `>` removed, truncated to 100 characters. The post gets **no** `youtubeGeneratedTitle`, so `finishYouTubeTitle` (`youtubeAutomation.ts:22`) can never replace it.
- Uploads set `imageUrl`, `imageMeta`, `compressed: false` and `photo: false`, and clear `video`, `slides`, `generatedMedia`, `mediaGeneration` and `mediaRecommendation`. They also bump `mediaRevision`.

### 3.3 Every consumer of `source.kind`, and what changes

| Consumer | Change |
|---|---|
| `generate.ts:34` `KIND_L` | Add `custom: 'text the user wrote'`. It is unreachable because of the guards, but needed to compile. |
| `generate.ts:36-47` `groundingFor` | No change. Its only callers are generate, regenText and the media planner, and all are guarded (§6). |
| `media/planner.ts:20-23` | No change, because it is unreachable (§6). |
| `actions/social.ts:65` (`social.generate` zod enum) | Keep it **without** `'custom'`. |
| `PackView.tsx:71` header | Custom: "Written by you · {date}" (design.md). |
| `PackThumb.tsx:25` placeholder | Custom with no media: a neutral text tile, not the brand `Visual` template. |
| `library.ts:43` search | For custom packs, add the posts' text to the haystack, trimmed to 2,000 characters per post. |
| `proactive.ts:35-37`, `auto.ts:64`, `engagement.ts:98` | Read-only. No change needed: custom packs are never `'article'` or `'url'`. |

## 4. `social.createCustom`

### 4.1 Contract (`src/server/actions/social.ts`)

```ts
'social.createCustom': action({            // write → role Editor (default); Viewer gets 403 from the act route
  input: z.object({
    name: z.string().max(120).optional(),
    posts: z.array(z.object({ platform: PlatformZ, text: z.string().max(20000) })).min(1).max(8),
  }).strict(),
  run: async (ctx, i) => ({ packId }),     // synchronous; no job, no AI, no network
}),
```

Validation runs on the server, in this order. Copy says "Radar" where needed.

1. Duplicate platforms are refused with 400 `'Pick each platform once.'`.
2. If every text is blank after trimming, the action refuses with 400 `'Write something to post.'` (the `COPY`-style message that `preflight` uses).
3. Text is stored **verbatim**. It is never passed through `enforce`, `fitTo` or `keepOnlyLink`, and competitors are never stripped. Saving text over the limit is allowed.
4. Name: control characters are stripped, whitespace is collapsed and the result is trimmed. When it is empty, the name is `defaultPostName(firstNonBlankTextInPickOrder)`.
5. The pack is inserted with `db.insert(schema.socialPacks).values({ id, businessId: ctx.bid, data })`.
6. **No** `recordEngagement` call. The user just wrote this; reminder mail is for packs Radar prepared (decision D3).
7. Return `{ packId: id }`. The act route bumps the revision and returns the workspace.

Copy-only platforms (Facebook, Reddit, Quora) are valid. They get a post with `author: 'user'` and the same shape. They render as copy/download only: `canPost` is false, and `PublishBox` shows its `copy_only` state.

Publishing off (C9): the action is not flag-gated. It never touches `social_pubs`.

### 4.2 New isomorphic helpers (`src/lib/customPost.ts`, new, Engineer A)

```ts
export const isCustomPack = (p: Pick<SocialPack, 'source'>) => p.source?.kind === 'custom';
/** First line, whitespace collapsed, ≤ 64 chars cut at a word with '…'. Never rewrites the words (no shortHead: it mangles '-' and URLs). */
export function defaultPostName(text: string): string;
/** Still image types a user may upload for a platform (v1: no GIF). youtube: none. */
export const UPLOAD_IMAGE_TYPES: Record<Platform, string[]>;   // all except youtube: ['image/jpeg','image/png','image/webp']
/** The type Radar stores for an upload: the input type if the platform takes it, else JPEG. */
export const storedImageType = (k: Platform, input: string) => string;
// x: same (jpeg/png/webp) · linkedin: jpeg/png same, webp → jpeg · instagram → jpeg · tiktok: jpeg/webp same, png → jpeg · facebook/reddit/quora: same
```

### 4.3 Shared limit helper (`src/lib/socialPublish.ts`, Engineer A)

```ts
/** The text budget preflight enforces, for counters. Copy-only platforms: max null (count only, never blocks). */
export function textBudget(k: Platform, text: string, o: { video?: boolean } = {}):
  { used: number; max: number | null; unit: 'characters' | 'bytes'; over: number };
// x: charCount weighted vs 280 · linkedin 3000 · instagram 2200 · tiktok: video ? 2200 : 4000 (as preflight:131)
// youtube: UTF-8 bytes vs 5000 · facebook/reddit/quora: code points, max null
```

`preflight`'s too-long branch (`socialPublish.ts:125-133`) must call `textBudget`, so the counter and the server cannot disagree. The existing `socialPublish.test.ts` cases must pass unchanged.

## 5. Media

### 5.1 Server-side `author: 'user'` semantics (Engineer A)

- **`packPreflightInput`** (`socialPublish.ts:174`): add `'author'` to its `Pick`.

  ```ts
  images: p.video || k === 'youtube' ? [] : p.slides?.length ? p.slides.map(s => s.meta)
        : p.author === 'user' && !p.imageUrl ? [] : p.mediaGeneration && !p.imageUrl ? [] : [p.imageMeta ?? null]
  ```

  Also add `'author'` to `scheduleAllWhy`'s `Pick` (`:377`), and pass `own: p.author === 'user'` into the result (next item).
- **`PreflightInput.own?: boolean`**: the copy for user-owned media, with no change to the codes.
  - `media_required`:
    - YouTube: "Upload a video before posting to YouTube."
    - Instagram: "Add an image or video before posting to Instagram."
    - TikTok: "Add a photo or video before posting to TikTok."
  - `video_format`: "Upload an MP4 or WebM video." On Instagram: "Instagram reels need an MP4 video."
  - `video_too_big`: "Upload a video under 100 MB."
- **`loadTarget`** (`pubs.ts:76-80`):
  - `needsRender: post.author !== 'user' && …(existing)`
  - `aiMedia: post.author !== 'user' && (…existing)`
  - Add `own: post.author === 'user'` to `Target`, and pass it through `preflightInput` (`pubs.ts:91`).
- **`ensureImages`** (`pubs.ts:115`): when `t.own`, the missing-image message becomes "That image is missing. Upload it again."
- **`attachVideo`** (`video.ts:32`): when `isCustomPack(p)`, also set `imageUrl: null, imageMeta: null`, so removing a video never brings back an older image. Generated packs keep today's behaviour: the generated still stays as a cache.

### 5.2 `POST /api/b/[bid]/social-image` (new route; a new route rather than extending social-video)

A new route, because its caps, types, validation, flag gating and response all differ from video.

```
multipart/form-data: packId (string 1..64), platform (Platform except 'youtube'), file (File)
200 { ok: true, image: { url: string, meta: MediaMeta, width: number, height: number } }
4xx { ok: false, error: <user copy>, code }      // via handle(); previous media untouched on every error
```

The steps run in this order (`route.ts` is thin; the logic lives in `src/server/services/social/publish/upload.ts`):

1. `assertAuthOrigin(req)`, `requireActor()`, `requireRole(bid, actor.id, 'Editor')` and `gateBusiness(actor, bid)`. A deleted business gets 404. Viewers get 403. The route is **not** flag-gated (decision D2, C9).
2. Read the body with a bound. Refuse with 413 `too_large` "Choose an image smaller than 5 MB." when Content-Length exceeds `MAX_IMAGE_BYTES + 64 KiB`, or the streamed body does. Use the same streaming bound as `videoForm` (`video.ts:39-52`); extracting `boundedForm(req, max, copy)` is fine if the `videoForm` tests stay green.
3. Parse with zod. YouTube gets 400 "YouTube posts use a video." A missing file gets 400 "Choose an image to upload."
4. Pack checks: `getPack(bid, packId)` and the post. A missing pack or post gets `notFound('Post')`. A pack that is not custom gets 409 `not_custom` "Radar can only add your images to posts you wrote." (decision D4). Then the lock: if the platform is in `VIDEO_PLATFORMS`, call `assertVideoEditable` (refuses posted or locked). Otherwise call `assertEditable` plus a posted check (`COPY.alreadyPosted`). The lock is a no-op with publishing off (`guards.ts:13`).
5. Validate the bytes. The declared MIME type and the filename are never read.
   - The file must be at most `MAX_IMAGE_BYTES` (5 MB, 413).
   - `probeImage(bytes)` must return a value; otherwise 400 `invalid_image` "Choose a JPG, PNG or WebP image."
   - The probed type must be in `UPLOAD_IMAGE_TYPES[k]`; otherwise 400 with the same copy.
   - The file must be `complete`; otherwise 400 "That image file is incomplete. Export it again."
   - The image must not be `animated`; otherwise 400 "Animated images aren't supported yet. Use a still image."
   - The width and height must be positive and pass `!overPixelLimits`; otherwise 400 "That image is too large. Use one under 10,000 pixels on each side."
6. Decode and re-encode in the child: `decodeInChild(bytes, RECODE, opts, { timeoutMs: 20_000, maxOutput: 8 MiB })`.
   - **The work script `RECODE`** is a constant in `upload.ts`. It reads the decoded (EXIF-upright) `img.width`/`img.height`. It refuses with `{ code: 'ratio' }` when `opts.ratio` is set and w/h is outside it. It scales down, never up, to fit `opts.maxW × opts.maxH`. It draws, flattening onto white for JPEG, and encodes to `opts.type` with a quality ladder of 92, 85 and 75 until the output is at most 5 MB. It replies `{ w, h }` plus the buffer.
   - **Options for each platform:**
     - Instagram: `ratio [0.8, 1.91]`, `maxW 1440`, type JPEG.
     - TikTok: fit within 1080 px on the short side (`maxW/maxH` = 1080×1920 portrait or 1920×1080 landscape), type JPEG or WebP.
     - All others: `maxW/maxH` 4096.
     - `type = storedImageType(k, probed.type)`. It is a value picked from Radar's fixed allowlist (`image/jpeg|png|webp`); nothing is copied from the bytes. `opts` holds only allowlisted constants, which satisfies `decodeInChild`'s contract (`untrustedImage.ts:127-128`).
     - If a PNG or WebP output is still over 5 MB (a PNG can grow when re-encoded), RECODE falls back to the JPEG ladder. Every postable platform and every copy-only platform accepts JPEG.
   - **Results:**
     - `ImageRefused` becomes 400 `invalid_image` "Radar couldn't read that image. Try another file."
     - `ratio` becomes 400 "Instagram images must be between 4:5 portrait and 1.91:1 landscape."
     - An output still over 5 MB becomes 400 "Radar couldn't fit this image under 5 MB. Export a smaller file."
     - The output is probed again: its type must equal `opts.type`, it must be complete, and its size must match the reply.
   - **Why re-encode:** every later in-process decode only ever sees bytes Radar wrote (F5). It also turns camera photos upright and drops EXIF data such as GPS from a file that sits at a public URL (F6).
7. Store with `putObject(objectKey(bid, 'social-upload', ext), out, outType)`. The content type is always the re-encoded type.
8. Attach with `updatePack` (row lock). **Inside** the lock, re-run the step 4 lock checks and the custom check.
   - Fields written: `imageUrl`, `imageMeta: { bytes, type }`, `compressed: false`, `photo: false`, `video: null`, `slides: null`, `generatedMedia: undefined`, `mediaGeneration: null`, `mediaRecommendation: null` and `mediaRevision + 1`.
   - If the post has `publishOptions.tiktok`, set `consent: false`. This is the same invariant as `changeImage` (`social.ts:55`) and `attachVideo` (`video.ts:31`).
   - Then `bump(bid)`.
9. Logs carry the pack id, platform and error code, never bytes or text. A refused upload may leave an orphan object under `<bid>/`, which purge removes with the business. That matches video today; there is no garbage collection in v1.

Flag off: `stripSocial` hides `imageMeta` from the client (`project.ts:35-39`). That is harmless, because preview and download use `imageUrl`.

### 5.3 `social.imageRemove` (`actions/social.ts`)

```ts
'social.imageRemove': action({ input: z.object({ packId: z.string().max(64), platform: PlatformZ }).strict(),
  run: async (ctx, i) => ({ removed: true }) })
```

- The pack must be custom (409 `not_custom`), with the same lock and posted checks as §5.2 step 4, repeated inside `updatePack`.
- It sets `imageUrl: null`, `imageMeta: null`, `compressed: false`, `photo: false` and `mediaRevision + 1`, and resets TikTok consent.
- It is not flag-gated.

Video removal stays `social.videoRemove`, which is flag-gated like its upload.

## 6. Guards against AI overwrite (server, Engineer A)

Add one helper in `generate.ts`:

```ts
export const refuseCustom = (p: Pick<SocialPack, 'source'>) => {
  if (p.source?.kind === 'custom') throw new RadarError('You wrote this post, so Radar won’t rewrite it.', 409, 'custom_pack');
};
```

| Path | Where to call it |
|---|---|
| `social.regenText` | `social.ts:121`, after `packOr404` |
| `social.regenImage` and `social.style` | `changeImage`, `social.ts:39`, after `packOr404`, **and** inside the reserve `updatePack` (`:41-45`) |
| `social.mediaPrepare` and auto-prepare | `media/index.ts` `requestMediaIntent`, after `readPack` (`:47`). This covers `prepareMedia`, `retryMedia`'s re-prepare, and `generateMedia`'s `reprepare` |
| `social.mediaGenerate` | `generateMedia`, after `readPack(pool, …)` (`:58`), and on the locked re-read inside its transaction |
| `social.mediaStyle` | `saveMediaStyle`, after `readPack` (`:90`) |
| `social.mediaRetry` | Covered: its consumers can only come from the refused paths. No extra check is needed, but a test asserts it |
| Send and schedule rendering | `author: 'user'`, so `needsRender` is false (§5.1) |
| `social.compress` | **Allowed.** It is a user-clicked re-encode (no AI), and rarely needed after §5.2 |

Crons and automatic code. Today's callers already skip custom packs (F8):

- Custom ids are made on the server with a `c` prefix, so they can never equal `auto-<bid>-<date>`.
- Autopilot touches only daily ids.
- `mediaReady` requires `pack.auto`.

But `autoSchedule(bid, packId)` (`schedule.ts:121-137`) checks neither `pack.auto` nor the kind. Called with a custom id while `socialAuto.post === 'schedule'` and an account is live, it would schedule the custom posts. So add a defence in depth at the top of `autoSchedule`: `const pack = await getPack(bid, packId); if (!pack || isCustomPack(pack)) return 0;`. The C7 guarantee then doesn't rest on today's callers. A db test pins it (§9, test 9).

## 7. Enforcing limits

- **Already enforced** at schedule, post now and send (F3), through the shared `preflight`, which now uses `textBudget`. Empty text is blocked (`empty`). Over-limit text is blocked (`too_long`). Instagram, TikTok and YouTube without media are blocked (`media_required`, now correct for custom packs per F2).
- **`social.text`** keeps accepting up to 20,000 characters and saves text over the limit, per the PM's preference. It does **not** reject over-limit text for custom packs.
- **The gap: editing a scheduled post over the limit.** Saving is allowed. The scheduled panel already lists `Issues` and disables Reschedule while issues exist (`PublishBox.tsx:49,128,131`). Add the line "Fix this before {time} or it won't post." in the scheduled state when `issues.length` (design.md).
  - If the post isn't fixed, send fails it with that preflight message (`send.ts:224`; the code is `media`, a known misnomer we leave alone). It shows as "Didn't post · … Nothing was published." with Try again. Nothing over the limit is ever sent.
- **A past time** is refused by `slotGate` (`schedule.ts:68-72`). Scheduling one platform writes only its own `sid` row (`writeScheduled`), so it never changes another platform.

## 8. Authorization, tenancy, trust boundaries

- **Roles.** Writes need Editor: actions default to it (`define.ts:13`) and the route checks it explicitly. Viewers can read the workspace and copy text: `social.copied` is a Viewer action today and stays so.
- **Tenancy.**
  - Every read and write uses `getPack(ctx.bid, …)` or `updatePack(ctx.bid, …)`.
  - The client never supplies a media URL: the server writes `imageUrl` from its own `putObject`.
  - `storedKey` re-checks the business prefix at send (`pubs.ts:113`).
  - Another business's pack id returns 404.
- **Deleted businesses.** `requireRole` and `gateBusiness` answer 404. No new cron or job is added.
- **Untrusted input.**
  - Text is user content, rendered as React text; there is no HTML path.
  - Images go through probe, child decode and re-encode, and the content type comes from the output bytes.
  - The decoder child has no secrets (`untrustedImage.ts:133`).
  - Decodes are serialized one at a time across the process (`oneAtATime`, `untrustedImage.ts:117`). Uploads queue behind cover and logo decodes, with a worst case of about 20 seconds each, and the client shows "Uploading…".
- **No new secrets, network calls or dependencies.**

## 9. Tests to add

### Unit tests (no database)

- `src/lib/socialPublish.test.ts`:
  - `textBudget` for every platform:
    - X weighted: a URL counts as 23, an emoji as 2, CJK characters as 2. `'日本語'` is 6. A ZWJ family emoji is 2.
    - LinkedIn counts code points.
    - YouTube counts bytes.
    - TikTok: 2,200 with video, 4,000 without.
    - Copy-only platforms have `max: null`.
  - `preflight` and `textBudget` agree.
  - `packPreflightInput({author:'user', imageUrl:null})` gives `images: []`, and Instagram then has `media_required`. Generated posts are unchanged.
  - `own` copy variants.
- `src/lib/customPost.test.ts`:
  - `defaultPostName`: first line, 64-character cut at a word, keeps hyphens and URLs.
  - `storedImageType` matrix.
- `upload.test.ts` (child decode real, fixtures generated in-test with `@napi-rs/canvas`):
  - JPEG, PNG and WebP accepted.
  - GIF, SVG, HEIC, a renamed `.txt` and an HTML file declared as `image/png` are refused.
  - Truncated PNG refused; over 5 MB is 413; 20,000×20,000 declared header refused before decode; animated WebP refused.
  - Instagram 9:16 refused with the ratio copy; Instagram PNG stored as JPEG.
  - TikTok 3000×4000 downscaled to fit within 1080 px.
  - EXIF orientation 6 stored upright.
  - The output probes to the stored type.
- `social-image/route.test.ts` (mirror `social-video/route.test.ts`):
  - Origin and `sec-fetch-site` refusals happen before any read.
  - Editor role required; `gateBusiness` called.
  - Not flag-gated.

### Database tests (`*.db.test.ts`, `Fixtures`, `RADAR_DEV_STUBS=1`, `RADAR_SOCIAL_PUBLISHING=all`; see `actions/customImages.db.test.ts:1-30`)

`src/server/actions/customPosts.db.test.ts`:

1. `createCustom`:
   - Creates `kind:'custom'`, `auto:false`, `author:'user'` on every post, text verbatim (including over-limit text, a URL to a competitor, emoji and CJK), `order` as picked, and a default name.
   - Refuses all-blank text and duplicate platforms.
   - A Viewer is refused (`requireRole`).
   - The id never starts with `auto-`.
   - No `engagement_events` row is written.
   - No job is enqueued and the AI stub is never called (spy on `ai.run`).
2. Upload: attach to X, then replace it.
   - The previous `imageUrl` stays on every validation error.
   - `video`/`slides` are cleared and `mediaRevision` is incremented.
   - TikTok consent is reset.
   - Locked (pub due in 3 minutes) gives 409; posted gives 409.
   - A non-custom pack gives 409.
   - Another business's `packId` gives 404.
   - The stored key starts with `<bid>/social-upload/`.
3. `imageRemove`: same guards.
4. Guards: `regenText`, `regenImage`, `style`, `mediaPrepare`, `mediaGenerate` and `mediaStyle` on a custom pack give 409 `custom_pack`, and the pack is unchanged.
5. **No render, no AI flag.** A custom X text-only post through `social.postNow` with stubs is posted.
   - The adapter receives `images: []`/`mediaIds: []` and `aiMedia: false`.
   - `renderPostImage` and `renderImageFile` are never called.
   - With an uploaded image, `aiMedia` is false.
6. **C1 end to end.**
   - LinkedIn and X with different texts; schedule LinkedIn for tomorrow at 14:00 and X for tomorrow at 12:00 in `biz.timezone`.
   - Both pubs have `dueAt = zonedTimeToUtc`. `loadWorkspace` shows both scheduled, and `socialItems` lists both.
   - Advance: `claimScheduled` and `runSend` for each.
   - Each is posted with its own text and a stub URL; the other stays scheduled until its own due time.
7. **Edit after scheduling.**
   - Schedule X, then `social.text` with 300 characters: saved.
   - Run send: failed with the `too_long` message, and the adapter is never called.
   - Shorten it and Try again: posted.
8. **Publishing off.** `createCustom` and the image upload work. `social.schedule` gives 404 `not_enabled`. The workspace has no `pub` or `imageMeta`.
9. **Automatic code skips custom packs.**
   - Set `socialAuto.post = 'schedule'` and `on: true`, with a live stub X account and a live LinkedIn account.
   - `autoSchedule(bid, customId)` returns 0, and the pack has **zero** `social_pubs` rows.
   - Run the autopilot `run` for the business: the custom pack's data is unchanged, and it still has no `social_pubs` row.
10. **Deleted business.** Upload and `createCustom` give 404.

### Client unit tests

- `library.test.ts`: custom packs are found by post text; the status filter works.
- `PublishBox.test.ts`: `nImg` is 0 for a custom post without an image.

## 10. Rollout and rollback

- **Flags and data.** No migration or new env var.
  - The composer, image upload and copy/download work for every business.
  - Post now, Schedule and video upload stay behind the existing `RADAR_SOCIAL_PUBLISHING`, on both web and worker.
- **Compatibility.**
  - Older clients ignore `author` and `kind:'custom'`.
  - Older servers (during a rolling deploy) would render an image for a custom X post at send. Deploy the web and worker together. There are no custom packs until the new web ships the composer.
- **Rollback.**
  - Revert the PR. Custom packs remain as rows; the old code treats them as `idea`-like packs.
  - **Risk on rollback:** the old `loadTarget` would render a Radar image for scheduled text-only custom posts. Before rolling back, unschedule them. Use read-only SQL to list scheduled `social_pubs` whose sid pack has `data->'source'->>'kind'='custom'`. Production database reads are blocked for the architect, so the PM or an operator runs it.
  - There is no feature flag for the composer itself. Hiding the button is a one-line revert if needed.
- **Observability.**
  - The act route already tracks `action.social.createCustom` and `action.social.imageRemove`.
  - The route calls `track('social.imageUploaded', { bid, uid, ref: packId, props: { platform, type, bytes, w, h } })`, never text.
  - Upload refusals log the code only.
  - Do not map `createCustom` to `social.pack_generated`, which means Radar generated it.

## 11. Work split and order

Shared contracts land first. Engineer A's commit 1 contains only the types and lib changes, so B can build against them.

| Step | Owner | Files (exclusive) |
|---|---|---|
| 1. Contracts | **A** | `src/lib/types.ts`, `src/lib/socialPublish.ts` (+ test), `src/lib/customPost.ts` (+ test), `docs/CONTRACTS.md` § social (new action, route and `author` field) |
| 2. Server | **A** | `src/server/actions/social.ts` (`createCustom`, `imageRemove`, guards), `src/server/services/social/generate.ts` (`KIND_L`, `refuseCustom`), `src/server/services/social/media/index.ts` (guards), `src/server/services/social/publish/{pubs,video,schedule,upload(new)}.ts`, `src/app/api/b/[bid]/social-image/route.ts` (+ test), `src/server/actions/customPosts.db.test.ts`, `docs/SOCIAL_PUBLISHING.md` (user-flow lines) |
| 3. UI | **B** (after step 1 is merged into the branch) | `src/features/social/CustomPostComposer.tsx` (new), `src/features/social/PostMedia.tsx` (new: image + video slot, revives `VideoAttachment`), `src/features/social/TextBudget.tsx` (new counter), `src/features/social/{SocialMarketing,PackView,PackThumb,library(.test)}.tsx/ts`, `src/features/social/channels/PublishBox.tsx` (+ test), `src/app/radar.css` if needed |
| 4. QA | factory-qa | C1–C11 in a browser with dev stubs, 375 px, keyboard and a screen reader |

B can build the composer against `social.createCustom` and the route contract before A's server lands: the shapes are fixed here. B's end-to-end checks wait for A's step 2. Neither engineer edits the other's files. If B needs a change to a shared contract, it goes through the PM to A.

## 12. Risks

1. **The send path still renders images for posts without the marker.** Mitigation: the marker is set on every custom post at creation and is never cleared; db test 5 pins it.
2. **`IMAGE_TYPES.tiktok` lists PNG, which TikTok's photo docs don't accept.** Uploads avoid it: PNG is stored as JPEG. Generated TikTok images are unaffected. Flagged here; fixing `IMAGE_TYPES` is out of scope.
3. **TikTok "1080p" is ambiguous.** We fit within 1080 px on the short side. QA with stubs can't prove provider acceptance. Live verification needs an authorized TikTok test account.
4. **The decoder queue** (`oneAtATime`) can make an upload wait behind a cover or logo decode, up to about 20 seconds each.
5. **Re-encoding changes bytes.** JPEG at quality 92 loses a little; PNG stays lossless; a transparent PNG for Instagram or TikTok becomes white-backed JPEG. The design tells the user so.
6. **The act route stores action input**, including post text, in `events`, as `social.text` already does (F11).
7. **The video upload is reintroduced only for custom packs.** Generated packs still have no upload control. That is existing behaviour since `d6106456`; noted for the PM.

## 13. Decisions for the PM

- **D1: GIF.** v1 excludes GIF and animated WebP. The brief lists GIF; the shared `probeImage` doesn't support it, and re-encoding would drop the animation.
  - Option: add a header-only `probeGif`, kept as a separate function so covers and logos are unchanged. Validate in the child and store the original bytes for X and LinkedIn only. That is about one extra day of work, plus its tests.
  - Recommend deferring.
- **D2: image upload with publishing off.** Recommend allowing it, for copy and download (C9). Video stays flag-gated.
- **D3: no `social_publish` reminder email for custom packs.** Recommended.
- **D4: uploads only on custom packs in v1.** Recommended. It keeps the invariants (AI flags, regeneration, cached stills) simple.
- **D5: one image per platform in v1.** Required by F4. Multiple images need the `pubs.ts:99` gate generalized for each platform, plus a separate field, not `slides`.
- **D6: the name is set at creation and can't be renamed in v1.** No criterion requires renaming.

## Sources

- Instagram Graph API, IG User Media (image requirements): https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- TikTok Content Posting API, media transfer guide (photo restrictions): https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- Repository: `ARCHITECTURE.md`, `docs/SOCIAL_PUBLISHING.md`, `docs/CONTRACTS.md` § Social channels, `.factory/social-channels/architecture.md` §6, §10, §15
