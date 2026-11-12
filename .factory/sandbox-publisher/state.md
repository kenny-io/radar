# State

Repository: worktree `.claude/worktrees/radar-post-publishing-cec2ae`, branch `kenny-dev/radar-post-publishing-cec2ae`, base `main` `51cc99bc`. Last integrated revision: see the newest history section below.

File ownership per task is the table in `architecture.md` section 12; no file has two writers. Engineers do not commit; the PM commits at integration points.

| Task | Owner | Depends on | Status | Criteria |
| --- | --- | --- | --- | --- |
| PM-1 diagnosis, brief, baseline | PM | none | verified | all |
| ARCH-1 port design from Thally's Daytona agent | factory-architect | PM-1 | verified (PM review, decisions in `brief.md`) | SBX-1 to SBX-11 |
| ENG-0 contracts and configuration | factory-engineer | ARCH-1 | verified (PM reran typecheck and publishing suite: 465 pass, 51 skip) | SBX-9 |
| ENG-1 runner image and snapshot script | factory-engineer | ENG-0 | verified (`11591094`, SDK pin `3b024ae8`; live probe and runs) | SBX-2, SBX-3 |
| ENG-2 capability and model proxy | factory-engineer | ENG-0 | verified (`165bb4dc`; deployed proxy checked by QA-1) | SBX-2, SBX-9 |
| ENG-3 gate and fidelity | factory-engineer | ENG-0 | verified (`a8519f0a`, `bb5be86d`; tightened in ENG-6) | SBX-1, SBX-4 |
| ENG-4 provider and orchestration | factory-engineer | ENG-0 | verified (`c961594e`) | SBX-2, SBX-3, SBX-6 |
| ENG-5 connector integration, lifecycle, docs, live tests | factory-engineer | ENG-1 to ENG-4 | verified (`4db46f63`, `42bce097`, `2ded10aa`) | SBX-5, SBX-7, SBX-8, SBX-11 |
| QA-1 independent verification | factory-qa | ENG-5 integrated | done on `2ded10aa` (`2f10ee5f`): no blocker or major, minor D1 to D5 | SBX-1 to SBX-10 |
| ENG-6 fixes for D1 to D5 | factory-engineer | QA-1 | verified by QA-2 (`3d3dd9c7`): D3, D4, D5 fixed; D1, D2 partly (N1, N3) | SBX-1, SBX-4, SBX-5, SBX-7 |
| QA-2 recheck of the fixes | factory-qa | ENG-6 | done on `3d3dd9c7` (`0ef0adad`): minor N1 to N6; live replays blocked by a Daytona incident | SBX-1, SBX-4 to SBX-7 |
| ENG-7 fixes for N1, N3, N5, N6 | factory-engineer | QA-2 | verified by QA-3 (`8ce9b640`) | SBX-1, SBX-4, SBX-5, SBX-6 |
| QA-3 recheck and live replays on the final revision | factory-qa | ENG-7 | done on `b2b77964`: N1, N3, N5, N6 fixed; minor N7a, N7b, N8 and an N1 residual accepted; three live runs accepted | SBX-1, SBX-4 to SBX-8 |
| PM-2 PR and handoff | PM | QA-3 | PR opened; merge and rollout wait for the owner | SBX-10, SBX-11 |

Blockers: none on the owner's side for development (Daytona organization, key, tier and the model proxy were settled on 12 Nov, see below). Open: live replays on the final revision need Daytona to start sandboxes again. Merge, production variables, deployment and retrying the failed entry wait for the owner's go-ahead.

ENG-0 contract additions accepted by the PM: `RADAR_PUBLISH_SANDBOX_MAX_CALLS`, `RUNNER_ENV.model` (`RADAR_AGENT_MODEL`), `mediaOmitted` on the integration and draft shapes, `transcriptDir` on the config, `RUNNER_COMMANDS` with the exit-code rule; invalid caps count as unconfigured. Known pre-existing failure outside this feature: `src/server/ai/openrouter.qa.test.ts` golden snapshot fails identically on clean `51cc99bc`.

