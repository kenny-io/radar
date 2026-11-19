# A7R — Bounded storyboard recovery

Architecture only. Workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-plan-recovery`, base/deployed `bb4d1a4d7a41506cb3881b7082a3310839b34597`. Own this record only. No source edits, provider calls, production access, deployment or additional agents.

## Evidence and diagnosis

PM reports two real successful structured `social.media.plan` responses followed by generic `media_failed`, with both rows `planOnly=true`, no accepted plan, no audio/video and **zero review/revision/narration calls**. Actual worker `stubPlan → carouselFrame` succeeds. This locates the failure between structured response and first review; it does **not** identify the lost exact exception. Candidate semantic validation, layout checks or evidence handling remain possible. Do not claim a particular cue defect was observed.

In current `planner.ts`, the initial response goes through `validatePlan` immediately and `validateCandidate` again before the one-correction review loop. `model.ts` semantics and `draw.ts` layout checks throw ordinary errors. `index.ts` catches them as generic `media_failed`, and saves an accepted plan only after the whole planner returns. Thus an initial candidate can neither be repaired nor diagnosed after failure.

There is also a source-binding defect: the plan-only path saves a changed source/source_hash while retaining an older checkpoint.plan. If new preparation fails, a later Retry can mistake that old plan for the new source. Fix this in the same bounded index/checkpoint change.

## Settled contract

Keep the existing model choice, Postgres queue, tenant ownership, source admission, budget and renderer. No new API, table, framework or broad AI refactor.

Schema-valid candidate → private checkpoint → semantic/layout/duration validation → mechanism review → clarity review → accepted plan. A failure in any **repairable plan validation or either review** can use one shared correction; correction then restarts all validation and both reviews. Never accept an invalid candidate or skip review to reach narration.

### Data ownership

Add server-only checkpoint fields; do not change public SocialPost contracts:

```ts
interface PlanningRecovery {
  version: 1;
  sourceHash: string;
  maxDuration: number;
  candidate: Plan; // PlanZ parsed; NOT semantically approved or publishable
  repair: 'available' | 'dispatched' | 'completed';
  diagnostic?: {
    phase: 'semantic' | 'layout' | 'duration' | 'mechanism' | 'clarity' | 'source' | 'unexpected';
    code: string; // fixed allowlisted code, never raw model/source content
    scene?: number;
    frames?: string[]; // optional bounded repo-relative media module:line:column only
  };
}
// Checkpoint additive fields:
// planningRecovery?: PlanningRecovery;
// planSourceHash?: string;
// planMaxDuration?: number;
```

Use a narrowly named optional planner recovery argument/callback rather than introducing a workflow abstraction. The parent supplies the current matching recovery checkpoint and an awaited persistence callback using the existing lease-bound save. Capture the initial and revised PlanZ-parsed candidates **before** semantic validation; retain only the latest candidate, not histories. PlanZ strips unknown keys and bounds all fields; additionally reject a candidate above a fixed generous bound (e.g.64KiB JSON). Recovery contains no credentials and remains scoped to the existing business generation row. Never expose it through `publicState`, `mediaNotes`, jobs payloads or AI-call logs. Existing source snapshot and generation retention/deletion own its lifecycle; GC behavior must remain unchanged.

`checkpoint.plan` remains the sole reviewed-plan authority. Write it only after full success, with `planSourceHash` and `planMaxDuration`; then clear the redundant unreviewed recovery object. The planner callback must not create a ready status, artifact, recommendation authority or narration dispatch.

### Single correction and resume

- Initial success still uses one plan and two reviews.
- An initial semantic/layout/duration defect uses one correction, then complete validation and both reviews. A subsequent review failure has no second correction available.
- A mechanism or clarity failure uses the same allowance; a revised validation failure stops before rereview/TTS.
- Persist `repair='dispatched'` before the paid correction call, under the existing lease and guard. Persist revised candidate with `repair='completed'` immediately when it returns, before validation.
- Automatic crash/reconciliation resumes a matching stored candidate. `completed` cannot acquire another correction. `dispatched` is an interrupted/uncertain text correction: stop with actionable `media_plan_interrupted`, rather than automatically sending another correction.
- **Explicit owner Retry** is a new deliberate text attempt: it may reset the correction allowance to available while retaining a same-source/cap candidate. This avoids another full plan request. All real paid calls still require fresh admission/reservations. This does not change the separate ambiguous-narration acknowledgement policy.
- Initial request completion followed by process loss before checkpoint persistence is not guaranteed exactly once; the existing text-provider retries and budget bound that interval. Do not promise exactly-once text billing.
- Retry of a plan-only row should project `preparing`, not `queued`, so the existing Writing/Checking/Revising labels work without new UI components.

### Trust and validation boundaries

Turn known plan semantic failures into typed errors with fixed codes and useful locations. Preserve all existing checks: exact spoken cue/occurrence, first spoken drawing, every object/edge/revisit cue, recurring identity, changed diagrams, source-backed charts, word/character/duration caps and measured layout. Do not silently normalize an invalid mechanism or drop a relationship to make it pass.

Use typed content-layout errors for overlong labels/captions. Missing fonts/native library/IO and unexpected runtime errors are configuration/internal failures, **not** requests to spend on another plan. Do not classify errors by arbitrary provider text. Known missing/unallowed primary sources still return source guidance immediately; reviewer-provided URLs are not source evidence and cannot trigger reads. Source fetching remains bounded, SSRF protected, and at most the existing original-source allowlist.

Correction input separates immutable source evidence, candidate JSON and diagnostic findings. Fixed system instructions treat every supplied field as untrusted data. Validation findings locate a defect; they do not establish facts or authorize posting. Source/guard/budget/timeout/model refusal and malformed reviewer responses never trigger a correction.

### Exact but safe diagnostics

Persist allowlisted validation code/phase and optional numeric scene index in the same private recovery checkpoint, and expose a safe actionable `RadarError` code/message when correction cannot resolve it. Capture the original failure before attempting correction, so later failure does not erase its category accidentally. Source text/labels, raw Zod output, URLs, provider responses, tokens and arbitrary `Error.message` must not enter console/alert/AI metadata.

For unexpected exceptions, a bounded optional list of **repo-relative files under `src/server/services/social/media/` with line/column only** can identify the throwing location without storing the exception message or full stack. This is sufficient for PM read-only diagnosis alongside the retained candidate. Use a fixed internal error code and safe user copy. Do not add a diagnostics endpoint or public unreviewed-plan download.

## Source/cap binding

Before overwriting checkpoint.source or source_hash, compute current source hash and current duration cap. Reuse an accepted plan only when explicit `planSourceHash` and `planMaxDuration` match those values. Reuse a recovery candidate only when its version/hash/cap match. Atomically clear stale accepted plan, both bindings and stale recovery before saving a changed source/cap. Do not infer provenance from the newly overwritten source field.

Legacy prepared plans without the new explicit binding must be prepared again when entering a new preparation/retry; existing saved attachments and successfully derived media remain usable. In-flight pre-release accepted plans should be handled fail-closed before a new narration if binding cannot be established, while accepted platform upload references continue their existing observation behavior. No migration or provider data lifecycle change is needed. Test that source drift → failed preparation → Retry cannot revive an older plan.

## Performance change justified by actual evidence

Set initial plan and correction requests to **12,000 max output tokens and120-second provider-attempt timeout**. PM observed successful outputs8,575/8,635tokens at~74s and repeated initial8,000-token cutoffs/90s gateway timeouts. This is a conservative ceiling increase aimed at avoiding wasteful truncation retries, not a change to the selected business model or narration speed. Reviews retain their existing settings. Prefer3–5 diagrams for a short topic while keeping schema capacity3–8 for genuine complexity; do not shorten an essential causal chain or weaken the180-second/platform cap.

Each actual provider attempt, including retry/failover, retains the same guard, known-price check and atomic reservation using the actual token ceiling. Keep the eight-minute admission deadline, outer generation cancellation and all speech limits. The final admitted request may finish after that deadline under the existing semantics; do not describe it as a strict wall clock. A larger text ceiling can still hit budget; refuse before dispatch and never reset counters. PM owns temporary test budget configuration, not this patch.

## Implementation order and ownership

1. Engineer: typed validation/layout diagnostics in `model.ts`/`draw.ts`, additive recovery and accepted-plan binding types.
2. Engineer: planner candidate checkpoint + shared one-correction loop + safe errors + scoped request settings; retain source-only evidence and existing admission callback.
3. Engineer: index lease-bound persistence, source/cap clearing/reuse and explicit Retry reset/preparing projection. Ensure only reviewed plans reach derived generation/narration.
4. Engineer: focused tests and handoff; no unrelated UI, schema, publishing or preset work.
5. Independent QA: real DB/worker/browser candidate persistence, restart and stale-plan regression, then PM one bounded live normal three-platform pack test. Do not regenerate the old queue demo just for evidence.

## Required independent checks

- Known cue/recurring-identity/layout/duration error repairs once; all validators and both reviews run before narration.
- Semantic repair followed by review failure and review repair followed by semantic failure both stop without a second correction.
- Valid initial plan retains three-call path; missing source/provider refusal/config failure never triggers correction.
- Completed paid candidate survives failure/restart and is reused without another plan request. Interrupted correction never auto-dispatches twice; explicit owner Retry is a fresh guarded allowance.
- Source or duration cap change clears all old authorities; failed new attempt then Retry never reuses old reviewed text. Legacy unbound plans fail closed for new preparation.
- Candidate/recovery is tenant private and cannot make UI ready, expose notes or reach narration before approval.
- Typed code/phase and bounded safe frames identify synthetic failures; source/secret marker strings do not appear in logs/public projection.
- Token/time ceilings are passed correctly; actual budget/refusal guards remain effective under larger limits.
- Existing narration uncertainty/cache, publication locks, automatic readiness and accepted-reference handling remain unchanged.

Rollback: disable new generation admission if required, preserve completed attachments and paid checkpoints, and keep the stale-source binding guard. Do not drop rows or retry ambiguous narration. No provider or user decision is needed for this bounded design; exact historical exception remains unknown and must be labeled as such until new diagnostics capture one.

### Implementation clarification

A compatible final optional planner argument is `{sourceHash, checkpoint?: PlanningRecovery, save: (value: PlanningRecovery) => Promise<void>}`; derive or verify that hash against the supplied source snapshot inside the planner. Return `Plan` unchanged. The existing lease-bound index save owns durability, not the planner's AI adapter.

Do not strand legacy recommendations in a Generate/error loop: the current UI calls `mediaGenerate` when a recommendation exists and source notes are unchanged. A legacy unbound prepared plan should therefore transparently enter the existing prepare-intent path with the requested choices and generate-after-prepare behavior, or receive an equivalent automatic reprepare transition. Preserve business→publication→pack→generation lock ordering; do not acquire business/publication locks while holding a generation row merely to redirect. Existing attached media stays available. This requires no new component or user file upload.
