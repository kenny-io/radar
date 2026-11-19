# A7G — Canonical storyboard entity drafts

Design only; no runtime edits, paid calls, deployment or additional agents. Current runtime source is PR68 head `9a5de0b73c8cfadda7d4a0c282691f802899efc0`, deployed as main `490ca8350cf8637715b37c77dd68fb226021dd15`; PM has created branch `kenny/media-storyboard-registry` in the same worktree. Preserve PM's dirty release and style-brief records.

## Observed problem and smallest change

The live saved candidate reuses `fix` for `process/Reproduce first` in one scene and `process/Add title or nav link` in another. These are different actions, not aliases or changing status of one action. Current strict `node_identity` refusal is correct. The new representation should prevent authors from redefining identity per scene rather than weaken validation or silently rename IDs. Earlier factual overclaim feedback is also valid: a title/navigation-link check does not guarantee that readers reach a guide.

Ask the model for one global registry of concrete entities, and scene references to those entities. Compile that data to the existing normalized `Plan`; keep renderer, timeline, narration, source, publication and storage contracts unchanged. Registry structure prevents repeated identity definitions; it does not by itself prove that two differently described actions are semantically one entity. Source-grounded mechanism review still checks that meaning.

## Model output contract

Export a new `RegistryDraftZ`/`RegistryDraft` alongside the unchanged `PlanZ`/`Plan`:

```ts
// Existing Id and kind/label bounds remain unchanged.
interface EntityDefinition { id: string; kind: Node['kind']; label: string }
interface EntityReference {
  id: string;
  state?: string;
  values?: number[];
  units?: string;
  illustrative?: boolean;
  claimRef?: string;
}
interface RegistryDraft extends ExistingPlanMetadata {
  entities: EntityDefinition[]; // 2..48; ID defined exactly once
  scenes: (Omit<Scene, 'nodes'> & { nodes: EntityReference[] })[];
}
```

`ExistingPlanMetadata` is exactly current Plan fields other than scenes: topic, question, example, assumptions, caveats, recommendation and claims. Scene count3–8, references2–6, and all narration/edge/cue/revisit/mainIdea limits remain unchanged. EntityDefinition has only id/kind/label. EntityReference preserves the current per-scene state/chart values/units/illustrative/claimRef bounds and has **no** kind or label. Use strict object schemas on definitions/references so scene identity overrides are refused, not silently stripped or ignored. Keep the64KiB parsed-candidate bound. No new type of executable content, layout coordinate, URL fetch or arbitrary attribute.

A concrete action has one identity. Use distinct declared entities for reproducing a command and adding a title/navigation link. Use state only for evolution of the *same* entity, e.g. waiting/checking/complete; do not hide different actions inside a generic entity's changing state. Updating a registry label intentionally changes every reference. Genuinely new concepts get explicitly authored new IDs.

## Pure compilation and validation

Implement `compileRegistryDraft(draft): Plan` as a bounded pure transformation:

1. Parse RegistryDraftZ. Build a `Map` of entity IDs; duplicate definitions produce a typed repairable registry diagnostic. Never use a plain object with inherited key lookup.
2. For each scene reference, require the ID in the registry. Expand only `{id,kind,label}` from that definition plus the allowed per-scene reference attributes. Unknown IDs and identity override fields are errors. Do not choose among conflicting definitions.
3. Copy metadata, narration, claims, scene order, edges, cues and revisits exactly. Do not invent/rename IDs, rewrite labels, merge nodes, drop edges, edit cues, reorder scenes or change spoken text.
4. Pass the compiled shape through current PlanZ and unchanged strict `validatePlan`, then current measured layout/caption/duration checks. Exact cue phrases/occurrences, opening cue, all referenced relationships, recurring identity and source-backed chart rules remain mandatory.

Unused registry definitions can remain bounded private draft data and need not become another paid-repair trigger; only referenced entities compile into output. Current semantic checks still reject missing scene nodes/edges/cues. Suggested diagnostic additions are `entity_duplicate` and `entity_reference`, with fixed safe messages and numeric scene location. Do not broaden this patch into a new validator framework or unrelated rule set.

The compiler resolves representation only. A model that labels one generic entity “Fix” and changes its state between two unrelated actions may compile structurally, but must fail source/mechanism review. Do not claim registry structure guarantees semantic correctness.

## Private raw draft versus accepted Plan authority

Extend the server-only recovery union without a migration:

```ts
interface LegacyPlanningRecovery { version: 1; candidate: Plan; /* existing fields */ }
interface RegistryPlanningRecovery { version: 2; candidate: RegistryDraft; /* same fields */ }
type PlanningRecovery = LegacyPlanningRecovery | RegistryPlanningRecovery;
// Same sourceHash, maxDuration, repair and diagnostic fields for both versions.
```

New initial model and correction requests use `RegistryDraftZ`. Persist the parsed **raw RegistryDraft** as recovery version2 through the existing awaited lease-bound save **before** compilation. Compilation may fail and must not erase that paid draft. Reviews receive the strict compiled Plan, which matches what the renderer will use. Correction input contains the versioned raw candidate and diagnostic as untrusted data, separate from original evidence. Do not store an unreviewed compiled result in checkpoint.plan.

Only after complete compilation/validation and **both** mechanism and clarity reviews pass does the planner return the normalized Plan. The existing index then writes checkpoint.plan and its explicit sourceHash/maxDuration authority and clears redundant recovery. Public projection, notes/download endpoints and paid narration never see an unreviewed raw draft.

