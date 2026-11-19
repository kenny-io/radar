# A7L — Readable deterministic drawing layout

Architecture/design only. Confirmed worktree `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-readable-layout`, deployed base `e8c9d06a7e81e261e8c29a8d5147030dd6000f59`. No runtime source, paid call or production mutation. The owned compiled candidate and diagnostic images remain private under `/tmp`; do not commit its text/JSON/images as synthetic test fixtures.

## Measured diagnosis

Actual bundled Kalam/Noto measurements reproduce52 fields. First failure is zero-based `scenes[1].mainIdea`:113 characters require3 lines at40px/850px, but the renderer permits2. Scenes2 and3 summaries likewise need3 lines. Scene4 additionally has a28-character state requiring2 lines at30px/325px and a27-character edge label requiring2 lines at30px/220px. Independent QA reproduced the same paths. These are ordinary readable phrases and need renderer adaptation, not model rewriting. Private metrics: `/tmp/radar-owned-layout-measurements.json` and QA's separate file. No whole owned text is included here.

Current geometry has further defects: two355px node columns centered300/780 leave125px, while a230px edge-label mask is drawn across that gap. Wrapped labels cannot safely use that mask. Node labels/states/chart labels currently share overlapping implicit baselines. A successful wrap alone does not prove readable geometry.

## Smallest implementation

Keep the dark hand-drawn palette, semantic shapes, exact strings and scene order. Replace implicit baselines with a small deterministic **scene layout result** computed once per scene/mode: node shapes and inner text rectangles; fitted line/font/baseline data; directed edge paths; measured label rectangles and optional leader segments. Existing draw functions consume it. This is a bounded grid/candidate-placement helper, not a new graph-layout library or framework.

An internal exported helper such as `layoutScene(scene, carousel)` may return these rectangles/routes for tests. It is not a public endpoint. Caption splitting/positions, narration, timeline cues, dimensions and24fps remain unchanged.

## Geometry

All coordinates are for1080px output width:

- Up to3 nodes: one570px column centered540. Four–six nodes: two360px columns centered260 and820, leaving200px between them. Preserve current scene node order.
- Carousel title rectangle: x100,y65,w880,h140. Diagram rectangle: x80,y240,w920,h790, ending1030. Summary rectangle: x100,y1080,w880,h180, ending1260. Page indicator around baseline1308; keep clear from summary. Output stays1080×1350.
- Video title rectangle: x100,y120,w880,h140. Diagram rectangle: x80,y330,w920,h950, ending1280. Existing caption box y1410..1630 and footer stay untouched. Output stays1080×1920.
- Rows = ceil(nodes/columns). Row node height is at most240carousel/260video, additionally bounded by `(diagramHeight - (rows-1)*minimumGap)/rows`. Minimum gap125carousel/115video. Distribute leftover gap evenly; with3 rows this yields180px carousel nodes/gap125 and240px video nodes/gap115. With fewer rows, nodes may be taller to keep readable text without shrinking.
- Reserve the entire node bounding box, inflated for its12px revisit ring plus stroke clearance, against foreign text and routes. Actor inner text must fit inside the ellipse (e.g.72% width/68% height); parallelograms need slanted-side insets, storage needs top/bottom cap insets, and output folded corners need top clearance. Do not merely use the whole rectangular bounding box for every shape.

## Typography and text preservation

Fit full words/punctuation, never ellipsize, crop, skip a field, change facts or break an unsplittable word arbitrarily. Whitespace may wrap into rows; preserve its ordered non-whitespace text. Try sizes deterministically in2px steps from preferred down to the documented minimum, never below it:

| Field | Preferred → minimum | Region rule |
| --- | --- | --- |
| Title |56→48px | Up to2 lines inside fixed title box |
| Node label |44→36px | Up to3 lines in its allocated inner label zone |
| Node state |30px minimum | Wrap as needed inside a separate state zone |
| Edge label |30px minimum | Normally1–2 lines; measured box, generous width up to320px |
| Carousel main idea |40→36px | Up to4 lines within180px summary region; actual candidate fits3 at40 |
| Chart units/illustrative note |28→26px | Separate units zone, never over bars/label/state |

Measure actual glyph ascent/descent/overhang as well as advance width. Center each fitted block vertically using measured baselines and fixed line-height (~1.15×font), rather than treating the first baseline as the top of its box. Node label+state are fitted as one group with separate disjoint rectangles, padding and a real gap. Label and state cannot independently consume the same height. For a chart reserve nonzero bars area (at least48px), then fit label/state/units in disjoint zones; refuse a truly overcrowded chart rather than hide its units/state or shrink below minima.

