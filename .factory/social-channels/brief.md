# Connected social accounts: post now, schedule, calendar

Source handoff: `design_handoff_radar 6/updates/2026-10-23-social-channels/` (UPDATE-2026-10-23-social-channels.md + `prototype/`).
The approved design is that prototype, layered on the earlier updates (`design_handoff_radar 3` full prototype + `4` logo/sign-up + `5` image options).
The prototype diff against the previous state is kept outside the repo (PM scratchpad) and handed to each agent.

Closes the open DIVERGENCES row "Design update 2026-10-20b → Connecting company accounts: posting stays copy-and-paste … Open".

## User problem
Radar drafts social packs and Daily Brief posts, but the founder still copies each one into X or LinkedIn by hand and
has to remember when to post it. They want to connect X and LinkedIn once, then post or schedule straight from Radar,
and see scheduled posts next to articles on the Calendar and Dashboard.

## Smallest complete version (in scope)
- Connect one **X** account, one **LinkedIn profile** and one **LinkedIn page** per business (Settings → Social accounts).
- **Post now** and **Schedule** for X and LinkedIn posts from social packs and the Daily Brief. **Reply now** for X replies in the Daily Brief.
- Background sending at the scheduled time (business time zone), with retries, no double posts, and readable failures.
- Scheduled posts on the Content Calendar and a new Dashboard **This week** strip. Drag to reschedule. On touch devices, tap opens **Move post**.
- Needs attention items for failed posts and expired accounts. Reconnect restores held posts.
- Automatic generation option **When a pack is ready → Schedule posts** (explicit opt-in).
- A feature flag, off by default. With it off, Radar behaves and looks exactly as it does today.

