# Real subject covers

Follow-up to `.factory/contextual-article-images/` (PR 54, merged as `691806da`). Read that folder's `architecture.md` §3 first.

## Problem
When an article is about one named real-world thing (a building, a place, a product, an organisation), the cover is a generated illustration. An image model does not know what the real thing looks like, so the picture is plausible and wrong. The owner asked for the real picture of the subject on such an article. Radar already records the subject (`Article.imageDirections.subject`), and the business's own website often has a picture of it.

## Owner's answer (2026-11-13, asked before design)
Asked: are the photos on lived.ae property pages yours to reuse, and should Radar pick them automatically or only when you choose?

- "You're not building Radar for Lived, you're building Radar for the thousands of other businesses that would require the same treatment, the point is to ensure that generated images are contextually relevant and better than the abstract things generated today, it could be styled differently like a hand drawn sketch or something but every image has to be contextually aligned with whatever part of the post it appears in."
- "As is necessary depending on the context and what is available, when a real image is possible use otherwise generate."

PM reading:
- P1. Automatic use is approved: use a real picture when one can be found, otherwise generate. The owner-chosen action is built as well.
- P2. Nothing may be specific to lived.ae. Finding the subject's page and its picture uses signals any website has (sitemap, crawled pages, page title and h1, `og:image`, image alt text, structured data).
- P3. The rights question was not answered. The product rule is therefore the proxy: only pictures served from the business's own domain, the Media panel always shows where the cover came from, and one click switches back to a generated cover. This is recorded as an open risk for the owner in the pull request.
- P4. "Every image contextually aligned with its part of the post" is what PR 54's section directions do. This change adds to it where cheap: when a real picture of the subject is stored, generated body images may be given it as a reference so they resemble the real subject in the article's style.

## Scope
1. Owner action in the article Media panel: "Use a picture from your site". The owner gives the address of a page or of a picture on their own domain; Radar fetches it safely, crops it to 1200×628, stores it under the business and makes it the cover.
2. Automatic: during a draft or rewrite, when the article has a subject, Radar looks for that subject's page on the business's own domain and for a picture of the subject on it, and uses it as the cover. No confident match means a generated cover, as today.
3. The article records that the cover is a real picture, who chose it (Radar or a person) and the page and picture address it came from. The Media panel shows this and offers the generated cover back.
4. If cheap: the stored real picture is passed to OpenRouter as `input_references` for body images.

## Exclusions
- Pictures from any third-party host, including a CDN the business's site uses. A redirect that leaves the business's domain ends the attempt.
- Real pictures inside the article body (body images stay generated).
- Uploading a file from the owner's computer.
- Site-specific scraping rules. A business-level setting to turn automatic use off (raised as a question for the owner instead).
- SQL migrations and new dependencies, unless the design shows one is needed.
- Social pack and Daily Brief images.

