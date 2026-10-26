# Brief: daily-brief-rescan

## Problem
The owner opened Thally's Daily Brief on 2026-10-26 and the best conversation of the day was missing: Tom Johnson's
LinkedIn post "Making documentation pages agent friendly"
(`linkedin.com/posts/tomjoht_documentation-technicalwriting-share-7520502131984949248-kTLr`, short link
`lnkd.in/p/d44YZN7w`).

Evidence, from the page's ld+json: the post was published at `2026-10-26T15:10:32Z`, which is 11:10 AM in New York (EDT).
The brief scans once at `briefSettings.time` (default 06:00 in the business timezone), plus retries at +15 and +30 minutes
if the morning scan made no brief. After that nothing runs again unless someone clicks **Scan again**. So a post
published after the morning scan cannot show up in that day's brief.

This was not verified against production data. No production DB or env was read. We don't know Thally's real brief
time or today's `scannedAt`.

Secondary risks that rescans alone don't fix:
- Discovery searches only the first 5 or 6 short keyword queries (`plan.queries`). If none of Thally's keywords match a
  post like this one ("agent friendly docs", "Markdown mirror"), no rescan will find it.
- LinkedIn posts show up in web search only after an indexing lag.
- Each account gets at most 2 replies per platform per day (02-system §9), so a rescan can't add to a platform the morning
  scan already filled. The owner decides this one (DBR-8).

## Owner request
"the daily brief should do a rescan every 2 hours to see if anything new has surfaced since its last search until that day is done"

## Scope
- Automatic background rescans of today's brief. One starts once 2 hours have passed since the last scan of the day
  (morning, manual Scan again, or an earlier rescan), and they keep coming until the business day ends.
- Rescans add only new conversations, use the existing Scan again rules, and run quietly in the background.
- Rescans rotate through more of the search queries, so successive runs search different terms.
- The cap rule for later finds follows the owner's decision (DBR-8).

## Exclusions
- New UI, new settings or new copy beyond the existing "{n} new conversations since {time}" toast.
- A configurable interval.
- Recovering a day whose morning scan failed. The existing +15 and +30 minute retries are unchanged, and rescans
  need today's brief to exist.
- New data sources (for example a LinkedIn data provider), and changes to ranking weights.

## Decisions (PM)
- Interval = 2 h since the last `brief.scan` job of the day, whatever started it. That job's `createdAt` is real elapsed
  time, so DST doesn't matter. A manual Scan again restarts the clock, and a failed run doesn't cause a retry every minute.
- "Until the day is done": rescans need today's `brief_days` row in the business timezone. At local midnight the date
  changes, the new day has no brief yet, and rescans stop until the next morning's scan.
- Background runs are `mode: 'again'` with `background: true`. They are quiet (`progress.quiet`), so the scanning view
  never takes over the page. If the user clicks Scan again during one, the click joins the running job, shows its
  progress, and the user gets exactly one toast.
- A platform that fails during a background run is skipped. The other platforms still count, and no failure UI appears.
- `scannedAt` updates on every scan, as Scan again already does, so the header reads "Found at {latest scan}".
- Query rotation: the first 3 queries (priority keywords) are always searched, and the rest of the budget rotates through
  the remaining queries by scan round. The first scan is unchanged.
- No architect pass. The change stays inside the existing cron, job and source patterns.

## Acceptance criteria
- **DBR-1** For an active business that has finished brief setup and has a brief for today, a background rescan of
  today is enqueued once ≥ 2 h have passed since today's latest `brief.scan` job was created, and that job is no longer
  queued or running. Nothing is enqueued without today's brief (including after local midnight), or within 2 h of the
  last scan. This holds across minute ticks and multiple workers: one job per due point.
- **DBR-2** A rescan reads only threads not already seen today, and adds new replies marked **New** under the existing
  selection and drafting rules. It never drafts a thread already in the day, and never makes feed posts.
- **DBR-3** The Daily Brief page doesn't switch to the scanning view while a background rescan runs. New items appear
  when it finishes, through the usual workspace refresh. If the user clicks **Scan again** while one is running, the click
  joins it: the scanning view shows its progress, and the user gets exactly one result toast.
- **DBR-4** When a background rescan adds n ≥ 1 conversations, members get the toast "{n} new conversation(s) since
  {previous scannedAt}" (signal tone). When it adds none, nobody gets a toast.
- **DBR-5** A platform source that fails during a background rescan is skipped (logged), and the other platforms' results
  are still ranked, drafted and added. No "didn't respond" or Try again UI appears for background runs. Manual Scan again
  and first scans still show the existing failure UI unchanged.
- **DBR-6** Successive scans in a day rotate through `plan.queries`. The top 3 are searched every time, and the rest of
  the per-source budget cycles through the remaining queries. Round 0 (the first scan) searches exactly what it searched
  before. This applies to the Perplexity search source, the web-search source and the Reddit API query.
- **DBR-7** The existing behavior has no regressions: the morning scan and its +15/+30 retries, manual Scan again,
  Keep this morning's brief, the 2-per-platform cap on the first scan, and the test suite (baseline exceptions recorded).
- **DBR-8** *(owner decision 2026-10-26: "2 more later")* The first scan of the day picks at most 2 replies per platform
  per account. Later scans that day (Scan again, Keep this morning's brief, background rescans) can bring each account
  up to 4 on that platform, counting every reply already in the day whatever its status. Only threads that clear the
  existing quality bar qualify, and they're marked **New**. The cap is re-checked under the row lock. Logged as a
  divergence from 02-system §9 ("Never exceed 2 replies per platform").
- **DBR-9** DIVERGENCES (B10, B16, plus a new row for automatic rescans) and CONTRACTS (the `brief.scan` payload and
  progress) describe the new behavior.

## Delivery
Branch `kenny-dev/daily-brief-missing-posts-271f8b` → PR to `main`. Merging deploys to production (Railway), and the owner
approves the merge.
