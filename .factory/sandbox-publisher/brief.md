# Sandbox publisher

## Problem

GitHub publishing (`ConnType` `nextjs`) uses a tool-less planner (`src/server/services/publishing/connectors/nextjs-agent.ts`): source is pasted into prompts, at most 8 model calls and 270 s, exact-match edits, no file over 100 KB, nothing can be run. Production worker logs show six distinct planner failures in six days across two repositories, each needing a Radar release:

| Date (UTC) | Entry | Failure |
| --- | --- | --- |
| 6 and 9 Nov | e_2UQxRIMM, e_2Qcpo76u (thallylabs/thally-website) | generated `src/generated/website-pages.json` over 100 KB |
| 9 Nov | e_2Qcpo76u | empty plan / change budget |
| 9 Nov | e_2Qcpo76u | reviewer rejected an em dash banned by the repo's `scripts/seo-audit.mjs`; single correction failed |
| 9 Nov | e_MCOBF9hZ (kenny-io/LivedHQ) | root-relative refresh URL rejected |
| 10 Nov | e_MCOBF9hZ | refresh target is a typed hub record, not a blog post |
| 10 Nov | e_tl6rSYPs (kenny-io/LivedHQ), believed to be "Manazel Al Barsha Reviews" | authored registry `apps/web/app/blog/posts.ts` 144 KB then, 186 KB now; every new lived.ae post fails |

The entry-to-title match for e_tl6rSYPs is inferred from logs; production database reads are not available to this session.

## Direction (user decisions)

- 11 Nov: user approved replacing the planner with an agent in a disposable Daytona sandbox ("Yes, build it").
- 11 Nov: user asked to reuse Thally's working Daytona implementation. Reference: `/Users/ekene/Developer/thally-suite/thally-cloud` (main `69f5e9e8`), `docs/architecture/track-docs-agent-sandbox.md`, `src/platform/track-docs-agent/`, `sandbox/track-docs-agent/`, `workers/track-docs-agent-model-proxy/`, and the smaller sibling `src/platform/site-localization-daytona.ts` with `docs/operations/managed-localization-daytona.md`. This supersedes the PM's earlier idea of running the agent loop on the worker: follow Thally's pattern (agent runner inside the sandbox, model access only through a capability-checked proxy) unless the architect finds a concrete reason it does not fit Radar.

## Scope

Replace `planRepositoryPost` for GitHub connections with a sandbox agent run. Radar (the control plane) prepares a credential-free snapshot of the pinned commit plus the article payload, the agent integrates the article into the repository's real conventions and self-verifies, Radar collects the diff and run report, applies a publication gate, then commits and opens the draft PR with the existing transport in `connectors/nextjs.ts`.

Scale Thally's design down to Radar: one long-running Railway worker and an existing job queue, so no Netlify 15-minute continuation, trigger ledger, credit pool or resumable-sandbox product surface unless the architect shows one is required.

## Exclusions

- No change to other connectors, article generation, customer-facing failure copy or the report-issue flow.
- No auto-merge and no marking PRs ready; output stays a draft PR.
- No site-specific adapters.
- No migration from the GitHub OAuth app to a GitHub App.
- No merge or production deployment without the owner's go-ahead (repository policy recorded in `.factory/refresh-publishing/brief.md`).

## Acceptance criteria

