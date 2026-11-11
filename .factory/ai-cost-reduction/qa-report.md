# QA report: ACR-Q1 (independent QA, AI cost reduction)

Date 2026-11-10. Tester: factory-qa. Nothing was committed, stashed, pushed or deployed; no source or test file was edited.

## 1. What was tested

| | |
|---|---|
| Worktree | `/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-demo-video-a33def` |
| Branch / HEAD | `kenny-dev/radar-ai-cost-audit-ec7d70` / `b8bbdd0e17a80ec19f71e9bf249df0704e0f42e6`, work uncommitted |
| Fingerprint, tracked changes | `git diff \| shasum -a 256` = `1d408e73178cc5333dd06d3ca0464623939526e9f697da6113dddddc133caeea` |
| Fingerprint, untracked source | sha256 of the sorted `shasum -a 256` list of the 15 untracked files under `src` = `baf933b3b28484638b23bf1f2fbfb78dbbe3cb8be836ea362dbff1852ffc948d` |
| Stability | Both hashes were identical at the start and at the end of the session: every result below is for this exact tree. |
| Size | 41 tracked files, 842 insertions, 204 deletions (`verification.md` says 840: the tree moved by two lines after that file was written), 15 new files. |
| Environment | macOS, Node 22.18, Postgres 15.15 at `127.0.0.1:54329`, dev stubs (`RADAR_DEV_STUBS=1`), no provider keys, no production access. |
| App under test | `npm run dev` (web + worker) on `http://localhost:3947`, variables exported in the shell (no `.env.local` written), `RADAR_AI_TIERS`, `RADAR_VISIBILITY_CADENCE`, `RADAR_SOCIAL_PACK_IMAGE` unset. |
| Test account | `acr-qa@radar-qa.test`, created through the sign-up form; the confirmation link was read from the dev-stub `outbox_emails` row. Business `fieldnote-qa.test`. |
| Browser | Claude desktop built-in browser, 1280×900 and 375×812. |

Scratch directory (probes, logs, email previews): `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-demo-video-a33def/70a79536-8490-4b3a-a3ee-2dbb6afe53f8/scratchpad/qa/` (called `$S` below).
Screenshots: `/Users/ekene/.claude/projects/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-demo-video-a33def/70a79536-8490-4b3a-a3ee-2dbb6afe53f8/tool-results/` (called `$SHOTS` below; file names start `mcp-Claude_Browser-blob-`).

## 2. Commands and real results

| Command | Result |
|---|---|
| `npm run typecheck` | clean (exit 0) |
| `env -u DATABASE_URL npm test` | 1531 passed, 537 skipped, 1 failed (123 files passed, 49 skipped, 1 failed). Log `$S/test-nodb.log` |
| `DATABASE_URL=…/radar_acr_qa_6f7c5af5 npx vitest run --no-file-parallelism` after `npm run db:migrate` | 2017 passed, 65 skipped, 1 failed (163 files passed, 9 skipped, 1 failed), 208 s. Log `$S/test-db.log` |
| The one failure | `src/server/ai/openrouter.qa.test.ts` > parity. Diff is one line: `i2.stored` `- "f883614e6a7dfb07"` / `+ "91d5409f50974af7"`. |
| Same test at the base commit (`git archive HEAD` into `$S/base`, run there) | 73 passed, 1 failed, the same one line. Baseline failure confirmed, not a regression. |
| GOLDEN compared field by field with `git show HEAD:` (`$S/golden-compare.mjs`) | 14 scenarios, 0 differences outside `rows`. `rows` differ in i1, i1b, p1, p3, p4, p5, p6, p7, p9, v1, v2 only (new prices, tokens on rejected attempts, new image and visibility rows). The only other change in the file is the `RADAR_AI_TIERS: 'off'` pin. |
| Existing tests weakened or deleted? | No. Existing test files only gained the `RADAR_AI_TIERS=off` pin, one corrected price (`gpt-6-sol` output 8 → 10), a comment, and new cases. No file deleted. |

## 3. My own probes (scripts in `$S`, none in `src/`)

