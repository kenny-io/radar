# Radar failure alerts

Radar attempts an operational email to `kenny@thally.io` when a running action fails and nothing is left to retry it.
A failure that a retry or a fallback will still handle (`retrying: true`: a provider route with another route behind
it, a job attempt with attempts left, a publication that will be sent again) is logged as `[radar.failure]` and is not
emailed; if every retry and fallback then fails, the failure that ended the action is emailed once. Failures that
finish with partial success (a template instead of a generated image, a brief without one source) are still emailed.
Inside a background job attempt that has attempts left, alerts are held until the attempt ends. When the job finished
or failed for good they are emailed. When the job will be retried, the alert for the failure being retried (the thrown
error and its causes) is dropped, and an alert for a failure the attempt had worked around is still emailed. A report
made after the attempt has ended, for example by a handler that timed out and kept running, is emailed at once.
Reporting never replaces the existing result, user-safe error, retry or publishing safeguards. New alerts include a formatted
HTML email and a sectioned plain-text alternative. They contain UTC time, environment/service, operation, available
business/user/job/resource/request IDs,
provider/model/status/code, sanitized diagnostic cause and a suggested response. Customer prompts, action payloads,
email bodies and generated content are not added to the alert context.

## Configuration

On **both web and worker**:

- Set `RESEND_API_KEY` and `MAIL_FROM` to the existing verified production sender.
- `RADAR_FAILURE_ALERT_EMAIL` defaults to `kenny@thally.io`.
- `RADAR_FAILURE_ALERTS` defaults enabled under `NODE_ENV=production`. `on`/`1` enables explicitly; `off`/`0` disables.
  Development/test defaults disabled. `RADAR_DEV_STUBS=1` outside production always disables email alerts.
- Keep the worker running; it delivers queued retries. No new schema migration or external monitoring vendor is required.

Structured `[radar.failure]` logs are emitted even with email disabled. New alert diagnostics redact configured
secrets, credential assignments, authorization values, signed URL query/fragment values and known secret routes.
This does not retrospectively sanitize historical application logs or every pre-existing application log line.

## Covered operations

| Boundary | Failures observed |
| --- | --- |
| Requests and RPC actions | Unexpected exceptions and operational server errors, with authorized action/business/user correlation |
| Next.js Node request error hook | Render/route errors outside the standard request wrapper |
| Background jobs | The final failed attempt (earlier attempts are logged only), timeouts and unexpected bookkeeping/worker errors |
| Scheduler | Failed hook, database lock/tick and scheduler failures |
| AI writing/research | The call failing on every configured route: credits, auth, rate limits, downtime and invalid output. A route that fails before a successful retry or failover is logged only |
| Images | Every provider failing, template degradation, required-model unavailability and render/storage failure. A provider that fails before another one succeeds is logged only |
| Article and social publishing | Returned terminal failures, auth holds, uncertain send outcomes, confirmed sends whose local save fails. A send that is scheduled to be retried is logged only |
| Sandbox publisher (GitHub) | Every terminal sandbox, agent and publication-gate failure, through the article publishing row above; plus a switch that is on but unconfigured and a sandbox that could not be deleted. See "Sandbox publisher" below |
| Daily Brief | Failed source fetches, reply/post generation and rescans, including errors previously swallowed |
| AI visibility | An engine failing on its last configured route and saved failed/degraded collection outcomes. OpenRouter failing before the engine's official API answers is logged only |
| Autopilot | Failed stage/scheduling work; owner revocation, planned missing-connection handoffs and schedules refused for something only the owner can fix (`not_connected`, `expired`, `preflight`) remain expected states that go to the owner handoff. Any other refused schedule is reported |
| Other integrations | Keyword data, Search Console sync/properties, authority/link verification, connection tests and OAuth exchange failures, transactional mail and external token-revocation failures |

Invalid inputs, denied access, expired application sessions, user cancellations, unconfigured **optional** engines,
normal crawler misses and a measured missing backlink are expected states. They do not page the owner by themselves.
A configured external provider failing authentication is an incident. Source HTTP status is included where available;
not every existing provider adapter exposes a provider request ID.

## Sandbox publisher

GitHub publishing can run through a sandbox agent instead of the planner (`RADAR_PUBLISH_SANDBOX`; setup, rollout and
rollback are in `scripts/connectors/README.md`). Its failures use the existing publishing path: each one is a
`PublishError` with a diagnostic code, reported as `publishing.entry` with `provider: nextjs`, the HTTP status, the
attempt number and whether the queue will retry. A retried failure is logged only; the failure that ends the entry is
emailed once. The customer still sees the existing generic failure copy; codes and reasons are for operators.
Diagnostics are written by Radar, bounded and sanitized: positions, counts and paths, never article text, repository
source, URLs or credentials.

