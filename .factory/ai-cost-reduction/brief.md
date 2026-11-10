# AI cost reduction: fixes customers do not see

Owner request, 2026-11-10: "We are constantly running out of credits." The audit found that background work runs on
models far costlier than the task needs, and that the two likely largest costs (AI Visibility answers, images) are not
recorded in `ai_calls`. The owner approved the changes below, which alter no screen, copy or setting.

Branch `kenny-dev/radar-ai-cost-audit-ec7d70`, base `b8bbdd0e`. Backend only: no UI work, no design step.

## Scope

1. A cheap internal "utility" model tier for scoring, classification and extraction calls.
2. Low reasoning effort on those calls.
3. Complete spend records: AI Visibility engine calls, image generations and Perplexity searches go to `ai_calls`;
   attempts that were billed and then rejected keep their tokens and cost.
4. A correct price table for cost logging.
5. One image-model generation per social pack, sized per platform, instead of one per platform.

Added by the owner mid-build, 2026-11-10 ("Also change nightly runs to weekly, and dynamically use stronger models
for stronger tasks like using Fable and Astra for more important tasks and setting Opus as default"):

6. Scheduled AI Visibility collection moves from nightly to weekly.
7. Radar picks the model by how important the task is: cheap for utility work, Claude Opus 5.5 as the default,
   Claude Fable and GPT-6 Astra for the most important tasks.

Items 6 and 7 are customer-visible (cadence copy, the default shown in Settings). Items 1 to 5 are not.

## Not in scope (owner decisions still open)

A cap on AI Visibility prompts per business; removing models from the Settings catalogue; the morning brief for
dormant businesses; OpenRouter versus direct routing; batch pricing; prompt caching; any cost dashboard or admin
screen. "Dynamically" is read as per task, from one table: no per-request judgment of how hard an input is.

## Acceptance criteria

### UT: utility tier
- UT-1 These purposes run on the utility tier: `brief.rank`, `visibility.extract`, `keywords.intent`,
  `analysis.classify`, `article.meta`, `article.destat`. No other purpose joins it.
- UT-2 The utility model is never read from a business's Settings choice and never appears in Settings. It has a
  cheap default, an environment override, and fails over to a cheap model at another configured provider.
- UT-3 A kill switch restores today's routing for those six purposes (the business's writing or research model)
  without a deploy of new code.
- UT-4 Schemas, validation, saved writing instructions, dev stubs and what each caller stores are unchanged.

### EF: reasoning effort
- EF-1 Utility calls ask for low reasoning effort on every route (OpenRouter and each direct provider), in the form
  that provider accepts for that model.
- EF-2 A provider or model that rejects the effort setting never fails the task because of it.
- EF-3 With tiers switched off, every request is byte-identical to today's. With tiers on, a standard call sends
  the body its model gets today, except that a Claude model may get a larger `max_tokens` (thinking headroom) and
  three user-waiting purposes (`support.answer`, `article.rewrite`, `brief.rewrite`) ask for low effort. Only
  utility and premium attempts carry other extras.

### LG: spend records
- LG-1 Every AI Visibility engine request, through OpenRouter or the engine's own API, success or failure, writes
  one `ai_calls` row: business, purpose, the model asked, provider, latency, tokens when reported, cost when the
  route reports it or it can be computed, `ok`, and a short error.
- LG-2 Every image-model generation attempt writes one row the same way. Template renders write none.
- LG-3 Every Perplexity Search API request writes one row.
- LG-4 A text attempt the provider answered (and billed) but Radar rejected (empty answer, schema validation
  failure) records its tokens and cost with `ok = false`.
- LG-5 Recording never throws into, delays or fails the work it records. Rows hold no prompt text, answer text or
  credentials.
- LG-6 No destructive schema change. Prefer no migration.

### PR: prices
- PR-1 The price table used for cost logging matches current published rates, with the source and date noted
  beside it. A model with no known rate logs a null cost, never a guess. A cost reported by the route still wins.

### IM: one image per social pack
- IM-1 Creating a pack whose style goes to the image model makes one image-model generation for the pack, and each
  platform still gets its own file at its own size.
- IM-2 Unchanged: regenerating one platform's image, custom image prompts, template styles, the template fallback
  when the model fails, and images made at publish time.
- IM-4 One setting restores a generation per platform without new code.
- IM-3 The stored post fields (`imageUrl`, `imageMeta`, `photo`, `seed`) keep their shape, and the posting size and
  type checks still pass.

