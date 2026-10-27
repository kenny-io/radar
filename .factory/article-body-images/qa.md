# Independent QA: article body images

## Tested revision and environment
- Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`; branch `kenny/article-body-images`; HEAD/base `2ab6149eb7f22bd5a482bd7646063d9e2fd4e04f` plus integrated working-tree changes.
- Final source SHA256: `2f5044f06a193f394e0a44387569cb00f3abb9d9405ad67b72f3f860fd8c29ff`. Independently computed over the22 sorted modified/new `src` and `docs/CONTRACTS.md` paths, each path+NUL+bytes+NUL. Exact paths are in `.data/article-body-images/qa/source-fingerprint.json`.
- Read brief AC1–8, approved architecture including nullable placement and review findings, existing repository README/contracts, changed implementation and developer tests. No on-disk repository/ancestor AGENTS file; session instructions apply. QA owns this report/ignored evidence only; no feature or test source edits.
- Actual browser app: `http://localhost:3017`, local dummy `dev@radar.local`, Fieldnote business `f84c3c1f-0daa-4b5c-8bf9-858815208a8b`. CUA sign-in/dashboard confirmed first; repeatable Chromium156 Playwright flows and screenshots followed under PM authorization. Stubs enabled, billing off.
- Browser database: `postgresql://radar@127.0.0.1:55439/radar_body_images`. Independent final DB regressions ran on separate `radar_body_images_tests` without browser-worker claims or overlapping engineer test runs. Temporary Viewer/foreign-business fixtures cleaned up; dummy article fixtures remain only locally.

## Acceptance coverage
| Criterion | Result and evidence |
|---|---|
| AC1 | **Pass:** actual fresh standard draft has cover+2 distinct body-image URLs/section anchors; full long rewrite has3 fresh body URLs. Short900 and sensible section caps covered by independent unit/DB regressions. |
| AC2 | **Pass:** URLs, anchors, alt and image count persist on refresh; legacy articles lacking fields load and repair explicitly. Inline paragraph edit→blur→reload retains exact image array. |
| AC3 | **Pass:** legacy Add and keyboard Enter Regenerate preserve body, sources, claims, SEO, cover and videos. Actual progress, disabled approval, two-attempt failure, alert, Try again and successful retry observed. Scheduled UI action disabled; scheduled/publishing/published RPC409; Viewer403; foreign business/entry404. |
| AC4 | **Pass:** final unified view shows images after their complete sections with nonempty alt; Media matches existing style. At390×844 document scrollWidth390, both images350px wide and loaded. Labeled actions and keyboard activation checked. Loaded desktop/mobile screenshots inspected. |
| AC5 | **Pass locally; live service checks blocked:** independent HTML/Markdown/MDX escaping, exact section order, Notion external-image payload, absolute tenant-owned media URLs, separate cover and Wix conversion regressions. No external CMS publish attempted. |
| AC6 | **Pass:** actual storage failures leave prior complete Article unchanged and retry creates fresh images. Brand-new draft storage failure leaves generated=false, empty body, absent bodyImages, approved/retryable status; never review. Independent provider503→real template PNG/storage propagation and stale-worker/merge/lock tests pass. |
| AC7 | **Pass within available environment:** independent76 tests/8 files and final typecheck pass; diff whitespace check passes. PM final full-suite/build results recorded in verification.md. |
| AC8 | **Pass:** no Edit/Preview tabs; ordinary owner inline edit persists after blur/reload with images retained. Scheduled content has zero editable article nodes; actual Viewer browser content readonly with media action disabled. |

## Independent commands
Executed final focused suite with `DATABASE_URL=postgresql://radar@127.0.0.1:55439/radar_body_images_tests RADAR_DEV_STUBS=1 npx vitest run` and:
- `src/lib/articleImages.test.ts`
- `src/server/services/drafting/bodyImages.test.ts`
- `src/server/services/drafting/bodyImages.db.test.ts`
- `src/server/services/articleImagesFallback.test.ts`
- `src/server/services/publishing/bodyImages.test.ts`
- `src/server/services/publishing/render.test.ts`
- `src/server/services/publishing/connectors/notion.test.ts`
- `src/server/services/publishing/connectors/wix.test.ts`

Result:76/76 passed, including13 real-Postgres regression cases. Also ran `npm run typecheck` on final unified source and `git diff --check`, both passed. Browser scripts: `seed.mjs`, `browser.mjs`, `failure.mjs`, `draft-failure.mjs`, `boundaries.mjs`, `unified-readonly.mjs`, `final-screens.mjs` in the ignored evidence directory. Local storage fault used read-only permissions only on dummy business article-body directory, always restored in finally.

## Evidence
All private-free local dummy evidence is under `.data/article-body-images/qa/`:
- `browser-results.json`: final unified generation, rewrite, refresh, legacy preserve comparisons, mobile, keyboard, inline edit, queued readonly and no page errors.
- `unified-readonly-results.json`, `unified-viewer-readonly.png`: actual Viewer browser.
- `failure-results.json`, `draft-failure-results.json`, `boundary-results.json`: real storage failures/retry/new-draft safeguards and API authorization/locks/dedupe/client-media checks.
- `final-screens.json`: final image complete/naturalWidth/opacity1 assertions after scrolling every image into view.
- `final-standard-1440-unified.png`: fully loaded cover+3 body images after long rewrite.
- `final-legacy-1440-unified.png`, `final-legacy-390-unified.png`: repaired legacy article and Media on desktop/mobile after inline edit.
- `failure-loading.png`, `failure-retry.png`, `failure-recovered.png`, `draft-storage-failure.png`: actual UI progress, error and recovery.
- `final-focused-tests.log`, `typecheck.log`, `source-fingerprint.json`: independent verification output and revision identity.

Earlier Edit/Preview screenshots are superseded by unified-view evidence and are not final UI signoff evidence. Earlier harness issues (tab roles, async workspace loading, retry completion waits) were corrected without app changes.

## Defects, blocked checks and recommendation
**Failed feature checks:0.** No observed feature regression remains. Existing OpenRouter template raster snapshot mismatch is a baseline environment failure documented before feature edits; PM final full suite reports695 passed,65 skipped and that same single failure. It is separate from the76 passing independent focused checks.

**Blocked:** live authenticated image-provider quality/latency, S3/CDN reachability and real external CMS end-to-end publication: no service account/environment supplied. Local tests prove templates/storage/browser behavior and payload contracts, not remote-service availability. Full screen-reader certification is unperformed. **Not applicable:** SQL migration, production content modification, merge/deployment; none required or authorized for QA.

**Recommendation:** ready for PR review with the baseline test exception and live-service limits documented. Passing observed checks does not establish all behavior correct; production merge/deployment remains a separate delivery decision.
