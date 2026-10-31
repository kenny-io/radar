# Independent acceptance QA

Recommendation: accept the implementation for draft PR review. PM confirms the production build passed all stages. No new blocking regression was found in the observed checks. Live image-provider output is unverified because this environment has no live provider credentials. Passing these checks does not prove every behavior correct.

## Tested integration and environment

- Workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`; branch `kenny/suggestion-prompts-custom-images`; HEAD at testing `9d6c4016c693b9eecdda143a7c76b514e6da329d` plus the integrated source changes.
- Exact tested source: SHA256 `207e6244c8f3424f9ab9c189933ad95a573cb7d3f867d5205adb2b5c09debbfa` over the 26 sorted source/docs paths in `.data/suggestion-prompts-custom-images/source-fingerprint.json`, hashing path + NUL + bytes + NUL. Independently matched before and after final checks. Evidence `qa/tested-fingerprint.json`.
- Actual local browser app: `http://localhost:3044`, Next dev, real PostgreSQL/UI database `radar_custom_images` on localhost:55439, billing off, social publishing on, business timezone Asia/Dubai. Initial unavailable-provider checks used `http://localhost:3043` with dev stubs on; PM stopped that web server afterward.
- Dummy Owner account `dev@radar.local`, dummy Viewer `qa-viewer@radar.local`; business `69da54fa-0ccc-41b0-809f-c3b8fb89dfef`. Only disposable QA data was seeded. Resource IDs in ignored `qa/fixtures.json`.
- Success environment has `RADAR_DEV_STUBS=0`, a dummy OpenAI key and an ignored server fetch preload that returns a deterministic PNG or provider failure. It records image requests and blocks other external fetches. Application RPC, validation, role/tenant checks, image crop, object storage, persistence, SSE, job ownership and normal worker queue execution run unchanged. Worker runs without cron. No client RPC response interception or fake backend success was used.
- Browser: installed Playwright Chromium, desktop 1440×1000 and mobile 390×844. No uncaught page errors in final core flow. Also smoke-tested the completed production build with `next start`: signin and settled mobile Brief/social controls passed; `production-smoke-results.json`. QA web/worker processes were stopped after checks.

Reviewed before relying on engineer results: `brief.md`, SP1–QA1 acceptance criteria, `architecture.md`, `ARCHITECTURE.md`, `docs/CONTRACTS.md`, parent `01-screens.md` §§6–8 and `02-system.md` §§7–10. Inspected the changed builder/clipboard component, Performance UI, image contracts/action/service/UI code, Brief atomic commit/ownership and terminal projection, article body direction propagation, and the developer tests. No feature or test source files were edited by QA.

## Acceptance coverage

| Criteria | Result | Independent evidence |
|---|---|---|
| SP1 | Passed | All four recommendation kinds (refresh/meta/links/faq), 10 individual/all copy actions, real clipboard readback; business, exact target URL, rationale, requested scope, current/proposed SEO values and validation instructions verified. Legacy missing URL resolves from domain/page. |
| SP2 | Passed | Awaited clipboard success; forced browser clipboard denial shows failure and selectable readonly prompt, focus selects full text. Keyboard Enter copies. No write RPCs and unchanged DB suggestion rows. Viewer copy succeeds without accept/dismiss controls. |
| IM1 | Passed with mocked provider | Social LinkedIn and X custom subjects reach provider from branded style; generated files crop to 1200×628 and 1200×675. Prompt/asset persist after reload; switching platforms preserves separate directions; text and other platform unchanged. Failed provider keeps previous URL/seed; Regenerate reuses saved requested direction. |
| IM2 | Passed with mocked provider | Article immediate type/click sends current prompt after autosave flush. Cover-only updates preserve body/SEO; direction/strict mode persist; two body images use shared direction with section context and 1200×675 output. Brief Change and Add visuals use custom direction; success atomically replaces complete set, reload retains prompt, retry succeeds. Legacy/default behavior covered by independently rerun DB/unit cases. |
| IM3 | Passed | Blank/1001-character inputs rejected before provider; blank UI action disabled; provider unavailability and 500 failure are visible and retryable. No template is stored for strict failure. Brief image 1 success/image 2 failure retains the entire old set, metadata and new retry direction. Aged failed/done/missing job reload projects retryable failure while retaining media/prompt; retry runs real queue successfully. |
| IM4 | Passed in exercised cases | All three custom-write APIs: Viewer403, cross-tenant404, publication lock409; invalid/locked calls do not reach provider. Social overlapping requests reject old completion409 and preserve new result/text. Article scheduled during provider call rejects final commit and preserves prior cover. Brief busy Change request/Remove remain available; Remove/re-add gets unique request identity and old worker returns skipped instead of replacing new set. Focused DB tests also verify expired worker ownership and body job/direction protections. |
| UX1 | Passed in exercised cases | Discoverable labeled inputs, status feedback and keyboard action activation. Copy/manual recovery, social, article and Brief controls inspected at390px without document overflow. Mobile Generate image is reachable by scrolling and succeeds via keyboard Enter. Full-page social screenshot paint omission was a sticky-layout capture artifact; actual scrolled viewport screenshot shows working button. |
| QA1 | Passed for local verification | Independently rerun 50 focused tests across 6 files; final fingerprint stable. PM separately reports integrated typecheck pass and full suite728 passed/65 skipped/1 baseline raster mismatch; PM confirms production build passed all stages. |