1. **`RADAR_AI_TIERS=off` is byte-identical to the base commit** (`capture.mts`): 15 inputs (plain, schema, streamed, web search, web search + schema, small budgets, all nine tiered purposes, three user-waiting purposes) × 3 key sets (direct keys, OpenRouter + direct, xAI only), with no business choice. URL, header names, raw body string, order of requests and the answering model were compared between the base export and the working tree with `off`: `cmp` reports the three capture files identical. This covers the OpenRouter route, which the golden snapshot does not (it is the no-OpenRouter case).
2. **Resolution table** (`probe1-resolve.mts`), tiers unset / off:

   | Purpose (kind) | no choice | chose `grok-4.6` | chose the default | off, no choice |
   |---|---|---|---|---|
   | `brief.rank` (research) | haiku-5.5 low, task `utility` | same | same | opus-5.5, `research` |
   | `visibility.extract`, `article.meta` (writing) | haiku-5.5 low, `utility` | same | same | gpt-6-sol, `writing` |
   | `article.draft` (writing) | fable-5.2 medium → opus-5.5, `premium` | grok-4.6, `premium` | fable-5.2 medium → opus-5.5 (MT-4a) | gpt-6-sol, `writing` |
   | `calendar.topics` (research) | fable-5.2 medium → opus-5.5, `premium` | grok-4.6, `premium` | fable-5.2 → opus-5.5 | opus-5.5, `research` |
   | `social.post` | opus-5.5, `writing` | grok-4.6 | opus-5.5 | gpt-6-sol |
   | `support.answer` | opus-5.5 low | grok-4.6 low | opus-5.5 low | gpt-6-sol, no effort |
   | unknown purpose | opus-5.5, standard | grok-4.6 | opus-5.5 | gpt-6-sol |

