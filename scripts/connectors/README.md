# Local connector harness (DEV ONLY)

Real WordPress, real Ghost and a signature-checking webhook receiver on your machine, so Radar's WordPress, Ghost and
Webhook connectors can be exercised end to end, from the integration tests and from the app. Nothing here is used in
production. Credentials are generated when the scripts run and written to `.data/connectors/harness.env` (gitignored,
mode 600); nothing secret is committed.

| Piece | Script | Container / process | URL |
|---|---|---|---|
| WordPress 6.x + MariaDB 11 | `wordpress-up.sh` / `wordpress-down.sh` | `radar-conn-wp`, `radar-conn-wp-db` | http://localhost:8381 |
| Ghost 5.x (SQLite) | `ghost-up.sh` / `ghost-down.sh` | `radar-conn-ghost` | http://localhost:2381 |
| Webhook receiver (HTTPS, self-signed) | `webhook-up.sh` / `webhook-down.sh [--purge]` | `node webhook-receiver.mjs` (pid in `.data/connectors/webhook.pid`) | https://localhost:9381/hook |

Ports can be changed with `RADAR_WP_PORT`, `RADAR_GHOST_PORT` and `RADAR_HOOK_PORT`. All containers share the Docker network `radar-conn-net`.

## Start

```sh
scripts/connectors/wordpress-up.sh   # installs the site, admin "radar-admin", an Author "radar-author", pretty permalinks,
                                     # WP_ENVIRONMENT_TYPE=local (Application Passwords over http), fresh application passwords
scripts/connectors/ghost-up.sh       # owner setup via /authentication/setup/, then a "Radar" custom integration → Admin API key
scripts/connectors/webhook-up.sh     # self-signed cert for localhost + a test signing secret; receiver in the background
```

Each script is idempotent and prints what to paste into Radar's **Add connection** form. Re-running `wordpress-up.sh`
issues new application passwords (old ones keep working).

## Run the integration tests

```sh
set -a; source .data/connectors/harness.env; set +a     # also sets NODE_EXTRA_CA_CERTS for the receiver's certificate
npx vitest run src/server/services/publishing                        # connector suites (*.live.test.ts) + regression tests
DATABASE_URL=postgres://… npx vitest run src/server/services/publishing # adds publisher.live.test.ts (retry, refresh, 401, unreachable)
```

Each live suite is skipped when its `RADAR_IT_*` variables aren't set, so plain `npm test` is unaffected.
`NODE_EXTRA_CA_CERTS` is only read when Node starts: export it before running vitest or the dev server.

## Use the app against them

```sh
set -a; source .data/connectors/harness.env; set +a
export DATABASE_URL=… RADAR_DEV_STUBS=1 RADAR_ALLOW_PRIVATE_HOSTS=1 RADAR_REAL_CONNECTORS=wordpress,ghost,webhook PORT=3201 APP_URL=http://localhost:3201
npm run dev
```

Export everything in the shell: the worker (`tsx`) doesn't read `.env.local`, and it is the worker that publishes. If the
worker misses `RADAR_REAL_CONNECTORS`, **Test connection** is real but **Publish** is stubbed and "Published" points at a made-up URL.

Then Settings → Publishing → Add connection:

- **WordPress**: Site URL `http://localhost:8381`, Username `radar-admin` (or `radar-author`), the application password printed by `wordpress-up.sh`.
- **Ghost**: Site URL `http://localhost:2381`, the Admin API key printed by `ghost-up.sh`.
- **Webhook**: Endpoint `https://localhost:9381/hook`. Copy the signing secret Radar shows, then run
  `scripts/connectors/webhook-secret.sh whsec_…` so the receiver accepts it (it re-reads secrets on every request).
  Add `?status=500` (or any status) to the endpoint to drill failures and retries.

What arrived at the receiver: `.data/connectors/webhook-received.jsonl`, or `GET https://localhost:9381/__received`
(`?id={article id}` filters). Each row records the headers, the parsed body and whether the signature verified.
For `article.published` the receiver replies `{ "url": "https://localhost:9381/posts/{slug}" }` and serves that page, so **View post** works.

## Tear down

```sh
scripts/connectors/wordpress-down.sh
scripts/connectors/ghost-down.sh
scripts/connectors/webhook-down.sh --purge
```

The down scripts delete the containers with their data and remove their values from `harness.env`.

## GitHub post integration

