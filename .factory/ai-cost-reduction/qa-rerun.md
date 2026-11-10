# QA rerun: ACR-Q2 (fixes for DEF-1, DEF-2, DEF-4, TQ-3)

Date 2026-11-10. Tester: factory-qa. Nothing committed, stashed, pushed or deployed; no source or test file edited. Every result is from dev stubs and mocked providers.

## 1. What was tested

| | |
|---|---|
| Worktree | `/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-demo-video-a33def` |
| Branch / HEAD | `kenny-dev/radar-ai-cost-audit-ec7d70` / `b8bbdd0e17a80ec19f71e9bf249df0704e0f42e6`, work uncommitted |
| Fingerprint, tracked changes | `git diff \| shasum -a 256` = `27b880066f734105901893539c2a310935f702a7ceaf35a8c2dad15db7411f8e` |
| Fingerprint, untracked source | sha256 of the sorted `shasum -a 256` list of the 17 untracked files under `src` = `b012f02fdea5ab24f1c31bf411f7e917dde93390fac40f6c6b7a33053881cccf` |
| Stability | Both hashes were identical at the start, after the suites and at the end. |
| Size | 41 tracked files, 1210 insertions, 222 deletions; 17 new files (two more than in ACR-Q1: `visibility/collectOne.test.ts`, `visibility/emptyRun.db.test.ts`). |
| Environment | As ACR-Q1: Node 22.18, Postgres 15.15 at `127.0.0.1:54329`, app on `http://localhost:3947`, variables exported in the shell, built-in browser. |
| Test accounts | `acr-qa2@radar-qa.test` (`fieldnote-qa2.test`), `acr-qa3@radar-qa.test` (`fieldnote-qa3.test`), both created through the sign-up form. |

Scratch for this rerun: `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-demo-video-a33def/70a79536-8490-4b3a-a3ee-2dbb6afe53f8/scratchpad/qa/r2/` (called `$R2` below).
Screenshots: `/Users/ekene/.claude/projects/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-demo-video-a33def/70a79536-8490-4b3a-a3ee-2dbb6afe53f8/tool-results/` (files `mcp-Claude_Browser-blob-…`).

## 2. Suites

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `env -u DATABASE_URL npm test` | 1550 passed, 552 skipped, 1 failed (124 files passed, 50 skipped, 1 failed). `$R2/test-nodb.log` |
| `DATABASE_URL=…/radar_acr_qa_0329073d npx vitest run --no-file-parallelism` | 2051 passed, 65 skipped, 1 failed (165 files passed, 9 skipped, 1 failed), 212 s. `$R2/test-db.log` |
| The one failure, both runs | `openrouter.qa.test.ts` parity, one line: `i2.stored` `f883614e6a7dfb07` → `91d5409f50974af7` |
| GOLDEN versus `HEAD`, field by field | 14 scenarios, 0 differences outside `rows` (no `calls` block moved) |

## 3. Prior findings

| Item | Verdict | Evidence |
|---|---|---|
| DEF-1 missed Sunday not caught up | **fixed** | §4 |
| DEF-2 provider asked again after being marked unavailable | **fixed**; last-resort re-ask kept by design (R11) | §5 |
| DEF-3 cost NULL on some direct routes | not changed (informational; `IMAGE_PRICE` still has only `grok-imagine-image`) | `src/server/ai/prices.ts` |
| DEF-4 collecting cell announced as "not collected" | **fixed**; no automated test guards it (N-2) | §6 |
| TQ-1 copy guard reads source strings | not changed | `visibilityCadenceCopy.test.ts` |
| TQ-2 no test for VW-5 | not changed | |
| TQ-3 nothing ties the run weekday to the Monday report | **fixed** | §7 |
| TQ-4 `off` through OpenRouter not pinned in the suite | not changed; my capture is still byte-identical to base on all three key sets | `$R2/cap/` |
| TQ-5 no case for a missed Sunday | **fixed** | §7 |
| TQ-6 parity test stays red | not changed (R7) | §2 |

## 4. DEF-1: the weekly rule (my probes, not the engineer's tests)

