# Independent QA (T4): real subject covers

QA record, 2026-11-13. QA edited no source file. Probes and evidence are under `.factory/real-subject-covers/qa/`.

# Round 3 (T4c), revision `9e7683c6`

## Verdict, round 3
**Ship.** N1, N2 and N3 are closed, every round-1 and round-2 case stays closed, all 494 QA probes pass, typecheck passes, and the whole suite has only the one known baseline failure. No defect is open. What remains are accepted limits, listed below, and the points the owner should know before the automatic path goes live.

## Revision and environment, round 3
- Same worktree and branch, `git rev-parse HEAD` = `9e7683c600ad35799d94c60afbaab8e51fae257b`. Source changed since round 2 only in `src/server/services/realCover/{fetch,index,page,picture}.ts`, one line in `src/server/actions/article.ts` (the `blank_picture` message), their tests, `docs/CONTRACTS.md`, `DIVERGENCES.md`. No client file changed.
- Databases on 127.0.0.1:55442: `radar_qa3` (whole suite, fresh), `radar_qa_probe` (probes), `radar_qa_app` (browser, dropped and reseeded). All left in place, with `radar_qa` and `radar_qa2` from the earlier rounds.
- Browser as before (built-in pane, `http://127.0.0.1:3231`, stub mode). Servers stopped, `tsconfig.json` restored, dist folder and scratch data removed, QA cookie cleared.
- QA files changed in this round are **uncommitted** (the three probe files, evidence files, this file).

## Commands and counts, round 3
| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass (exit 0), with the changed QA files |
| `DATABASE_URL=…/radar_qa3 npx vitest run` | **3673 passed, 75 skipped, 1 failed**: the parity snapshot in `src/server/ai/openrouter.qa.test.ts` (the known baseline failure). No flaky file failed in this run |
| Against the baseline (main: 3071 / 75 / 1) | 602 more passing tests, same 75 skipped, same 1 failure, no regression found |
| QA probes, same command as before | 6 files, **494 tests, 494 passed** |

## Round-2 findings
| Finding | Status | Evidence |
| --- | --- | --- |
| N1 share card through structured data or an `<img>` | **closed** | S3, S4, S5 find nothing. Thirteen addresses with a card word (`/og.png`, `/OG.PNG`, `/images/og/…`, `/opengraph-image`, `/api/og?…`, `/social/…`, `/uploads/share/…`, `…-twitter.png`, `/static/social_card.png`, `/lived-social-preview.png` and others) are never requested. Six cards with no card word in their name that the home page also carries (`/assets/brand-banner.png`, `/ogimage.png`, `/socialcard.png`, `/images/preview.png`, `/sharing/hh.png`, `/seo/card.png`): not taken, also when the home page names them under `www.` or with a cache-buster. Home page unreadable (no answer, 503, 404, not HTML): not taken and `searched: false`. Control S6 and the D21 control: a real photo that is both `og:image` and the structured-data image is still taken, after the home page is read; a picture that is not a share image costs no extra request |
| N2 neighbours named "subject + picture word", number in front | **closed** | A13 to A18 and "The View Gallery" find nothing; so do "Harbour House Front", "Harbour House Cover", "Harbour House Interiors", "Photo of 1 Hyde Park". Controls that still tie: "Harbour House", "Harbour House · photo 3", "Wasl 611 photo 2", "Exterior of Harbour House", "An interior photo of the Harbour House", "Harbour House – picture 4", "Photos: Harbour House" |
| N3 blank check refuses thin or small objects | **closed** | The pen, the necklace, the 36×36 product and the fine weave are accepted. Bars 900×10 and 10×700, a 900×3 hairline, 36×36 and 12×12 squares: accepted at all twelve positions each. The same shapes in a 4800×2700 source: accepted. Blank pictures (flat PNG, JPEG, WebP, fully transparent, grey stand-in, two colours 7 apart, and the four damaged files that decode blank) are refused as `blank_picture`; truncated, wrong-type, too-small, too-large and no-IDAT files keep their own codes |
| D24 sitemap decides "finished" | as decided | robots 200 with the sitemap giving no answer or a 503: `searched: false`; robots unreachable with the sitemap 404: `true`; an off-site sitemap named in robots.txt with the own-site one down: `false`; two own-site sitemaps, one 503 and one read: `true` |
| Listing segments `tagged`, `label`, `labels` | as decided | not requested |
| `blank_picture` message | as decided | through the real route: 422 `blank_picture`, "That picture looks blank, so Radar didn’t use it. Try another one." (`action-outcomes.txt`) |