Radar inspects the connected repository before preparing each article PR. **Content folder** is a discovery hint: the planner can follow source references elsewhere in the repository to identify the actual article format, renderer, route, blog listing/navigation and generator configuration. This applies to every repository layout; there is no special Next.js registry contract or automatic file-only fallback.

The planner reads an immutable Git snapshot and proposes small exact edits plus new files. The host validates observed source SHAs, unique replacements, change budgets, article-body insertion and protected paths. A separate source-based review checks the proposed content-to-route-to-listing chain. Unclear, ungrounded or unsafe plans stop before any branch/content changes. Destination code and model-proposed commands are never executed in Radar.

Discovery uses tree size metadata and keeps oversized files as unavailable notices, without downloading known blobs above 100,000 bytes or treating omitted/truncated content as inspected. The generic planner follows actual imports, authored inputs, generators and build ordering; a generated-looking filename alone does not justify skipping a required registry. Required sources that cannot fit the budget fail with the path, size and limit. Limits remain 40 attempted paths (including skips), six discovery rounds, 500,000 observed source bytes, eight reasoning calls and one correction followed by fresh independent source review.

Radar validation failures retain distinct empty-plan, file/edit/output-budget and source-review reasons, with bounded sanitized review issues and the original rejection when a correction fails. These local failures are labelled as Radar validation in the article and dashboard; real GitHub HTTP failures retain their remote meaning. No raw source, article or model response is persisted in failure diagnostics. A 270-second absolute attempt deadline bounds planning and GitHub requests below the worker timeout. Read-only model fallback may finish in the background after expiry, but its late result cannot resume planning or initiate writes. An expired attempt stops with an actionable manual-retry reason; accepted remote writes still reconcile through the existing branch/PR retry identity.

All accepted article and integration files enter one atomic Git tree/commit, followed by a non-force article-branch reference update. Retries recover the article identity from the final generated commit trailer, binding the entry, folder hint, chosen slug and article path. An unrelated branch or reviewer commit without that identity cannot be resumed automatically.

PRs open as **drafts**, with changed files, source evidence and static-review findings. Radar has not run the destination build or deployment preview; review the diff, let its CI/build checks run and confirm the article route, blog listing and navigation in a preview before marking the PR ready. A persisted older content-only draft is bound to its article branch and upgraded through the same complete repository planning/review before a PR can open; missing or mismatched records stop with a recovery error. Opening the review PR remains the connector's completion URL; it does not make the article live. Connection testing checks GitHub write permission; repository integration planning happens when preparing the article PR.

The writing-model/provider configuration used by article generation also powers repository reasoning. Planning failures retain retry/error reporting; they never fall back to standalone Markdown export. Local mock tests exercise host policies and transport behavior without model calls or GitHub mutations:

```sh
npx vitest run src/server/services/publishing/connectors/nextjs.test.ts src/server/services/publishing/connectors/nextjs-agent.test.ts
```

## Sandbox publisher for GitHub (behind a switch)

A second engine for the same job. Instead of the planner reading pasted source, an agent works on a full copy of the
pinned commit inside a disposable Daytona sandbox, Radar checks what it produced, and the existing transport above
makes the commit and the draft PR. Design: `.factory/sandbox-publisher/architecture.md`. Code:
`src/server/services/publishing/sandbox/` (control plane), `sandbox/publisher/` (the scripts that run in the sandbox),
`src/proxy/main.ts` (model proxy service). It is off unless `RADAR_PUBLISH_SANDBOX` turns it on, and with it off
nothing in this section runs.

One attempt, in order: delete any sandbox left by an earlier attempt for the entry; create a sandbox from the snapshot
whose only allowed network host is the model proxy; prove that from inside (proxy health answers, four canary hosts do
not) before any repository byte is uploaded; download the pinned commit archive with the GitHub token and upload the
bytes; run the agent with file tools only (Read, Write, Edit, Glob, Grep; no shell, nothing from the repository is
executed); download the changed files and run the publication gate on them; allow at most one repair turn; delete the
sandbox; only then write the tree, commit and ref. The sandbox never holds the GitHub token, the Daytona key, a provider
key, `DATABASE_URL` or `RADAR_SECRET_KEY`. Its one secret is a per-run model capability that expires with the attempt,
is capped in spend and calls, and is refused by the gate if it appears in any file.

### Configuration

Worker (`worker` service) only, unless a row says otherwise. Values are never logged; a missing or invalid one is
reported by name.