The actual saved candidate's summaries, state and edge label must fit at these readable bounds without changing its content. More extreme legal schema strings may still be impossible in a six-node diagram; retain a typed layout refusal at the minimum, not an arbitrarily small font.

## Edge paths, label boxes and collision checks

Compute all node boxes before placing edge labels. A label's dark background is the fitted text bounds plus real horizontal/vertical padding; remove the fixed230×45 mask.

1. Keep a clipped straight directed connection when it does not cross any nonendpoint node. For blocked/skipping connections, use a bounded orthogonal route through the200px central gutter or outer rails around x56/x1024. Use stable parallel lanes for distinct routes where needed. No broad force-directed algorithm or change to semantic endpoints.
2. Prefer a measured label at the connection midpoint, then bounded positions along it. Reject any candidate colliding with any protected node/ring, title, summary/caption/footer or already placed label.
3. When a horizontal gutter cannot hold a full label, place it in a free inter-row band or an empty final grid cell. Search a fixed ordered set of nearby x/y positions deterministically. Attach an unobtrusive unarrowed leader to the corresponding connection; do not squeeze text into the200px gutter or leave it ambiguously detached.
4. Check leader segments and main paths against nonendpoint nodes, other label backgrounds and reserved regions. A label may mask its **own** connection for readability, but must not cover a foreign connection or another label. Bounded alternate candidates/routes are sufficient; if none is collision-free, emit typed `layout_collision` rather than draw through content.
5. Draw with the existing arrow direction/color and introduction/revisit cues. If a path bends, reveal/marker progress follows its cumulative arc length with the existing cue start/duration. Do not change audio or replace a cue with fixed scene timers. A carried edge remains fully visible as before.

Do not reorder nodes, drop edge text or invent numbered legends just to fit this candidate. A same-scene revisit remains valid and its ring must not collide with labels. Background bounds are part of collision checks, not only glyph bounds.

## Resource and cache contract

Measure/finalize once per Scene+mode, not per video frame. A WeakMap keyed by scene with two mode entries is sufficient and naturally releases completed plans; use a single tiny measurement canvas and bundled registered fonts. Keep any reusable string metrics cache bounded. Rendering remains deterministic and under existing CPU/process/frame limits.

Change the visual renderer identity so old pixel outputs cannot be reused. Prefer a dedicated `LAYOUT_VERSION='readable-layout-v1'` salt in `rendererIdentity` while keeping the planning/source VERSION stable, so a layout-only change does not discard paid plans/candidates. Existing render cache includes rendererIdentity. Actual narration cache hashes reviewed script/voice/model/settings and must remain unchanged. No new dependency, migration, source material or model call is needed.

## Independent acceptance

- Replay all five scenes of the privately saved compiled Plan locally; no model rewrite. Render actual JPEGs and complete video scene frames with real fonts, including the three summaries and dual-zone state/edge cases. Clearly label them local diagnostics, not production output.
- Native canvas fillText/glyph traces prove all ordered text survives wrapping, font minima hold, and glyph/background boxes stay within their intended regions. Verify text-text, foreign-node, edge-label and reserved-region collision checks, not merely line count.
- A synthetic worst-case fixture checks long states/labels/units, dense edges and an intentionally impossible fit. Typed refusal remains before reviews/TTS; no silent field removal.
- Timing/captions/revisits and semantic endpoints stay unchanged. Same input/mode produces identical layout; repeated frames reuse measured results.
- Old/new visual identities differ, but matching narration identity is unchanged. Paid candidate checkpoint/source/cap binding and ambiguity guards are untouched.

Rollback by disabling generation admission if necessary while preserving candidate/audio/artifacts. Do not delete paid narration or weaken strict Plan validation. No user decision is required for this rendering correction; five styles remain queued after the real generated flow works.

## Private image evidence

Architecture rendered the actual owned compiled Plan locally with the bundled fonts. `/tmp/radar-layout-baseline-scene-0.png` is the unmodified strict renderer's successful first scene. `/tmp/radar-layout-baseline-overflow-scene-1.png` and `...-4.png` are explicitly marked **LOCAL DIAGNOSTIC · old layout · line refusal suppressed**: only the local diagnostic copy's line-count refusal was removed to expose the current full text at its existing coordinates. They are not fixed-layout or production output.

Visually inspected evidence shows an edge label partly hidden beneath its target node in scene1, and state text extending below a storage shape plus edge-background/text collisions in scene4. The summary sentences have available lower-canvas space; the two-line policy itself caused refusal. The full owned Plan, diagnostic source/metrics and images remain outside Git. Engineer/QA must produce separate final-layout evidence without disabling any checks.
