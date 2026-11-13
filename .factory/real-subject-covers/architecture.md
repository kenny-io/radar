# Real subject covers: architecture (T1)

Architect record, 2026-11-13. Design only. No source file was edited. Scripts were run in a scratch directory outside the repository to check library and site behaviour; nothing from them is committed.

Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/cool-dirac-60b241`, branch `kenny-dev/cool-dirac-60b241`, HEAD `691806da` (= main), clean apart from `.factory/real-subject-covers/`. No `CLAUDE.md` or `AGENTS.md`.

Read: `brief.md`; `.factory/contextual-article-images/architecture.md`; `src/server/actions/{article,define}.ts`; `src/app/api/b/[bid]/act/route.ts`; `src/features/article/{ArticleWorkspace,BodyImage}.tsx`, `autosave.ts`; `src/client/{articleSync,app}.ts(x)`; `src/server/services/analysis/{crawl,devsite}.ts`; `src/server/http/publicNetwork.ts` and its test; `src/server/services/social/source.ts`; `src/server/services/{storage,images}.ts`; `src/server/services/drafting/{draft,imageDirections,bodyImages,jobs,stubs,guard}.ts`; `src/lib/{articleImages,types,format}.ts`; `src/server/services/publishing/{publisher,render,types}.ts` and every connector's use of `p.image`; `src/server/db/schema.ts`; `src/server/abuse/rateLimit.ts`; `src/server/observability/failures.ts`; `src/server/ai/openrouter.qa.test.ts`; `docs/CONTRACTS.md`; `DIVERGENCES.md`.

## 0. Decisions in one screen

| Q | Decision |
|---|---|
| Q1 | One guarded fetch, `fetchOwn` in `src/server/services/realCover/fetch.ts`, used for every request this feature makes (page, robots, sitemap, picture). `assertPublicUrl` + `publicDispatcher()` on every hop, redirects followed by hand (3 at most), one shared deadline, 8 MB limit that **rejects** (declared and streamed). Accepted: JPEG, PNG, WebP, decided from the bytes, not the header. SVG, GIF, AVIF, BMP and animated WebP are refused. Pixel size is read from the file header **before** decoding (25 megapixels at most), then `loadImage`. Verified by running: `loadImage` in `@napi-rs/canvas` 0.1.100 decodes all three formats, **also renders SVG, and returns a picture for a truncated file without an error**, so the header check and a completeness check are required, not optional. |
| Q2 | `ownSiteUrl(raw, domain, base?)` in `src/lib/ownSite.ts`, pure. Host must equal `businesses.domain` or end with `.` + it. `http` is upgraded to `https`; nothing is ever fetched over `http`. Any explicit non-default port, userinfo, other scheme, control character or backslash is refused. Applied to the entered address, every address found on a page, and every redirect hop. CDN hosts are never fetched. |
| Q3 | One pure page reader gives the page's names and its pictures (JSON-LD `image`, `<img>`/`<picture>` with `srcset` and lazy attributes, share images). A share image is used only when it differs from the home page's share image. The owner action tries at most two pictures; a direct picture address is never parsed as a page. |
| Q4 | No AI call. Candidates from `crawl_pages` and the sitemap; a page qualifies when its last path segment starts with the subject's words, and is confirmed only when its h1, title lead, or structured-data name **equals** the subject. The picture must be tied to the subject (structured data of that entity, alt text containing the name, or a share image that is not the site default). Kinds `building`, `place`, `product` only. 20 s and 12 requests at most, after the direction step and instead of the cover render. A completed search that finds nothing is cached on the article for 7 days. |
| Q5 | New optional JSON: `img.real` (the record, valid only while `real.url === img.url`), `img.noReal`, `Article.realCoverMiss`. `urlKey` stays `style:seed` so every existing reader shows and publishes the picture. A style change no longer re-renders while the cover is real. `article.regenerateImage` on a real cover **is** "use a generated cover instead": it generates, removes the record and sets `noReal`. Alt text is the subject's name (no fixed phrase, no language problem). No SQL migration. |
| Q6 | PNG, 1200×628, key `{bid}/hero/…png` (same as generated covers). Landscape sources are centre-cropped; portrait and square sources are shown whole on a blurred copy of themselves, because a centre crop cuts the top off a tower (checked on a real picture, §6). Minimum source 600×314. |
| Q7 | `article.useSitePicture { entryId, url }`, Editor and above. Order: role and tenant (route), `checkMedia`, load, domain rule, rate limit (30 an hour per business), fetch (25 s), store, save with a conflict check. Ten error codes with exact messages in §7. No new action for switching back. |
| Q8 | §8: one notice, one field, one button, existing components only. |
| Q9 | **Out.** The request shape is verified and the code change is five lines, but nobody has seen what the model does with a photograph as a reference, body images are strict (a rejected reference would remove the whole set), and it sends a picture of unsettled ownership to a model provider. Exact change recorded in §9 for a follow-up after one paid test call. |
| Q10 | In stub mode `fetchOwn` reads the synthesised site, which gains three "place" pages and generated PNG files; every later step (probe, decode, crop, store) runs for real. The stubbed direction step names a subject when the title contains a place name. |
| Q11 | §11. The guard is tested by stubbing global `fetch`, as `crawl.test.ts` already does. |
| Q12 | No env var, migration or dependency. Mixed versions and a revert are safe because the record is tied to the stored URL. §12. |

Things the PM should know before reading further:

1. **For the article in the original report, this change will still produce a generated cover today.** The only photograph on `lived.ae/property/wasl-611-al-warsan` is not served: the site's own media endpoint answered `502 {"error":"Image unavailable"}` on three tries over ten minutes (2026-11-13, about 15:10–15:21 UTC), both directly and through the site's image optimiser. The page's share image is the site-wide card. Radar will find the right page, find no usable picture, and generate. Princess Tower's page works (§4.6).
2. **`businesses.domain` is whatever was typed at onboarding** (`cleanDomain` + `DOMAIN_RE` in `src/app/api/b/route.ts`). Radar never checks that the business controls it. "Own domain" therefore means "the domain this business claimed". The crawl already works on that basis; this change is the first that republishes pictures from it.
3. **Under Autopilot an automatic picture is published with nobody looking at it.**
4. Two facts about `@napi-rs/canvas` that change the earlier follow-up sketch: it renders SVG, and it accepts truncated files silently (§1.4).

## 1. Q1: the fetch guard

### 1.1 Where and why a new function

`src/server/services/realCover/fetch.ts`. `fetchUrl` in `crawl.ts` cannot be reused as it is: it follows redirects to any public host (the brief ends the attempt when a redirect leaves the domain), it truncates at 2 MB, and it has no shared deadline or request count. `social/source.ts` has the same gaps. The new function reuses the two building blocks that are right: `assertPublicUrl` and `publicDispatcher()` from `src/server/http/publicNetwork.ts`. `crawl.ts`'s `hostAllowed` is **not** used: it resolves the name separately from the socket; `publicDispatcher` checks the addresses the socket actually connects to, which is the check that survives DNS rebinding (`publicNetwork.test.ts` covers it).

### 1.2 Contract

```ts
export type SitePictureCode = 'invalid_address' | 'not_your_site' | 'left_site' | 'unreachable' | 'no_picture'
  | 'off_site_picture' | 'too_large' | 'too_small' | 'not_a_picture';
export class SitePictureError extends Error { constructor(public code: SitePictureCode, public host?: string) { super(code); } }

export const ACCEPT = {
  any: 'text/html,application/xhtml+xml,image/webp,image/png,image/jpeg;q=0.9',
  page: 'text/html,application/xhtml+xml',
  picture: 'image/webp,image/png,image/jpeg,image/*;q=0.5',
  text: 'text/plain,application/xml,text/xml',
} as const;
export const MAX_REDIRECTS = 3;

export interface OwnResponse { url: string; type: string; body: Buffer }
/** One GET on the business's own site. Every hop must pass ownSiteUrl and assertPublicUrl. Throws SitePictureError:
 *  'left_site' (a hop is off the domain; `host` names it), 'too_large' (over `maxBytes` with over: 'reject'),
 *  'unreachable' (everything else: DNS, blocked address, timeout, more than 3 redirects, a status outside 200–299,
 *  no requests left). */
