# A6 — Connected YouTube data lifecycle

Status: implementation contract for PM approval; separate follow-up after A5 OAuth return hotfix. Architecture only: no production data was changed. Reviewed 2026-11-19 in `/Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push`, base `4d3a72b38d25b3b6343297b61af1732f0e59f136`, branch `kenny/youtube-oauth-return`. The working tree contains the authorized A5 changes and factory records; preserve them. This record owns no implementation files.

## Decision

Use existing Postgres jobs, JSON payloads, encrypted token metadata and minute maintenance. Add a provider-specific lifecycle helper, daily authorization/profile verification, and a database-only stale-data sweep. Keep YouTube channel metadata current while connected; delete old upload receipts rather than repeatedly reading every historic video. Local source videos, drafts, titles, descriptions and user-selected publishing settings belong to the owner and survive connection cleanup. Do not delete remote YouTube videos.

The current implementation is insufficient for a truthful lifecycle attestation: disconnect removes the account/tokens but leaves API-returned IDs, links and copied labels; revoked/expired accounts keep their encrypted grants; token maintenance is gated by the publishing flag; successful token refresh does not refresh profile data. A5 truthfully describes this existing behavior. Ship A5 independently, then implement this record before claiming these lifecycle requirements are implemented.

## Primary evidence and requirements

[YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies), III.D.3 and III.E.4: in-app revocation requires an immediate programmatic revoke and Authorized Data deletion within seven days; external revocation requires periodic token verification and deletion within thirty days. Other stored API Data must be refreshed or deleted within thirty days. The statistics exceptions do not apply to this upload feature. Historical display is not an exemption from revocation cleanup. III.E.4.g also covers deletion requests; III.A requires accurate disclosure and the Google revocation link. Returned identifiers and profile labels are API Data; calling them publication history does not exempt them.

[Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) documents POST `https://oauth2.googleapis.com/revoke`, access/refresh token revocation and possible effects on combined grants. Treat invalid grant separately from operator configuration and network errors. [channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list) supports authorized `mine=true` and costs one quota unit. Existing `youtube.upload` + `youtube.readonly` suffice; add no scopes.

Engineering safety margins below (daily checks, 28-day expiry and 24-hour revoke retry expiry) are Radar design decisions, not additional policy mandates. A worker outage is an incident, not grounds to promise an impossible availability guarantee.

## Actual storage and behavior

| Location | Actual data / behavior | Required treatment |
| --- | --- | --- |
| `social_accounts`, `publish/accounts.ts` | Channel ID/name/handle, encrypted access/refresh tokens, access expiry; `updatedAt` changes on refresh | Delete on revoke/delete; refresh profile separately; never infer profile freshness from updatedAt |
| `oauth_states`, `savePendingSocial` | Encrypted grant + channel identity in `social-pending:youtube`; user/business scoped | Existing one-hour maintenance TTL is adequate; delete same-business pending YouTube grants on cleanup so stale picker completion cannot reconnect |
| `social_pubs`, `publish/send.ts` | `remoteId`, `remoteUrl`, copied `acctLabel`, `payload.providerRef`, local processing clock, error detail | Short-lived receipts; scrub within 28 days and immediately on connection cleanup; block duplicate initialization afterward |
| `publish/schedule.ts` | Copies account label to every scheduled publication | Use generic `YouTube channel` for new YouTube pub rows; live channel label remains in the fresh account projection |
| `events`, `publish/send.ts:111` | `social.posted` currently duplicates remote ID and URL | Stop copying YouTube API receipts to events; remove the YouTube outcome event when scrubbing the associated receipt. Do not replace it with a permanent API-derived counter/hash |
| Act route / `events.summarize` | `action.social.connect` has `{input,result}`; nested `result.account` is dropped at depth two. Input contains local IDs/opaque OAuth ref | Existing summaries do not store the nested channel profile; add a regression to protect that boundary |
| `jobs` | `social.send` payload is local pub ID; result status/code. Finished job TTL is fourteen days | Keep lifecycle results count/enum/local-ID only. A revoke retry must not keep encrypted credentials until the generic job TTL |
| `publish/project.ts`, `workspace.ts`, packs | Publication state is projected from social_pubs at read, not stored in pack JSON. Client state is in-memory | Bump revision after scrub. Regression asserts fresh projection contains no expired name/link; defensive removal of legacy `posts.youtube.pub` only if found, without editing owner content |
| `deletion/index.ts` / `jobs/purge.ts` | Business soft-delete lasts seven days; purge later attempts revoke best effort | Hook YouTube cleanup at soft-delete/request time; do not wait for delayed/circuit-broken purge. Restore requires reconnecting YouTube |
| `accounts.tokensTick` | Active businesses only; skips expired accounts and `socialOn=false`; refreshes tokens once/day without profile refresh | Exclude YouTube from this old path after installing independent lifecycle jobs |
| Logs / failure alerts | send save failures currently print remote ID/URL; generic error details can be retained in alerts | For YouTube, log local pub/account IDs and sanitized provider reason/status only; no API IDs/profile labels/URLs/provider response bodies |