**Pure rule, 65 cases, all hold** (`$R2/probe-visdue2.mts`, output `$R2/probe-visdue2.txt`). Expectations were written from brief VW-1/1a/1b before running.
- The ACR-Q1 reproduction: never run, on a Wednesday → now `true` (was `false`). Last run two Sundays ago, now Monday → `true`.
- The 21 earlier boundary cases with new expectations: seven "never run" cases are now due on any weekday; a run 6 local days ago is now due on Sunday (was not); Saturday 23:59 / Sunday 00:01 at UTC+14 and UTC−11 still decide by the local date; both New York clock-change weeks hold; dormant never.
- 2-day threshold on Sunday: run Friday 23:59 → due; Saturday 00:01, Saturday 23:59, Sunday 00:01 → skipped.
- 8-day threshold Monday to Saturday (30 cases): 7 local days → not due, 8 → due, with the boundary at local midnight.
- Next due night after a full run on each weekday: Sunday 7 days, Monday 6, Tuesday 5, Wednesday 4, Thursday 3, Friday 2, **Saturday 8**. If that night is lost: 8 days after the run, **9 after a Saturday run**.

**Multi-week simulation through the real `nightlyTick`, `lastFullVisibilityRuns`, cron marks and jobs table** (`$R2/sim-weekly.mts`, output `$R2/sim-weekly.txt`): hourly ticks for six weeks from 2027-02-27, crossing New York's clock change on Sunday 2027-03-14; each enqueued job is given the simulated time and a scripted outcome; 45 businesses in six passes and five timezones.

| Pass | What happened | Gaps between full runs that collected (local days) |
|---|---|---|
| A. nothing missed, first run on each weekday (New York) | Every scheduled run on Sunday (03:05 on the clock-change Sunday, still in the window) | Saturday start 8, then 7s; all others ≤ 7 |
| B. scheduler down all of Sunday 03-14 (UTC+14) | Run on Monday 03-15, then Sunday 03-21 | 8, then 6, 7 |
| C. the Sunday 03-14 job fails (UTC−11) | Retried Monday 03-15, then Sunday 03-21 | 8, then 6, 7 |
| D. the Sunday 03-14 run collects nothing, previous good run a week earlier (Dubai) | Retried Monday 03-15, then Sunday 03-21 | 8, then 6, 7 |
| D. empty Sunday 03-14 after a good off-cycle run on Wednesday 03-10 | Not retried Monday: retried **Thursday 03-18**, when the Wednesday run is 8 days old; Sunday 03-21 runs as usual | 3, 8, 3, 7 |
| D. good off-cycle run Saturday 03-13 (Sunday 03-14 skipped), Sunday 03-21 empty | Retried Monday 03-22 | **9** |
| E. off-cycle full run on each weekday of one week (UTC) | Monday to Friday: that Sunday still runs. Saturday: Sunday skipped, next Sunday runs. Sunday 01:00: that Sunday's cron skipped | ≤ 7, Saturday 8 |
| F. every run empty Sunday to Thursday (out of credit) | One run per night Sunday to Thursday, good on Friday, Sunday runs again | 12 (five lost nights, outside the "one lost Sunday" claim) |
| F. idle; dormant | Idle: Sundays only. Dormant: none | 7 |
| F. prompt-scoped runs on Saturday and Sunday 01:00 | Sunday cron still runs | 7 |
| F. Saturday run with a result from before `collected` existed | Counts: Sunday skipped | 8 |
| F. never had a full run | First night (a Friday), then Sunday two days later, then weekly | 2, 7 |

Answers to the PM's questions:
- **The 8 and 9 day figures are right.** With nothing missed the longest gap is 8, and only after a Saturday run. With one lost Sunday (missed, failed or empty) it is 8, and 9 in exactly the stated combination: a Saturday full run, the next day's Sunday skipped, the following Sunday lost, caught up on the Monday. I found no other single-loss sequence above 8.
- **A run outside 02:00 to 05:59 local:** none. 0 of the scheduler's enqueues in any pass were outside the window; every one had payload `{}` and key `vis-run:<bid>`.
- **Two scheduler enqueues on one local day:** none (maximum 1 per business per local day in every pass, including the nightly-retry cases).
- **Two full runs on the same local day: yes, in one sequence.** An off-cycle full run that does not take the day's mark (the first run after onboarding), started between 00:00 and 05:59 local, that fails or collects nothing, is followed by the scheduler's run in that night's window. Seen in pass F: first run Sunday 01:00 empty, cron 02:05 the same Sunday. It is one retry of a run that produced nothing, and the base commit would also have run that night. A first run that succeeds inside the window (03:30) is not followed by a second run. The catch-up on return takes the mark (`touchActive`, read not simulated), so it cannot double.
- **`RADAR_VISIBILITY_CADENCE=nightly` equals the base commit.** `$R2/sim-nightly.mts` ran nine simulated days of hourly ticks for 30 businesses (five timezones × active, idle with and without earlier runs, dormant, Autopilot) through the base export's `nightlyTick` and through the working tree's with the variable set: 140 enqueues each, files identical (`cmp`). The same run without the variable gives 49. Caveat: `lastRuns` reads the database clock, so the idle counts in this simulation are skewed the same way on both sides; it proves equality, not the idle cadence itself (that is the `nightly` block of `idle.cadence.db.test.ts`, which passes).

