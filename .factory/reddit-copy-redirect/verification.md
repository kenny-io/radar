# Independent verification

Verified 2026-11-09 in `/Users/ekene/Downloads/design_handoff_radar/radar-push`, dirty branch `kenny/signup-security`, base `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. Relevant final working-tree SHA256 fingerprints are recorded in `qa/browser-results.json`; unrelated existing edits were preserved.

## Results

- **18/18 real browser scenarios passed**, Chrome via Playwright against the current-source Next development server at `http://localhost:3132`, desktop 1440×950 and mobile 390×950. Ordinary local `dev@radar.local` session, synthetic workspace/action responses and intercepted Reddit destination. The browser used the real clipboard for normal flows; denied/delayed clipboard behavior was explicitly injected only for failure/sequencing checks. No external Reddit request, posting, live AI, production change or business fixture mutation occurred.
- **85/85 focused clipboard/social tests passed independently:** `npm test -- src/features/brief/redditCopy.test.ts src/lib/promptClipboard.test.ts src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts`. Evidence `qa/focused-tests.log`.
- **42/42 brevity unit/integration tests passed independently:** `npm test -- src/server/services/brief/replyBrevity.test.ts src/server/services/brief/plan.test.ts src/server/services/brief/rules-figures.test.ts`. Evidence `qa/brevity-tests.log`.
- **225 synthetic stress inputs / 675 outputs passed independently:** `node --import tsx .factory/reddit-copy-redirect/qa/brevity-stress.mjs`. All five reply platforms, varying paragraph lengths/counts and disclosure placement: ≤3 paragraphs, ≤50 words per paragraph, ≤150 words total; disclosure/business preserved and X ≤280 characters. Evidence `qa/brevity-stress-results.json`.
- **Typecheck passed independently:** `npm run typecheck`; evidence `qa/typecheck.log`.

## Acceptance coverage

- AC1 passed: footer Copy reply, Copy again, top Copy reply and keyboard C copy the visible chosen/edited response, then use the same tab to open the canonical thread `/#comments`. Real clipboard content remains exact after navigation and can be pasted into the synthetic destination. Popups were blocked in every browser scenario.
- AC2 passed: clipboard denial retains page, response edit and open state; actionable error appears and no copied mutation occurs. Delayed clipboard confirms no early navigation or copied-state mutation.
- AC3 passed: edited text and copied state are persisted before navigation; browser Back retains the response and “I posted it”. Save failure retains the page and edited response with recovery guidance. HN reply/feed copy behavior remains unchanged. C shortcut follows both Help→Plug and Plug→Help, unsaved edits, and selected feed platform.
- AC4 passed: missing/invalid external destinations remain copyable without automatic navigation. Delayed save confirms navigation waits for the response.
- Added UI requirement passed: top Copy reply appears before the variant switch and response in document order, copies the edited selected Plug variant, and works on desktop/mobile. Stable screenshots were visually inspected after animations settled.
- Added brevity requirement passed: generated founder help/mention, company replies, rewrites and fallback disclosure fit the cap. Short compliant text stays unchanged; feed posts and user source text are not truncated. Model responses in generation/rewrite integration tests were mocked, so this verifies deterministic enforcement without making live AI calls.

## Defect found and resolved

P2: keyboard C copied stale Help text after switching to Plug. Reproduced in the real browser; engineer changed the shortcut listener to read current selection/actions from a ref. Final browser run verifies both switch directions, unsaved response edits and feed-platform selection. No outstanding defect observed.

## Evidence and limits

- Reproduce browser checks: start `node .factory/reddit-copy-redirect/qa/server.mjs`, then run `node .factory/reddit-copy-redirect/qa/browser.mjs`.
- `qa/browser-results.json` and `qa/browser.log`: final 18/18 results, zero runtime exceptions and tested fingerprints.
- `qa/back-copied.png`: stable desktop response after returning from comments; `qa/reply-mobile.png`: stable mobile top action; `qa/comments-destination.png`: synthetic destination containing pasted text; `qa/clipboard-denied.png`: error recovery.
- Persistence sequencing/return-state browser checks use intercepted local workspace/action responses rather than a real database mutation; server persistence behavior itself was unchanged. Live Reddit layout/scrolling and authenticated posting were not exercised. Tenant/auth boundaries are unchanged and not applicable to this client-only redirect; no claim of full security coverage.
- Dedicated QA server stopped and port 3132 confirmed closed. Removed only the QA-generated `.next-reddit-copy-qa/types/**/*.ts` include from the pre-existing dirty tsconfig; other configuration edits preserved.

Recommendation: ready for local handoff with the stated live-Reddit limitation. No merge or deployment performed.
