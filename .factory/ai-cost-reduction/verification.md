# Verification

Tested state: branch `kenny-dev/radar-ai-cost-audit-ec7d70`, HEAD `b8bbdd0e`, uncommitted working tree
(41 tracked files changed, 840 insertions, 204 deletions, plus 15 new source and test files). Nothing is committed,
so a result below applies to the tree as it stood when the check ran.

## Baseline (before any change, 2026-11-10)

- `npm run typecheck`: clean.
- `npm test`: 1314 passed, 522 skipped (DB tests without `DATABASE_URL`), 1 failed:
  `src/server/ai/openrouter.qa.test.ts` parity golden snapshot, one line (`i2.stored`, a stale template-image hash).

## Engineer runs

| Task | Check | Result |
| --- | --- | --- |
| ACR-E1 | `npx vitest run src/server/ai` after follow-ups | 322 passed, 1 failed (parity) |
| ACR-E1 | full suite with a throwaway Postgres, `--no-file-parallelism` | 1941 passed, 65 skipped, 1 failed (parity) |
| ACR-E3 | its 13 test files with a throwaway Postgres | 147 passed |
| ACR-E2 | full suite, no database | 1531 passed, 537 skipped, 1 failed (parity) |
| ACR-E2 | full suite with a throwaway Postgres, `--no-file-parallelism` | 2017 passed, 65 skipped, 1 failed (parity) |

Each engineer broke their new behaviour on purpose (mutation checks) and confirmed the tests failed, then restored
the files.

## PM integration run (all three tracks together, 2026-11-10)

- `npx tsc --noEmit`: clean.
- `env -u DATABASE_URL npx vitest run`: 123 files passed, 49 skipped, 1 failed; 1531 tests passed, 537 skipped,
  1 failed.
- The failure is the baseline parity test and its diff is still exactly one line:
  `- "f883614e6a7dfb07"` / `+ "91d5409f50974af7"` (`i2.stored`). No request (`calls`) block of the golden file moved,
  which is the proof that `RADAR_AI_TIERS=off` sends today's requests byte for byte.

## Independent QA, first pass (ACR-Q1, `qa-report.md`)

- Typecheck clean; 1531 passed without a database, 2017 with Postgres; the parity test the only failure, failing
  with the identical one line at the base commit.
- `RADAR_AI_TIERS=off` captured byte-identical to the base commit for 15 inputs on three key sets, including the
  OpenRouter route.
- Browser on dev stubs: Settings AI models, AI Visibility (toast, collecting state, Collect now), marketing pages,
  social pack, 72 email previews: all as specified; no console or network errors.
- No acceptance criterion failed. Defects: DEF-1 medium (a missed Sunday was never caught up), DEF-2 low (a
  provider just marked unavailable asked again in the same call), DEF-3 informational (some direct routes log a
  null cost), DEF-4 low (collecting cells announced as "not collected").

## Fixes after QA and PM integration run 2 (2026-11-10)

- DEF-1: weekly rule revised (architecture section 15, R10, R12, R13); DEF-2: R11; DEF-4: accessible name.
- ACR-E1 `npx vitest run src/server/ai`: 331 passed, 1 failed (parity).
- ACR-E3 its 17 files with Postgres: 213 passed.
- PM run on the combined tree (41 tracked files changed, 1210 insertions, 222 deletions, 18 new files):
  `npx tsc --noEmit` clean; `env -u DATABASE_URL npx vitest run`: 1550 passed, 552 skipped, 1 failed. The failure
  is the parity test and its diff is the same single `i2.stored` line.

## Not verified

- No request was made to a real provider. Every request shape (effort fields, Fable 5.2, refusals, usage fields) is
  proven against mocked responses. Unverified provider details are listed in `architecture.md` section 13 and in
  the ACR-E2 handoff (Perplexity, OpenRouter image and OpenAI image usage field names).
- Crop quality of the shared social-pack image has not been judged by eye (dev stubs render templates).
- Production `ai_calls` could not be read, so the savings are estimates until the new rows exist.

## QA rerun (ACR-Q2, `qa-rerun.md`)

Tested tree: `git diff | shasum -a 256` = `27b880066f734105901893539c2a310935f702a7ceaf35a8c2dad15db7411f8e`, 17 new
files. After the rerun the PM changed one sentence in `README.md` (the catch-up wording QA flagged as N-3); no code
changed after the tested fingerprint.

- Typecheck clean. `env -u DATABASE_URL npm test`: 1550 passed, 552 skipped, 1 failed. With Postgres and
  `--no-file-parallelism`: 2051 passed, 65 skipped, 1 failed. The failure in both is the parity test with the same
  single `i2.stored` line; no `calls` block of the golden file differs from `HEAD`.
- DEF-1 fixed: 65 rule cases and a six-week simulation through the real cron; no run outside 02:00 to 05:59 local;
  the scheduler never queued two runs for a business in one local day. Longest gap 8 local days with nothing
  missed, 9 in one combination (a Saturday run, then a lost Sunday the week after).
- `RADAR_VISIBILITY_CADENCE=nightly` equals the base commit: 140 enqueues each over nine simulated days for 30
  businesses, identical output.
- DEF-2 fixed: the original case is now three requests with no second Anthropic request. With tiers off, four
  account-error scenarios are identical to the base commit, and the byte-identity capture still shows no difference.
- DEF-4 fixed, seen in the browser accessibility tree; no automated test (N-2).
- Browser regressions (Settings AI models, add-prompt toast and collecting state, Collect now, first-run Dashboard
  rows, three-platform pack): unchanged, no console or network errors.
- Open, none blocking: DEF-3 (null cost on some direct routes), N-1 (a failed or empty first run between 00:00 and
  05:59 local is followed by the scheduler's run the same night), N-2, TQ-1, TQ-2, TQ-4, TQ-6.

## Release status

Implemented and tested on dev stubs and mocked providers. Not committed, not pushed, not deployed. Not yet
exercised against a real provider: one staging pass with real keys is the remaining check before production.
