# Independent QA — structured editorial refresh

Workspace: `/Users/ekene/.codex/worktrees/radar-refresh-publishing/radar-push`, branch `kenny/structured-refresh-publishing`, based on Radar merge `4f0100eec86dc404b13ffc2d8ff4793b319a7a18`. Frozen planner SHA256: `9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de`.

## Source and regression review

The implementation diff changes generic system/discovery/planning/correction/review instructions only. No proposal schema, deterministic guard, path restriction, budget, exact-edit application, body expansion, source-evidence validation, tenant boundary, Git write or draft-PR behavior changed. Existing new-article blog discovery requirements remain stated. The new shared contract requires original refresh content-family navigation, a paired optional field/consumer only where necessary, target-only opt-in and peer fallback, original identity/metadata/interactions, and rejection of storage-only/escaped/duplicated body integrations. Repository content remains untrusted; new raw markup must come from static host-owned HTML, never request text or executable generated code.

Independent Node22.23.3 checks after source freeze:
- `node node_modules/vitest/vitest.mjs run src/server/services/publishing src/server/actions/publishing.test.ts src/server/services/autopilot`: **419 passed**, 66 reported harness-dependent skips, 19 files passed/10 skipped, duration4.66s.
- `node node_modules/vitest/vitest.mjs run --config .factory/refresh-publishing/qa-vitest.config.ts`: **23 independent acceptance checks passed**, duration1.17s.
- `node node_modules/typescript/bin/tsc --noEmit`: passed after PM production build.
- Planner and structured-test fingerprints rechecked unchanged.
- `git diff --check`: passed.

The seven new developer structured-registry checks use an authored server-rendered fixture, preserving a peer's byte-identical markup and original metadata/widgets while rendering full host HTML once. Semantic negative checks depend on a mocked rejecting reviewer; they establish failure handling and prompt coverage, not actual model discrimination. RP8 requires the configured-provider/destination evidence below.

## Derived acceptance probes for actual generated destination

- RP-6: original `/rent/dubai/1-bedroom-apartments` route, source slug, canonical and parent rental directory remain; no duplicate blog registration/page.
- RP-7: complete original supplied HTML renders as markup exactly once; existing stale editorial-body slot is replaced rather than visibly duplicated. All seven peer records and their legacy rendered output remain unchanged. Target metadata/area explorer and table/FAQ/related links/CTAs and structured-data consumers survive. Optional new representation is paired with a compatible actual consumer and no new dependency.
- RP-8: actual provider dryrun must pass on the pinned source; apply only its exact accepted files to the disposable destination clone, then build/test/browser the resulting unchanged proposal. No manual destination fix may be used to turn a failed plan into a pass. Actual production retry, PR head and deployed preview are separate evidence after Radar rollout.

Current status: source/regression checks passed; actual provider dryrun and exact-generated destination build/test/server/browser verification passed. RP6–8 accepted for the bounded Radar correction; see destination-qa.md for exact fingerprints, five real browser scenario groups, 166destination tests, unchanged peer output, full-build data limitation and existing dependency advisory. Actual production retry/PR/preview remain separate post-rollout evidence.
