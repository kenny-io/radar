# Contextual article images: architecture (T1)

Architect record, 2026-11-12. Design only; no source file was edited and no test was run.

Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-contextual-images-6eb35c`, branch `kenny-dev/radar-contextual-images-6eb35c`, HEAD `4f1bcf83` (= origin/main), clean apart from `.factory/contextual-article-images/`. No `AGENTS.md` or `CLAUDE.md` in the repository; `ARCHITECTURE.md`, `docs/CONTRACTS.md`, `DIVERGENCES.md` and the earlier `.factory` records apply.

Read: `brief.md`; `.factory/article-body-images/architecture.md`; `.factory/suggestion-prompts-custom-images/architecture.md`; `.factory/daily-social-drafts/image-prompt-prefill.md`; `.factory/ai-cost-reduction/{brief,architecture}.md`; `src/server/services/images.ts`; `src/server/services/drafting/{draft,bodyImages,jobs,guard,stubs}.ts`; `src/lib/{articleImages,types,visual}.ts`; `src/server/actions/article.ts`; `src/server/services/publishing/publisher.ts`; `src/server/ai/{index,tiers,record}.ts`; `src/server/ai/adapters/{stub,openrouter}.ts`; `src/server/http/publicNetwork.ts`; `src/server/services/analysis/crawl.ts`; `src/features/article/{ArticleWorkspace,BodyImage}.tsx`; `src/client/articleSync.ts`; the image and drafting tests.

## 0. Decisions in one screen

| Q | Decision |
|---|---|
| Q1 | A separate purpose `article.imageDirections` on the utility tier, one `ai.run` per draft, run after the body is final and before `article.meta`. Not merged into `article.meta`. Slot-by-slot validation with a deterministic fallback; the function never throws. |
| Q2 | `ImageReq.literal?: boolean` selects a second prompt wrapper in `imagePrompt`. Without it the prompt is today's, byte for byte (social, brief, owner-typed covers). Two style texts get a literal variant (`editorial`, `render3d`). |
| Q3 | **(a) description only, now.** (b) and (c) are not safely achievable in this change. Smallest follow-up: an owner-chosen picture from their own domain as the cover. Evidence in §3. |
| Q4 | New optional JSON fields: `img.promptBy`, `img.altBy`, `img.placeholder`, `Article.imageDirections`, `Article.bodyImagesIssue`. `ArticleBodyImage` is unchanged. Legacy default recognised by exact equality with `'Calm, editorial image about ' + entry.kw`. |
| Q5 | `renderImageFile` returns an extra optional `placeholder` reason. Body images are always strict (`modelRequired: true`), never a template. In a draft any body-image failure omits the whole set and records `bodyImagesIssue`; the explicit job still fails and keeps the old set. The publisher publishes a placeholder cover and an empty body-image list as they are. |
| Q6 | Directions are cached on the article under a hash of title, body and length. Cover Regenerate and the body-image job reuse the cache; a miss runs the step (20 s budget in the action, 90 s in jobs). Cover Regenerate on a model style becomes strict: it never answers with the template. |
| Q7 | Exact strings in §7. |
| Q8 | Tests in §8, with the existing expectations that change. |
| Q9 | No environment variable, no migration. Additive JSON; mixed web/worker versions and a revert are safe. §9. |

Things the PM should know before reading further:

1. **OpenAI's `gpt-image-1` was shut down on 2026-10-23** (OpenAI deprecations page and the Create image reference, read today). It is Radar's default for the OpenAI image route (`images.ts:77` and `:126`, `.env.example:53`, `DIVERGENCES.md:29`). Unless `OPENAI_IMAGE_MODEL` is set in Railway (I did not and could not check), adding OpenAI credit alone will not bring that route back. Not in this task's scope; see §11.
2. Until a route has credit, production after this ships makes **no body images** and a **flagged title-card cover** for model styles, where today it makes template images silently. Autopilot will publish articles in that state. This is PM decisions 2 and 3 working as designed; the owner should hear it in those words.
3. Dev stubs have no image model, so stub-mode drafts will no longer contain body images (§5.4).

## 1. Q1: the image-direction step

### 1.1 Placement and why it is its own purpose

In `draftArticle` (`draft.ts`), after the destat block (body is final, around line 146) and **before** the `article.meta` block. Not merged into `article.meta`, for three reasons found in the code:

- `article.meta` is skipped on most rewrites (`keepSeo` is true once `a.generated`, and `alt` is already set: `draft.ts:149-152`). Directions are needed on every draft and rewrite.
- The same step must run outside drafting, for cover Regenerate and the body-image job on older articles (AC8). A reusable function with one purpose name is simpler than a meta call with two shapes.
- Its failure mode differs: it has a deterministic fallback and must never fail a draft. `MetaOut`, its stub and UT-4 stay untouched.

Sequential, not parallel with meta (the draft job is a background job; a few seconds do not matter).

### 1.2 The call

New file `src/server/services/drafting/imageDirections.ts`.

```ts
ai.run('writing', {
  purpose: 'article.imageDirections',          // keep this literal in the source: tiers.test.ts greps for it
  schema: DirectionsOut, schemaName: 'directions', maxTokens: 900, temperature: 0.2, timeoutMs: 30_000,
  system: SYSTEM, prompt: directionsPrompt(...),
  stubContext: { title, kw, plans },
}, { businessId: bid, retries: 0 })
```

- Tier: add `'article.imageDirections': 'utility'` to `PURPOSE_TIER` (`tiers.ts:22`). `ai_calls` rows are written by `ai.run` itself: `task: 'utility'`, `purpose: 'article.imageDirections'`, model, provider, tokens, cost; failed attempts get their own rows and go through `reportFailure` as for every other purpose. Nothing else to record. The cost-reduction brief's UT-1 ("no other purpose joins it") is superseded by PM decision 1.
- `maxTokens: 900`: the utility boost raises it to 2,048 anyway (`UTILITY_MIN_TOKENS`). Expected output about 600 tokens; input about 3,500 tokens for a 1,400-word article. At Haiku 5.5 prices in `prices.ts` ($0.10 in, $0.50 out per million) that is well under $0.001 per draft.
- `retries: 0`: one attempt per route. Provider failover inside `ai.run` is kept (a failed route can still be followed by another billed attempt, as for every purpose). No `instructions` (this is not reader-facing writing).
- "At most one extra text call per draft" holds as one `ai.run`. With `RADAR_AI_TIERS=off` the purpose runs on the business's writing model, like the other six utility purposes.
- `ai.run` cannot be cancelled. The wrapper races it against a budget (§1.6); a call that loses the race may still finish and write its row.

### 1.3 Output schema

No nullable object (no existing AI output schema uses one; a flat pair avoids structured-output differences between providers).

```ts
export const DirectionsOut = z.object({
  subject: z.string().max(120),               // '' when the article is not about one named real-world thing
  subjectKind: z.enum(['none', 'building', 'place', 'product', 'organisation', 'other']),
  cover: z.object({ direction: z.string().max(400), alt: z.string().max(200) }),
  sections: z.array(z.object({ i: z.number().int(), direction: z.string().max(400), alt: z.string().max(200) })).max(3),
});
```

No minimum lengths in the schema: a short or missing slot is repaired by the validator instead of failing the whole call.

### 1.4 What it is given, and the prompt text

Input: business name, industry and markets (three short lines, not the whole `profileContext`); title; keyword; type; the article body as text (`## ` for h2, `### ` for h3, lists joined), capped at 12,000 characters; the planned sections from `planArticleBodyImages(body, words)` as `Section i: heading` plus that plan's `context` capped at 500 characters; the article's language; and, when the owner wrote the cover direction, that text. Sources are not sent: the body was already checked against them, so "only what the article states" is the stricter of the two readings of AC2.