## Acceptance criteria
- AC1 Owner action. In the Media panel an Owner or Editor can enter a page or picture address on the business's domain or a subdomain of it and get that picture as the cover, cropped to 1200×628 and stored with `putObject` under the business. Viewers, locked (scheduled with remote, publishing, published) articles and articles with active draft or image work are refused exactly as the existing media actions refuse them, before any fetch.
- AC2 Domain rule. An address whose host is not the business's domain or a subdomain is refused with a plain message and nothing is fetched. The rule also holds for the picture found on a page and for every redirect hop. Look-alike hosts (`lived.ae.evil.com`, `notlived.ae`), userinfo tricks, other schemes and non-default ports to internal services do not pass.
- AC3 Fetch guard. The picture fetch refuses internal and non-public addresses on every hop (DNS included), limits redirects, has a total time limit, **rejects** a response over the size limit (declared or streamed) instead of truncating, requires an `image/*` content type that Radar can decode (not SVG), decodes the bytes and refuses pictures that are too small to be a cover or too large in pixels. WebP, JPEG and PNG decode correctly (WebP verified with `@napi-rs/canvas`).
- AC4 Record. The article stores that the cover is a real picture, whether Radar or a person chose it, the source page (when there was one), the picture address and the time. The alt text names the subject and does not begin "Illustration of"; an alt the owner typed is kept.
- AC5 Automatic match. During a draft or rewrite with a subject, Radar finds the subject's page only on the business's own domain, from crawl data and the sitemap, matching strictly on the subject's name, and takes only a picture that the page ties to the subject (alt text or page title/h1 naming it; a site-wide default share image is never taken). On any doubt, failure or timeout the draft continues with a generated cover. The attempt has a fixed time and request budget and never fails a draft.
- AC6 Precedence. A cover the owner chose (their picture or their typed direction) is never replaced by an automatic picture. A rewrite keeps an existing real cover. A real cover is never replaced by a template.
- AC7 Media panel. With a real cover the panel says it is a picture from the owner's site, links the source page, and offers "use a generated cover instead", which goes back to generation with the contextual direction. The existing Regenerate, prompt and placeholder states keep working. Errors are plain and specific (not your domain, no picture found on that page, too large, not a picture, could not be reached).
- AC8 Publishing. An article with a real cover publishes through every connector path the same way as one with a generated cover, with the new alt text. Articles saved before this change open, edit and publish as before. No SQL migration.
- AC9 Reference for body images (optional, only if the design shows it is cheap and safe): with a stored real cover, body-image requests on the OpenRouter route carry it as `input_references`; other routes and failures behave as today.
- AC10 Dev stubs keep working offline and give QA a way to exercise both paths in a browser.
- AC11 Tests cover the fetch guard (internal address, redirect to internal, redirect off-domain, oversize declared and streamed, wrong content type, undecodable bytes), the domain rule, matching (exact, near miss, wrong building with a similar name, site default image), storage and the record, precedence, and publishing. Typecheck passes; the full suite is compared with the known failures on `main`; the Media panel is checked in a real browser.

## Constraints
- AI calls: none added if matching can be done without one. If the design needs one it is one utility-tier call, recorded in `ai_calls`, and the reason is stated.
- Crawler user agent and robots behaviour follow what the existing crawl does.
- No secret, cookie or authorization header is sent with these fetches.

## Delivery
Branch `kenny-dev/cool-dirac-60b241` from `main` `691806da`. Pull request to `main`. **Do not merge or deploy without the owner's go-ahead** (main auto-deploys to Railway).

## Decisions after the design (2026-11-13, PM)
Design: `architecture.md`. Accepted as written, with these consequences for the criteria above.

- D1. AC3 is reworded: the response header must name JPEG, PNG or WebP; the bytes must be one of those three, complete and not animated; pixel size is read from the file header and checked before anything is decoded. SVG, GIF, AVIF, BMP and `application/octet-stream` are refused. Reason: `loadImage` in `@napi-rs/canvas` 0.1.100 renders SVG and accepts truncated files without an error (architecture §1.4).
- D2. AC2: every explicit non-default port is refused. `http` is upgraded to `https`; nothing is fetched over `http`.
- D3. AC5: automatic matching applies to subjects of kind building, place and product. "A site-wide default share image is never taken" means: a share image equal to the home page's is never taken.
- D4. AC6: a real cover is never **automatically** replaced. A person who switches back with Branded graphic or Infographic selected gets that template.
- D5. AC7: while the cover is real, Regenerate and Generate from prompt are not shown; "Use a generated cover instead" is the way back. It is the existing `article.regenerateImage`, which then also sets `img.noReal` so later rewrites do not put the picture back.
- D6. AC9 is out of this change (architecture §9). Nobody has seen what the model does with a photograph as a reference, and a rejected reference would remove a draft's whole body-image set. Follow-up after one paid test call.
- D7. AC1: Owner, Admin and Editor. The owner action is limited to 30 an hour per business.
- D8. Portrait and square pictures are shown whole on a blurred copy of themselves (architecture §6); landscape pictures are centre-cropped.
- D9. Stored as PNG 1200×628 under the business's `hero/` folder, like generated covers.
- D10. Automatic pictures also apply to articles Autopilot publishes without review. This follows the owner's "when a real image is possible use, otherwise generate"; it is raised again in the pull request because nobody looks at those covers before they go out.
- D11. The stub site gains three place pages and stub pictures (architecture §10).