## Paused 11 Nov 2026 (owner restarting their laptop)

ENG-1 to ENG-4 were dispatched in parallel and stopped by the PM a few minutes later, before any of them wrote a file. The tree is clean at `94d23f65`; nothing is lost and nothing partial exists. Their task contracts are the four ENG rows of `architecture.md` section 12 plus the rules above (non-overlapping files, no commits, no Daytona, model or GitHub calls until the owner answers).

Still unanswered by the owner: Daytona organization, key and tier (Q1); whether the locally signed-in Daytona key may be used for development snapshots and live tests; approval for a dedicated `model-proxy` Railway service (Q2).

Next action on resume: dispatch ENG-1 to ENG-4 again from scratch, then integrate, run combined checks, commit, dispatch ENG-5.

## Resumed 12 Nov 2026

ENG-1 to ENG-4 dispatched again from `8a5c7672`. Tasks active.

Owner answers (12 Nov): reuse Thally's implementation (directory `/Users/ekene/Developer/thally-suite` added to the session); use the Daytona account the local CLI is signed in with for the development snapshot and live tests.

PM finding (12 Nov, two throwaway default sandboxes created with the CLI and deleted; none remain): that Daytona organization is on a restricted tier. From an unrestricted default sandbox, `example.com`, `example.org`, `www.wikipedia.org` and `radar.thally.io` reset the connection, while `github.com`, `registry.npmjs.org`, `api.anthropic.com`, `api.openai.com` and `up.railway.app` answer. Thally's `docs/operations/track-docs-agent-shadow.md` lines 29-30 say Tier 1 and 2 organization restrictions override sandbox allow-lists and that Tier 3 or 4 is required. Consequences:

- The design's egress probe (proxy reachable, canaries unreachable) will correctly fail closed on this organization, because essential-service canaries are reachable. SBX-3 cannot be met on it; production needs a Tier 3 or 4 organization.
- A proxy on a custom domain is unreachable from this organization; one on a `*.up.railway.app` hostname probably is (only `up.railway.app` itself was tested).
- Development on this organization can still exercise snapshot build, upload, runner, model path and gate, but only with the probe expectation relaxed inside a live-test harness, never in production configuration.

Superseded on 12 Nov; see below.

## Daytona organization settled (12 Nov 2026)

Owner approved creating the `model-proxy` Railway service, and saved a development API key for the **Thally** Daytona organization in the worktree's git-ignored `.env.local` as `DAYTONA_API_KEY` (never printed; load with `node --env-file=.env.local`). Owner states the organization is Tier 3. The key the local CLI uses belongs to a different, restricted organization and is not used for this feature.

PM verification with that key through `@daytona/sdk` 0.207.0 (two ephemeral sandboxes, both deleted):

- `snapshot.list` returns 34 snapshots named `thally-td-*` and `thally-uv-*`, so the key is in the Thally organization.
- `create({ ephemeral: true, domainAllowList: 'example.com', ... })` reports `domainAllowList: "example.com"` back. From inside: `example.com` answers 200 (curl and Node `fetch`); `example.org`, `github.com`, `registry.npmjs.org`, `api.anthropic.com` and `up.railway.app` fail with `CONNECT tunnel failed, response 403`. Essential services are blocked too, so SBX-3 is achievable here.
- The very first request to the allowed host in a fresh sandbox timed out at 10 s once; seconds later it answered in 50 ms. The egress probe must retry the allowed host briefly before failing closed.
- Egress goes through Daytona's proxy variables (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE` and others are set in the sandbox), matching Thally's `agent-environment.mjs`, which preserves them.

Remaining owner actions, at rollout only: a production Daytona key on the Railway worker; go-ahead to merge and deploy.

## Model proxy service (12 Nov 2026)

