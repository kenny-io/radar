# Q8 independent acceptance — five video and slide styles

**Recommendation: pass for guarded delivery.** No material defect remains in the observed S1–S7 checks. Production deployment and the actual Owner style-selection smoke remain PM-owned, pending delivery. Passing these bounded checks does not establish every future layout or browser behavior.

Tested 2026-11-19 on `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/video-style-presets`, HEAD `776be722f577c6d6c5570af5da2d84472bd6d9cb` plus the frozen integrated implementation. Read the brief S1–S7, approved A8 design, both implementation handoffs and the QA task contract. No runtime source was changed by QA.

The 36-path union of the engineer freezes matches every file hash in [integrated-fingerprint.json](qa/integrated-fingerprint.json). Independent aggregate is `f0da743755ad589de1cf7a585354d2b119920c753b86f3371169e02950c8ef03` using sorted `relative-path TAB file-SHA256 LF`. This is a scoped feature fingerprint, distinct from the PM production-build selection: 895 files, `f71b8119adb11f9ce8ed36f82c4523bb8013a90d379eb2b7cf85a1e911cd1a61`, BUILD_ID `KVpPjIHDGY82nUTNPXF8N` (PM evidence `/tmp/radar-five-styles-build.json`). Backend and UI supplied aggregates remain `497c454b7b26efacc60a7b9413426491727efd477b856a651461fcc2be521e27` and `b6a9171cea9f5d064cb079ea7ddff9da958f2aa4a8ff3a55d28693f79d0cb329`.

## Environment and results

Local isolated Next snapshot at `http://localhost:3857`; dedicated synthetic PostgreSQL database `radar_video_styles_qa` at localhost:54329. Synthetic verified Owner, Editor, Viewer and outsider; all provider credentials blank, local dev stubs enabled. Actual headless Google Chrome via Playwright, desktop1440×1000 and mobile390×844. Browser traffic restricted to localhost. No paid call, external account grant, provider post, production mutation or user-browser action. Runtime fixture/session files remain ignored under `.data/video-styles-qa`; none are evidence for staging.

| Coverage | Result | Evidence |
|---|---|---|
| Independent real DB, action/authorization, cache, worker and automatic boundaries | **38/38 pass** | [independent.test.mjs](qa/independent.test.mjs), [log](qa/logs/independent.log) |
| Native fonts, full text, contrast, captions, cue motion/revisits, protected geometry and bounded layout cache | **28/28 pass** | [native.test.mjs](qa/native.test.mjs), same log |
| Focused existing/new catalog, publication rules, style renderer and automatic regressions | **67/67 pass** | [regression.log](qa/logs/regression.log) |
| Real browser | **12/12 final scenario runs, 11 distinct scenarios pass** | [picker/default/roles/mobile](qa/browser-results.json), [generation/failure/uncertainty](qa/browser-flow-results.json), [state/CAS/legacy](qa/browser-state-results.json) |
| Final TypeScript check and `git diff --check` | **pass** | [typecheck.log](qa/logs/typecheck.log) |
| Five full private MP4s, 25 actual-plan carousel slides; five public samples | **pass** | [artifact-results.json](qa/artifact-results.json), [public-previews.json](qa/public-previews.json) |
| Guarded production style smoke | **pending, PM-owned** | Required after coordinated web/worker delivery |
| Listening/speech-quality assessment | **not performed** | No audio playback/listening capability used; decoded audio/timing evidence only |

No affected required local check is blocked. The actual private storyboard contains zero revisit cues; synthetic explicit same-scene revisit tests cover all five styles. No actual-storyboard revisit claim is made.

## Acceptance observations

**S1/S4/S6 — real distinct renders.** Inspected all25 full private carousel slides and actual encoded introduction, partial and completed-scene video contact sheets, with ten exact timed-frame comparisons per style including opening, scene handoffs and final. Drawn preserves dark linked strokes and handwritten labels. Kinetic removes enclosing cards, uses type groups/underlines and the current semantic action strip. Editorial uses left-aligned print hierarchy, folios and rules. Paper cut uses filled silhouettes, tape and offset layers with a bounded settling motion. Blueprint uses a grid, clipped schematic introductions and connection terminals. These are actual renderer operations and visible compositions, not only different hashes.

All full outputs are H264/AAC,1080×1920,24fps,2567frames,106.958333seconds; all fully decode. Every style uses identical reviewed Plan/timeline and identical decoded raw PCM bytes, with the original cached MP3 and one existing500ms delay/normalizer pass. Peaks are approximately−1.3dB. Fifty sampled encoded frames match their exact native style/time branch with minimum SSIM0.98604 (Blueprint grid compression is the lowest); private report contains exact byte hashes. Caption checks retain Kalam48, exact text/wrapping/timestamps and y1410..1630 bounds. Native actual-font ink checks preserve all required scene labels/states/edge words/summaries at readable minima, measured contrast≥4.5, disjoint text/panels and protected translation/shadow envelopes in both formats. Layout cache returns the same object only for the same mode/style and at most ten logical entries per scene. No script, caption, timing or audio rewrite was introduced by style selection.