## What QA changed in its own probes (round 3)
- `picture.qa.test.ts`: the expected code is now `blank_picture` in the eleven cases whose picture decodes blank (six "D18 blank" cases, the 25 MP of zeros, IDAT not zlib, IDAT with 10 of 900 rows, zeroed JPEG scan, VP8L garbage). Two of those (10 rows, zeroed scan) had loose expectations since round 1 and are now exact. No case refused for another reason was changed. Added: thin objects at twelve positions, larger sources, and a check that other refusals keep their codes.
- `matching.db.qa.test.ts`: **A21 and A22 are kept and turned into "ties nothing" cases** (they were controls in round 2; decision D22 accepts the loss). The mixed robots and sitemap cases and the `tagged`/`label` paths, recorded in round 2, are asserted now. Added: A28 to A36, the D21 section (control, unreadable home page, card words, card words inside longer words, cards with no card word), residual routes L1 to L5 (recorded), an owner-path case for card words.
- `action.db.qa.test.ts`: one case for the blank message. The stub site serves no blank picture, so QA's existing wrapper around the stub site answers a flat 1600×900 PNG for `/media/qa-blank.png`; everything after the fetch is real.

## The engineer's stated consequences
| Consequence | QA's view |
| --- | --- |
| A page's `og:image` whose address has a card word is not offered when the owner gives a page address; the picture's own address still works | Confirmed both halves (`/uploads/social/harbour-house.png`: page address `no_picture`, picture address accepted). Acceptable: the message already tells the owner to try the picture's address |
| "Wasl 611 – image 12 of 30" no longer ties | Confirmed (A28). Safe side |
| A robots-forbidden home page leaves `searched` true | Confirmed: not taken, home page not requested, remembered for a week. Acceptable: robots.txt will not change by itself |
| A sitemap index that answers counts as read when its child files do not | Confirmed (index 200, both children 503: `searched: true`). A narrow case of the round-1 D6; accepted limit |
| Card words inside longer words are not skipped | Confirmed for `blog-media`, `shared-house`, `dogs`, `together`, `catalog`, `frogs`, `sharepoint`, `socialite`, `ogden`, `twitterati`, `shares`, `og2`: all taken as ordinary pictures |

## Accepted limits (no wrong picture is plausible enough to hold the release)
1. **The site's own structured data names a generic banner as the subject's image, and the name and the home page do not give it away** (recorded as L1 to L4, all taken): the banner has none of the five card words in its address **and** one of: the home page carries a different card (L1), the home page carries none (L2), the subject's page has no share tags at all (L3), or the page serves the card through an image optimiser so the card word is only in the query string (L4). Each needs the site to state, in its own data for that place, that the banner is its image; this is architecture §14 risk 4 ("the rule trusts the site about its own subject page"). The result would be the business's own banner, not another subject's photo.
2. **Safe-side misses** (a generated cover where a real one existed): pictures all served from one path with the picture named in the query (`/api/media?id=…`) when the page's share image uses the same path (L5); alt text in another language; alts such as "Exterior view of the Harbour House building" (A21, A22, A28); a real photo kept in a folder called `share`, `social`, `og`, `twitter` or `opengraph`; a robots-forbidden or unreadable home page when the photo is also the share image; pages whose h1 is not exactly the subject.
3. A file damaged part of the way through that still decodes to a partly blank picture (decision D18).
4. `/collections/` and `/t/` paths rely on the picture rules; a sitemap index whose children fail counts as read.
5. Round-1 observations 1 to 7 and round-2 observations, unchanged.