System:

> You are Radar's picture editor. You read a finished blog article and say what its cover picture and each section picture should literally show, so an illustrator who has not read the article can draw them. You use only details the article states. You never invent what something looks like.

Prompt (fields in braces are filled in):

```
Business: {name} ({industry}). Markets: {markets}.
Article title: {title}
Primary keyword: {kw}
Type: {type}
{only when the owner wrote the cover direction:}
The owner has chosen this cover: {owner direction}. Do not change it. Section pictures must be different scenes that fit with it.

ARTICLE
{body text}

PICTURES NEEDED
Cover: the picture at the top of the article.
Section 0: {heading} — {context}
Section 1: {heading} — {context}
...

Return:
- subject and subjectKind: if the whole article is about ONE specific real-world thing with a proper name (a named building or development, a place, a product, an organisation), give its name exactly as the article writes it, and its kind. Otherwise subject is "" and subjectKind is "none". A person is never the subject.
- cover: direction and alt.
- sections: one entry per section listed above, with its number as i.

RULES FOR EVERY DIRECTION
1. One or two plain sentences in English, at most 300 characters, describing one scene that could be photographed or drawn: the main thing shown, where it is, and one or two visible details.
2. Literal, never symbolic. No metaphors, abstract shapes, icons, collages or split screens.
3. Use only what the article states. Do not invent colours, materials, floor counts, views, surroundings or weather. Where the article gives no visual detail, stay generic ("a low-rise residential building") rather than guessing.
4. If there is a subject, the cover shows the subject itself and names it. For a building or development: its exterior in its setting, with its type and location as the article gives them, and only the physical facts the article states (for example how many buildings, a gated entrance, low-rise or high-rise).
5. Each section picture shows something specific to that section and to this article's subject. It is a clearly different scene from the cover and from the other sections: a different thing shown, or a different place or viewpoint.
6. Nothing that needs writing to make sense: no signs with wording, captions, labels, charts, graphs, screenshots, readable documents, logos or brand marks. Do not mention text at all.
7. No real, identifiable person. People, if any, are anonymous and incidental.
8. Do not name an art style, colours or mood. Those are added later.

RULES FOR ALT TEXT
One plain sentence in {language}, at most 140 characters, saying what the picture shows, beginning with the words for "Illustration of" in that language. If there is a subject, the cover alt names it.
```

Expected cover for the reported article, as an illustration of the intent (the facts must come from the article, see §3.2): "The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, Dubai, seen from outside the entrance gate in daylight."

### 1.5 Validation (`cleanImageDirections`, pure, exported)

Each slot (cover, each planned section) is checked on its own. A slot that fails is replaced by its deterministic fallback (§1.7); the others are kept.

1. Normalise whitespace; map `sections[].i` to plan index; ignore entries whose `i` is out of range or repeated; a planned section with no entry fails.
2. A direction fails when any of these is true:
   - fewer than 25 characters;
   - it asks for writing or a diagram: `/\b(captions?|labels?|lettering|typograph\w*|headlines?|logos?|watermarks?|infographics?|charts?|graphs?|diagrams?|screenshots?|speech bubbles?)\b|\b(text|words?|numbers?|signs?|banners?)\s+(reading|saying|that (says?|reads?)|with the (text|words?))\b|["“][^"”]{2,}["”]/i`;
   - it is symbolic: `/\b(metaphor\w*|symboli[sz]\w*|abstract|conceptual)\b/i`;
   - it contains a number that the article does not: every `\d[\d.,]*` token (commas removed) must occur in the title or body text. This is the mechanical part of "no detail the article does not state";
   - it is a near-duplicate of an earlier accepted slot (cover first, then sections in order): Jaccard similarity of the two token sets is 0.6 or more, using `tokens()` from `src/server/services/calendar/research.ts`.
3. Subject: kept only when `subjectKind !== 'none'`, `subject` is non-empty, and the name occurs (case-insensitive, whitespace-normalised) in the title or the body. Otherwise `null`.
4. With a subject: if the cover direction does not contain the name, append ` The subject shown is {name}.`; if the cover alt does not contain the name, the alt becomes `Illustration of {name}`.
5. An alt shorter than 8 characters is replaced by the fallback alt. Alts are cut with `fit(…, 200)`.

What this cannot do: prove that every adjective in a direction is stated by the article. See §11, AC2.

### 1.6 The wrapper

```ts
/** Directions for this article's cover and planned body images. Reuses the article's cached set when it was made by
 *  the AI step from the same title, body and length. Never throws: on failure, timeout or an unusable answer it
 *  returns directions built from the title, headings and section text. */
export async function resolveImageDirections(
  bid: string, profile: Profile, e: Pick<CalendarEntry, 'title' | 'kw' | 'type'>,
  a: Pick<Article, 'body' | 'brief' | 'img' | 'imageDirections'>,
  o: { budgetMs?: number; fresh?: boolean } = {},
): Promise<ArticleImageDirections>

export function directionsKey(title: string, body: Block[], words: number): string
// sha256 of JSON.stringify([1, title, words, body]), first 24 hex characters. The leading 1 is a version: bump it when the prompt changes.
```

- Cache hit: `!o.fresh && a.imageDirections?.key === key && a.imageDirections.source === 'ai' && a.imageDirections.sections.length === plans.length`. A `fallback` set is never reused, so the AI step is tried again next time.
- `budgetMs` default 90,000. `Promise.race` against the budget; a loss, a thrown `RadarError`, or a parse problem all return `{ ...fallbackImageDirections(...), key, source: 'fallback', at }`.
- The file does `import './stubs'` itself (the action path may load it without `draft.ts`).

### 1.7 Deterministic fallback (AC4)

In `src/lib/articleImages.ts` (pure, so the client package could use it and unit tests need no mocks):

```ts
export function fallbackImageDirections(title: string, body: Block[], plans: ArticleBodyImagePlan[]): Pick<ArticleImageDirections, 'subject' | 'cover' | 'sections'>
```

