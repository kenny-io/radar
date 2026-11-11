# State

Repository: worktree `.claude/worktrees/radar-post-publishing-cec2ae`, branch `kenny-dev/radar-post-publishing-cec2ae`, base `main` `51cc99bc`. Last integrated revision: `51cc99bc` (no implementation yet).

File ownership per task is the table in `architecture.md` section 12; no file has two writers. Engineers do not commit; the PM commits at integration points.

| Task | Owner | Depends on | Status | Criteria |
| --- | --- | --- | --- | --- |
| PM-1 diagnosis, brief, baseline | PM | none | verified | all |
| ARCH-1 port design from Thally's Daytona agent | factory-architect | PM-1 | verified (PM review, decisions in `brief.md`) | SBX-1 to SBX-11 |
| ENG-0 contracts and configuration | factory-engineer | ARCH-1 | verified (PM reran typecheck and publishing suite: 465 pass, 51 skip) | SBX-9 |
| ENG-1 runner image and snapshot script | factory-engineer | ENG-0 | active | SBX-2, SBX-3 |
| ENG-2 capability and model proxy | factory-engineer | ENG-0 | active | SBX-2, SBX-9 |
| ENG-3 gate and fidelity | factory-engineer | ENG-0 | active | SBX-1, SBX-4 |
| ENG-4 provider and orchestration | factory-engineer | ENG-0 | active | SBX-2, SBX-3, SBX-6 |
| ENG-5 connector integration, lifecycle, docs, live tests | factory-engineer | ENG-1 to ENG-4 | planned | SBX-5, SBX-7, SBX-8, SBX-11 |
| QA-1 independent verification | factory-qa | ENG-5 integrated | planned | SBX-1 to SBX-10 |
| PM-2 PR and handoff | PM | QA-1 | planned | SBX-10, SBX-11 |

Blockers: none for ENG-0 to ENG-4. Snapshot build and every live sandbox test (ENG-1 development snapshot, ENG-5 probe, smoke and replay, QA live checks) wait on the owner: Daytona organization, key and tier; a publicly reachable model proxy (new Railway service); permission to use the local Daytona key.

ENG-0 contract additions accepted by the PM: `RADAR_PUBLISH_SANDBOX_MAX_CALLS`, `RUNNER_ENV.model` (`RADAR_AGENT_MODEL`), `mediaOmitted` on the integration and draft shapes, `transcriptDir` on the config, `RUNNER_COMMANDS` with the exit-code rule; invalid caps count as unconfigured. Known pre-existing failure outside this feature: `src/server/ai/openrouter.qa.test.ts` golden snapshot fails identically on clean `51cc99bc`.

Next action: integrate ENG-1 to ENG-4, run combined checks, commit, dispatch ENG-5.