| Code | Meaning | Retried | First thing to check |
| --- | --- | --- | --- |
| `sandbox-unavailable` | Daytona create, upload, exec or download failed or timed out, or the runner scripts failed their checksum. A leftover sandbox that cannot be deleted is not this code: it is reported as a teardown (below) and the attempt goes on | yes (502) | Daytona status; the snapshot id; that the worker runs from the repository root |
| `sandbox-egress-unverified` | The sandbox could reach something other than the model proxy, or could not reach the proxy. Nothing from the repository was uploaded | yes (503) | The Daytona organization's tier (Tier 3 or higher); that the proxy's health route answers; the proxy URL |
| `analysis-unavailable` | The model provider or the proxy was unavailable during the agent run (5xx, 408, 429) | yes (502) | The provider's sentence in the reason, when there is one; `[model-proxy]` `call-failed` lines; provider status |
| `agent-failed` | The agent turn ended in an error that a retry would repeat: the provider refused the request (for example an Agent SDK too old for the model), turn limit, missing or invalid report | no | The bounded token in the reason, such as `AgentApiError:400`, and the provider's sentence after it; run the live smoke |
| `agent-budget` | The run reached its spend or call cap | no | `RADAR_PUBLISH_SANDBOX_MAX_USD`, `RADAR_PUBLISH_SANDBOX_MAX_CALLS`; the entry's `ai_calls` rows |
| `agent-declined` | The agent reported that it could not ground a complete integration; its sanitized reason follows | no | The repository: this describes the site, not the tool |
| `workspace-too-large` | The archive or its expansion is over a ceiling (150 MB compressed, 100,000 entries, 1 GB) | no | Repository size |
| `plan-empty` | The run changed nothing | no | |
| `protected-path`, `non-regular-file`, `changed-file-count`, `final-output-size`, `credential-detected`, `syntax-invalid`, `peer-content-changed`, `article-fidelity`, `identity-changed` | The publication gate refused the change before any Git write. `stage` is `validation`, or `repair` when the single repair turn also failed (`origin` then names the first refusal) | no | The reason and `issues` say which file, limit or article units |
| `snapshot-mismatch` | A file GitHub returned did not match the pinned commit, or on a retry GitHub did not say where the article branch left the default branch | no | Retry; the branch moved or GitHub served stale content |
| `publishing-deadline` | The attempt reached its 13.5 minute deadline | no (manual retry) | Duration in the run line below; repository size |

When the provider or the model proxy rejects a model request, the reason of `agent-failed` and `analysis-unavailable`
ends with "The provider said:" and the provider's own error type and message, for example
`The agent run ended with an error (AgentApiError:400) after 1 turns. The provider said: Claude Code 2.1.251 does not
support this model; version 2.1.280 or newer is required.` The runner copies that text only from the SDK's rendering
of an API error (never from model output or repository files), removes control characters, redacts the run capability
and anything shaped like one, and cuts it to 300 characters; the worker sanitizes it again like every other
diagnostic. Other agent failures (turn limit, a thrown SDK error, a missing report) carry the token alone.

Two gate reasons an operator will see after the QA-1 fixes:

- `peer-content-changed` for a new article names the file and counts removed and altered lines separately, for
  example `src/data/posts.json has 3 of its 172 existing lines removed and 1 altered; a new article may remove none
  (limit 0).` `actual` is the removed count and `limit` is 0; when only the altered count is over, `actual` is that
  count and `limit` is 6 (or 24 for the total across files). A line counts as altered only when the same line returns
  in place with one small edit (at most 24 characters and half of the line lost); anything else that is gone is removed.
- `article-fidelity` with "present but not word for word" lists the unit indexes (0-based, as in `article.json`) of
  paragraphs or list items that have other words or markup between the article's words. None is allowed.

And three after the QA-2 fixes:

- `article-fidelity` with "have words directly before or after them in their line, element or string" lists the
  paragraphs and list items whose own words are all there, in one run, with other words added beside them where the
  file keeps one piece of text (a Markdown line or paragraph, an HTML or JSX element, a string in a JavaScript,
  TypeScript or JSON file, a YAML scalar): "Do not" in front of a list item, a sentence after a paragraph. A heading
  with words added counts with the missing headings ("missing or do not stand alone, as written"). The same reason is
  given when the article sits somewhere that is not rendered text, such as a code comment beside code.