ENG-2 verified by the PM (99 tests rerun, typecheck clean) and committed as `165bb4dc`.

Owner-approved Railway service created in project `radar`, environment `production`: `model-proxy` (service id `9049cb36-e0f8-4d6f-8d81-b9ecdeb4d231`), domain `https://model-proxy-production-260d14ba.up.railway.app`. Variables by name: `ANTHROPIC_API_KEY` (reference to the shared variable), `DATABASE_URL` (reference to Postgres), `RADAR_PUBLISH_CAPABILITY_SECRET` (generated locally, also in `.env.local`), `NODE_ENV`, `RAILPACK_START_CMD` (`npm run model-proxy`), `RAILPACK_BUILD_CMD` (`echo model-proxy`). `railway environment edit --service-config` reported "No changes to apply" for start, build and health-check settings, so the Railpack variables carry the commands and no health-check path is set on the service yet. Deployed with `railway up` from the working tree at `165bb4dc` (a development deploy, not connected to the GitHub repository). At rollout: connect it to `kenny-io/radar` `main` like `web` and `worker`, set the health-check path `/model/health`, and reference the secret from the worker as `${{model-proxy.RADAR_PUBLISH_CAPABILITY_SECRET}}`.

Local development variables in `.env.local` (git-ignored): `DAYTONA_API_KEY`, `RADAR_PUBLISH_CAPABILITY_SECRET`, `RADAR_PUBLISH_MODEL_PROXY_URL`. Still to add after ENG-1: `RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID`.

## ENG-1 to ENG-4 integrated (12 Nov 2026)

Commits: `165bb4dc` (ENG-2 proxy and capability), `c961594e` (ENG-4 provider and orchestration), `11591094` (ENG-1 runner and snapshot script), `a8519f0a` (ENG-3 gate and fidelity). PM reran on the combined tree: `npm run typecheck` clean; `npx vitest run src/server/services/publishing` 27 files passed, 9 skipped; 944 tests passed, 51 skipped.