## For the owner (to go in the pull request)
1. Rights: Radar treats "served from the domain this business gave at sign-up" as "theirs to publish". The domain is not verified, and a picture on a site is not proof of ownership. The source is always shown and one click goes back to a generated cover.
2. Autopilot publishes automatic pictures unseen (D10).
3. Sites that keep their pictures on another host (many Wix, Squarespace, Webflow, Framer and CDN setups) get no real pictures; the owner action tells them why.
4. The article in the original report still gets a generated cover today: the only photo on `lived.ae/property/wasl-611-al-warsan` answers 502 from lived.ae's own media endpoint (checked 2026-11-13). Princess Tower's page works.
- D12 (after implementation). The picture is decoded and drawn in a short-lived child process, not in the web or worker process. `loadImage` in `@napi-rs/canvas` 0.1.100 ends the process with a segmentation fault on some malformed files that pass every header check (reproduced by the PM: the four bytes `FF D8 FF D9` exit with status 139). The child gets `PATH` and `NODE_ENV` only, a 20-second limit, and a crash is one refused picture. The same crash exists in `src/server/services/analysis/brand.ts` (logo bytes during onboarding); that is a separate fix.
- D13. A non-https source in the notice is shown as plain text, not a link. A style change on a real cover moves `urlKey` locally so the picture does not flash away.

## Decisions after QA round 1 (2026-11-13, PM)
QA (`qa.md`, on `aa16969f`): do not ship the automatic path as it was. Two major defects put another subject's picture, or a share card, on an article. Fixes go to the server engineer; QA reruns its probes.

- D14 (QA D1a). A page is the subject's page only when its h1 equals the subject. When the page has no h1 at all, a structured-data name of a non-generic entity equal to the subject is enough. The lead of `<title>` no longer confirms a page.
- D15 (QA D1b). A picture's alt text ties it to the subject only when the alt names the subject and nothing else: the subject's words as a run, and every other word a numeral or a generic picture word (photo, image, picture, view, exterior and the like). "Harbour House Annex · photo 1" does not tie a picture to "Harbour House".
- D16 (QA D2, replaces the share-image part of D3). The automatic path never takes a share image (`og:image`, `twitter:image`, `image_src`). Nothing ties a share image to the subject, and per-page generated title cards are common. The owner action may still use one, and compares it with the home page's ignoring `www.` and the query string.
- D17 (QA D3). Tag, category, topic, author, search and archive paths are listings. Structured-data entities of type Review, Rating, AggregateRating, Comment, Offer and media objects are generic: their name is not a subject and their image is not a picture of one.
- D18 (QA D4). A decoded picture that is blank (fully transparent, or one flat colour) is refused. A file damaged in the middle that still decodes to a partly blank picture is not detected; accepted limit.
- D19 (QA D5). On the owner action, a picture listed in structured data keeps the alt text of the `<img>` with the same address.
- D20 (QA D6). A search is "finished with nothing found" only when the site answered. When robots.txt and the sitemap could not be reached at all (no HTTP answer, or a 5xx), the miss is not remembered.
- Accepted as they are: QA observations 1–7.

## Decisions after QA round 2 (2026-11-13, PM)
QA round 2 (`qa.md`, on `2b034f26`): all six round-1 defects closed; three new findings.

- D21 (QA N1). On the automatic path a picture whose address is also one of the page's own share images is taken only after the home page is read and its share images do not include it (compared without `www.` and the query string). If the home page cannot be read the picture is not taken and the search is unfinished. Addresses whose path names a share card (`opengraph`, `og`, `twitter`, `social`, `share` as a word in any path segment) are never candidates. A real photo that a page lists both as `og:image` and in structured data is still taken.
- D22 (QA N2). The generic picture words are cut to words that are not part of names: photo, photos, image, images, picture, pictures, pic, of, the, a, an, exterior, interior. A numeral counts only directly after photo, image, picture or pic ("photo 1"). "Harbour House View", "Main Street Cafe", "1 Hyde Park" and "Harbour House Building 2" tie nothing.
- D23 (QA N3). The blank check samples the picture at 512 pixels on its longer side, so a thin or small object on a plain background is not mistaken for a blank picture. A blank picture gets its own message: `That picture looks blank, so Radar didn’t use it. Try another one.`
- D24. A search is finished only when the list of pages was read: with no crawled candidate and a sitemap that gave no answer or a 5xx, the miss is not remembered, whatever robots.txt answered. `tagged`, `label` and `labels` path segments are listings too.
- Accepted: generic picture words are English only (fewer automatic pictures by alt text on other-language sites; structured data still works); `/collections/` and `/t/` paths rely on the picture rules.
