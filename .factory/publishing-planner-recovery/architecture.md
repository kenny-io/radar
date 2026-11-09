# Publishing planner recovery architecture

ARCH-1, 2026-11-10. Scope: this record only; implementation owned by planner_implementation, QA and release owned separately. Actual workspace `/Users/ekene/.codex/worktrees/publishing-planner-recovery/radar-push`, starting revision `8b0fc3462c2709788cfa730d2f80c3ffee014a30` (`origin/main`). User-provided AGENTS instructions and `.factory/publishing-planner-recovery/brief.md` govern; no additional repository AGENTS file was found. Existing generalized planner contract: `.factory/github-publishing-integration/architecture.md`.

## Decision and failure mechanism

Keep the existing framework-independent planner, exact-source validators, separate source reviewer, and atomic draft-PR transport. Add metadata-aware source availability and bounded useful rejection provenance; no new service, destination execution, migration, framework adapter, blanket generated-directory exclusion, or increase in source budgets.

`nextjs-agent.ts` currently drops blob sizes from its manifest, reads each selected file, and aborts if one exceeds 100,000 bytes. `nextjs.ts` also fetches contents before applying its size guard. Consequently selecting `src/generated/website-pages.json` aborts discovery despite readable authored source/generator inputs. PM measured the artifact at 846,266 bytes and its generator at 5,621 bytes. Existing proposal validation merges empty plans, file count and edit count into one sentence; reviewer rejection replaces concrete issues with a generic failure, and an empty repair replaces the originating review explanation. `publisher.ts` persists only the status line and optional hint; article UI attributes that local rejection to GitHub.

## Shared contracts

Extend `RepoEntry` with optional `size?: number` from GitHub's immutable tree response. Older fixtures/callers without sizes remain valid. The model manifest carries path, exact SHA, optional size and readability (`text-candidate` or `too-large`). Metadata alone is never source proof.

Keep source reads complete and bounded. Maintain separate attempted-path and observed-source sets. An attempted unique path consumes the existing 40-path budget even when unavailable; repeated unavailable paths never trigger repeated reads. Observed contains only complete UTF-8 regular-file text that passes credential, binary and size/context checks, with its exact tree/content SHA. Known blobs over 100,000 bytes are not downloaded. A typed oversized-read error handles absent/incorrect metadata; catch only that specific diagnostic in discovery. Preserve network, authorization, stale-SHA, protected-path, malformed encoding and credential failures.

Each discovery, proposal, independent review and repair prompt receives `unavailableSources: Array<{path:string,sha:string,size?:number,reason:'file-too-large',limit:100000}>`. Host-owned notices contain no partial source. A discovery response claiming completion while it newly encounters unavailable sources receives another discovery round with those notices. Exhausted/no-progress discovery fails with the unavailable path/size/limit and explanation that the required integration could not be established within bounds. Bound rounds, notices and attempts; never silently mark unavailable content observed.

Prompt guidance follows actual imports, configuration, consumers and generator/build scripts to authored inputs. A filename or directory does not establish that a file is generated, optional or safe to omit. Leaving an artifact unchanged requires exact inspected evidence proving generator coverage and pipeline ordering before the relevant consumer, required validation or deployment. A required manually maintained registry beyond the budget remains an explicit rejection; do not create an orphan article or waive registration.

Preserve the existing limits: six discovery rounds, 40 attempted paths, 100,000 bytes per complete source, 500,000 observed source bytes, 600,000 manifest bytes, 12 changed files, 80 edits, 750,000 final output bytes, 24 evidence items, eight total AI calls and one repair. A repaired proposal must pass the same deterministic validator and a fresh independent reviewer. Dependency reads cannot consume the final review's reserved call. The repair is never self-approving.

Use an optional typed diagnostic on `PublishError`, with safe serializable equivalents on the existing JSONB `publishError`; no migration. Preserve compatibility with existing errors. Suggested vocabulary: `source: 'radar'`, `diagnostic: {code,stage,actual?,limit?,path?,origin?}`. `stage` identifies discovery, plan validation, source review or repair. Distinguish `plan-empty`, changed-file count, edit count, output bytes, file-too-large, discovery exhaustion, rejected source review and failed repair. Actual/limit fields must be host-counted. An empty plan is not reported as a budget overflow.