PM rulings:
- ENG-3 `unitCoverage` 1 (stricter than the design's 0.9) and the added interleaving rule: accepted; tune on replays.
- ENG-3 peer-content tolerance let a 13-line peer record be deleted. Sent back to ENG-3: in new-article mode at most 6 original lines removed or altered per existing file (flat, no percentage), 24 in total. In progress; commit separately.
- ENG-2 proxy refusals (server tools, `mcp_servers`, `container`) and stripped fields (`speed`, `inference_geo`, `fallbacks`): accepted.
- ENG-1 runner uses the Agent SDK's `bypassPermissions` mode, as Thally's runner does (`sandbox/track-docs-agent/run.mjs` line 1592); the tool list and hooks are the fence. Accepted; disclose to the owner.

Facts for ENG-5 from ENG-1's loopback run of SDK 0.3.251: the capability arrives in `x-api-key`; requests are `POST /model/v1/messages?beta=true` with `stream: true`, `max_tokens: 32000`, seven `anthropic-beta` values and `context_management`, `output_config`, `thinking` in the body; an unauthenticated `HEAD /model/api/hello` comes first and a 404 is tolerated. The proxy forwards `anthropic-beta` up to 2048 characters.

Model proxy: first `railway up` uploaded the main checkout (the Railway link belongs to it), so the service crashed on a missing script; redeployed with `railway up "$PWD" --path-as-root` from the worktree.

Snapshot build started with the Thally key (`scripts/operations/build-publisher-snapshot.mjs`).

Next action: confirm proxy health and snapshot id, add the id to `.env.local`, dispatch ENG-5 (connector integration, lifecycle, docs, live probe, smoke and replay).

## Development snapshot and proxy ready (12 Nov 2026)

- Model proxy redeploy `f46544db` is SUCCESS: `GET /model/health` 200, `GET /` 404, `POST /model/v1/messages` without a capability 401.
- Daytona snapshot built in the Thally organization from `sandbox/publisher/Dockerfile` at `11591094`: name `radar-publisher-b30e5aa91f99`, id `626beb11-4c8f-41ca-b28d-dd467f4be58f`, active. Saved as `RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID` in `.env.local`.
- ENG-5 dispatched (connector integration, lifecycle, docs, live probe, smoke and one LivedHQ replay; at most three agent runs). ENG-3 follow-up on the peer-content limit in progress.

ENG-3 follow-up verified by the PM (gate 78 and fidelity 30 tests pass) and committed: for a new article an existing file may have at most 6 original lines removed or altered, 24 across files; refresh keeps the earlier tolerance for files other than the article file. Accepted residual risk: overwriting a small existing record in place (4 changed lines in the engineer's probe) still passes; the removed-or-altered count is printed in the `peer-content` check detail for the PR reviewer.

## First live results and SDK pin (12 Nov 2026)

ENG-5 interim report:
- Live egress probe test passes 4 of 4 in a real sandbox from `radar-publisher-b30e5aa91f99`: proxy health reachable, four canaries blocked, no worker secret in environment, processes or files, sandbox gone afterwards.
- Live smoke fails at the first model request, identically twice (13 s, 0 tokens, 0 USD, sandboxes deleted): `API Error: 400 Claude Code 2.1.251 does not support this model; version 2.1.280 or newer is required.` Create, runner install, probe, archive upload, prepare and runner start all worked. This is the risk recorded in `architecture.md` section 13.

PM decision: keep `claude-opus-5-5`; move `@anthropic-ai/claude-agent-sdk` to exactly `0.3.312` (published 2026-10-27; latest is 0.3.322). ENG-1 is bumping the pin and re-verifying options, fences, abort, resume and the request shape against the proxy's rules. Then the PM rebuilds the snapshot and ENG-5 runs the smoke and the LivedHQ replay.

## Integration committed; SDK 0.3.312; first accepted live run (12 Nov 2026)

- `bb5be86d` ENG-3 peer-content limit; `4db46f63` ENG-5 connector integration, lifecycle, docs, live tests; `3b024ae8` ENG-1 SDK bump to 0.3.312 (plus `ENABLE_TOOL_SEARCH=false` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` in the agent environment). PM reran on `3b024ae8`: typecheck clean; `npx vitest run src/server/services/publishing` 28 files passed, 11 skipped; 998 tests passed, 56 skipped.
- New snapshot `radar-publisher-8ff5c7e1f6d2`, id `20968cbf-52e4-4635-8b90-12fcb694ad3f` (in `.env.local`). The first snapshot `radar-publisher-b30e5aa91f99` (`626beb11-...`) is obsolete and can be deleted from the Thally organization.
- Live smoke on the new snapshot, run by the PM: accepted, 47.7 s, 12 agent turns, 6 model calls, 0.1074 USD, one new file, no sandbox left listed. Record: `.data/sandbox-publisher/replays/smoke-20261112T004252Z.json`.
- LivedHQ replay (`livedhq-new-registry`, pinned `a44ccfb4`) started by the PM.

Open follow-ups: provider error text is reduced to `AgentApiError:<status>` in `result.json` (ENG-5 defect 2), fix after the live runs since runner scripts are read per run; `SandboxDraftExtra` lacks `continuation` in `types.ts` (ENG-5 defect 5); SDK 0.3.312 retries a 400 up to three times.

## Follow-up fix, QA-1 and ENG-6 (12 Nov 2026)

- `2ded10aa` keeps the provider's error message when an agent run fails (`providerError` in the runner result) and adds `continuation` to `SandboxDraftExtra`. Both ENG-5 follow-ups above are closed.
- LivedHQ new-article replay accepted on `42bce097`: 94.9 s, 12 model calls, 0.4693 USD; `posts.ts` 186,081 to 190,530 bytes, 0 of 2,528 original lines altered, 73 added, 19 of 19 units word for word.
- QA-1 on `2ded10aa` (report in `qa/report.md`, probes and evidence committed as `2f10ee5f`): every criterion passed; five minor defects D1 to D5; five live agent runs accepted (1.17 USD); one real draft PR on `kenny-io/radar-connector-test` (pull 9, closed, branch deleted); 15 sandboxes all deleted; browser smoke 15 of 15.
- ENG-6 fixed D1 to D5 in `3d3dd9c7` and added `architecture.md` section 15. PM rerun before the commit: typecheck clean; `npx vitest run src/server/services/publishing src/server/observability` 1,081 passed, 60 skipped.

## QA-2 and ENG-7 (12 Nov 2026)

- QA-2 on `3d3dd9c7` (probes and evidence `0ef0adad`, results appended to `qa/report.md`): D3, D4, D5 fixed; D1 and D2 partly fixed. New minor findings N1 (retry path keeps the old peer rule), N2 (added text is not judged), N3 (words at the edge of a unit), N4 (three honest edits now refused), N5 (a failed create strands a sandbox and the next sweep fails on it), N6 (agent note renders as a task box, heading or quote). Baseline: typecheck clean; publishing, observability and AI suites 1,423 passed, 60 skipped, 1 failed (pre-existing `openrouter.qa.test.ts`); `npm test` 2,281 passed, 557 skipped, same 1 failed; build compiles; QA offline suite 289 passed, 23 skipped. PM reran the QA offline suite: same counts.
- The two live replays did not run. Daytona could not start sandboxes between 02:15 and at least 03:15 UTC; three attempts ended `sandbox-unavailable` with 0 model calls and no upload. Three sandboxes stuck in `creating` (`b86705e4`, `c5ad7237`, `60d17fc9`, all `workload=radar-publisher`, holding nothing) could not be deleted; the PM is retrying.
- PM decisions: fix N1, N3, N5 and N6 now (ENG-7); accept N2 and N4 for v1 and record them in `architecture.md` section 15. Release-ready needs the two replays accepted on the final revision.

## ENG-7 and QA-3 (12 Nov 2026)

- The three stuck sandboxes were deleted by the PM's retry loop once Daytona recovered (none listed at 04:00 UTC).
- ENG-7 (`8ce9b640`): retries compare with the default-branch commit the article branch started from; a unit must stand alone in the text that carries it; a failed create is swept and reported and a leftover no longer fails the next attempt; agent statements in the PR body follow a Radar label. N2 and N4 recorded in `architecture.md` section 15. PM rerun: typecheck clean; `npx vitest run src/server/services/publishing src/server/observability` 1,212 passed, 64 skipped; `npm run build` compiles.
- QA-3 on `b2b77964` (results in `qa/report.md`): N1, N3, N5, N6 fixed. Baseline: typecheck clean; publishing, observability and AI suites 1,554 passed, 64 skipped, 1 failed (pre-existing); `npm test` 2,412 passed, 561 skipped, same 1 failed; build compiles; QA offline suite 401 passed, 25 skipped (PM reran: same). Live, all accepted first pass with no repair round: LivedHQ new article (93.1 s, 0.5479 USD, 0 of 2,528 lines altered, 19 of 19 units), thally-website new article with em dash (106.4 s, 0.6150 USD, 0 of 1,083 altered, 13 of 13 units), and a retry with a changed title (93.2 s, 0.3245 USD, the agent rewrote exactly its own four lines). Four sandboxes created, none left.
- PM decisions: accept N7a, N7b, N8 and the N1 residual for the first cohort and record them in section 15 as open before any wider rollout. QA's recommendation: merge with the switch off, yes; the owner's own businesses, yes, with a person reviewing each PR and someone watching `publishing.sandbox.teardown`; other customers, not yet.
- Release-ready revision: the branch tip that adds these records (code unchanged since `8ce9b640`).

