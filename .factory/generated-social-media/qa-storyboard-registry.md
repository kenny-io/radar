# Q7G independent registry acceptance

**Recommendation: accept the bounded registry patch for delivery after the PM build gate.** No final product defect observed. This accepts local implementation behavior; the overall generated-media phase remains unaccepted live until PM’s real video/carousel succeeds. A registry prevents per-scene identity redefinition; it does not prove that a model used distinct entities for distinct real actions or that a live explanation is accurate.

## Candidate and environment

- Repository `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-storyboard-registry`, base/HEAD `490ca8350cf8637715b37c77dd68fb226021dd15` plus frozen model/planner changes. Read A7G `registry-draft-design.md`, existing acceptance brief and runtime/developer tests; no source edits by QA.
- Exact sorted-path runtime SHA256 **`5a9225dfa6e768461bfc895e9682a25f61371492d6d8f98ad6e1c059b9378784`** (path + NUL + bytes + NUL). [Fingerprint record](qa-storyboard-registry/fingerprint.json) includes individual hashes and isolated snapshot; final reread matched both final frozen files. Browser/DB full acceptance used the first freeze; exactly two universal prompt strings changed afterward. The initial fingerprint is retained separately, and affected cases were rerun on final source as recorded below.
- `model.ts`: `3efdef18312a77e77446cc071e7a5f044d376768d765ccf7ee877c0971d230a3`; `planner.ts`: `016f8d6a6f3085095136659b18a73c3af957e9c87ad65d56d3312458d19d541f`.
- Node22.18.0; dedicated synthetic DB `radar_media_storyboard_registry_qa`, localhost54329; isolated Next snapshot (exact path in fingerprint), `http://localhost:3855`. Ordinary verified synthetic Publishing QA user with scoped active Owner membership. No production account/browser/data, real provider calls, paid narration, R2 mutation or posting. Model responses controlled only at AI boundary; admission callback uses actual SQL budget transactions.

## Acceptance coverage

| Result | Coverage |
| --- | --- |
| Passed | **36/36 independent tests on the first freeze** (unchanged execution/compiler/DB/UI coverage retained): exact metadata/scene order/narration/claims/edges/cues/revisits/state preservation; global label expansion; chart attributes preserved; source-backed chart and exact-cue requirements still reject invalid plans. |
| Passed | Distinct reproduction and title/navigation-link actions stay separately authored entities. Duplicate definitions refuse rather than selecting/renaming/merging; unknown/prototype-name refs refuse; explicitly declared constructor ID works safely through Map. Strict scene kind/label and definition extra-field overrides reject. No compiler ID repair or action collapsing observed. |
| Passed | New initial raw registry saves version2 before compilation/review. Duplicate raw draft survives compile failure privately, correction intent saves before dispatch, revised invalid draft saves version2/completed and cannot correct twice. Oversized schema-valid raw draft refuses at64KiB without saving/repair. |
| Passed | Valid paid v1 candidate runs only2reviews. Observed conflicting legacy fix candidate is retained exactly and supplied to1registry correction followed by both reviews, with0initial-plan calls. V2 available candidate resumes without planning; dispatched ambiguity halts; completed invalid draft cannot gain another correction. Compiler-repair→mechanism failure shares the one allowance. Real budget/guard refusal prevents correction dispatch. |
| Passed | Real SQL worker restart retains failed completed raw draft, safe diagnostics and prior attachment reference; no accepted plan, notes or narration. Foreign-business notes denied. Corrected raw candidate requires both reviews before an explicitly source/cap-bound accepted Plan and recovery clearing. Source/cap drift clears v2 authority before failed fresh plan. Unprovided URL is not fetched/repaired; reviewer diagnostic injection remains separate untrusted data. |
| Passed | Final source-general wording reread: the universal rules use unrelated actions rather than the documentation-specific test example; downstream guarantees still require explicit supplied evidence and stated conditions. **15/15 relevant independent grounding/rubric/legacy cases** pass on final source (22unrelated cases intentionally skipped), including a new conditional-source fixture; **16/16 registry developer cases** rerun on final source. Only2literal instruction strings changed; documentation conflict fixture unchanged. This is prompt-contract enforcement evidence, not a claim that a live model will always judge evidence correctly. |
| Passed | Fixed review/correction rubric permits neutral explanations and same-scene introduction→revisit, and rejects unsupported outcome guarantees. Real local timeline/canvas render shows a later same-scene highlight; comparison with highlight removed changes rendered bytes, and empty revisit for other recurring nodes remains valid. This is renderer evidence, not a fresh spoken-video claim. |
| Passed | **2actual browser journeys within36**: normal Generate persists Writing through refresh, accepts reviewed registry into queued derived output, has0file inputs; Owner Retry resumes legacy conflict with1registry correction and0new plan calls, displays Revising after reload, no false ready, prior attachment reference preserved.390px no overflow; cancellation control keyboard focus usable. AI/action success was not faked at HTTP transport. |
| Passed | **50/50 affected developer cases** separately run: registry16, recovery12, repair15, context1, timeline6. Full `npm run typecheck` and `git diff --check` repeated on final wording; original `tsconfig.json`/`next-env.d.ts` unchanged. All individual source hashes still match freeze. |
| Failed | No final product failures. First independent35/36 run had one QA assertion comparing serialized object property ordering after schema parsing; replaced with exact structural deep equality, then full36/36 passed. No source change or weakened acceptance. |
| Blocked | No required local patch checks blocked. |
| Outside scope / not rerun | Actual live model semantics/latency, owner remaining allowance, fresh Brian/R2 video/carousel and deployment remain PM-owned. Controlled reviewer responses prove flow enforcement and instruction contents, not a real model’s judgement. Full publishing, consent, authorization, cache and lifecycle suites were not repeated for this2runtime-file patch; no new routes/migrations/UI/renderers or public contracts. Existing attachment sentinel was a reference-preservation assertion, not served-media availability. |

