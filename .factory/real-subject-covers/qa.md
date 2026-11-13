# Independent QA (T4): real subject covers

QA record, 2026-11-13. QA edited no source file. Probes and evidence are under `.factory/real-subject-covers/qa/`.

## Verdict
**Do not ship the automatic path as it is: two major defects in automatic matching (D1, D2).** Each puts a picture that is not the subject's on an article with the label "Radar found this picture of {subject}", and under Autopilot it is published unseen (decision D10). Everything else that was run passes: the fetch guard, the domain rule, the decoder in its child process, the owner action, the record, precedence, the switch back, publishing payloads and the Media panel. Four minor defects (D3 to D6) can ship if the PM accepts them.

No third-party site, model provider or production system was contacted. The success of a model-style switch back (a real image model answering) was not exercised.

## Revision and environment
- Worktree `.claude/worktrees/cool-dirac-60b241`, branch `kenny-dev/cool-dirac-60b241`, `git rev-parse HEAD` = `aa16969fa4204b16ef29d4c8c28cc35cfadc03d3` (source last changed in `fe1b91b8`), base `691806da`. Tree clean at the start. At the end only `.factory/real-subject-covers/qa/` and this file are new; **both are uncommitted**.
- macOS (darwin arm64), Node 22.18.0, `@napi-rs/canvas` 0.1.100, undici 7.30.1 (npm) with Node's built-in fetch. Throwaway Postgres at 127.0.0.1:55442. QA's databases: `radar_qa` (whole suite), `radar_qa_probe` (QA probes), `radar_qa_app` (browser). `radar_base` and `radar_test` were not used. The three QA databases are left in place.
- App for the browser checks: `http://127.0.0.1:3231`, Next dev plus the worker, `RADAR_DEV_STUBS=1`, `RADAR_BILLING=off`, every provider key blank (`qa/browser-setup.mjs`, `qa/browser-serve.mjs`). Business domain `harbour-stays-qa.test`, answered by the dev stub site.
- Browser: the Claude desktop app's built-in browser pane (`mcp__Claude_Browser__*`), a real tab driven with real clicks and typing, at 1280×900 and 390×844. Synthetic Owner, Editor and Viewer; sessions were provisioned in the QA database and the session cookie set in the tab. No password was typed. The browser profile already held an HttpOnly `radar_session` cookie for `localhost` that is not QA's; it was not touched, and the app was opened on `127.0.0.1` instead. QA's own cookies were removed afterwards.
- Side effects undone: `next dev` with `NEXT_DIST_DIR=.next-qa-realcover` rewrote `tsconfig.json` (restored with `git checkout -- tsconfig.json`); `.next-qa-realcover`, `.data/real-subject-covers` (held the synthetic session tokens) and the test storage folders were removed; the web server and worker were stopped.

## Commands and counts
| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | pass (exit 0) |
| Whole suite, fresh `radar_qa` | `DATABASE_URL=…/radar_qa npx vitest run` | **3494 passed, 75 skipped, 11 failed** in 3 files (210 files: 195 passed, 12 skipped, 3 failed). Failures: `src/server/ai/openrouter.qa.test.ts` parity snapshot (1, the known baseline failure), `src/server/services/lifecycle/autopilotIntro.test.ts` (2), `src/server/services/lifecycle/education.test.ts` (8) |
| The two lifecycle files, each alone, same database | `npx vitest run <file>` | both pass (17/17, 27/27). Neither is touched by this change (`git diff 691806da..HEAD` has nothing under `lifecycle/` or `ai/`). Classified as the known shared-database flakiness, not regressions |
| Against the baseline | | main: 3071 passed, 75 skipped, 1 failed. Here: 423 more passing tests, the same 75 skipped, the same 1 parity failure, no regression found |
| QA probes | `DATABASE_URL=…/radar_qa_probe node --expose-gc node_modules/vitest/vitest.mjs run --config .factory/real-subject-covers/qa/vitest.config.ts` | 6 files, 342 tests: **325 passed, 17 failed**. The 17 are left failing on purpose: each is a defect or an observation below (14 in `matching.db.qa.test.ts`, 2 in `picture.qa.test.ts`, 1 in `action.db.qa.test.ts`) |

