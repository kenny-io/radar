# Verification

Tested revision: `b7a13489` (code), base `e7e597ef`. Later commits on the branch change docs and these records only. Local Postgres 16 on 127.0.0.1:55433, stub providers, no production access, no real email.

| Check | Command | Result |
| --- | --- | --- |
| Baseline, affected tests on `e7e597ef` | `npx vitest run src/server/services/autopilot src/server/services/lifecycle/engagement.test.ts src/server/services/lifecycle/dispatch.test.ts` | 4 files, 64 passed |
| Same, on `b7a13489` (engineer, confirmed by QA) | same | 4 files, 105 passed |
| Lifecycle folder | `npx vitest run src/server/services/lifecycle --no-file-parallelism` | 13 files, 172 passed. In parallel on one database it is flaky, as on main |
| Typecheck | `npm run typecheck` | clean, QA probes included |
| Full suite, fresh database, serial (QA, on `dff3ba02`) | `npx vitest run --no-file-parallelism` | 4192 passed, 1 failed, 75 skipped. The failure is the known `openrouter.qa.test.ts` parity snapshot. Not rerun after the QA-1 fix |
| Independent probes (QA) | `npx vitest run --config .factory/email-cadence/qa/vitest.qa.config.mjs --no-file-parallelism` | 17 of 17, also with the process timezone set to Asia/Tokyo and America/Los_Angeles |
| Settings → Emails in a real browser (QA, `dff3ba02`, localhost, stubs) | 1280 and 375 wide | Approved wording shown, no overflow; a keyboard toggle saved and survived reload. Mouse toggle not exercised; phone layout judged from element geometry |

## Criteria

| ID | Verdict | Evidence |
| --- | --- | --- |
| EC-01 | pass | 7 local days at about 15 runs a day: 1 email per local day; 7 racing runs: 1 job, 1 day mark |
| EC-02 | pass | Nothing before 08:00 local; brief and pack items arrive together; cut-off two hours later |
| EC-03 | pass | Failed posts and standing problems carried; a program enabled today does not carry yesterday's post. Late Daily Brief replies are not emailed (PM decision 1) |
| EC-04 | pass after fix | QA-1 below |
| EC-05 | pass | 9 days of daily new work across two ordinary businesses: sends at hour 0 and hour 168 only, at most 3 sections, no source tombstoned without a send |
| EC-06 | pass locally | Old per-day marks, an old-shape job already sent today, a queued never-attempted reminder, retries with identical body and key. Production queues could not be read |
| EC-07 | pass | The diff touches none of those paths; their tests pass |
| EC-08 | pass | Docs and Settings copy match the code |

## Defect found and closed

**QA-1 (medium, EC-04).** A social account that expired after a post on the same channel had already been emailed for another reason was marked as told without being emailed. Cause: the post's own key was accepted as proof from the old per-day scheme. Fix in `b7a13489`: an old-scheme mark counts only if it is older than the business's first day mark. Both reproductions pass; the rollout cases still hold.

## Not verified

- Production marks, queues and a real inbox.
- The worker end to end, a business timezone changed during a day, and a failed delivery retried the next day.
- A worker on the old code overlapping the new one for a few minutes can repeat one standing problem as an item inside the day's single email (read from code, not run).
