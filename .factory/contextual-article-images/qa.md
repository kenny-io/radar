# Independent QA (T4): contextual article images

QA record, 2026-11-13. QA edited no source file. Probes and evidence are under `.factory/contextual-article-images/qa/`.

## Verdict
**Do not ship as it is: one major defect (D1).** Everything else that was run passes. Three minor defects (D2 to D4) and the observations below can ship, if the PM accepts them.

No real text or image provider was called at any point. The success path (a model answers) was checked with a faked image provider (`fetch` mocked in vitest) and the dev stub text adapter with a model-like answer written by QA. Direction quality from a real model is untested.

## Revision and environment
- Worktree `.claude/worktrees/radar-contextual-images-6eb35c`, branch `kenny-dev/radar-contextual-images-6eb35c`, `git rev-parse HEAD` = `121da10aff49ab6b5f9c881e97768f3cc83f2aef`. Tree clean before the start; after the end only `.factory/contextual-article-images/qa/` and this file are new. Base `4f1bcf83`.
- macOS, Node 22.18.0, throwaway Postgres 16 at 127.0.0.1:55432. QA's databases: `radar_qa_app` (browser), `radar_qa_tests` (focused tests and probes), `radar_qa_tests2` (whole suite). `radar_test` and `radar_pm` were not used.
- App for the browser checks: `http://127.0.0.1:3217`, Next dev plus the worker, `RADAR_DEV_STUBS=1`, `RADAR_BILLING=off`, every provider key blank (`qa/browser-setup.mjs`, `qa/browser-serve.mjs`).
- Browser: the Claude desktop app's built-in browser pane (`mcp__Claude_Browser__*`), a real tab driven with real clicks and typing, at 1024×768 and 375×812. Synthetic users (owner, viewer, owner of another business); sessions were provisioned in the QA database and the session cookie set in the tab. No password was typed.
- Side effect found and undone: `next dev` with `NEXT_DIST_DIR=.next-qa-images` rewrote `tsconfig.json` (it adds its types folder). Restored with `git checkout -- tsconfig.json`; `.next-qa-images` removed.

## Commands and counts
| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | pass (exit 0) |
| Whole suite, no database | `npx vitest run` | 2528 passed, 578 skipped, 1 failed: the parity snapshot in `src/server/ai/openrouter.qa.test.ts` (baseline; the only difference is one stored-template hash for a `branded` image) |
| Image, drafting, publishing files, fresh `radar_qa_tests` | the list in `verification.md` | 1403 passed, 75 skipped, 0 failed |
| Whole suite, fresh `radar_qa_tests2` | `DATABASE_URL=… npx vitest run` | 3033 passed, 75 skipped, 13 failed in 7 files: parity (1), `idle.cadence.db` (3), `idle.db` (1), `lifecycle/dispatch` (4), `lifecycle/education` (1), `lifecycle/founderIdentity` (2), `social/proactive.db` (1) |
| The six non-parity failing files, each alone, same database | `npx vitest run <file>` | all pass (24, 9, 14, 27, 16, 15). None is touched by this change. Classified as the known shared-database flakiness, not regressions. `lifecycle/dispatch` and `lifecycle/education` are not in the earlier lists in `state.md` or `verification.md`. |
| QA probes | `DATABASE_URL=…/radar_qa_tests npx vitest run --config .factory/contextual-article-images/qa/vitest.config.ts` | 3 files, 39 passed |

Output: `qa/evidence/{tsc,full-nodb,focused-db,full-db,full-db-reruns-alone}.txt`.

## Acceptance criteria
| AC | Verdict | Basis |
| --- | --- | --- |
| AC1 | Pass, except D1 | Browser B1, B10: the saved and shown direction comes from the article. Probe §1 (faked provider): direction names the subject; `promptBy: 'radar'`. D1 can undo it afterwards. |
| AC2 | Pass with a model-like answer; real model untested | Probe §1: cover direction and alt name "Wasl 611"; subject stored; invented numbers and subjects the article does not name are refused (`validator.txt`). Best effort, as D2 of the brief says. |
| AC3 | Pass (same limit) | Probe §1, §2: distinct section directions, one bad slot replaced on its own; near-duplicates refused. |
| AC4 | Pass | 13 failure shapes of the step (one a blown budget), empty and huge bodies: always fallback, never a throw; three whole drafts with a failing step end in `review`. |
| AC5 | Pass, with D2 | Browser B8, probe §4: typed direction kept through a rewrite, sent to the model in the pre-change wrapper, appended to body requests. |
| AC6 | Pass | Browser B1, B10; probe §5, §9, §10: no body template stored or published; message and Try again shown. |
| AC7 | Pass, with D4 | Browser B3, B4, B7, B10; probe §5, §10: mark set, shown, cleared by a success and by a template style. |
| AC8 | Pass, with D3 | Probe §6: legacy article gets a contextual direction on Regenerate and on the body-image job; cache reused. |
| AC9 | Pass, with D3 | Browser B12; probe §9: legacy rows open, edit and build the same payload; no new field appears. |
| AC10 | Pass | Browser B4 to B7; probe §8: Viewer, other business, forged autosave, locks. `ai_calls` rows for the step, ok and failed. Fetch sentence void (D6 of the brief). |
| AC11 | Pass | Counts above; real browser used. |