### VW: weekly AI Visibility
- VW-1 Scheduled AI Visibility collection runs once a week per business, on its Sunday night, for active
  businesses and businesses with Autopilot on; idle stays weekly; dormant stays paused. Only a full
  `visibility.run` job that did not fail counts as a run (a run for a few new prompts, or a crashed run, does not).
- VW-1a The Sunday run is skipped only when a full run started on that Sunday or the Saturday before. A business
  whose newest full run is 8 or more local days old (a missed or failed Sunday) is collected on the next night,
  whatever the weekday, and returns to Sunday the week after. With nothing missed, the longest gap between full
  runs is 8 local days (after a Saturday run). With one lost Sunday it is 8, or 9 in one combination (a Saturday
  run followed by a lost Sunday the week after).
- VW-1b A full run in which no cell was collected (every assistant failed) does not count as the week's run; the
  business is retried, at most once per local day.
- VW-2 Unchanged: the first run after onboarding, the one catch-up run when an idle or dormant business returns,
  and "Collect now" on a cell. A prompt the user adds is collected at once (it used to wait for that night).
- VW-3 The weekly run lands before that business's weekly AI report email, so the email reports data from the same
  week. If that cannot hold for a business, the email says how old the data is rather than implying it is fresh.
- VW-4 Everywhere Radar tells a customer or a crawler how often AI Visibility is checked (app, emails, marketing
  pages, `llms.txt`, `llms-full.txt`, `pricing.md`, docs), it says weekly. No daily or nightly claim remains.
- VW-5 The AI Visibility screens and trend views read correctly with one measurement a week: no stale, missed or
  empty state caused by the cadence alone.
- VW-6 One setting restores nightly collection without new code.

### MT: model by task importance
- MT-1 Every `purpose` belongs to exactly one tier (utility, standard, premium) in one table. A purpose missing
  from the table is standard.
- MT-2 Standard defaults to Claude Opus 5.5 for writing as well as research (writing was GPT-6 Sol).
- MT-3 Premium runs Claude Fable 5.2 first (owner decision, 2026-11-10: "Claude announced Fable 5.2 yesterday which
  is supposedly cheaper so implement it as well") and GPT-6 Astra at the other provider. Initial premium purposes
  (the PM's choice, the owner may revise): `article.draft`, `suggestions.refreshDraft`, `calendar.topics`.
- MT-3a Claude Fable 5.2 is added to the model catalogue, the API id map, the price table and, only if OpenRouter
  lists it, the OpenRouter id map. Claude Fable 5.1 stays selectable so an existing choice keeps working.
- MT-3b A Fable 5.2 request that is declined (`stop_reason: "refusal"`, including mid-stream) or rejected for the
  account's data-retention setting counts as a failed attempt and fails over; it never saves an empty or partial
  result and never marks the whole provider unavailable.
- MT-4 A business that has explicitly chosen a model in Settings keeps it for the standard and premium tasks of
  that kind (writing or research). It never applies to utility tasks. Settings shows the new default.
- MT-4a Choosing the default model again returns premium tasks to the premium chain: "Settings shows Claude Opus
  5.5" means the same routing whether it is shown by default or was picked.
- MT-5 When no premium model is available the task runs on the standard model and the fallback is logged; it does
  not fail for that reason.
- MT-6 Each tier's model has an environment override, and one setting restores today's two-model routing.

### NC: change limits
- NC-1 For items 1 to 5: no UI, copy, action response shape or setting changes. For items 6 and 7 the only visible
  changes are the cadence copy (VW-4), the add-prompt toast, the collected-on sentence in the weekly AI report, the
  default shown in Settings, the Claude Fable 5.2 entry there, and Claude Fable 5.1's description.
- NC-2 `npm run typecheck` passes and `npm test` has no new failures against the baseline.

## Constraints

- No commit, push or deploy without the owner's word; work stays in the working tree.
- No production access. Verification runs on dev stubs, unit tests and the local throwaway Postgres.
- Verify provider parameter shapes and prices against current provider documentation, not memory. Model names here
  (Claude 5.5, GPT-6, Grok 4.7) are newer than most reference material.
- Known risk accepted by the owner: `brief.rank` moves from Claude Opus 5.5 to a small model, so ranking quality
  may shift. UT-3 is the way back.