## What the owner should know about the remaining ways a wrong picture could appear
1. **Radar believes the site about its own page.** If the page whose main heading is exactly the subject's name shows a picture of something else under an alt text that is exactly that name, or its structured data for that subject points at another image (including a generic banner, limit 1 above), Radar uses it.
2. **Same name, different thing.** Two places or products with exactly the same name on one site, or a page whose heading is only the subject's name while it is really about a part or variant of it, cannot be told apart.
3. **A partly damaged photo** on the site can become a cover with a blank band.
4. **Nobody looks first under Autopilot** (decision D10): in each case above the picture is published with the article. The Media panel always shows the source, and one click returns to a generated cover and keeps the picture from coming back.
5. **Rights are not checked.** "On the domain given at sign-up" stands in for "theirs to publish"; the domain is not verified.
6. Many sites will get no automatic picture at all (pictures on another host, other-language alt text, headings that differ from the subject's name). That is the safe direction, not a wrong picture.

## Not tested, round 3
- The blank-picture message **in the browser**: the stub site cannot serve a blank picture. It was checked through the real route with QA's wrapper serving one; the panel's inline display of a server message for this field was seen with another code.
- As in rounds 1 and 2: a production build (`next build`, `next start`), Linux, any real website, a real image model, a real connector or publish, Autopilot end to end, mixed versions, screen readers, Safari and Firefox. Viewer, scheduled, 390 px and the rest of the round-1 browser list were not repeated (no client change since round 1).

## Release recommendation, round 3
Ship, with the owner told the six points above in the pull request. No further QA round is needed unless the matching or picture rules change again; if they do, rerun the probe command and the suite.

---

# Round 2 (T4b), revision `2b034f26`

## Verdict, round 2
**Every round-1 defect (D1 to D6) is closed.** Typecheck passes and the suite shows no regression. **Not yet a clean ship for the automatic path: three new findings (N1 to N3), none as broad as round 1.** N1 is the one that matters: the site's share card still reaches the automatic path when the page's structured data names it as the subject's image. N1 and N2 are gaps in the decisions (D16, D15) as much as in the code, so they need the PM's ruling: fix (both are small rule changes) or accept in writing. The owner action, guard, record, switch back and panel pass as before.

## Revision and environment, round 2
- Same worktree and branch, `git rev-parse HEAD` = `2b034f2605399e4de345bb45be7d3600361ae1e6`. Source changed since round 1 only in `src/server/services/realCover/{fetch,index,page,picture}.ts`, their tests, `devsite.test.ts`, `docs/CONTRACTS.md`, `DIVERGENCES.md`. No client file changed.
- Databases on 127.0.0.1:55442: `radar_qa2` (whole suite, fresh), `radar_qa_probe` (probes), `radar_qa_app` (browser, dropped and reseeded). All left in place.
- Browser as in round 1 (built-in pane, `http://127.0.0.1:3231`, stub mode). Servers stopped, `tsconfig.json` restored, dist folder and scratch data removed, QA cookie cleared.
- QA files changed in this round are **uncommitted** (`git status`: the two probe files, `browser-setup.mjs`, evidence files, this file).

## Commands and counts, round 2
| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | pass (exit 0), also with the changed QA files |
| `DATABASE_URL=…/radar_qa2 npx vitest run` | **3600 passed, 75 skipped, 5 failed** in 3 files: `openrouter.qa.test.ts` parity snapshot (1, known), `lifecycle/guides.test.ts` (1), `visibility/digest.integration.test.ts` (3) |
| The two flaky files alone, same database | both pass (15/15, 40/40); the change touches neither |
| Against the baseline (main: 3071 / 75 / 1) | 529 more passing tests, same 75 skipped, same 1 parity failure, no regression found |
| QA probes, same command as round 1 | 6 files, 434 tests: **420 passed, 14 failed**. All 14 are new round-2 cases (N1: 3, N2: 7, N3: 4). Every round-1 case passes |

## Round-1 defects
| Defect | Status | Evidence |
| --- | --- | --- |
| D1a title lead confirms a page | **closed** | Q3, Q4, Q22 find nothing; new R1 to R8 (two h1 either way round, h1 with a nested "Annex", image-only h1, empty h1, generic entities named for the subject, nested entity, site title as first h1): nothing taken. Controls R7, R9 still find the picture |
| D1b alt contains the subject's words | **closed** for the round-1 cases | Q1 finds nothing; Q21 now takes the place's own photo; A1 to A12 (Annex, "2", "II", "Two", floor plan, owner, map, logo, "five minutes from", "Not", "Illustration of"): nothing taken. Residue: N2 |
| D2 share card taken | **closed** for share tags | Q6, Q7, Q8, Q20, S1, S2 find nothing and the card is never requested. Residue: N1 |
| D3 not the subject's page | **closed** | Q5, Q9, Q10, Q18 find nothing; twelve tag, category, topic, author, search and archive paths are not requested at all (case-insensitive, any depth) |
| D4 damaged file becomes a blank cover | **closed** as decided | IDAT not zlib, 10 of 900 rows, zeroed JPEG scan, VP8L garbage: `not_a_picture`. Flat colour in PNG, JPEG and WebP, fully transparent, two colours 7 apart: refused. Partly damaged files are the accepted limit (D18) |
| D5 page alt lost | **closed** | `action.db.qa.test.ts` passes; browser C5 shows "Harbour House · photo 1"; relative and `http` forms of the same address match; a different query string does not (stated departure) |
| D6 unreachable site remembered | **closed** as decided | no answer or 5xx for both files: `searched: false`; 404 or 403 for both: `true` |

## New findings

### N1 (medium; major if D16 is meant without exception): the share card reaches the automatic path through structured data or an `<img>`
Revision `2b034f26`, `matching.db.qa.test.ts`, subject "Harbour House", the right page (h1 "Harbour House").
- **S3.** The page's `og:image`, `twitter:image` and `image_src` are the site default card `/og.png` (the home page's too), and its JSON-LD is `{"@type":"Place","name":"Harbour House","image":"https://stays.test/og.png"}`. Expected: no picture (D16; AC5 "a site-wide default share image is never taken"). Actual: `/og.png` is the cover.
- **S4.** The JSON-LD `image` is the page's own generated title card, the same address as its `og:image` (`/places/harbour-house/opengraph-image?3f2a`). Actual: the title card is the cover.
- **S5.** The card is also an `<img alt="Harbour House">` on the page. Actual: taken. Least likely of the three.
- Control S6: `og:image` and JSON-LD both name the place's real photo: taken, correctly. So "never take an address that is also a share image" would be the wrong fix.

