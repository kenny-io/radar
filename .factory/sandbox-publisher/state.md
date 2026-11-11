# State

Repository: worktree `.claude/worktrees/radar-post-publishing-cec2ae`, branch `kenny-dev/radar-post-publishing-cec2ae`, base `main` `51cc99bc`. Last integrated revision: `94d23f65` (ENG-0 foundation; nothing calls it yet).

File ownership per task is the table in `architecture.md` section 12; no file has two writers. Engineers do not commit; the PM commits at integration points.

| Task | Owner | Depends on | Status | Criteria |
| --- | --- | --- | --- | --- |
| PM-1 diagnosis, brief, baseline | PM | none | verified | all |
| ARCH-1 port design from Thally's Daytona agent | factory-architect | PM-1 | verified (PM review, decisions in `brief.md`) | SBX-1 to SBX-11 |
| ENG-0 contracts and configuration | factory-engineer | ARCH-1 | verified (PM reran typecheck and publishing suite: 465 pass, 51 skip) | SBX-9 |
| ENG-1 runner image and snapshot script | factory-engineer | ENG-0 | planned (dispatched then stopped at the pause; wrote no files) | SBX-2, SBX-3 |
| ENG-2 capability and model proxy | factory-engineer | ENG-0 | planned (dispatched then stopped at the pause; wrote no files) | SBX-2, SBX-9 |
| ENG-3 gate and fidelity | factory-engineer | ENG-0 | planned (dispatched then stopped at the pause; wrote no files) | SBX-1, SBX-4 |
| ENG-4 provider and orchestration | factory-engineer | ENG-0 | planned (dispatched then stopped at the pause; wrote no files) | SBX-2, SBX-3, SBX-6 |
| ENG-5 connector integration, lifecycle, docs, live tests | factory-engineer | ENG-1 to ENG-4 | planned | SBX-5, SBX-7, SBX-8, SBX-11 |
| QA-1 independent verification | factory-qa | ENG-5 integrated | planned | SBX-1 to SBX-10 |
| PM-2 PR and handoff | PM | QA-1 | planned | SBX-10, SBX-11 |

Blockers: none for ENG-0 to ENG-4. Snapshot build and every live sandbox test (ENG-1 development snapshot, ENG-5 probe, smoke and replay, QA live checks) wait on the owner: Daytona organization, key and tier; a publicly reachable model proxy (new Railway service); permission to use the local Daytona key.

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