export async function fetchOwn(address: URL, o: {
  domain: string; accept: string; maxBytes: number; over: 'reject' | 'truncate';
  signal: AbortSignal; requests: { left: number };
}): Promise<OwnResponse>
```

Per hop, in this order:

1. `o.requests.left-- <= 0` → `unreachable`.
2. `ownSiteUrl(at.href, o.domain)`; not ok → `left_site` with the host (first hop: the caller has already checked, so this is a redirect).
3. `assertPublicUrl(url)`; throws → `unreachable` (an internal address is not described to the user).
4. `fetch(url.href, { headers, redirect: 'manual', signal: o.signal, dispatcher: publicDispatcher() })`. Always the re-serialised `url.href`, never the text that was typed or found.
5. Status 301, 302, 303, 307, 308 with a `location`: cancel the body, `at = new URL(location, at)`, next hop. More than `MAX_REDIRECTS` → `unreachable`.
6. Status outside 200–299 → cancel the body, `unreachable`.
7. `content-length` present and greater than `maxBytes` with `over: 'reject'` → cancel, `too_large`. No body byte is read.
8. Read the stream, counting bytes after any content decoding (so a compressed body is bounded by what it expands to). Past `maxBytes`: `reject` → cancel and `too_large`; `truncate` → cancel and return what was read (text only: robots, sitemap, HTML).
9. Return `{ url: at.href, type: content-type or '', body }`.

Headers sent, and nothing else: `user-agent: env.crawlerUserAgent` (the crawl's own, default `RadarBot/1.0 (+{APP_URL}/bot)`), `accept` as above, `accept-language: en;q=0.9,*;q=0.5` (the crawl's value). No cookie, no authorization, no referer.

Limits: `PICTURE_MAX_BYTES = 8 * 1024 * 1024`; HTML and sitemap 3 MB truncate; robots 500 KB truncate. One `AbortSignal.timeout(budget)` is shared by every request of one attempt: 25 s for the owner action, 20 s inside a draft. `requests.left` starts at 12 for both (redirect hops count).

Dev stubs: `if (env.devStubs)` the function still runs step 2, then calls `devFetch(url.href)`; a `DevFetchError` or a status ≥ 400 is `unreachable`; the `maxBytes` rule is applied to the body length. No network (§10).

### 1.3 What the picture must be (`src/server/services/realCover/picture.ts`)

```ts
export const PICTURE_MAX_PIXELS = 25_000_000, PICTURE_MAX_SIDE = 10_000, PICTURE_MIN_W = 600, PICTURE_MIN_H = 314;
export const COVER_W = 1200, COVER_H = 628, CROP_KEEPS_AT_LEAST = 0.6;

/** Type, pixel size and completeness read from the bytes alone; nothing is decoded. null: not a JPEG, PNG or WebP. */
export function probeImage(b: Buffer): { type: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; complete: boolean; animated?: boolean } | null
/** The 1200×628 PNG for a fetched picture. Throws SitePictureError('not_a_picture' | 'too_large' | 'too_small'). */
export async function readPicture(res: OwnResponse): Promise<{ png: Buffer; w: number; h: number; fit: 'crop' | 'backdrop' }>
```

`probeImage` rules (prototype run against real files, results in §1.4):

- PNG: signature `89 50 4E 47 0D 0A 1A 0A`, `IHDR` at offset 12; width and height big-endian at 16 and 20; complete when bytes `length-8 … length-4` are `IEND`.
- WebP: `RIFF` at 0 and `WEBP` at 8; complete when `uint32le(4) + 8 <= length`; size from the `VP8X` (24-bit little-endian at 24 and 27, plus 1; animation flag `0x02` at byte 20), `VP8 ` (start code `9D 01 2A` at 23; 14-bit values at 26 and 28) or `VP8L` (signature `2F` at 20; 14 + 14 bits from 21, plus 1) chunk.
- JPEG: starts `FF D8 FF`; walk the segments to the first start-of-frame marker (`C0`–`CF` except `C4`, `C8`, `CC`); height at +5, width at +7; complete when `FF D9` occurs in the last 4,096 bytes (some files carry bytes after the end marker).
- Anything else, including SVG, GIF, AVIF, BMP, ICO and HTML: `null`.

`readPicture` checks, in order:

1. Header type (lower-cased, parameters removed) is one of `image/jpeg`, `image/jpg`, `image/pjpeg`, `image/png`, `image/webp`. Otherwise `not_a_picture`. The header and the bytes do not have to name the same one of the three (servers mislabel); the bytes decide.
2. `probeImage(body)` is not null, `complete`, and not `animated`. Otherwise `not_a_picture`.
3. `width * height <= PICTURE_MAX_PIXELS` and both sides `<= PICTURE_MAX_SIDE`. Otherwise `too_large`. **This is before any decode.**
4. `loadImage(body)` inside try/catch → `not_a_picture`.
5. `img.width >= 600 && img.height >= 314`, read from the decoded image because `loadImage` applies EXIF rotation (verified). Otherwise `too_small`.
6. Draw (§6) and `toBuffer('image/png')`.

One picture is decoded at a time per process (a module-level promise chain around steps 4–6): the worst case is about 100 MB of pixels, and the action runs in the web process.

How a decompression bomb is avoided: the byte limit bounds the download; the header check bounds the pixels before Skia allocates anything. Measured: a 97 KB PNG declaring 10,000×10,000 made `loadImage` alone add 96 MB of resident memory in 22 ms (greyscale; RGBA would be four times that). So `loadImage` allocates on load, and step 3 cannot be moved after it.

### 1.4 Decode verification (run in this worktree, 2026-11-13)

`@napi-rs/canvas` **0.1.100** (package.json `^0.1.80`), Node 22.18.0, darwin arm64. Each file went through `loadImage`, a 1200×628 cover draw and `toBuffer`.

| Input | Result |
|---|---|
| JPEG: real file from `lived.ae/api/media/…jpg` (233,532 bytes, 740×1110) | decodes |
| WebP: the same picture from the site's optimiser (`/_next/image…w=1200`, 168,478 bytes) | decodes |
| WebP lossy, lossless, with alpha (public sample files, 550×368 and 400×301) | decode |
| WebP animated (public sample) | decodes the first frame; refused by design |
| PNG, JPEG, WebP, AVIF written by the library itself (1600×900) | decode |
| GIF, BMP (hand-made) | decode; refused by design |
| **SVG, including one that references an external image** | **renders without error**; refused by `probeImage` |
| HTML, the site's JSON error body, empty buffer | throw (`Unsupported image type`, `empty image data`) |
| **JPEG cut to its first 20%** | **no error**; partial picture, the rest transparent |
| **WebP cut to its first 20%** | **no error**; a 740×1110 image that is entirely blank |
| **PNG cut to its first 30%** | **no error**; partial picture, the rest transparent |
| JPEG 400×200 with EXIF orientation 6 | reported as 200×400 and drawn rotated: EXIF is applied |

Output size for the real 740×1110 picture at 1200×628: PNG 1.42–1.53 MB, JPEG quality 85 about 215 KB, WebP quality 85 about 174 KB (§6).

Why the list stops at three formats: they are what AC3 names, the header parser for them is about 30 lines, and `Accept` steers negotiating servers to them. Checked against the Next.js optimiser on lived.ae: with `ACCEPT.picture` it returned `image/webp`; with only `image/png,image/jpeg` it returned `image/jpeg`; it returned AVIF in no case I sent.

### 1.5 robots.txt

The existing behaviour has two halves and this follows both. `crawlSite` (Radar's own initiative) obeys robots.txt for the `RadarBot` token; `readUrl` in `social/source.ts` (a person gave the address) does not consult it. So: the **automatic** search reads `robots.txt` once (one request, through `fetchOwn`; a failure means no rules, as in the crawl) and skips any page or picture address that `robots-parser` disallows for `uaToken()`. The **owner action** does not consult robots.txt. `uaToken` is exported from `crawl.ts` for this.

## 2. Q2: the domain rule

`src/lib/ownSite.ts` (pure; the client may import it, the server is the authority).

```ts
export type OwnUrl = { ok: true; url: URL } | { ok: false; why: 'invalid' | 'off_site'; host?: string };
/** The https address for `raw` when it is on the business's own site: the domain itself or a subdomain of it.
 *  With `base` (the page an address was found on), `raw` may be relative. Without it, `raw` is what a person typed:
 *  a missing scheme and a path-only address are completed. Never throws. */
export function ownSiteUrl(raw: string, domain: string, base?: string | URL): OwnUrl
```

Algorithm:

1. `d = new URL('https://' + domain.trim().toLowerCase().replace(/\.$/, '')).hostname`. Not parseable, no dot, or carrying a path, port or userinfo → `invalid`. (Stored domains match `/^[a-z0-9-]+(\.[a-z0-9-]+)+$/`, so an IDN business is stored as `xn--…`; the URL parser turns a typed Unicode host into the same form.)
2. `text = raw.trim()`. Empty, longer than 2,000 characters, or containing a control character or a backslash → `invalid`.
3. No `base`: `text` starting with one `/` (not `//`) becomes `https://{d}{text}`; text with no scheme becomes `https://{text}`.
4. `u = new URL(text, base)`; failure → `invalid`.
5. `http:` becomes `https:`. Any other scheme → `invalid`.
6. `u.username`, `u.password` or `u.port` set → `invalid`. (The parser drops `:443`, and `:80` before the upgrade; anything else stays and is refused. No port is ever passed through.)
7. `host = u.hostname` with one trailing dot removed. `host === d || host.endsWith('.' + d)`, else `off_site` with `host`.
8. `u.hostname = host; u.hash = ''`; return it.