All current recovery safety remains: matching source/cap required; source/cap drift clears stale authority; repair available/dispatched/completed transitions are durable; a dispatched correction is not automatically sent again; explicit owner Retry can reset its guarded allowance. One correction remains shared across compilation, semantic/layout/duration defects and either review. No new correction merely because the output format changed, no automatic quota reset, and no extra upgrade AI call.

## Legacy paid candidate compatibility

`recoveryMatches` and private candidate parsing must accept **both known versions** when sourceHash/cap match. Do not discard a version1 Plan because version2 is now preferred.

- A valid legacy candidate may run current strict validation and both reviews, then become the same normalized accepted Plan without paying for an upgrade.
- An invalid legacy candidate remains intact in version1 recovery until the existing single correction returns. Pass that exact legacy candidate plus its typed conflict to one `social.media.revise` request whose output schema is RegistryDraftZ. Do **not** call `social.media.plan` first.
- For a structural correction, explicitly preserve the existing spoken narration and source-supported claims where possible; change only the authored entity definitions/references/cue targets needed to express the existing distinct actions. Do not gratuitously rewrite the explanation. If the issue actually requires a factual/length/cue correction, make only that supported change.
- A conflicting legacy ID cannot be converted by selecting the first label, creating automatic suffix IDs, merging actions or treating them as state variations. The model must author distinct entities and consistent references within the correction; unchanged strict validation and both reviews then verify the result.
- Persist a successful correction response as version2/completed **before** compiling it. Persistent invalidity fails with the existing safe guidance; no second automatic correction.

Existing accepted checkpoint.plan values, successful media, narration cache keys and source/cap bindings remain valid. No renderer VERSION bump or forced re-narration is needed solely because the authoring format changed. Render-cache identity continues to use the compiled Plan and actual renderer identity; narration identity continues to use reviewed spoken script/voice/settings. Do not clear existing artifacts to roll out this contract.

## Review rubric clarification

Update both review and correction fixed instructions, keeping evidence separate from untrusted candidates/findings:

- Reject unsupported material facts, invented product behavior, guaranteed reader/business outcomes, statistics or exclusive mechanisms. State what the supplied check tests; do not turn passing a title/navigation-link check into a promise that a reader will reach the guide.
- Permit accurate plain-language glosses of ordinary terms and clearly illustrative schematic actors when they explain the supplied mechanism without adding product-specific behavior or outcomes. “A command is a line you run” or a schematic reviewer is not automatically an unsupported product claim. A claimed automatic system action still needs evidence.
- Distinguish source-grounded paraphrase and necessary explanatory scaffolding from a new empirical claim. Do not require an extra source citation for every neutral term definition, but reject definitions that materially change the method or assert an unsupported mechanism.
- A revisit may highlight an object introduced earlier **in the same scene**, or an already visible object carried from a preceding scene. The actual renderer supports this. The object must exist in the scene and the exact spoken cue must refer to it. A revisit does not have to originate in an earlier scene.
- Recurring nodes do **not** all need highlighting. `revisit: []` is valid. Preserve meaningful relationships and continuity; highlight only when it helps the spoken explanation.
- Do not invent renderer constraints, enforce cosmetic preferences as factual defects or reject valid source phrasing solely because a different wording is preferred. Return concrete problems tied to the candidate and source, using the existing Review schema.

This follows the invoked explainer skill: explain necessary terms immediately, use schematic illustrations carefully, draw an object as it is introduced and **subsequently** circle/trace/point to it. Neither skill nor current renderer requires every highlight to cross a scene boundary. No grounding rule is relaxed.

## Implementation order and independent acceptance

Engineer scope: model draft schemas/compiler/recovery union; planner initial/correction schema selection, raw persistence and compiled review input/rubric; minimal recovery/index typing and focused tests. No new route, migration, UI workflow, style preset or publication change.

Independent checks must establish:

1. Global label updates compile consistently to every reference, with exact per-scene state/chart attributes preserved; duplicate definitions, unknown refs and override fields fail before review/TTS.
2. The observed legacy `fix` conflict is retained and sent to exactly one registry correction, with **zero new initial-plan calls**. Distinct actions stay distinct; no deterministic renaming/label choosing.
3. Raw schema-valid registry draft survives compilation failure/restart, remains private, and cannot authorize notes, ready status or narration. Version1 and version2 resume/source-drift/cap-drift/interruption behavior remains safe.
4. Corrected draft compiles to current strict Plan and requires both reviews. Same shared correction bound and budget/guard/time limits hold; persistent failure stops.
5. Real renderer/timeline fixture verifies a same-scene introduction then revisit works; no false requirement to highlight all recurring nodes. Negative source-outcome cases still fail the review contract; ordinary glossary/illustrative-role cases are explicitly permitted by fixed instructions.
6. Current publishing locks, auto readiness, source freshness and narration ambiguity/cache regressions remain unaffected.

PM alone runs one bounded fresh production Retry of the saved normal three-platform candidate after deployment. The temporary owner budget is an operational setting, not changed by this design; larger allowance is not proof that another attempt will fit. No new paid call is needed for architectural work. Five video styles remain the next phase after real video/carousel completion.

Rollback by disabling new generation admission first and preserving version2 checkpoints; old code that knows only version1 must not silently discard paid version2 drafts through new preparation. Existing completed attachments remain usable. Keep current source-binding guards.