Reviewer rejection retains concrete sanitized issues. Failed repair retains both original failure and final repair failure, including original independent-review issue text when that prompted repair. Never persist whole model output, previous proposals, article bodies, repository text, or evidence snippets as diagnostics. Use bounded safe issue summaries (e.g. at most three issues, 300 characters each), redact recognizable credentials, private-key material, authorization values and credential-bearing URLs; reuse central diagnostic sanitization where possible. Bound the complete public hint/diagnostic before persistence and logging. Do not echo raw failed edit text or schema input. Existing in-memory correction feedback remains separately bounded and checked.

`publisher.ts` copies the optional local origin and structured safe diagnosis into the article error JSON. `publishFailParts`, article banner and dashboard distinguish Radar preparation failure from a remote HTTP rejection; a local 422 does not imply that GitHub rejected a request or that reconnecting fixes source integration. Existing remote errors keep their current wording. Older persisted errors without origin retain the old interpretation. Article content remains safe and available for retry.

Local transport safety checks (tree budget, mismatched immutable SHA, unsupported encoding/UTF-8, unsafe stored draft or integration) also receive local diagnostic origin. Actual GitHub HTTP failures and account authorization errors keep remote attribution. PM approved this narrow consistency change so new UI does not keep misattributing host-side transport validation.

## Boundaries and affected modules

- `connectors/nextjs-agent.ts`: types, manifest/read attempts, source-availability prompts, precise validation/review/repair provenance. Exact source and SHA rules unchanged.
- `connectors/nextjs.ts`: preserve tree sizes, preflight known oversized files, typed fallback size rejection, immutable source reads; no writes before successful plan and fresh review.
- `http.ts`: optional local diagnostic metadata only; transport/auth semantics unchanged.
- `publisher.ts`, shared calendar/publish error types, `lib/constants.ts`, article and dashboard UI: safe diagnostic persistence and honest local attribution.
- Focused planner/transport/publisher/UI tests: meaningful failure and recovery boundaries.

Connection authorization and tenant selection remain owned by the existing publisher/store/action layer. A source problem does not mark a healthy connection expired. Repository and article/model text remain untrusted data, not executable instructions. No destination code runs on Radar. One atomic tree/commit plus non-force ref update exposes only the complete integration. Retry preserves article branch, slug/path identity and saved-remote semantics. Draft PRs remain draft; opening one is not proof of live deployment.

## Timeout finding and required release decision

`publishing/jobs.ts` limits publish.entry to five minutes. `jobs/queue.ts:98` uses `Promise.race`, which rejects without cancelling the underlying operation. Eight AI calls with individual 180-second deadlines plus up to 40 network reads can exceed that outer limit and allow the old attempt to keep running after a retry is queued.

PM approved a narrow absolute 270-second attempt deadline, covering source discovery/planning and PR creation with margin below the existing five-minute job timeout. Pass the fresh deadline through an optional nonpersisted `ConnCtx.publishDeadlineAt` (GitHub only), assigned in `publishEntry` before payload construction; direct connector entry points may default to a new 270-second budget. Pass it to planner options, cap every AI and GitHub request timeout to remaining time, and guard every mutation, including tree/commit/ref/PR writes. A deadline failure carries local safe attribution. Late planning must never initiate a Git mutation after expiry. Do not persist a deadline in `RemoteDraft.extra`, which would poison later saved-draft retries, increase the outer timer, or race planning against an uncancelled promise and then permit late mutation. Avoid overlapping production retries and inspect running jobs before recovery. No queue-wide cancellation refactor is required.

Deadline exhaustion is a nonretryable local 422/config rejection, not a transient provider 503: save the actionable article failure immediately and permit explicit manual retry. Four automatic repetitions of a deterministic exhausted attempt budget would be expensive and delay diagnosis. Genuine transient network/provider failures retain existing retry behavior.

An HTTP abort cannot undo a GitHub write already accepted before the deadline; exact remote acceptance time is not under Radar's control. Preserve existing branch marker/PR reconciliation after uncertain outcomes. Invisible orphan trees/commits are acceptable, and visible branch/ref updates must be guarded and request-bounded. This is bounded execution, not an exactly-once guarantee or remote rollback. Existing saved draft retries get a fresh attempt deadline and can reuse a previously accepted complete branch/PR.

Inspection of `ai/index.ts` established that `retries: 0` still allows provider/model fallback, each reusing `input.timeoutMs`. PM approved a narrow race of the read-only AI call against the absolute attempt deadline, with timer cleanup, an immediate post-await deadline guard, and unchanged transport mutation guards. This ensures a local actionable failure is persisted before the outer queue timeout. An already-running provider may finish/log in the background, but its late result cannot resume planning or writes; no shared AI routing refactor is required. No subsequent planner call may start after expiry.

## Implementation order and validation