Prototype run, domain `lived.ae` (all as expected):

| Input | Result |
|---|---|
| `https://www.lived.ae/a.jpg?x=1#frag`, `http://lived.ae/a.jpg`, `lived.ae/a.jpg`, `/property/x`, `media.cdn.lived.ae/a.png`, `https://lived.ae./a.jpg`, `https://lived.ae:443/a.jpg` | ok, `https`, fragment removed |
| `https://lived.ae.evil.com/…`, `https://notlived.ae/…`, `https://evil.com/lived.ae/a.jpg`, `https://evil.com#@lived.ae`, `//evil.com/a.jpg`, `https://lived.ae%2eevil.com/`, `https://lіved.ae/` (Cyrillic і → `xn--lved-l9d.ae`), `https://127.0.0.1/`, `https://[::1]/` | `off_site` |
| `https://lived.ae@evil.com/…`, `https://user:pw@lived.ae/…`, `https://lived.ae\@evil.com/…`, `https://lived.ae:8443/…`, `http://lived.ae:8080/…`, `ftp:`, `file:`, `javascript:`, `data:`, empty, `not a url` | `invalid` |
| With base `https://www.lived.ae/property/x`: `/api/media/x.jpg?bucket=p`, `//www.lived.ae/x.jpg`, `http://img.lived.ae/x.jpg` | ok |
| With the same base: `//cdn.other.com/x.jpg`, `https://cdn.other.com/x.jpg` | `off_site (cdn.other.com)` |
| Domain `xn--mnchen-3ya.de`: `https://münchen.de/a.jpg`, `https://www.MÜNCHEN.de/a.jpg` | ok; `https://munchen.de/` is `off_site` |
| Domain `blog.example.co.uk`: `https://example.co.uk/a.jpg` | `off_site` (a parent domain is not the business's site) |

Decisions and their reasons:

- **http is not fetched.** It is upgraded, so an old bookmark still works when the site has https, and fails as "couldn’t reach" when it has not. Fetching over http would let anything on the path swap the bytes that Radar decodes and then publishes.
- **All non-default ports are refused**, which is stricter than AC2 asks and removes the question of which ports are safe.
- **Third-party hosts are never fetched**, CDNs included. This is the largest limit of the feature. By platform, as generally known and not measured today: self-hosted WordPress, Ghost, Shopify's current storefront paths and Next.js sites (lived.ae is one) serve pictures from the site's own host; Wix, Squarespace, Webflow, Framer and any site using Cloudinary, imgix or a bucket host do not. Expect a large minority of businesses, perhaps a third to a half, to get the "stored on another site" message and no automatic pictures. That estimate is not verified. The rule is not relaxed.
- An own-host address that proxies a file from elsewhere (an image optimiser) is the business's own server's answer and is accepted.

## 3. Q3: picking the picture on a page

`src/server/services/realCover/page.ts`, pure (cheerio only), used by both paths.

```ts
/** Lower-cased words of a name: NFKD, combining marks removed, '&' read as 'and', split on anything that is not a
 *  letter or digit. No stemming, no stop words: "611" and "61" are different words. */
export function nameTokens(s: string): string[]
export interface PagePicture { url: string; alt: string; from: 'ld' | 'img' | 'share'; /** from 'ld': the entity's name */ of?: string }
export interface PageFacts {
  /** What the page calls its subject: the first h1, the lead of <title> and of og:title, and the name of each structured-data entity that is not generic. */
  names: string[];
  article: boolean; listing: boolean;
  /** Own-site pictures in document order: structured data, then <img>, then share images. */
  pictures: PagePicture[];
  /** Hosts of pictures that were skipped because they are not on the business's site. */
  offSite: string[];
}
export function readPage(html: string, pageUrl: string, domain: string): PageFacts
export function shareImages(html: string, pageUrl: string, domain: string): string[]   // for the home page comparison
```

- **Lead of a title**: the text before the first of ` — `, ` – `, ` - `, ` | `, ` · `, ` • `, `: `, `, `.
- **Generic structured-data types** (their `name` is not a subject, their `image` is not a picture of one): `Organization`, `WebSite`, `WebPage`, `BreadcrumbList`, `ListItem`, `ItemList`, `FAQPage`, `Question`, `Answer`, `Person`, `ImageObject`, `SearchAction`. JSON-LD is read from every `script[type="application/ld+json"]`, including `@graph`; unparseable blocks are ignored.
- **`article`**: `og:type` is `article`, or a JSON-LD type is `Article`, `BlogPosting`, `NewsArticle` or `TechArticle`, or the path matches `ARTICLE_PATH`. **`listing`**: the path is `/` or matches `LISTING_PATH`, or a JSON-LD type is `CollectionPage`, `SearchResultsPage`, `Blog` or `ItemList`. Both regular expressions are exported from `crawl.ts`. `classifyPage` is not used: its "unsure" branch treats any page with `<article>` and `<time>` as an article, and review pages (Princess Tower's has two `<article>` elements) would be lost.
- **Structured-data pictures**: `image` of a non-generic entity, as a string, an array, or an object with `url` or `contentUrl`; the first two per entity.
- **`<img>` pictures**: not inside `header`, `nav`, `footer` or `aside`; not `aria-hidden="true"` or `role="presentation"`; skipped when a numeric `width` or `height` attribute is under 200. The address is chosen from the `srcset` of the `<img>` and of `<source>` siblings in the same `<picture>` (a `<source>` whose `type` is set and is not JPEG, PNG or WebP is ignored): the smallest candidate at least 1200 wide, else the largest; with no width descriptors, `src`; when `src` is empty or a `data:` address, `data-src`, `data-lazy-src`, `data-original`, and `data-srcset` by the same rule. The first 40 `<img>` elements are read.
- **Share pictures**: `og:image`, `og:image:secure_url`, `twitter:image`, `twitter:image:src`, `link[rel=image_src]`.
- Every address goes through `ownSiteUrl(raw, domain, pageUrl)`. Off-site hosts are collected in `offSite`. An address whose path ends in `.svg`, `.gif`, `.ico` or `.avif`, or whose file name contains one of the words `logo`, `favicon`, `icon`, `sprite`, `placeholder`, `avatar`, `default` (between `/`, `-`, `_`, `.` boundaries), is skipped.

**The site-wide share image.** A share picture is usable only when its address is not among `shareImages(homeHtml)` of the site's home page (`https://{host of the page}/`, one extra request, made only when a share picture is the next candidate). If the home page cannot be read, share pictures are not used. Evidence that the obvious signal is unsafe: on `/property/wasl-611-al-warsan`, `og:image` is `/lived-social-preview.png` (the same as the home page) while `og:image:alt` says "Wasl 611 — Apartment in Al Warsan, Dubai". Alt text on a share image proves nothing.

**Which picture.**

```ts
/** Pictures the page ties to the subject, best first. */
export function subjectPictures(page: PageFacts, subject: string): PagePicture[]
// 1. from 'ld' where nameTokens(of) equals the subject's tokens
// 2. from 'img' where the alt's tokens contain the subject's tokens as a run, and the alt does not start with "illustration"
// 3. from 'share' (subject to the home page comparison)
/** What the owner action tries on a page, best first. */
export function ownerPictures(page: PageFacts, subject: string | null): PagePicture[]
// subjectPictures (when there is a subject), then every 'ld', then 'share' (same comparison), then every 'img'; no address twice
```

Owner action, page address: the first two candidates of `ownerPictures` are tried in order; the first that passes `readPicture` is the cover. When none does: `off_site_picture` if there was no own-site candidate and `offSite` is not empty; the error of the one candidate if exactly one was tried; otherwise `no_picture`. Owner action, picture address: decided by the response, not the file extension. The first request uses `ACCEPT.any`; a response whose header type starts with `image/` or whose bytes pass `probeImage` goes straight to `readPicture` and is never parsed as a page; a header type containing `html` is a page; anything else is `not_a_picture`.

## 4. Q4: automatic matching

### 4.1 When it runs

In `draftArticle`, after `resolveImageDirections` and the style-upgrade line, in place of the cover render. All of these must hold:

- `realCoverOf(a.img)` is null (a rewrite keeps a real cover, whoever chose it);
- `!coverDirectionIsOwners(a.img, e.kw)` and `!a.img.modelRequired` (the owner chose a generated cover in their own words);
- `!a.img.noReal`;
- `dir.source === 'ai'`, `dir.subject` is not null, and `dir.subject.kind` is `building`, `place` or `product`;
- `profile.domain` is set;
- not `a.realCoverMiss?.key === realCoverKey(dir.subject.name, profile.domain)` with `at` less than `REAL_COVER_RETRY_MS = 7 * 864e5` old (the same period `article.videos` uses).

`organisation` and `other` are left out on purpose: a page named after a competitor or partner usually shows a logo or a screenshot, and that as a cover is worse than an illustration. The owner action works for every article, with or without a subject.

It runs even when the article already has a good generated cover written by Radar (the owner's rule: real when possible). It does not run in `article.regenerateImage` or in the body-image job; neither fetches anything.

### 4.2 Candidates

```ts
/** Automatic path. Never throws. `searched` is false when Radar could not finish looking (timeout, the site or the
 *  picture could not be reached); only a finished search with nothing found is remembered. */
export async function findSubjectPicture(o: { bid: string; domain: string; subject: { name: string; kind: string }; budgetMs?: number }): Promise<{ picture: FoundPicture | null; searched: boolean }>
```

1. `st = nameTokens(subject.name)`. Fewer than 4 characters in total → `{ picture: null, searched: true }`.
2. `rows` = this business's `crawl_pages` (`url`, `path`, `title`, `h1`), kept when `ownSiteUrl(url, domain)` is ok. No request.
3. `origin` = the most common origin among `rows`, else `https://{domain}`.
4. C1 = rows whose h1 tokens, or title-lead tokens, **equal** `st`.
5. `robots.txt` from `origin` (one request).
6. Only when C1 is empty: sitemap addresses. Start from the robots file's `Sitemap:` lines that pass `ownSiteUrl`, else `{origin}/sitemap.xml`. Read at most 4 files (3 MB each, truncated), following a sitemap index but skipping child files whose address contains `post`, `blog`, `news`, `tag`, `categor`, `author`, `image` or `video`; stop at 20,000 addresses. `parseSitemaps` is not reused: it is not exported, it uses the crawl's fetch (redirects to any public host), and it drops query strings. Its budget of 400 is not the obstacle it looks like: it is only checked between files, so one file is always read whole. lived.ae's single sitemap holds 1,947 addresses in 340,738 bytes, and the subject's page is number 618.
7. C2 = addresses from `rows` and the sitemap whose **last path segment** (percent-decoded, `.html`, `.htm`, `.php`, `.aspx` removed) tokenises to a list that **starts with** `st`. Sorted by the number of extra words, then by length.
8. Candidates = C1 then C2, no address twice, minus addresses robots disallows and addresses matching `ARTICLE_PATH` or `LISTING_PATH`; the first **two**.

### 4.3 Confirmation, then the picture

For each candidate, in order:

1. `fetchOwn` with `ACCEPT.page` (3 MB, truncate). The header type must contain `html`.
2. `page = readPage(…)`. `page.article` or `page.listing` → next candidate.
3. **The page must name the subject exactly**: some entry of `page.names` has tokens equal to `st`. Otherwise next candidate.
4. `subjectPictures(page, subject.name)`; the first two that robots allows are fetched with `ACCEPT.picture` (8 MB, reject) and passed to `readPicture`. The first success is returned.

`searched` is `false` when the deadline fired, when a candidate page could not be reached, or when a tied picture existed and could not be reached (lived.ae's 502 is this case: Radar tries again on the next rewrite). It is `true` when there was no candidate, no page was confirmed, or the confirmed page had no tied picture or only unusable ones (too small, wrong type, off-site, the site default).

### 4.4 Near misses the rule must reject (all are tests)

| Subject | Seen | Why it fails |
|---|---|---|
| Wasl 61 | slug `wasl-611-al-warsan` | `61` is not `611` |
| Wasl 611 | page whose h1 is "Wasl 611 Tower B" (slug `wasl-611-tower-b`) | slug qualifies; no name equals the subject |
| Marina Tower | `princess-tower-dubai-marina` | slug does not start with `marina tower` |
| Princess Tower | `/property/marina-tower` (a real page on lived.ae) | slug does not start with `princess tower` |
| Wasl 611 | `/blog/why-wasl-611-is-popular` | slug does not start with the subject |
| Wasl 611 | `/blog/wasl-611-review`, h1 "Wasl 611 review: what tenants say" | article path; and no name equals the subject |
| Dubai Marina | `/blog/dubai-marina-vs-jbr` | article path |
| Wasl 611 | the right page, picture alt "Property thumbnail 1" | alt does not contain the subject |
| Wasl 611 | the right page, `og:image` equal to the home page's | site default |
| Wasl 611 | the right page, picture on `cdn.other.com` | off-site, never fetched |
| any | a page with JSON-LD `ItemList` or `CollectionPage` | listing |
| Wasl 611 | picture alt "Illustration of Wasl 611" (a cover Radar published earlier) | alt starts with "illustration" |

The prototype of `nameTokens`, the slug rule and the name rule was run against the saved lived.ae sitemap and pages: "Wasl 611" gives exactly one slug candidate and the page confirms; "Wasl 61" gives none; "Princess Tower" gives one and confirms (h1 and structured-data name are both "Princess Tower"); "Marina Tower" does not match the Princess Tower page.

Known misses, accepted (no picture is the safe side): a site that titles the page "Wasl 611 Apartments" or "The Torch" where the article writes "Torch"; slugs that are ids (`/p/12345`) on pages the crawl never reached; transliterated slugs for a subject written in another script.

### 4.5 AI call, budget, cache

- **No AI call.** Everything above is string comparison.
- Budget: `AUTO_BUDGET_MS = 20_000` and 12 requests. The usual case is 4 (robots, sitemap, page, picture). The draft job's limit is 15 minutes.
- Cache: on a finished search with nothing found the draft stores `realCoverMiss: { key, at }`, `key = nameTokens(name).join(' ') + '@' + domain`. A different subject or domain is a different key. On a find the key is removed. Not cached per business: one article a day does not justify a table.
- It never fails a draft: `findSubjectPicture` catches everything, and a storage failure after a find falls through to the generated cover.

### 4.6 What happens on lived.ae today

| Subject | Page | Picture | Outcome |
|---|---|---|---|
| Wasl 611 | found through the sitemap, confirmed | the one `<img>` (`alt="Wasl 611 · photo 1"`) answers 502; `og:image` is the site card | generated cover; `searched: false`, tried again on the next rewrite |
| Princess Tower | found, confirmed | structured-data `image`, `/api/media/2ror5bb4jic.jpg?bucket=properties`, JPEG 740×1110 | real cover, "backdrop" fit (§6) |

## 5. Q5: data contract

All additions are optional JSON in `articles.data`. No SQL migration.

`src/lib/types.ts`:

```ts
/** A real picture from the business's own site is the cover. It applies only while `url` equals `img.url` (realCoverOf). */
export interface RealCover {
  /** 'radar': found during a draft. 'owner': a person gave the address. */
  by: 'radar' | 'owner';
  /** The stored 1200×628 file this record describes. */
  url: string;
  /** The page the picture was found on. null when the address given was the picture itself. */
  page: string | null;
  /** The picture's address on the business's site, after redirects. */
  src: string;
  at: string;
  /** Pixel size of the source picture. */
  w: number; h: number;
  /** 'crop': centre-cropped. 'backdrop': shown whole on a blurred copy of itself. */
  fit: 'crop' | 'backdrop';
  /** by 'radar': the subject it was matched to. */
  subject?: string;
}
// Article.img gains:
  real?: RealCover | null;
  /** A person replaced a real picture with a generated cover. Radar no longer looks for a picture for this article. */
  noReal?: true;
// Article gains:
  /** Radar looked for a picture of this subject on the business's site and found none it was sure of. */
  realCoverMiss?: { key: string; at: string } | null;
```

`src/lib/articleImages.ts`:

```ts
/** The real-picture record, when it describes the cover that is stored now. */
export function realCoverOf(img: Pick<Article['img'], 'url' | 'real'>): RealCover | null
// = img.real && img.url && img.real.url === img.url ? img.real : null
/** The cover after a real picture is stored. `alt` replaces the alt unless a person wrote it. */
export function withRealCover(img: Article['img'], url: string, real: Omit<RealCover, 'url'>, alt?: string): Article['img']
// = { ...img without `placeholder`, url, urlKey: `${img.style}:${img.seed}`, real: { ...real, url }, ...(alt !== undefined && img.altBy !== 'owner' ? { alt } : {}) }
```

`withCover` (every generated or template render) also drops `real`.

**Why the record carries the stored URL.** Every writer that does not know about `real` (the old worker during a deploy, the code after a revert, the publisher's `jsonb_set`) changes `img.url` when it changes the cover. The record then stops applying by itself, and no writer has to be trusted to clear it.

Fields while the cover is real:

| Field | Behaviour |
|---|---|
| `url` | the stored real picture |
| `urlKey` | `style:seed`, as always. The client's `heroUrl` rule, the draft's `hadCover` and the old browser bundle all keep working. |
| `style`, `seed` | unchanged. `style` still styles body images and the cover a switch back would generate. A style change does **not** render. |
| `prompt`, `promptBy` | the direction for a generated cover. A draft keeps it current (Radar's direction is refreshed, an owner's is kept); nothing is rendered from it. |
| `alt` | set by the rule below; an owner's alt (`altBy`) is never touched. |
| `placeholder` | removed. |
| `modelRequired` | unchanged; it applies again after a switch back. |

**Alt text.** No fixed phrase, so no language question and no claim that it is a photograph:

- found by Radar: the subject's name (`fit(name, 200)`);
- chosen by a person: the subject's name when `a.imageDirections?.subject` exists; else the picture's own alt text from the page when it has at least 3 characters (cut to 200); else the article title.

**Precedence (AC6), exactly.**

| Cover when a draft or rewrite starts | Automatic search | Cover afterwards |
|---|---|---|
| real, chosen by a person | no | kept |
| real, found by Radar | no | kept |
| direction typed by the owner, or `modelRequired` | no | PR 54 rule (§6.1 of that record) |
| `noReal` | no | PR 54 rule |
| no subject, fallback directions, kind `organisation` or `other`, fresh miss | no | PR 54 rule |
| anything else, including a generated cover Radar wrote and a placeholder | yes | found: the real picture, and no image is generated. Not found: PR 54 rule. |

Only a person replaces a real cover: by giving another address, or by switching back. Nothing automatic ever replaces it, and it is never replaced by a template as a fallback.

**Every writer.**

- `draftArticle`: §4.1. With a real cover (kept or new) the render block is skipped; `img = { ...img, ...(owners ? {} : { prompt: dir.cover.prompt, promptBy: 'radar' }) }`, then `withRealCover` for a new one. The return value adds `realCoverMiss` or omits it.
- `article.save` (`Patch` is **unchanged**: `style`, `prompt`, `alt`; zod strips `real`, `noReal`, `realCoverMiss`): `restyled` gains `&& !realCoverOf(a.img)`. In the `change(latest)` callback, when `patch.img?.style` is set and `realCoverOf(latest.img)` is not null, the saved image gets `urlKey: \`${style}:${seed}\`` so the picture stays on screen. The existing conflict check still catches a cover that became real, or stopped being real, during a render (it compares `url`).
- `article.regenerateImage` on a real cover is the switch back (§7.3).
- The publisher: no change. `heroImage()` returns `a.img.url` when it is set, so a real cover is never rendered late; `buildPayload` sends `img.alt`.
- The body-image job: no change. It never touches `img`; its commit check reads `style`, `prompt` and `modelRequired` only.
- `article.useSitePicture`: §7.

Old articles have none of the fields: `realCoverOf` is null and everything behaves as before.

## 6. Q6: storage and format

- **PNG**, `image/png`, key `objectKey(bid, 'hero', 'png')`, the same folder and form as generated covers, so `storedKey`, `readStored`, the media route and the publisher's `bytes()` need nothing new.
- Why not JPEG, which would be about 215 KB instead of about 1.45 MB for the test picture: `wix.ts:103` names the imported file `p.slug + '.png'` whatever it is; the workspace's Download button saves `.png`; generated photography covers are already PNGs of this size. WordPress, WordPress.com and Ghost take the type from the stored file and would cope; Framer, Webflow, Shopify, Notion and the webhook pass the URL. PNG changes nothing for any connector, which is what AC8 asks. Smaller covers are a separate change that should cover generated ones too.
- **Draw rule.** Fill the canvas white first (a transparent PNG or WebP must not leave transparent or black areas). `rs = w / h`, `rt = 1200 / 628`, `kept = min(rs, rt) / max(rs, rt)`.
  - `kept >= 0.6` (sources between about 1.15:1 and 3.2:1): centre cover-crop, `s = max(1200 / w, 628 / h)`. `fit: 'crop'`.
  - otherwise: draw the cover-crop with `ctx.filter = 'blur(28px)'`, reset the filter, fill `rgba(0,0,0,0.25)`, then draw the whole picture centred at `f = min(1200 / w, 628 / h, 1)`. `fit: 'backdrop'`.
- Evidence for the second branch: the Princess Tower picture is 740×1110. Centre-cropped to 1200×628 it keeps 35% of the picture and shows the middle floors of five towers with the tops cut off; on the backdrop the whole tower and its crown are visible. Both were rendered and looked at. `ctx.filter = 'blur(…)'` works in 0.1.100 (checked by rendering).
- **Small sources.** Under 600×314 is refused, so a crop is never enlarged more than twice, and the sharp layer of a backdrop is never enlarged.

```ts
export interface FoundPicture { png: Buffer; page: string | null; src: string; w: number; h: number; fit: 'crop' | 'backdrop'; /** the picture's own alt text on the page, '' when none */ alt: string }
/** Store the file and return the cover fields. Throws on a storage failure. */
export async function storeRealCover(bid: string, img: Article['img'], p: FoundPicture, by: 'radar' | 'owner', o: { subject?: string; alt?: string }): Promise<Article['img']>
// url = await putObject(objectKey(bid, 'hero', 'png'), p.png, 'image/png')
// return withRealCover(img, url, { by, page: p.page, src: p.src, at: now, w: p.w, h: p.h, fit: p.fit, ...(o.subject ? { subject: o.subject } : {}) }, o.alt)
```

A replaced cover file is left in storage, as replaced generated covers are today.

## 7. Q7: the server action

### 7.1 `article.useSitePicture`

```ts
'article.useSitePicture': action({
  input: z.object({ entryId: z.string().min(1).max(100), url: z.string().trim().min(1, 'Enter the address of a page or picture on your site.').max(2000) }),
  run: async (ctx, { entryId, url }) => { … return { url: img.url, page: real.page, src: real.src }; },
})
```

Role: the default for a write, `Editor` (so Owner, Admin and Editor; a Viewer gets 403 from the route before `run`). Order inside `run`:

1. `await checkMedia(ctx.bid, entryId)`: tenant (the row is read by business id), `article_locked`, `publication_pending`, `article_busy`. Nothing has been fetched.
2. `load`.
3. `ownSiteUrl(url, ctx.biz.domain)`: `invalid_address` or `not_your_site`. Still nothing fetched.
4. `enforce([{ key: 'sitepic:biz:' + ctx.bid, limit: 30, windowSec: HOUR, error }])`. Radar fetches from a domain nobody has verified, so the action is not left open to a loop.
5. `pictureFromAddress({ domain: ctx.biz.domain, address: url, subject: a.imageDirections?.subject?.name ?? null })`, 25 s and 12 requests at most.
6. `storeRealCover(ctx.bid, a.img, picture, 'owner', { alt })`; a throw becomes `image_failed`.
7. `save(ctx.bid, entryId, latest => …, true)`, which repeats the lock, editable and active-work checks under the row lock. Conflict when `latest.img.url !== a.img.url || latest.img.seed !== a.img.seed || latest.img.style !== a.img.style`. The direction is deliberately not compared: typing in "Describe your image" while the picture is fetched must not fail the action. Written: `{ ...latest, img: withRealCover(latest.img, stored.url, record, alt) }`.

Time: at most 25 s of fetching, about 0.3 s to decode and draw (measured 210–310 ms), then storage. `article.regenerateImage` can already take 80 s in the same process.

```ts
/** Owner path. Throws SitePictureError. */
export async function pictureFromAddress(o: { domain: string; address: string; subject: string | null; budgetMs?: number }): Promise<FoundPicture>
```

### 7.2 Errors

`SitePictureError.code` maps to a `RadarError` with these exact messages. Statuses are 4xx on purpose: `shouldReportFailure` alerts operators on anything else, and a mistyped address is not an incident.

| Code | Status | Message |
|---|---|---|
| `invalid_address` | 400 | `Enter the address of a page or picture on {domain}.` |
| `not_your_site` | 400 | `That address isn’t on {domain}. Radar only uses pictures from your own site.` |
| `left_site` | 422 | `That address redirects away from {domain}, so Radar didn’t follow it.` |
| `unreachable` | 422 | `Radar couldn’t reach that address. Check it and try again.` |
| `no_picture` | 422 | `Radar couldn’t find a picture it can use on that page. Try the address of the picture itself.` |
| `off_site_picture` | 422 | `The pictures on that page are stored on another site ({host}). Radar only uses pictures from {domain}.` |
| `too_large` | 422 | `That picture is too large. Radar accepts pictures up to 8 MB and 25 megapixels.` |
| `too_small` | 422 | `That picture is too small for a cover. It needs to be at least 600 by 314 pixels.` |
| `not_a_picture` | 422 | `That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.` |
| `rate_limited` | 429 | `You’ve tried a lot of pictures in a short time. Try again in an hour.` |
| `image_failed` | 502 | `Radar couldn’t save that picture. Your cover is unchanged. Try again.` |
| `article_changed` | 409 | `The cover changed while Radar was fetching the picture. Try again.` |

Unchanged and reachable: `article_locked`, `publication_pending`, `article_busy`, not found, forbidden.

### 7.3 Switching back: `article.regenerateImage`, no new action

When `realCoverOf(a.img)` is not null, the existing action is the switch back. Input and return value are unchanged. Differences:

- the generated cover replaces the picture: the save goes through the existing path, which now also removes `real` (extend `withoutPlaceholder` to drop both), and adds `noReal: true`;
- the direction is chosen as today: the owner's typed direction as written, otherwise the contextual one from `resolveImageDirections`;
- strictness as today (`modelStyle || pressed`): a model style never answers with the template, and on failure the real picture is kept with the existing error. With Branded graphic or Infographic selected the result is that template, because that is the style the person has chosen;
- alt: when directions were resolved, `directions.cover.alt` (existing). Otherwise, unless the alt is the owner's, the neutral `fallbackImageDirections(…).cover.alt` (the existing `neutralAlt`), so a generated cover is not left with a bare name.

Consequence for an old browser bundle: its Regenerate and Generate from prompt buttons on a real cover do the same thing. That is an explicit request by a person and is accepted.

## 8. Q8: Media panel

`src/features/article/ArticleWorkspace.tsx` only, plus the hint function in `autosave.ts`. Existing components and class names.

New local state: `siteUrl` (string), `siteError` (string), both cleared when `id` changes. `const real = heroUrl ? realCoverOf(A.img) : null;`

Order in the Media tab: heading · preview · **real-picture notice** or placeholder notice (never both) · Style · Describe your image · Alt text · button row · `imageError` · **the new field and button** · brand colours line · body images · videos.

**Real-picture notice** (under the preview, same structure as the placeholder notice):

```tsx
{real && <div className="col" style={{ gap: 8, minWidth: 0 }}>
  <div role="status" className="col" style={{ gap: 6, minWidth: 0 }}>
    <Status tone="ok">Picture from your site</Status>
    <span className="xs" style={{ overflowWrap: 'anywhere' }}>{text} Source: <a href={source} target="_blank" rel="noopener noreferrer">{source.replace(/^https?:\/\/(www\.)?/, '')}</a>.{tail}</span>
  </div>
  {!mediaLocked && B.role !== 'Viewer' && <Btn size="sm" icon="wand" loading={imgBusy} disabled={!canEdit || imgBusy} onClick={() => generateCover()}>Use a generated cover instead</Btn>}
</div>}
```

- `source = real.page || real.src`; the link is rendered only when it starts with `https://`.
- `text`: `real.by === 'radar'` → `Radar found this picture${real.subject ? ' of ' + real.subject : ''} on your site and used it as the cover.` Otherwise `This cover is a picture from your site.`
- `tail`: editable → ` If it isn’t yours to publish, use a generated cover instead.` Viewer → ` An owner or editor can change it.` Locked → nothing.
- The button calls the existing `generateCover()`; its success toast stays `Cover image generated`, its errors stay as they are, and the picture is kept when generation fails.

**While the cover is real:**

- Style: enabled as now. `Field` gets `hint="Used for body images, and for the cover if you switch to a generated one."`
- Describe your image: enabled as now. `coverDirectionHint(generated, real)` returns, when real: `Not used while your cover is a picture from your site. It describes the generated cover you’d get instead, and your own wording also guides body images.`
- Alt text: unchanged.
- Button row: `Generate from prompt` and `Regenerate` are not rendered; `Download` stays.

**The field** (shown whether or not the cover is real, so a picture can be replaced by another):

```tsx
<Field label="Use a picture from your site" hint={`Paste the address of a page or a picture on ${B.profile.domain}. Radar crops it to fit and keeps a copy. Only use pictures you have the right to publish.`}>
  <input className="input" type="url" inputMode="url" maxLength={2000} placeholder={`https://${B.profile.domain}/…`} value={siteUrl} disabled={!canEdit || imgBusy}
    onChange={ev => { setSiteUrl(ev.target.value); setSiteError(''); }} onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); useSitePicture(); } }} />
</Field>
<div className="row" style={{ flexWrap: 'wrap', gap: 8 }}><Btn icon="globe" loading={imgBusy && !!siteUrl.trim()} disabled={!canEdit || imgBusy || !siteUrl.trim()} onClick={useSitePicture}>Use this picture</Btn></div>
{siteError && <span className="xs" role="status" style={{ color: 'var(--bad)' }}>{siteError}</span>}
```

```ts
const useSitePicture = async () => {
  const url = siteUrl.trim(); if (!url || !canEdit || imgBusy) return;
  setImgBusy(true); setSiteError(''); setImageError('');
  try { await app.flushLater(); await app.act('article.useSitePicture', { entryId: id, url }, { silent: true }); art.reload(); setSiteUrl(''); toast('Cover set to the picture from your site'); }
  catch (error: any) { setSiteError(error?.message || 'Radar couldn’t use that picture. Your cover is unchanged. Try again.'); }
  finally { setImgBusy(false); }
};
```

- Busy: `imgBusy` dims the preview and shows its spinner (existing behaviour of `Visual`), the button shows its spinner, the other cover controls are disabled.
- Errors: the server's message, inline under the button; `silent` so it is not also a toast.
- Viewer and locked: the input and button are disabled through `canEdit`, like Style and the text fields; the notice shows without its button.
- Mobile: the input is a full-width block and the button is on its own row, like the existing button row; the source address wraps (`overflowWrap: 'anywhere'`). Nothing scrolls sideways at 390 px.

No change to `articleSync.ts`: `art.reload()` is the existing path after a cover action.

## 9. Q9: reference images for body images (AC9): out

Verified today:

- `POST /api/v1/images` accepts `input_references`: an array of at most 16 `{ "type": "image_url", "image_url": { "url": … } }`, each a base64 data URL or an HTTP(S) URL (API reference and guide).
- `GET /api/v1/images/models/google/gemini-nano-banana-2.1/endpoints` now lists two endpoints, Google Vertex and Google AI Studio; both have `"input_references": { "type": "range", "min": 0, "max": 14 }` and `n` max 1; the only price line on each is `output_image` per token. The guide names an `input_reference` billable type that this model's record does not list.
- Not stated anywhere I read: accepted input formats, a size limit, what happens when a model or provider does not support the field, whether references are retained.

Why out:

1. **Nobody has seen the result.** A section direction says "a shared kitchen inside the building"; the reference is the exterior. The model may redraw the exterior three times. PR 54's rule, and the owner's sentence in the brief, is that each picture fits its own part of the post. Finding out needs paid calls, which were not in my remit.
2. **Body images are strict.** If a provider or a model set through `OPENROUTER_IMAGE_MODEL` rejects the field, the request fails, and one failed body image removes the whole set from the draft.
3. **Failover is uneven.** OpenAI and xAI take references only on their edits endpoints. A set could mix referenced and unreferenced pictures.
4. **Rights.** It sends a picture whose ownership the owner has not confirmed to a model provider and publishes pictures derived from it. The image call also does not set `data_collection: 'deny'` as the text calls do.

The change, if the PM takes it later (after one test call with a real cover): `ImageReq.references?: string[]`; `openrouterImage(prompt, w, h, refs?)` builds `{ model, prompt, aspect_ratio, n: 1, ...(refs?.length ? { input_references: refs.slice(0, 1).map(url => ({ type: 'image_url', image_url: { url } })) } : {}) }`; `generatePhotoRaw` passes `r.references` to the OpenRouter route only; `generateArticleBodyImages` sets it when `realCoverOf(a.img)` is not null and the section direction contains the subject's name, using `img.url` when it is `https://…` and otherwise a data URL of a JPEG re-encode (about 290 KB as base64 against about 1.9 MB for the PNG). With no references the body has no new key, so the exact-match assertion at `openrouter.qa.test.ts:514` and the golden snapshot do not change. It should not be extended to generated covers: after a switch back there is no real picture left to refer to, and keeping one for that purpose is new state and new interface.

## 10. Q10: dev stubs and QA

`src/server/services/analysis/devsite.ts`:

```ts
export const DEV_PLACES = [
  { slug: 'harbour-house', name: 'Harbour House', picture: true },
  { slug: 'harbour-house-annex', name: 'Harbour House Annex', picture: true },
  { slug: 'mill-lane-studios', name: 'Mill Lane Studios', picture: false },
] as const;
```

`devFetch` additions, for every stub domain:

- `/places/{slug}`: a normal page (same head as other pages, so `og:image` is the site-wide `/og.png`), title `{name} — {business}`, h1 `{name}`. With `picture: true` the `<main>` also has `<img src="/media/{slug}.png" alt="{name} · photo 1" width="1600" height="900">` and a JSON-LD block `{"@context":"https://schema.org","@type":"Place","name":"{name}","image":"https://{domain}/media/{slug}.png"}`.
- `/sitemap.xml` also lists the three place pages. They are **not** added to `p.pages`, so navigation and the "related" lists do not change. The stub crawl will read three more pages.
- `/media/{slug}.png`: a 1600×900 PNG drawn with `@napi-rs/canvas` in the business's two colours (a gradient and a few rectangles, no text), `image/png`.
- `/media/portrait.png`: 800×1200, for the backdrop fit. `/media/tiny.png`: 300×200 (`too_small`). `/media/too-large.png`: 9 MB of bytes with a PNG signature (`too_large`). `/media/broken.png`: the first third of a valid PNG (`not_a_picture`). `/media/page.png`: HTML with type `text/html` (`no_picture`).
- `/og.png` is left as it is (not served). The home-page comparison compares addresses and never fetches the default card, and the stub logo detection in `brand.ts` reads `og:image` as its last candidate, so serving it could change stub onboarding.

`src/server/services/drafting/stubs.ts`, `article.imageDirections`: when the title contains a `DEV_PLACES` name (longest first, case-insensitive) the stub returns `subject: name, subjectKind: 'building'`; otherwise as today. `cleanImageDirections` keeps it because the title names it.

What QA can do offline (`RADAR_DEV_STUBS=1`, any stub domain, default style Branded graphic):

1. Owner action with `https://{domain}/places/harbour-house` → real cover, notice with the page as source. With `/media/harbour-house.png` → real cover, the picture as source. With `/media/portrait.png` → backdrop fit.
2. Each error: `https://example.org/a.png` (not your site), `/places/mill-lane-studios` (no picture: only the site default), `/media/tiny.png`, `/media/too-large.png`, `/media/broken.png`, an address on an `…unreachable…` business (couldn’t reach).
3. "Use a generated cover instead" with Branded graphic → the template returns at once and the notice goes. With Illustration → the existing "unavailable" error, and the picture is kept.
4. Automatic: an entry titled "Living at Harbour House: what to expect", Draft now → the cover is the Harbour House picture, "Radar found this picture of Harbour House…". Titled "… Mill Lane Studios …" → generated cover and `realCoverMiss` on the article. Then switch back on the first, Rewrite from brief → the picture does not return.
5. Viewer and scheduled states; 390 px width.

## 11. Q11: tests

The guard needs no network: `vi.stubGlobal('fetch', fetchMock)` returning `Response` objects, as `crawl.test.ts` does. A redirect is `new Response(null, { status: 302, headers: { location } })`; a declared oversize is a `content-length` header; a streamed oversize is a `ReadableStream` that keeps enqueuing 1 MB chunks, with an assertion that it was cancelled. Each test asserts `fetchMock.mock.calls[i][1].redirect === 'manual'` and that `dispatcher` is `publicDispatcher()`; the DNS half (a public name resolving to a private address) is already covered by `publicNetwork.test.ts`.

New:

| File | Covers | AC |
|---|---|---|
| `src/lib/ownSite.test.ts` | the whole table in §2, with and without `base` | AC2 |
| `src/server/services/realCover/fetch.test.ts` | IP-literal internal address refused with no request; redirect to an internal address refused after one request; redirect off the domain → `left_site`, the second host never requested; redirect to `http` is fetched as `https`; 4 redirects → `unreachable`; 404 and 500 → `unreachable`; declared oversize → `too_large` with no body read; streamed oversize → `too_large` and the stream cancelled; `truncate` returns the first bytes; abort → `unreachable`; request counter; headers contain no cookie, authorization or referer; stub mode calls no `fetch` | AC2, AC3 |
| `src/server/services/realCover/picture.test.ts` | `probeImage` on PNG, JPEG and all three WebP chunk kinds made in the test; SVG, GIF, AVIF, HTML → null; truncated JPEG, PNG and WebP → `complete: false`; `readPicture`: `text/html` or `image/svg+xml` header → `not_a_picture`; SVG bytes under an `image/png` header → `not_a_picture`; truncated → `not_a_picture`; 10,000×10,000 header → `too_large` **without `loadImage` being called** (spy); 300×200 → `too_small`; EXIF-rotated 700×400 JPEG stored as 400×700 passes the minimum after rotation; output is a 1200×628 PNG; 1600×900 → `crop`, 800×1200 and 900×900 → `backdrop`; a transparent PNG has no transparent pixel in the output | AC3 |
| `src/server/services/realCover/page.test.ts` | `nameTokens` (digits kept, accents, `&`, full-width, Arabic); title lead; generic JSON-LD types ignored; `srcset` choice (smallest ≥ 1200, else largest), `<picture>` sources, lazy attributes, `data:` src; header/nav/footer images skipped; small declared sizes skipped; file-name words skipped; off-site hosts recorded; `article` and `listing`; `subjectPictures` and `ownerPictures` order; every row of §4.4. Fixtures are reduced copies of the two lived.ae pages with invented media ids | AC5 |
| `src/server/services/realCover/index.test.ts` (`fetchOwn` mocked) | automatic: exact match → picture; each §4.4 case → null; two candidates at most; share image equal to the home page's → not taken, and not taken when the home page fails; robots-disallowed page skipped; C1 from `crawl_pages` without a sitemap request; `searched` true and false as defined; never throws; request and time budget. Owner: picture address is not parsed; page address tries two; the three end states (`off_site_picture`, the single candidate's error, `no_picture`) | AC1, AC5 |
| `src/server/services/drafting/draft.realCover.test.ts` (mocks as `draft.images.test.ts`) | found → `img.real.by === 'radar'`, `urlKey`, alt is the subject, **no `renderImageFile` call for the cover**, `realCoverMiss` absent; not found and searched → generated cover and `realCoverMiss`; not searched → no miss; fresh miss → no search; owner direction, `modelRequired`, `noReal`, kind `organisation`, fallback directions → no search; rewrite with a real cover (both `by`) → kept, no search, no render, Radar's direction refreshed; storage failure after a find → generated cover, draft completes; the search throwing → draft completes | AC4, AC5, AC6 |
| `src/server/actions/realCover.db.test.ts` (real Postgres, `pictureFromAddress` and storage mocked) | Viewer refused (route-level role); another business's entry → not found; scheduled, publishing, published, `failed` with a remote draft, and an active draft or body-image job → refused **with `pictureFromAddress` never called**; off-domain address → `not_your_site`, never called; success writes `real`, `url`, `urlKey`, alt; an owner's alt is kept; conflict when the cover changed during the fetch; a direction typed during the fetch is not a conflict; the 31st call in an hour → 429; `article.save` cannot set `real`, `noReal` or `realCoverMiss`; a style change on a real cover makes no render and moves `urlKey`; `article.regenerateImage` on a real cover removes `real`, sets `noReal`, and on a failed generation keeps the picture; a record whose `url` differs from `img.url` is ignored; publishing an article with a real cover builds a payload whose `image.url` is the stored file, `image.alt` the new alt, and `bytes()` type `image/png`; an article with none of the new fields loads, saves and builds the same payload as before | AC1, AC4, AC6, AC8 |