- `topic` = title, whitespace-normalised, trailing `.!?` removed. `lead(s, max)` = whole sentences of `s` up to `max` characters, cut at a word boundary. `intro` = text of the content blocks before the first h2 (or the first content block).
- cover: `A literal, realistic scene showing the subject of an article titled {topic}. {lead(intro, 220)}`; alt `Illustration for {topic}`.
- section: `A literal, realistic scene showing {heading without trailing punctuation, or topic}, in an article titled {topic}. {lead(plan.context, 240)}`; alt `Illustration of {heading or first 140 characters of context}` (today's alt, unchanged).
- `subject: null`.

### 1.8 Dev stubs

`registerStub('article.imageDirections', …)` in `drafting/stubs.ts`, from `stubContext { title, kw, plans }`: `subject: ''`, `subjectKind: 'none'`, a cover direction and one direction per plan that contain the keyword or heading, no digits, no words the validator rejects, and three different scenes. A unit test passes the stub's output through `cleanImageDirections` and expects no slot to be replaced. Offline behaviour is otherwise identical to production (same validation, same `ai_calls` row).

## 2. Q2: prompt construction

`src/server/services/images.ts`.

```ts
export interface ImageReq { /* existing fields */;
  /** The prompt is a literal scene direction (article images written by Radar): draw the thing itself, never a
   *  metaphor. Absent: the prompt every caller gets today, unchanged. */
  literal?: boolean }

/** Style texts for literal scenes, where the standard text asks for a metaphor or for abstract objects. */
export const STYLE_PROMPTS_LITERAL: Record<string, string> = {
  editorial: 'Editorial illustration with textured shapes, magazine-cover quality, calm and professional',
  render3d: '3D render with real depth, soft studio lighting and gentle shadows, with glossy glass, soft clay or brushed metal finishes',
};
```

`imagePrompt` (add `'literal'` to its `Pick`):

- `!r.literal`: return exactly today's string. This keeps social, Daily Brief and owner-typed covers byte-identical, and keeps the golden request test in `openrouter.qa.test.ts` unchanged.
- `r.literal`:

```ts
const style = STYLE_PROMPTS_LITERAL[r.style] || STYLE_PROMPTS[r.style] || STYLE_PROMPTS.illustration;
const scene = (r.prompt || r.headline).trim().replace(/\s+/g, ' ');
return `${style}. Show exactly this scene: ${scene}${/[.!?]$/.test(scene) ? '' : '.'} Draw the real thing described, literally and recognisably, in its setting. Do not replace it with a visual metaphor, symbols, icons or abstract shapes. Made for ${r.name}'s blog. Use the brand colors ${r.brand.primary} and ${r.brand.secondary} as accents where they fit naturally, with realistic, neutral tones elsewhere. Variation ${r.seed}. Any signs, screens or documents in the scene are blank. No words, letters, numbers, logos or watermarks anywhere in the image.`;
```

How the style and a concrete subject combine: the style sentence says how it is drawn; the scene sentence says what is drawn; the literal instruction sits between them and the palette. The `editorial` text's "built around one clear visual metaphor" and `render3d`'s "objects" would contradict a literal scene, so those two have literal variants that keep the look and drop the contradiction. `flat`, `handdrawn`, `photography` and `illustration` describe technique only and are used as they are. Article covers can only select `illustration` and `photography` today (`ImageStyle`, `Patch.img.style`); the two literal variants are there so the rule holds if the wider style set is ever offered.

Who sets `literal`:

- cover: `literal: img.promptBy === 'radar'`. A direction the owner typed goes through today's wrapper, as written (PM decision 4, AC5).
- body images: always `literal: true`. The image prompt is the section direction; when the cover direction is the owner's it becomes `{section direction} Overall look the owner asked for: {owner direction}` (AC5, and the existing test that body prompts contain the owner's text).

The old body prompt ("Show a concrete visual metaphor … Do not repeat the article cover") is removed. An image model cannot see the cover; difference between pictures is now enforced where it can be, in the directions (§1.5).

## 3. Q3: depicting a specific real-world subject

### 3.1 Recommendation

**(a) now.** The direction describes the subject from facts the article states, the picture is an illustration, and the alt text says so ("Illustration of …"). **Neither (b) nor (c) is safely achievable in this change.** Smallest follow-up that adds real grounding: an owner action "Use a picture from your site" (§3.4).

This means the owner's request, "the property image of the building being talked about", is **not met** by this change. A generated picture of "a gated staff accommodation community of three buildings in Al Warsan" is a plausible building, not Wasl 611. That has to be said to the owner plainly.

### 3.2 Evidence

What Radar has today:

- `crawl_pages` stores `url, path, title, h1, description, text, links` (`src/server/db/schema.ts:84-96`). No image URL is stored; adding a column is an SQL migration (excluded).
- The crawl stops at 100 pages (`crawl.ts` `MAX_PAGES = 100`). lived.ae's sitemap lists 1,947 URLs (read today). `ownPages()` in `draft.ts` only scores crawled rows, so the page for a given building is usually not known to Radar. I could not check production `crawl_pages` (no access, by constraint).
- A safe fetch helper exists: `fetchUrl` in `src/server/services/analysis/crawl.ts:47` (public-address check before every hop, redirects validated one by one, `publicDispatcher` DNS check, 12 s timeout). It **truncates** at 2 MB and returns the partial body. That is right for HTML and wrong for an image (a cut-off file), so an image fetch needs a reject-over-limit variant and a content-type check. `src/server/services/social/source.ts` has a second guard of the same kind.

What lived.ae serves (read-only, generic user agent, HTML only; no image was downloaded):

- `https://www.lived.ae/property/princess-tower-dubai-marina`: `og:image` is a building photo, `https://www.lived.ae/api/media/<id>.jpg?bucket=properties`, declared 1200×630.
- `https://www.lived.ae/property/wasl-611-al-warsan` (the subject of the reported article; found in the sitemap): `og:image` is the **generic site card** `https://www.lived.ae/lived-social-preview.png` (796,916 bytes). The page does contain one photo, `<img alt="Wasl 611 · photo 1">` served from `/api/media/<id>.webp?bucket=properties&v=legacy`. So the cheap signal (`og:image`) fails for the very article in the report; finding the photo needs per-site HTML heuristics.
- `robots.txt` allows `/api/media/`. Nothing on the page states where the photos come from or who holds the rights. `v=legacy` suggests imported media. On a tenant-review site the building photos may be listing or developer pictures. "On the business's own site" does not establish "the business's own picture"; only the owner can.
- The page describes Wasl 611 as "three thoughtfully designed buildings offering 131 ensuite rooms". The task's own example wording ("33 low-rise blocks") differs. Facts about a named building are easy to get wrong, which is why the direction may use only what the article states.

Provider documentation, fetched 2026-11-12:

- **OpenRouter `POST /api/v1/images`** (the endpoint Radar calls; API reference "Generate an image" and the image-generation guide): accepts `input_references`, "Reference images to guide image-to-image generation, as base64 data URLs or HTTP(S) URLs", an array of at most 16 `{ "type": "image_url", "image_url": { "url": … } }`. Support is per model and provider. For Radar's default `google/gemini-nano-banana-2.1`, `GET /api/v1/images/models/google/gemini-nano-banana-2.1/endpoints` lists one endpoint (Google AI Studio) with `"input_references": { "type": "range", "min": 0, "max": 14 }`, `n` max 1, and one price line (`output_image` per token; no separate reference-image price listed). Verified from the reference and that endpoint record. Not verified: file size limits (the spec states none), and how closely the output follows a reference (not tested; no call was made).
- **OpenAI**: references go to a different endpoint, `POST /v1/images/edits`, up to 16 images for GPT image models; `/v1/images/generations` (what Radar calls) takes none. Both reference pages state: "`gpt-image-1` was shut down on October 23, 2026. Use `gpt-image-2.5-sunburst` or `gpt-image-2.5-flare` instead." Per-file size limit and accepted formats are not stated on the page I read.
- **xAI**: references go to `POST https://api.x.ai/v1/images/edits` with `image: { url, type: "image_url" }` (public URL or base64 data URI), up to 5 source images. The guide's examples use `grok-imagine-image-2.0`; the models page still lists `grok-imagine-image` at $0.02 per image (Radar's default) and `grok-imagine-image-2.0` at $0.04. Whether `grok-imagine-image` accepts edits is not stated. Size and format limits are not stated.