Lifecycle reminder snapshots use source content/local references; new YouTube API data must not enter those snapshots. Add a canary regression covering events/jobs/notifications/failure-alert snapshots, rather than introducing a broad lifecycle-mail rewrite. Public API-key YouTube recommendations in `services/drafting/youtube.ts` are a separate existing data path; this record does not claim that subsystem has been audited or that all public Google data is excluded from AI. Connected channel details and upload-processing responses are not required in generation prompts.

## Exact shared contracts (no SQL migration)

Extend encrypted `Tokens` in `publish/api.ts` with:

```ts
youtube?: { profileFetchedAt: number; authorizationCheckedAt: number };
```

Only successful `youtubeMe`/`channels.list` stamps both fields; a successful forced OAuth refresh may stamp authorizationCheckedAt but must not change profileFetchedAt. Preserve this object through `youtube.tokensFrom` and `ensureToken`; those paths currently reconstruct tokens. Missing timestamps conservatively use account createdAt, never refreshed updatedAt. Stub identities remain test-only and follow the same metadata shape without real API calls.

Extend publication payload JSON (type it in the existing payload definition) with local operational state:

```ts
youtubeRetention?: {
  scrubbedAt: number;
  reason: 'disconnect' | 'revoked' | 'delete' | 'cache_expired';
  noResend: boolean;
  needsApproval: boolean;
};
```

This contains no channel/video identifier, encoded URL, hash of provider data, receipt count or encrypted provider reference. `noResend=true` is permanent for that local sid if an upload was accepted or its outcome is uncertain. It prevents a second upload, including after reconnection, retry, schedule edit, Autopilot and process recovery. The owner can deliberately create a new post/sid if they choose to upload another copy. Unsent schedules have `noResend=false, needsApproval=true`: a reconnect alone cannot resurrect them; an explicit new user schedule/post action can clear needsApproval after normal validation. Autopilot cannot clear it.

Add `publish/youtubeRetention.ts` with internal contracts:

```ts
type CleanupReason = 'disconnect' | 'revoked' | 'delete' | 'cache_expired';
// q is the existing Drizzle transaction type; caller supplies a trusted business/account scope.
// No remote requests, secrets returned to clients, or cross-business matching inside this helper.
scrubYouTubeData(q, { bid, acctId?, reason, now }): Promise<{
  unscheduled: number; scrubbedPubs: number; revoke?: { tokenEnc: string; expiresAt: number }
}>;
verifyYouTubeAccount(acctId: string, now: Date): Promise<'fresh' | 'gone' | 'revoked' | 'retry'>;
expireYouTubeCaches(now: Date): Promise<{ accounts: number; receipts: number }>;
```

The returned revoke descriptor is internal only, encrypted with Radar's existing secret key, and never action/event output. Prefer enqueuing the encrypted retry in the same transaction using existing jobs storage, so commit cannot lose cleanup/revoke intent. No API-derived value in singleton keys, job refs or incident keys.