- SBX-1: With the sandbox publisher enabled, a new article for a repository whose blog registry is one authored file over 100 KB (pinned LivedHQ snapshot) produces a complete integration: the registry gains exactly one record, peer records are byte-identical, and the existing transport opens one draft PR.
- SBX-2: No GitHub token, provider API key, database URL or Radar secret is present in the sandbox (environment, files, process arguments, git config). Model access uses only a scoped, expiring per-run capability.
- SBX-3: Sandbox egress is limited to the model proxy while repository content or code is present; if the restriction cannot be applied the run fails closed before repository content is uploaded.
- SBX-4: The publication gate validates what the agent produced before any Git write: protected paths (`safeRepositoryPath` write rules), credential scan, file count and size ceilings, regular-file modes only, changes confined to the repository, and article fidelity (the supplied article is present once and not shortened or rewritten beyond format conversion). A violation fails closed with a bounded, sanitized diagnostic and zero Git writes.
- SBX-5: The PR body reports exactly which checks the agent ran and their outcome and never claims an unrun check; `runtimeVerified` is true only when a real repository check ran and passed.
- SBX-6: Sandboxes are deleted on success, failure and timeout; a worker killed mid-run cannot leak a sandbox beyond a bounded TTL. Teardown failure is reported.
- SBX-7: One absolute attempt deadline covers the run; the publish job timeout is raised to fit it; the entry stays `publishing` meanwhile; a retry reuses the article branch and PR and never opens a second PR.
- SBX-8: The six historical failures above are replayed on pinned snapshots of thally-website, LivedHQ and radar-connector-test and each either produces an accepted integration or fails with an accurate, specific reason that is not a tool limitation.
- SBX-9: Rollout is a server-side switch. With it off, or with Daytona unconfigured, behavior is the current planner, unchanged. Model usage is recorded with cost; terminal failures go through `reportFailure` with safe diagnostics; customer payloads keep the existing generic failure copy.
- SBX-10: Typecheck, focused and broader publishing tests and the production build pass on the integrated revision; independent QA covers the gate, credential and egress probes in a real sandbox, one real draft PR on kenny-io/radar-connector-test, and a browser smoke of the article publishing and failed states.
- SBX-11: Documentation covers configuration, snapshot build and release, observability, and rollback (`scripts/connectors/README.md`, `docs/OBSERVABILITY.md`).

## PM decisions after ARCH-1 (11 Nov)

Design: `architecture.md`. Accepted as written, with these rulings on its section 13:

- SBX-5 amended: v1 runs no repository install, build or script. Egress is proxy-only and the agent has file tools only, as in Thally. `runtimeVerified` is false for every v1 run; the PR body lists control-plane checks as run, labels agent statements as unverified and prints a fixed not-run list. The PM's earlier statement to the owner that the agent could run the repository's lint and build is withdrawn and must be corrected in the next owner update.
- SBX-4 amended: prose fidelity is gated strictly; media and links a destination format cannot carry are disclosed in the PR, not fatal (Q4).
- SBX-1 amended: the gate proves peer content unchanged and the article not duplicated; record counting is a fixture-test and QA check.
- No transcript is retained in production in v1 (Q5). Local directory only in development and QA.
- Default model `claude-opus-5.5` (the model the planner uses today), cap 6 USD and 200 calls per run, both configurable; revisit against replay cost data (Q3).
- First rollout cohort: the owner's own businesses by id (Q7), at the owner's go-ahead.

Waiting on the owner (does not block ENG-0 to ENG-4): which Daytona organization and key Radar uses and whether it is Tier 3 or higher (Q1); approval to create a dedicated `model-proxy` Railway service with its own domain (Q2); whether the locally signed-in Daytona key may be used for development snapshots and live tests. Until answered, no snapshot is built and no live sandbox test runs.

## Constraints and dependencies

- Node 22; Next.js web plus `tsx` worker on Railway (`radar` project: `web`, `worker`, `Postgres`).
- Baseline at `51cc99bc`: `npx vitest run src/server/services/publishing` passes 408, skips 51.
- No Daytona variable exists locally or on the Railway worker. The local `daytona` CLI (v0.207.0) is signed in with an API key. Production needs a Daytona key, a published runner snapshot and a reachable model proxy; setting production variables and deploying need the owner.
- Worker variables present by name: `ANTHROPIC_API_KEY`, `OPEN_ROUTER_API_KEY`, `OPENAI_API_KEY`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. OpenRouter, OpenAI images and xAI were returning out-of-credit errors on 10 Nov; Anthropic direct was serving.
- The GitHub OAuth token has `repo` scope across all of the customer's repositories.

## Delivery

Branch `kenny-dev/radar-post-publishing-cec2ae` (worktree), PR against `main`. Release-ready requires integrated verification; merge, production configuration, deployment and retrying the failed entry wait for the owner's go-ahead.
