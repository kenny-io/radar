# Independent QA: scheduled Autopilot introduction

Accept the observed #30 scope for the existing PR update. No unresolved regression was found. This is local acceptance evidence, not a deployment or inbox-delivery claim.

## Exact tested source and environment

- Workspace: `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`; branch `kenny/weekly-education`; base HEAD `22267d421851bde1504282a9b0375d2e1713ecbf` plus the frozen #30 changes. HEAD alone does not identify the uncommitted tested source.
- Restored-config source fingerprint: `e3f95c8bf39df1d1cd185a05bbadeca741bb1333d5fadc3506e90150ee8d291e`, 639 files. Independently matches PM. See `source-fingerprint.json`, `source-files.json` and `fingerprint.py` for raw-file, lexical-path scope and reproducibility. QA, docs, build caches and the separate original-checkout companion are excluded.
- Optimized artifact: `.next-autopilot-intro`, BUILD_ID `tf8NPjH3mJSdrM-Of5Leo`. Browser origin `http://localhost:3951`; actual production-mode Next server, local Postgres 15 on port 54329, Node 22.18.0 and installed Google Chrome driven through Playwright.
- Fresh application DB: `radar_autopilot_intro_qa_20261110`, all 17 migrations. Synthetic ordinary verified owner, Viewer, foreign-owner and pretrial/canceled/setup accounts only. No production identities. Browser setup uses a local-only password; no credentials are required in the report.
- No worker, real email provider, payment, generation, activation or operator-alert send. Provider tests use mocked GET/POST. Production browser server had an empty Resend key; external browser requests were denied. The server is stopped, and application QA DB users, businesses, general outbox, guide states and jobs are all empty after cleanup.

Read the brief and final architecture directly, then inspected source selection, guide state/dispatch/preference/readiness code, Autopilot normalization and owner controls, connector behavior, email copy and developer tests. Existing accepted evidence is reused only where the exact source/artifact remains unchanged.

## Coverage

| Independent check | Result | Evidence |
| --- | --- | --- |
| Observation, ownership, finite enrollment and delivery policy | 16/16 passed | `policy.test.ts`, `delivery.test.ts`, `independent-tests.log` |
| Existing affected developer regressions rerun independently | 105/105 passed, 6 files | `developer-tests.log` |
| Real optimized browser scenarios | 18/18 passed | `browser.ts`, `browser-results.json`, mobile PNGs |
| New #30 actual email render variants | 8/8 passed: four variants at 390 and 600 px | `render.ts`, `renders/results.json`, screenshots |
| Reading catalogue and gallery controls | 12/12 passed | `catalogue-browser.ts`, `catalogue-browser.json` |
| Clean migration, prior-0015 upgrade and repeat no-op | Both paths passed; 17 journals | `migrations.mjs`, `migration-proof.json`, `migrations.log` |
| Actual read-only worker readiness subprocesses | 6/6 passed | `readiness.ts`, `readiness.json`, `readiness.log` |
| Previous 68 variants and numbering | 136 HTML/text files byte-identical; prior metadata unchanged | `preservation.json`, `baseline-catalogue.json` |
| Active email headline removal | All 72 active variants have zero H1; #5 remains retired | `heading-preservation.json` |

Failed acceptance checks: 0. Blocked checks within this local scope: 0. Production rollout, real provider acceptance/inbox delivery, actual purchase and activating Autopilot are not applicable to this QA authorization. Passing these observed checks does not establish every possible behavior.

The independent policy cases cover first eligible observation plus 48 hours for new and old accounts across access stages; no age-based catch-up; no GSC, connection, manual-work or completed-course prerequisite; verified nonguest owners with active Owner membership; member-only, role/owner mismatch, guest, unverified and opt-out exclusions. Existing completed course state remains byte-equivalent after the introduction sends.

Any owned primary or secondary business with normalized current enablement or historical use creates a durable skipped tombstone. Missing activation ID still counts; malformed truthy fields and foreign membership do not. Waiting, queued and ambiguous-retry activation checks stop the email. Preference or activation changes during suppression lookup also prevent provider POST. Email/verification/Owner-role/source changes cannot rebind delivery to a new business.

Concurrency produces one state/key. Actual mocked provider envelopes preserve full HTML/text, founder From, monitored Reply-To and idempotency key across an ambiguous retry and irrelevant GSC-only/name changes. Acceptance advances once. No later resend or course reset occurs. Opt-out pause/resume preserves identity and extends the unattempted window appropriately; 30-day unattempted and 23-hour ambiguous expiry stop without a fresh key. Weekly priority, strict shared optional 24-hour cap, daytime scheduling, no burst, work competition and suppression failure/resume were exercised.

