# Q1 independent QA: custom writing instructions

Recommendation: **accept for commit / draft PR.** No blocking defects. One low-severity UX observation (O1). Live-model compliance not verified (no keys); all generation evidence is **stubbed**.

## Revision and environment
- Worktree `.claude/worktrees/radar-custom-writing-instructions-2d11b9`, branch `kenny-dev/radar-custom-writing-instructions-2d11b9`, HEAD `2d41a801` + uncommitted feature changes.
- Fingerprint `a1904d34fd81e524` at start and at end. Mid-run it read `0b8c05693ba87093` only because `next dev` rewrote `tsconfig.json`; with that file excluded it was `a1904d34fd81e524`, and it matched again after `git checkout -- tsconfig.json`.
- Node 22.18, Postgres container `radar-wi-db` (127.0.0.1:54331). No `.env`; no AI keys in the environment.
- Browser: Claude desktop built-in browser pane (`mcp__Claude_Browser__*`) against `http://localhost:3418`, 1280x900 and 390x844. Not Playwright.
- QA database `radar_wi_qa` (created by QA, migrated, seeded three times): business A `902fbd26…` (owner `dev@radar.local`, plus `qa-viewer@radar.local` added as Viewer by SQL), business B `c360a64e…` (owner `qa-b@radar.local`). `email_verified_at` set by SQL in this database only.
- Interruption: the machine suspended for about 8.5 hours mid-run. Shell and one request stalled, and the browser pane lost its session cookie (act returned 401; the session row was still valid to Dec 9). Treated as environment, not product; signed in again and repeated the interrupted step.

## Commands
```
npm run typecheck                                                        # exit 0
DATABASE_URL=…/radar_writing_instructions_tests RADAR_DEV_STUBS=1 RADAR_BILLING=off npx vitest run --no-file-parallelism
DATABASE_URL=…/radar_writing_instructions_tests RADAR_DEV_STUBS=1 RADAR_BILLING=off NEXT_DIST_DIR=.next-wi-qa-build npm run build   # exit 0
DATABASE_URL=…/radar_wi_qa npm run db:migrate ; RADAR_DEV_STUBS=1 npx tsx scripts/dev-seed.ts (also with SEED_EMAIL=qa-b@…, qa-viewer@…)
DATABASE_URL=…/radar_wi_qa RADAR_DEV_STUBS=1 RADAR_BILLING=off NEXT_DIST_DIR=.next-wi-qa APP_URL=http://localhost:3418 npx next dev -p 3418
(same env) npx tsx src/worker/main.ts
```
- Suite: 127 files passed, 1 failed, 9 skipped; 1,508 tests passed, 1 failed, 65 skipped. The one failure is the known baseline `src/server/ai/openrouter.qa.test.ts > parity: OPENROUTER_API_KEY unset…`; its diff is the same single line as the baseline log (`f883614e6a7dfb07` expected, `91d5409f50974af7` received), not a prompt diff.
- New tests (112 across 7 files) all pass. Read in full: they assert behavior (final `system` string at the stub boundary, exact block text, stored jsonb, HTTP status and copy through the real act route, cleaned output), not implementation details. The db test compares every call of a business with instructions against one without and requires the difference to be exactly the expected block.