## Cleanup transaction and race handling

1. Existing Editor/owner authorization and business gating apply to a user action. Internal maintenance independently loads its account and derives business ID from the database; never accept a client-supplied provider ID as cleanup authority. Scope every pub/account/event update to the trusted business and `ch='youtube'`. This business currently permits one connected YouTube account; this includes old disconnected YouTube rows whose acct_id is already null.
2. Use business -> account -> publication lock order consistently with delete and sender guards. Stop/serialize the grant before remote revocation: select scoped account for update, capture one encrypted minimal revoke token, invalidate publication attempt keys and block new attempts, remove same-business pending YouTube authorizations, scrub API copies, and delete the account. Never hold these locks across a Google request. Reload guards remain necessary immediately before upload initialization.
3. Preserve local publication row ID, sid, owner content, local dates, and `posted` fact. This is an internal duplicate-prevention record, not a claim that a YouTube video remains live. Remove remoteId/remoteUrl, providerRef, copied label, raw provider error detail and receipt-derived event. Use generic `YouTube channel` label, local generic reason and local timestamps. Do not retain obfuscated API receipts in another table/counter.
4. For accepted/uncertain sending rows, set terminal failed/unknown + noResend=true before removing providerRef. For posted rows retain posted + noResend=true. For unsent schedules mark failed/approval-required and keep sid to prevent Autopilot recreating a deleted publication. Deleting all failed/scheduled rows, as disconnect does today, is insufficient for this new contract.
5. `claimManual`, `writeScheduled`, `claimScheduled`, `runSend`, `resumeProcessing`/`recoverStuck` and projection/UI must enforce the marker. Database WHERE/locked checks protect races; UI disabling alone is inadequate. Existing `mine(r)` attempt-key writes ensure a stale upload/status response cannot restore scrubbed data. Add the equivalent account/token version check to profile refresh: a late channels response cannot recreate a deleted/reconnected account. If network upload began before revoke it may complete remotely; local cleanup cannot retract bytes already sent and must never retry that uncertain operation.
6. Commit, bump workspace revision, then immediately attempt remote revoke with captured token. Network failure does not restore local data or make disconnect appear undone. Enqueue/retry revoke independently of publishing/billing flags; do not delete the user's remote video. Business restoration explicitly loses only the YouTube grant and queued YouTube authorization; owner drafts remain. Explain reconnect requirement in restore/disconnect copy.

A Google revoke can invalidate grants used in other Radar businesses or clients. Do not delete another tenant's data by channel ID or an arbitrary client hint. Each stored grant is force-verified daily, so affected grants are discovered and scrubbed promptly. Exact shared refresh-token equality may be recognized internally in memory for immediate invalidation, but is not needed for the bounded daily guarantee; do not persist a new global provider identity index.

## Scheduling, deadlines and quota

Register new global job definitions in the existing `publish/jobs.ts` (or side-effect-import a small `youtubeRetentionJobs.ts` there). Use `businessId:null`: the queue deliberately skips deleted/lapsed business jobs, whereas privacy cleanup must continue. Payload contains only local `{acctId}` or daily-walk `{day,cursor}`. Re-read the business inside the helper: deleted/missing business means local scrub, not an API profile refresh. Global jobs never publish.

The minute `social.tokens` hook first performs a bounded DB-only expiry batch and enqueues the daily walk; this happens before any social flag or active-business filter. No network requests under the cron advisory lock. Keep other platforms' existing tokensTick behavior unchanged and skip YouTube there to avoid double refresh.