### 3.3 Why not (b) or (c) now

| | (b) own-site picture as a reference | (c) own-site picture as the cover |
|---|---|---|
| Finding the picture | Not stored. Needs a sitemap or page fetch and slug matching, then HTML parsing. `og:image` is the generic card on the reported page. | Same. |
| Correctness | The result is still an invented picture, now one that resembles the real building more closely. On a tenant-review site that is more misleading, not less. | Correct picture, if the right page was matched. A wrong match publishes the wrong building. |
| Rights | A reference is not republished, but the output derives from it. | Republishes the picture on the business's blog and CMS. Safe only if the business owns it, which nothing on the site shows. |
| Providers | Three different request shapes: OpenRouter field on the same endpoint; OpenAI and xAI need their edits endpoints. The failover loop in `generatePhotoRaw` would have a grounded route and two ungrounded ones, or three code paths. | None. |
| Fetch safety | Needs a new image fetch (reject over a size limit, content type, decode check). WebP decoding by `@napi-rs/canvas` `loadImage` is not verified here. | Same, plus cover-crop of an arbitrary photo. |
| Latency and failure | Up to two extra fetches (12 s timeouts each) inside every draft; each can fail independently. | Same. |
| Body images, style | Helps only the cover unless every body image is also referenced. | Ignores the chosen style. |

### 3.4 Smallest follow-up that adds grounding (not in this change)

An owner action in the Media panel, "Use a picture from your site": the owner pastes the address of a picture or of a page on their own domain. Server: host must be the business's domain or a subdomain; fetched through the `fetchUrl` guard with a reject-over-limit variant (for example 8 MB), `image/*` content type, decode with `loadImage`, cover-crop to 1200×628, store with `putObject` under the business. The owner choosing it is what establishes the right to use it, which no crawler can. That is option (c) made safe by a person. A later step can pass that stored picture to OpenRouter as `input_references` for body images in the article's style.

`Article.imageDirections.subject` (name and kind) is stored now so that follow-up has the subject to offer.

### 3.5 What (a) does about honesty

- Directions use only stated facts (§1.4 rule 3, §1.5 number check).
- Alt text begins "Illustration of …" and names the subject.
- The Media hint says generated pictures are illustrations and may differ from the real subject (§7).
- Left to the owner (§11): whether a **photography** style should be allowed for a named real place. The default style is `illustration`; the design does not override an owner who picks Photography.

## 4. Q4: data contract

All additions are optional JSON inside `articles.data`. No SQL migration.

`src/lib/types.ts`:

```ts
export type ImageIssueReason = 'unavailable' | 'failed';   // unavailable: no image model can be used right now; failed: one was asked and did not deliver
export interface ImageDirection { prompt: string; alt: string }
export interface ArticleImageDirections {
  /** Hash of the title, body and length these were derived from. A different key means they are stale. */
  key: string;
  /** 'ai': the direction step answered. 'fallback': built from the title, headings and section text; never reused. */
  source: 'ai' | 'fallback';
  /** The one named real-world thing the article is about, as the article writes it. null for a general topic. */
  subject: { name: string; kind: 'building' | 'place' | 'product' | 'organisation' | 'other' } | null;
  cover: ImageDirection;
  /** One per planned body image, in the order of planArticleBodyImages(body, brief.words). */
  sections: ImageDirection[];
  at: string;
}

// Article.img gains:
  /** Who wrote `prompt`. 'radar': the direction step; it may be replaced. 'owner': a person; never rewritten. Absent: see coverDirectionIsOwners. */
  promptBy?: 'radar' | 'owner';
  /** Set when a person edited the alt text; Radar then leaves it alone. */
  altBy?: 'owner';
  /** The stored cover is the brand template because a model style could not be generated. Absent: not a placeholder. */
  placeholder?: { reason: ImageIssueReason; at: string } | null;

// Article gains:
  imageDirections?: ArticleImageDirections;
  /** The last draft could not make body images and left them out. Removed when a set is stored. */
  bodyImagesIssue?: { reason: ImageIssueReason; at: string } | null;
```

`ArticleBodyImage` is unchanged: `prompt` now holds the section direction (what the picture shows) and `alt` the direction's alt.

`src/lib/articleImages.ts` (pure):

```ts
export const defaultCoverDirection = (kw: string) => 'Calm, editorial image about ' + kw;

/** A person wrote this cover direction, so Radar never rewrites it. A blank direction is nobody's. */
export function coverDirectionIsOwners(img: Pick<Article['img'], 'prompt' | 'promptBy'>, kw: string): boolean {
  const p = (img.prompt || '').trim();
  if (!p) return false;
  if (img.promptBy) return img.promptBy === 'owner';
  return p !== defaultCoverDirection(kw);            // legacy article: anything but the creation default was typed
}

/** The cover after a render: url, urlKey, and the placeholder mark set or removed. */
export function withCover(img: Article['img'], f: { url: string; placeholder?: ImageIssueReason }, at = new Date().toISOString()): Article['img']
// = { ...img without `placeholder`, url: f.url, urlKey: `${img.style}:${img.seed}`, ...(f.placeholder ? { placeholder: { reason: f.placeholder, at } } : {}) }
```

Legacy default: exact equality with `'Calm, editorial image about ' + entry.kw`, not the prefix regex. The Media field is prefilled with that sentence; an owner who edits its tail must count as the owner. `kw` cannot change on an entry (`calendar.update` accepts only title, date and type), and all three creation sites build the sentence from the entry's keyword. The creation sites (`calendar.ts:120`, `calendar/jobs.ts:109`, `blocks.ts:81`) are **not changed**: before a draft there is no article text to derive anything from. A unit test pins `defaultArticle(e).img.prompt === defaultCoverDirection(e.kw)`. The existing style-upgrade line `draft.ts:173` keeps its regex and must be evaluated on the prompt as loaded, before any replacement.

Old articles (none of the new fields): `coverDirectionIsOwners` falls back as above; no placeholder notice; no body-image notice; `imageDirections` absent means a cache miss. They open, edit and publish as before (AC9).

`article.save` (`actions/article.ts`):

