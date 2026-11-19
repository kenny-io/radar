# N1–N8 independent QA

**Pass for guarded delivery.** No unresolved material regression found. Final live library/receipt navigation remains PM-owned. This report does not claim the owner's private YouTube video is available to an unauthenticated viewer or that a specific popup blocker caused the original failure.

Tested workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/social-draft-navigation`, base/HEAD `13e2272870781951c86d578fa225462f43ddc5b4` plus the frozen seven runtime files. Read brief N1–N8, finalized design, engineering handoff and task contract; inspected changed source/developer tests. All seven file hashes independently match the supplied freeze aggregate `85d223d2c6045616139cd5fb41fe43a9a1705400076eec7123de95c3fd0221c2`. Exact tested map: [runtime-fingerprint.json](qa/runtime-fingerprint.json). Independent sorted `path TAB SHA256 LF` aggregate is `6cad12c05f0c5d276840687f3cb0ab973a6c3d63c63522258d77a75413d5aef0`.

PM separately supplied a passing Node22 production build on898 files, unchanged source/copy/final SHA `3b181adc857e3b1f62cdc766e62cd28596c6c71d353a74c4dd5e2b8646f2b488`, BUILD_ID `ZtaXyoynZS4n3td4xyZzr`. QA did not repeat that build.

## Results

| Check | Result | Evidence |
|---|---|---|
| Independent pure model/link assertions | **20/20 pass**, including all125 three-platform status combinations | [tests](qa/independent.test.mjs), [log](qa/logs/independent.log) |
| Focused developer/navigation and existing publishing regressions | **90/90 pass**:26 library,13 posted-link,51 publication | [log](qa/logs/regression.log) |
| Real ordinary-browser journeys | **8/8 pass**, zero page errors/product actions | [results](qa/browser-results.json), [log](qa/logs/browser.log) |
| Full TypeScript and `git diff --check` | **pass** | [typecheck](qa/logs/typecheck.log) |
| Final production library/YouTube navigation | **pending PM smoke** | No production actions by QA |

Local environment: own migrated PostgreSQL database `radar_social_navigation_qa` at localhost:54329, isolated Next snapshot at `http://localhost:3867`, Node22 and actual headless Google Chrome via Playwright. Verified synthetic Owner/Editor/Viewer/outsider sessions;26 owned packs and separate foreign pack. Publication badges/counts derive from actual `social_pubs` rows and the real workspace projection, rather than invented main-case client state. Generic public silent MP4/JPEG fixtures only; no private customer/source/audio copied, paid/provider call or user-Chrome operation.

### Browser and intended behavior