## Commands and evidence

Run from the tested workspace with `/Users/ekene/.nvm/versions/node/v22.18.0/bin` first on PATH. Runner loads ignored synthetic settings without printing credentials.

```sh
node .factory/generated-social-media/qa-storyboard-registry/run.mjs npm test -- --config .factory/generated-social-media/qa-storyboard-registry/vitest.config.mjs --maxWorkers=1
node .factory/generated-social-media/qa-storyboard-registry/run.mjs npm test -- src/server/services/social/media/registry.test.ts src/server/services/social/media/planner.recovery.test.ts src/server/services/social/media/planner.repair.test.ts src/server/services/social/media/planner.context.test.ts src/server/services/social/media/timeline.test.ts --maxWorkers=1
node .factory/generated-social-media/qa-storyboard-registry/run.mjs npm run typecheck
node .factory/generated-social-media/qa-storyboard-registry/run.mjs npm test -- --config .factory/generated-social-media/qa-storyboard-registry/vitest.config.mjs -t 'versioned registry recovery|source or reviewer injection|final source-general' --maxWorkers=1
node .factory/generated-social-media/qa-storyboard-registry/run.mjs npm test -- src/server/services/social/media/registry.test.ts --maxWorkers=1
git diff --check
```

- [Independent harness](qa-storyboard-registry/independent.test.mjs); `/tmp/radar-storyboard-registry-qa-independent-final.log`.
- Initial developer regressions/typecheck: `/tmp/radar-storyboard-registry-qa-{regressions,typecheck}.log`. Final targeted rerun logs: `/tmp/radar-storyboard-registry-qa-grounding-final.log`, `/tmp/radar-storyboard-registry-qa-rubric-regressions-final.log`, `/tmp/radar-storyboard-registry-qa-typecheck-final.log`.
- Visually inspected [same-scene rendered highlight](qa-storyboard-registry/same-scene-revisit.png), [normal Generate/Writing](qa-storyboard-registry/generate-writing.png), [Owner Retry/Revising desktop](qa-storyboard-registry/owner-retry-revising.png), [390px keyboard focus](qa-storyboard-registry/owner-retry-mobile.png).

Own3855server stopped. QA changed evidence/harness only, preserved other agents’ source and operational records, and did not merge/deploy or touch production.