Private actual files remain in `/tmp/radar-video-styles/full/{style}/video.mp4` and `/tmp/radar-video-styles/qa`; none are committed. Contact sheets `/tmp/radar-video-styles/qa/styles-all-carousels.jpg` and `styles-motion-samples.jpg` are private PM inspection evidence. Earlier exploratory AAC-mux files outside `/full` are excluded.

**S2/S3 — ordinary browser use and persistence.** Exactly five native radio choices. New Generate snapshots Blueprint when opened; a later business-default change does not retarget the wizard. Choosing Paper cut and clicking Generate posts and media once runs actual local jobs to three real JPEGs with Recommended retained, then persists after refresh. No upload controls. Existing desired selection saves with zero jobs/models/generations and old actual Drawn media remains labeled correctly. All five public7.5second silent samples really advance playback using the focused Play sample button and Space; Pause sample pauses. No autoplay, mutation, audio stream or private source; native controls remain available. Escape closes only the preview, returns focus, and preserves the underlying Draft settings dialog.390px layout and native radio arrow-key saving pass. Screenshots: [new generated pack](qa/newpack-actual-paper-cut.png), [actual versus desired](qa/desired-vs-actual-desktop.png), [paused default](qa/paused-default-desktop.png), [mobile picker](qa/mobile-picker.png), [mobile preview](qa/mobile-preview.png).

Scoped default saving changes only `socialAuto.videoStyle`, including while automation is paused. It preserves master state, platforms, timing, post mode, YouTube privacy/audience and default version. Unsaved pending default does not leak through broad settings save; stale broad saves preserve the latest scoped default. Owner/Editor succeed; Viewer writes403, foreign tenant404, unsupported enum400. Busy/locked/uncertain and revision guards refuse changes. Actual stale UI save409 shows an alert without relabeling the old attachment; refresh reads authoritative current choice. Legacy generated absent style is Drawn, while manual video is not falsely labeled generated Drawn.

**S4/S5 — immutable intent, retry and safety.** Five real carousel worker completions attach exact captured style/version, independent of later defaults. Late revision/style changes block stale attach. Different styles create different visual caches while source, accepted plan/cap and narration identity remain equal. Five style completions reuse one SQL narration authority without fetch/new calls; selected-style layout refusal happens before narration dispatch/row creation. Cancellation followed by another style cannot evade a separate uncertain narration cache. Automatic readiness rejects desired/actual/captured mismatch. Already-authorized standalone and master flows capture the current style after source work, preserving standalone/master preferences and creating no publication rows by style alone. A stored accepted YouTube reference resumes once after style change/pause, with zero new uploads; a second recovery does nothing.

Actual stale derivative `media_prepare_required` Retry enters fresh preparation outside locks and preserves Recommended intent, captured style, notes, source/cap checks, old paid checkpoints and attachments. A stale Retry cannot supersede a newer desired revision. Omitted notes retain saved facts; explicit empty clears. In the real UI, failed/no-recommendation Drawn→Blueprint plus carousel uses a new Prepare rather than retrying obsolete intent, retains omitted saved notes and attaches actual Blueprint slides. [Screenshot](qa/failed-new-intent-success.png). Pending, failed and cancelled replacement states preserve old video/actual style; render counters show only while rendering. Uncertain narration disables style/format and requires an explicit charge-warning review; cancelling that dialog causes no request.

**S7 — scope.** Public preview generator contains only a fixed generic illustrative fixture, no arbitrary private input/provider/TTS path. Public HTTP bytes match the frozen assets and all five fully decode without audio. No new provider, settings consent, automatic authorization or paid call was introduced. Baseline actual M10 acceptance remains separate in `generated-social-media/qa-live-media.md`.

## Reproduction and limits

Run from the tested worktree with Node22. Local environment is loaded only by the ignored synthetic fixture wrapper:

```sh
node .factory/video-style-presets/qa/run.mjs node_modules/.bin/vitest run --config .factory/video-style-presets/qa/vitest.config.mjs --no-file-parallelism
node .factory/video-style-presets/qa/run.mjs node_modules/.bin/vitest run src/lib/videoStyles.test.ts src/lib/socialPublish.test.ts src/server/services/social/media/styles.test.ts src/server/services/social/autoStyle.test.ts --no-file-parallelism
node --import tsx .factory/video-style-presets/qa/browser.mjs
node --import tsx .factory/video-style-presets/qa/browser-flows.mjs
node --import tsx .factory/video-style-presets/qa/browser-state.mjs
npm run typecheck
git diff --check
```

Private artifact checks use [artifact-audit.mjs](qa/artifact-audit.mjs); the native tests require the private checkpoint, while browser/core fixtures are synthetic. Worker fault cases stub network/render only at stated boundaries; separate actual carousel completions and full cached-audio renders establish the real rendering paths. Production provider grants/posts, cross-browser/device playback and exhaustive arbitrary future layouts are not claimed.

Initial harness failures were corrected without product edits: waiting for hydrated content/save completion, matching combined actual/desired text, matching the documented public status label, supplying a required synthetic due timestamp, and testing protected node inflation against safe bounds rather than the smaller diagram box. Useful semantic/collision/role assertions remain; all final reported cases pass. No baseline failure is being hidden as a regression.

QA local server and browser processes are stopped after evidence capture; only the isolated snapshot received Next-generated configuration. Original runtime source, tsconfig and next-env were untouched.
