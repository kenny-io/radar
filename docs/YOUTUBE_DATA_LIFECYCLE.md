# Connected YouTube data lifecycle

The connected upload feature uses the existing `youtube.upload` and `youtube.readonly` grants. It never deletes remote videos. This procedure covers the connected account/upload path; public API-key recommendations are a separate existing subsystem and are not covered by this review.

Disconnect, observed definitive revocation and business soft deletion remove the stored connected grant, channel profile and upload identifiers/links in a transaction. Local drafts, source media, user options and minimal local publication facts remain. An accepted/uncertain upload has a permanent identifier-free `noResend` marker; reconnecting, Autopilot or retry cannot upload the same sid again. Unsent drafts require a new explicit approval after reconnecting. Restoring a deleted business preserves drafts but requires reconnecting YouTube.

Global `youtube.verify`, `youtube.expire` and `youtube.revoke` jobs run independently of publishing flags, billing and deleted-business queue filters. The minute `social.tokens` hook first does bounded DB-only expiry and queues the daily walk. It never calls Google under the scheduler advisory lock. Daily jobs check ten accounts per keyset continuation, at most two in parallel; each provider request is abort-bounded, including body consumption. Only successful channel reads advance profile freshness. A forced token refresh preserves the previous profile clock.

A configuration failure pauses publishing without declaring every user's grant revoked. The persisted hold clears only after a successful grant and matching-channel check. Transient quota/network failures preserve data while retrying; immutable 28-day clocks still enforce expiry. Missing legacy metadata uses account creation time, so a newly connected unstamped account receives its first check rather than being deleted on rollout.

Channel metadata/grants and upload receipts expire after 28 days unless refreshed; old receipts are deleted rather than fetching every historical video. Fresh account data survives cleanup of an old receipt. Projection suppresses stale API links/labels immediately while actual deletion awaits the worker. Encrypted minimal revoke credentials survive only in a global retry payload for at most 24 hours; all normal terminal outcomes wipe the payload, and the DB sweep wipes expired or abandoned terminal payloads. Generic fourteen-day job retention does not extend that credential deadline.

## Contact deletion request

The operator must authenticate the requester's authority over the business through the established support process. Record the verified request/time and complete the following within seven days. Resolve the trusted **local** business UUID from internal account records; never use a caller-supplied YouTube channel/video ID as authority. Do not print provider data or credentials in the ticket.

Use the application's authenticated server environment and Node22. These commands do not publish content:

```sh
# Default dry run: validates the local business and returns row counts only.
node --import tsx scripts/operations/youtube-data.ts --business LOCAL_BUSINESS_UUID
# Same trusted helper as in-app disconnect and business deletion; explicit confirmation required.
node --import tsx scripts/operations/youtube-data.ts --business LOCAL_BUSINESS_UUID --apply --confirm LOCAL_BUSINESS_UUID
# Optional --account LOCAL_ACCOUNT_UUID must belong to this business and be a YouTube account.
```

The apply command commits scoped cleanup, immediately attempts Google revoke, and verifies account/pending/pub/event copies are absent. A transient remote revoke failure does not restore local data; a bounded encrypted retry remains queued. The output contains counts only. Keep the successful count-only result in the ticket, not an account/URL/token dump. For an already disconnected account use business scope so legacy disconnected receipts are included. Invalid UUIDs, foreign accounts, unknown arguments, missing/mismatched confirmation and nonexistent local businesses are rejected. No new public account-deletion endpoint is introduced.

## Monitoring and rollout

```sh
node --import tsx scripts/operations/youtube-data.ts --report
```

The trusted aggregate report includes account/unstamped/held counts, oldest unchecked age, API receipt/pending counts, maintenance backlog age and encrypted retry count. No provider identity or token is returned. Before rollout reread these counts: a real account was connected after the OAuth-return hotfix, so an earlier zero-account count is obsolete. Do not run an apply/cleanup operation against production merely to collect rollout evidence.

Deploy web and worker together. Verify the three global jobs register; confirm daily completion and DB sweeps while ordinary publishing is disabled in a synthetic environment. Warn when verification/backlog exceeds 24 hours; escalate before day28. A prolonged worker/sweep outage is a deletion incident: restore maintenance, verify aggregate backlog/age, process verified pending deletion requests and record the incident. Hard expiry prevents stale display but cannot physically erase a database while all workers are offline. Hosting/backup retention is an operational responsibility and is not attested by these live-database tests.

Rollback must not restore provider data or remove/ignore `noResend` markers. Rolling forward a guard fix is preferred. Pre-lifecycle application code is unsafe for these rows because it ignores the marker; do not roll back to it while YouTube uploads remain possible. Keep privacy maintenance running when ordinary publishing is disabled.

Google OAuth verification and YouTube upload audit are separate provider approvals. These checks neither remove Google's unverified-app warning nor grant public-upload eligibility.