## The eleven requested checks
1. **Stub-mode draft in the browser: pass.** Two drafts (a named building, a general topic). Strings match architecture §7 exactly. `evidence/browser.txt` B1, B10; `browser-01-*.json`.
2. **Cover placeholder notice: pass.** Appears, Regenerate fails with the existing `image_unavailable` copy and keeps the cover, "Cover image generated" never shown, Branded graphic clears it, both states survive a reload. B3.
3. **Permissions and locks: pass.** B4 to B7 and probe §8.
4. **Owner-typed direction: pass**, see D2. B8, probe §4.
5. **Stale-state probe: fail in one variant, see D1.** Draft started from the same tab: safe (fields are disabled until the reload; B2). Draft finished without the tab knowing: the old default is saved back as the owner's direction (B9 b, c). A style-only change is safe (B9 d).
6. **Legacy articles: pass**, see D3. B12, probe §6, §9.
7. **Publishing with `bodyImages: []` and a placeholder cover: pass.** Probe §9: no `<figure`, no `<img`, no `![`; `publishEntry` returns `published`.
8. **`cleanImageDirections`: pass on safety, with observations O1 to O4.** `validator.txt`.
9. **Unchanged callers: pass.** 69,120 requests without `literal` (10 styles × 6 kinds × 8 prompts × 3 names × 2 brands × 4 seeds × 3 crop settings × absent/false) are byte-identical between `4f1bcf83` and HEAD; social, Daily Brief and owner-typed cover strings printed side by side in `prompt-parity.txt`. `src/server/services/social` and `brief` have no diff. Probe §4 shows the request a real "Generate from prompt" sends equals that string.
10. **Phone width: pass.** No overflow at 375 px. B11.
11. **Typecheck and tests: pass**, counts above.

## Defects

### D1 (major): an alt-text edit from a tab that missed the draft replaces Radar's direction with the old default and locks it as the owner's
- Criteria: AC1, AC5 (a direction nobody typed is treated as typed), AC8.
- Revision: 121da10a. Reproduced twice in the real browser, and at the action level.
- Steps (deterministic form, B9 c):
  1. Open an approved, undrafted article, Media tab. "Describe your image" reads `Calm, editorial image about <keyword>`.
  2. Make the tab miss the draft: stop the web server (or sleep the laptop, or lose the network), run `node .factory/contextual-article-images/qa/start-draft.mjs <entryId>` (queues the draft as the cron does), wait until the job is `done` and 15 more seconds, start the web server. The tab's event stream reconnects and the tab still shows the undrafted article.
  3. Type anything in **Alt text**. Do not touch the direction.
- Short form (B9 b): with stubs a draft takes about 2 s and an idle tab is told within 5 s, so typing in Alt text 2 to 3 s after another client starts the draft is enough. It worked on the first attempt.
- Expected: Radar's direction stays, `promptBy: 'radar'`; only the alt changes.
- Actual: saved `img.prompt = "Calm, editorial image about harbour court reviews"`, `promptBy: "owner"`. Radar's direction is gone. From then on a rewrite keeps the generic sentence, cover Regenerate sends it as written, and every body image request ends `Overall look the owner asked for: Calm, editorial image about …` (probe §7). Nothing on screen says so. The owner recovers only by clearing the field.
- Why: the client sends `style`, `prompt` and `alt` together on any image-field edit (`ArticleWorkspace.tsx` `setA`), and `article.save` marks the direction as the owner's whenever the sent prompt differs from the stored one (`ownerMarks`). The event stream reports a finished job for 15 s only and sends no revision on reconnect, so a tab that was away stays stale indefinitely.
- How likely in production: a real draft takes minutes, a tab that is connected learns of the job within 5 s and disables the fields until it has reloaded, and a save during the draft is refused. So it needs a tab that was disconnected when the draft finished: a sleeping laptop over the D-1 automatic draft, a network drop, or a web deploy. Rare, silent and permanent for that article. Architecture §9 lists the stale tab as an existing race; before this change the same save rewrote the same default sentence and did no harm.
- Evidence: `evidence/browser-05-stale-tab-after-alt-edit.json`, `evidence/browser.txt` B9, `evidence/pipeline.txt` §7.

