# Verification

Environment: isolated branch kenny/fix-refresh-publishing from production/main 75163f1ccf821fbe468c8a345aecb5b6de50fd2e. No production credentials copied into the checkout.

- Read-only production worker revision confirmed 75163f1c. Read-only database transaction confirmed screenshot entry e_MCOBF9hZ: refresh mode, `/rent/dubai/1-bedroom-apartments`, lived.ae, failed route validation, no saved remote draft. Publishing connection healthy.
- Baseline: 66 planner/publisher observability tests passed before implementation.
- Engineer focused verification: 105 tests passed, including legacy payload through the actual repository planner, strict route-change rejection, early invalid-input failure, and actual candidate/suggestion full-URL persistence.
- Independent QA on frozen source: 23 probes passed. Broader publishing/actions/autopilot run: 412 passed, 66 external/DB harness skips. See qa.md for commands and source fingerprints.
- PM production build on Node22.23.3: passed compilation, type validation, generation of 41 static pages and tracing. Command: `NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://postgres@127.0.0.1:1/radar_build APP_URL=http://localhost:3000 /Users/ekene/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/next/dist/bin/next build`. Database deliberately unreachable; no external publication.
- Independent Node 22.23.3 typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed after build; nine source/test fingerprints unchanged.
- Architect final frozen-source review approved normalization, identity preservation and strict unchanged planner guard.
- `git diff --check` passed. Build did not change tracked configuration.

No UI source changed. No actual production publication, model call, GitHub destination write/merge, or browser verification of a recovered customer publication was performed. Existing connector behavior creates a draft PR pending destination checks; this repair does not add live-site auto-merge. Runtime retry and destination CI/preview verification remain release follow-ups.

Tested production-source SHA256:
- refreshUrl.ts:889a73856ca7c57c12e43bf8fc9aecdf9b428d287549f772313b49eac2b2e32d
- publisher.ts:b4a2daff5283a86777ab6a34f2d51fa5c782e942dc659e8839e00d9506fffb95
- calendar/research.ts:9bcee88ad653d134537481d9d6681b5ebf83493c75b1d5ab39299e334669084c
- gsc/refresh.ts:05dc7a16df4c33c94a7ad1ab1cba73c5fc4954848ff358b1ed96bca7d55d8b61

Delivery: implementation committed and pushed as fcf70798d62df1b1a354f61fa1b781b9823cc8af; PR https://github.com/kenny-io/radar/pull/48 open, ready for review and mergeable against production base 75163f1c. GitHub readback reports no commit statuses or PR-triggered workflow runs; local verification is the available test evidence. This final record update changes documentation only. Merge/deployment and customer retry await owner approval.

## Authorized release

PR48 merged as 4f0100eec86dc404b13ffc2d8ff4793b319a7a18 after explicit owner approval. Pre-merge GitHub readback: mergeable, exact approved head 86ef8d09, no statuses/workflow runs. Merged implementation files match tested source. Worker runtime source hashes match; web release pending. Pre-retry read-only production snapshot: article e_MCOBF9hZ failed, no remote draft/URL, original body SHA256 2d34c5f4035b20306549d021b655ca4c4fd81be0d850b2bb11c0b1938c96319e and full article JSON SHA256 31a81749eb4c26a1b04565a262f48134b100f761bdce7973aaec4fd361327c27. Existing hero image present.

Both deployments SUCCESS at merge 4f0100ee: web 8aad7905-1141-4041-b3b9-a3c3ffc336fc, worker 52e35a2d-8a51-4bb9-91c5-a209ffdd56ee. Actual running containers both Node22.23.4 with all four tested production hashes unchanged. Public `/api/health` returned `{"ok":true}`. Production source normalization and rollout confirmed.

Authorized article retry admitted through actual `publish.retry` action as job f811fa3c-bdf7-457d-a85b-885265f5ca5d. Script verified deployment revision, exact article/domain/route, unchanged full article hash, actual active Owner membership and billing/business gate; then used existing action input validation, article lock and singleton queue guards. No direct status-reset SQL, draft deletion or connector bypass. Result pending.

## Structured editorial refresh follow-up

The first authorized retry completed source discovery, plan and correction but returned `plan-empty`: current prompts treated the existing structured editorial hub as a blog post. No destination branch/PR or saved draft was created. This is a distinct failure exposed after URL normalization. Saved body and full article hashes match the pre-retry snapshot.

Architecture approved a generic prompt-only contract permitting minimal optional content/renderer pairs for existing editorial refreshes while retaining current route/public discovery, peer records, structured features and legacy fallback. No guard/schema/token/budget/transport changes. Engineer Node22 publishing/actions: 399 passed, 51 skipped; independent broader: 419 passed, 66 skipped, independent 23 probes, Node22 typecheck and diffcheck passed. PM Node22 production build passed on frozen planner 9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de. See architecture-followup.md and qa-followup.md.

Read-only actual-provider preflight passed on exact saved payload and destination snapshot dbfb0f0b66b1a607bd3f0b2587a84064464c52b3. Existing configured Anthropic fallback completed 3 discovery calls, plan and fresh review in 104.337s, no correction. Proposed only existing hub registry and renderer changes, preserved original route; no destination write. Exact full Markdown: 7293 bytes SHA256 fdfd732d3f497f791e01c3bdffa7ab9f6d62603ad30f0864fd1d14bbefc497aa. Actual production `buildPayload` returns matching absolute canonical and refreshUrl. Raw payload/trace/generated source kept 0600 in ignored .data/refresh-publishing; no provider credentials persisted. The preflight process uses unreachable loopback DB, alerts off and AI-host-only network; it cannot publish to GitHub. Result metadata in live-plan-result.json. Independent build/browser of exact proposed files pending.

## Integrated reporting and final pre-release verification

User requested generic failure UX and an explicit team report to kenny@thally.io with subject “User Reported Issue on Radar”. Implemented the approved fixed-recipient action, private server diagnostics, coherent failure snapshot, immutable idempotent outbox and user-visible sending/sent/failure states. Customer workspace/job/SSE publication data now contains only safe public summaries; raw diagnostic persists in DB.

Independent final QA:444affected tests passed,66external-harness skips;10/10real Chrome desktop/mobile/UI/API groups;4/4real PostgreSQL cases with mock email transport (eight concurrent teammates -> one accepted send/row, identical timeout retry payload/key, empty receipt rejection then success, stub isolation); Node22typecheck and whitespace checks passed. No real external email in QA. See qa-report.md and qa-report-fingerprint.json. Architecture reviewed final hashes and found no material issues.

Final integrated Radar production build passed on Node22.23.3, with unreachable local DB and no production credentials: compilation, type validation,41static pages and tracing. Log is ignored .data/refresh-publishing/report-final-build.log. All13QA implementation/test fingerprints match after the build; original normalization source hashes and planner9b04bb27 remain unchanged. No tracked config drift from QA remains. Destination exact generated proposal acceptance is in destination-qa.md, including explicit unrelated full-build data limitation and observed dependency advisory.
