# Verification

All generation evidence is **stubbed** (`RADAR_DEV_STUBS=1`, no AI keys). It proves the saved instructions reach the writing-model boundary with the right sets per surface. It does not prove a live model follows them.

## Revisions
- Base `2d41a801`.
- Independent QA (Q1) ran on working-tree fingerprint `a1904d34fd81e524`. Report: `qa.md`.
- After Q1 the PM changed one file (`src/features/settings/WritingInstructions.tsx`, O1 below). Final fingerprint `abe117019402f660`. Automated checks and the PM browser recheck below ran on this final tree.
- Fingerprint command: `(git diff HEAD -- . ':!.factory'; git ls-files --others --exclude-standard -- src docs | sort | xargs cat) | shasum -a 256 | cut -c1-16`

## Environment
Node 22.18. Throwaway Postgres 16 container on `127.0.0.1:54331` (databases for tests and for browser QA; removed after delivery). Browser: Claude desktop built-in browser pane on `http://localhost:3418`. No production data, no deployed environment.

## Automated checks (final tree)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | pass |
| Full suite | `DATABASE_URL=…/radar_writing_instructions_tests RADAR_DEV_STUBS=1 RADAR_BILLING=off npx vitest run --no-file-parallelism` | 1,508 passed, 65 skipped, 1 failed |
| Build | `NEXT_DIST_DIR=… npm run build` | pass |

The one failure is the baseline exception: `src/server/ai/openrouter.qa.test.ts > parity: OPENROUTER_API_KEY unset…`, a raster hash mismatch (`f883614e6a7dfb07` expected, `91d5409f50974af7` received) that fails identically at `2d41a801`. Baseline without a database at `2d41a801`: 1,076 passed, 371 skipped, 1 failed (same test). The feature adds 112 tests in 7 files; all pass.

## Independent QA (fingerprint `a1904d34fd81e524`)
WI1–WI11 and QA1 pass; details and evidence per criterion in `qa.md`. Summary of how each was established:
- Browser: WI1, WI2 (Owner), WI3, WI10; generation per surface for WI4–WI6 with stub log evidence; WI7 and WI9 with a second business.
- Test and inspection only: Admin/Editor saves and concurrent edits (WI2); `suggestions.refreshDraft` (WI4); daily and auto packs (WI5); scheduler and Autopilot triggers (WI11); WI8 rests mainly on cleaner tests because the stub does not follow instructions.

## O1 fix and PM recheck (final tree)
QA observation O1: text over the 1,500 limit was dropped without warning when the user left the section. Fixed by the PM (two lines): an over-limit draft is kept for the return visit, and a save that completes meanwhile no longer discards it. Rechecked by the PM in the browser as Owner, not independently re-verified:

| Scenario | Result |
|---|---|
| Saved value, paste 1,501 characters, open AI models, return | draft kept, "Too long to save" shown |
| Shorten the kept draft to a valid value | saves; shown after leaving and returning |
| Paste over the limit, restore the saved value, blur, leave, return | saved value shown, no stale draft |
| Paste over the limit while an earlier save is in flight, leave, return | draft kept (this race failed before the second line of the fix) |
| Valid edit, leave before the autosave timer | edit saved on leaving |
| Save rejected (page fetch rejected for this action), leave, return, Try again | text kept with "Not saved.", retry saves |

Stored value after the run matched the last saved text.

## Not verified
- Live-model compliance with instructions.
- `suggestions.refreshDraft`, scheduled drafting, Autopilot and daily packs after instructions exist: tests and shared code paths only, not observed in the browser.
- A real network outage (save failure was simulated), screen reader output, other browsers.
- Nothing is pushed, merged or deployed.

## Evidence
Git-ignored, local only: `.data/writing-instructions/qa/` (QA logs and screenshots `01`–`09`), `.data/writing-instructions/final/` (final typecheck, suite and build logs), `.data/writing-instructions/baseline-*.log`.