### D2 (minor): the cover alt keeps describing Radar's scene after the owner replaces the direction
- Criteria: AC2, AC5. Steps: draft (alt becomes "Illustration of Wasl 611 seen from its entrance gate"), type a different direction, "Generate from prompt". Expected: an alt that fits the new picture, or an empty one. Actual: the old scene's alt stays on the new cover and is published as its alt. Before this change the alt was a general sentence from `article.meta`. Evidence: `pipeline.txt` §4.

### D3 (minor): an alt text typed before this change is overwritten by Rewrite and by Regenerate
- Criteria: AC9. A legacy article with the default direction and a hand-written alt (there is no `altBy` for it) gets the direction's alt on the next "Rewrite from brief" or model-style Regenerate. At `4f1bcf83` a non-empty alt was never replaced. The design does this on purpose (§6.1, §6.2) but §11 does not list it. Evidence: `pipeline.txt` §6 and §11 (a).

### D4 (minor): a placeholder cover drawn at publish time is marked in the data and never shown
- Criterion: AC7. `heroImage()` writes `img.url` and `img.placeholder` but not `img.urlKey`; the workspace shows the notice only when `urlKey` matches. Seeded in that exact state (B13): no notice, and the Media tab draws a live template instead of the stored file. Architecture §5.6 says the mark is written "so the editor shows the truth afterwards". Reach is small: a model-style article whose cover is missing at publish time, already locked.

## Observations (no defect raised)
- O1. False rejections by the wording pattern. Any direction containing `label`, `logo`, `chart`, `graph`, `caption`, `headline`, `diagram`, `abstract` or `conceptual` in an ordinary sense is replaced by the built-in direction: "a blank luggage label", "no logo on the facade", "graph paper", "abstract paintings", a building called "Chart House", a `27"` monitor. The subject is still named through the title. A business whose topic is one of those words (labels, logos, charts) will get built-in directions for most slots, and when every slot is refused the set is not cached, so the text call repeats on each regeneration. `validator.txt`, "FALSE-REJECTION PROBES".
- O2. False accepts: single-quoted wording, "the word SALE painted across the glass", "house rules written on it", a price-list poster, an icon collage, a split screen. The image prompt still forbids words. `validator.txt`, "FALSE-ACCEPT PROBES".
- O3. Subject matching is exact apart from case and spaces: `Queen's Wharf Tower` (straight apostrophe) against `Queen’s Wharf Tower` in the article drops the subject. Spelled-out and non-ASCII numbers are not checked. Two identical non-Latin directions are not seen as duplicates (directions are meant to be English).
- O4. For a non-English article the forced alt and the built-in alt are English ("Illustration of وصل 611", "Illustration for <title>").
- O5. With no usable image model, each Regenerate click and each body-image job attempt on an article with no cached directions makes the text call first and throws its result away (2 clicks: 2 calls; one "Add body images": 2 calls). `pipeline.txt` §11 (b).
- O6. Before the first draft the hint already says "Radar writes this from your article" above `Calm, editorial image about <keyword>`.
- O7. After pressing Enter on the notice's Regenerate, keyboard focus drops to `<body>` (the button is disabled while loading), and the inline error is 450 to 540 px below the button; the toast covers sighted users. Scheduled and published articles show a disabled "Try again".
- O8. `cleanImageDirections` itself throws on `null` and on `sections: [null]`; `resolveImageDirections` absorbs both. It does not cap direction length (the schema does, at 400).

## Untested
- Any real provider: direction quality, literal prompts, real pictures. No key exists in this workspace.
- Production data and deployment; Autopilot publishing a flagged article end to end; S3 storage.
- Screen readers (roles and focus were read from the DOM only). Browsers other than the built-in Chromium pane.
- The Editor and Admin roles in the browser (Owner and Viewer were used).

## Left behind
- Processes: none. Web and worker on 3217 were stopped; port 3217 is free.
- Databases on 127.0.0.1:55432, created by QA and kept for retesting: `radar_qa_app`, `radar_qa_tests`, `radar_qa_tests2`. The synthetic sessions in `radar_qa_app` were deleted.
- Files outside the repository's tracked tree: `.data/contextual-article-images/qa/` (git-ignored: settings, fixture, uploads, logs).