| Variable | Meaning |
|---|---|
| `RADAR_PUBLISH_SANDBOX` | The rollout switch, read on every attempt. Unset, empty or `off`: the planner (the default). `all`: every business. Otherwise a comma-separated list of business ids. `off` anywhere in the value wins. |
| `DAYTONA_API_KEY` | Daytona API key of an organization on Tier 3 or higher. Lower tiers cannot restrict sandbox egress, and the egress check then fails every attempt. Never on `web` or `model-proxy`. |
| `RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID` | The runner snapshot's UUID (not its name), from the build script below. |
| `RADAR_PUBLISH_MODEL_PROXY_URL` | `https://<model-proxy host>/model`. https, no credentials, query or fragment, path ending in `/model`. This host is the sandbox's entire network. |
| `RADAR_PUBLISH_CAPABILITY_SECRET` | HMAC secret for run capabilities, 32 characters or more. The same value on `worker` and `model-proxy`, and nowhere else. Not derived from `RADAR_SECRET_KEY`. |
| `RADAR_PUBLISH_SANDBOX_MODEL` | Optional. Catalogue id of an Anthropic model; default `claude-opus-5.5`. The proxy forces this model whatever the sandbox asks for. |
| `RADAR_PUBLISH_SANDBOX_MAX_USD` | Optional. Spend cap per run, default `6`. |
| `RADAR_PUBLISH_SANDBOX_MAX_CALLS` | Optional. Model-call cap per run, default `200`. |
| `RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR` | Optional, development and QA only: a local directory for the agent transcript of each run. Ignored when `NODE_ENV=production`. A transcript contains repository source; keep it out of shared storage. |

The `model-proxy` service needs exactly `RADAR_PUBLISH_CAPABILITY_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL` and
`PORT`, and warns at start if it also holds `RADAR_SECRET_KEY`, `DAYTONA_API_KEY` or `GITHUB_CLIENT_SECRET`.

No new variable is needed for retries: the worker signs each sandbox commit's marker (see "Retries and the commit
marker" below) with a key derived from its existing `RADAR_SECRET_KEY`, which it already needs to read the connection.
That key is used for the marker only and is never given to the sandbox, the model proxy or GitHub.

Switched on with something missing or invalid, publishing does not stop: the attempt uses the planner and reports
`publishing.sandbox.config` with the variable names (see `docs/OBSERVABILITY.md`).

Timing: a sandbox attempt has one absolute deadline of 13.5 minutes (270 seconds for the planner, unchanged), the
`publish.entry` job timeout is 16 minutes so the attempt's own deadline always ends the work first, and a sandbox is
created with a 30-minute hard TTL so one that outlives a killed worker still disappears. Each attempt first deletes
sandboxes an earlier attempt for the same entry left behind, and when its own create fails or times out it looks up
and deletes whatever that create registered under its run label; a sandbox that cannot be deleted is reported as
`publishing.sandbox.teardown` and never stops or fails the attempt (see `docs/OBSERVABILITY.md`). A sandbox attempt holds a
worker slot for its whole duration: raise `WORKER_CONCURRENCY` (default 4) before enabling it for more than a few
businesses. Worst-case model spend for one entry is the per-run cap times the job's attempts.

### Build and publish the runner snapshot

```sh
node scripts/operations/build-publisher-snapshot.mjs --dry-run                      # prints the plan; no key, no network
DAYTONA_API_KEY=… node scripts/operations/build-publisher-snapshot.mjs              # builds or reuses, prints the UUID on stdout
```

The image is `sandbox/publisher/Dockerfile`: Node 22, ripgrep, the pinned Claude Agent SDK and node-tar under an
unprivileged user. No git, no credential, no Radar code. The snapshot is named `radar-publisher-<12 hex>` from a digest
of the Dockerfile, `package.json` and `package-lock.json` in `sandbox/publisher`, so unchanged inputs reuse the
existing snapshot. Set the printed UUID as `RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID` on the worker and restart it. Build with
the key of the organization the worker will use: a snapshot belongs to one organization.

Rebuild when, and only when, one of those three files changes. The Agent SDK is installed in the image, so changing
its version means editing `sandbox/publisher/package.json` and `package-lock.json`, building a new snapshot (the new
digest gives it a new name and UUID) and setting the new UUID on the worker; a worker still pointing at the old UUID
keeps running the old SDK. The runner scripts (`run.mjs`, `prepare.mjs`, `probe.mjs`, `agent-environment.mjs`,
`write-scope.mjs`) are not in the image: every attempt uploads them from the worker's checkout and verifies their
checksums in the sandbox, so a prompt or runner fix ships with a normal worker deploy and needs no rebuild. The worker
must therefore be started from the repository root, where `sandbox/publisher/` is.

