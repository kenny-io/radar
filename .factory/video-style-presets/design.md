# A8 — Five video and slide presets

Approved-ready system/experience design. Architecture owns this file only. Base `776be722f577c6d6c5570af5da2d84472bd6d9cb` (PR70), worktree `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, now branch `kenny/video-style-presets`. Baseline M10 passed actual production video, five slides, timing/source/cache audit. Preserve PM's release/state/verification records. No runtime edits, paid/provider calls or browser/production actions by architecture.

Read the user's invoked `/Users/ekene/.codex/skills/create-explainer-video/SKILL.md`. Drawing is now one preset, not a universal visual requirement. Preserve its underlying source-grounded script, accurate plain language, continuous Brian narration, real alignment, topic-led length, semantic continuity and quality checks in every preset. No avatar, stock footage, new subscription, image provider or generated executable code is needed.

## Exactly five rendered choices

Stable IDs: `drawn`, `kinetic`, `editorial`, `paper-cut`, `blueprint`. These are visual directions, not five narrator/model choices. All work for video and explanatory slides. They intentionally reuse validated semantic positions where useful; uniqueness comes from actual composition, material and cue-driven motion, not palette/font substitution alone.

| Name / card description | Composition and material | Motion at existing cues |
| --- | --- | --- |
| **Drawn explainer** — Linked drawings that explain each step. | Preserve the current dark hand-drawn canvas, warm outlines, semantic input/output colors, centered Kalam labels and existing shapes/routes. This is the known local style. | Existing stroke reveal, traced relationships, speaking markers and circled revisits. Baseline pixels/layout should remain equivalent for the same input. |
| **Kinetic type** — Moving words put the main idea first. | Text-dominant diagram: large sans labels, no enclosing full node cards, restrained semantic kind icons in reserved space, underline/baseline accents and state chips. On video, a large current entity/action-label strip uses the free area below captions (approximately y1648..1750); it repeats existing semantic labels, not invented claims. Carousel uses the same text-led diagram and strong title hierarchy without a fake active cue. | Whole word blocks build/settle at their node cue (bounded short translation/scale), action text changes at actual edge/revisit cues, and revisits emphasize the existing word group. No flashing or unrelated text loop. |
| **Editorial** — A clean, paced story with clear takeaways. | Warm print-like page, left-aligned title/body blocks, chapter folio in a reserved header subregion, ruled panels and flat semantic shapes with quiet keylines. Summary is a readable left-aligned deck; it is not shrunk to a decorative footnote. | Calm panel/rule wipes and short text reveals. Revisits underline the relevant block; no simulated hand drawing. |
| **Paper cut** — Layered paper shapes bring the story to life. | Warm paper field, filled cut-out semantic silhouettes, small deterministic irregularities and offset solid shadows. Paper/tape-like accents and layered material differentiate it from an outline drawing; labels stay axis-aligned and readable. | The entire cut-out shape/text group settles together at introduction; connections build like strips and revisits add a restrained paper highlight/lift. No random frame-to-frame texture or expensive blur. |
| **Blueprint** — A precise schematic for how things connect. | Dark blue engineering field, low-contrast unlabeled grid, framed title block, crisp technical sans, visible connection ports and rectilinear wire emphasis. Keep actual semantic shape distinctions. Never add fake dimensions, units or measured chart values. | Clipped scan/reveal of the object, wire traces along real routes, and bracket/port emphasis on revisit. Same audio cue times, no fabricated scanner progress metric. |

Use the exact existing labels, states, edge labels, summaries, claims and spoken script. Decorative folios indicate scene order only. Icons/grid/paper material are schematic presentation, not source facts. Different actions remain distinct registry entities; no preset may collapse the graph into generic source/process/result cards.

## Font, layout, contrast and motion bounds

Use only registered bundled faces: `Radar Hand` (Kalam) and `Radar Sans` (Noto Sans). Do not depend on unverified host fonts or synthetic weights. Every TextBlock/measurement must carry its actual family, size and alignment; cache keys include them. Drawn/Paper cut primarily use Hand; Kinetic/Editorial/Blueprint primarily use Sans. Title/folio/hero zones differ as above, but preserve the baseline readable minima (titles48px, node labels36px, state/edge30px, summary36px, chart units26px). Kinetic may prefer larger labels and fit down to the same readable minimum. Recompute fits with the actual face; do not reuse Kalam widths for Sans.

Keep validated1080×1920/24fps video and1080×1350 slides. Retain the full source/cue graph and measured collision-safe layout. Style-specific header chrome/hero/icons need explicit reserved rectangles and may not intrude into node text, foreign edges, summary, page counter or captions. Extend `layoutScene(scene, carousel, videoStyle='drawn')`; its WeakMap key becomes mode+style (at most10 entries per scene). Preserve measured glyph/background/route/motion-envelope checks and typed impossible-layout refusal. Preflight the selected style on a reviewed plan before a *new* narration charge; do not replan or rewrite facts for a visual-only selection.

Captions retain the existing **Kalam48 font, word wrapping, y1410..1630 safe area, text and timestamps** in this phase. Only their panel/foreground palette changes for contrast. Other styles may use Sans for diagram text. No preset stretches audio, adds pauses, shifts alignment, or changes timeline duration. Carried objects stay visible at scene handoff, and same-scene revisits remain valid.

Palette direction (measure every text/card combination; target at least4.5:1 contrast): Drawn keeps current colors. Kinetic uses near-black/white with restrained lime/cyan accents. Editorial uses cream/charcoal with dark blue/green/ochre. Paper uses cream and pastel-filled shapes with dark brown text. Blueprint uses deep blue with pale blue/white text and restrained warm emphasis. On light backgrounds, never reuse pale Drawn label colors without darkening them. Caption panels must be opaque enough for dependable contrast.

Use existing intro0.55s, edge0.8s and cue-associated emphasis windows. Any small translation/scale/shadow is contained inside the precomputed protected geometry; no per-frame reflow or random jitter. Paper texture can be a small deterministic tiled pattern, not a full-frame animated noise allocation. Keep subprocess concurrency, memory, CPU, output-byte and wall-clock limits unchanged.

## Shared data and identity contracts

Backend owns a client-safe catalog `src/lib/videoStyles.ts` exporting ordered `VIDEO_STYLE_IDS`, `VideoStyleId`, display labels/descriptions, fixed sample URLs, `DEFAULT_VIDEO_STYLE='drawn'` and an explicit absent-legacy normalizer. Do not put server rendering or credentials in this catalog. Mutation inputs use a strict enum; only absent legacy values default to Drawn, not arbitrary unknown strings.

Additive public types:

```ts
// SocialAuto: videoStyle?: VideoStyleId; // business default for NEW requests
// SocialPost: videoStyle?: VideoStyleId; // desired selection, persisted independently of actual file
// SocialMediaGeneration: videoStyle?: VideoStyleId; styleVersion?: number;
//                       requestedFormat?: 'recommended' | 'video' | 'carousel';
// generatedMedia: existing fields + videoStyle?: VideoStyleId; styleVersion?: number;
// Choice: {platform, format: 'recommended'|'video'|'carousel', videoStyle?: VideoStyleId}
```

`SocialPost.videoStyle` is desired choice. `mediaGeneration.videoStyle` is the immutable captured generation request. `generatedMedia.videoStyle/styleVersion` describes the **actual attached artifact**, written from that completed row's immutable checkpoint, never from a later mutable selector/default. For old generated attachments with absent style metadata, label the style Drawn; do not invent an implementation version. A legacy manually uploaded video without generatedMedia has unknown/saved-video styling and must not be falsely labeled Drawn.

Backend checkpoint uses immutable `renderStyle: {id: VideoStyleId, version: number}` for derived output; Consumer carries captured videoStyle and requested format. Public actual artifact fields remain `generatedMedia.videoStyle` and `styleVersion` (do not introduce a competing actualStyle name). Resolve once at intent creation: explicit choice → saved post choice → legacy Drawn. New pack creation explicitly initializes post choices from the submitted picker or the business default snapshot, so a later default change cannot retarget an existing pack. A multi-platform new pack may use one picker value for all targets, while per-post overrides remain possible later.

**Style-free authorities remain exact:** sourceKey/hash, source/cap reviewed-plan binding, RegistryDraft/recovery, factual reviews, reviewed script, Brian/model/speed, narration cache key and alignment. Do not put style into pack.voice or planner evidence. Style changes alone reuse an accepted same-source/cap plan and matching paid narration.

**Pixel identity includes style:** renderer identity = common renderer/layout/font identity plus selected ID and trusted per-style implementation version. Derived render/cache keys include that identity/style, format and geometry. Capture it before dispatch and pass the selected style into the credential-isolated render child. Each new actual artifact stamps its captured ID/version. Never reuse another preset's pixels. Existing ready files remain usable; no migration or forced re-narration is needed.

## Mutation, lock and automation behavior

### Existing post style selection

Add scoped Editor-allowed `social.mediaStyle` in `actions/socialMedia.ts` with `{packId,platform,videoStyle,expectedMediaRevision}`. It only persists the desired choice; no planner/provider/render/queue call. Use the existing business→publication→pack lock order and tenant authorization, reject active generation or locked/near-send publication, compare the expected revision, increment mediaRevision and preserve every actual attachment, source note, publishing option and consent. Viewer is read-only.

The normal Generate action captures desired style and revision atomically into its intent. Final attachment still requires request/revision ownership **and matching desired style**. A stale action cannot relabel or replace newer output. Business default changes affect new requests only, not in-flight work. Default save must not cancel a render.

New automatic queue/init requires selected style to match actual completed style (legacy generated metadata resolves Drawn), in addition to existing exact-generation readiness. An explicit new desired style with no generated result is not automatically ready. Manual review/publishing of the visibly retained old attachment remains possible under existing guards. Existing accepted platform upload references continue observation without another upload. Selecting/saving a style does not reset TikTok consent because bytes have not changed; attaching new media resets it as before. Never change audience/privacy/YouTube defaults or master authorization as a side effect.

### Business default

Add dedicated Editor-allowed `social.videoStyleDefault` in `actions/social.ts`, input `{videoStyle}`. Under the business row lock, spread the latest socialAuto and change **only** videoStyle. Preserve on/off, schedule, platforms, YouTube defaults/version, master program and consent. Existing `social.auto` saves must preserve the latest videoStyle so a stale broad modal cannot overwrite a separately saved default. No provider or job dispatch.

UI places a standalone “Default video & slide style” section outside AutoModal's disabled automation fieldset, following the existing independently saved YouTube-default section pattern. It remains editable when automatic drafts/master are off. Its own **Save default style** button calls only the scoped action. Explain “Used for new generation requests. Existing packs keep their choices.” The broad Save settings button does not implicitly save this separate pending selection.

`socialAutoOf` projects the default; `effectiveSocial` retains it through its existing spread. Standalone and master automatic generation capture the current default in each Choice at their usual guarded request boundary. No separate automatic style default or new autopublish permission.

## Experience before implementation

Create one reusable `VideoStylePicker` used in the normal Media step, existing explainer controls and default section. Five radio cards show a genuine renderer-produced thumbnail, name and short description. Selected state is obvious with border/check and accessible name; radio arrow keys/Space/Enter and visible focus work. Use the existing surfaces/tokens, a responsive2–3-column grid and one column on narrow phones. No external design service is available or claimed.

A separate **Preview** button opens a modal with a fixed public sample video (manual play/controls, preload none, poster fallback). Selection, opening preview and playback cause **zero** paid generation. Do not autoplay five videos or play hidden audio. New-pack selection is local until Generate creates the pack; existing-post selection saves via mediaStyle and reports a failed/stale save without silently pretending success. Controls are disabled during active generation; defaults stay independently saveable.

Existing controls show **Saved media: [actual style]** and **Next generation: [desired style]** separately when they differ. During replacement, keep the old preview and its actual-style label; progress names the captured new style. Failure/cancel never relabels old pixels. Refresh reconstructs the same states. A successful replacement updates actual metadata atomically. Viewers can see saved style/preview/download but cannot change choice/default or generate.

Keep Instagram Format/Recommended independent from style, with copy that style applies to videos and explanatory slides while Radar still chooses the format from context. Replace the universal dark-hand-drawn description with a neutral shared explanation plus the selected preset's description. Hide stale frame/scene progress once the generation is no longer rendering; a ready item should show ready/runtime, not an old render counter.

### Bounded stale-derivative follow-up

E8B independently reproduced the existing loop in a synthetic database: source drift → derived failure `media_prepare_required` → explicit Retry of the same non-plan-only row → same failure, with prior attachment retained and zero narration. The related fix is approved and owned by **backend index**, not just a UI workaround.

For that specific derived failure, deliberate Retry must create/reuse fresh preparation through the existing prepare-intent path **outside any held generation lock**. Capture the owned row/consumers, group still-current consumers by pack, and preserve their sourceNotes, original requested format (including recommended), captured selected style and automation options. Under the normal business→publication→pack→generation order, compare original consumer request/revision and desired style before superseding it; a stale Retry cannot overwrite a newer selection/intent. Fresh source and current cap are rechecked as usual. Keep old paid candidates/audio/files and current attachment; never reset speech uncertainty or quotas.

UI may continue calling Retry and follow the returned preparation state; a clear Generate fallback is acceptable for a legacy request that cannot be safely scoped. Do not blindly queue the same stale derivative again. Extend Generate choices to retain `recommended` as an intent and resolve it from the current prepared plan, so fresh preparation does not force the old recommendation into an override. Preserve owner source notes when input is omitted; explicit changed notes win. Missing/unready referenced preparation should safely re-enter preparation or give an actionable busy response, not an endless successful-looking loop. If a style-free plan is already preparing for the same source, either safely link the requested current consumer or return busy; do not report success while silently omitting that consumer. No model/network work occurs under row locks. Regression must prove the exact reproduced loop now reaches fresh preparation, stale CAS cannot supersede a new request, and matching paid assets are preserved.

Do not broaden this into a source ingestion rewrite. If source clipping is touched, put explicit owner reference notes ahead of bulk cached profile/crawl padding so the supplied facts are not silently cut off; retain the same evidence/SSRF/size boundaries and add one focused regression.

## Public previews and representative evidence

Public assets must use a new fixed generic illustrative fixture, never the owner's checkpoint, channel names, business/source text or OAuth account data. UI engineer owns `public/social/video-styles/{id}.jpg` and `{id}.mp4` plus a small offline build script. Use the **actual five renderer branches** on the same safe example/cue timeline. A short6–8s **silent visual sample** is sufficient and must be labeled as such: “Visual preview. Brian narration is the same across styles.” It is not a finished narrated post. No TTS or network is needed to build these assets. The preview script should have a fixed public fixture, not an arbitrary private-input path argument.

Separately, backend/QA render five representative full variants with the existing privately cached actual reviewed plan/alignment/audio, keeping them outside Git. Prefer the original cached MP3 from authorized storage: extracting AAC from the final MP4 and feeding it back through the normal renderer would double the existing0.5s delay/normalization or conflict with its MP3 input flag. If only final AAC is used in a local comparison pipeline, mux that existing stream unchanged and do not delay it again. No new narration request is justified for a visual style change.

All five require actual MP4/probe/full-decode/visual evidence, phone-size opening/intro/handoff/revisit/final checks and coherent carousel examples. Different hashes alone do not prove five styles; QA must inspect composition/material/motion and note concrete differences. Do not commit private owner outputs; synthetic screenshots/public previews may be committed.

## Exact implementation ownership

**E8B backend/shared renderer:** `src/lib/videoStyles.ts`, additive `src/lib/types.ts` fields; `src/server/services/social/media/{model,index,render,renderChild,layout,draw}.ts` plus new trusted style-render modules and focused tests; `src/server/actions/socialMedia.ts` (choice/style schema and post style-save); `src/lib/socialPublish.ts` readiness/style guard and affected tests. Own checkpoint/intent/CAS/cache/source-cap/selected-style preflight and reproduce/repair stale-derived retry backend boundary. Publish shared types/catalog/action signatures first. Do not edit UI/default/autogeneration files.

**E8U UI/orchestration/defaults:** `src/features/social/{SocialFlow,ExplainerMedia,AutoModal,PackView}.tsx` and new picker/default/preview components; `src/server/actions/social.ts` (dedicated default action, preserve-default broad saves, social.generate choice input); `src/server/workspace.ts`; `src/server/services/social/{generate,auto}.ts` plus direct master social callers if any; `public/social/video-styles/**` and offline public-preview generator; focused UI/default/auto tests. Initialize new post choices from the resolved snapshot and forward exact Choice contracts, never reimplement backend cache logic. Coordinate any unforeseen shared file before edits.

**QA** owns independent tests/evidence only. PM owns records, integration, actual production/browser/configuration and authorized delivery. No agent changes provider review, plan/subscription or global generation flags.

## Acceptance and rollout

Verify all S1–S7 in brief: exact five choices; five real visually distinct variants; public previews without paid calls; manual/default/authorized-auto persistence; actual-versus-desired metadata through pending/failure/cancel; legacy Drawn compatibility; style-free narration reuse and style-aware render cache; source/cap/tenant/role/locks/cancellation/consent regression; no automatic master/default change; measured glyph/collision/contrast and safe caption/timing behavior. Include refresh/mobile/keyboard and stale-save conflict tests. Verify the stale derivative issue before claiming it fixed.

Additive JSON/type fields need no database migration. Keep existing media generation rollout restricted until integrated QA and deployed owner-cohort smoke pass. Check web/worker exact revision, catalog/static assets and renderer identities. Only then demonstrate a style change reusing accepted plan/audio with no narration call, then refresh the real artifact metadata/UI. Existing private account/provider review limits and pending Google recording remain separate external work.

Rollback: stop new generation admission if needed, preserve paid plans/audio and completed artifacts; do not let older code consume an unknown style as Drawn and create mislabeled pixels. Existing attachments remain viewable/publishable under prior manual policy. Preserve the source/cap and no-resend guards. No consequential product choice is unresolved; routine implementation tuning stays within this contract.

### Mixed-version rollout decision

**Use the existing media-admission flag to coordinate both services.** Source inspection of deployed baseline776be722 confirms that its worker ignores new style/checkpoint fields, calls `renderMedia` without a style, and renders Drawn. A new web request could therefore acquire a non-Drawn cache identity while an old worker writes Drawn pixels into that row. A later new worker could reuse those bytes. Worker builds usually finishing first is not a safe ordering mechanism.

For the current Owner cohort, PM reports no active generations and all three baseline attachments ready. No data migration, version table, queue reset, provider change or deployment-framework change is needed:

1. Capture the existing Owner allowlist selector privately without printing it. Set `RADAR_SOCIAL_MEDIA_GENERATION=off` on **web and worker**, deploy those environment changes on the old revision, and verify the **actual running processes** see off with production stubs disabled. Merely staging variables with skip-deploys does not stop admission. Confirm no active media generation jobs/leases/renders before proceeding; do not cancel/delete paid records merely for evidence.
2. Merge the accepted styles revision. Let both Railway auto deployments finish **with admission still off**. Verify web/worker health and exact intended source revision, catalog/style renderer identities and required rendering runtime. Do not enable the web just because one build finished.
3. Restore the existing Owner selector to the **worker only**, deploy, and verify the actual new worker revision and restricted selector (not all). Web remains off, so stale browser capability state cannot create a new style request: server actions still reject it.
4. Restore the same Owner selector to web, deploy and verify the new web runtime. Then run the authorized owner style smoke, including actual-artifact metadata and unchanged narration identity, before reporting release.

The off flag gates new explainer admission/reconciliation; existing saved assets, previews/downloads and manual posting are preserved. Do not change `RADAR_SOCIAL_PUBLISHING`, master/automatic preferences, consent, retention maintenance or budget counters. The temporary pause is limited to generation. Keep any temporary test budget handling separate from this coordination decision.

This is simpler and safer here than changing GitHub auto-deploy/source settings or uploading a special worker snapshot. If unexpected active work appears, drain it to a known terminal state before the version transition rather than inferring that an environment variable update has already stopped it. No newly introduced style-aware row may be processed by the old worker.
