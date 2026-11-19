# A7L readable deterministic layout handoff

Frozen working tree: branch `kenny/media-readable-layout`, base/deployed `e8c9d06a7e81e261e8c29a8d5147030dd6000f59`. Owned runtime paths: `draw.ts`, new `layout.ts`, and `model.ts` visual renderer identity salt plus PM-approved `layout_collision` type literal only. Owned test: new `layout.test.ts`. Preserve architect/QA/PM records. No planning/schema/recovery/source/narration/publishing changes, dependency, migration, provider call, paid narration, production mutation, commit or deployment performed.

## Implementation

`layoutScene(scene,carousel)` computes a deterministic fitted scene once per scene identity/mode using a WeakMap and one native measurement canvas. The bounded helper exposes node shape/protected/inner rectangles, disjoint fitted label/state/chart/units zones, glyph bounds/baselines, edge polylines and measured label backgrounds/leaders. No source text enters logs or public metadata.

Geometry follows the approved title/diagram/summary rectangles,570px single-column or360px two-column shapes centered260/820, row-height/gap bounds and16px protected shape inflation for revisit rings/strokes. Actor inner rectangles fit inside their ellipse; input slopes, storage caps and output folded corners receive insets. Text fitting uses actual bundled glyph ascent/descent/overhang and advance width, full ordered words, deterministic2px font steps, real measured line height and centered baselines. Label/state form one vertically fitted group; charts reserve at least48px bars plus separate units/state text. No ellipsis, truncation, field omission, arbitrary word splitting or subminimum fonts.

Font minima: titles48px (preferred56), node labels36 (preferred44), states/edge labels30, summary36 (preferred40), chart units26 (preferred28). Summary allows up to4 readable lines in180px. Edge backgrounds fit actual glyph bounds plus padding, replacing the fixed mask. Horizontal labels that cannot fit in the gutter use collision-checked free bands/cells and unarrowed leaders, with quarter-band positions and bounded three-segment detours around protected regions when a diagonal blocks a simple leader. Paths retain semantic direction and avoid foreign protected nodes; skipping/reverse connections use bounded gutter/outer-rail or inter-row routes with stable lane selection. Foreign paths, leaders, label backgrounds and reserved regions are checked. Dense/impossible layouts return typed safe refusal (`layout_collision` or existing content-fit codes) instead of hiding content. The bounded search is conservative; it is not an unrestricted graph-layout solver.

Drawing consumes these layouts while preserving the dark palette/semantic shapes and original node/edge/revisit cue timing. Bent path reveal and markers follow cumulative polyline distance. Captions/splitting/position/footer, audio and timeline calculations are unchanged. Page indicator baseline is1308, clear of the summary. `LAYOUT_VERSION='readable-layout-v1'` is a separate salt in `rendererIdentity`; planning VERSION remains `diagram-v2-aligned-cues`. Reviewed script/voice/settings and narration cache inputs are unchanged. Existing rendered pixel cache keys invalidate through the changed visual identity; paid plans/audio remain reusable.

## Private actual-candidate diagnostic evidence

The owned candidate stays private at `/tmp/radar-owned-layout-candidate.json`. No full candidate/source/text or its images were copied into committed fixtures.

Final local replay generated **all five carousel slides**, **all five complete video-scene frames**, and available revisit frames with actual bundled fonts, plus geometry at `/tmp/radar-readable-layout/`. These are diagnostic images using synthetic character timing for video, not production artifacts, paid narration or live posting evidence. Files: `slide-0.jpg` through `slide-4.jpg`, `video-0.jpg` through `video-4.jpg`, `revisit-*.jpg`, `layouts.json`. Replay script is private `/tmp/radar-readable-layout-probe.mts`.

Every actual scene succeeds in both modes. Node labels remain44px; summaries remain40px with problematic summaries fitting3 lines; storage state remains30px/2lines; the long edge remains30px/2lines. All words and semantic data remain unchanged. Engineer inspected all five slides and representative video0/4; PM independently inspected all five slides and video1/4 and approved the exact owned candidate's local visual readability. After the independent synthetic diagonal/long-label finding, the final bounded leader search was replayed against all five scenes. Slides/video0 and4 have updated collision-free leader placements; the other six images are byte-identical. Engineer re-inspected the changed slides, and PM was asked to refresh the exact final visual approval. No listening or full encoded production-video claim is made.

## Developer checks

Node22.18.0; synthetic local PostgreSQL `radar_media_backend_final` only.

- `DATABASE_URL=<synthetic local DB> node node_modules/vitest/vitest.mjs run src/server/services/social/media/*.test.ts` — **88/88 passed** across9 suites, including16 new layout cases and22 real local DB regression cases.
- New layout cases:2/4/6-node layouts; full long summary; storage dual zones; actor ellipse; chart bars/state/units; horizontal leader labels; long horizontal labels beside a diagonal route; skipping/reverse routing; cumulative path distance; impossible text and dense collision refusal; real fillText/glyph tracing; deterministic JPEG/layout reuse and zero warm draw measurement; visual salt change with unchanged script/timeline.
- Existing suites retain reviewed registry/legacy repair, exact timing/captions, source freshness, source/cap binding, failed preparation/Retry, durable real carousel worker/cache, narration ambiguity and atomic reservations.
- `node node_modules/typescript/bin/tsc --noEmit` — pass.
- `git diff --check` — pass.
- Byte comparison against HEAD confirms `narration.ts`, `planner.ts`, `index.ts`, `timeline.ts` unchanged.

Independent Q7L geometry/resource/cache/visual checks are a separate pass. This engineer did not run paid narration, publish posts or claim production media readiness. PM owns the isolated build/deployment and bounded continuation of the existing saved candidate. Keep the reviewed source, audio and current attachments on failure/rollback; disable new admission if needed without deleting paid checkpoints.