## Exclusions
- Posting to Facebook, Reddit, Quora or Hacker News, and LinkedIn replies. These stay copy-and-paste.
- Scheduling replies (X replies are Reply now only, and never automatic).
- More than one account per channel.
- Email notifications for failed posts (in-app toasts and Needs attention only, consistent with DIVERGENCES #11).
- Billing and usage.

## Decisions (PM)
- **D1 Time zone.** One zone: `businesses.timezone` (`B.tz`, which is also `B.blog.tz` and what publishing uses). Labels come from `Intl` for any IANA zone, not the prototype's 4-zone table. Logged as a divergence.
- **D2 Delivery.** A feature branch and a PR on `kenny-io/radar`, with the flag off. `main` deploys to production (Railway), so merging waits for the owner's go-ahead.
- **D3 Live providers.** Built against the official X API v2 and LinkedIn REST APIs, with `RADAR_DEV_STUBS=1` stubs for local work and tests. Live OAuth and posting can't be verified until X and LinkedIn developer apps exist, and LinkedIn page access needs LinkedIn's approval. Those checks are recorded as **not run**, never as passed.
- **D4 Secrets.** Tokens are encrypted with the existing `crypto.encrypt`. They never reach the workspace, the client or the logs. New env vars are separate from `X_BEARER_TOKEN`, which stays the Brief's search token.
- **D5 Audit.** Every publish and schedule change goes to the existing append-only `events` table (ids, never post text).
- **D6 Prototype-only bits.** Demo data for the Active account and the `?preview=` switches stay in the prototype. In dev, stub OAuth connects fake accounts.

## Acceptance criteria
IDs are stable. Handoff check numbers are in brackets.

**Connecting**
- **AC-1 [1]** With the flag on, Settings → Social accounts sits after Publishing and has one row per channel (X, LinkedIn profile, LinkedIn page). Each row has the platform logo, the name, and either the account name or a description.
  - Right side: Connect · "● Connected" + Disconnect · "● Reconnect needed" (amber) + Reconnect.
  - Footnote: "Facebook, Reddit and Quora posts are copy-and-paste for now."
  - Every third-party button carries the platform logo.
- **AC-2** The Connect window lists what Radar may do, then **Continue with X/LinkedIn**, which opens the platform's own sign-in in a popup. For a LinkedIn page, the user then picks from the pages they manage. Cancelling or a provider error leaves nothing connected and shows readable copy.
- **AC-3** Disconnect deletes the tokens and unschedules that account's scheduled posts. The toast says how many.
- **AC-4 [6]** An expired account (refresh failed) holds its posts:
  - The post panel shows "On hold", and the calendar chip is amber.
  - A **Reconnect {channel}** Needs attention item shows how many posts are on hold.
  - Reconnect uses the same window with "access expired" text and keeps the account id, so held posts go out as scheduled. The toast reports how many.
  - The architect decides and documents what happens if the user reconnects as a different remote account.

**Post panel on a social pack (`PublishBox`)**
- **AC-5 [2]** The panel shows every state in handoff §3: can't post, not connected, ready, scheduled, sending soon, posted, failed, expired.
  - X and LinkedIn tabs show Post as / Post now / Schedule when connected.
  - Reddit, Facebook and Quora are copy-only.
  - Buttons are the default 40px. The panel is at most 400px wide when it sits below the preview. Each status line is a single string.
- **AC-6** Post now always asks first: "Post to {Platform} now?", naming the account and the number of images. On success the post shows "● Posted … ET", "As {account}" and **View on {Platform}**, which opens the real post URL.
- **AC-7 [2]** Preflight problems block Post now and Schedule in the UI, and the server enforces the same rules:
  - X: 280 characters and 4 images. LinkedIn: 3,000 characters and 9 images.
  - Images over 5 MB, or in an unsupported format, show a **Compress images** fix, checked against the real files.

**Scheduling**
- **AC-8 [3]** The Schedule window:
  - Shows the next 14 days as a 7×2 grid, and times from 6:00 AM to 10:00 PM in 30-minute steps, followed by the zone abbreviation.
  - Notes "Times are in {zone name} ({abbr}). Change it in Settings → Publishing."
  - Blocks past times (server too).
  - Defaults to tomorrow at the usual slot (LinkedIn 9:00, X 12:30).
  - When saved, the panel shows "● Scheduled · {Day, Mon D} at {time} {abbr}", and the post appears on the Calendar and in This week.
- **AC-9 [5]** Schedule all appears in the pack header when the pack has two or more platforms Radar can post to.
  - It offers one day, then **Staggered** (default, one time per platform) or **Same time**, plus an account choice per platform when there is more than one.
  - Rows that can't be scheduled are dimmed with the reason. Already-scheduled rows say "moves from {day}".
  - The button reads "Schedule N posts", and it schedules every eligible platform.
- **AC-10 [4]** A post within 5 minutes of its send time, or past it and not yet confirmed, can't be dragged, moved, edited, rescheduled or unscheduled. The UI and the server actions both enforce this.

**Calendar and Dashboard**
- **AC-11 [3][4]** Content Calendar month cells show social chips after articles.
  - Chip: logo and short time. On hold is amber, failed is red with "!", sending uses the signal colour, posted is at 55% opacity with "✓".
  - The full text is available on hover and to screen readers.
  - Clicking opens the pack on that platform's tab, or the Daily Brief for brief items.
  - Dropping a chip on another day reschedules it with a confirmation toast. Days before today are refused. The phone agenda includes social posts.
- **AC-12 [3][4]** Dashboard **This week** replaces "Upcoming articles". It shows today plus the next 6 days, articles filled and social posts outlined, and posts can be dragged between days.
  - Under 860px of container width it becomes one row per day. On phones, empty days are hidden.
  - Empty week: "Nothing scheduled this week." plus a link.
- **AC-13 [10]** On `pointer: coarse` devices, tapping a scheduled item opens **Move post** (day, time, **Open post**) instead of dragging.
- **AC-14 [6][7]** Needs attention adds:
  - "A post didn't go out", whose **Fix and retry** opens that post.
  - "Reconnect {channel}", with the count on hold and a **Reconnect** button.

**Daily Brief**
- **AC-15 [8]** When the right account is connected and not expired, posts show **Post now** (with confirmation), **Schedule** (default today 5:00 PM) and an icon-only Copy button. X replies show **Reply now** only.
  - Account routing: X → the X account. "For your feed" on LinkedIn → the profile. Company post on LinkedIn → the page.
  - Scheduled items leave the to-do list (shown dimmed) and don't count in `counts.briefOpen`. They show the scheduled line with Reschedule and Unschedule, and appear on the Calendar and This week.
  - Posted directly: "Posted to {Platform}" + View on {Platform}, with no Undo.
  - Not connected or expired: the existing Copy → "I posted it" flow, plus the one-line Connect or Reconnect hint.

**Automatic generation**
- **AC-16 [9]** Automatic generation adds **When a pack is ready**: Save to library (default) or Schedule posts.
  - Schedule posts schedules the X and LinkedIn posts for the next day at the set time, to the connected accounts.
  - Saving is blocked when no account is connected, in the UI and on the server.
  - The intro text, the toast after saving, and the Social status line ("· scheduled to connected accounts") all reflect the choice.

**Copy**
- **AC-17** The Social Marketing subtitle reads "Platform-ready posts and visuals in your brand. Post or schedule to X and LinkedIn, or copy them anywhere."
  - When nothing is connected, the status row adds a "Connect X or LinkedIn" link.
  - Pack thumbnails add "· N scheduled".

**Production behaviour (handoff §9)**
- **AC-18** The worker sends due posts at date+time in the business time zone, and always uses the latest text and images.
  - Retries back off. Each attempt has a unique key, and a database claim guarantees one post is never sent twice, even after a timeout or a worker restart.
  - When retries run out, the status is `failed` with an error the user can read. Rate limits read "Try again later". Nothing fails silently.
- **AC-19** X sign-in uses OAuth 2.0 + PKCE (`tweet.write users.read media.write offline.access`). LinkedIn uses `w_member_social` (profile) and `w_organization_social r_organization_admin` (page).
  - Tokens are encrypted at rest and refreshed automatically. `expired` is set only when a refresh fails.
- **AC-20** Images go through each platform's media upload, with size and format checked before sending. Every style a pack can carry (including server-rendered brand templates) produces a real file to upload.
- **AC-21** Every publish and schedule change is recorded with the user, account, platform, post id and time.
- **AC-22** X replies are sent only when the user clicks Reply now.
- **AC-23** A feature flag is off by default. With it off, the UI and behaviour match today exactly.
  - An opt-in group can be enabled.
  - The admin metrics report the share of scheduled posts sent successfully and how often accounts need reconnecting.
- **AC-24** Roles are enforced on the server.
  - Viewers can't connect, post or schedule.
  - Connect and disconnect use the same role as connecting a blog.

**Quality**
- **AC-25** Typecheck is clean, and all tests pass apart from the documented baseline failure. New logic has behaviour tests: preflight, locking, scheduling windows, no double send, refresh-to-expired, disconnect/reconnect counts, account routing and the flag-off path.
- **AC-26** The docs are updated:
  - A `DIVERGENCES.md` section for this update.
  - `docs/LAUNCH.md` (X and LinkedIn apps, scopes, redirect URIs, LinkedIn page approval, env, flag).
  - `.env.example` and `docs/CONTRACTS.md`.

## Failure states to cover
- OAuth cancelled or denied, a provider outage during connect, and a LinkedIn user who manages no pages.
- Token refresh failure (→ expired), and a revoked app.
- A post rejected by the platform (duplicate, too long, media error), a rate limit, a timeout with an unknown outcome, and retries running out.
- An edit racing the send, a disconnect while a send is in flight, a drag onto a past day, and a drag of a locked post.
- An auto-generated pack when the accounts later expire or disconnect.

## Constraints
- Follow the existing conventions: `useApp()`, `action({...})` with zod and roles, `defineJob`/`defineCron` with `once()`, `RadarError` copy that says "Radar" and never names a model or provider, `B.today` instead of `new Date()`, and dev stubs.
- No new runtime dependencies unless the architect justifies one.
- Copy matches the prototype exactly. Where it can't, log it in DIVERGENCES.

## Dependencies
- X developer app (OAuth 2.0, a paid tier for write limits) and a LinkedIn developer app (Share on LinkedIn, plus Community Management API approval for pages). These are owner actions, listed in LAUNCH.md.