## 5. DEF-2: providers marked unavailable during a call (`$R2/probe-def2.mts`, output `$R2/def2-new.txt`)

One process per scenario, real `ai.run`, `retries: 0`, rows read back from a real `ai_calls` table.

| Scenario | Requests | Rows | Failure reports |
|---|---|---|---|
| The ACR-Q1 case: premium draft, Anthropic 402, OpenAI 500, xAI ok | `claude-fable-5-2` 402 → `gpt-6-astra` 500 → `grok-4.7` 200. **No second Anthropic request** (ACR-Q1 saw four requests, with `claude-opus-5-5` asked after the 402) | 3 | 2 |
| Premium, Anthropic 402, OpenAI ok | fable 402 → astra 200 | 2 | 1 |
| Premium research (`calendar.topics`), Anthropic 402, OpenAI 500 | fable 402 → astra 500 → `gpt-6-sol` 500 → grok 200. Opus skipped; OpenAI is asked twice because a 500 does not mark it unavailable | 4 | 3 |
| Premium via OpenRouter, OpenRouter 500, Anthropic 402, OpenAI 500 | fable (OR) → fable direct 402 → astra (OR) → astra direct → opus (OR) → grok direct 200. Opus direct skipped | 6 | 5 |
| Premium, OpenRouter 402 | fable (OR) 402 → fable direct 200 | 2 | 1 |
| Utility, Anthropic 402, OpenAI 500; then a second call | haiku 402 → luna 500 → grok 200; second call starts at luna | 5 | 3 |
| Standard, Anthropic 402, xAI 500 | opus 402 → grok 500 → sol 200 | 3 | 2 |
| **Every provider 402**, premium | fable 402 → astra 402 → grok 402 → `gpt-6-sol` 402. Opus is skipped; the last route is still asked, so OpenAI gets two requests | 4 | 4 |
| Every provider 402, utility | haiku → luna → grok, one each | 3 | 3 |
| Anthropic 402 and no other key | fable 402 → opus 402 (last resort) | 2 | 2 |
| Tiers off: four account-error scenarios, direct and OpenRouter | Compared with the base export: requests, rows, reports and warnings **identical** in all four (`$R2/def2-off-base.json`, `$R2/def2-off-new.json`) | 3, 3, 3, 6 | 2, 3, 2, 5 |

Byte-identity capture for `RADAR_AI_TIERS=off` against the base export, rerun on this tree: identical on all three key sets (`cmp`). The tiers-on capture is also identical to the ACR-Q1 capture, so the fix changed no successful request.

## 6. DEF-4 and regressions, in the browser

| # | Scenario | Result | Evidence |
|---|---|---|---|
| R1 | `/performance?tab=ai`, 35 cells: accessible names are "… mentioned at position N" (18), "… not mentioned" (11), "… not collected" (6) | pass | accessibility tree dump; `…1794318108223-s2ubtq.jpg` |
| R2 | Worker paused, prompt added: toast "Prompt added. Radar is collecting its first answers now."; the new row's five buttons are named "ChatGPT: collecting" … "Grok: collecting"; visible content is the same pulsing "…" as before | pass | tree dump; `…1794318123139-r3qyeq.jpg` |
| R3 | "Collect now" on a not-collected cell while paused: that one cell becomes "ChatGPT: collecting"; after resuming, "not mentioned", the panel shows the answer, the prompt's cells fill without a reload | pass | `…1794318139226-n7s7qc.jpg`, `…1794318154804-w184fj.jpg` |
| R4 | Nothing visible changed on the screen: counters, legend, grid, toast and layout match ACR-Q1 (same stub data: 18 of 29, 10, 6, `Last collected Nov 10`); 375 px wide: no overflow, 35 labelled cells | pass | as above |
| R5 | Job results: `visibility.run` full `{"total":35,"collected":29}`, prompt-scoped `{"total":5,"collected":4}`, `visibility.collect` still `{"status":"not-mentioned"}` | pass | `$R2/visibility-jobs-final.txt` |
| R6 | First-run Dashboard rows (second account, worker paused at commit): three rows "Queued", then "Working" with progress, AI visibility "Done · Ready to view."; the panel gives way to the normal Dashboard when all three finish | pass | `…1794318360520-cymrkr.jpg`, `…1794318370159-zlvql8.jpg` |
| R7 | Settings → AI models: Opus 5.5 on both rows by default, 11 models, two rows; Fable 5.2 / 5.1 save with toasts and descriptions and survive a reload; Opus picked again survives a reload | pass | `…1794318184024-trfzds.jpg` + DOM values |
| R8 | Social pack, LinkedIn + X + Reddit, Illustration: saved, files 1200×628 / 675 / 900 with matching `imageMeta`; Regenerate on X gives "Image generated", a new file and seed 71 → 82 | pass (templates only) | `…1794318244392-rl2dhe.jpg`, `…1794318244392-dbvi8a.jpg` |
| R9 | No console errors, no 4xx/5xx on these pages; `ai_calls` tasks and models as in ACR-Q1 (utility on Haiku 5.5, `calendar.topics` premium on Fable 5.2, writing and research on Opus 5.5) | pass | `$R2/ai_calls-final.txt` |