QA probe files (all under `.factory/real-subject-covers/qa/`):

| File | What it runs | Result |
| --- | --- | --- |
| `ownsite.qa.test.ts` | the domain rule, 98 adversarial addresses | 98 pass |
| `guard.qa.test.ts` | `fetchOwn` with `fetch` replaced, production branch | 79 pass |
| `wire.qa.test.ts` | `fetchOwn` over real sockets to a local HTTPS server made by the test; the real `publicDispatcher` against a name that resolves to loopback | 10 pass |
| `picture.qa.test.ts` | `probeImage`, `readPicture` and the real decoder child, about 60 made-up files | 61 pass, 2 fail (D4) |
| `matching.db.qa.test.ts` | the real `findSubjectPicture` and `pictureFromAddress` over a made-up site (real `fetchOwn`, page reader, decoder; real `crawl_pages`) | 38 pass, 14 fail (D1, D2, D3) |
| `action.db.qa.test.ts` | the actions through the real route in stub mode with nothing in the feature replaced (stub site, real decoder, disk storage, real template and "no model" error) | 39 pass, 1 fail (D5) |

Evidence (text only): `qa/evidence/{matching-outcomes,picture-outcomes,action-outcomes,browser-observations,child-memory,wire-bombs,live-route-authorization}.txt`, `qa/evidence/wire-headers.json`.

## Defects

### D1 (major, AC5): automatic matching takes another subject's picture when one name is the start of another
Revision `aa16969f`. Two independent causes; either is enough.

**a. A page is confirmed by the lead of its `<title>` alone, although its h1 names something else.** `titleLead` cuts at ` - `, `, `, `: `, ` | ` and others, and `namesSubject` accepts any one name.
- Steps (probe Q3, `matching.db.qa.test.ts`): subject "Harbour House" (building). The site has `/places/harbour-house-annex` with `<title>Harbour House - Annex | Stays</title>`, `<h1>Harbour House Annex</h1>`, `<img alt="Harbour House Annex" src="/media/annex.png">`, and no plain Harbour House page. Call `findSubjectPicture`.
- Expected: no picture (architecture §4.4 row 2: "Wasl 611 Tower B" is not the page for "Wasl 611"; "on any doubt … a generated cover").
- Actual: `picture.src = https://stays.test/media/annex.png`, `searched: true`.
- Same with `<title>Harbour House, Annex wing</title>` (Q4). Same when the right page exists but its only photo is on a CDN: the search falls through to the Annex page as second candidate and takes its picture (Q22).

**b. A picture is "tied to the subject" when its alt text merely contains the subject's words**, so "Harbour House Annex" ties to "Harbour House".
- Steps (Q1): the right page (`<h1>Harbour House</h1>`), whose own photo has alt "Photo 1", followed by a "Similar places" card `<img alt="Harbour House Annex · photo 1" src="/media/annex.png" width="800" height="600">`.
- Expected: no picture. Actual: the Annex picture.
- Q21: the place's own photo is correctly labelled (`alt="Harbour House · photo 1"`) but a carousel card with alt "Harbour House Annex" comes earlier in the page. Expected the place's own photo; actual the Annex picture (document order wins).