Daily walk: enumerate YouTube accounts by local UUID keyset, ten per durable continuation; at most two accounts' network checks in parallel. Enqueue next cursor continuation, safely repeat current batch after crash. Use global singleton keys with local day/cursor and existing queued/running deduplication. If using once(), clear its mark when enqueue fails. Per request AbortSignal timeout <=15s; an account operation <=35s; a ten-account job <=180s plus explicit deadline checks. Queue timeout alone does not cancel network I/O. Daily selection includes expired accounts and businesses with publishing off/no subscription. Never reset freshness timestamps for unsuccessful checks. Operator metric reports oldest unchecked account age and sweep backlog; alerts start at 24h failed maintenance and escalate before day28.

For each active account, force-refresh its grant once/day and fetch `channels?part=snippet&mine=true&fields=items(id,snippet(title,customUrl))`. Confirm the stored channel still belongs to the grant; do not silently switch the connected channel. Update name/handle and the successful timestamps atomically only if account/token version is still current. One channel call per connected account/day, not one per historical upload. An identity mismatch, absent required scope or vanished channel stops publishing and scrubs that grant; fresh connection is required. Do not request channel statistics or enumerate uploaded videos.

Database-only cache sweep runs every minute, bounded batches (e.g.100 rows) with stable keyset selection and continuation until drained, independent of provider availability:

- Account profile/grant unverified for 28 days: fail closed, scrub connection and dependent receipts, require reconnect. This conservative expiry also covers indefinitely broken client configuration without retaining stale API data.
- Successful video receipt: scrub at postedAt +28 days; no refresh of old uploaded videos. Pending accepted reference: use payload.processingStartedAt +28 days; normal processing already has a far shorter timeout. Never use updatedAt or routine job execution to extend this deadline.
- Legacy missing timestamps use oldest trustworthy local createdAt/claimedAt/postedAt, not current time. Malformed timestamps fail closed.
- Event copies are scrubbed with their pub or independently by YouTube event createdAt+28days; generic historic pub labels are scrubbed even without an account row.
- Pending grants retain existing one-hour TTL. Revoke retry token TTL <=24h, never seven/fourteen-day finished-job retention. Delete encrypted payload on success, already-invalid token, expiry, permanent failure and terminal retry exhaustion. DB-only maintenance wipes abandoned expired retry payloads even if the worker crashes. Failed result/alerts contain enum + local ID only.

A public projection must suppress expired API labels/links immediately on read even if the worker is delayed, and show a reconnect/old-history explanation. This guards display; actual stored-data removal still depends on running the sweep. Runbooks must treat a prolonged sweep outage as a deletion incident.

## Error classification

| Result | Required behavior |
| --- | --- |
| OAuth refresh `invalid_grant`, confirmed revoked token, unusable expired grant | Commit account stop then idempotent scoped scrub; no refresh/reupload loop |
| One API 401 | Force-refresh once; success retries read, definitive refusal cleans up |
| `invalid_client` / client secret or API disabled / broad permissions configuration failure | Operator incident and publishing hold; never immediately label all users revoked or mass-delete on one deployment mistake; retry verification while enforcing hard 28-day expiry |
| 429 / quotaExceeded / timeout / DNS / 5xx | Transient retry with backoff; no success timestamp; do not mistake network failure for user revocation |
| Google revoke 200, or explicit already-invalid token | Success; wipe captured encrypted token |
| Revoke transient failure | Immediate attempt already made; bounded encrypted retry for <=24h; local data stays removed; terminal safe incident if provider unreachable |

`refreshError()` is currently shared and treats broad 400/401 cases as definitive. Add YouTube-specific structured classification without changing other provider behavior. `ensureToken` must not call a second cleanup transaction while holding its account lock: return a typed definitive outcome, commit, then invoke idempotent scrub and notify. Verification writes must compare the captured token generation/account update version before accepting remote results; conservative retries are fine.

## Implementation ownership and order

One engineer owns the lifecycle change after A5 ships; do not overlap E5 files before PM handoff.

