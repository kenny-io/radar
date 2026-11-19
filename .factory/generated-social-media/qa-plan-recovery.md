# Q7S independent storyboard recovery acceptance

**Recommendation: accept the bounded recovery patch for delivery, with the PM production build gate and separate owner live acceptance.** No final product defect observed. The historical production failure’s exact exception remains unknown; these results do not prove that it was semantic validation or prove live model quality.

## Candidate and isolated environment

- Workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-plan-recovery`, HEAD/base `bb4d1a4d7a41506cb3881b7082a3310839b34597` plus frozen four-file runtime delta. Reviewed A7R design, integration contract, changed implementation and developer tests before final execution.
- Exact sorted-path runtime SHA256 **`7b65b9eae0350e6997659cb539dc95701cd2d77f3b732800a09a93c87c3796f7`**. Algorithm: sorted path + NUL + bytes + NUL. [Individual hashes and snapshot evidence](qa-plan-recovery/fingerprint.json) match engineer freeze; final reread matched all four files and isolated browser snapshot.
- Node22.18.0, dedicated local PostgreSQL `radar_media_plan_recovery_qa` at localhost:54329, isolated Next snapshot (path in fingerprint), `http://localhost:3854`.
- Verified synthetic Publishing QA session with an active scoped Owner membership; separate generated test businesses and foreign-business notes checks. Real AI/TTS/storage credentials blank. No production data, user browser, paid provider call, real post, merge or deployment.

## Coverage

| Result | Acceptance and evidence |
| --- | --- |
| Passed | **34 independent cases**. Initial success retains3calls. Initial cue/identity, measured layout and duration failures share one correction with both reviews. Semantic repair then review failure and review repair then invalid semantics stop without another correction. Plan/revise requests carry12000tokens and120s; review settings retained. |
| Passed | Awaited save boundaries before validation, before correction dispatch/payment, and after corrected candidate return: injected persistence failure stops subsequent calls. Available saved candidate skips fresh planning; completed candidate cannot correct again; dispatched ambiguity halts with `media_plan_interrupted`. Real SQL worker resumes persisted completed/dispatched states; explicit Retry resets the guarded allowance and projects `preparing`. No exactly-once claim for the provider-response-to-first-save interval. |
| Passed | Real DB changed-source→failed new plan→Retry clears old plan and both bindings before failure; Retry makes a fresh plan instead of reviving old text. Current account cap changes clear old authority. Legacy unbound derived work cannot start narration. Reviewed binding transfers into a matching legacy derived cache while preserving saved audio/alignment. |
| Passed | Actual browser Owner Retry uses persisted failed recovery, observes Preparing/Revising through refresh, no false ready;390px has no overflow and cancellation control receives keyboard focus. Actual legacy and changed bound-source Generate actions automatically reprepare, keep IG carousel selection and generateAfterPrepare, complete both reviews, queue derived work, and retain the carousel selection after refresh. These3browser cases were strengthened and separately rerun3/3 after the full34/34 run. |
| Passed | Real SQL budget refusal prevents correction dispatch after durable intent; guard cancellation prevents payment. Missing/unprovided sources and native/configuration failures never request a correction. Unknown errors use a fixed code and bounded repository-relative frames; malformed review fails safely. |
| Passed | Private candidate cannot be read through mediaNotes before acceptance or through foreign tenant scope. Reviewer-echo marker absent from public post/error copy and private allowlisted diagnostic. Typed semantic/source/layout/duration diagnostics retained safely. Failed/retried preparation preserves the existing attachment reference. Attachment sentinel in these tests intentionally has no served bytes; this is reference-preservation evidence, not a fresh asset-availability/render claim. |
| Passed | **34/34 affected developer tests** independently rerun: recovery12, repair15, context1, timeline6. **2/2 selected AI paid-admission tests** separately rerun (107unrelated tier tests skipped). `npm run typecheck`, `git diff --check`; original source `tsconfig.json`/`next-env.d.ts` unchanged. |
| Failed | None on the final candidate. Early active-source review found raw persistent reviewer text entering userMessage; engineer removed it before freeze, and independent real DB marker test passed. The first independent run33/34 had one harness assertion omitting allowed diagnostic frames; corrected to require bounded safe relative frames, then34/34 passed. No criterion weakened. |
| Blocked | No required local checks blocked. |
| Outside this bounded pass | Fresh real model response/quality/latency, live owner budget, Brian speech/R2 rendering, deployment and Google demo remain PM-owned. Existing full media/publication/Autopilot/YouTube-lifecycle acceptance not repeated; patch changes no grant, schema, consent or posting contract. No new real speech dispatched, even in successful preparation cases; accepted derived output was queued rather than claimed rendered. |

## Reproduction commands and artifacts

Run from the tested workspace with `/Users/ekene/.nvm/versions/node/v22.18.0/bin` first on PATH. The QA runner loads ignored synthetic settings without printing credentials.

```sh
node .factory/generated-social-media/qa-plan-recovery/run.mjs npm test -- --config .factory/generated-social-media/qa-plan-recovery/vitest.config.mjs --maxWorkers=1
node .factory/generated-social-media/qa-plan-recovery/run.mjs npm test -- --config .factory/generated-social-media/qa-plan-recovery/vitest.config.mjs -t 'actual browser recovery' --maxWorkers=1
node .factory/generated-social-media/qa-plan-recovery/run.mjs npm test -- src/server/services/social/media/planner.recovery.test.ts src/server/services/social/media/planner.repair.test.ts src/server/services/social/media/planner.context.test.ts src/server/services/social/media/timeline.test.ts --maxWorkers=1
node .factory/generated-social-media/qa-plan-recovery/run.mjs npm test -- src/server/ai/tiers.run.test.ts -t 'paid-stage admission hook' --maxWorkers=1
node .factory/generated-social-media/qa-plan-recovery/run.mjs npm run typecheck
git diff --check
```

- [Independent harness](qa-plan-recovery/independent.test.mjs); final log `/tmp/radar-plan-recovery-qa-independent-final.log`.
- Strengthened browser log `/tmp/radar-plan-recovery-qa-browser-final.log`.
- Visually inspected [Owner Retry desktop](qa-plan-recovery/owner-retry-revising.png), [390px keyboard focus](qa-plan-recovery/owner-retry-mobile.png), [changed-source Generate after preparation/refresh](qa-plan-recovery/changed-source-reprepare.png); also [legacy Generate](qa-plan-recovery/legacy-reprepare.png).
- Targeted logs `/tmp/radar-plan-recovery-qa-{regressions,admission,typecheck}.log`.

Own QA server stopped at completion. Existing records and other agents’ source edits preserved; QA changed only its evidence/harness.