The pin is `@anthropic-ai/claude-agent-sdk` 0.3.312, exact, in `sandbox/publisher/package.json` (a test fails if the
manifest and lockfile disagree with it). The SDK version and the model are a pair: the provider refuses a model from
a client older than that model requires. On 12 Nov 2026 the earlier pin, 0.3.251 (which embeds Claude Code 2.1.251),
was refused for `claude-opus-5-5` with "version 2.1.280 or newer is required"; with 0.3.312 the live smoke and a replay
of a real repository were both accepted on that model. After changing the SDK version or the model, run the live
smoke below before enabling the switch. If the pair is wrong, every attempt fails as `agent-failed` and the reason
quotes the provider's sentence.

### Run and deploy the model proxy

```sh
npm run model-proxy            # tsx src/proxy/main.ts; needs the four variables above; exits non-zero and names what is missing
curl -s http://localhost:$PORT/model/health     # "ok"
```

In production it is its own Railway service (`model-proxy`) with its own public domain, configured by
`railway.model-proxy.json`: start command `npm run model-proxy`, health check `/model/health`, one replica. It must not
share a host with `web`: Daytona restricts sandbox egress by host name, not path, so a shared host would put every
public Radar route within a sandbox's reach. It serves `POST /model/v1/messages`, `POST /model/v1/messages/count_tokens`
and `GET /model/health`; everything else is 404. Each request must carry a valid run capability; the proxy forces the
capability's model, caps `max_tokens`, refuses provider-executed tools, stops a run at its spend or call cap with a
400 the SDK does not retry, and writes one `ai_calls` row per model call (`purpose = 'github.integration.agent'`). The
per-run budget is kept in memory, which is why there is exactly one replica: a restart mid-run lets that run spend up
to its cap once more.

Deploy order for a first rollout: deploy `model-proxy` and confirm its health route; set
`RADAR_PUBLISH_CAPABILITY_SECRET` on `worker` to the same value (a Railway reference to the proxy's variable keeps them
equal); build the snapshot; set the worker variables; leave `RADAR_PUBLISH_SANDBOX` unset; run the live probe and smoke
below against that configuration; then set the switch to a list of business ids.

### Rollout and rollback

Turn it on for chosen businesses with `RADAR_PUBLISH_SANDBOX=<business id>,<business id>` on the worker, then restart
the worker. `all` enables every GitHub connection.

Rollback is the switch: unset `RADAR_PUBLISH_SANDBOX` (or set it to `off`) on the worker and restart. Attempts already
running finish or hit their deadline, their sandboxes are deleted or expire by TTL, and there is no data to migrate in
either direction. Drafts keep working across the switch: a planner draft saved before it was turned on, and a sandbox
draft saved before it was turned off, still open their PR. A retry that finds its own sandbox commit on the article
branch for the same article reuses that commit, with the switch on or off, and never opens a second PR. A sandbox
failure is never retried on the planner inside the same attempt.

### Retries and the commit marker

The last line of a sandbox commit's message is its marker:
`Radar-Post: {"version":3,"entryId","hint","slug","articlePath","route","engine":"sandbox","body","tree","sig"}`.
`body` is a short hash of the article, `tree` is the SHA of the tree the commit was written with, and `sig` is an
HMAC-SHA256 over the entry id, hint, slug, article path, route, body hash and tree, keyed from `RADAR_SECRET_KEY`.

A retry reuses the commit, with no sandbox run and no new commit, only when all of these hold: the marker is for this
entry, folder hint and article; its signature verifies; and the tree of the commit at the branch head is the tree the
marker names. A commit trailer can be copied by anyone who can push to the repository, so a later commit that keeps
the trailer (its tree differs), a trailer with an edited field, and a signature Radar did not make are not reused.

A marker that is not reused is not an error. The retry runs the sandbox engine on the branch head with the earlier
slug and article path, exactly as for a planner (version 2) marker, and the gate checks the article file there and
whatever this attempt changes. For that, the connector asks GitHub where the article branch left the default branch
(`GET /repos/{repo}/compare/<default head>...<branch head>`, the merge base) and reads that commit's tree: the gate
treats what that commit holds as the existing content, protected exactly as on a first attempt, and treats everything
else on the branch as an earlier attempt's own work, which a retry may replace. So a retry after the article's title
or body changed can rewrite the record or listing line the first attempt added, and cannot drop or rewrite a peer. A
branch that shares no history with the default branch is refused before any sandbox run; review or delete that
branch (deleting the article branch always gives the next attempt a clean first run). The same applies to version 3 markers written before signing was added (they have no
`tree` or `sig`) and to every marker after `RADAR_SECRET_KEY` is rotated: one extra sandbox run, never a second branch
or PR. In production without `RADAR_SECRET_KEY` nothing is signed, so nothing is reused.