Not repeated in this rerun (no change in the diff since ACR-Q1 touches them): marketing pages, text endpoints, the social card image, email previews, the article-draft rows for MT-4 and MT-4a.

## 7. Test quality, re-judged

- **TQ-3 fixed.** `idle.cadence.db.test.ts` "the weekly run and the weekly report" drives the real `collectAiReports` send gate, the real report period (`weeklyRecommendationShare`) and the real `nightlyTick` for 27 UTC offsets, and asserts the run is queued inside the reported period, before the send and under 48 hours before it. Moving the run weekday or the send day fails it.
- **TQ-5 fixed.** A missed Sunday, a failed Sunday, a business whose every run fails, and an enqueue failure are covered against the real cron and jobs table (`idle.cadence.db.test.ts`), and the empty-run cases against the real `collectAll` (`emptyRun.db.test.ts`), including the Thursday retry I observed in pass D.
- **No new test mirrors the implementation.** The new cases state dates, weekdays, request sequences and gaps as literals and run the real functions. Two soft spots, neither a defect: `idle.test.ts` asserts the longest gap `toBe(VIS_OVERDUE_DAYS)` (the constant, though the thresholds are pinned as `[0, 2, 8, 10]` in the same file), and its "schedule over time" block models the job history itself and calls only `visibilityDue` (the database tests cover the marks and the query).
- TQ-1, TQ-2, TQ-4, TQ-6 stand as reported.

## 8. New findings

- **N-1 (information).** Two full runs on one local day are possible in the one sequence described in §4.
- **N-2 (low, test gap).** The DEF-4 fix has no automated test; no test file asserts the collecting label. It is proven by R2 and R3 only.
- **N-3 (information, docs).** An empty or lost Sunday is not always retried the next night: after a good full run earlier that week the retry waits until that run is 8 days old (Thursday in pass D). `docs/LAUNCH.md` says this exactly; `README.md` and `.env.example` shorten it to "the next night".
- **N-4 (information).** While every assistant fails for a business, the scheduler queues one full run per night for it (documented in `docs/LAUNCH.md`). Out-of-credit calls fail without spend; a failure mode that bills and then returns nothing would be retried nightly.
- **N-5 (information).** When every provider is out of credit, the last route of a premium plan is still asked, so OpenAI receives two requests in that call (R11 keeps this on purpose).

No new defect that needs a fix was found.

## 9. Still not testable here

Real provider behaviour (effort fields, Fable 5.2 answers and refusals, the retention 400, usage field names); one generation per pack as a user sees it, and crop quality; model quality on the utility tier; the screens and the weekly email with week-old or missing data (VW-5); a real week of ticks in the running app (simulated above against a real database with scripted outcomes).

## 10. Cleanup

Web and worker stopped, nothing listens on 3947, browser tab closed. Databases `radar_acr_qa_0329073d`, `radar_acr_qa_0329073d_app` and `radar_acr_qa_0329073d_sim` dropped; no `radar_acr_qa%` database remains; no other database touched. Removed the git-ignored files my server created (`.next`, `next-env.d.ts`, `.data/qa-acr-uploads`). `git status --short` is identical to the snapshot taken at the start of the rerun; the only repository file written is this report.

## 11. Recommendation

DEF-1, DEF-2 and DEF-4 are fixed and TQ-3 and TQ-5 are closed; nothing regressed in what ACR-Q1 covered. Ready for the owner's commit decision. The condition from ACR-Q1 still applies before relying on it in production: one staging pass with real keys for the items in §9. DEF-3, N-2 and the remaining TQ items can follow.
