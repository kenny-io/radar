# Architecture: social channels (T1)

The record behind `brief.md` (AC-1 … AC-26, D1–D6). It was written against the worktree `software-factory-feature-5a68c1` at `5b644075`, on branch `kenny-dev/software-factory-feature-5a68c1`.

The shared contracts are already in the repo:
- `src/lib/types.ts`: social additions.
- `src/lib/socialPublish.ts`: pure rules, tested in `src/lib/socialPublish.test.ts`.
- `docs/CONTRACTS.md` § Social channels.

Neither engineer changes these without asking the PM.

## 1. Design in one page

- **Two new tables:**
  - `social_accounts` holds one row per channel per business, with encrypted tokens.
  - `social_pubs` holds one row per scheduled or sent item, keyed by the stable id `s:{packId}:{platform}` or `b:{day}:{itemId}`.
- **Projection on read.** Pubs are projected into the Workspace on read: `pack.posts[k].pub` and `item.pub`.
  - Pack jsonb and brief jsonb are never the source of truth for publishing state.
  - The one exception is a Brief item posted directly. It also persists `st:'posted'`, exactly like "I posted it".
- **Sending.**
  - A minute cron `social.publisher` enqueues job `social.send {pubId}` for due rows.
  - The job claims the row with a conditional `UPDATE … WHERE status='scheduled'`, which sets `sending` and a fresh `attempt_key`.
  - It then sends the latest text and images.
  - Retry state lives on the row, not in the queue (`maxAttempts: 1`).
  - **Post now** calls the same claim and send function inline.
- **Never twice.**
  - Only the final "create post" request is non-idempotent.
  - If that request has an unknown outcome (timeout, reset, 5xx after it was sent, or a crash), Radar never resends it automatically.
  - On X it reads the user's recent posts back. On LinkedIn it can't, so the row becomes `failed` with "couldn't confirm, check LinkedIn".
- **Flag.**
  - `RADAR_SOCIAL_PUBLISHING` is evaluated per business: `all`, business ids, or owner emails. It is off by default.
  - Off means no projection, no new UI, no sends, and auto is coerced to library.