- `peer-content-changed` on a retry or migration says "existing lines on the default branch": the file is compared
  with the default-branch commit the article branch started from, not with the branch head. Lines an earlier attempt
  added are not counted. Altered lines are counted against that commit too, so retries cannot add up past the limit.
- A retry or migration on a branch that shares no history with the default branch is refused with `repository-invalid`
  before any sandbox run ("shares no history with the default branch"). Review or delete the article branch.

All of the gate reasons above are repairable: the agent gets one repair turn with the same sentence, and the entry
fails only if that turn is refused too (`stage: repair`).

A passed `article-fidelity` check can carry a disclosure instead: "not decided for N: only markup or line structure
Radar does not classify separates unit … from the text beside them". The units are word for word, but they are set off
from other text only by a component or custom element (`<Callout>`, `<my-note>`), or the file is of a type Radar has
no rules for (plain text, reStructuredText, TOML and the like), so words added next to them would not have been seen.
It is printed in the pull request; the reviewer should look at those units in the diff.

A retry that does not reuse the commit already on the article branch is not a failure and reports nothing: a sandbox
commit is reused only when its `Radar-Post` marker carries Radar's signature (keyed from `RADAR_SECRET_KEY`) and names
the tree of the commit at the branch head. Otherwise the run line below shows a second sandbox run for the entry, and
the pull request says either that the article was already complete on its branch or that a commit was added. Expect
this once per in-flight entry after `RADAR_SECRET_KEY` is rotated and for commits written before markers were signed.

Gate failures leave nothing behind: no tree, commit, ref or pull request is written. GitHub's own errors (401, 403,
404, 422, rate limits) keep their existing meaning and retry behavior.

Two operations are reported outside the entry's own failure:

- `publishing.sandbox.config` (`degraded: true`, grouped by incident key for five minutes): the switch selects the
  sandbox for a business but a variable is missing or invalid. The message lists variable names only. The attempt
  used the planner, so publishing continued; fix the worker's variables or turn the switch off.
- `publishing.sandbox.teardown` (code `sandbox-teardown-failed`, `provider: daytona`, `ref` = the entry): a sandbox was
  not deleted. The attempt's outcome is never changed by it. There are three messages:
  - "Sandbox `<id>` was not destroyed …": the attempt's own sandbox could not be deleted within 30 seconds.
  - "Sandboxes registered by this attempt's failed or timed-out create: N could not be deleted: `<id>` (state
    `<state>`; `<provider error>`) …", or "… could not be listed and deleted": the create call failed or timed out,
    Daytona had registered the sandbox anyway, and the attempt's lookup by its own run label could not remove it.
    Nothing from the repository or the article was uploaded to such a sandbox. The entry's own failure
    (`sandbox-unavailable`) is reported separately and retried.
  - "Sandboxes left by an earlier attempt for this entry: N could not be deleted: …", or "… could not be listed and
    deleted": the sweep at the start of an attempt found a leftover it could not delete (Daytona refuses while a
    sandbox is still `creating`, "Sandbox state change in progress"). The attempt went on: a leftover shares nothing
    with the new sandbox and its model capability expires with its own attempt.

  Each message names at most five sandboxes with their state and Daytona's error, and counts the rest. Daytona's
  30-minute TTL bounds every one of them, and the next attempt for the same entry tries to delete leftovers again. One
  alert needs no action. Repeated alerts mean the Daytona API is failing or sandboxes are stuck: list sandboxes
  labelled `workload=radar-publisher` in the organization and delete any older than 30 minutes, since those also count
  against its concurrency limit.

Each run logs one line on the worker, with no content:

```
[radar.publish.sandbox] {"entry":"e_…","sandbox":"<id or null>","ms":183420,"turns":41,"repaired":false,"destroyed":true,"outcome":"integrated"}
```

`outcome` is `integrated` or the diagnostic code; `destroyed: false` means a sandbox of this attempt was not deleted
(its own, or one a failed create left registered) and accompanies a teardown report. A leftover of an earlier attempt
that could not be deleted is reported but does not change `destroyed`. The `model-proxy`
service logs `[model-proxy]` lines with run, entry and business ids and a fixed word: `budget-exhausted` (`usd`,
`calls`, `token-counts`), `call-failed` (`status` with the upstream status, `timeout`, `unreachable`, `incomplete`,
`redirect`, `client`), `model-unpriced` (the configured model has no cache rates in `src/server/ai/prices.ts`, so its
budget cannot be enforced and every call is refused) and `provider-key-missing`. It reports `model-proxy.record` when a
call was answered but its `ai_calls` row could not be written, and `model-proxy.database` when the database is
unreachable at start. It never logs a capability, a key, a prompt or an answer, and it refuses to start, naming the
variable, if one of its four variables is missing.

