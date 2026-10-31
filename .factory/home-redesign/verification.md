# Verification

Baseline checks started before homepage edits: `npm run typecheck`, then `npm test`. Typecheck passed. Baseline full suite: 602 passed, 177 skipped, 1 failed (`src/server/ai/openrouter.qa.test.ts`, pre-existing branded-image golden hash mismatch; expected f883614e6a7dfb07, actual 91d5409f50974af7). No homepage code had changed. Public preview is `http://localhost:3900`, using `NEXT_DIST_DIR=.next-home-redesign npm run dev:web -- --port 3900`.

All unrelated dirty billing files belong to existing work and are excluded from this feature.

## Independent QA — final frozen working tree

Environment: `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/stripe-billing`, HEAD `5db796b5cd97c93a533cad088078a4a5b27c5e3c` plus the four homepage working-tree files fingerprinted below. Anonymous browser contexts, no test account or customer data. Local Next development preview `http://localhost:3900`; Playwright driving real headless Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Shared billing work was not modified.

| Acceptance | Result | Evidence |
|---|---|---|
| H1 order/copy/design structure | Pass | Expected section order, six feature slides, ten connectors, five comparison rows, eight inclusions; retired sections absent; GitHub/$1-credit/testimonial exceptions retained |
| H2 navigation | Pass | Desktop nav labels/links; hide section links below 900px; actual Sign in and Get started clicks rendered `/signin` and `/signup` forms |
| H3 responsive design | Pass | Widths 360,375,390,640,760,761,899,900,1000,1001,1280,1440,1920 have zero horizontal overflow. Mobile left alignment, stacked problem, demo/pricing layout, FAQ sticky breakpoints checked. All three cards fit inside demo stage at 360px |
| H4 statement | Pass | Opacity samples before, halfway, completed and reversed; full accessible sentence and aria-hidden word spans |
| H5 player | Pass | Real-time 9/7/6-second autoplay advances 0→1→2→0. Progress and demo typing freeze offscreen and below 35% (34% tested), resume at 36%. Manual selection remains stopped after duration; arrows/Home/End/focus entry/Tab permanently stop autoplay. Roving tab focus and active-only accessible panel checked |
| H6 scroll story | Pass | At 1440×900 every slide appears, index/progress/pan/inertness match, native wheel moves page, index seek works. Width1000 and height639 stack; exact1001×640 pins with positive frame height. All slides readable in stacked mode |
| H7 reduced motion | Pass | Live preference switch fully lights statement, finishes all demo types, disables autoplay/pan and transitions |
| H8 regression | Pass within stated scope | Form error/focus/mirroring/reset; cleaned `/start?domain=example.com` navigation intercepted at browser request boundary, without initiating real website analysis. FAQ opens. No missing images, external asset requests, console errors or page/hydration errors. Six feature-page geometries/fonts unchanged at1440/375, home→feature client-navigation styles unchanged |

Commands:
- `node .factory/home-redesign/qa/baseline.mjs` — pre-change feature screenshots/layouts.
- `node .factory/home-redesign/qa/acceptance.mjs` — final 11/11 scenario groups passed; full results and exact fingerprints in `qa/acceptance-results.json`, log `qa/acceptance-final.log`.
- `node .factory/home-redesign/qa/edges.mjs` — 3/3 edge scenario groups passed (`qa/edges-results.json`).
- `node .factory/home-redesign/qa/regression.mjs` and `node .factory/home-redesign/qa/image-diff.mjs` — six layout baselines exact, five screenshots byte-identical; organic-search375 differed in265 raster pixels out of3,273,750 (<0.009%) with exact geometry/fonts. Tiny raster variation did not indicate layout/style regression. Results in `qa/regression-results.json` and `qa/image-diff-results.json`.
- Independent `npm run typecheck` passed before and after implementation. One intermediate retry encountered TS6053 while unrelated billing QA regenerated `.next-stripe-qa/types`; the next ordinary run passed without changes.
- `npx vitest run src/features/marketing/domain.test.ts` — 21/21 passed independently.

Visual evidence captured: six `qa/desktop-feature-{0..5}.png`, `qa/home-{section}-{1440,375}.png`, full-page screenshots, `qa/mobile-demo-{0..2}-360.png`, and `qa/boundary1001x640.png`. Desktop problem, first feature and pricing plus mobile integrations/comparison/onboarding demo images inspected directly; no material visual defect found.

Limitations: no signed-in account, live analysis, billing purchase, publishing, merge or deployment exercised; those flows were unchanged by this feature. Full-suite baseline exception remains the pre-existing image golden mismatch noted above. PM owns production build verification. No failed or blocked homepage acceptance checks remain. Recommendation: ready for PM integration/review and authorized delivery, with existing baseline exception disclosed.

### Exact SHA-256 of QA-tested homepage files

- `src/features/marketing/Home.tsx`: `bcb0a65ba28af11f3cb41bc9d09f65bb7b97e3aeaa38009e77a979fef4cc2212`
- `src/features/marketing/HomeStory.tsx`: `9010c8a368a3a53cac41c0b23be7d1c6e3eb4dba02b2a1b7ed4f7e959e643cb8`
- `src/features/marketing/home-redesign.css`: `ab5498593147b78e3f3c5a654232dcdf9f754724769aff8440194042b70f8961`
- `src/features/marketing/MkRoot.tsx`: `c52f92ff2de867c943cea0feb598943855ba3c1a7edab317d8d2cde5e624e508`

## PM integration and production verification

