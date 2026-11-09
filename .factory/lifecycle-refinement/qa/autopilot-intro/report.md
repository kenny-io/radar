# Independent QA: Autopilot introduction #30

Accept the observed scope for the existing PR update. No unresolved regression or blocked local acceptance check remains. No merge, deployment or real send was performed.

## Tested source

Workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`, HEAD `22267d421851bde1504282a9b0375d2e1713ecbf` plus frozen #30 changes. HEAD alone does not identify the tested uncommitted source.

- Source SHA256: `e3f95c8bf39df1d1cd185a05bbadeca741bb1333d5fadc3506e90150ee8d291e`, 639 files; independently matches PM. Scope and file hashes: `source-fingerprint.json`, `source-files.json`, `fingerprint.py`.
- Four-gallery artifact SHA256: `171fbac00af9f0d2225234ca508de8e98a2dcb9069b6d8d6044a78d4a9f0c47f`, 370 files; `artifact-fingerprint.json`, `artifact-files.json`.
- Optimized BUILD_ID `tf8NPjH3mJSdrM-Of5Leo`, `.next-autopilot-intro`, actual production-mode app at `http://localhost:3951`.
- Node 22.18.0, local Postgres 15 port 54329, fresh `radar_autopilot_intro_qa_20261110` with 17 migrations, installed Google Chrome through Playwright. Ordinary synthetic verified owner, Viewer, foreign-owner and access-state accounts only.

## Results

| Check | Passed | Evidence |
| --- | ---: | --- |
| Independent enrollment/delivery tests | 16/16 | `independent-tests.log`, `policy.test.ts`, `delivery.test.ts` |
| Affected developer tests independently rerun | 105/105, 6 files | `developer-tests.log` |
| Real optimized browser scenarios | 18/18 | `browser-results.json`, mobile screenshots |
| New #30 email renders | 8/8, four variants × 390/600 px | `renders/results.json` |
| Catalogue and gallery controls | 12/12 | `catalogue-browser.json` |
| Clean migration and prior-0015 upgrade, including repeat no-op | Both passed | `migration-proof.json` |
| Actual worker readiness probes | 6/6 | `readiness.json` |

Failed: 0. Blocked within authorized local scope: 0. Detailed acceptance cases, exact commands and environment setup are recorded in `detailed-coverage.md` and the executable harnesses here.

The independent cases cover first observation +48 hours without catch-up, current owned Owner-role/verified eligibility, durable skip for any owned current or prior Autopilot use, no re-enrollment or course reset, source/recipient/role loss, opt-out and activation changes during suppression lookup, concurrent capture, stable full provider envelope/key across GSC-only retry changes, pause/expiry, priority, strict shared cap and daytime. Clean/upgrade preserve old lineage and history without enrolling users. Readiness rejects old, decoy and unvalidated constraints.

Real browser checks follow the actual business-scoped email CTA through sign-in, business switching and refresh. Foreign access is denied without cookie mutation; Viewer cannot toggle. Owner sees explicit publication authority and an off toggle. Pretrial/restart/setup links reach usable gates. Keyboard opt-out persists independently of work preferences. No activation, payment or generation POST occurred; browser errors: 0.

The draft destination-approval overstatement was corrected before acceptance. Final copy limits automatic publication to supporting connections, states that some destinations need approval, and accurately describes emailed community/connection handoffs. It remains distinct from #29's blocked-action notice and makes no entire-marketing or guaranteed-results claim.

Final catalogue: 29 active families, 72 variants, 30 numbered slots, #5 retired. All 72 active bodies have zero H1; #30A–D have no standalone plaintext title. Prior 68 metadata records and all 136 HTML/text files are byte-identical, preserving content, links, numbers and prior render evidence. The new eight renders supplement that unchanged 136-render checkpoint; this is not a fresh 144-render run. Canonical/legacy aliases have 151 byte-identical shared files. See `preservation.json`, `heading-preservation.json`, `alias-preservation.json`. The no-headings checkpoint remains unchanged.

## Limits

Provider traffic was mocked; no worker, customer/operator email, production write, actual payment or activation occurred. Production/inbox delivery and rollout are outside this authorization. Browser server is stopped; application QA users, businesses, outbox, guide states and jobs are empty (`cleanup.json`). Separate local migration/readiness proof databases remain as evidence.

PM separately reports 1,371 full-suite passes, 65 external skips, clean typecheck/build and the single existing native raster baseline mismatch (`f883614e6a7dfb07` expected versus `91d5409f50974af7` actual). Earlier QA independently reproduced that baseline on unchanged main-family source. This task reran the affected suite independently, not a second full suite. Observed passes do not prove every possible behavior.