Model usage and cost per call are in `ai_calls` under `purpose = 'github.integration.agent'`:

```sql
SELECT business_id, date_trunc('day', created_at) AS day, count(*) AS calls,
       round(sum(cost_usd)::numeric, 2) AS usd, count(*) FILTER (WHERE NOT ok) AS failed
FROM ai_calls
WHERE purpose = 'github.integration.agent'
GROUP BY 1, 2
ORDER BY 2 DESC, 4 DESC;
```

No transcript is kept in production. To see what a run did, replay the same pinned commit locally with the replay
harness (`scripts/connectors/README.md`).

## Delivery and recovery

Each alert creates an internal `observability.alert` job with an immutable sanitized envelope and null business ID,
then attempts delivery on the reporting process. Null business ID avoids tenant subscription/deletion suppressing
operational alerts. The job becomes `done` when Resend accepts the email; its result retains the Resend message ID when returned. This
does **not** confirm inbox receipt.
If the reporting process exits after persistence, a worker can still deliver the job. If persistence fails, Radar
still attempts direct email and logs the persistence failure.

The first queued retry is due after 30 seconds; subsequent retries back off to 15 minutes. Actual processing depends
on worker availability and queue load. Attempts use the same persisted sender, recipient, subject, text, optional
HTML and Resend
idempotency key. Previously queued text-only envelopes remain text-only on replay; HTML is never added to an
existing idempotency key. If the original sender was absent or a known local/example placeholder, Radar atomically binds
the corrected configured sender before the first provider attempt; concurrent retries use the winning payload. Automatic delivery stops when the alert is 23 hours old, within Resend's documented
[24-hour idempotency window](https://resend.com/changelog/idempotency-keys). Failed rows are retained by the existing
14-day housekeeping policy. Missing credentials or sender are failures, never a successful log-only delivery.
Delivery errors cannot create more alert jobs. Explicit incident keys group repeated worker infrastructure errors
in five-minute windows; distinct failed operations remain independent. Same error/cause seen by nested boundaries
within one action/job is reported once.

Inspect delivery state with an authorized database connection:

```sql
SELECT id, status, attempts, run_at, error, created_at, result,
       payload->'event'->'context'->>'operation' AS operation
FROM jobs
WHERE kind = 'observability.alert'
ORDER BY created_at DESC
LIMIT 50;
```

For a failed alert, inspect its sanitized envelope and Resend delivery record, fix the configuration/provider issue,
and replay only after considering whether the earlier request may already have been accepted. Do not blindly
requeue an alert beyond the 24-hour provider window. The send guard refuses envelopes older than 23 hours; a fresh
explicit operator notification is preferable for an expired incident. Valid senders and recipients are immutable within an
existing envelope, so changes to those values apply to newly created alerts. Initially absent/placeholder senders
can recover before their first provider attempt, and API key corrections apply at retry time.

## Release verification

1. Deploy the code to both services through the authorized release workflow. Confirm a running worker imports
   `observability.alert`.
2. Confirm both services have the verified email sender/key and production alerts enabled. Avoid deliberately
   breaking a live AI/provider integration to test monitoring.
3. Run `node --import tsx scripts/test-failure-alert.ts` in the intended configured runtime. It sends one clearly
   marked synthetic failure alert through the same persistence/delivery path and exits nonzero if Resend acceptance
   cannot be confirmed. This script loads the usual local environment files; nonproduction also requires
   `RADAR_FAILURE_ALERTS=on` and development stubs off.
4. Confirm the marked test email arrives at the configured recipient. Verify the corresponding job is `done` and
   inspect Resend's delivery/bounce record if receipt fails. Automated tests use mocked Resend and isolated local
   Postgres; they do not establish live inbox delivery.

These alerts require a running process and a functioning email/network route. Complete host/process outages,
network isolation and simultaneous database/email loss require an external uptime/heartbeat monitor. Use the
existing `/api/health` endpoint for external web readiness checks; it remains a database health check, without
email side effects on polling. External monitoring setup is separate from application failure capture.