1. All26 saved rows appear, including media/demo-shaped IDs, older content and more than Dashboard's four recent packs. Actual projected counts: Drafts21, Scheduled2, Posted4, Mixed1. Mixed card shows2 draft/1 posted; failed posts show Needs attention, sending shows Sending; copied content stays Draft. Counts overlap as designed. Native-font card text, desktop composition and actual covers inspected in [desktop screenshot](qa/library-desktop.png).
2. Real visible videos are muted/paused with no autoplay/loop/controls, seek to1.5seconds, show decoded nonblank pixels and contain the whole portrait frame. Offscreen video has no source until scrolled near view. A bad media URL shows Video preview unavailable while retaining its type. Carousel uses its actual first slide/count. A retained old Drawn attachment remains labeled Drawn while a Blueprint replacement is preparing. No nested card links/buttons.
3. Search plus Draft filter survive refresh. Native middle-click opens the exact owned pack/context in a real new tab; keyboard opening, Content library return, browser Back/Forward retain filters. Explicit links open owned packs outside those filters. All packs/Clear filters restore the collection; no-match differs from genuine empty. Literal `q=1` remains search text. Unknown/actual foreign IDs show explicit unavailable content and a context-preserving library path, without revealing foreign content or opening a generation modal.
4. Settings → sidebar Social Marketing deliberately resets to All packs. Mixed pack's selected Instagram tab does not leak into a subsequent YouTube-only pack. Dashboard keeps four cards; All packs opens all26. Existing native pack hrefs remain usable for bookmarks/new tabs.
5. Fresh actual projected synthetic YouTube receipt renders exact native HTTP(S) href, `_blank`, `noopener noreferrer`. Both ordinary click and keyboard Enter open real new tabs at that exact destination, with `window.opener===null`; the destination is fulfilled locally so no YouTube/provider request occurs. Radar remains on the same pack. [Native-link screenshot](qa/posted-native-link.png).
6. Invalid and deliberately scrubbed receipt rows keep posted history and expose explanatory text, without a dead View action or Post now/resend. A separate stale-client workspace case injects an otherwise valid URL alongside `historyExpired/noResend`; it remains suppressed. Pure native-link cases also cover X/LinkedIn/Instagram/TikTok and missing/relative/unsupported URLs. No receipt is reconstructed.
7. Viewer can search/open with native keyboard, while generation/connect/edit controls remain guarded. At390px, no horizontal overflow, ordinary focus/navigation and readable cards/filters. [Mobile screenshot](qa/library-mobile.png).
8. Publishing-off response variant uses Saved, hides status controls, ignores/cleans a stale status filter and retains search. A separate truly empty response shows the real empty state. These and the stale-client test intercept only this synthetic browser context; actual business flags/history are not modified.

Preferences/master/defaults, pack JSON, publication rows and job/model/generation counts have identical before/after snapshots across the final browser run. Product action calls are empty; only ordinary `app.seen` housekeeping is allowed. No publication, schedule, generation, narration, history reset or rollout change occurred.

## Baseline and limits

A real local transport limitation was isolated rather than hidden: the unchanged development `/api/files/[...key]` handler ignores byte-range requests. Chrome loads these local MP4s but resets both programmatic and manual seek to0; the N1 handler was observed assigning1.5 correctly. This route has no diff from base. Diagnostic evidence: [local-range-baseline.log](qa/logs/local-range-baseline.log). The same generic MP4 bytes served through the existing range-capable public static path pass the unchanged exact paused-frame assertions. PM independently supplied a bounded actual production R2 check:206, Accept-Ranges bytes, Content-Range0–15/7518505 and16-byte body (`/tmp/radar-navigation-range-proof.json`). No storage/API change is requested in this navigation scope.

Initial harness-only failures came from filler fixtures inheriting a searchable recording headline/source and two incorrect role locators. Corrected fixtures/locators retain the intended assertions; all final journeys pass with the frozen product source unchanged.

PM reproduced the original production N8 failure: an enabled View on YouTube click left Radar unchanged and created no YouTube tab/window. That establishes the symptom, not the browser-block cause. Local final tests prove native navigation to an exact synthetic receipt; actual owner session/private-video availability and final production activation are outside QA's granted scope. No new video was posted to test a link. D2 helper-delta approval and8 local copy/readiness assertions are recorded separately in the preparation plan and `/tmp/radar-owner-demo-readiness-v2.log`; PM owns its completed apply/browser result.

Commands from the tested worktree with Node22:

```sh
node_modules/.bin/vitest run --config .factory/social-draft-navigation/qa/vitest.config.mjs
node_modules/.bin/vitest run src/features/social/library.test.ts src/features/social/channels/PublishBox.test.ts src/lib/socialPublish.test.ts
node .factory/social-draft-navigation/qa/browser.mjs
npm run typecheck
git diff --check
```

Fixture/session/environment files are ignored under `.data/social-navigation-qa`. QA owns report/harness/evidence only and changed no runtime implementation. Local browser/server processes are stopped after evidence capture; Next-generated files stayed in the isolated snapshot and original tsconfig/next-env are untouched. No further unrelated broad suite or paid generation is required for this bounded change.