Clean and upgrade migrations preserve prior SQL/journal lineage and add no enrollment. The upgrade retains existing opt-out, completed course, attempted guide envelope/attempt history and old general sender metadata. The clean path has no prior history to compare. Pending history cannot be deleted directly; account cascade succeeds. Readiness rejects old same-column schemas, unrelated-table decoy constraints and an unvalidated correct-table constraint, then accepts the validated upgraded allowlist.

## Browser and editorial findings

The actual rendered email selects the intended owned business even when a different one is current. Its only business-hop parameters are the fixed business UUID and `/settings?section=autopilot`. Signed-out arrival survives ordinary sign-in, reload preserves the selected business and section, and a foreign business returns 404 without changing the selected-business cookie. The owner sees an explicit off toggle and publication authority warning; a Viewer can read Settings but cannot toggle it. No activation, payment or generation POST occurs on arrival. Pretrial, restart and setup CTA variants reach usable existing gates without leaking the business ID.

The education preference description has no obsolete two-guide count. Keyboard opt-out persists after refresh and leaves work categories unchanged. Mobile Settings, Viewer and preference controls fit the viewport; no browser page errors were captured.

A factual draft issue was reported and fixed before final acceptance: a generic publishing claim could imply every connected destination publishes without another approval, while Next.js can open a draft PR. Final #30 explicitly limits automatic scheduling/publication to supporting connections, states that some destinations require their own approval, and describes community-reply/connection assistance as emailed handoffs. It makes no entire-marketing, guaranteed-ranking or personally-reviewed-results claim. This founder recommendation is distinct from #29's operational blocked-action notification. The four access variants have truthful prerequisites, one main CTA, useful founder contact and no body H1 or repeated standalone title.

The final catalogue has 29 active families, 72 variants and 30 permanent numbered slots. New references are #30A–D; all prior references and #5's retirement remain intact. The canonical and legacy alias galleries have 151 byte-identical shared files. Previous 68 variants are strictly preserved, including all HTML/text content, links and catalogue subject/preheader/sender metadata. Their prior 136 render observations remain applicable because these exact email bytes did not change; this task freshly rendered only the new eight viewport cases, rather than claiming a new 144-render run.

Four-gallery artifact fingerprint: `171fbac00af9f0d2225234ca508de8e98a2dcb9069b6d8d6044a78d4a9f0c47f`, 370 files. See `artifact-fingerprint.json`, `artifact-files.json` and `alias-preservation.json`. The earlier no-headings report and its checkpoint fingerprints remain unchanged.

## Commands and broader-suite limits

Checks used Node 22 with local `DATABASE_URL`, a local-only payload secret and explicit lifecycle test flags. Reproducible entry points are:

```sh
node --import tsx node_modules/vitest/vitest.mjs run --config .factory/lifecycle-refinement/qa/autopilot-intro/vitest.config.ts
node --import tsx node_modules/vitest/vitest.mjs run src/server/services/lifecycle/guides.test.ts src/server/services/lifecycle/education.test.ts src/server/services/lifecycle/dispatch.test.ts src/server/services/lifecycle/autopilotIntro.test.ts src/server/db/workerReady.test.ts src/server/services/lifecycle/templates.test.ts --maxWorkers=1 --no-file-parallelism
node .factory/lifecycle-refinement/qa/autopilot-intro/migrations.mjs
node --import tsx .factory/lifecycle-refinement/qa/autopilot-intro/readiness.ts
node --import tsx .factory/lifecycle-refinement/qa/autopilot-intro/browser.ts
node --import tsx .factory/lifecycle-refinement/qa/autopilot-intro/catalogue-browser.ts
python3 .factory/lifecycle-refinement/qa/autopilot-intro/fingerprint.py
```

`render.ts` was restricted with `QA_RENDER_IDS` to the four `guide-autopilot_intro-{workspace,start_trial,restart,setup}` entries. The scripts enforce a fresh local QA DB where mutations are needed. Migration/readiness scripts create their separate local proof databases. Do not point them at production.

PM separately reports full-suite 1,371 passed, 65 external skips and the single known raster golden difference (`f883614e6a7dfb07` expected, `91d5409f50974af7` actual), plus clean typecheck and optimized build. That native raster baseline was independently reproduced against unchanged main-family source in earlier QA; it is recorded separately from this feature's passing affected tests. This task does not claim an independent second full-suite run or production/inbox verification.
