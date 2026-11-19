# N1E / N8 engineering handoff

Workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/social-draft-navigation`, starting HEAD `13e2272870781951c86d578fa225462f43ddc5b4`. Approved brief/design read. Existing dirty operational notes were preserved. No commit, deployment, provider request, paid generation or user-Chrome operation performed by this engineer.

## Behavior

- Social Marketing now exposes Content library, URL-backed bounded search, overlapping publication-status filters/counts, and distinct empty/search-empty/unavailable-pack states. It searches the authoritative client list without filtering ID prefixes or adding queries. Flag-off views show Saved, ignore stale publication filters, and remove status from subsequent links/controls.
- Native cover/title/Open pack links preserve valid library context and support modified-click/new tab. The native Content library back link retains search/status, strips modal flags, and PackView is keyed by pack ID. Dashboard still shows four recent packs and All packs. Generation completion names Content library and offers that destination.
- Cards derive accurate Draft/Scheduled/Posted/Mixed and Needs attention/Sending counts solely from projected per-post publication state. Ready/generated/copied/automatic content does not imply publication.
- Cards choose an actual saved video, carousel or still in platform order. Generated style labels use the actual immutable attachment provenance, including legacy drawn normalization; manual attachments receive no invented style. Retained old attachments show Preparing replacement separately.
- Video sources remain absent offscreen. Near-viewport previews use metadata preload, no autoplay/loop/controls, muted inline video, and one finite-duration bounded paused seek to `min(1.5, duration / 2)` to show a saved frame. The full frame is contained to avoid cropping the center out of portrait explainers. No thumbnail/render/storage endpoint added. Media errors remain visibly Video/Carousel/Image preview unavailable.
- N8 replaces the script-only posted opener with a genuine button-styled external anchor using the exact projected absolute HTTP(S) receipt, `_blank`, `noopener noreferrer`. No interception, action or `window.open`. YouTube historyExpired suppresses even a stale in-memory URL; null/malformed/unsupported receipts have explicit unavailable text, no inert View action. Posted/noResend semantics remain intact.

Runtime paths (7):

```
src/features/dashboard/Dashboard.tsx
src/features/social/PackThumb.tsx
src/features/social/PackView.tsx
src/features/social/SocialFlow.tsx
src/features/social/SocialMarketing.tsx
src/features/social/library.ts
src/features/social/channels/PublishBox.tsx
```

Tests: `src/features/social/library.test.ts`, `src/features/social/channels/PublishBox.test.ts`. Engineering-only synthetic setup/browser harnesses are `engineering-setup.mjs` and `engineering-browser.mjs` here. No backend, authorization, tenant query, schema, automation default, publishing option, master flag, retention or receipt projection changes.

## Verification

Node `/Users/ekene/.nvm/versions/node/v22.18.0/bin/node`:

- `node node_modules/vitest/vitest.mjs run src/features/social/library.test.ts src/features/social/channels/PublishBox.test.ts --maxWorkers=1`: **39 passed**. Parsing/limits/literal-one compatibility, context whitelisting, all publication statuses, overlapping mixed membership, source order/search, flag-off ignoring stale status, actual/legacy/manual cover provenance, failed/pending/cancelled placeholders, genuine native receipt anchor attributes, all supported platforms and malformed/null/scrubbed failure paths. Log `/tmp/radar-navigation-tests.log`.
- `node node_modules/typescript/bin/tsc --noEmit`: **passed**; `/tmp/radar-navigation-typecheck-final.log`.
- `git diff --check`: **passed**.
- PM separately supplied baseline socialPublish **51 passed**; not rerun or claimed as engineer execution.

Real headless Google Chrome with a fresh Playwright profile, dedicated migrated localhost database `radar_social_navigation_engineering`, safe public generic fixture media and isolated copied Next server at localhost:3860. Browser uses the real application/route/auth components; workspace response is intercepted with synthetic multi-status packs. This is browser behavior evidence, **not proof of production record retrieval**. Server auth remains real synthetic-session auth. Automatic `app.seen` housekeeping may run against this dedicated synthetic DB; observed product action writes are zero. External YouTube request is fulfilled locally at the exact synthetic receipt URL; real new-tab navigation is observed without contacting YouTube. No actual remote video availability claim.

Eight browser journeys passed:

1. Twenty owned-shaped records (normal, `media-`/demo-shaped, legacy, video, carousel), mixed/failed/sending summaries, actual old attachment style, no nested controls; offscreen src absent, visible video metadata/paused frame.
2. Search and Draft filter persist through refresh; native modified-click opens the same pack in a new tab; Content library and browser back/forward preserve context.
3. No-match and real-empty states differ; All packs clears both controls; unavailable foreign-shaped ID gives a context-preserving return without reopening generate modal.
4. Cross-pack selected-platform reset and Dashboard four-item limit → All packs access.
5. Native posted link focused + Enter opens a real new tab at the exact receipt href, safe attributes, no publication/generation actions.
6. Missing, invalid and scrubbed receipt states retain posted history, no dead exact-post link and no resend control.
7. Viewer search/open works, generate/connect stay disabled; 390px layout fits with keyboard-native Open pack.
8. Publishing disabled ignores stale `status=posted`, shows Saved/hides filter group, cleans subsequent links/search URL; genuine empty state remains distinct.

Evidence `/tmp/radar-navigation-browser/results.json` and logs `/tmp/radar-navigation-browser-final.log`; screenshots inspected by engineer:

- `/tmp/radar-navigation-browser/library-desktop.png`
- `/tmp/radar-navigation-browser/library-mobile.png`
- `/tmp/radar-navigation-browser/posted-native-link.png`

First browser setup referenced a retired E8 test database and failed before auth; corrected by creating the dedicated N1 synthetic database. A selector initially assumed existing platform logos had no accessible name; changed the harness locator to the actual tab text. Visual review found the initial dark video frame and portrait center crop hid actual artwork; the bounded paused seek/full-frame fix above addressed it. No useful test weakened.

## Frozen runtime / integration

Runtime aggregate **`85d223d2c6045616139cd5fb41fe43a9a1705400076eec7123de95c3fd0221c2`**. Exact SHA-256 map `/tmp/radar-navigation-runtime-fingerprint.json`; hash input is sorted `path + " " + sha256 + "\n"` for the seven runtime paths above. No runtime source changes planned after this freeze.

Independent QA remains a separate pass. PM owns isolated production build/delivery and actual Chrome verification of the posted owner receipt, without posting the fresh D2 draft. PM reproduced the old button as enabled and observed no destination/new tab; popup blocking remains an inference, not a proven cause. No migration/config needed. UI rollback does not mutate packs, assets or retained publication history. Generic Duplicate as draft remains deferred. Full live generation, provider upload, private YouTube viewing and production account/security flows were not exercised here.