- **No new runtime dependencies.** Image re-encoding uses `@napi-rs/canvas`, which is already installed. PKCE and AES use `node:crypto`, and HTTP uses `fetch`.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| A1 | Two tables: `social_accounts` and `social_pubs`. Pack and brief jsonb stay content-only | Sending needs row-level claims, indexes on `due_at`, and conditional updates, which jsonb can't give safely |
| A2 | The pub key is `(business_id, sid)` with a uuid primary key. `sid` is `s:{packId}:{platform}` or `b:{YYYY-MM-DD}:{itemId}` | Brief item ids are only unique per business-day and contain `:` (`x:<tweetId>`), so `parseSid` splits on the date |
| A3 | Brief `st:'scheduled'` is projected and never stored. A direct post stores `st:'posted'` | Flag-off and rollback show exactly today's state. Expiry and counts keep working, and "posted" is permanent |
| A4 | `held` is not a status. It is `status='scheduled'` plus an expired account, computed on read (`Pub.held`). Held posts are never locked | Reconnect simply releases them. A held post past its time can still be moved or unscheduled |
| A5 | A scheduled post more than 24 h late is never sent. It becomes `failed`/`stale` | After a long hold or a worker outage, a week-old post never goes out without the user |
| A6 | Retry and backoff state lives on the row (`retry_at`, `attempts`). `social.send` has `maxAttempts: 1` | The queue re-runs jobs on stale recovery and on shutdown. Every run must be idempotent from the row |
| A7 | Post now and Try again run synchronously inside the action, through the same `sendPub()`. A manual transient failure fails at once ("Try again later"), with no background retries | This matches the prototype: the spinner, then posted or a toast. The claim makes a double-click safe |
| A8 | Unknown outcome on X: read back `GET /2/users/:id/tweets` (needs `tweet.read`). Unknown outcome on LinkedIn: `failed`/`unknown`, never retried | LinkedIn member posts can't be read back (`r_member_social` is closed). Not posting twice beats posting at all |
| A9 | Add `tweet.read` to X scopes: `tweet.read tweet.write users.read media.write offline.access` | `POST /2/tweets` and `GET /2/users/me` require `tweet.read` (X docs). This differs from AC-19 and should be logged |
| A10 | Reconnecting as a different remote account is **refused**. X and the profile match on the remote user id (the profile app's `sub`). A page matches on its **organization URN**, and the reconnect re-verifies admin access. LinkedIn person ids differ per app | Held posts must go out as the account they were scheduled for. To switch accounts, the user disconnects first, which unschedules and is explicit |
| A11 | `expired=true` only in two cases: a refresh fails definitively (400 `invalid_grant`/`invalid_request` or 401), or a LinkedIn token with no usable refresh token reaches `expires_at`. It is never set on a 5xx or network error. `SocialAccount.expiresAt` is projected for LinkedIn accounts | AC-19 (as amended). The profile app has no refresh token, so its 60-day tokens need a reconnect. The page app's refresh token lasts 365 days from first consent |
| A12 | Refresh runs under `SELECT … FOR UPDATE` on the account row, re-reading after the lock. The new refresh token is always persisted | X refresh tokens rotate. Two workers refreshing at once would burn the token and wrongly set `expired` |
| A13 | **Two LinkedIn apps, two providers.** The profile app (OpenID Connect + Share on LinkedIn) uses `LINKEDIN_CLIENT_ID/SECRET`. The page app (Community Management only) uses `LINKEDIN_PAGE_CLIENT_ID/SECRET`. There is no fallback between them | Community Management must be the only product on its app. Also, a different scope set on the same app cancels earlier tokens for that member |
| A14 | Wall-clock `date`+`time` is the user's intent. `due_at` is derived and recomputed when the business time zone changes | "Times are in {zone}" means the zone setting governs |
| A15 | Time zone labels come from `Intl` for any zone (`tzLabel`). The rule is US generic, then alphabetic short, then en-GB alphabetic, then the offset | D1. Verified on Node 22.18 / ICU 77.1 (§13) |
| A16 | X **Reply now** always opens X's own prefilled reply box (`xReplyIntentUrl`) in a new tab, then the item continues to "I posted it". Radar never posts replies (see §14). | Self-serve X refuses API replies unless mentioned; AI-reply approval |
| A17 | The flag applies to businesses, not viewers (business id, or the owner's email) | All members see the same state, and the worker has no user |
| A18 | "This week" (replacing "Upcoming articles") is flag-gated, along with every other UI change | AC-23 says the UI must be "exactly as today" |
| A19 | Disconnect deletes the account row and its `scheduled` and `failed` pubs. `posted` pubs keep history (`acct_id → NULL` plus `acct_label`). `sending` pubs finish | History shows "As {account}" and View on X. A failed post can't be retried on a gone account |
| A20 | Every social action needs Editor, including connect and disconnect (same as `blog.saveConnection`). `social.pages` is a read with role Editor | AC-24 |
| A21 | Media meta (`bytes`, `type`) is recorded when Radar renders an image. Older posts are checked against the real file on the server and the meta backfilled | The UI preflight needs sizes without fetching files on every workspace load |
| A22 | Schedule window times run 6:00 AM to **10:00 PM** (33 slots) | AC-8. The prototype's loop also emits 10:30 PM. Log it if the owner prefers the prototype |
| A23 | Scheduling past a LinkedIn account's `expiresAt` is **allowed**. The post will be held, and the Schedule window shows `expiryNote()` as a warn `Status`, the same component it uses for "That time has passed" | The prototype has no copy for this. The note is new copy (divergence), but no new component |
| A24 | Each `social.posted` event carries `costUsd` (`publishCostUsd`): X $0.015 per post, $0.20 with a link, $0.01 per reply; LinkedIn $0 | X is pay-per-use. This shows spend per business without adding a table |

## 3. Data model (backend writes migration `0006_social_channels.sql` and `schema.ts`)

```sql
CREATE TABLE social_accounts (   -- expires_at is projected as SocialAccount.expiresAt for LinkedIn rows
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ch            text NOT NULL,                 -- 'x' | 'li_profile' | 'li_page'
  remote_id     text NOT NULL,                 -- X user id | LinkedIn person id (OIDC sub) | LinkedIn organization id
  name          text NOT NULL,                 -- display name / member name / page name
  handle        text,                          -- '@username' (X only)
  tokens_enc    text NOT NULL,                 -- encrypt({access_token, refresh_token?, expires_at, refresh_expires_at?, scope, stub?})
  expires_at    timestamptz,                   -- access token expiry (plain, for the refresh sweep)
  expired       boolean NOT NULL DEFAULT false,
  expired_at    timestamptz,
  connected_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_accounts_biz_ch_uq UNIQUE (business_id, ch)
);

CREATE TABLE social_pubs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sid           text NOT NULL,                 -- 's:{packId}:{platform}' | 'b:{day}:{itemId}'
  src           text NOT NULL,                 -- 'pack' | 'brief'
  platform      text NOT NULL,                 -- 'x' | 'linkedin' (pinned)
  kind          text NOT NULL DEFAULT 'post',  -- 'post' | 'reply'
  acct_id       uuid REFERENCES social_accounts(id) ON DELETE SET NULL,
  ch            text NOT NULL,                 -- channel at schedule/send time
  acct_label    text NOT NULL,                 -- acctLabel() snapshot, for history
  status        text NOT NULL,                 -- 'scheduled' | 'sending' | 'posted' | 'failed'
  date          date NOT NULL,                 -- wall clock in businesses.timezone (see Pub.date)
  time          text NOT NULL,                 -- 'HH:MM'
  due_at        timestamptz NOT NULL,          -- zonedTimeToUtc(date, time, tz)
  attempts      integer NOT NULL DEFAULT 0,    -- send attempts (scheduled sends; manual sends count too)
  attempt_key   uuid,                          -- fresh per claim; every write after the claim is conditional on it
  stage         text,                          -- 'media' | 'create' while sending (only 'create' failures are "unknown")
  claimed_at    timestamptz,
  retry_at      timestamptz,                   -- next attempt after a transient failure (scheduled sends only)
  payload       jsonb,                         -- snapshot at claim: { text, media: [{url, bytes, type}], replyTo? } (for verify)
  remote_id     text, remote_url text, posted_at timestamptz,
  err           text, err_code text,           -- user copy (errCopy) + PubErrCode; err_detail for logs only:
  err_detail    text,                          -- provider status/body excerpt, never shown, never in events
  auto          boolean NOT NULL DEFAULT false,-- scheduled by automatic generation
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_pubs_biz_sid_uq UNIQUE (business_id, sid)
);
CREATE INDEX social_pubs_due ON social_pubs (status, due_at);
CREATE INDEX social_pubs_acct ON social_pubs (acct_id, status);
```

- **One row per sid, for life.**
  - Unschedule deletes the row.
  - Retry or Post now on a `failed` row reuses it, with `status → sending`.
  - A `posted` row is final: Post now and Schedule refuse it with "This post is already live."
- **Pack or brief deleted.** When the pack or brief item no longer exists, the job finds nothing to send. The row becomes `failed`/`rejected` with `err_detail='content missing'` and is dropped from the projection.

## 4. Projection (`loadWorkspace`)

- **When the flag is off,** nothing below runs. `social.publishing=false`, there are no `accounts` or `channels`, and no `pub` fields.
- **When the flag is on,** the workspace adds `B.now = new Date().toISOString()`, `social.publishing=true`, `social.accounts`, and `social.channels`.
  - `channels` lists every channel when `RADAR_DEV_STUBS=1`. Otherwise it lists `x` if X creds exist, `li_profile` if LinkedIn creds exist, and `li_page` if page creds (or the fallback) exist.
- **Accounts → `SocialAccount`:** `{id, ch, name, handle, expired, expiresAt}`. `expiresAt` is the `expires_at` ISO time for `li_profile`, and the refresh-token end for `li_page`. It is null for X. Tokens are never projected.
- **Pubs → `Pub`:** `{ status, platform, date, time, dueAt, acct: acct_id, acctLabel, err, code, at: posted_at ms, url: remote_url, direct: src==='brief' || undefined, held }`.
  - `held = status==='scheduled' && account.expired`.
  - Load every pub of the business. They are few: one per post at most.
- **Pack posts:** `posts[k].pub = pubs[packSid(pack.id, k)] ?? null`. `imageMeta` and `compressed` come from the pack jsonb.
- **Brief items,** applied **after** the existing past-day `open/copied → expired` mapping:
  - If `pub.status ∈ {scheduled, sending}`, set `st='scheduled'`.
  - If `pub.status==='posted'`, `st` is already `'posted'` in jsonb. Keep it.
  - If `pub.status==='failed'`, keep the stored or mapped `st`, which stays live on today, so Post now and Copy work.
  - Set `item.pub = pub`.
- **`counts.briefOpen`** is computed after projection, so scheduled items drop out (AC-15).

## 5. Shared contracts already written (T1)

- **`src/lib/types.ts`:**
  - New types: `SocialChannel`, `SocialAccount`, `MediaMeta`, `PubStatus`, `PubErrCode`, `Pub`, `SocialPage`.
  - `SocialPost` gains `imageMeta?`, `compressed?` and `pub?`.
  - `SocialAuto` gains `post?: 'library'|'schedule'`.
  - `BriefItemState` gains `'scheduled'`. `BriefItem` gains `pub?`, and `BriefImages` gains `meta?`.
  - `Workspace` gains `now?`. `Workspace.social` gains `publishing?`, `accounts?` and `channels?`.
  - Everything is optional, so `npm run typecheck` passes on the unchanged code.
- **`src/lib/socialPublish.ts`.** It is the single source of the rules below. The server calls the same functions it gives the UI.

| Area | Exports |
|---|---|
| Channels and accounts | `SOC_CH`, `chOf`, `PLAT_L`, `canPost`, `canReply`, `accountsOf`, `accountsFor`, `acctLabel`, `pickAccount`, `briefAccount`, `briefPublish` |
| Ids | `packSid`, `briefSid`, `parseSid`, `SID_MAX` |
| Preflight | `LIMITS`, `MAX_IMAGE_BYTES`, `IMAGE_TYPES`, `LINKEDIN_MAX_PIXELS`, `charCount` (X weighted, URL = 23), `preflight`, `packPreflightInput`, `briefPreflightInput` |
| Time | `LOCK_MS`, `STALE_MS`, `MAX_AHEAD_DAYS`, `STAGGER`, `BRIEF_DEFAULT_TIME`, `TIME_SLOTS`, `HM_RE`, `DATE_RE`, `zonedTimeToUtc`, `localParts`, `dueAtIso`, `isPastSlot`, `dayOptions`, `defaultSlot`, `minsUntil`, `isLocked`, `moveCheck` |
| Labels | `tzLabel`, `atTz`, `tzNote`, `shortTime` |
| Copy | `COPY`, `errCopy`, `failedLine` |
| X | `xStatusId`, `mentions`, `xReplyAllowed`, `xReplyMode`, `xReplyIntentUrl` |
| Cost and expiry | `X_COST_USD`, `publishCostUsd`, `expiresBefore`, `expiryNote` |
| Send helpers | `liCommentary` (escapes LinkedIn little-text characters), `normForMatch` (X read-back) |
| UI derivations | `packPanelState`, `showScheduleAll`, `scheduleAllWhy`, `socialItems`, `scheduledCount` |

The helpers never read the clock. Callers pass `nowMs`:
- **Client:** `Date.now()`, optionally corrected by `Date.parse(B.now)` at load.
- **Server:** `Date.now()`.

## 6. Actions (new file `src/server/actions/socialPublish.ts`, registered in `actions/index.ts`)

Common zod: `Sid = z.string().min(3).max(160)`, `AcctId = z.string().uuid()`, `Day = z.string().regex(DATE_RE)`, `HM = z.string().regex(HM_RE)`, `Ch = z.enum(['x','li_profile','li_page'])`.

The rules below apply to every action in the table:
- **Flag.** When the flag is off, throw `RadarError(COPY.notEnabled, 404, 'not_enabled')`.
- **Role.** The role comes from the action definition: Editor, because writes default to it. Viewers get `forbidden()` from the route.
- **Ownership.** The `sid` must resolve to an existing pack and platform, or brief day and item, in **this** business. Otherwise `notFound('Post')`.
- **Copy.** Errors are `RadarError` with the copy shown (Radar voice, no provider internals).

| Action | Input | Returns | Server rules and errors |
|---|---|---|---|
| `social.pages` (read, role Editor) | `{ oauthRef: string≤100 }` | `{ pages: SocialPage[] }` or `{ pages: [], error }` | Pending authorization for `linkedin_page`. If it's missing, `error: 'The sign-in expired. Try again.'`. An empty list means the user manages no pages (UI copy in §17) |
| `social.connect` | `{ ch: Ch, oauthRef: string≤100, pageId?: string≤40 }` | `{ account: SocialAccount, reconnected: boolean, released: number }` | **Pending:** the authorization for `chOf(ch).provider` must exist, else `'The sign-in expired. Try again.'`.<br>**`li_page`, first connect:** `pageId` is required and must be in the user's admin list (re-checked).<br>**Reconnect** (a row exists for `ch`): `remote_id` must match. That is the X user id for `x`, the profile app's `sub` for `li_profile`, and the **organization URN** for `li_page`. For a page, the connecting member's person id is ignored, because it differs per app. On a mismatch, else `` `You signed in as ${newLabel}. Sign in as ${oldLabel} to keep its scheduled posts, or disconnect it first.` ``. A page must still be administered, else `` `Your LinkedIn account doesn’t manage ${name} anymore. Sign in with one that does, or disconnect the page.` ``. The id is kept, `expired=false`, and the tokens and name are updated.<br>**`released`:** the scheduled pubs of that account due within `STALE_MS`.<br>Deletes the pending authorization |
| `social.disconnect` | `{ acctId }` | `{ ch, unscheduled: number }` | Revokes the token (best effort), deletes the account and its `scheduled`/`failed` pubs, and keeps `posted`. `unscheduled` counts the scheduled ones. UI toast: prototype copy |
| `social.postNow` | `{ sid, acctId?: AcctId }` | `{ pub: Pub }` (`posted` or `failed`; a failed send is not an error) | **Account:** pack → `acctId` or `pickAccount`, which must belong to that platform. Brief → `briefAccount` routing (`acctId` ignored).<br>**Refusals:**<br>• not connected → `COPY.notConnected(ch)`; expired → `COPY.expired(ch)`<br>• posted → `COPY.alreadyPosted`; sending or locked → `COPY.sending`<br>• first preflight problem → its `msg`<br>• brief item not on today's brief and not already scheduled or failed → `'Past briefs are read-only.'`<br>• brief reply not allowed (`xReplyAllowed`) → `COPY.replyNotAllowed`<br>**Send:** claims the row (upsert, see §9.2) and sends inline. A transient failure becomes `failed` with `errCopy` at once |
| `social.schedule` | `{ sid, date: Day, time: HM, acctId?: AcctId }` | `{ pub }` | **Refusals:**<br>• same account, connection and preflight rules as `postNow`, but an **expired account is refused** too<br>• `date < today` → `COPY.pastDay`; `dueAt ≤ now` → `COPY.pastTime`<br>• `date > today+365` → `COPY.tooFar`<br>• existing row locked → `COPY.lockedMove`; posted → `COPY.alreadyPosted`<br>• brief reply → `'Replies go out with Reply now only.'`<br>• new brief schedule from a past day → `'Past briefs are read-only.'`; rescheduling is always allowed<br>**Write:** upserts `status='scheduled'`, resets `attempts`, `err` and `retry_at`, snapshots `acct_label`. Event `social.scheduled` or `social.rescheduled` |
| `social.move` | `{ sid, date: Day }` | `{ pub }` | Drag: keeps the stored `time`. Runs `moveCheck(pub, date, today, tz, now)`: `'same'` is a no-op, and any other refusal string is thrown as is. Event `social.rescheduled` |
| `social.unschedule` | `{ sid }` | `{ ok: true }` | `status==='scheduled'` and not locked (held is allowed), else `COPY.notScheduled` / `COPY.lockedMove`. Deletes the row. Event `social.unscheduled` |
| `social.scheduleAll` | `{ packId: string≤64, date: Day, rows: { platform: 'x'\|'linkedin', time: HM, acctId: AcctId }[] (1..2) }` | `{ scheduled: number }` | All or nothing, in one transaction. Each row follows the `social.schedule` rules. If any row fails, throw `` `${PLAT_L[k]}: ${reason}` `` |
| `social.compress` | `{ sid }` | `{ compressed: number }` | Lock rule (`COPY.lockedEdit`). Re-encodes each image that is over 5 MB or in a format the platform doesn't accept (§10), stores the new files and meta, and sets `compressed: true` (pack post). Returns the number of files changed |
| `social.devSimulate` (only `RADAR_DEV_STUBS=1`, else `'Unknown action'` 404) | `{ acctId, what: 'expire' \| 'lapse' }` | `{ ok: true }` | `'expire'`: marks the stub tokens `refreshFails` with `expires_at` in the past, then runs the real refresh path, so the account becomes `expired`. `'lapse'` (LinkedIn): sets `expires_at` to now + 2 min with no refresh token, so the `social.tokens` path expires it with no refresh attempt, and Schedule shows `expiryNote` meanwhile |

**Changed existing actions.** The backend owns all of these.

| Action | Change |
|---|---|
| `social.auto` | Input gains `post: z.enum(['library','schedule']).optional()`. Today zod strips it, so it must be added. If `on && post==='schedule'` with no non-expired account, throw `COPY.noAccountForAuto`. With the flag off, store `'library'` |
| `social.text`, `social.regenText`, `social.regenImage`, `social.style` | If the pub for `packSid(packId, platform)` is locked, throw `RadarError(COPY.lockedEdit, 409, 'locked')`. Then record `imageMeta` on every render (§10) |
| `brief.item` | Pub `scheduled`/`sending`: refuse `st` and `pl` changes with `COPY.unscheduleFirst`. Locked: also refuse `edit` and `mention` with `COPY.lockedEdit` |
| `brief.rewrite`, `brief.visuals` | Refuse when locked (`COPY.lockedEdit`). `brief.visuals` also refuses while scheduled, because image changes would alter a scheduled post. `brief.visuals` and its job record `meta[i]` |
| `blog.schedule`, `blog.setMode`, `blog.saveConnection` (when `tz` changes) | `retimePubs(bid, tz)`: recompute `due_at` for every `scheduled` row from its `date`+`time` |

**Direct Brief posts.** When a brief pub becomes `posted`, the sender also runs `withDay` to set `st='posted'`. It then fires the existing `brief.post_posted` or `brief.reply_posted` event with `direct: true`, so impact metrics keep counting.

## 7. OAuth

**Provider names** (`defineOAuth`, role `Editor`; redirect `${APP_URL}/api/oauth/{name}/callback`):

| Provider | Channel | Authorize | Scopes |
|---|---|---|---|
| `x` | `x` | `https://x.com/i/oauth2/authorize` (PKCE S256) | `tweet.read tweet.write users.read media.write offline.access` |
| `linkedin` | `li_profile` | `https://www.linkedin.com/oauth/v2/authorization` | `openid profile w_member_social` |
| `linkedin_page` | `li_page` | same (page app's client id) | `w_organization_social rw_organization_admin r_basicprofile` |

- **Start** (`/api/oauth/{p}/start?bid=…&reconnect=1`):
  - X generates `verifier = randomToken(48)` and `challenge = base64url(sha256(verifier))`. It stores `{ v: encrypt(verifier) }` in the state row's data.
  - The other providers need nothing extra.
  - With dev stubs, start redirects straight to the callback with `code=stub-code`, as the blog connectors do.
- **Callback:**
  1. Re-check `requireRole(bid, user, 'Editor')`.
  2. Exchange the code:
     - X: `POST https://api.x.com/2/oauth2/token` with an HTTP Basic header (client id:secret; `client_secret_post` is rejected) and `code_verifier`. Do it **at once** in the callback, because X codes expire in 30 s.
     - LinkedIn: `POST https://www.linkedin.com/oauth/v2/accessToken`.
  3. Fetch the identity:
     - X: `GET https://api.x.com/2/users/me`, giving id, name and username.
     - Profile: `GET https://api.linkedin.com/v2/userinfo`, giving `sub` and name.
     - Page: `GET https://api.linkedin.com/v2/me` (`r_basicprofile`) for the connecting member's name and id (logs only). The page itself is chosen in `social.pages`/`social.connect`.
  4. Save a **pending authorization** in `oauth_states` (`provider = 'social-pending:' + ch`, `data.enc = encrypt({tokens, remoteId, name, handle})`, 1-hour TTL, pruned by the existing maintenance job).
  5. Return `{ ok: true, result: { oauthRef, ch } }`.
  - If the user cancels or denies, `?error=…` comes back from the existing route as `{ ok:false }`, the UI shows readable copy, and nothing is stored.
- **Client finish** (`ConnectSocial`):
  - Call `openOAuth(provider, bid, reconnect ? { reconnect: '1' } : {})`.
  - **X or profile:** call `act('social.connect', { ch, oauthRef })`.
  - **Page, first time:** call `act('social.pages', { oauthRef })`, show the picker, then `act('social.connect', { ch: 'li_page', oauthRef, pageId })`.
  - **Page, reconnect:** skip the picker, as the prototype does.
  - **Popup result errors:** `closed`, `blocked` or `denied` all mean nothing was connected. Show `` `${X|LinkedIn} didn’t respond. Nothing changed — try again.` `` for provider or exchange errors. For `closed`, return quietly to the intro.
- **Pages:**
  - `GET /rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`. The org URN is in `organization` or `organizationTarget`.
  - The page name comes from `GET /rest/organizations/{id}` (`localizedName`), **one call per page**: the Development tier forbids batch gets.
  - Development tier limits are 500 calls per app per day and 100 per member per day, so don't poll.
  - The follower count is best effort: `GET /rest/networkSizes/urn:li:organization:{id}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, with `null` on any error.
  - Headers: `LinkedIn-Version: ${LINKEDIN_API_VERSION||'202610'}` and `X-Restli-Protocol-Version: 2.0.0`.
- **Token refresh** (`ensureToken(acctId)`):
  - **When it runs.** Before every API call, if `expires_at − 5 min < now`. Also in the daily cron `social.tokens`, once per account per day via `once('social.tokens:{acct}:{date}')`, for every non-expired account with a refresh token. That keeps X refresh tokens alive and catches revoked apps before send time.
  - **Locking.** One transaction: `SELECT … FROM social_accounts WHERE id=$1 FOR UPDATE`, re-read, and return at once if another process already refreshed (`expires_at` is fresh). The web process (Post now) and the worker share this Postgres row lock.
  - **Success.** In the **same transaction**, write the new access token, the new refresh token (X refresh tokens are single-use and rotate, lasting about 6 months) and `expires_at`. A race can never mark an account expired.
  - **LinkedIn profile.** There is no refresh token. `social.tokens` marks the account `expired` when `expires_at ≤ now`, emitting `social.expired`. The page app refreshes with its 365-day refresh token, and once that is past, the account is `expired` too.
  - **Definitive failure.** A 400 `invalid_grant`/`invalid_request`, a 401, or an expired token with no refresh token sets `expired=true` and `expired_at`. It also emits `social.expired {held}`, which counts the account's scheduled pubs.
  - **Transient failure.** A 5xx or network error throws a transient error. The send is retried, and the account is not marked.
  - **401 from a post call.** Run one forced refresh. If it fails, the account is expired and the pub goes back to `scheduled` (now held). If it succeeds and the call 401s again, the pub is `failed`/`auth`.
- **Env:**
  - `X_CLIENT_ID`, `X_CLIENT_SECRET`.
  - `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
  - `LINKEDIN_PAGE_CLIENT_ID`, `LINKEDIN_PAGE_CLIENT_SECRET` (the separate page app; no fallback).
  - `LINKEDIN_API_VERSION` (default `202610`).
  - `RADAR_SOCIAL_PUBLISHING`.
  - `X_BEARER_TOKEN` stays the Brief's search token and is never used for posting. One X app can serve both jobs.
  - **Local X testing.** X wants `http://127.0.0.1` callbacks, not `localhost`. Run with `APP_URL=http://127.0.0.1:3000` (`oauthRedirect()` builds from it), and use a separate "Radar Dev" X app.
- **Dev stubs** (`RADAR_DEV_STUBS=1`, no network):
  - **Identities:**
    - X: `@{slug(business name)}app`, named after the business.
    - Profile: the signed-in user's name.
    - Pages: `[{ id:'stub-pg1', name: business name, followers: 1204 }, { id:'stub-pg2', name: `${user name} Studio`, followers: 312 }]`.
  - **Publish:** returns `https://x.com/{handle}/status/{Date.now()}` or `https://www.linkedin.com/feed/update/urn:li:share:{Date.now()}/`.
  - **Text markers** (stub adapter only) decide the outcome:

    | Marker | Outcome |
    |---|---|
    | `[[radar:reject]]` | `rejected` |
    | `[[radar:ratelimit]]` | 429 → `rate_limit` |
    | `[[radar:down]]` | unavailable before send (transient) |
    | `[[radar:timeout]]` | unknown outcome at the create stage (X verify finds nothing, giving `unknown`) |

  - **Expiry:** `social.devSimulate {what:'expire'}` covers a failed refresh. `{what:'lapse'}` covers the LinkedIn 60-day path. Stub LinkedIn profile accounts are created with `expires_at = now + 60 days` and no refresh token, like the real app.
  - **Dev seed:** `scripts/dev-seed.ts` connects the three stub accounts (the X one non-expired) only when the flag is on for the seed business.

## 8. Feature flag

- **`RADAR_SOCIAL_PUBLISHING`:**
  - Empty, unset or `off`: off everywhere.
  - `all`: on everywhere.
  - Otherwise, a comma-separated list. Each entry is a business id (uuid) or an email, which matches the business owner's `users.email`, case-insensitive.
- **Where it's evaluated:** `src/server/flags.ts` → `socialPublishing(b: { id: string; ownerEmail: string })`.
  - Used by `loadWorkspace`, every action in §6, the OAuth start route (providers refuse with `COPY.notEnabled`), `social.publisher`, `social.tokens` and `autoRun`.
  - The scheduler joins `businesses.owner_id → users.email`.
- **What the UI hides when `!B.social.publishing`:**
  - The Settings → Social accounts section.
  - `PublishBox`. PackView keeps today's Copy / Download block and copy.
  - **Schedule all.**
  - Calendar chips and drag, and the phone agenda social rows.
  - **This week.** Today's "Upcoming articles" and "Awaiting review" grid stays.
  - The new Needs attention items.
  - Brief Post now / Reply now / Schedule, the Connect hint, the scheduled line, and "Posted to {Platform}".
  - The AutoModal "When a pack is ready" field and its copy.
  - The Social Marketing subtitle and status-row changes, and the "Connect X or LinkedIn" link.
  - Pack thumbnail "· N scheduled".
  - The weighted X counter. Today's `{len}/280` stays.
- **Rollback.** Turning the flag off stops all sends at once: the scheduler skips the business. Pubs stay in the database. Turning it back on resumes them, and the 24-hour stale rule fails anything too late.

## 9. Sending

### 9.1 Cron and job
- **`defineCron('social.publisher')`** runs every minute and does three things:
  1. **Due rows.** Rows with `status='scheduled' AND due_at<=now AND (retry_at IS NULL OR retry_at<=now)` whose business is active and flagged, and whose account exists and isn't expired:
     - if `now − due_at > STALE_MS`, the row becomes `failed`/`stale` (`errCopy('stale')`), with event `social.failed`;
     - otherwise, `enqueue('social.send', { pubId }, { businessId, ref: sid, singletonKey: 'social.send:' + pubId, maxAttempts: 1 })`.
  2. **Stuck sends.** Rows with `status='sending' AND claimed_at < now − 3 min` get the same enqueue. The job runs verify-or-fail.
  3. **Held rows** (expired account) are skipped. They stay `scheduled` and show as held.
- **`defineJob('social.send', maxAttempts 1, timeoutMs 120 s)`** loads the row:
  - `scheduled` and due: claim, then send (§9.2).
  - `sending` and stale (claimed_at > 3 min ago): verify-or-fail (§9.3).
  - Anything else: `{ skipped }`.
- **`defineCron('social.tokens')`** refreshes once per account per day (§7).
- **`social.autoRun`.** After `createPack`, when the flag is on and `auto.post==='schedule'`:
  - For each pack platform in `{x, linkedin}`, pick the account with `pickAccount` (non-expired only) and check `preflight`.
  - If both pass, schedule it for `addDays(today, 1)` at `auto.time` (`auto: true`, event `social.scheduled {auto:true}`).
  - If either fails, the post stays in the library.

### 9.2 Claim and send (`sendPub(pubId | sid, { manual, userId })`, one function for the job and Post now)
1. **Claim.**
   - **Scheduled send:** `UPDATE social_pubs SET status='sending', attempt_key=gen_random_uuid(), attempts=attempts+1, claimed_at=now(), stage='media', err=NULL WHERE id=$1 AND status='scheduled' RETURNING *`.
   - **Post now:** upsert with `ON CONFLICT (business_id, sid) DO UPDATE … WHERE social_pubs.status IN ('scheduled','failed')`.
   - **No row returned:** someone else has the post. Post now throws `COPY.sending`, or `COPY.alreadyPosted` when it's posted.
2. **Read the latest content now**, under the lock window:
   - **Pack:** `post.text`, and the image is `imageUrl`. If that's missing, render it with `renderPostImage` and persist the url and meta onto the pack, like `publisher.heroImage`.
   - **Brief:** `textOf(item)`. The images are the finished `img.urls`, the first 4 on X. A reply sends the reply text and `xStatusId(item.url)`.
   - Store `payload` (text plus media urls and meta) on the row. If the content is gone, the row becomes `failed`/`rejected`.
3. **`ensureToken`** (§7).
4. **Media**, `stage='media'`:
   - Load the bytes (`readObjectBytes(url)`, a new export in `storage.ts`: `/api/files/…` goes to `readLocal`, anything else is fetched).
   - Check the size and format again. If one fails, the row becomes `failed`/`media`. **Never auto-compress at send time.**
   - **X:** `POST https://api.x.com/2/media/upload` (multipart `media`, `media_category=tweet_image`) returns `data.id`.
   - **LinkedIn:** `POST /rest/images?action=initializeUpload {initializeUploadRequest:{owner}}`, then `PUT` the bytes to `uploadUrl`.
   - Any failure in this stage is **safe**: transient errors retry, definitive ones fail.
5. **Create**, after `UPDATE … SET stage='create' WHERE attempt_key=$k`:
   - **X:** `POST https://api.x.com/2/tweets {text, media?:{media_ids}, reply?:{in_reply_to_tweet_id}}`.
   - **LinkedIn:** `POST /rest/posts {author, commentary: liCommentary(text), visibility:'PUBLIC', distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]}, content?, lifecycleState:'PUBLISHED', isReshareDisabledByAuthor:false}`.
     - The author is `urn:li:person:{sub}` or `urn:li:organization:{id}`.
     - Content is `{media:{id}}` for one image or `{multiImage:{images:[…]}}` for more.
     - The id comes back in the `x-restli-id` header.
   - Fetch timeouts: 30 s per request.
6. **Outcome.** Every write is `WHERE id=$1 AND attempt_key=$k AND status='sending'`.
   - **Success:** `posted` with `remote_id`, `remote_url`, `posted_at`, `date`/`time` set to the local now, and `stage=NULL`. Then the brief `st='posted'` write (§6) and event `social.posted`.
   - **Definitive refusal:** `failed` with code and copy (§9.4), event `social.failed`.
   - **Transient, scheduled send:**
     - while `attempts < 4`, return to `status='scheduled'` with `retry_at = now + [1, 5, 15] min` (dev: `[3, 6, 12] s`) and `stage=NULL`;
     - otherwise `failed` with the mapped code (`rate_limit` gives "Try again later").
   - **Transient, manual:** `failed` at once.
   - **Unknown, create stage:** verify-or-fail (§9.3).
   - Bump the revision, then notify. Background sends only: a failure calls `notify(bid, `A ${PLAT_L[k]} post didn’t go out.`, { tone: 'bad', action: { label: 'Open', href: '/social?pack={id}&plat={k}' | '/brief' } })`. Success is silent, matching the prototype.

### 9.3 Unknown outcome: verify or fail, never resend
- **When it applies:** an abort or timeout after the create request was sent, a connection reset or socket error during create, a 5xx other than 503 on create, or a stuck `sending` row with `stage='create'`.
- **A stuck row with `stage='media'` or `NULL`** never reached create. It goes back to the transient path above.
- **X:** wait 20 s, then `GET /2/users/{remote_id}/tweets?max_results=10&start_time={claimed_at−2min}&tweet.fields=created_at`.
  - A post with `normForMatch(text) === normForMatch(payload.text)` becomes `posted`, with url `https://x.com/{handle}/status/{id}`.
  - No match means `failed`/`unknown`.
- **LinkedIn:** always `failed`/`unknown` ("Radar couldn’t confirm the post went out. Check LinkedIn before trying again."). The UI does not add "Nothing was published." (`failedLine`).
- **Connection errors before any byte was sent** (`ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`) count as transient, not unknown.

### 9.4 Error mapping (`PubErrCode` → `errCopy`)

| Provider response | Code | Retried (scheduled) |
|---|---|---|
| 429 (`x-rate-limit-reset` / LinkedIn 429) | `rate_limit` | yes (backoff; `retry_at` ≥ the reset time when given) |
| 503, network error before send, token refresh 5xx | `unavailable` | yes |
| X 403 "duplicate content" / LinkedIn 422 duplicate | `duplicate` | no |
| X 400 / LinkedIn 422 text length | `too_long` | no |
| media upload 4xx | `media` | no |
| LinkedIn create refused because an image is still processing | `unavailable` (retry; profile tokens can't poll `/rest/images`) | yes |
| 401 after a successful forced refresh, 403 app-permission | `auth` | no |
| other 4xx | `rejected` | no |
| unknown after create (§9.3) | `unknown` | never |
| more than 24 h late | `stale` | no |

The provider status and body excerpt go to `err_detail` and the server log, never to the user or to events.

### 9.5 Races
- **An edit racing the send.**
  - Edits are refused while locked (5 minutes before due, while sending, and while past due and unconfirmed).
  - The send reads content after the claim, inside that window, so the text it sends is the text the user last saved.
  - The client must flush its pending autosaves before Post now or Schedule (§17, `flushLater`).
- **Disconnect while sending.**
  - `sending` rows are not deleted. The worker already holds the token in memory and finishes, and its conditional writes still match.
  - The `acct_id` becomes NULL, and history keeps `acct_label`.
- **Reconnect.** `released` counts the account's scheduled pubs that will still go out. The scheduler picks them up on the next minute.

## 10. Images

- **Every pack style produces a real server file.** Branded and Infographic are canvas templates. Photography and Illustration go to the image model or fall back to the template, and `custom` renders as illustration (`renderImage` always writes a PNG).
  - `imageUrl` is null only when rendering threw (`createPack`, `social.style`, `regenImage` catch it), or briefly during a style change.
  - In those cases, `social.schedule`, `social.postNow` and the send render it server-side with `renderPostImage` and persist it.
  - The client-only "live template" is a preview and is never uploaded.
- **Brief images** come from the `brief.visuals` job, which always uses server files. A null url means that image failed, and it is skipped.
  - While `status==='generating'`, preflight shows `images_pending` and blocks.
- **Meta.**
  - Add `renderImageFile(r): Promise<{ url, bytes, type }>` to `images.ts`, with `renderImage` as a wrapper so existing callers don't change.
  - `createPack`, `regenImage`, `social.style` and `brief.visuals` store `imageMeta` or `meta[i]`.
  - Unknown meta is read from the real file on schedule, Post now or send, then persisted.
- **Checks:**
  - Both platforms: 5 MB.
  - X accepts JPG, PNG, GIF and WEBP (X docs: images ≤ 5 MB).
  - LinkedIn accepts JPG, PNG and GIF, under 36,152,320 pixels (Images API).
- **Compress images** (`social.compress`), for every image that fails a check:
  - Decode it with `@napi-rs/canvas` `loadImage`.
  - Downscale so the longest side is at most 2400 px and the pixel count is under the LinkedIn limit.
  - Encode JPEG at quality 85. If it is still over 5 MB, step down 85 → 75 → 65.
  - Store it with `putObject(objectKey(bid, 'social', 'jpg'))` and update the url and meta. Set `compressed: true` on a pack post.
  - Return the number of files changed. The UI toast is "Images compressed".

## 11. Audit and metrics

- **Events** (`events` table, append-only, ids and enums only, never text; widen `track()` to accept `social.${string}`):

| Kind | Fired by | Props |
|---|---|---|
| `social.connected` / `social.reconnected` | `social.connect` | `ch, acct, released?` |
| `social.disconnected` | `social.disconnect` | `ch, acct, unscheduled` |
| `social.expired` | refresh failure (no user) | `ch, acct, held` |
| `social.scheduled` / `social.rescheduled` / `social.unscheduled` | schedule, move, scheduleAll, autoRun, unschedule | `sid, src, platform, acct, ch, date, time, dueAt, from?, auto?` |
| `social.posted` | `sendPub` | `sid, src, kind, platform, acct, ch, remoteId, url, scheduled: !manual, attempt, direct, costUsd` |
| `social.failed` | `sendPub`, stale sweep | `sid, src, kind, platform, acct, ch, code, attempts, scheduled` |

- **User and time.** `userId` is the actor (null for the worker), `ref = sid`, and `created_at` is the time. That covers AC-21's user, account, platform, post id and time.
- **The automatic `action.*` events still fire.** `summarize()` already drops `text`.
- **`IMPACT` gains** `'social.posted': 'Social posts published from Radar'`, `'social.scheduled': 'Social posts scheduled'` and `'social.connected': 'Social accounts connected'`.
- **`/api/admin/metrics` `derived.social`:**
  - `scheduledSent`: count of `social.posted` with `scheduled=true`.
  - `scheduledFailed`: count of `social.failed` with `scheduled=true`.
  - `scheduledSuccessRate`: sent ÷ (sent + failed), or null.
  - `expiries`: count of `social.expired`.
  - `reconnects`: count of `social.reconnected`.
  - `accountsConnected`: the current row count of `social_accounts`.
  - `expiriesPerAccount`: expiries ÷ max(1, the distinct accounts seen in the range).

## 12. Roles

Every new write action defaults to Editor, `social.pages` is a read with role Editor, and the OAuth providers use role Editor. A Viewer gets 403 "You don’t have permission to do that." from the route. Viewers keep `social.copied` (role Viewer, unchanged). The callback re-checks the role.

## 13. Time zones

- **One zone:** `businesses.timezone` (`B.tz`, which is also `B.blog.tz`), per D1.
- **Store and derive:**
  - `date`/`time` is the wall clock in that zone.
  - `dueAt = zonedTimeToUtc(date, time, tz)`.
  - A time skipped by DST moves forward, and a repeated time takes the earlier instant. Both are tested.
- **Helpers live in `src/lib/socialPublish.ts`:** `tzLabel(tz, atMs) → {abbr, name}`, `atTz(tz, date, time)` and `tzNote(tz, nowMs)`. The existing `tzShort` in `constants.ts` is left alone.

Node 22.18 (ICU 77.1) `Intl` en-US output, January and July:

| Zone | short | shortGeneric | long | longGeneric | `tzLabel` |
|---|---|---|---|---|---|
| America/New_York | EST / EDT | ET | Eastern Standard/Daylight Time | Eastern Time | ET · Eastern Time |
| Europe/London | GMT / GMT+1 | United Kingdom Time | Greenwich Mean Time / British Summer Time | United Kingdom Time | GMT/BST (en-GB) · United Kingdom Time |
| Europe/Berlin | GMT+1 / GMT+2 | Germany Time | Central European Standard/Summer Time | Central European Time | CET/CEST (en-GB) · Central European Time |
| Asia/Dubai | GMT+4 | United Arab Emirates Time | Gulf Standard Time | Gulf Standard Time | GST (en-GB) · Gulf Standard Time |
| Africa/Lagos | GMT+1 | Nigeria Time | West Africa Standard Time | West Africa Standard Time | GMT+1 · West Africa Standard Time |

The prototype's London label is "UK" / "UK time". Production uses GMT or BST with "United Kingdom Time", which should be logged as a divergence.

## 14. X replies

**Superseded (PM decision 2026-10-23, owner request):** the API reply path is dropped.
- **Reply now always opens X's own reply box.** `xReplyIntentUrl(statusId, draft)` is opened in a new tab from the click, so popup blockers allow it. X shows the original post with the draft already in the reply field, and the user presses Reply.
- **No connected X account is needed.** The user's own X session posts the reply.
- **What Radar does.** The item then calls `brief.item { st: 'copied' }`, and the existing **I posted it** / Copy again flow continues.
- **No Radar window.** There is no confirmation window and no pub.
- **When no status id can be found** in `item.url`, today's Copy flow is shown.
- **Never scheduled.** Replies are never scheduled or sent automatically (AC-22).
- **The server refuses replies.** `social.postNow` refuses replies with `COPY.replyNotAllowed`. There is no `reply_restricted` path, no `[[radar:noreply]]` stub marker, and no reply cost.
- **Why.** Self-serve X plans refuse API replies unless the author mentioned the account (Feb 2026), and X's guidelines require prior approval for AI-generated replies. See `developer-apps-guide.md`.

## 15. File ownership

| Owner | Files |
|---|---|
| Architect → PM (shared, single owner; ask the PM to change) | `src/lib/types.ts`, `src/lib/socialPublish.ts` (+ test), `docs/CONTRACTS.md` § Social channels, this file |
| Backend (T2) | `drizzle/0006_social_channels.sql` + meta, `src/server/db/schema.ts`, `src/server/flags.ts`, `src/server/env.ts`, `src/server/services/social/publish/*` (new: `accounts.ts`, `oauth.ts`, `x.ts`, `linkedin.ts`, `stubs.ts`, `send.ts`, `jobs.ts`, `media.ts`, `project.ts`), `src/server/actions/socialPublish.ts`, edits to `actions/{social,brief,publishing,index}.ts`, `workspace.ts`, `events.ts`, `metrics.ts`, `app/api/admin/metrics/route.ts` (if needed), `oauth/providers.ts`, `jobs/all.ts`, `services/storage.ts`, `services/images.ts`, `services/social/{generate,auto}.ts`, `services/brief/visuals.ts`, `scripts/dev-seed.ts`, `.env.example`, `docs/LAUNCH.md`, server tests |
| Frontend (T3) | `src/features/social/channels/*` (new), `src/features/social/{PackView,SocialMarketing,PackThumb,AutoModal}.tsx`, `src/features/brief/DailyBrief.tsx`, `src/features/calendar/ContentCalendar.tsx`, `src/features/dashboard/Dashboard.tsx`, `src/features/settings/SettingsPage.tsx`, `src/components/**`, `src/client/app.tsx` (`flushLater`), `src/app/radar.css` |
| Shared read-only | `src/features/brief/model.ts` is frontend-owned. The backend may import `textOf`/`acctOf`/`isLive` (it already does) but must not edit it |
| PM (T4) | `DIVERGENCES.md`, README principle "Radar never posts" wording |

**Frontend module** `src/features/social/channels/`:
- `ConnectSocial.tsx`, `SocialAccounts.tsx` and `LogoLabel.tsx`.
- `ScheduleModal.tsx`, including `DayPick`, `TimeSel` and `TzNote`.
- `PublishBox.tsx`, `ScheduleAll.tsx` and `SocialChip.tsx`, which includes the Move post window.
- `WeekStrip.tsx` and `useSocial.ts` (`useNowMs` with skew correction, `moveSocial`, `openSocial`, and the connect flow).
- Props are in CONTRACTS.md.

## 16. Backend task list (T2)

1. **Schema.** Migration and `schema.ts` (§3). Env and flags (§8).
2. **Accounts and OAuth.**
   - The `x`, `linkedin` and `linkedin_page` providers, with pending authorizations, identity fetch, stubs, `ensureToken`, row-lock refresh and the `social.tokens` cron.
   - ACs: AC-2, AC-4, AC-19.
3. **Account actions.**
   - `social.pages`, `social.connect` (reconnect rules, `released`) and `social.disconnect` (`unscheduled`).
   - ACs: AC-2, AC-3, AC-4, AC-24.
4. **Projection.**
   - Accounts, channels, `now`, pubs, brief `st`, `held` and `counts.briefOpen`.
   - ACs: AC-4, AC-11 data, AC-15, AC-23.
5. **Publishing actions.**
   - `social.postNow`, `schedule`, `move`, `unschedule` and `scheduleAll`, with preflight (shared helper), past, lock, flag and role rules.
   - ACs: AC-6, AC-7, AC-8, AC-9, AC-10, AC-15, AC-22, AC-24.
6. **Edit locks** on the existing actions (§6), `retimePubs` on a time zone change, and `social.auto.post` with its server check.
   - ACs: AC-10, AC-16.
7. **Sending.**
   - `sendPub`, the X and LinkedIn adapters (media, create, verify), `social.publisher` (due, stale, stuck), `social.send`, retries and backoff, error mapping, the brief `st='posted'` write and events, and failure notifications.
   - ACs: AC-18, AC-20, AC-22.
8. **Images.** `renderImageFile` meta, `readObjectBytes`, render-on-send, `social.compress`. AC-7, AC-20.
9. **Auto.** `autoRun` schedules when `post==='schedule'`. AC-16.
10. **Audit and metrics** (§11). AC-21, AC-23.
11. **Dev tooling and docs.**
    - Dev stubs, markers, `social.devSimulate` and the dev seed.
    - `.env.example`, and `docs/LAUNCH.md`: both apps, scopes, the redirect URIs `/api/oauth/{x,linkedin,linkedin_page}/callback`, LinkedIn page approval, the 60-day profile reconnect, the X tier and reply restriction, and the flag.
    - AC-26.
12. **Tests** (AC-25):
    - claim and no double send (two concurrent `sendPub`, a job re-run after a crash, a stale `sending` row);
    - backoff to `failed` with rate-limit copy;
    - unknown outcome on X (verify found and not found) and on LinkedIn;
    - refresh: transient vs definitive, the concurrent-refresh lock and atomic pair save (a rotated X token is never lost);
    - LinkedIn profile: `social.tokens` sets `expired` once `expires_at` passes, with no refresh call, and posts due later are held;
    - X replies: `social.postNow` on any reply is refused (`COPY.replyNotAllowed`);
    - disconnect and reconnect counts, and a reconnect as a different account refused;
    - routing, lock refusals on edit and move, past-time refusal, the stale rule;
    - the flag-off path (no projection, actions 404, scheduler skips, auto coerced);
    - Viewer refused.

## 17. Frontend task list (T3)

1. **`flushLater()` on `useApp()`.** It fires pending `actLater` timers now and resolves when they finish. Call it before `social.postNow`, `schedule` and `scheduleAll`.
2. **Settings → Social accounts** (`SocialAccounts`, `ConnectSocial`): after Publishing, flag only. For a channel not in `B.social.channels`, show its description and the muted text "Not available yet" instead of Connect.
   - The page picker's empty state: "You don’t manage any LinkedIn pages. Ask a page admin to add you, then try again."
   - Disconnect toast: the prototype copy with `unscheduled`. Reconnect toast: the prototype copy with `released`.
   - ACs: AC-1, AC-2, AC-3, AC-4.
3. **`PublishBox` in PackView** (`packPanelState`, `preflight(packPreflightInput)`, `failedLine`, `atTz`). Post now confirmation, Schedule and Reschedule (`ScheduleModal`), Unschedule, Compress, and Reconnect.
   - View on {Platform} opens `pub.url` (`window.open(url, '_blank', 'noopener')`).
   - The text area and the style and regenerate controls are read-only while `isLocked`.
   - The panel is at most 400 px wide below the preview. Buttons are 40 px.
   - ACs: AC-5, AC-6, AC-7, AC-8, AC-10.
4. **`ScheduleAll`** in the pack header (`showScheduleAll`, `scheduleAllWhy`, `STAGGER`), calling `social.scheduleAll`. AC-9.
5. **Calendar chips and drag** (`SocialChip compact`), with the `socialItems(B, nowMs)` source.
   - Drop handlers route **both** `s:` and `b:` ids to `social.move` (the prototype routes only `s:`).
   - The client-side `moveCheck` toasts `COPY.*`.
   - The phone agenda includes chips.
   - On `pointer: coarse`, a tap opens Move post (`social.schedule` with date and time, plus Open post).
   - ACs: AC-11, AC-13.
6. **Dashboard "This week"** (`WeekStrip`, a container query under 860 px, empty days hidden on phones, and the empty state), plus the Needs attention items (`socialItems` failed → "A post didn’t go out" with Fix and retry, expired accounts → "Reconnect {channel}"). ACs: AC-12, AC-14.
7. **Daily Brief.**
   - `briefPublish(accounts, item)` decides what shows:
     - posts: Post now (confirm), Schedule (default today 5:00 PM) and the icon-only Copy, when `direct`;
     - X replies: Reply now opens X's box and marks the item copied, with **no** Radar confirmation window.
   - Scheduled items: the line plus Reschedule and Unschedule, shown dimmed in the queue.
   - "Posted to {Platform}" or "Replied on {Platform}" plus View on.
   - The prototype's Connect or Reconnect hint when `can && !direct` (posts and X replies).
   - On X replies, Reply now always opens X's reply box (§14), connected or not, with no Radar confirmation.
   - The Schedule window shows `expiryNote(acct, B.tz)` as a warn Status when `expiresBefore(acct, dueMs)` (A23). PublishBox does the same.
   - AC-15.
8. **AutoModal** "When a pack is ready", with the prototype copy, and Save disabled with no live account. SocialMarketing status line, subtitle and "Connect X or LinkedIn". PackThumb `scheduledCount`. ACs: AC-16, AC-17.
9. **Flag off.** Every item above is gated on `B.social.publishing`, and the existing render paths are untouched. AC-23.
10. **CSS.** Port `.wk-*`, `.soc-chip`, `.pack-side` and the calendar phone rules from the prototype diff into `radar.css`.

## 18. Validation scenarios (for QA and the engineers' tests)

1. **Connect all three with the flag on, in stubs.**
   - The Settings rows show logos, and the page picker lists 2 pages.
   - Disconnecting X with 2 posts scheduled shows "X disconnected. 2 scheduled posts were unscheduled."
2. **Over-limit X post.** An X post of 281 characters blocks Post now and Schedule, in the UI and when `social.schedule` is called directly. The same text plus a long URL passes, because each URL counts as 23.
3. **Schedule and the calendar.**
   - Schedule LinkedIn for tomorrow at 9:00. The panel reads "Scheduled · Sat, Oct 24 at 9:00 AM ET", and the post appears on the Calendar and in This week.
   - Dragging to yesterday is refused. Dragging within 5 minutes of the send time is refused, and `social.move` also refuses it when called directly.
4. **Schedule all.** It schedules X at 12:30 and LinkedIn at 9:00. A Reddit row is dimmed "Copy and paste".
5. **Expiry.**
   - `social.devSimulate expire` → the panel shows "X needs reconnecting", the chip is amber, and Needs attention shows "1 scheduled post is on hold".
   - Reconnecting the same stub keeps the id and toasts "1 held post will go out as scheduled".
   - Reconnecting as a different account is refused.
6. **Failures.**
   - `[[radar:ratelimit]]` retries 4 times, then fails with "X is limiting posts right now. Try again later. Nothing was published." Needs attention shows it, and Fix and retry opens the pack's X tab.
   - `[[radar:timeout]]` on LinkedIn shows "Radar couldn’t confirm…" with no "Nothing was published."
7. **No double post.**
   - Kill the worker after the claim. On restart, the stuck row is verified, not resent.
   - Two simultaneous Post now clicks produce one post.
8. **Daily Brief.**
   - With the profile connected, a LinkedIn feed draft shows Post now and Schedule. Scheduling it removes it from the to-do count. A company draft routes to the page.
   - With nothing connected, Copy plus the Connect hint shows.
9. **Auto.**
   - Schedule posts can't be saved with no account, in the UI and on the server.
   - After a run, tomorrow has the X and LinkedIn pubs at `auto.time`.
10. **Phone.** At 390 px with `pointer: coarse`, tapping a chip opens Move post.
11. **Flag off.** Screenshots of Dashboard, Calendar, Social, the Pack view, the Brief, Settings and AutoModal match `main`. Every new action returns 404 `not_enabled`.
12. **Viewer.** Every new action returns 403.
13. **Time zone.** Changing the business zone keeps "9:00 AM" on screen and moves `due_at`.

## 19. Migration, compatibility and rollback

- **Migration.** One additive migration with two new tables. No backfill, and no change to existing columns.
- **Compatibility.** All new jsonb fields (`imageMeta`, `compressed`, `meta`, `auto.post`) are optional and default safely.
- **Rollback, in order of size:**
  - Turn the flag off. Sends stop, and the UI is unchanged.
  - Revert the deploy. The tables are ignored.
  - The tables can be dropped later.
- **Observability.**
  - The log prefixes `[social.send]`, `[social.oauth]` and `[social.tokens]` carry the sid and pub id, never text or tokens.
  - Events and admin metrics cover the rest (§11).
  - Stuck `sending` rows are self-healing (§9.3).

## 20. Risks / open questions for the PM (owner decisions only)

1. **X Reply now and Enterprise.** Self-serve X plans reject API replies to threads that don't mention the business, and that is nearly every Brief thread.
   - **Built default.** Reply now opens X's own prefilled reply box, then "I posted it". Radar posts the reply itself only when the thread mentions the account.
   - **The decision.** Pay for X Enterprise to post every reply from Radar, or keep the reply box (free).
   - Separately, X's guidelines require prior approval for AI-generated replies, and possibly for AI-drafted posts. The owner should send X one Policy Support request before launch.
2. **X cost.** X is pay-per-use: $0.015 per post, **$0.20 per post with a link**, and $0.01 per allowed reply. Most pack posts include an article link, so they cost $0.20.
   - Radar logs `costUsd` per publish. The owner should set a spending limit in the X console.
   - Should X posts drop the link by default to save cost? Radar keeps the current copy until the owner says otherwise.
3. **LinkedIn profile tokens.** These expire every 60 days with no background renewal. Radar shows "Reconnect needed" and holds posts, and it warns when someone schedules past the expiry. Is that acceptable for v1?

Not owner decisions, but logged for T4 (DIVERGENCES):
- **Scopes and apps:**
  - `tweet.read` was added to the X scopes.
  - The LinkedIn profile scopes are `openid profile w_member_social`. The page scopes are `w_organization_social rw_organization_admin r_basicprofile`, on a second app.
- **X replies:** they use X's reply box instead of the "Reply on X now?" confirmation. The scheduling-past-expiry note is new copy.
- **Risks to confirm in live tests:**
  - X may keep one live grant per app and X account (stated only on X's Ads MCP page). If so, connecting the same X account in two businesses cancels the first connection. Test it before deciding whether to warn.
  - LinkedIn images can't be polled with a `w_member_social` token. Treat an image processing error on create as transient, and retry the post.
- **Labels:** time zone labels (London GMT/BST rather than "UK"), and times end at 10:00 PM.
- **New copy and behaviour:**
  - "Not available yet" for unconfigured channels;
  - the page picker's empty state;
  - the stale (24 h) rule and its copy;
  - unknown-outcome copy without "Nothing was published.";
  - failed Brief posts appear on the Calendar and in Needs attention;
  - `images_pending` and image-format preflight copy;
  - the weighted X character count;
  - a reconnect as a different account is refused;
  - Post now failures aren't retried in the background.
- **Prototype bug:** brief chips are draggable, but the prototype's drop handlers only route `s:` ids.
- **README:** principle #1, "Radar never posts", needs rewording when the flag goes to `all`.

## Sources
- X API, create post (`POST /2/tweets`: scopes `tweet.read users.read tweet.write`; `reply.in_reply_to_tweet_id`; up to 4 photos): https://docs.x.com/x-api/posts/create-post
- X media upload (`POST /2/media/upload`, `media_category`, scope `media.write`): https://docs.x.com/x-api/media/upload-media. Image limits (≤ 5 MB; JPG, PNG, GIF, WEBP): https://docs.x.com/x-api/media/quickstart/best-practices
- X OAuth 2.0 (authorize and token URLs, S256, 2-hour tokens, `offline.access`): https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code and https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token
- PM research with primary sources: `.factory/social-channels/developer-apps-guide.md` (§1, §7, §8, appendix)
- X reply restriction (secondary): https://roboin.io/article/en/2026/02/24/x-limits-api-based-automated-replies-to-combat-engagement-farming/ and https://opentweet.io/how-to/fix-x-api-reply-restriction
- LinkedIn refresh tokens (MDP partners only; 60-day access token, 365-day refresh token): https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
- LinkedIn Community Management (vetted; request it on an app without other products; `r_member_social` closed): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- LinkedIn organization ACLs (roles; the page scope is `rw_organization_admin` per Increasing access, see developer-apps-guide.md): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role
- LinkedIn Images API (initializeUpload; JPG, GIF, PNG; < 36,152,320 px): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api
- LinkedIn little text format (reserved characters in `commentary`): https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format


## 21. Postiz lessons applied (PM, 2026-10-23)

Source: `postiz-lessons.md`. These override anything above that conflicts.

| # | Change | Owner |
|---|---|---|
| P1 | **LinkedIn media wait.** After uploading images, a profile waits about 15 s before the post is created. A page polls `GET /rest/images/{urn}` until `AVAILABLE` (about 30 s cap), falling back to the fixed wait on a 403. This applies to manual and scheduled sends. A send still `processing` after the cap fails as `media`. | Backend `publish/linkedin.ts`, `send.ts` |
| P2 | **Persist `posted` first.** After the create call returns 2xx, the conditional `posted` write (with `remote_id` and url) runs first and is retried in process. The Brief write, events and notify run after it and only log on failure. Nothing after a successful create may cause a resend. Add a test that throws after the create and asserts there is no second create. | Backend `send.ts` |
| P3 | **X 402 / `usage-capped` / credits depleted → `quota`** (new `PubErrCode`, copy in `errCopy`). Never retried. Logs an operator error (`console.error` with a `[social] X quota` tag) and records the event. | Backend `x.ts`, `send.ts`; shared done |
| P4 | **LinkedIn 426 `NONEXISTENT_VERSION` → `unavailable`**, with an operator error log naming `LINKEDIN_API_VERSION`. `docs/LAUNCH.md` gets a note to bump the version each year (LinkedIn sunsets versions after about 12 months). | Backend |
| P5 | **Weighted X count.** `charCount` counts by grapheme (an emoji sequence counts 2). Bare domains on common TLDs count as 23. The same detector drives `hasLink` and the link price. No new dependency. | Shared (done) |
| P6 | **OAuth.** No `prompt=none`. On the callback, check the granted `scope` covers the required set; if not, return readable copy ("Radar needs permission to post. Try again and allow all permissions.") and save nothing. | Backend `oauth.ts` |
| P7 | **Pages.** List pages and check reconnects for both `ADMINISTRATOR` and `CONTENT_ADMINISTRATOR` roles. | Backend |
| P8 | **`made_with_ai: true`** on X posts whose images came from the image model (Illustration and Photography styles and Brief AI images). | Backend `x.ts` |
| P9 | **X error text matching**, on top of the status code: duplicate (both wordings) → `duplicate`; suspended or locked account → `auth`; invalid media ids → `media`; cashtag, crypto-address and invalid-URL rejections → `rejected`, keeping X's own message as `err` when it's short and readable. | Backend `x.ts` |
| P10 | **Notify on expiry.** When an account becomes expired with held posts, send a toast to members (existing `notify`). About 7 days before a LinkedIn profile's `expiresAt`, notify once (`once()` key) that it needs reconnecting soon. | Backend `accounts.ts`, cron |
| P11 | **No prompt-less refresh, and no single shared LinkedIn app.** Confirms A10 and A13. No change. | — |
