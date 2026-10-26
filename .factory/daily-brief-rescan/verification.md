# Verification: daily-brief-rescan

## QA round 1: factory-qa on `d1269410`
- **Environment:** macOS, Node 22, Postgres 16 in `radar-sc-db` (:54329), `RADAR_DEV_STUBS=1`, app at `http://dbrqa.localhost:3017` with a separate worker, README dev-seed account (localhost only). No production env was read.
- **Typecheck:** pass.
- **Vitest:**

  | Revision | Passed | Failed | Skipped |
  |---|---|---|---|
  | HEAD | 654 | 1 | 65 |
  | Base `3fe684ea` | 631 | 1 | 65 |

  The one failure is the same pre-existing `src/server/ai/openrouter.qa.test.ts` parity snapshot on both revisions.
- **Scripts:** boundaries 53/53 (rescan timing, the cap, the past-day guard) and daily cron 8/8 (morning plus the +15/+30 retries).
- **Evidence:** `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-daily-brief-missing-posts-271f8b/2d999fb2-f093-4fdc-b4c0-2291d5f977ff/scratchpad/qa/`, which holds the logs and the `shots/` screenshots.

| AC | Result | How |
|---|---|---|
| DBR-1 | pass | Real cron and two workers; the clock restarts after a manual scan; nothing runs without a brief, on a past day, or while a scan is running |
| DBR-2 | pass | Browser: New marker, no duplicates, "Found at" moves forward |
| DBR-3 | pass, except D1 | Browser: no scan view during a background run; a Scan again click joins it and gets exactly one toast; a run that adds nothing gives no toast |
| DBR-4 | pass (one member) | Browser; delivery to every member is checked by code review only |
| DBR-5 | pass | Browser: a failing LinkedIn is skipped with no failure UI; manual Scan again still shows the failure UI; Keep works |
| DBR-6 | script and code review | The stubs ignore the round and the X since-time, so neither can be seen in the browser |
| DBR-7 | pass | Browser: setup, first scan, Scan again toast, Keep, Copy, Skip, Undo, a past day |
| DBR-8 | pass | Script: 2 on the first scan, 4 for the day, re-checked under the lock |
| DBR-9 | pass | Nit: the CONTRACTS result shape leaves out `skippedPlats` |
| Copy | pass | Settings hint at desktop width and at 375px; marketing card |

**Defect D1 (Medium):**
- **Repro:** click Scan again to join a background rescan, and make every source fail. The page stays on the scanning view with no actions.
- **Cause:** `DailyBrief.tsx:172` keeps the failed job's `{detail}` result, which has no `failed` field. That branch predates this feature.
- **Fix:** sent to R5.

**Inconsistency I1:** a click that joins a background run follows background rules, so a failing platform is skipped. PM decision: accepted, and documented in DIVERGENCES B21.

**Observation:** after rescans, the "Nothing new since this morning" toast is no longer accurate. It becomes "Nothing new since {time}" (R5).

## QA round 2: factory-qa on `147f012d`
- **Environment:** same as round 1. Screenshots are `shots/R2-*` and logs are `r2-*.log` in the same qa folder.
- **D1 (joined background rescan where every source fails):** pass.
  - The page now shows "A source didn't respond" with Try again and Keep this morning's brief (R2-03).
  - Keep returns to the brief with nothing changed (R2-04).
  - Try again (with sources healthy again) runs a manual scan and ends with one toast (R2-06).
- **Toast copy:** "Nothing new since {time of the last scan}" (R2-07).
- **Regressions:** all pass.
  - Manual Scan again with LinkedIn failing still shows "LinkedIn didn't respond" (R2-08).
  - A background run that adds nothing gives no scan view and no toast (R2-09).
  - A background run that adds 2 gives one toast and no scan view (R2-11, R2-12).
- **Typecheck:** pass.
- **Vitest:** 654 passed, 1 failed, 65 skipped. The one failure is the known openrouter parity test, which also fails on base.
- **Cosmetic, Low, accepted by the PM:** in a joined run where every platform fails, the skipped platforms show a check and the generic failure row sits on the last one. This follows from B21 and needs every platform to fail while the user watches.

**Tested revision:** `147f012d`. This is the release candidate for the PR. The `.factory` records added after it change no product code.

## PM pre-merge checks (PR kenny-io/radar#11)
- **Job retention:** `maintenance.ts` prunes finished jobs only after 14 days. The rule that a day with no scan job is due therefore can't be triggered on a live day.
- **Branch status:** `origin/main` has not moved since base `3fe684ea`, so the PR has no conflicts. No CI checks are configured.
- **Failed background jobs:** only the Daily Brief page reads `brief.scan` jobs, so a quiet failed rescan surfaces nowhere else. The Dashboard's failed item comes from calendar entries.
- **Per-minute queries:** `brief.rescan` runs `hasDay` and `scansOf` once a minute for each business with a brief. They use the `brief_days` (business, date) key and the `jobs_biz` (business_id, created_at) index, filtered by kind and ref. With 14-day retention, each scan covers only a small set of rows.

## Release
- **Before merging:** `main` had moved on (PR #10 merged as `1fcf699e`, which also touches `DailyBrief.tsx` and `DIVERGENCES.md`). The app synced it into the branch as merge commit `030b63ca` with no conflicts.
- **Checks on the combined tree:** `npm run typecheck` is clean. `npx vitest run` gives 665 passed, 1 failed, 65 skipped. The failure is the known openrouter parity snapshot.
- **Merge:** the owner approved it on 2026-10-26. PR kenny-io/radar#11 merged at 19:46:07Z as merge commit `6db9492f` on `main`.
- **Deploy:** GitHub deployment "radar / production" `7341878462` for `6db9492f` reached `success` at 19:48:34Z.
- **Web check:** `https://radar.thally.io/` serves the new card copy, "Up to two conversations from each every morning."
- **Worker check (`brief.rescan`):** not yet verified. The Railway CLI here is logged out, and the built-in browser isn't signed in to Railway or Radar. To confirm:
  - **Worker logs:** the worker should be enqueuing `brief.scan` jobs with `background:true`. Errors would show as `[brief.rescan]`, and a skipped platform as `source failed (background rescan, skipped)`.
  - **Thally's brief:** "Found at" should move to a time after the deploy, since the morning scan was more than 2 h earlier.
