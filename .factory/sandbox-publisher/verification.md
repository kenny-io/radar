# Verification

Node 22.18.0. Live checks use the Thally Daytona organization (Tier 3), snapshot `radar-publisher-8ff5c7e1f6d2` and the development deploy of the `model-proxy` Railway service. Detailed QA results, probes and evidence: `qa/report.md`, `qa/*.qa.test.ts`, `qa/evidence/`.

## Baseline (PM-1, 11 Nov 2026, `51cc99bc`, clean tree)

- `npx vitest run src/server/services/publishing`: 18 files passed, 9 skipped; 408 tests passed, 51 skipped (live-credential suites).
- `src/server/ai/openrouter.qa.test.ts` fails on clean `main` with a golden-snapshot hash difference. It is outside this feature and fails identically on every revision below.

## Diagnosis evidence (read-only)

- Railway worker logs per deployment (`railway logs --service worker <deployment> --lines 3000 --json`): terminal `publishing.entry` failures listed in `brief.md`. Deployment `ca5180f9`, 2026-11-10T05:01:05Z, entry `e_tl6rSYPs`: `unavailable source: apps/web/app/blog/posts.ts (144591 bytes; limit 100000 bytes)`.
- `gh api repos/kenny-io/LivedHQ/contents/apps/web/app/blog`: `posts.ts` is 186,081 bytes on `migrate/netlify`; 25 inline post records; no `radar/` branch other than the merged `radar/1-bedroom-apartment-for-rent-in-dubai-MCOBF9hZ`; no Manazel article in the file.

## Automated checks by revision

| Revision | Run by | Command | Result |
| --- | --- | --- | --- |
| `3b024ae8` | PM | `npm run typecheck` | clean |
| `3b024ae8` | PM | `npx vitest run src/server/services/publishing` | 998 passed, 56 skipped |
| `2ded10aa` | QA-1 | `npm run typecheck` | clean |
| `2ded10aa` | QA-1 | `npx vitest run src/server/services/publishing` | 1,009 passed, 56 skipped |
| `2ded10aa` | QA-1 | `npm test` | 2,243 passed, 557 skipped, 1 failed (pre-existing) |
| `2ded10aa` | QA-1 | `npm run build` | compiled successfully |
| `2ded10aa` | QA-1 | QA offline suite | 209 passed, 17 skipped |
| `3d3dd9c7` | PM | `npm run typecheck` | clean |
| `3d3dd9c7` | PM | `npx vitest run src/server/services/publishing src/server/observability` | 1,081 passed, 60 skipped |
| `3d3dd9c7` | QA-2 | `npx vitest run src/server/services/publishing src/server/observability src/server/ai` | 1,423 passed, 60 skipped, 1 failed (pre-existing) |
| `3d3dd9c7` | QA-2 | `npm test` | 2,281 passed, 557 skipped, 1 failed (pre-existing) |
| `3d3dd9c7` | QA-2 | `npm run build` | compiled successfully |
| `3d3dd9c7` | QA-2, PM | QA offline suite (`npx vitest run --config .factory/sandbox-publisher/qa/vitest.config.ts`) | 289 passed, 23 skipped |
| `8ce9b640` | PM | `npm run typecheck` | clean |
| `8ce9b640` | PM | `npx vitest run src/server/services/publishing src/server/observability` | 1,212 passed, 64 skipped |
| `8ce9b640` | PM | `npm run build` | compiled successfully |
| `b2b77964` | QA-3 | `npm run typecheck` | clean |
| `b2b77964` | QA-3 | `npx vitest run src/server/services/publishing src/server/observability src/server/ai` | 1,554 passed, 64 skipped, 1 failed (pre-existing) |
| `b2b77964` | QA-3 | `npm test` | 2,412 passed, 561 skipped, 1 failed (pre-existing) |
| `b2b77964` | QA-3 | `npm run build` | compiled successfully |
| `b2b77964` | QA-3, PM | QA offline suite | 401 passed, 25 skipped |
| `b2b77964` | QA-3 | GitHub Markdown rendering of 115 PR bodies with hostile agent text | no block, link, image or mention in the agent section |
| `388aa718` (merge of `main` `8f9b52d5`) | PM | `npm run typecheck` | clean |
| `388aa718` | PM | `npm test` | 2,430 passed, 561 skipped, 1 failed (pre-existing) |
| `388aa718` | PM | QA offline suite | 401 passed, 25 skipped |
| `388aa718` | PM | `npm run build` | compiled successfully |

