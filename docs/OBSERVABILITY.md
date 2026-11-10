# Radar failure alerts

Radar attempts an operational email to `kenny@thally.io` when a running action fails and nothing is left to retry it.
A failure that a retry or a fallback will still handle (`retrying: true`: a provider route with another route behind
it, a job attempt with attempts left, a publication that will be sent again) is logged as `[radar.failure]` and is not
emailed; if every retry and fallback then fails, the failure that ended the action is emailed once. Failures that
finish with partial success (a template instead of a generated image, a brief without one source) are still emailed.
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
| Daily Brief | Failed source fetches, reply/post generation and rescans, including errors previously swallowed |
| AI visibility | An engine failing on its last configured route and saved failed/degraded collection outcomes. OpenRouter failing before the engine's official API answers is logged only |
| Autopilot | Failed stage/scheduling work; owner revocation, planned missing-connection handoffs and schedules the publishing rules refuse (no account connected, expired, preflight) remain expected states that go to the owner handoff |
| Other integrations | Keyword data, Search Console sync/properties, authority/link verification, connection tests and OAuth exchange failures, transactional mail and external token-revocation failures |

Invalid inputs, denied access, expired application sessions, user cancellations, unconfigured **optional** engines,
normal crawler misses and a measured missing backlink are expected states. They do not page the owner by themselves.
A configured external provider failing authentication is an incident. Source HTTP status is included where available;
not every existing provider adapter exposes a provider request ID.

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