Extended:

- `src/lib/articleImages.test.ts`: `realCoverOf` (absent, matching, stale URL); `withRealCover` (sets `urlKey`, removes `placeholder`, respects `altBy`); `withCover` removes `real`.
- `src/features/article/autosave.test.ts`: `coverDirectionHint(generated, real)`; the existing "forged" case also tries `real` and `noReal`.
- `src/server/services/drafting/imageDirections.test.ts`: the stub returns a subject for a `DEV_PLACES` title and none otherwise, and still passes validation untouched.
- `src/server/services/analysis/crawl.test.ts` or a small `devsite.test.ts`: the place pages, the pictures and the extra sitemap entries (AC10).

Existing tests that must change:

| Test | Change | Because |
|---|---|---|
| `src/server/services/drafting/draft.images.test.ts` | add `vi.mock('../realCover', () => ({ findSubjectPicture: vi.fn(async () => ({ picture: null, searched: false })), storeRealCover: vi.fn() }))`; no expectation changes | its scripted direction answer has `subject: 'Wasl 611', subjectKind: 'building'` and domain `lived.test`, so every draft in the file would start a real search (a DNS lookup from a unit test) |

Checked and unchanged: `openrouter.qa.test.ts` (no request body changes; AC9 is out); `draft.test.ts` and `bodyImages.db.test.ts` (no subject in their direction answers, so no search runs); the whole-draft tests that use the stub adapter (`writingInstructions.db.test.ts`, `lighterSaves.db.test.ts`, `spendRecords.db.test.ts`): the stub names a subject only for a title containing a `DEV_PLACES` name, and no test title does (grep for "Harbour House" and "Mill Lane" found nothing). The engineer should still run the full suite and compare with the known failures on `main`.