Evidence: `qa/evidence/matching-outcomes.txt` lines Q1, Q3, Q4, Q21, Q22. Controls that behave: Q23 (the stub site's own Annex near miss, title "Harbour House Annex — Stays") and every §4.4 row.

### D2 (major, AC5 and decision D3): a site-wide or generated share card is taken as the picture of the subject
The only test of a share image is string equality with the home page's share addresses.
- Q7: the subject's page has `og:image` `https://stays.test/og.png?v=2`, the home page `https://stays.test/og.png`. The same file. Expected: not taken (D3: "a share image equal to the home page's is never taken"). Actual: taken.
- Q6: the home page has its own card (`/home-hero.png`) and every other page the default `/share.png`. Actual: `/share.png` becomes the cover.
- Q20: the page's photos are on a CDN and its `og:image` is a per-page generated title card (`/places/harbour-house/opengraph-image?3f2a`, the usual Next.js arrangement; the home page has `/opengraph-image?91bc`). Actual: the title card becomes the cover "of Harbour House". This combination (own-domain generated card, photos elsewhere) is exactly the kind of site architecture §2 expects to be common.
- Q8 (apex and `www` forms of the same card) behaves the same; it is the least likely of the four.

D3 as worded only covers equality, so Q6 and Q20 are a gap in the decision as much as in the code; Q7 fails the decision as written. Evidence: `matching-outcomes.txt` lines Q6, Q7, Q8, Q20.

### D3 (minor, AC5): pages that are not the subject's page are accepted
Same probes, lower likelihood or lower harm: a blog post outside the known path prefixes with no `og:type` (`/harbour-house-review`, title "Harbour House: our honest review": its chart is taken, Q5); a tag archive `/tag/harbour-house` (Q18); an area page with no listing markup where every card's alt ends "— Dubai Marina" (first card taken for the subject "Dubai Marina", Q9); JSON-LD of type `Review` named after the subject, carrying the reviewer's photo (Q10). Q2 (alt "The old mill, five minutes from Harbour House") is the residual risk the architecture already accepts (§14 risk 4) and is listed only for completeness.

### D4 (minor, AC3 and decision D1): a damaged file with an intact start and end is accepted and becomes a blank or partial cover
`complete` checks only the header and the trailer. Steps: call `readPicture` with any of these (all made in `picture.qa.test.ts`; the first two fail there, the others are recorded in `picture-outcomes.txt`).

| File | Result |
| --- | --- |
| PNG whose IDAT is not a zlib stream | accepted; cover entirely white |
| PNG whose IDAT holds 10 of 900 rows | accepted; cover entirely black |
| PNG with its middle third overwritten | accepted; top third picture, the rest white |
| JPEG with its scan data zeroed | accepted; cover entirely grey |
| WebP (VP8L signature, then garbage) | accepted; **cover entirely transparent** |
| WebP with its second half zeroed | accepted; **lower half transparent** |

Expected: `not_a_picture`. The two WebP cases also contradict the draw rule's own purpose (no transparent area in a cover). Truncated files, the common real failure, are refused correctly. Nothing crashed: every malformed file that reached the decoder gave an answer.

### D5 (minor, AC4): the picture's own alt text is lost when the page also lists the picture in structured data
Steps: article with no subject; owner action with `https://{domain}/places/harbour-house` (stub page: JSON-LD `image` and `<img alt="Harbour House · photo 1">` with the same address). Expected (architecture §5): alt "Harbour House · photo 1". Actual: the article title. Cause: the structured-data entry comes first with an empty alt and the `<img>` duplicate is dropped. The engineer's test passes because it replaces `pictureFromAddress`. Evidence: the one failing test in `action.db.qa.test.ts`; `action-outcomes.txt` "payload image, real cover".

### D6 (minor, AC5): a site that cannot be reached at all is remembered as "nothing found" for seven days
Steps: `findSubjectPicture` with every request failing (robots.txt and sitemap both unreachable, no crawled page). Expected `searched: false` (architecture §4.3: only a finished search is remembered). Actual `searched: true`, so the draft stores `realCoverMiss` and the next rewrite within a week does not look. Evidence: `matching-outcomes.txt` "every request throws".

## Acceptance coverage
| AC | Result | Evidence |
| --- | --- | --- |
| AC1 owner action | **pass** | `action.db.qa.test.ts` through the route: page, picture and path-only addresses; stored 1200×628 PNG under `{bid}/hero/`; Owner, Admin, Editor allowed; Viewer 403, stranger 404, signed out 401, another business's entry 404, each with no request to the site; scheduled (with and without a remote), publishing, published, failed-with-remote, queued or running draft and body-image work refused with no request; the lock, status and active work are checked again when saving (scheduled or drafted during the fetch: refused, cover unchanged); 31st attempt 429 with no request, another business unaffected; two requests at once: one 200, one 409. Live app: `live-route-authorization.txt`. Browser B2, B4, B12 |
| AC2 domain rule | **pass** | `ownsite.qa.test.ts` (look-alikes, userinfo, every port, schemes, `http` upgraded, backslashes, control characters, IP forms, IDN); `guard.qa.test.ts` (16 hostile `Location` values: none requested); `matching.db.qa.test.ts` (off-site pictures never requested: the test `fetch` throws on any other host). Empty userinfo (`https://@lived.ae/`) is accepted and lands on the business host with no credentials: not a defect |
| AC3 fetch guard | **pass**, with D4 | Internal addresses as the "domain" and as redirect targets (IPv4, IPv6, mapped, decimal, hex, octal, `localhost`, metadata hosts): no request. Real sockets: the real dispatcher refuses `qa.localhost` (resolves to 127.0.0.1 and ::1) before connecting; a redirect off-site or to 127.0.0.1 makes no connection. 3 redirects followed, the 4th not; 12-request budget; one deadline covers a dripping body and a silent server. Oversize declared: refused with no read; streamed 9 MB, endless stream, chunked 64 MB: `too_large` and the connection dropped; 300 MB gzip and brotli bodies (305 KB and 57 KB on the wire): `too_large` in about 20 ms, memory grew 19 to 26 MB. Wrong header type, SVG under an image header, GIF, BMP, AVIF, HTML, truncated JPEG/PNG/WebP, animated WebP (flagged, and unflagged with animation chunks): refused. 10,000×10,000, 5,001×5,000, 10,001×100 and 4-billion-pixel headers: `too_large` with **no child process started**. A WebP whose container says 1000×700 around a 36 MP picture: refused. Good JPEG, PNG, WebP decode; EXIF rotation applied. Wire headers: host, connection, user-agent, accept, accept-language, sec-fetch-mode, accept-encoding only; no cookie, authorization, referer or origin; a cookie set on one hop is not replayed (`wire-headers.json`) |
| AC3 decoder child (D12) | **pass** | The PNG with IHDR and IEND and no IDAT, and 11 other malformed files that pass the header checks: `not_a_picture`, the test process survives (typecheck also passes with the QA files in the tree). Child options: env keys `PATH`, `NODE_ENV` only, stdio `pipe, pipe, ignore`, no shell. Ten at once: one child alive at a time, each with its own answer. A hung child: killed at 20 s, `not_a_picture`, gone from the process table, the next picture then decodes. A 7.65 MB noise PNG passes through stdin and back. Largest allowed picture (25 MP RGBA): child peak 190 MB, 0.2 s (`child-memory.txt`) |
| AC4 record | **pass**, with D5 | Stored record `by, url, page, src, at, w, h, fit` (and `subject` for Radar); `page` null for a picture address; alt is the subject or the title, never "Illustration of…"; an owner's alt kept; `placeholder` removed; autosave cannot set `real`, `noReal`, `realCoverMiss`, `url` (forged patches through the route) |
| AC5 automatic match | **fail** (D1, D2; D3, D6 minor) | All 13 rows of §4.4 pass. Never throws (every request failing, garbage everywhere); 1.5 s budget honoured in 1.5 s; at most 12 requests with a 50-file sitemap index and redirect chains; 60,000-address sitemap and a 3.5 MB page in 0.4 s; robots.txt rules for the page and for the picture obeyed; crawled pages of another business and off-site rows ignored. Browser B9, B10 |
| AC6 precedence | **pass** | Rewrite keeps a real cover (browser B9); a typed direction prevents automatic use (B11); after the switch back a rewrite does not bring the picture back (B9); a style change never renders over a real cover (every style, `action.db.qa.test.ts`, B6); failed generation keeps the picture (B7). `modelRequired` was not exercised by QA (engineer's `draft.realCover.test.ts` covers it) |
| AC7 Media panel | **pass** | `browser-observations.txt` B1 to B20: copy as architecture §8; eight error messages inline and not as toasts; source link; hints; hidden buttons; no flash on a style change; both switch-back outcomes; Viewer; scheduled; 390 px; Enter; keyboard; slow fetch and moving on; existing placeholder notice, Regenerate and Generate from prompt unchanged |
| AC8 publishing | **pass** at payload level | A real cover and a generated cover build payloads with identical key shape; `image.url` is the stored file, `image.alt` the new alt, `bytes()` a complete 1200×628 `image/png` with the same file name rule; building the payload does not change the article; an article with none of the new fields gets, saves and builds as before; no SQL migration in the diff. No real connector was called |
| AC9 | not applicable | out by decision D6 |
| AC10 dev stubs | **pass** | Every stub address in §10 behaves as written, through the route and in the browser, offline |
| AC11 tests | **pass**, with a gap | Typecheck and suite as above. The engineer's matching tests cover §4.4 but none of D1 to D3; their action tests replace `pictureFromAddress`, which hides D5 |

Messages of §7.2 seen with their exact text: `invalid_address`, `not_your_site`, `unreachable`, `no_picture`, `too_large`, `too_small`, `not_a_picture` (route and browser), `rate_limited`, `image_failed`, `article_changed` (route). `left_site` and `off_site_picture` cannot be produced by the stub site: their codes were seen from `pictureFromAddress` and `fetchOwn`, their message text only in the engineer's test.

## Observations (not defects)
1. One decode at a time per process: a child that hangs holds every other business's picture in that process for up to 20 s. No real file was found that hangs the decoder; the hourly limit bounds one business to 30.
2. The decoder child peaks at about 190 MB for the largest allowed picture, outside the web process.
3. After a rewrite, an existing reviewed generated cover that Radar directed is replaced by a real picture when one is found (architecture §4.1). After deploy this applies to articles drafted before the change.
4. An alt typed before `altBy` existed cannot be told from Radar's and is replaced by the owner action (seen on the legacy fixture: "Legacy cover alt" became the title).
5. When the action finishes after the person moved to another article: a success shows the toast with no article named; a failure shows nothing anywhere.
6. After a keyboard submit succeeds, focus falls to the page body (the button disables itself).
7. "Use a generated cover instead" failing in a model style shows its error as a toast and inline; the inline copy is below the fold at 1280×900. Existing `generateCover` behaviour.
8. A very long source address is shown whole (nine lines for 466 characters at both widths).
9. `www.example.com:443/a.jpg` typed without a scheme is refused as invalid (the text is read as a scheme); with `https://` it is accepted.
10. Status 206 is treated as a normal answer; the completeness check is what stops a partial file.
11. A page address whose HTML is over 8 MB is answered "That picture is too large".
12. `.data/uploads` and `.data/autopilot-tests` exist in the worktree (git-ignored); QA did not create or remove them knowingly.

## Not tested
- A production build (`next build`, `next start`) and Linux: the child process, WebP, EXIF and blur were run on darwin arm64 under `next dev` and vitest only.
- Any real website, including the one in the original report; any real image model (the model-style switch back succeeding, and whether a generated cover after a switch back is contextual); any real connector or a real publish.
- Autopilot end to end (the draft job is the same code; the publish-unseen path was not run).
- DNS rebinding beyond a name that resolves to loopback (relies on `publicNetwork.test.ts`).
- `modelRequired` precedence, the body-image job with a real cover, mixed old and new versions, an old browser bundle, a revert.
- Screen readers, Safari and Firefox, dark and light theme differences, the 31st attempt and the conflict message in the browser.
- AC9 (out).

## Release recommendation
Do not ship with automatic matching as it is. D1 and D2 are reproducible with ordinary page shapes and end in the wrong picture being presented as the subject, unseen under Autopilot. The owner action, the guard and the panel are sound and could ship without the automatic path if the PM prefers to split. After a fix, rerun `matching.db.qa.test.ts` (Q1, Q3, Q4, Q6, Q7, Q20, Q21, Q22 must find nothing or the right picture; the controls and §4.4 rows must stay as they are) and the whole suite on the new revision.