## Results by criterion
| | Result | How |
|---|---|---|
| WI1 | pass | Browser: Content nav entry and `/settings?section=writing` (from another stored tab); four general rows; six add buttons until used; labels `Writing instructions: <set>`; 390px `documentElement.scrollWidth` 390; keyboard-only tab order textarea → textarea → add button → new textarea (focus moves in). |
| WI2 | pass | Browser as Owner: type → "Saved" → reload persists; counter; 1,500 saves; 1,501 pasted → inline error in error tone, `aria-invalid`, no request, stored value unchanged; clear and whitespace-only remove the key; direct POST 1,501 → 400 `too_long` with copy; Viewer sees Owner's values. Admin/Editor saves covered by db test only. |
| WI3 | pass | Browser as Viewer: read-only focusable fields, note shown, no add row, typing has no effect; direct POST → 403 "You don't have permission to do that."; stored value unchanged. |
| WI4 | pass (stubbed) | `article.draft`, `article.meta`, `article.rewrite` ×2 logged all + articles only; `article.research`, `article.destat`, `calendar.*` logged nothing. `suggestions.refreshDraft`: db test only (see Not verified). |
| WI5 | pass (stubbed) | New pack LinkedIn + X + Reddit: three `social.post` blocks, each all + social + own platform only. Regenerate text (Reddit): all + social + Reddit. Daily/auto packs: db test and shared code path only. |
| WI6 | pass (stubbed) | Scan: `brief.reply` ×6 (Reddit, LinkedIn, X; Hacker News got all + community only because no `hn` set was saved), `brief.brand` ×2 (X, LinkedIn), `brief.posts` ×2 founder and company (all + social + LinkedIn + X). Rewrites: reply → all + community + Reddit; feed post → all + social + X. |
| WI7 | pass | Business B with nothing saved: scan + rewrite (11 writing calls) logged no block. Business A after clearing all seven sets (`instructions: {}` left in the row): regenerate + rescan logged no block. Byte-identity by test and inspection (`run()` passes the caller's `system` untouched when the block is empty). |
| WI8 | pass (stubbed + tests + inspection) | Browser: with Reddit instruction "Always include https://example.com/pricing and say 87% of customers agree", saved Reddit pack text (new and regenerated) and all Brief drafts contain no link and no "87%", disclosure present. The stub does not follow instructions, so this alone is weak; the stronger evidence is the engineer's cleaner tests with swayed model output and that `social/rules.ts`, `brief/rules.ts` and the article number allow-list are not in the diff (call sites add one property each). |
| WI9 | pass | B's workspace payload has `instructions: {}` and none of A's text; B's generations logged no block; A's owner → B's act route 404, B's owner → A's 404; Viewer 403. `events`: 12 `action.settings.instructions` rows, each `{input:{set}, result:{ok:true}}`; no instruction text in any table except `businesses.ai` of A. `Workspace.ai` keys are `writing`, `research`. Changing the writing model kept the instructions; later instruction saves kept the model. |
| WI10 | pass | Brand voice shows "For rules by content type or platform, use Writing instructions." and the link opens the section even with another tab stored. Section copy states what, when and that accuracy and platform rules still apply; says "Radar"; no model or provider name. |
| WI11 | pass by inspection and test | User-triggered runs used the same jobs and functions as the scheduler (`article.draft` job, `createPack` → `writePost`, `brief.scan`). No scheduled or Autopilot run fired after instructions were saved, so the scheduler trigger itself was not observed in the browser. |
| QA1 | pass | Typecheck and build pass; no new suite failures; tests cover resolution, layering, all nine sites, empty case, validation, roles, isolation. Stubbed evidence only. |

## Observation
- **O1 (low, UX).** Text over the limit is dropped without warning when the user leaves the section. Steps: Settings → Writing instructions, put 1,501 characters in a set that already has a saved value, see "Too long to save…", click AI models, click Writing instructions. Expected (arguably): the over-limit draft is still there, as it is after a failed save. Actual: the field shows the previously saved value. Nothing wrong is stored. The brief only requires that saving is blocked, so this is a PM call.

## Not verified
- Live-model compliance (a draft visibly following an instruction): no keys; not attempted.
- `suggestions.refreshDraft` in the browser: the stubbed Search Console connect opens a popup that this browser tool closes, so the connection stayed "skipped" and no suggestion was reachable. Covered by `writingInstructions.db.test.ts` only.
- Save-failure path was simulated by rejecting the page's fetch for `settings.instructions` (text kept, "Not saved." + Try again, toast with retry, text kept across a tab switch, retry saved). A real network outage was not used.
- Admin and Editor saves, two members editing concurrently: db test only.
- Scheduled / Autopilot / daily-pack triggers after instructions exist: not observed in the browser.
- Screen reader output, browsers other than the built-in pane.
- Console: only the HTTP errors caused by the negative tests above (401, 404, 400); no script errors.

## Evidence (git-ignored, `.data/writing-instructions/qa/`)
`typecheck.log`, `vitest-full.log`, `build.log`, `web.log` (rewrites, Regenerate text), `worker.log` (drafts, packs, scans), screenshots `01`–`09`. Stub lines: `grep -n "ai:stub\|^For \|^| " worker.log web.log`. Worker log lines 2–29 (article), 84–134 (pack), 135–307 (Brief scan); web log lines 125–252 (two article rewrites, Regenerate text, two Brief rewrites).