- `Patch` is unchanged. `z.object` strips unknown keys, so a client cannot set `promptBy`, `altBy`, `placeholder`, `imageDirections` or `bodyImagesIssue`.
- In the `change(latest)` callback, after merging `patch.img`: if `patch.img.prompt !== undefined && patch.img.prompt !== latest.img.prompt` set `promptBy: 'owner'`; if `patch.img.alt !== undefined && patch.img.alt !== latest.img.alt` set `altBy: 'owner'`. (The client sends style, prompt and alt together on any image edit, so the comparison with `latest` is required.)
- The style-change conflict check (`seed`, `style`, `prompt`, `url` against the loaded copy, `article.ts:78`) is unchanged and still sufficient. The style-change write uses `withCover` so the placeholder mark follows the new render.
- Article-level fields survive every save because all writers spread `latest`.

## 5. Q5: fallback and failure semantics

### 5.1 `renderImageFile` reports a template fallback

```ts
export interface RenderedImage { url: string; bytes: number; type: string;
  /** A model style was asked for and the brand template was stored instead. */
  placeholder?: ImageIssueReason }
export async function renderImageFile(r: ImageReq, from?: ImageSource): Promise<RenderedImage>
```

Set in exactly two places, both on the path with no `from`:

- model style, model configured, `generatePhoto` threw, template drawn: `'unavailable'` when the error is a `RadarError` with code `image_unavailable` (every configured account is blocked), else `'failed'`;
- model style, no model configured (no keys, or dev stubs), template drawn: `'unavailable'`.

