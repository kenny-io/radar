# Destination QA — preparation

Read-only destination access verified through the GitHub connector and authenticated Git. Destination is a private npm/Turbo monorepo; baseline main `dbfb0f0b66b1a607bd3f0b2587a84064464c52b3` is checked out in an isolated temporary clone `/tmp/radar-destination-qa.j9TSIt`. No existing destination checkout or runtime configuration was changed.

The refresh target is an existing editorial rental hub, not a missing blog post. `apps/web/app/rent/dubai/[slug]/page.tsx` uses `HUBS`/`getHub` from `hubs.ts`, generates static params, metadata/canonical and renders sections/FAQ/related links. The registry already contains slug `1-bedroom-apartments`. Final QA must confirm original route/slug, shared records, unrelated hub content and public discovery remain intact, and the complete supplied article is rendered rather than merely saved in an unused file.

Available validation:
- Destination commit/PR diff and status checks through connected GitHub tools.
- Exact-head source/build/tests in the isolated clone using Node22. Netlify configuration builds `npx turbo run build --filter=web`, with `--legacy-peer-deps` install policy and Node22. Web test entry is `node scripts/run-tests.mjs` (tsx + server-only fixture).
- Real browser checks against an actual destination preview when supplied by deployment checks; alternatively an exact-head local production server for route/body/canonical/navigation and refresh/mobile behavior, clearly distinguished from deployed preview evidence.

Preparation only: waiting for the Radar publishing retry outcome, destination PR URL and immutable head before dependency installation or final build. No customer retry, destination writes/merges, or production mutation by QA. Full-build data dependencies may need a safe local configuration; do not claim live Supabase-backed behavior without access.

## First authorized production retry

PM reports the normalized URL passed its former guard, but actual repository planning and correction returned an empty plan for the existing typed editorial hub. No destination branch/PR was created. This is a second, separate integration blocker; recovering URL syntax is not sufficient evidence of complete autonomous publication.

Independent source assessment found a feasible bounded extension: the content registry's `Hub` type can gain an optional full-body string, and its existing shared renderer can opt into rendering the complete host-owned HTML body for that record while preserving legacy output for records without it. The current `sections[].body` renderer escapes its string in a paragraph, so writing HTML into that field is incompatible. There is no existing general HTML/Markdown renderer to reuse. Parent rental navigation derives entries from `HUBS`; adding an unrelated blog registry entry would change identity/discovery unnecessarily.

Any actual generated proposal must preserve the route/slug, all unrelated registry data and existing navigation; render the complete article exactly once; and use the original escaped/safe host-owned body, not a model rewrite. QA has made no destination source edits. Architecture/implementation investigation is active; final exact-head build/browser remains pending a successful generated PR.

## Available baseline evidence

Node22 dependency install completed with the original lockfile unchanged (SHA256 `4ac0b1948c7dec5ad8c6c9a8b94cd70161b5e96530ac4aa96733dba77ee8339a`). Baseline commons TypeScript build passed; unmodified destination web test suite passed **166/166**. All eight baseline hub records were captured in the isolated temporary directory for unrelated-record comparison after a proposal exists. No production configuration or credentials were used.

## Exact live-model proposal verified

The follow-up configured-provider dryrun succeeded on pinned destination `dbfb0f0b66b1a607bd3f0b2587a84064464c52b3`, using frozen Radar planner SHA256 `9b04bb27a91cb8cd2528fbf3fbe8af25e425a87ec3787772d4b78e0fb64fb7de`. QA applied only its two exact accepted files to the disposable clone; no manual destination fixes. The generated diff adds optional `bodyHtml` to the Hub type and only the selected record, plus conditional rich rendering at the existing editorial-body slot. Original target fields and all seven peer records remain deeply identical.

Independent observed results:

- Exact full supplied HTML8048bytes is stored unchanged and rendered as markup **once**, replacing the old secondary editorial body. Header, quick answer, price data/widget/table, FAQ, metadata/structured data, CTAs and related navigation survive.
- Standalone rendering of the actual original and proposed page modules: **all seven peer page markups byte-identical**. The harness ignored stylesheet imports only for string comparison and supplied the standalone JSX runtime; the actual Next build/browser separately checked CSS/client rendering.
- Full destination web suite on exact proposed source: **166/166 passed** (same166baseline).
- Focused actual Next16 production command from `apps/web`: `next build --debug-build-paths 'app/rent/dubai/page.tsx,app/rent/dubai/\[slug\]/page.tsx'`: **exit0**, whole web TypeScript project validated and all eight hub routes plus their parent directory prerendered (11pages including framework/not-found). Local Supabase origin deliberately unreachable with dummy keys; these source-backed routes do not need production data.
- Actual Chrome against those exact production artifacts (`http://127.0.0.1:43130`): **five scenario groups passed** — desktop route/full DOM markup/canonical and preserved features; price sorting +fresh reload; keyboard navigation from original directory after its existing loading curtain unlocks; unchanged peer legacy view; mobile390px full-body layout and both original images decoded (1200px originals rendered358px). No horizontal overflow and **zero page errors**. Mobile screenshot visually inspected locally; no screenshot committed.
- Exact proposed source and lockfile fingerprints unchanged after build/tests/browser. See `destination-qa-fingerprint.json`, `destination-qa-render-result.json` and `destination-qa-browser-result.json`. Reproduction scripts accompany those results.

Build limits: the initial **full monorepo web build** compiled and typechecked, then failed on unrelated `/communities/downtown-dubai` because the deliberately unreachable database cannot load community properties. This is not counted as a passing full build. The selective build covers the changed directory and all peer hubs. The first selective build completed compilation/typecheck/prerendering, then exited1 with `SecurityFatalError` reporting that installed Next16.4.0 has a known vulnerability and recommending an upgrade; repeating the exact same command exited0 with the upgrade reminder. No check was bypassed, dependency upgraded or source edited to obtain that pass. The output supplied no specific CVE. This existing dependency warning remains unaddressed and outside this publishing patch.

The initial browser harness used `networkidle` and interacted before the destination's existing navigation curtain unlocked; those probes timed out. Explicit DOM readiness +curtain unlock resolved the harness timing, and the final full scenario run passed unchanged source. The unused data-fixture experiment was stopped and its artifact removed; final build/browser used no fixture data.

Recommendation: **accept the bounded generic Radar planner correction** based on source, actual-provider, exact-generated build/test/server/browser evidence. This is local exact-proposal evidence, not a deployed destination preview or live-site claim. After Radar rollout, independently inspect the actual production retry's PR/head and preview/status checks; no destination merge is authorized or performed by QA.