AC11's "real browser" item is QA's, by §10. AC7's copy is checked there too.

## 12. Q12: rollout

- No environment variable, no SQL migration, no new dependency (`cheerio`, `robots-parser`, `undici`, `@napi-rs/canvas` are already used).
- **Old worker, new web.** A draft on the old worker spreads the stored article, so `real`, `noReal` and `realCoverMiss` survive. If it re-renders a cover that was real (possible only for an article whose direction is not yet Radar's), `img.url` changes and the record stops applying; the client shows a generated cover with no notice. Correct.
- **Old web, new worker.** The old `article.save` restyle re-renders a real cover; same outcome. The old `regenerateImage` replaces it without setting `noReal`, so the next rewrite may find the picture again. Harmless, minutes long.
- **Old browser bundle.** Shows the picture (`urlKey` matches). No notice, no field. Its Regenerate and Generate from prompt switch back (§7.3). Its style select no longer re-renders a real cover; it reloads and shows the same picture.
- **Revert.** Old code ignores the three fields and treats the stored picture as a cover whose style and seed match. It keeps publishing it. A later style change or Regenerate replaces it. No data repair. After a re-deploy the stale-URL rule sorts out whatever the old code did.
- **Jobs in flight** at deploy are retried by the existing lock expiry; nothing new.
- **After deploy.** New drafts and rewrites of articles with a building, place or product subject make up to 12 requests to the business's own site. Businesses whose pictures are on another host see no change except the new field, which will tell them why.
- **The owner must do nothing** to deploy. They should be told the four points at the top of this record, and that lived.ae's Wasl 611 photo is currently broken on their own site.
- Docs to update with the code: `docs/CONTRACTS.md` (the article media lines near 28–32; line 202, which today says no web-photo retrieval is implied; the new action) and `DIVERGENCES.md` (lines 120–121).

## 13. Work packages

**Step 0, first commit (server engineer), so the client can build:** `src/lib/types.ts` (§5), `realCoverOf`, `withRealCover` and the `withCover` change in `src/lib/articleImages.ts`, `src/lib/ownSite.ts`, with their unit tests. `coverDirectionHint`'s new parameter is the client's.

**Server package**

| Order | File | Change |
|---|---|---|
| 1 | `src/lib/types.ts`, `src/lib/articleImages.ts`, `src/lib/ownSite.ts` (new) | step 0 |
| 2 | `src/server/services/analysis/crawl.ts` | export `ARTICLE_PATH`, `LISTING_PATH`, `uaToken`; nothing else |
| 3 | `src/server/services/realCover/fetch.ts` (new) | `fetchOwn`, `SitePictureError`, `ACCEPT` |
| 4 | `src/server/services/realCover/picture.ts` (new) | `probeImage`, `readPicture`, constants, draw rule |
| 5 | `src/server/services/realCover/page.ts` (new) | `nameTokens`, `readPage`, `shareImages`, `subjectPictures`, `ownerPictures` |
| 6 | `src/server/services/realCover/index.ts` (new) | `pictureFromAddress`, `findSubjectPicture`, `storeRealCover`, `realCoverKey` |
| 7 | `src/server/services/analysis/devsite.ts`, `src/server/services/drafting/stubs.ts` | §10 |
| 8 | `src/server/services/drafting/draft.ts` | §4.1, §5 |
| 9 | `src/server/actions/article.ts` | `article.useSitePicture`; `save` restyle rule; `regenerateImage` switch back |
| 10 | tests (§11), `docs/CONTRACTS.md`, `DIVERGENCES.md` | |

Not touched: `images.ts`, `storage.ts`, `publisher.ts`, every connector, `bodyImages.ts`, `jobs.ts`, `imageDirections.ts`, `schema.ts`, `publicNetwork.ts`.

**Client package** (needs only step 0)

| File | Change |
|---|---|
| `src/features/article/ArticleWorkspace.tsx` | §8 |
| `src/features/article/autosave.ts` and its test | `coverDirectionHint(generated, real)` |

## 14. Risks, and acceptance criteria that should change

Acceptance criteria that are wrong or cannot be met as written:

- **AC3, "requires an `image/*` content type … decodes the bytes".** Neither is enough. `loadImage` renders SVG and returns a blank or partial picture for a truncated file. Reword: the header must name JPEG, PNG or WebP, the bytes must be one of those three and complete, and the pixel size is checked from the file header before decoding. GIF, AVIF, BMP, animated WebP and a picture served as `application/octet-stream` are refused.
- **AC2, ports and http.** As designed: every explicit non-default port is refused, and `http` is upgraded to `https`, never fetched.
- **AC5, "a site-wide default share image is never taken".** Radar recognises it by comparing with the home page's share image and by file-name words. A site with a different default card per section would get past both. Reword to "a share image equal to the home page's is never taken".
- **AC5, scope.** Automatic matching is limited to subjects of kind `building`, `place` and `product`. Add it.
- **AC6, "never replaced by a template".** True for every automatic path. When a person clicks "Use a generated cover instead" with Branded graphic or Infographic selected, they get that template, as chosen. Say "never automatically".
- **AC7.** While the cover is real, Regenerate and Generate from prompt are not shown; "Use a generated cover instead" is the one way back. State it, since the AC says the existing controls "keep working".
- **AC9.** Recommended out (§9).
- **AC1.** "Owner or Editor" includes Admin. A rate limit of 30 an hour per business is added.

Risks:

1. **Rights.** A picture on the business's site is not shown to be the business's picture, the domain itself is unverified, and Autopilot publishes without review. Mitigations in the design: own domain only, source always shown, one click back, a line in the hint and in the notice.
2. **The reported case is not fixed today** (lived.ae's photo is down).
3. **Coverage.** Sites that keep pictures on another host get nothing automatic. Strict name equality will miss pages titled a little differently.
4. **A wrong picture can still happen** when a site's page for the subject shows a picture of something else under an alt text that contains the subject's name, or lists the wrong `image` in its structured data. The rule trusts the site about its own subject page.
5. **Memory.** Up to about 100 MB for one decode in the web process; serialised, not pooled across processes.
6. **File size.** A real cover is a PNG of about 1.4 MB, like generated photography covers.
7. **Portrait pictures** get the backdrop treatment, which is a visible style choice nobody has approved.
8. The entered address is recorded by `trackSoon('action.article.useSitePicture')` like every action input. An address with credentials in it is refused but still recorded.
9. The stub crawl reads three more pages per domain.

Decisions needed:

- **Owner:** (a) whether automatic pictures should also apply to articles Autopilot publishes unseen; (b) acknowledge that "own domain" is unverified and is the only proxy for rights; (c) the lived.ae photo.
- **PM:** (d) the backdrop fit for portrait and square pictures, or plain centre crop, or refusing such pictures on the automatic path; (e) AC9 out; (f) automatic limited to building, place and product; (g) PNG rather than JPEG; (h) Regenerate on a real cover acting as the switch back and setting `noReal`; (i) the 30-an-hour limit; (j) the acceptance-criteria rewordings above.

## 15. Not verified

- Production: `crawl_pages` contents (whether any subject page is already crawled), environment values, logs. No access was used.
- OpenRouter beyond its documents: no call was made. Reference fidelity, input formats and limits, cost of a reference, and behaviour on an unsupporting model are unknown.
- Who owns the photographs on lived.ae, and why the Wasl 611 file is unavailable.
- The share of businesses whose pictures are on another host (§2 is an estimate from general knowledge of the platforms).
- `@napi-rs/canvas` on the production platform (Linux): the checks ran on darwin arm64 with the same package version. The library is already used there for generated covers, but the WebP, EXIF and blur results should be confirmed by the unit tests in CI.
- `ACCEPT.picture` was checked against one server (the Next.js optimiser on lived.ae). `ACCEPT.any` was not sent to any server.
- Whether undici raises an error on a body shorter than its `content-length`; the completeness check does not rely on it.
- Wix's handling of a file name whose extension differs from the content (the reason for staying with PNG) is from reading the connector, not from a call.
- Whether any browser test depends on the number of pages the stub crawl reads.
- Typecheck and the test suite were not run; this is a design.

## 16. Sources (read or run 2026-11-13)

- Run locally: `@napi-rs/canvas` 0.1.100 decode, crop, blur, EXIF and large-header checks; prototypes of `probeImage`, `ownSiteUrl`, `nameTokens` and the slug and name rules.
- lived.ae, generic user agent, read only: `/`, `/property/wasl-611-al-warsan`, `/property/princess-tower-dubai-marina`, `/robots.txt`, `/sitemap.xml` (1,947 addresses, one file, 340,738 bytes); `/api/media/2ror5bb4jic.jpg?bucket=properties` (200, JPEG, 740×1110, no `content-length`) and its `/_next/image` forms; `/api/media/844vd3lj6xg.webp?bucket=properties&v=legacy` (502, three tries); `/lived-social-preview.png` (200, 796,916 bytes). The two downloaded pictures are in a scratch directory outside the repository.
- Public WebP sample files: `https://www.gstatic.com/webp/gallery/1.webp`, `…/gallery3/1_webp_ll.webp`, `…/gallery3/1_webp_a.webp`, `…/animated/1.webp`.
- OpenRouter, Generate an image (API reference): https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md
- OpenRouter, image generation guide: https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md
- OpenRouter, endpoints for the default image model: https://openrouter.ai/api/v1/images/models/google/gemini-nano-banana-2.1/endpoints
