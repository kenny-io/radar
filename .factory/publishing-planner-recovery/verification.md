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

Follow-up Radar PR https://github.com/kenny-io/radar/pull/41 merged November10 at01:38:46 Dubai as518eb6db89576e8513381165932a9edf1146fc63 after current-head checks (no configured GitHub Actions checks/branch protection). Waiting for web/worker deployment parity before analytics retry. Original saved article bodies/research source lists were hashed before correction; only public rendering changes.

Final runtime follow-up: concurrent authorized Radar PR40 email-format release merged immediately afterPR41, so current main/deployment is108d6e1ae70f82f3fdfd854ca79fcc4579b2a172, containing both publishing fixes. Diff from518eb6db adds only observability email delivery/template and evidence; publishing source unchanged. Web0da3581e-6ec4-46a9-98f9-84d839314bb8 and worker6e5bdfed-f01a-453a-ab1c-bee3bd65450c both SUCCESS on108d6e1a. Both running renderer hashes match frozen47b378f6b5813befd60951c8c7b83d3b399bab8962729375ea7fc0c0c4d95a3c; health{ok:true}. Normal publish.retry for analytics admitted job4a38176f-e92e-4b23-966d-b580ff34bb1e only after prior job completed and both services verified.

## Final real publishing readback

Analytics retry succeeded through normal worker flow: draft https://github.com/thallylabs/thally-website/pull/138 head75c11fb7049408abe4d4648a087865dedc9dbb6f, six complete integration files and base main. Final canonical public Markdown10,097bytes SHA2567ecbeeb487ab9bb2de0eb676926636c33b3553b53139d33307eab6fee4664306 is present byte-for-byte. Stored bodySHA9cf750712ea220565a9b131cab9b3c3ccc3f424f1ea10fa131a05efe809483fc and sourcesSHA5515a32d8311b6bd146ca9e4a7a468cca74a9805a07326ce091bdc3035aef952 remain unchanged: all9 research references remain saved;8 valid citations appear publicly. The88-byte canonical payload difference from prior10,185bytes is solely the omitted invalid public reference, not article prose editing.

Final production readback on108d6e1a: both e_2UQxRIMM and e_2Qcpo76u status published, publish_error null, publish_remote null, no active article publish jobs; each successful retry completed on its first job attempt. Rechecking migration against current renderer confirms exact original10,988byteMarkdown and all9valid public citations unchanged. GitHub connection OK. Both destination PRs remain draft and currently mergeable. No destination PR was merged or marked ready. Detailed safe receipts: production-final-readback.json,article-137-final-verification.json,article-138-verification.json.

## Final acceptance

Independent QA ACCEPT for PR138 exact head75c11fb7049408abe4d4648a087865dedc9dbb6f: original-source Node22/Corepack pnpm build passed54pages, destination tests13/13 and SEO/AEO54pages/13publicfiles passed. Generated article route exactly once, full content and discovery surfaces present. Netlify SUCCESS for observed deploy6af23ee66b2e8af890eb7c06 at https://deploy-preview-138--thally-web.netlify.app. Real Chrome5/5groups passed pointer/keyboard listing navigation, full body/canonical/byline, reload/fresh, mobile390/no overflow, no runtime/first-party failures; two inline images loaded with alt; eight valid public citations. No destination source was manually patched to obtain a pass. QA restored only its two self-generated artifacts after preserving evidence; isolated destination clone clean at exact138head. PR137 acceptance unchanged. No blocked required checks remain.

Delivered: Radar PR39 andPR41 merged/deployed; publishing fixes and actual two-article recovery complete. Both destination article PRs remain draft/unmerged; making the articles live on the destination main site requires owner review/merge. No destination production release was performed or claimed. Original dirty primary checkout and unrelated work preserved.

## Authorized destination publication

User explicitly authorized merging both articles and production verification. PR137 readback confirmed original reviewed head a8b3304, all Netlify checks successful; marked ready and merged as8e5b36274920ea3d6602b3c15c91b11c66df555b atNovember10 01:51:00Dubai. PR138 remained clean/mergeable after first merge; original reviewed head75c11fb unchanged; marked ready and merged as c9a3b859cd208ff380d4737659ec536fb967c9a8 at01:51:43Dubai. No manual conflict resolution or source change was needed. Both exact merged registry entries and relative manual llms links are present once each on finalmainc9a3b859; immutable article bytes match reviewed PRs. Production deployment/browser verification in progress.


## Production publication accepted

Netlify authenticated readback confirms site19720951-1c2d-4155-81b1-ab20324c82fb (thally-web), production deploy6af2407136be45d7f1b18623, state ready, commitc9a3b859cd208ff380d4737659ec536fb967c9a8, canonicalURLhttps://thally.io, published November10 01:52:45Dubai. Receipt: production-articles-qa/netlify-production-receipt.json. Both canonical article URLs returnHTTP200.

Independent QA-4 ACCEPT: all13 real production browser groups passed, zero failures/blocked checks. Exact combined merged source retains both original article files and one registry/manual llms entry each. Rendered full article prose matches accepted immutable-head renderings; both articles have two loaded images with alt, valid public sources, correct canonical/OG/JSON-LD/team byline. Blog pointer/keyboard navigation, existing-tab reloads, fresh anonymous loads and390pxmobile pass. Sitemap/RSS/llms/full corpus all include both routes. Zero runtime/first-party asset failures; mobile screenshots visually inspected. Evidence: production-articles-qa.md and production-articles-qa/. No preview-only substitution, manual content edits or merge conflict resolution occurred. No required work remains for the authorized merge/live-verification request.