### What the pull request says

A sandbox PR keeps three kinds of statement apart.

- **Checks Radar ran**: run by Radar itself on the exact file contents it committed, all passed (a failed check stops
  before any commit). They are: article identity (slug, article path, route; a retry or refresh keeps them), protected
  paths (the same write rules as the planner: no CI, dependency manifests, lockfiles, auth or deployment files),
  regular files only (no link, submodule or special file), size and count limits (at most 16 files, 1 MB each),
  credential scan, syntax (JSON, JavaScript and TypeScript parse), existing content preserved (below), and article
  fidelity (every paragraph and list item present once, in order and word for word: a unit with a word added between
  the article's words is refused, as is one shortened or reworded, and one with words added directly before or after
  it; only format conversion is tolerated. See "Where a unit ends" below).
- **What the agent reported (not verified by Radar)**: the agent's own summary, the repository rules it says it
  followed and the deviations it declared. These are claims. If the agent writes that a build passed, that sentence
  appears here and nowhere else; it could not have run one. The text is printed so that GitHub renders no link or image
  from it: a Markdown link or image keeps its words and reads "(link removed)" or "(image removed)", an address
  (`scheme://`, `//host`, `www.`) reads "(address removed)", square brackets are escaped (a path such as
  `app/[slug]/page.tsx` still reads as written), and an @name, an issue reference or a commit hash is shown as code.
  The summary is printed up to 4,000 characters and each rule or deviation up to 400; a longer one is cut at a word
  boundary and ends with "… (truncated by Radar)". Every statement is one line that begins with Radar's own label
  (`Summary:`, `Rule 1:`, `Deviation 1:`). Markdown only starts a heading, quote, list or task item, table, code block,
  rule or HTML block at the beginning of a line or list item, so whatever the agent's text begins with (`#`, `>`,
  `[x]`, `-`, `1.`, three backticks) is printed as plain characters and cannot imitate one of Radar's sections.
- **Not run**: always the same list: dependency installation, repository build, lint, tests, deployment preview.
  Nothing from the repository is installed, built or executed, so `runtimeVerified` is false for every sandbox draft.

Existing content preserved, for a new article: in every existing file the change edits, no original line may be
removed, and at most 6 may be altered (24 across all files). A line is altered when the same line comes back in the
same place with one small edit: it shares a beginning and an end with the original, and what the original lost between
them is at most 24 characters and at most half of the line (a comma or bracket added, a name added to an import list,
a counter, date or flag changed). A line that is deleted, moved, re-indented beyond that, rewritten, or replaced by a
different record is removed, and the change is refused. The check prints both counts, and when any existing line was
altered it asks the reviewer to look at those lines. A refresh keeps its own tolerance (the article file may have its
body replaced; other files max(10, 1%) of their lines, 60 in all). On a retry or legacy migration the same rules
apply, measured against the default-branch commit the article branch started from (the check says so): lines an
earlier attempt added may be replaced freely, lines of the default branch may not.

This check bounds what can happen to existing text; it does not judge what added code does. An altered line may gain
any text (a record commented out with `//` is an altered line), and added lines are not examined (an added
`posts.splice(0, 30)`, or records wrapped in an added `/* */`, removes nothing the check can see). The pull request is
a draft for a person to review, and it states how many existing lines were altered.

Where a unit ends (article fidelity). A paragraph, list item or heading must stand alone in the piece of text that
carries it, or share it only with other whole units of the article. What one piece of text is depends on the file: in
Markdown and MDX, a paragraph (ended by a blank line), a list item or a heading line; in HTML and JSX, the text between
block-level tags (inline tags such as `<a>`, `<em>` and `<br>` do not end it); in JavaScript, TypeScript and JSON, one
string (strings joined with `+` or through `${}` are one string, and a string written as a JSX child belongs to its
element); in YAML, one scalar. Words added inside that piece of text, before or after the unit, are refused with the
unit's index. Two cases cannot be decided and are disclosed in the check instead ("not decided for N …"): a unit set
off from other text only by a component or custom element, and a file of a type Radar has no rules for.