1. Agree optional diagnostic/error serialization and source-availability contracts, then implement transport metadata and planner handling.
2. Add precise validator/reviewer/repair diagnosis and persisted origin; update shared UI formatting and call sites.
3. Run focused meaningful regressions, independent QA, typecheck and production build on the integrated revision.
4. PM releases Radar through existing workflow, waits for worker/web revision parity, then retries the two articles one at a time.

Required scenarios: known oversized generated file is never fetched, notices enable authored-input/generator/build-chain discovery, exact source evidence still grounds success; absent-size oversized fallback behaves identically; mandatory oversized manual registry fails with path/bytes/limit and no Git mutation; repeated skips cannot evade read/round budgets; citing/editing skipped source rejects; auth/network/SHA/credential errors remain fatal; empty/file/edit/output rejections show distinct host counts; repair failure preserves original review issue and final cause without secrets; repaired plan receives fresh independent review within eight calls; local article/dashboard copy differs from remote GitHub rejection; atomic complete changes, retry identities and draft PR semantics remain unchanged. Deadline tests should prove no writes after planning expires.

Production verification: `e_2UQxRIMM` and `e_2Qcpo76u` each end with one reused-or-created draft PR, complete original article body, source-grounded route and public listing integration, correct branch/base and healthy connection. Inspect complete diffs and actual destination CI/build/preview evidence. Destination code must not execute on Radar. Record draft-PR creation separately from successful destination build/preview and from destination live publication; destination merge is outside scope. Persisted diagnostics require only safe summaries, not storing model traces.

Rollback: revert Radar code/release together, leaving JSONB optional additions readable by old clients. No destination merge or destructive cleanup is necessary; preserve valid article PR branches and saved remote identities for safe retry. Do not reset remote draft state to force another publish.

Primary platform checks: GitHub's [tree endpoint](https://docs.github.com/en/rest/git/trees?apiVersion=2022-11-28) returns blob size and supports base-tree atomic replacement semantics; the [contents endpoint](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28) supports commit-pinned `ref`, with larger files requiring different media types. Radar intentionally retains its stricter 100 KB source budget instead of downloading those larger files. Checked current primary documentation on 2026-11-10.

## Frozen implementation review

Architecture verdict: **approved**, no remaining material architecture/safety defect found in the frozen implementation. Read the complete relevant planner, transport, shared error types/helpers, publisher persistence and article/dashboard diffs. Skipped sources cannot become observed evidence or edit targets; only typed size failures are recoverable. Exact SHA, unique original-source edits, nonoverlap, body insertion, protected paths, whole-file guards, atomic complete commits, non-force refs, identity-bound retries and draft PR semantics remain intact. Existing arbitrary-framework support is preserved, without generated-filename assumptions.

The final error path preserves distinct host-counted failures, bounded sanitized reviewer issues and failed-repair origin. Redaction includes recognizable credential formats, environment secrets, URLs, fenced/inline source, and generic credential assignments (`token`, `key`, `pass`, `client_secret`, `private_key`). Local host validations carry Radar origin; remote HTTP errors retain their meaning. Optional JSONB fields remain backward compatible.

The shared 270-second nonpersisted attempt deadline reaches the draft and PR phases. The read-only AI race rejects deterministically with timer cleanup; late results cannot resume the planner. Each GitHub request checks remaining time and caps transport timeout, preventing subsequent tree/commit/ref/PR operations after expiry. The deadline is a nonretryable local 422 that is saved immediately. Already accepted remote writes cannot be undone by cancellation; existing branch/PR reconciliation remains required. Background read-only AI work may finish, and source review still does not prove a destination build/runtime/preview.

Reviewed source SHA-256 values, matching QA's captured source snapshot:

| Module | SHA-256 |
| --- | --- |
| `nextjs-agent.ts` | `0d50f99dac755f6d4bb1612819befb5c411605da7bc6af96ce1d3546e5b0f45f` |
| `nextjs.ts` | `b0badf2f93b0140808a0d518f81b277f254f0a9e5b6153a5363fb4393cf9ea9f` |
| `http.ts` | `1b0f93ef74fcab258fd1ceab0d2d5ff936e3d71e09c738b850cf4435113174ba` |
| `publisher.ts` | `767964ee4640da318fae1314e88513a6fa089449485973bdc5b12b369a5da13f` |

Inspected independent QA evidence: 17 independent planner/transport/persistence checks passed, plus browser artifacts. PM owns final Node 22 checks, production build, release and real article/CI/preview verification. This architecture approval authorizes no destination merge and makes no claim that either real article is live.