- Final `NEXT_DIST_DIR=.next-home-build npm run build` passed, including production compilation, type validation, page generation and route tracing. Log: `qa/production-build.log`. Build ran after implementation freeze.
- `node .factory/home-redesign/qa/production-smoke.mjs` passed against `NEXT_DIST_DIR=.next-home-build npm start -- --port 3901`: desktop/mobile stylesheet behavior, no overflow, reduced motion, active pinned feature and client navigation to its feature page; no browser errors. Evidence: `qa/production-smoke-results.json`, `qa/production-story-1440.png`.
- PM inspected desktop/mobile demo, desktop feature/pricing and mobile problem screenshots. No material visual defect found.
- `git diff --check -- src/features/marketing` passed. Final four-file SHA-256 matches independent QA and `implementation-fingerprint.json`.
- Removed only the auto-generated `.next-home-redesign` and `.next-home-build` TypeScript include entries added by this preview/build. Preserved unrelated concurrent billing edits.

Delivery: implemented and verified in the existing working tree. Public development preview is http://localhost:3900; production preview is http://localhost:3901. No commit, PR, merge or deployment performed. Existing unrelated full-suite golden-image exception is documented above.

## Follow-up: website URL autofill background

User supplied a screenshot of the browser-autofilled URL field with a pale blue background. Added scoped autofill background clipping and explicit text/caret colors to marketing.css; light feature-page website fields retain dark ink. Browser URL suggestions remain enabled.

Chrome DevTools Protocol CSS.forcePseudoState reproduced the original `:autofill` state (`rgb(232,240,254)` background and black text). After the change, both homepage inputs and the light organic-search input match `:autofill`, clip their background to text, and retain their intended ink/caret colors. Inspected `/tmp/radar-autofill-after.png`; the rectangular background is absent. `git diff --check -- src/features/marketing/marketing.css` passed.

Follow-up production build passed. Restarted the same production preview at http://localhost:3901 with the updated stylesheet. Removed preview/build-generated TypeScript include entries only.

## Follow-up: auth logo home navigation

Converted the shared AuthShell Radar logo from a div to a native link to `/`, with an accessible `Radar home` label and unchanged appearance. Real Chrome checks on `/signin` and `/signup` verified both clicking the logo and Tab/Enter return to the homepage. Typecheck and diff check passed. Local preview :3901 now uses Next development mode with separate `.next-home-preview` output so subsequent UI edits are reflected immediately; no deployment. A redundant production rebuild for this anchor change was canceled before completion.

## Q2 — final main-based PR verification after copy swap

Confirmed workspace unchanged, branch `kenny/homepage-redesign`, base HEAD `2524537da22eae7644829c05069b3b3320995c83` from `origin/main`; unrelated billing implementation is excluded. Anonymous real Chrome/Playwright checks ran against `http://localhost:3901` after PM froze all seven source files, including the user-requested hero/closing copy swap.

Final result: **11/11 main acceptance groups, 3/3 edge groups and 10/10 targeted followups passed**, with no browser/page errors or external requests. The main run covers the full 9/7/6-second autoplay loop, offscreen/threshold pause, manual/keyboard stop, six-slide native scroll story, reverse statement, reduced motion, forms, FAQ and width360–1920 layout. Authoritative frozen-tree outputs: `qa/q2-acceptance-results.json`, `qa/q2-acceptance.log` and `qa/q2-edges-results.json`. The earlier pre-freeze run was interrupted on copy steering; its closed-browser messages are excluded from the final report.

`QA_BASE=http://localhost:3901 node .factory/home-redesign/qa/q2-followups.mjs` independently passed five CDP `CSS.forcePseudoState` autofill cases (hero, closing and all three feature-page light forms): autofill matched, background clipping is `text`, dark text fill/caret are `rgb(243,244,246)`, light fill/caret are `rgb(27,30,37)`. Forced-autofill screenshots visually confirm the pale UA rectangle is clipped. Signin/signup Radar logos navigate home with mouse and actual Tab/Enter keyboard use. Hero is now “You built it. Let people and AI find it.” with orange dot/line break; home closing is “Be found by the people looking for you.” All three feature-page closing headings retain their original copy. Results: `qa/q2-followups-results.json`.

`QA_BASE=http://localhost:3901 node .factory/home-redesign/qa/q2-copy-visual.mjs` captured hero/closing at1440 and360px and checked zero overflow, headings and orange-dot color; mobile hero/closing plus dark/light forced-autofill crops were directly inspected. Independent source-only `npx tsc -p .factory/home-redesign/qa/tsconfig.qa.json --noEmit` passed; marketing domain tests passed21/21. PNGs are local evidence regenerated by the scripts and are intentionally omitted from the PR. No source/config changes made by QA; no unresolved Q2 defect. Recommendation: ready for authorized commit/PR; no merge/deployment performed by QA.

Final source SHA-256 values (also matched exactly by the frozen-tree main acceptance output):

- `src/features/marketing/parts.tsx`: `8d3866e21048aabf5a26b132b691156497c24470668cca5b8b14b408a513801e`
- `src/features/marketing/Home.tsx`: `e9facfd78febafb293bafd2d2ab05ca0163bef929bce5e5b97c0c2c816c9ebc7`
- `src/features/marketing/HomeStory.tsx`: `9010c8a368a3a53cac41c0b23be7d1c6e3eb4dba02b2a1b7ed4f7e959e643cb8`
- `src/features/marketing/home-redesign.css`: `ab5498593147b78e3f3c5a654232dcdf9f754724769aff8440194042b70f8961`
- `src/features/marketing/MkRoot.tsx`: `c52f92ff2de867c943cea0feb598943855ba3c1a7edab317d8d2cde5e624e508`
- `src/features/marketing/marketing.css`: `ac94bb4adec015f8f16336ceba942fe7e2d82d00e1d69a04a85ef255664075a1`
- `src/features/onboarding/Signup.tsx`: `112a8d7178bd8192181463e0a9352a7c047db6def2837e69cbbc18f934bcb5ab`