## Live runs (real sandbox, real model, no GitHub write unless stated)

| Revision | Run by | Target | Outcome | Duration | Model calls | Cost (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| `3b024ae8` | PM | smoke fixture | accepted | 47.7 s | 6 | 0.1074 |
| `42bce097` | PM | `kenny-io/LivedHQ` `a44ccfb4`, new article into the 186 KB registry | accepted | 94.9 s | 12 | 0.4693 |
| `2ded10aa` | QA-1 | `kenny-io/radar-connector-test` `15045b10`, new | accepted | 54.8 s | 6 | 0.1045 |
| `2ded10aa` | QA-1 | `kenny-io/LivedHQ` `f29da593`, refresh of a typed hub record, root-relative URL | accepted | 102.3 s | 16 | 0.4102 |
| `2ded10aa` | QA-1 | `thallylabs/thally-website` `c9a3b859`, new, one em dash | accepted | 126.2 s | 15 | 0.4239 |
| `2ded10aa` | QA-1 | `kenny-io/radar-connector-test`, full connector path, real draft PR | accepted | 43.5 s | 6 | 0.1090 |
| `2ded10aa` | QA-1 | hostile synthetic repository | accepted, planted instructions ignored | 49.4 s | 6 | 0.1196 |
| `3d3dd9c7` | QA-2 | LivedHQ new, thally-website new, LivedHQ new again | not run: `sandbox-unavailable`, Daytona could not start sandboxes | n/a | 0 | 0 |
| `b2b77964` | QA-3 | `kenny-io/LivedHQ` `a44ccfb4`, new article into the registry | accepted, no repair round | 93.1 s | 12 | 0.5479 |
| `b2b77964` | QA-3 | `thallylabs/thally-website` `c9a3b859`, new, one em dash | accepted, no repair round | 106.4 s | 17 | 0.6150 |
| `b2b77964` | QA-3 | thally-website retry with a changed title (earlier attempt's files laid over the default branch) | accepted, no repair round | 93.2 s | 13 | 0.3245 |

- LivedHQ new article: `posts.ts` 186,081 to 190,530 bytes, 0 of 2,528 original lines altered, 73 added, 19 of 19 article units word for word.
- Final revision (`b2b77964`): LivedHQ 0 of 2,528 original lines altered or removed, 76 added, records 24 to 25, 19 of 19 units and 6 of 6 headings word for word. thally-website 0 of 1,083 altered or removed, six files (four new), 13 of 13 units, no em dash in any changed file and the replacement disclosed as a deviation. Retry: the agent rewrote exactly its own four lines; compared with the default-branch commit. Nothing "not decided" in any run.
- Draft PR `https://github.com/kenny-io/radar-connector-test/pull/9`: one branch, one commit, one added file; the retry ran no sandbox and returned the same PR; closed unmerged, branch deleted.
- Egress, credentials and teardown in a real sandbox (QA-1): proxy reachable, 18 other hosts unreachable; file-tool fence refused 13 hostile calls against the real SDK; 15 QA sandboxes all deleted.
- Browser smoke (QA-1, dev stubs): 15 of 15 plus 3 of 3 for retry; failed articles show only the generic copy.

Tested revision for release: `b2b77964` for QA and live runs (sandbox code last changed in `8ce9b640`); `388aa718` adds a merge of `main` with one conflict in `connectors/nextjs.ts`, covered by the automated checks above and no new live run. Sandboxes left after all rounds: none.

## Not verified

- `ai_calls` rows and cost for the live runs (no production database access).
- The path through `publishEntry` and the job queue with the switch on in a real worker.
- A live gate refusal, a live repair round, the budget stop with real spend, the 13.5-minute deadline.
- The signed-marker resume and the retry's compare request against real GitHub through the connector (checked on a model of GitHub; the live retry called `integrateWithSandbox` directly; the compare response shape was confirmed read-only).
- Teardown after a real failed create (fake provider only; Daytona was healthy during QA-3).
- Snapshot rebuild by anyone other than the PM, production configuration on Railway, several attempts at once, screen reader behaviour.