Templates that fill `og:image` and schema `image` from one value, with the site card as the fallback when a page has no photo, produce S3 exactly. The outcome is the one round-1 D2 described: the business's card, labelled "Radar found this picture of Harbour House", published unseen under Autopilot.

### N2 (minor to medium, a gap in D15 as worded): a neighbour whose name is the subject's plus a "generic picture word", or a number in front
D15 lets an alt carry numerals and generic picture words. Several of those words are common in names. On the subject's own page, with the subject's own photo not tied (generic alt) or later in the page, a second picture with these alts is taken:

| Subject | Alt of the other picture | Result |
| --- | --- | --- |
| Harbour House | "Harbour House View" (A13) | taken |
| Harbour House | "Harbour House Gallery" (A14) | taken |
| Street Cafe | "Main Street Cafe" (A15) | taken |
| Harbour House | "Harbour House Building 2" (A16) | taken |
| Hyde Park | "1 Hyde Park" (A17) | taken |
| Park | "Park View" (A18) | taken |
| The View | "The View Gallery" | taken |

Expected in each: nothing. The words that cause it are `view`, `gallery`, `main`, `building`, `front`, `cover`, `hero` in `GENERIC_PICTURE_WORDS`, and a numeral before the name. The implementation follows D15 as written; the decision's list is what lets these through. Needs a specific page shape, so narrower than round-1 D1b.

### N3 (minor): the blank check refuses real pictures of one thin or small object on a plain background
D18 itself is sound and I do not ask for it to change: a flat-colour picture is not a cover. The implementation looks at the picture drawn 32 by 32 without averaging, so it sees about one point in every 50 by 28 pixels, and a thin object falls between the points.
- Steps: `readPicture` with a 1600×900 white PNG carrying one dark object (`picture.qa.test.ts`, "D18 real picture"; rates in `qa/evidence/blank-check-false-refusals.txt`, twelve positions each).

| Picture | Refused as blank |
| --- | --- |
| horizontal bar 900×10 (a pen, a cable) | 6 of 12 positions |
| horizontal bar 900×20 | 3 of 12 |
| vertical bar 10×700 (a lamp post) | 9 of 12 |
| square 36×36 (a small product) | 2 of 12 |
| square 60×60 | 0 of 12 |
| a 3 px circle outline (a necklace) | refused |
| a swatch with a fine weave (alternate pixels 12 levels apart) | refused |

