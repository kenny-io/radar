# Verification

Production diagnosis from earlier chat: November 6 e_2UQxRIMM and November 9 e_2Qcpo76u discovery attempted src/generated/website-pages.json >100KB. November 9 retry e_2Qcpo76u completed four discovers, plan, review, repair, then generic empty/over-budget validation failure. Stored rows confirm both failed with no remote draft/URL. Connection status OK; successful PRs on November 7/8. No model response bodies persisted historically, so exact empty-vs-budget and reviewer issues cannot be recovered from old ai_calls.

Current production baseline: web a1d27185-bca3-4879-a37b-f7960c9a9d86 and worker e14bd6ce-2434-4990-a9a5-1af7dc17db42 SUCCESS on 8b0fc346 (November 10 readback). Tests/release/live retries pending.

## Integrated local verification

- Engineer final publishing suite:328passed/51skipped; typecheck and diffcheck passed. Frozen tracked implementation fingerprint c991e25bbfe4e9a804c849f60aacf03458d5eed50674c6fb327d33274b4cd181.
- Independent broad suite396passed/85skipped, independent17 safety/persistence probes,10 browser scenarios passed. Synthetic local fixtures only; no production retries by QA. See qa.md and qa/ evidence.
- Architect approved frozen diff: exact-source/SHA/evidence/atomicity preserved, no material design/safety defect.
- PM `npm run build`: passed, compiled all36 static pages and application routes. Local Node24.1.0; final Node22 checks and actual Railway Node22 build recorded separately.
- Original production article Markdown hashes (pure renderer, before retry): e_2UQxRIMM10988bytes SHA25689f145d9a33ef0fa757596b47c22f038a67061977a8d71d76bdb2929a20fbd34; e_2Qcpo76u10185bytes SHA256bc9e0e807173d028cfd929bf6c86e6b7757ac81765523051b1157039aa1de5cc.

## Release

Pending final Node22 QA readback, reviewed PR/merge, Railway web/worker parity and sequential production action retries. No destination article PR merge is authorized by this repair task.

Final frozen source on Node22.18.0: independent17/17, focused planner/transport/connector150/150 and typecheck all passed. QA per-path source fingerprint is qa/fingerprint.json; its13-file aggregate62806d32772f83de37842b53ac916ecf24be5b2c5bcd84a664a641b0232eab0d uses a different aggregation format than the engineer fingerprint above. Individual file hashes agree; no implementation changes after freeze.

Final Node 22 broad suite: 397 passed, 85 skipped (23 files passed, 12 skipped). QA ACCEPT and architect APPROVE; no product defects observed.

## Deployed release

Radar PR https://github.com/kenny-io/radar/pull/39 merged November 10, 2026 at01:25:32 Dubai as4908694fb6c63ce618e83843d30203af739fe9dd. Railway web a15f7cc1-fa79-4c36-a0ec-df98fc75c834 and worker9ec31ae7-4158-4cef-a7cd-9fff108cc3c1 both SUCCESS. Running-container readbacks confirm revision4908694f on Node22.23.4 and exact tested planner/connector/http SHA256 values; no source differences between tested PR head046cc4b5 and merged source. Production /api/health returns {ok:true}; Railway Node22 web build and healthcheck passed.

First retry admitted through existing publish.retry action under actual business Owner context: e_2UQxRIMM job07ed12c2-954e-442c-8058-d6652e69aebb. Normal action transaction/lock/singleton guards used, article content and destination unchanged. No direct status-reset SQL or connector bypass used. Outcome pending.

## Real article recovery

- e_2UQxRIMM completed normal worker publication successfully: https://github.com/thallylabs/thally-website/pull/137, draft head a8b33044653590327f0962c1ddeda89332efd05d, base main. Six complete integration files: article content/body/page/OG plus manual blog registry and llms overview. Production readback: status published, publish_error null, healthy GitHub connection. Original10,988-byte Markdown hash unchanged and full Markdown byte sequence present in content.mdx. Netlify preview observed at https://deploy-preview-137--thally-web.netlify.app; independent destination build/browser checks underway.
- e_2Qcpo76u admitted through normal publish.retry action as job d39c7450-a718-4efc-a47a-64c42330ae51 after first result verified; outcome pending. No overlapping retries for either entry.

Independent destination QA ACCEPT for PR137 exact head a8b33044653590327f0962c1ddeda89332efd05d: unmodified Node22/Corepack pnpm build passed54 pages, selected destination tests13/13 and SEO/AEO54pages/13publicfiles conformance passed. Build regenerated derived catalog/full corpus; article route exactly once and complete source text present in output/blog/sitemap/RSS/llms paths. Actual Netlify preview passed5 browser groups including pointer/keyboard navigation, full body/canonical/byline, refresh/fresh load, mobile390 layout, no first-party/runtime errors. No destination merge performed.

Analytics initial post-fix retry failed safely with concrete provenance: original independent reviewer identified internal placeholder source URL'#' and prohibited emdash in that source title. Repair declined to alter host-owned article body and returned no changes; new diagnostic preserved both exact causes and local Radar attribution. No remote draft/branch was created. This proves original plan-empty failure had a real hidden source-content cause, rather than GitHub authorization. A narrow public-citation renderer follow-up is now in progress under ARCH-2/ENG-2/QA-3; article stored body/sources will remain unchanged.

ARCH-2/ENG-2/QA-3 follow-up verified: only render.ts eligibility filter changes production behavior; non-scheme internal references, relative/hash/javascript/malformed/userinfo URLs omitted consistently from public HTML, Markdown and payload.sources. Saved bodies/research sources and valid public citation text/order preserved. Node22 renderer25/25, engineer publishing345passed/51skipped; independent final37/37 and publishing/actions/drafting357passed/51skipped, typecheck and diffcheck passed. PM Node22.18.0 `npm run build` passed on final frozen renderer47b378f6b5813befd60951c8c7b83d3b399bab8962729375ea7fc0c0c4d95a3c. Build output retained privately at .data/publishing-planner-recovery/sources-build.log.