Not set for template styles (the owner's choice), for a model image, or on the `from` paths (social packs keep their own knowledge). Social and Daily Brief callers destructure `url, bytes, type` and ignore the new field; their behaviour and their tests (`toMatchObject`) are unchanged. `renderImage` (URL only) stays.

`ImageReq.modelRequired` keeps its mechanics; its comment becomes "Never fall back to the template: explicit custom requests, article body images, and a cover a person asked to regenerate."

### 5.2 Body images are never a template

`generateArticleBodyImages(ctx, e, a, profile, directions?: Pick<ArticleImageDirections, 'sections'>)`:

- `directions` absent or of the wrong length: `fallbackImageDirections(e.title, a.body, plans)` (no AI call inside this function; callers resolve directions first).
- Each image: `renderImage({ bid, style: a.img.style, brand, headline: plan.heading || e.title, name, seed, prompt, literal: true, modelRequired: true, w: 1200, h: 675, kind: 'article-body' })`. `modelRequired` makes a template style (`branded`, `infographic`) use the illustration prompt, as it already does for custom covers. Any throw ends the loop; nothing partial is returned (unchanged rule).
- Stored: `{ id, after: plan.after, url, alt: d.alt, prompt: d.prompt, seed }`.

### 5.3 Draft and job

Draft (`draftArticle`): wrap the call. On any error other than `empty_article`, `bodyImages = []` and `bodyImagesIssue = { reason: err?.code === 'image_unavailable' ? 'unavailable' : 'failed', at }`; on success the key is removed. `bodyImagesGeneratedAt` is set to now in both cases (it also keeps an older failed job from showing as the current error). The draft completes. This covers storage failures too: losing a finished premium draft because a picture could not be stored is the worse outcome (PM decision 2 replaces "drafting requires body images").

Job `article.bodyImages` (`jobs.ts`): resolve directions from the snapshot (`budgetMs` 90 s), generate, and on any failure **throw as today**: the job fails, the previous set is kept, the existing retry state shows. On success the commit writes `{ ...latest without bodyImagesIssue, bodyImages, bodyImagesGeneratedAt, imageDirections }`. Result is unchanged: `{ entryId, bodyImagesGeneratedAt, count }`. The body, style, prompt and `modelRequired` checks before commit are unchanged. The job never changes `img`.

How the client tells the cases apart, with no change to `articleSync.ts`:

| State | Data |
|---|---|
| Not generated yet | no images, no `bodyImagesIssue`, no failed job |
| Radar tried in a draft and could not | no images, `bodyImagesIssue` present |
| An explicit attempt just failed | `bodyJob.status === 'failed'` newer than `bodyImagesGeneratedAt` (the existing `bodyError`) |
| Generated | images present (the issue key is gone) |

`bodyImagesLanded` and `draftLanded` already trigger the reloads that bring these fields.

### 5.4 Dev stubs

`imageModelConfigured()` is false under `RADAR_DEV_STUBS`, so a stub-mode draft completes with a template cover (default style `branded`, not a placeholder) and **no body images**, with `bodyImagesIssue.reason = 'unavailable'`. Flows keep working offline. Inline body images are no longer visible in stub mode; QA can seed `bodyImages` on a fixture article to check their rendering, which did not change. I do not recommend a dev-only fake image generator: it would change what "no image model" means for social and brief tests.

### 5.5 Cover placeholder: where the mark is written and cleared

- Draft cover render (§6.1), style change in `article.save`, and the publisher's late render all go through `renderImageFile` + `withCover`.
- A later model success, or a switch to a template style, removes the mark (the render returns no `placeholder`).
- Articles drafted before this change carry no mark even if their cover is a template from the outage. The data cannot tell a stored template from a stored model image. They get a mark or a real picture the next time they are redrafted, restyled or regenerated.

### 5.6 Publisher

- Placeholder cover: published as it is (PM decision 3). No block, no warning at publish time.
- No body images: `buildPayload` already maps an absent or empty list to nothing; published output has no body figures.
- `heroImage()` (cover missing at publish time): call `renderImageFile`; when it returns `placeholder`, write `img.url` and `img.placeholder` in the same `jsonb_set` statement so the editor shows the truth afterwards.
- Template body images **already stored** on articles drafted during the outage are still published; they are indistinguishable in the data. See §11, AC6.

## 6. Q6: regeneration on existing articles

### 6.1 Cover in a draft or rewrite

After directions are resolved (always `fresh` in a draft: the body is new) and the style-upgrade line has run:

```ts
const key = `${img.style}:${img.seed}`;
const hadCover = !!a.img.url && a.img.urlKey === key;
const owners = coverDirectionIsOwners(a.img, e.kw);
const modelStyle = MODEL_STYLES.includes(img.style);
// Take Radar's new direction when there is no usable cover, the cover is a placeholder, or it predates contextual directions.
const adopt = !owners && (!hadCover || !!a.img.placeholder || a.img.promptBy !== 'radar');
const next = adopt ? { prompt: dir.cover.prompt, promptBy: 'radar' as const,
                       ...(a.img.altBy !== 'owner' && (a.generated || !a.img.alt) ? { alt: dir.cover.alt } : {}) } : {};
const render = !hadCover || (adopt && modelStyle);
const strict = !!img.modelRequired || hadCover;      // an existing picture is never replaced by a template
if (render) {
  try { img = withCover({ ...img, ...next }, await renderImageFile({ …, prompt: (next.prompt ?? img.prompt), literal: (next.promptBy ?? img.promptBy) === 'radar', modelRequired: strict, w: 1200, h: 628, kind: 'hero' })); }
  catch (err) {
    if (hadCover) { /* keep the cover and its direction exactly as they were; the next rewrite tries again */ }
    else if (img.modelRequired) throw err;           // unchanged: a missing custom cover is never downgraded
    else img = { ...img, ...next, url: null, urlKey: null };
  }
} else if (adopt) img = { ...img, ...next };
if (owners) img.promptBy = 'owner';
```

Consequences:

- New draft: contextual direction, model cover, or a marked placeholder (AC1, AC2, AC7).
- Rewrite of an article with a good contextual cover: the picture and its direction are kept (as `DIVERGENCES.md:120` documents: a rewrite keeps the image). No extra image cost. The cache holds the new text's directions for the next Regenerate.
- Rewrite of an older article or of one with a placeholder: one strict attempt at a contextual cover; on failure nothing changes.
- Template style: the direction text is updated, the template is not re-rendered.
- `article.meta` is unchanged. Its `alt` is used only when the direction is the owner's and the alt is empty.

The draft returns `{ …, img, bodyImages, bodyImagesGeneratedAt, imageDirections: dir, bodyImagesIssue? }`.

### 6.2 `article.regenerateImage`

```ts
await checkMedia(ctx.bid, entryId);                       // unchanged: role, tenant, locks, active work, before any provider time
const { e, a } = await load(ctx.bid, entryId);
let img = { ...a.img, seed: (a.img.seed || 1) + 1 }; let directions: ArticleImageDirections | undefined;
const modelStyle = MODEL_STYLES.includes(img.style);
if (prompt !== undefined) img = { ...img, prompt, promptBy: 'owner', modelRequired: true };
else if (a.generated && a.body.length && modelStyle && !coverDirectionIsOwners(a.img, e.kw)) {
  directions = await resolveImageDirections(ctx.bid, profileOf(ctx.biz), e, a, { budgetMs: 20_000 });
  img = { ...img, prompt: directions.cover.prompt, promptBy: 'radar', ...(a.img.altBy === 'owner' ? {} : { alt: directions.cover.alt }) };
}
// A person asked for a new picture: a model style never answers with the template.
next.img = await render(ctx.bid, ctx.biz, e.title, { ...a, img }, { strict: modelStyle });
```

`render()` passes `literal: img.promptBy === 'radar'` and `modelRequired: !!img.modelRequired || !!o.strict` to `renderImageFile` and returns `withCover(img, file)`. `strict` is a request option and is not stored in `img.modelRequired`.

Save: the existing conflict check (latest `seed`, `style`, `prompt`, `url` equal to the loaded copy) is unchanged; the write adds `promptBy`, `alt`, the placeholder mark via `withCover`, and `imageDirections` when it was computed. Errors: unchanged mapping (`RadarError` passed through, else 502 `image_failed`).

- AC8: an older article (default direction, no `promptBy`) gets a contextual direction on Regenerate. A direction the owner typed is used as written. A template style keeps today's behaviour (a new template variation; the template does not use a direction, so the step is not run).
- **Behaviour change:** Regenerate on a model style during an outage used to store a template and toast "Cover image generated". It now returns the existing "Image generation is temporarily unavailable. Your previous image is kept. Please contact support." and keeps the cover. This also holds without any configured model (and in dev stubs with a model style selected).
- Cost and latency: cache hit, no text call. Miss: one utility call, 20 s budget at most (typically a few seconds), then the image (OpenRouter 60 s timeout). `openaiImage` and `xaiImage` have no timeout today; that is existing behaviour and unchanged.
- The cache is invalidated by its key (title, body, length). No explicit invalidation on save is needed, and none is added.

### 6.3 `article.bodyImages` job

§5.3. A cache hit (the common case after a draft that had to leave images out) costs no text call. Older articles get one call. The job persists `imageDirections` so the next cover Regenerate hits the cache.

### 6.4 `article.save` style change

Renders with the current direction (`literal` when `promptBy === 'radar'`), not strict, through `withCover`: choosing Illustration with no usable model stores the template and the mark, and the panel explains it. No direction step here.

## 7. Q7: Media panel states and copy

Files: `src/features/article/ArticleWorkspace.tsx`, `src/features/article/BodyImage.tsx`. Existing components only (`Status`, `Btn`, `Field`), existing class names, curly apostrophes as elsewhere.

**Cover placeholder notice.** Shown when `A.img.placeholder` is set and `heroUrl` is not null. Placed directly under the cover preview in the Media tab, above Style. `role="status"`. A `Status tone="warn"` reading `Placeholder`, then the text, then a small button.

- reason `unavailable`: `This cover is a placeholder. Image generation is unavailable right now, so Radar used a title card. Regenerate to try again.`
- reason `failed`: `This cover is a placeholder. Radar couldn’t generate the image, so it used a title card. Regenerate to try again.`
- Button: `Btn size="sm" icon="refresh"` labelled `Regenerate`, `loading={imgBusy}`, `disabled={!canEdit || imgBusy}`, `onClick={() => generateCover()}`. The existing button row below stays.
- When the viewer cannot edit (`B.role === 'Viewer'` or the article is locked), no button and the last sentence is replaced by `An owner or editor can regenerate it.` (Viewer) or dropped (locked).

**Cover errors and success.** Unchanged: `Cover image generated`; `error.code === 'image_unavailable' ? error.message : 'Radar couldn’t generate this image. Your previous cover is kept. Try again.'`.

**"Describe your image" hint.** Replace the hint with: `Radar writes this from your article. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.`

**Body images.** `BodyImagesPanel` gains `issue?: ImageIssueReason | null`. The workspace passes `issue={!bodyImages.length && !bodyError ? A.bodyImagesIssue?.reason ?? null : null}`. One message at a time, in this order: busy status (unchanged) › job error (unchanged copy) › issue.

- issue `unavailable`: `Radar couldn’t add body images to this article. Image generation is unavailable right now. Your text and cover are not affected.`
- issue `failed`: `Radar couldn’t make the body images for this article. Your text and cover are not affected.`
- Both as `<p role="status" className="xs" style={{ color: 'var(--warn)', margin: 0 }}>`.
- Button label: `error || issue ? 'Try again' : images.length ? 'Regenerate body images' : 'Add body images'`.
- Unchanged: `Radar couldn’t make the body images. Try again. Any existing images are kept.` for a failed job; the intro sentence; progress text.

No new state in the client beyond reading the two fields. `generateCover` already reloads the article, which brings the new direction and alt into the fields.

## 8. Q8: tests

New:

- `src/server/services/drafting/imageDirections.test.ts`
  - the prompt contains the title, each planned heading, section text and the body; the owner's direction line appears only when the direction is the owner's (AC1, AC3, AC5);
  - `cleanImageDirections`: keeps concrete directions; replaces a slot that asks for text, quotes wording, is symbolic, is too short, repeats another slot, or contains a number absent from the article; maps `i` to the plan; fills a missing section; drops a subject the article does not name; appends the subject to a cover that omits it; rebuilds an alt that omits it (AC2, AC3);
  - `resolveImageDirections`: cache hit makes no `ai.run` call; a changed title, body or length misses; a `fallback` set is not reused; a rejected `ai.run` and a blown budget (fake timers) both return fallback directions without throwing (AC4); called with `purpose: 'article.imageDirections'` and `retries: 0`;
  - with `RADAR_DEV_STUBS` the stub's answer passes validation untouched (constraint: stubs offline).
- `src/server/services/drafting/draft.images.test.ts` (same mocking style as `draft.test.ts`)
  - new draft: `img.prompt` is the cover direction, `promptBy: 'radar'`, alt from the directions, cover request `literal: true` (AC1, AC2);
  - direction step fails: draft completes with title-and-section directions (AC4);
  - owner direction (`promptBy: 'owner'`, and the legacy form: a prompt that is not the default): prompt unchanged, request not literal (AC5);
  - cover render returns `placeholder`: mark saved; a later render without it removes the mark (AC7);
  - body generation throws `image_unavailable`, another error, and a storage error: `bodyImages: []`, `bodyImagesIssue.reason` is `unavailable` / `failed` / `failed`, draft returned (AC6);
  - rewrite with a good contextual cover: no cover render, direction kept; rewrite of an older article: one strict render; strict failure leaves `img` as loaded (§6.1).

Extended:

- `src/lib/articleImages.test.ts`: `coverDirectionIsOwners` (blank, default, edited default tail, `promptBy` both ways); `defaultArticle(e).img.prompt === defaultCoverDirection(e.kw)`; `withCover` sets and removes the mark; `fallbackImageDirections` uses title, heading and section text and gives different text per section (AC4, AC9).
- `src/server/services/articleImagesFallback.test.ts`: the provider-failure test also expects `renderImageFile(...).placeholder === 'failed'`; add: a model image has no `placeholder`; a `branded` render has none; no model configured with a model style gives `'unavailable'`; a strict body request (`kind: 'article-body'`, `modelRequired: true`) with a failing provider stores nothing; `imagePrompt` with `literal` contains the scene, the no-metaphor sentence and the unchanged final sentence, and without `literal` equals today's string for a fixed request (AC6, AC7, Q2).
- `src/server/services/imageAvailability.test.ts` ("preserves optional background template fallback when every account is unavailable"): also expects `placeholder: 'unavailable'`.
- `src/server/services/images.records.test.ts`: unchanged behaviour; add one case that a strict body request writes one row per provider asked and no template (AC10).
- `src/server/services/drafting/bodyImages.test.ts`: requests carry `modelRequired: true` and `literal: true`; stored `prompt`/`alt` come from the directions passed in; without directions the fallback still contains the section text (keeps the existing assertions); owner direction text is appended.
- `src/server/services/drafting/bodyImages.db.test.ts` (real Postgres): the older-article job stores `imageDirections` and section-specific prompts, and a second run makes no direction call (AC8); `article.regenerateImage` without a prompt on an older article saves a contextual direction, `promptBy: 'radar'`, and asks strictly for a model style (AC8); a locked, foreign or Viewer request never reaches the direction step (AC10); autosave cannot set `placeholder`, `promptBy`, `imageDirections` or `bodyImagesIssue`, and an edited prompt or alt is marked `owner` (AC10, AC5); publishing an article with `bodyImages: []` and a placeholder cover succeeds and the payload has no body figure (AC6, AC7); an article without any new field loads through `article.get`, saves and builds the same payload as before (AC9).
- `src/server/services/publishing/bodyImages.test.ts`: HTML and Markdown with an empty list contain no `radar-body-image` figure.
- `src/server/ai/tiers.run.test.ts` or `record.test.ts` pattern: one `ai_calls` row with `task: 'utility'`, `purpose: 'article.imageDirections'` (AC10).

Existing expectations that legitimately change:

| Test | Change | Because |
|---|---|---|
| `src/server/ai/tiers.test.ts:28-30` | the utility list has seven purposes | PM decision 1 |
| `bodyImages.db.test.ts:95` "a full draft image-storage failure never marks the article ready…" | the draft now completes in `review` with no body images and `bodyImagesIssue.reason === 'failed'` | PM decision 2 |
| `bodyImages.db.test.ts:81` "new drafts and long rewrites cannot complete without their body images" | assertions hold with a succeeding mock; the title no longer states the rule | PM decision 2 |
| `bodyImages.db.test.ts:68` "repairs a legacy article…" | `imageDirections` joins the fields excluded from the "unchanged" comparison | new cache field |
| `bodyImages.db.test.ts:156` custom cover | saved `img` also has `promptBy: 'owner'` | new field |
| `bodyImages.test.ts:13-25` | request matcher gains `modelRequired`/`literal` | body images are strict |
| `articleImagesFallback.test.ts` first `describe` title | it now describes the cover fallback, not body images | PM decision 2 |
| mocks of the images module in `drafting/bodyImages.db.test.ts:7`, `drafting/draft.test.ts:15` (they export only `renderImage` and `defaultArticleImageStyle`) | add `renderImageFile` (for example `async r => ({ url: await M.render(r), bytes: 1, type: 'image/png' })`) and `MODEL_STYLES`; `actions/customImages.db.test.ts:7` already has both | cover call sites use `renderImageFile` |
| tests that run a whole draft and count or script model answers: `drafting/draft.test.ts`, `actions/writingInstructions.db.test.ts`, `server/lighterSaves.db.test.ts`, `services/spendRecords.db.test.ts` | one more `ai.run` (`article.imageDirections`) per draft; an unscripted answer falls back without failing the draft, but call counts and `ai_calls` row counts move by one | the new step |

Unchanged and worth watching: `bodyImages.db.test.ts:105` (a missing custom cover is never downgraded) and the parity test in `openrouter.qa.test.ts` (no request body of an existing caller changes).

## 9. Q9: rollout

- No new environment variable, no migration, no new dependency. Web and worker read the same table in code.
- Jobs in flight at deploy: a draft or body-image job on the old worker is retried by the new one through the existing lock expiry and `maxAttempts: 2`; `assertArticleJobOwned` already discards a late commit.
- Old worker reading new fields: old code spreads the stored article, so it preserves fields it does not know. A stale `bodyImagesIssue` next to images is not shown (the panel requires no images); a stale `imageDirections` misses by key.
- Old browser bundle against the new server: ignores the new fields; shows the template cover without the notice and "Add body images" where the new one shows the reason. Harmless until reload.
- New server, stale tab: an image edit from a tab holding an older direction marks it `owner`. Existing race class (the tab would overwrite the prompt today as well); the draft flow reloads the article when the job lands.
- Rollback: revert the PR. Old code treats a contextual `img.prompt` as an ordinary direction, ignores the marks, and reads `bodyImages: []` as "none". No data repair.
- After deploy, before provider credit: new drafts show a flagged placeholder cover (model styles) and no body images. With credit: real pictures; marks clear on the next successful generation per article. Verification on production needs at least one working image route.

## 10. Work packages and order

Step 0 (server engineer, first commit, so the client can build against it): the `src/lib/types.ts` additions in §4, exactly as written.

**Server package**

| File | Change |
|---|---|
| `src/lib/types.ts` | §4 types |
| `src/lib/articleImages.ts` | `defaultCoverDirection`, `coverDirectionIsOwners`, `withCover`, `fallbackImageDirections` |
| `src/server/ai/tiers.ts` | `'article.imageDirections': 'utility'`; header comment |
| `src/server/services/images.ts` | `ImageReq.literal`, `STYLE_PROMPTS_LITERAL`, `imagePrompt` literal branch, `RenderedImage.placeholder` in the two fallback branches |
| `src/server/services/drafting/imageDirections.ts` (new) | `DirectionsOut`, prompt, `cleanImageDirections`, `directionsKey`, `resolveImageDirections` |
| `src/server/services/drafting/stubs.ts` | stub for `article.imageDirections` |
| `src/server/services/drafting/draft.ts` | resolve directions; cover rule §6.1; body-image omission §5.3; return the new fields |
| `src/server/services/drafting/bodyImages.ts` | directions parameter, strict literal requests, new stored prompt/alt |
| `src/server/services/drafting/jobs.ts` | body job: resolve directions, commit `imageDirections`, remove `bodyImagesIssue` |
| `src/server/actions/article.ts` | `render()` via `renderImageFile` + `withCover`; `article.save` owner marks and placeholder on style change; `article.regenerateImage` §6.2 |
| `src/server/services/publishing/publisher.ts` | `heroImage()` writes the placeholder mark when the late render falls back |
| `docs/CONTRACTS.md` (lines 30, 65, 195-197), `DIVERGENCES.md` (120-121, 295) | new rules: body images optional and never a template; placeholder mark; direction ownership; Regenerate strict |
| tests | §8 |

Order inside the package: types and lib helpers with their tests › `images.ts` › `imageDirections.ts` with stub and tests › `bodyImages.ts` › `draft.ts` and `jobs.ts` › `article.ts` › `publisher.ts` › DB tests › docs.

**Client package** (touches no server file; needs only step 0)

| File | Change |
|---|---|
| `src/features/article/ArticleWorkspace.tsx` | placeholder notice, hint text, pass `issue` (§7) |
| `src/features/article/BodyImage.tsx` | `issue` prop, messages, button label (§7) |

`src/client/articleSync.ts` and its test are not changed.

Validation scenarios beyond the unit and DB tests, for QA: (1) stub mode, style Illustration selected: the cover notice appears with the `unavailable` text and clears on switching to Branded graphic; (2) stub mode draft: no body images, the `unavailable` body message, Try again runs a job that fails with the existing error copy; (3) an article seeded with `bodyImages`: inline rendering unchanged; (4) Viewer and scheduled states: no Regenerate button in the notice; (5) with a working image key, if one is available to QA: a draft about a named place yields a cover direction naming it, an "Illustration of …" alt, and body pictures that differ; state plainly whether this was run against a real provider.

## 11. Risks, limits, and decisions for the PM or owner

Acceptance criteria that are wrong or cannot be met as written:

- **Brief scope 2 and AC2, "depicts that subject".** An image model does not know what a specific building looks like. The cover will be an illustration of a building that fits the article's description, named in the direction and alt. It is not a picture of the real building. The owner asked for "the property image of the building"; this change does not deliver that (§3).
- **AC2, "contains no detail that the article or its sources do not state".** This cannot be proven for model output. The design enforces it by instruction, by the number check, and by the subject-name check. It is best effort, and testable only on the validator and the stub.
- **Brief scope 3 (ground the image with a real picture from the business's site).** Recommended out of this change (§3.3). As a result the second sentence of AC10 has nothing to protect here: this change adds no fetch from the open web.
- **AC6, "Published output contains no template body images".** True for images generated after this change. Template body images already stored on articles drafted during the outage cannot be told apart in the data and are still published until someone regenerates them. Articles already published are locked against regeneration (`assertArticleEditable`).
- **AC7 for older articles.** A cover that silently fell back before this change has no mark. It gets one, or a real picture, on the next redraft, restyle or Regenerate.
- **AC8 for template styles.** Branded graphic and Infographic covers are drawn from the title; a direction does not apply to them. Contextual directions apply to model-style covers and to all body images.

Needs the owner's judgment:

1. Accept (a) now, and decide whether to schedule the "Use a picture from your site" follow-up (§3.4). Only the owner can say whether the photos on lived.ae building pages are theirs to republish.
2. Whether a Photography-style generated cover should be allowed for a named real place on a review site. The design allows it and labels the alt "Illustration of …".
3. Accept that until provider credit exists, new articles have no body images and a flagged placeholder cover, and that Autopilot publishes them that way.

Needs the PM's decision:

4. The OpenAI image default `gpt-image-1` is shut down. Either set `OPENAI_IMAGE_MODEL` in Railway (web and worker) or change the default in a separate small change. OpenAI names `gpt-image-2.5-sunburst` or `gpt-image-2.5-flare` as replacements; the Create image reference lists the three sizes Radar sends and says GPT image models always return base64. I did not make a call to confirm.
5. Cover Regenerate on a model style becomes strict (§6.2). It is a visible behaviour change outside the literal ACs, and it is what stops "Cover image generated" being shown for a template.
6. Stub-mode drafts lose their body images (§5.4).

Other risks:

- Direction quality depends on a small model. Mitigations: slot validation, fallback, the owner can type a direction.
- Strict body requests report provider failures as hard failures (`degraded: false`), so operators are alerted when no route can make body images. Given that the outage in the brief went unnoticed, I consider that correct.
- The budget race does not cancel `ai.run`; a late answer is discarded and still billed.
- `article.imageDirections` adds about 2 KB to an article row and to `article.get`.
- A rewrite of an older article attempts one extra (strict) cover generation.

## 12. Not verified

- Production: environment values (including `OPENAI_IMAGE_MODEL`), database contents (whether the Wasl 611 page is in `crawl_pages`, the reported article's status), Railway logs. No access was used, by constraint.
- Provider behaviour beyond documentation: no image or text call was made. Reference-image fidelity, size limits for `input_references`, and whether xAI's `grok-imagine-image` accepts edits are not established.
- Who owns the photographs on lived.ae property pages.
- WebP decoding in `@napi-rs/canvas` (relevant only to the follow-up).
- Railway's request time limit for the synchronous cover action.
- Typecheck and the test suite were not run; this is a design.

## 13. Sources (read 2026-11-12)

- OpenRouter, Generate an image (API reference): https://openrouter.ai/docs/api/api-reference/images/generate-an-image.md
- OpenRouter, image generation guide: https://openrouter.ai/docs/guides/overview/multimodal/image-generation.md
- OpenRouter, endpoints for the default image model: https://openrouter.ai/api/v1/images/models/google/gemini-nano-banana-2.1/endpoints
- OpenAI, Create image: https://developers.openai.com/api/reference/resources/images/methods/generate
- OpenAI, Create image edit: https://developers.openai.com/api/reference/resources/images/methods/edit
- OpenAI, deprecations: https://developers.openai.com/api/docs/deprecations
- xAI, image generation guide: https://docs.x.ai/docs/guides/image-generation
- xAI, models and pricing: https://docs.x.ai/docs/models
- lived.ae (HTML only): `/property/princess-tower-dubai-marina`, `/property/wasl-611-al-warsan`, `/sitemap.xml`, `/robots.txt`