- Expected: accepted. Actual: `not_a_picture`, and the owner is told "That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP." about a valid PNG.
- Not affected: a 120×120 product on white, a transparent cut-out, a floor plan, a twelve-stroke sketch, a page of small text, fog ten levels deep, a night sky. The automatic path fails safe (a generated cover); the owner action is where it shows.

## The engineer's stated departures
| Departure | QA's view |
| --- | --- |
| A numeral directly after the name does not tie ("Marina Gate 2"; costs "Wasl 611 1") | Agree. A3 and A27 behave as stated; the cost is the safe side. Note the numeral rule does not cover a numeral before the name (A17) or after a generic word (A16): N2 |
| An h1 with no text counts as no h1 | Acceptable. R3 to R6 show the structured-data fallback does not let the Annex page through |
| D20 applies only to robots.txt and the sitemap | As decided, with one case to know: robots.txt answers 200 and the sitemap gives no answer or a 503 (the only list of pages was never read): `searched: true`, remembered for a week. Recorded, not asserted. Also a robots.txt naming only an off-site sitemap with the own-site one down |
| D19 only on an exact address match | Acceptable. The same file under a sizing query string loses the alt (falls back to the title) |
| Partly damaged files still accepted | The accepted limit in D18. Rechecked on this revision with QA's own files (`qa/evidence/blank-check-false-refusals.txt`, last lines): a PNG with its middle third overwritten and a JPEG with its second half zeroed are accepted; QA's WebP with its second half zeroed was refused this time |

## Observations, round 2
1. The generic picture words are English only. On a page in another language a correct picture with alt "Foto de Harbour House", "Vue extérieure de Harbour House" or "صورة Harbour House" is not taken (A24 to A26). Safe, but automatic pictures by alt text will be rarer on non-English sites; structured data still works.
2. `/tagged/…`, `/label/…`, `/collections/…` and `/t/…` are not on the listing list; a page there whose h1 is the subject and whose picture's alt is exactly the subject is taken (recorded only; the alt rule is what protects these).
3. A site that puts its title in the first h1 of every page confirms every page whose address starts with the subject when the subject is the business's own name (R8). Nothing wrong was taken, because the picture rules still apply.
4. Browser, round 2 (`qa/evidence/browser-observations.txt`, C1 to C6): "Harbour House" gets its picture; a "Harbour House Annex" title gets the Annex page and the Annex picture, not the other; "Mill Lane Studios" is a remembered miss; the owner action with the page address now gives the alt "Harbour House · photo 1"; the picture address, one inline error and the switch back behave as in round 1.

## What QA changed in its own probes (round 2)
- `matching.db.qa.test.ts`: the stand-in "good picture" was one flat colour (`#336699`); it is now a sky gradient with three blocks. That one constant fixes both controls, Q19, Q21 and the `crawl_pages` test. No assertion changed. Added: R1 to R9 (D14), A1 to A27 and the "The View" case (D15), S1 to S6 (D16), listing paths (D17), D20 combinations, and owner-path checks for D16 and D19.
- `picture.qa.test.ts`: "5000×5000 … 25 MP of zeros" now uses a grey ramp of the same size and still asserts it is accepted at 25 MP; the all-zero file is kept as a case that must be refused. The dark portrait in the edge test has a slightly lighter block (`#182838`) in the middle; the assertion (no edge pixel brighter than 60) is unchanged. Added the D18 section (six blank files that must be refused, twelve real pictures that should be accepted).
- `browser-setup.mjs`: one more entry, "A Stay at Harbour House Annex: what to know".

## Not tested, round 2
Everything in the round-1 list still applies (production build, Linux, real sites, a real image model, a real connector, Autopilot end to end). In addition: the full round-1 browser list was not repeated (no client change); Viewer, scheduled and 390 px were not rerun; the three failure reports in the worker log of the round-2 browser run were not read before the log was removed.

## Release recommendation, round 2
The round-1 blockers are gone. Before shipping the automatic path, rule on N1 and N2: fix them, or record them as accepted limits (they would sit beside architecture §14 risk 4). N3 can ship if accepted; it is worth a fix because the message blames the owner's file. After any fix rerun `matching.db.qa.test.ts` (S3, S4, S5, A13 to A18 and "The View Gallery" must find nothing; S6, A19 to A23 and every round-1 row must stay as they are) and `picture.qa.test.ts` (the "D18 real picture" cases).

---

# Round 1, revision `aa16969f` (superseded where round 2 says so)

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