1. `publish/api.ts`, `youtube.ts`, `accounts.ts`: metadata, structured refresh errors, timestamp-preserving refresh, successful profile check. Focused provider tests.
2. New `publish/youtubeRetention.ts` and tests; `publish/pubs.ts`, `send.ts`, `schedule.ts`, `src/lib/types.ts` and only relevant retry/schedule UI: scrub/tombstone semantics plus database claim guards. Stop receipt duplication in events/logs. Preserve existing main lifecycle hooks, deletion checks and autopilot controls.
3. `publish/jobs.ts` / optional new retention job module, `jobs/maintenance.ts`: global daily bounded checks, DB expiry and encrypted revoke retries. Existing jobs table and cron marks, no SQL migration or new infrastructure.
4. `actions/socialPublish.ts`, `deletion/index.ts`, `jobs/purge.ts`: YouTube-only call sites. Soft deletion calls pure scrub in its existing transaction, then immediate revoke after commit; purge remains safe/idempotent and preserves other providers' behavior. User account deletion/contact deletion procedure invokes the same trusted scoped helper, not a separate incomplete script.
5. Privacy page replaces A5 published-history API-data implication with implemented deadlines: connection/API-derived channel/upload details removed on disconnect, local owner drafts/minimal duplicate-prevention status may remain; stale API metadata refreshed/deleted within30days; external revocation checked daily; no remote video deletion. Generic business/account retention paragraph must explicitly identify YouTube's shorter <=7day deletion rule. Do not publish this promise ahead of deployment. Record scoped operational backup retention factually; do not invent immediate deletion guarantees for backups.

No production database cleanup is authorized by this architecture document itself. PM's deployment authorization governs the prospective application behavior. The previously measured zero YouTube accounts/publications was a point-in-time observation; the owner can connect after A5, so reread counts before rollout and test migration-free handling of new rows.

## Required verification and rollout

- Simulated daily check runs with social flag off, account expired, no billing access and deleted business; global job executes, never uploads, no dead enqueue mark on failure. Keyset continuation covers >batch size and restarts without starvation/paid duplication.
- Fixed-clock day27.99/day28/day30 boundaries for fresh profile, old profile despite daily token rotation, posted receipt, old disconnected label/event and accepted uncertain upload. Ensure no timestamp extension from retry/updatedAt.
- Definitive invalid_grant scrubs all scoped copies; invalid_client/429/5xx do not immediately purge healthy grants, but cannot bypass hard expiry. Missing metadata/malformed clock fails conservatively. Other businesses and X/LinkedIn/Instagram/TikTok rows unchanged.
- Disconnect during status GET and during upload completion: late callback cannot restore ID/link/profile; noResend rejects manual post, schedule upsert, auto-schedule and recovery. Reconnection cannot resurrect unknown accepted operation; owner video/draft/options still exist. Unsent operation requires explicit fresh approval.
- Revoke attempt immediately after commit; provider failure leaves no account token, durable encrypted retry expires/clears within24h including terminal/crash paths; generic finished job TTL cannot keep it alive. No credential/provider IDs in events, logs, notification snapshots or failure-alert payloads.
- Business delete/restore preserves drafts and other platform grants; YouTube reconnect required; purge remains idempotent. Contact/account deletion same helper. Existing exact business guard/transaction ordering remains green.
- Fresh workspace projection never exposes scrubbed name/handle/link; posted row shows only local history and no actionable stale API link. No provider identifier hidden in tombstone, result, JSON legacy projection, event or replacement counter.
- Engineer tests + independent DB/browser QA + Node22 build. Before rollout report aggregate counts only, oldest metadata age and pending legacy copies (no actual account identities). Deploy additive web/worker code together; verify new global jobs registered and run with publishing disabled in test. Read-only production evidence: age/count and sanitized success/retry counters; never print tokens.

Rollback must not restore scrubbed API data, remove noResend markers or re-enable an uncertain upload. A rollback to pre-A6 code ignores the new marker and is unsafe while these rows exist: disable YouTube publishing/connection narrowly or roll forward the guard fix. Do not turn off the privacy maintenance path when disabling ordinary publishing. Google OAuth verification and YouTube API upload audit are separate approvals; this work alone neither removes the unverified OAuth warning nor grants public-upload eligibility.