Failed new checks: none observed. Existing baseline failure: `src/server/ai/openrouter.qa.test.ts` template PNG raster hash golden mismatch (`f883614e6a7dfb07` expected vs `91d5409f50974af7` local). PM reproduced the same baseline in the full suite; QA did not alter its assertion.

Blocked: live provider/network output and real model visual fidelity, including whether a real Sobha Sapphire scene is recognizable, require configured live provider credentials. Local mock verifies request direction/routing/crop/storage/error semantics only. No remote social account posting or production deployment was tested or required.

Not applicable: reference-photo upload/search (excluded scope), production data migration, merge/deploy, real social publishing.

## Reproduction commands and evidence

All paths below are relative to ignored `.data/suggestion-prompts-custom-images/qa/`; reports exclude real customer information and secrets. Browser session storage files were deleted after testing and are not evidence or deliverables.

Focused independent command (separate integration DB, no UI worker on this DB):

```sh
DATABASE_URL=postgresql://radar@127.0.0.1:55439/radar_custom_images_tests node_modules/.bin/vitest run src/lib/suggestionPrompt.test.ts src/lib/promptClipboard.test.ts src/server/services/articleImagesFallback.test.ts src/server/actions/customImages.db.test.ts src/server/services/drafting/bodyImages.test.ts src/server/services/drafting/bodyImages.db.test.ts
```

Result: 6 files/50 tests passed, 13.40s. Log `focused-tests.log`.

Browser scripts: `copy.mjs`, `viewer.mjs`, `image-unavailable.mjs`, `image-success.mjs`, `edges.mjs`, `terminal-recovery.mjs`, `mobile-and-brief-race.mjs`, `production-smoke.mjs`. They use the real app and dummy fixture IDs; initialize with `source .data/suggestion-prompts-custom-images/local-env.sh`, and use the corresponding local provider/mock worker scripts for success scenarios. Results: `copy-results.json`, `viewer-results.json`, `unavailable-results.json`, `image-success-results.json`, `edge-results.json`, `terminal-recovery-results.json`, `mobile-race-results.json`, `production-smoke-results.json`. Exact clipboard payloads: `copied-*.txt`. Actual provider-bound requests: `provider-calls.jsonl` (deterministic mocked boundary, never live provider evidence).

Visual evidence: `performance-copy-desktop.png`, `performance-copy-denied-desktop.png`, `performance-copy-denied-mobile.png`, `viewer-copy.png`, `social-unavailable.png`, `article-unavailable.png`, `article-unavailable-mobile.png`, `social-success-desktop.png`, `social-success-mobile.png`, **`social-mobile-button-viewport.png`**, `article-success-desktop.png`, `brief-partial-retains-desktop.png`, `brief-partial-retains-mobile.png`, `brief-prompt-mobile.png`, `social-locked.png`, `article-locked.png`, `brief-aged-failed.png`, `brief-aged-done.png`, `brief-aged-missing.png`, `brief-generating-controls.png`.