3. **Prices** (`probe2-prices.mts`): 31 `costOf` values recomputed by hand from architecture §4, all equal. Includes Haiku 5.5 at 99,999 / 100,000 / 100,001 input tokens, GPT-6 at 272,000 / 272,001, Grok at 199,999 / 200,000, six no-price cases (null, never 0), per-image, per-request and search fees. Against a real `ai_calls` table: a route-reported cost of 0 is stored as 0 (wins over the table's 0.024), a reported 0.5 wins, an unknown model stores NULL, a 900-character error is stored as 500. The five Anthropic rates also match the Claude API reference bundled with this tool (cached 2026-11-03).
4. **`visibilityDue`** (`probe3-visdue.mts`): 21 boundary cases hold: Saturday 23:59 / Sunday 00:01 / Sunday 23:59 / Monday 00:01 at UTC+14 and UTC−11, a run 6 and 7 local days ago on both sides of local midnight, both New York clock changes (169 h and 167 h weeks), idle and dormant.
5. **Pack image** (`vprobe/pack.probe.test.ts`, real `createPack`, fetch and storage mocked):

   | Pack | aspect | OpenRouter request | generations | stored files |
   |---|---|---|---|---|
   | linkedin, x | 1.843 | `16:9`, crop-safe sentence | 1 | 1200×628, 1200×675 |
   | linkedin, x, reddit | 1.596 | `3:2`, crop-safe sentence | 1 | 1200×628, 1200×675, 1200×900 |
   | reddit | 1.333 | `4:3`, today's prompt | 1 | 1200×900 |
   | same three, `RADAR_SOCIAL_PACK_IMAGE=per_platform` | | `16:9`, `16:9`, `4:3`, today's prompt | 3 | same sizes |
   | same three, xAI only | 1.596 | `16:9` (xAI's own mapping) | 1, row $0.02 | same sizes |

6. **Account error inside a premium call** (`probe5-account-error.mts`): see DEF-2.

## 4. Browser scenarios (dev stubs)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| B1 | Sign up, confirm by link, set password, onboard `fieldnote-qa.test`, reach the dashboard | pass | `…1794315073876-n2hqkm.jpg` |
| B2 | Settings → AI models, new business: both rows show Claude Opus 5.5; two rows only (no utility or premium row) | pass | `…1794315126855-ty7g5d.jpg`; DB `businesses.ai` was `{}` |
| B3 | Claude Fable 5.2 is first in the list, description "Anthropic’s most capable model. Slowest and highest cost."; Fable 5.1 shows "The previous Fable model. Costs more than Fable 5.2." | pass | `…1794315133599-ivshor.jpg`, `…1794315151775-a5ohu9.jpg` |
| B4 | Choose Fable 5.2 (writing) and Fable 5.1 (research): toast "Ideas and writing now uses Claude Fable 5.2", both survive a reload | pass | `…1794315133599-ue7wk5.jpg`, `…1794315142246-8o72fv.jpg` |
| B5 | Choose Opus again: survives a reload, DB row `{"writing":"claude-opus-5.5","research":"claude-opus-5.5"}` (an explicit choice equal to the default) | pass | `…1794315151775-kqpl20.jpg` |
| B6 | `/performance?tab=ai`: grid, counters and `Last collected Nov 10` render | pass | `…1794315172994-qutyy6.jpg` |
| B7 | Add a prompt: exact toast "Prompt added. Radar is collecting its first answers now."; row added and filled | pass | `…1794315182661-pg3ii1.jpg` |
| B8 | Worker paused (SIGSTOP), two prompts added one second apart: two toasts, all ten cells of both rows show collecting; worker resumed: cells fill without a reload | pass | `…1794315209131-51njd7.jpg`, `…1794315213239-iz79sn.png`, `…1794315227216-g3hb9n.jpg` |
| B9 | "Collect now" on a No-data cell: toast "Response collected", cell shows its answer | pass | `…1794315233322-r2nxhx.jpg`, `…1794315241987-869l3i.jpg` |
| B10 | Approve an article and "Draft now" (premium + utility purposes through normal use), twice: once with Opus picked, once with GPT-6.1 Sol picked | pass | `…1794315286027-dp470x.jpg`; rows in §5 |
| B11 | Social pack with LinkedIn, X, Reddit, style Illustration: pack saves, three tabs, each image at its own size; Regenerate on X gives a new image ("Image generated") and a new file | pass (templates only) | `…1794315394964-37ot04.jpg`, `…1794315417479-j19h2g.jpg`, `…1794315417479-bq5mkc.jpg` |
| B12 | `/features/ai-visibility`: hero, facts ("Every week"), step 2, "In every result", FAQ "Once a week. Collect now runs a check on demand."; no night wording in text or HTML | pass | `…1794315456413-u3qe4y.jpg` + DOM check |
| B13 | `/` signed out: all five strings of §7 rows 1 to 5 present, no night wording in text or HTML | pass | `…1794315567070-wpf7vy.jpg` + DOM check |
| B14 | Blog post `/blog/does-chatgpt-recommend-you`: CTA "Radar asks five assistants your customers’ questions every week." | pass | DOM check |
| B15 | Regression: Settings, Performance, Calendar, Social, Dashboard, marketing pages at 1280 and 375 wide: no console errors, no 4xx/5xx (two aborted RSC prefetches caused by my own navigation), no horizontal overflow at 375 | pass | `…1794315528532-81rxgs.jpg`, `…1794315528533-kks3kc.jpg`, `…1794315542871-6bktbd.jpg` |

**Not seen in the browser:** with dev stubs the image model is off, so the pack rendered three brand templates. The one-generation-per-pack behaviour itself was not observable in the browser; it is proven only by mocked tests (`packImage.test.ts`, `spendRecords.db.test.ts`) and my probe 5.

Other checks: `og:description` of `/features/ai-visibility` is "Track whether ChatGPT, Perplexity, Gemini, Claude and Grok mention your business. See cited sites and turn missing answers into content with Radar." (no cadence claim; the cadence line lives only in the card image). `/llms.txt`, `/llms-full.txt`, `/pricing.md`, `/blog/rss.xml`: 200, no night/daily/weekly claim. `public/social/ai-visibility.png`: 1200×630, reads "Five assistants. Weekly checks. Clear next steps.", intact, and is the only changed file under `public/social`.

Emails (`node --import tsx scripts/preview-radar-emails.ts --output $S/emails`, 72 variants): all five AI visibility lesson variants say "Radar collects answers to a new question as soon as you add it, then checks every question once a week."; all four weekly AI report variants carry "Radar checks your tracked questions once a week. These answers were collected on 2026-11-08."; no "night" in any of the 72 previews.

## 5. Database after the browser session (`$S/ai_calls-final.txt`, `$S/visibility-jobs-final.txt`)

`visibility.run` jobs: one full first run (`vis-first:<bid>`, payload `{}`) and one prompt-scoped job per added prompt (`{"promptIds":["93e226dc…"]}`, `{"promptIds":["5bf6fc30…"]}`, `{"promptIds":["f91eb112…"]}`, singleton keys `vis-prompt:<id>`).

`ai_calls` (all `ok = true`; tokens and cost NULL because stubs report none; no `visibility`, `image` or `search` task rows, as designed for stubs):

| task | purpose | model | n |
|---|---|---|---|
| utility | `visibility.extract` | claude-haiku-5.5 | 25 |
| utility | `brief.rank`, `keywords.intent` | claude-haiku-5.5 | 1 each |
| utility | `article.meta`, `article.destat` | claude-haiku-5.5 | 2 each |
| premium | `calendar.topics` (first run, no choice) | claude-fable-5.2 | 1 |
| premium | `article.draft` (Opus explicitly picked: MT-4a) | claude-fable-5.2 | 1 |
| premium | `article.draft` (GPT-6.1 Sol picked: MT-4) | gpt-6.1-sol | 1 |
| research | `article.research`, `keywords.competitorDomains` | claude-opus-5.5 | 3 |
| writing | 11 standard purposes | claude-opus-5.5 (gpt-6.1-sol for `social.post` after it was picked) | 23 |

The utility rows written while GPT-6.1 Sol was the business's writing model stayed on Haiku 5.5 (UT-2).

## 6. Acceptance criteria

"Mock-proven" means the real code ran with only `fetch` and the database replaced. No request reached a real provider in any check.

| ID | Verdict | Evidence |
|---|---|---|
| UT-1 | pass | `tiers.test.ts` (exact six, each a purpose a caller really sends); probe 2; §5 rows |
| UT-2 | pass | `tiers.run.test.ts` utility cases (business choice ignored, Haiku → Luna → Grok); B2; §5 |
| UT-3 | pass | `tiers.run.test.ts` "RADAR_AI_TIERS"; probe 1 (byte-identical to base) |
| UT-4 | pass | dev-stub case in `tiers.run.test.ts`; none of the nine call sites is in the diff; onboarding, brief, calendar, draft all completed on stubs |
| EF-1 | partial | Request shapes mock-proven for OpenRouter, Anthropic, OpenAI, xAI, including both passes of a search + schema call. `output_config.effort` beside `format`, and no `thinking`/`temperature`, agree with the bundled Claude API reference. Whether each provider accepts the field for each model: not testable here |
| EF-2 | partial | One resend without the field, schema kept, 10-minute memory: mock-proven for a 400 naming the field and OpenRouter's 404. A rejection worded differently, or with another status, fails that attempt and the call fails over (not tested against a real provider) |
| EF-3 | pass | Probe 1 (off = base, all three routes); GOLDEN `calls` untouched; `tiers.run.test.ts` 18 on/off equality cases; headroom and three low-effort purposes tested |
| LG-1 | pass (mocks) | `engines.records.test.ts` (five engines × two routes, failures, empty answers); `spendRecords.db.test.ts` on the real table. Provider usage field names unverified |
| LG-2 | pass (mocks) | `images.records.test.ts`; GOLDEN i1/i1b; probe 5 |
| LG-3 | pass (mocks) | `search.records.test.ts` (retry writes its own row) |
| LG-4 | pass | `tiers.run.test.ts` rejected-answer block; GOLDEN p5 now carries 100/50 tokens and $0.0007 |
| LG-5 | pass | `record.test.ts` (pending, rejecting, throwing, lazy inserts; key redaction); diff scan: 13 call sites pass identity, usage and an error message only; `ai_calls` has no text column except `error` (≤ 500 chars). See OBS-6 |
| LG-6 | pass | no file under `drizzle/` or `src/server/db` changed; new `task` values fit the existing text column |
| PR-1 | partial | Table = architecture §4 (probe 3); null for unknown; reported cost wins, including 0. Anthropic rates confirmed against the bundled reference. OpenAI, xAI and Perplexity rates were not re-checked against their pages by QA |
| IM-1 | pass (mocks) | `packImage.test.ts`, `spendRecords.db.test.ts`, probe 5. Not observable in the browser |
| IM-2 | pass | Regenerate in the browser (B11, own file, seed +11); template styles and fallback, custom prompts, publish-time path mock-proven |
| IM-3 | pass | Saved pack in the DB: `imageUrl`, `imageMeta {bytes,type}` equal to the files on disk, `photo`, `seed`; 1200×628 / 675 / 900 |
| IM-4 | pass (mocks) | `packImage.test.ts`; probe 5 (three generations, today's prompt) |
| VW-1 | pass, with DEF-1 | `idle.test.ts`, `idle.cadence.db.test.ts` (real cron, real jobs table), probe 4 |
| VW-2 | pass | B7 to B9; `visibility.db.test.ts`; first run seen in §5; catch-up covered by `idle.cadence.db.test.ts` |
| VW-3 | pass | Sentence in all four report previews; `digestContent.test.ts`. The "run lands before the email" half is arithmetic (Sunday 02:00 local is Saturday 12:00 to Sunday 14:00 UTC), not a test (TQ-3) |
| VW-4 | pass | B12 to B14, emails, text endpoints, social card, repo-wide grep (no AI Visibility night/daily claim left in `src`, `docs`, `README.md`) |
| VW-5 | partial | Screens render and show `Last collected`; no staleness logic exists in `Performance.tsx`. Seen only with same-day data: a week-old grid and a week with no run were not exercised. No automated proof |
| VW-6 | pass | `idle.cadence.db.test.ts` nightly block keeps its old assertions; `idle.test.ts` |
| MT-1 | pass | `tiers.test.ts`; probe 2 (unknown purpose is standard) |
| MT-2 | pass | B2; probe 2; §5 writing rows on claude-opus-5.5 |
| MT-3 | pass (routing) | probe 2, §5 premium rows. Fable 5.2 behaviour itself: not testable here |
| MT-3a | pass | B3; `tiers.run.test.ts` (API id `claude-fable-5-2`, OpenRouter id, price); Fable 5.1 selected and saved in B4 |
| MT-3b | not testable here | Mid-stream and non-stream refusal, retention 400: mock-proven only (`tiers.run.test.ts`). OpenRouter's finish reason for a refusal is an assumption (architecture §13) |
| MT-4 | pass | B10 second draft: `premium / article.draft / gpt-6.1-sol`, utility rows still Haiku |
| MT-4a | pass | B5 + B10 first draft: explicit Opus in the DB, row `premium / article.draft / claude-fable-5.2` |
| MT-5 | pass (mocks) | `tiers.run.test.ts` (both premium models failing, none configured, timeouts); probe 6 ended on Grok without failing. See DEF-2 |
| MT-6 | pass | `tiers.test.ts` overrides; `off`, `premium`, `utility` values |
| NC-1 | pass | Every changed customer-visible string is in architecture §7 or Settings; action response shape unchanged (`visibility.db.test.ts`) |
| NC-2 | pass | §2 |

## 7. Defects

### DEF-1 (medium): a missed Sunday window is not caught up, so a business can go 14 days without a scheduled run
- Criteria: VW-1, VW-5 (and the copy of VW-4, which says "every week").
- Steps: `visibilityDue('active', tz, null, <any Monday to Saturday>)`, or with a full run 8 or more days old. `src/server/idle.ts` returns false unless the business-local weekday is Sunday. Shown by probe 4 ("idle on Wednesday", never run → false) and by reading `nightlyTick`.
- Expected: when the scheduler did not tick, or the enqueue failed, during the four hours of a business's Sunday 02:00–05:59 window (worker deploy, outage, queue stall), the run happens at the next opportunity.
- Actual: nothing runs until the following Sunday. That week has no collection, and the Monday report for it says "No answers were collected." Under the nightly schedule the same outage cost one night.
- Note: the engineers handled a failed enqueue (the mark is cleared) but only inside the window. No test covers a missed window (TQ-5). Architecture §11 lists "a week with no run" as detect-only.

### DEF-2 (low): a provider just marked unavailable is asked again in the same premium call
- Criteria: MT-5 (still met), cost and alert noise.
- Steps: `npx tsx $S/probe5-account-error.mts <worktree>`: direct keys for all three providers, Anthropic answers 402 "credit balance is too low", OpenAI 500, purpose `article.draft`, `retries: 0`.
- Expected: after the 402 marks Anthropic unavailable for 10 minutes, the plan skips Anthropic.
- Actual: requests are `claude-fable-5-2` (402) → `gpt-6-astra` (500) → `claude-opus-5-5` (402 again) → `grok-4.7` (200). Two "Anthropic unavailable for 10 min" warnings, two failed rows, two failure reports. The call succeeds.
- Cause: the standard step's routes are planned before the loop, and the loop re-checks only OpenRouter. Before this change a provider appeared once per plan.

### DEF-3 (low, informational): cost stays NULL for several of the requests this work set out to measure
- Criteria: LG-1, LG-2, PR-1 are met as written (null, never a guess). The owner's goal is not fully met on direct routes.
- Actual: every OpenAI image row (`gpt-image-1`, the default `OPENAI_IMAGE_MODEL`) logs NULL cost; every direct Gemini visibility row (`gemini-flash-latest`) logs NULL; direct Perplexity visibility depends on an unverified field (`usage.cost.total_cost`). Through OpenRouter the reported cost is used. If production runs images or those two engines on direct keys, "where do the credits go" still has no dollar figure for them; row counts and tokens are there.

### DEF-4 (low, accessibility, older code now more exposed): a collecting cell is announced as "not collected"
- Steps: add a prompt on `/performance?tab=ai`; read the accessibility tree while its cells show the collecting indicator.
- Expected: the cell's name says it is collecting.
- Actual: buttons are named "ChatGPT: not collected" while the screen shows the pulsing collecting state (B8 tree dump). `Performance.tsx` changed only the toast, so this predates the work; adding a prompt now always puts five cells in this state.

### Test-quality findings
- TQ-1 (VW-4): `visibilityCadenceCopy.test.ts` reads the source files for the new strings. It guards against a revert but mirrors the implementation; rendered pages were proven by B12 to B14, not by the suite.
- TQ-2 (VW-5): no test. Nothing shows a week-old grid, the trend views with one observation a week, or a week with no run.
- TQ-3 (VW-3): nothing ties `VIS_WEEKDAY` to the Monday 08:00 UTC report; changing either would not fail a test.
- TQ-4 (EF-3): the golden snapshot pins `off` for the no-OpenRouter case only. `off` through OpenRouter is byte-identical today (probe 1) but no test in the suite compares it with the base.
- TQ-5 (VW-1): no case for a missed Sunday window (DEF-1).
- TQ-6 (NC-2): the parity test is red at baseline and stays red (R7). A permanently failing snapshot hides any future change in that scenario; re-pinning the one hash is a one-line decision.
- No criterion other than VW-5 lacks a real behavioural test. `tiers.run.test.ts`, the three `*.records.test.ts`, `packImage.test.ts`, `idle*.test.ts` and `visibility*.test.ts` drive the real code and state expectations independently (hand-computed costs, wall-clock strings beside every instant).

## 8. Observations for the PM or owner (behave as designed)

- OBS-1: after a full run on Monday to Saturday (onboarding, catch-up), the coming Sunday is skipped, so the next collection is 8 to 13 days later. Six of seven new customers get this, while the site says "Once a week" (R4 accepted this).
- OBS-2: R1 also applies to businesses that picked Claude Opus 5.5 for writing before this release, when it was not the default. Their drafts, refresh drafts and calendar topics move to Fable 5.2 (twice Opus's price) without any action by them.
- OBS-3: with `RADAR_AI_TIERS=off` the requests are the old ones, but responses are not handled identically: an OpenRouter `content_filter` finish and an Anthropic `refusal` now fail the attempt and fail over (architecture §11 says intended, no switch).
- OBS-4: a premium purpose served by a business's own model is logged `task = 'premium'` (seen: `premium / article.draft / gpt-6.1-sol`). Spend grouped by `task` will count that as premium spend.
- OBS-5: adding a prompt is now an immediate five-engine collection. I found no cap on prompts per business and no rate limit on the action (a cap is listed as out of scope).
- OBS-6: `ai_calls.error` holds the provider's error text (keys redacted, ≤ 500 chars). A provider that quotes the request in an error body would put prompt text in a row. This was already true for text rows; visibility, image and search rows are new carriers.
- OBS-7: with only xAI configured, a pack containing Reddit is generated at `16:9`, so the Reddit file keeps 75% of the width (the architecture's 89% figure is OpenRouter's `3:2`).
- OBS-8 (outside this work): in the Reddit brand template a dark circle overlaps the headline (`…1794315417479-bq5mkc.jpg`); `anthropic.ts` and `engines.ts` still send `web_search_20250305`, which the bundled reference lists as the older tool version.

## 9. Not tested, and why

| Item | Why |
|---|---|
| Any real provider behaviour: effort fields accepted, Fable 5.2 answers, refusals, the retention 400, OpenRouter's translation of effort and finish reasons, usage field names (Perplexity, Gemini, OpenRouter image, OpenAI image) | No provider keys; dev stubs and mocks only |
| One generation per pack as seen by a user, and the quality of the crops | Stubs render templates; needs a staging image key |
| Quality of Haiku 5.5 on `brief.rank` and the other utility purposes; Opus 5.5 within `support.answer`'s 12 s | Needs real models |
| OpenAI, xAI and Perplexity published rates | Not re-read by QA; the table matches architecture §4 |
| The AI Visibility screens and the weekly email with week-old data or an empty week | Would need aged data; only same-day data was exercised |
| The real Sunday tick over a week, and the email after it | Simulated by the DB tests (aged jobs), not observed in the running app |
| Authorization and tenant boundaries of `visibility.addPrompt` | Not re-tested: the action's gate is unchanged in the diff; one account and one business were used |
| Saving from the Settings select by keyboard | Native `<select>`; the add-prompt form was submitted with Return, the select was set through the automation tool, not arrow keys |

## 10. Cleanup

- Web and worker stopped; nothing listens on 3947; no process from this worktree remains. Browser tab closed.
- Databases `radar_acr_qa_6f7c5af5` and `radar_acr_qa_6f7c5af5_app` dropped; no `radar_acr_qa%` database remains. No other database was touched.
- Removed what my dev server created (all git-ignored): `.next`, `next-env.d.ts`, `.data/qa-acr-uploads`.
- `git status --short` is identical to the snapshot taken before testing; the only file I wrote in the repository is this report (inside the already untracked `.factory/ai-cost-reduction/`).
- `scripts/preview-lifecycle-emails.ts` and `scripts/preview-weekly-education.mjs` were not run.

## 11. Recommendation

No acceptance criterion failed in what can be exercised on stubs, and the two automated suites match the expected numbers with the one baseline failure. Ready for the owner's commit decision, with these conditions before it is relied on in production: decide DEF-1 (catch-up for a missed Sunday), and run one staging pass with real keys for the items in §9 (effort fields, Fable 5.2, usage fields, a three-platform pack). DEF-2 to DEF-4 can follow.
