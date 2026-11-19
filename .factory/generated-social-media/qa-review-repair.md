# Q7R independent acceptance: bounded review repair

**Recommendation: accept the bounded patch for delivery.** No product regression found in the observed checks. Actual live model repair quality/latency and the owner’s remaining allowance remain PM-owned live acceptance, not claimed by this local pass.

## Tested candidate and environment

- Workspace `/Users/ekene/.codex/worktrees/radar-generated-media/radar-push`, branch `kenny/media-review-repair`, HEAD/base `04270aba81ad8dd9bc6ebf7e98dc364762efcace` plus frozen repair/UI changes.
- Node 22.18.0, dedicated synthetic PostgreSQL DB `radar_media_review_repair_qa` on localhost:54329; local Next snapshot `/tmp/radar-review-repair-qa-fbi9887i`, app `http://localhost:3853`.
- Ordinary verified synthetic Publishing QA user/session; own business fixtures, including an Editor membership for the actual Generate journey. No production customer data, production browser, real grants/posts, paid model/TTS calls, or external storage mutation.
- Two-runtime-file hash: `d15883f870cb151f1b69d3370f207969d7096e6169dfe83490e1173b16bbdacb`.
- Three-file patch hash including the developer repair suite: `933b32f61db7212abc29bd9d11fca9348fb1f3224bd500750d4eff3dbc8a18ef`. Algorithm: sorted path + NUL + bytes + NUL. Individual hashes and snapshot match evidence: [fingerprint.json](qa-review-repair/fingerprint.json). Final readback matched all hashes.
- PM independently reported isolated Node22 production build PASS: 870 explicitly selected files hash `eac5ca23296f2dec87301eebf776fe74a27a1c05b547db6cd4a38f77d0a59292`, BUILD_ID `aZjASNMDU4NTEJiVFqxb_`, `/tmp/radar-media-repair-build.{json,log}`. This broader hash has a different scope from the QA runtime hash.

## Acceptance coverage

| Result | Observed coverage |
| --- | --- |
| Passed | **17/17 independent tests**: initial success remains 3 logical calls; mechanism repair uses 5 and clarity repair 6; both reviews restart; persistent failure gets only one correction; no narration row/voice request on either persistent review failure. |
| Passed | Repair preserves supplied evidence, fixed system, business, same admission callback and original deadline. Real SQL reservation refusal, guard cancellation, unpriced route, and expired deadline prevent the next provider dispatch. AI refusal does not initiate correction. Reviewer/source/presentation injection stays untrusted data; new reviewer-supplied URLs and invalid revised semantic identity are refused before further review. |
| Passed | Actual browser **Generate video → saved intent → real worker/SQL budget path → controlled AI repair barrier → persisted Revising explanation**. The active browser and refreshed page show Revising; after successful repeated reviews, video remains Queued until rendering, never falsely ready. AI responses alone were controlled at the provider boundary; no action result was fabricated. |
| Passed | **9/9 browser scenarios**: all five known stages persist through refresh; polling updates stage; legacy/unknown/missing fallbacks; 390px layout has no horizontal overflow; cancellation control receives keyboard focus; polite live status; prepared/failed labels accurate; zero page exceptions. Desktop/mobile screenshots visually inspected. |
| Passed | **29/29 affected developer regression tests**, separately executed: repair15, context1, source material7, timeline6. **2/2 selected actual paid-admission hook tests** pass; 107 unrelated tier tests intentionally skipped. These supplement rather than replace independent cases. |
| Passed | `npm run typecheck`, `git diff --check`, frozen source readback. Root `tsconfig.json` and `next-env.d.ts` unchanged. Own local server stopped; no listener on3853. |
| Failed | None after final run. One initial harness assertion expected older system wording; it was corrected to the stronger current fixed instruction, then the full independent17-case run passed. No implementation change was needed. |
| Blocked | No required local patch checks blocked. |
| Not rerun / outside patch | Real provider quality/latency, fresh Brian0.78/R2 render, owner remaining budget, live deployment; PM owns these. Full prior generated-media/tenant/authorization/publishing acceptance was not repeated because this patch adds no route, grant, preference or publishing behavior. No claim of fresh end-to-end render or comprehensive correctness. |

## Commands and evidence

All commands ran from the tested workspace with Node22 bin first on PATH. The runner loads only ignored local synthetic settings; it does not print credentials.

```sh
node .factory/generated-social-media/qa-review-repair/run.mjs npm test -- --config .factory/generated-social-media/qa-review-repair/vitest.config.mjs --maxWorkers=1
node .factory/generated-social-media/qa-review-repair/browser.mjs
node .factory/generated-social-media/qa-review-repair/run.mjs npm test -- src/server/services/social/media/planner.repair.test.ts src/server/services/social/media/planner.context.test.ts src/server/services/social/media/sourceMaterial.test.ts src/server/services/social/media/timeline.test.ts --maxWorkers=1
node .factory/generated-social-media/qa-review-repair/run.mjs npm test -- src/server/ai/tiers.run.test.ts -t 'paid-stage admission hook' --maxWorkers=1
node .factory/generated-social-media/qa-review-repair/run.mjs npm run typecheck
git diff --check
```

- Independent harness: [independent.test.mjs](qa-review-repair/independent.test.mjs), log `/tmp/radar-review-repair-qa-independent-final.log`.
- Browser scenario data: [browser-results.json](qa-review-repair/browser-results.json), log `/tmp/radar-review-repair-qa-browser.log`.
- Actual user-to-worker repair screenshot: [actual-pipeline-revising.png](qa-review-repair/actual-pipeline-revising.png).
- Stage/keyboard responsive evidence: [revising-desktop.png](qa-review-repair/revising-desktop.png), [revising-mobile.png](qa-review-repair/revising-mobile.png).
- Narrow regression/admission/typecheck logs: `/tmp/radar-review-repair-qa-{regressions,admission,typecheck}.log`.

No feature source edits, merge, deployment or production mutation by QA. Existing Q7 acceptance record is preserved.
