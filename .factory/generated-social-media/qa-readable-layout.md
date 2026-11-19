# Q7L independent deterministic layout acceptance

**Recommendation: accept the bounded layout patch for delivery after the PM build gate.** All final required local checks passed. Actual production narration/video/carousel acceptance remains PM-owned and unclaimed by this local rendering pass.

## Exact candidate and environment

- Workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-readable-layout`, HEAD/base `e8c9d06a7e81e261e8c29a8d5147030dd6000f59` plus frozen runtime delta in `draw.ts`, new `layout.ts`, and `model.ts` only. Read A7L `readable-layout-design.md`, changed source and developer tests; QA owns evidence/harness only.
- Final sorted-path runtime SHA256 **`e4d27e99c0975e4976cc6b7156a80a9eb914f684c07efe4f803262aa34e6b419`**. Algorithm: sorted path + NUL + bytes + NUL. [Final individual hashes](qa-readable-layout/fingerprint.json) match engineer refreeze; initial failed-candidate fingerprint retained separately.
- Node22.18.0 and actual bundled Kalam/Noto/native canvas. Blank-provider synthetic runner settings; no app server/session required for this renderer-only patch. Owned normalized Plan was read locally from the authorized chmod600 `/tmp` file. No product changes, provider/audio requests, production database/browser, deployment or paid narration by QA.

## Acceptance summary

| Result | Evidence |
| --- | --- |
| Passed | **22/22 independently authored tests** on final runtime, plus **38/38 affected developer cases** (layout16, registry16, timeline6), full typecheck and diff check. |
| Passed | Baseline reproduced exact first failure: scene1 mainIdea needed3lines at40px/850 versus2allowed; same issue scenes2/3, plus scene4state and edge label needed2lines versus1. Strict owned Plan was already valid. Baseline carousel0passed/1–4failed; video0–3passed/4failed. No claim of a model/source defect. |
| Passed | Final actual JPEGs for all5owned scenes and actual full-state video frames for all5 render successfully. Native fillText traces prove every complete title/summary/node/state/edge/units field survives wrapping. Role minima checked: title48, node36, state/edge30, summary36, units26px. Native ink boxes stay inside zones and canvas, with no text-to-text collision. No ellipsis, dropped field or source rewrite needed. |
| Passed | Independent native-font row bounds agree with exported metrics. Label/state/units/bar regions disjoint; chart bars remain at least48px. Foreign-node/revisit-ring protection, measured edge backgrounds, foreign route/leader sampling and label-background separation checked in both modes for every owned scene and targeted synthetic fixtures. Edge endpoints/node order are preserved. |
| Passed | All5owned slides and all5video samples visually inspected privately. Final leader fix changed only slides0/4 and video frames0/4; unchanged6files byte-identical to inspected versions, changed4files independently re-inspected. Titles, summaries, state blocks, relationship direction and leader associations readable. Owned artifacts remain chmod600 in private `/tmp`, not committed. |
| Passed | Synthetic2/4/6node, long label/state/edge, long title/four-line summary, chart state/units and actor/input/storage/output insets. A deliberately impossible unbreakable label retains typed media_layout refusal. Public synthetic4node output inspected after the defect fix. |
| Passed | Partial-state checks prove node/edge visibility follows spoken cues, carried edges stay visible, same-scene revisit ring appears only in its cue window. Bent-edge reveal endpoint matches an independently calculated cumulative segment distance. Original Plan/narration/cues/revisit targets/timeline/caption data remain unchanged. Synthetic exact-script character alignment was used; no audio was paired with this script. |
| Passed | Same scene/mode produces identical JPEG bytes. Per-scene/per-mode WeakMap layout reused;100warm frames require at most1native measurement call and finish within the10second guard. One tiny measurement canvas and bounded candidate/font loops inspected; no new unbounded string cache. |
| Passed | Visual renderer identity changes via separate LAYOUT_VERSION salt; planning VERSION remains unchanged. Reviewed script hash, fixed voice/model/settings and actual narration-key calculation match the privately captured baseline byte-for-byte. No paid cache deletion or forced speech regeneration. |
| Failed | None on final candidate. Initial20/22 run exposed one real bounded leader-placement defect, affecting2tests using the same4node fixture. Engineer added quarter-band candidates/three-segment rail detours, without font/line/schema relaxation. Exact synthetic fixture plus independent foreign-node/path/background geometry now passes both modes; no QA assertion weakened. |
| Blocked | No required local checks blocked. |
| Not applicable / outside scope | Browser rerun intentionally omitted per PM: no UI/action/auth contract changed. No fresh model/Brian0.78/R2/MP4/live acceptance claimed, and no0.88fixture audio reused. Source/recovery/publishing/caption/timeline/encoder implementations unchanged; unrelated broad suites not repeated. Bounded fallback may still refuse genuinely crowded diagrams; this does not guarantee arbitrary layouts always fit. |

## Reproduction and evidence

Run from the tested workspace with `/Users/ekene/.nvm/versions/node/v22.18.0/bin` first on PATH. The independent harness requires the authorized private owned-candidate `/tmp` file; its contents are deliberately absent from the repository. Synthetic fixtures are authored in the QA test file and contain no owned source.

```sh
node .factory/generated-social-media/qa-readable-layout/run.mjs npm test -- --config .factory/generated-social-media/qa-readable-layout/vitest.config.mjs --maxWorkers=1
node .factory/generated-social-media/qa-readable-layout/run.mjs npm test -- src/server/services/social/media/layout.test.ts src/server/services/social/media/registry.test.ts src/server/services/social/media/timeline.test.ts --maxWorkers=1
node .factory/generated-social-media/qa-readable-layout/run.mjs npm run typecheck
git diff --check
```

- [Independent tests](qa-readable-layout/independent.test.mjs), [native ink tracer](qa-readable-layout/trace.mjs), [final fingerprint](qa-readable-layout/fingerprint.json).
- Final logs: `/tmp/radar-readable-layout-qa-independent-final-geometry.log`, `/tmp/radar-readable-layout-qa-regressions-final.log`, `/tmp/radar-readable-layout-qa-typecheck-final.log`.
- Private5slides/5video samples and safe per-scene metrics: `/tmp/radar-readable-layout-owned-qa/scene-{0..4}.jpg`, `frame-{0..4}-0.png`, `carousel-metrics.json`, `video-metrics.json`.
- Public synthetic output: [four-node long relationships](qa-readable-layout/synthetic-4-nodes.jpg), [chart](qa-readable-layout/synthetic-chart.jpg), [long summary](qa-readable-layout/synthetic-long-summary.jpg).

No local server launched; root tsconfig/next-env unchanged. Full owned candidate/source/rendered images remain outside repository. Prior phase QA records and other agents’ changes preserved.