It also lists **media and links not carried over** (image addresses, video ids, source and link addresses from the
article that Radar did not find in the changed files, usually because the site's content format has no place for them).
That is disclosed, not a failure; an article with no media or links at all says there was nothing to carry over. A PR
that continues an existing article branch says so, and a PR resumed from an interrupted attempt says that the earlier
attempt's details were not kept. As with the planner, the PR is a draft and
merging it is the reviewer's decision after the repository's own CI and preview.

### Tests

```sh
npx vitest run src/server/services/publishing/sandbox src/server/services/publishing/connectors/nextjs-sandbox.test.ts
```

These need no network: Daytona is an in-memory provider with a scripted runner, GitHub is a mocked tree, commit and ref
state machine, and the gate, capability and orchestration are real.

```sh
# What GitHub itself renders from the pull request body when the agent's text starts with block syntax or carries
# links. Read-only: it posts synthetic text to GitHub's Markdown rendering API through the GitHub CLI's sign-in and
# creates nothing. About 50 requests.
RADAR_IT_GITHUB_MARKDOWN=1 npx vitest run src/server/services/publishing/connectors/nextjs-sandbox-markdown.live.test.ts
```

Live tests use real sandboxes and are skipped unless asked for. Put the worker variables in a git-ignored `.env.local`
and load it into the test process; vitest does not read it for `process.env`.

```sh
# Probe: one sandbox, no model call, no repository content, about 15 seconds. Checks that the proxy health route is
# reachable and the canaries are not, that no worker secret is in the sandbox's environment, processes or files, that a
# capability does not outlive the exec it was given to, and that the sandbox is gone afterwards. Setup has its own
# time limit (a create can take longer than Vitest's 10 s default), and whatever a failed or timed-out setup leaves
# behind is deleted afterwards by handle and by this run's labels; anything it could not delete is printed by id.
RADAR_IT_SANDBOX_PROBE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/services/publishing/sandbox/probe.live.test.ts

# Smoke: one short agent run on a three-post synthetic repository. Proves the pinned Agent SDK drives the configured
# model through the proxy from inside the sandbox. Spends model budget (cents when it works). No GitHub access.
RADAR_IT_SANDBOX_SMOKE=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/services/publishing/sandbox/replay.live.test.ts

# Replay: pinned commits of real repositories. Each case is a full agent run and can cost up to the per-run cap.
mkdir -p .data/sandbox-publisher/articles
cp scripts/connectors/replay-manifest.example.json .data/sandbox-publisher/replay-manifest.json   # then edit it
RADAR_IT_REPLAY_MANIFEST=.data/sandbox-publisher/replay-manifest.json RADAR_IT_REPLAY_CASE=<case id> \
  node --env-file=.env.local node_modules/vitest/vitest.mjs run src/server/services/publishing/sandbox/replay.live.test.ts
```

A replay reads GitHub with `RADAR_IT_GITHUB_TOKEN`, or with `gh auth token` when that is unset; read access to the
repository is enough. It cannot write to Git: the harness only issues GET requests and calls the sandbox orchestration
directly, which has no Git transport. The manifest and its article files live under `.data/` (git-ignored); each case
names a repository, a full commit SHA, the content-folder hint, the mode, an article file (`title`, `slug`, `meta`,
`keyword`, `date`, `author`, `blocks` as Radar blocks: `["p", text]`, `["h2", text]`, `["h3", text]`,
`["ul", [items]]`), the business id the model usage is recorded under, and the expected outcome (`accepted`, or one
diagnostic code). Leave out `RADAR_IT_REPLAY_CASE` to run every case.

Each run writes a redacted record to `.data/sandbox-publisher/replays/<case>-<time>.json`: outcome code, failure stage
and reason, check details, changed paths with line counts, article unit counts, agent turns, model calls, token usage,
cost and duration, and whether the sandbox is still listed. It holds no article, repository or agent text. An accepted
run also writes `<case>-<time>.pr-body.md`, the PR body the connector would have opened.
`RADAR_IT_REPLAY_KEEP_FILES=1` additionally keeps the changed files and the agent transcript beside the record for
manual review; both contain repository source. The cost in a record is computed from the transcript at
`src/server/ai/prices.ts` rates; the proxy's `ai_calls` rows are the authoritative figure.

`nextjs.live.test.ts` (a real GitHub repository, real draft PRs) follows the switch: with `RADAR_PUBLISH_SANDBOX`
enabling the test business `00000000-0000-0000-0000-000000000000` (or `all`) and the worker variables set, its drafts
come from the sandbox engine.
