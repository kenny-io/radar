# AI cost reduction: architecture (ACR-A1)

Contract: `.factory/ai-cost-reduction/brief.md` (UT, EF, LG, PR, IM, VW, MT, NC). Base `b8bbdd0e`, branch
`kenny-dev/radar-ai-cost-audit-ec7d70`. Provider facts were checked on 2026-11-10; sources are in §12.
Nothing here needs a migration. All new switches are environment variables read at call time.

Adapters stay on raw `fetch` (the existing pattern in `src/server/ai/adapters/*`); no SDK is introduced.

## 0. Decisions in one screen

| # | Decision |
|---|---|
| D1 | The tier is derived from `purpose` in one table (`src/server/ai/tiers.ts`). **No call site changes**: the six utility and three premium callers keep `ai.run('writing' \| 'research', …)`. `AiTask` stays `'writing' \| 'research'`. |
| D2 | Utility = `claude-haiku-5.5`, then `gpt-6-luna`, then `grok-4.7` (last resort), all at low effort. Never reads `businesses.ai`. |
| D3 | Standard default = `claude-opus-5.5` for writing and research. `FALLBACKS` is unchanged. A standard call sends no effort field: for a given model the request is the one that model gets today. |
| D4 | Premium = `claude-fable-5.2`, then `gpt-6-astra`, then the standard chain. Effort `medium`, +8,000 `max_tokens` headroom, 360 s minimum timeout. An explicit Settings choice for the kind replaces the premium chain. |
| D5 | One switch: `RADAR_AI_TIERS`. `off` = today's two-model routing, byte for byte. `premium` = utility off. `utility` = premium off. Unset = both on. |
| D6 | Effort travels on `ProviderCall.effort` (no `AiInput` field: callers do not choose it). A provider that rejects it gets one resend without it. |
| D7 | One recorder, `recordAiCall()` in `src/server/ai/record.ts`, and one price table in `src/server/ai/prices.ts`. Text, visibility, images and search all write through it. |
| D8 | A refusal (`stop_reason: "refusal"`) is a failed attempt that skips that model on every route. Anthropic's server-side `fallbacks` parameter is not used. |
| D9 | A pack makes one image-model generation at the geometric mean of its platforms' aspect ratios, then cover-crops one file per platform. |
| D10 | Scheduled visibility runs on the business's **Sunday** night, when no **full** run was started in the previous 7 local calendar days. `RADAR_VISIBILITY_CADENCE=nightly` restores today's code path. |
| D11 | A prompt the user adds is collected at once (it used to wait for that night's batch, which no longer exists). |

## 1. Model tiers (UT, MT)

### 1.1 `src/server/ai/tiers.ts` (new, pure; imports only `@/lib/constants`)

```ts
export type AiTier = 'utility' | 'standard' | 'premium';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
export const PURPOSE_TIER: Record<string, AiTier> = {
  'brief.rank': 'utility', 'visibility.extract': 'utility', 'keywords.intent': 'utility',
  'analysis.classify': 'utility', 'article.meta': 'utility', 'article.destat': 'utility',
  'article.draft': 'premium', 'suggestions.refreshDraft': 'premium', 'calendar.topics': 'premium',
};
export const tierOf = (purpose: string): AiTier => PURPOSE_TIER[purpose] || 'standard';   // MT-1

export const LEGACY_DEFAULT = { writing: 'gpt-6-sol', research: 'claude-opus-5.5' } as const;
export const UTILITY_FALLBACKS = ['claude-haiku-5.5', 'gpt-6-luna', 'grok-4.7'];
export const UTILITY_MIN_TOKENS = 2048, PREMIUM_TOKEN_HEADROOM = 8000, PREMIUM_MIN_TIMEOUT_MS = 360_000;

export function tiersOn(): { utility: boolean; premium: boolean; legacy: boolean };
/** The standard default for a kind: LEGACY_DEFAULT when legacy, else RADAR_AI_{WRITING,RESEARCH}_MODEL, else AI_DEFAULT. */
export function standardDefault(kind: 'writing' | 'research'): string;
/** `boost` marks the attempts that get the tier's extras: 'utility' = token floor, 'premium' = headroom and minimum timeout. */
export interface Step { chosen: string; fallbacks: string[]; effort?: Effort; boost?: 'utility' | 'premium' }
export interface Resolved { tier: AiTier; logTask: string; chosen: string; steps: Step[] }
export function resolve(kind: 'writing' | 'research', purpose: string, settings: Record<string, any>, fallbacks: Record<string, string[]>): Resolved;
```

`resolve` rules (`explicit = settings[kind]`, a catalogue id or undefined):

| Mode / tier | `steps` | `logTask` (→ `ai_calls.task`) |
|---|---|---|
| legacy (`RADAR_AI_TIERS=off`), any purpose | `[{ chosen: explicit \|\| LEGACY_DEFAULT[kind], fallbacks: FALLBACKS[kind] }]` | `kind` |
| utility on, purpose is utility | `[{ chosen: utilityModel, fallbacks: UTILITY_FALLBACKS, effort: 'low', boost: 'utility' }]`. `settings` is not read. | `'utility'` |
| premium on, purpose is premium, no `explicit` | `[{ chosen: premiumModel, fallbacks: [premiumFallback], effort: premiumEffort, boost: 'premium' }, { chosen: standardDefault(kind), fallbacks: FALLBACKS[kind] }]` | `'premium'` |
| premium on, purpose is premium, `explicit` set (MT-4) | `[{ chosen: explicit, fallbacks: FALLBACKS[kind] }]` | `'premium'` |
| everything else (standard, or a tier that is switched off) | `[{ chosen: explicit \|\| standardDefault(kind), fallbacks: FALLBACKS[kind] }]` | `kind` |

`Resolved.chosen` is `steps[0].chosen`; `Resolved.tier` is `tierOf(purpose)` and is informational (routing reads only `steps`). With utility switched off, `brief.rank` is a `research` call again and the
other five are `writing` calls again, because their call sites never changed.

### 1.2 Environment (all read at call time; same value on web and worker)

| Variable | Default | Effect |
|---|---|---|
| `RADAR_AI_TIERS` | unset = `utility,premium` | Comma list of tiers that are on. `off` = legacy: no utility, no premium, no effort, no headroom, writing default `gpt-6-sol`; every variable below is ignored. Unknown words are ignored. |
| `RADAR_AI_UTILITY_MODEL` | `claude-haiku-5.5` | Catalogue id. Not in the catalogue → default, one `console.warn`. |
| `RADAR_AI_WRITING_MODEL`, `RADAR_AI_RESEARCH_MODEL` | `AI_DEFAULT` (`claude-opus-5.5`) | Standard default per kind. |
| `RADAR_AI_PREMIUM_MODEL` / `RADAR_AI_PREMIUM_FALLBACK` | `claude-fable-5.2` / `gpt-6-astra` | Premium chain. |
| `RADAR_AI_PREMIUM_EFFORT` | `medium` | `low \| medium \| high \| xhigh`. |
| `RADAR_AI_EFFORT` | on | `off` = never send an effort field on any route. |

### 1.3 `src/lib/constants.ts`

- `AI_DEFAULT = { writing: 'claude-opus-5.5', research: 'claude-opus-5.5' }` (MT-2).
- `AI_MODELS`, Anthropic list, first entry added: `{ id: 'claude-fable-5.2', l: 'Claude Fable 5.2', d: 'Anthropic’s most capable model. Slowest and highest cost.' }`.
  The 5.1 entry stays, reworded: `d: 'The previous Fable model. Costs more than Fable 5.2.'`.
- `AI_TASKS` is untouched, so the utility and premium tiers never render in Settings (UT-2).

### 1.4 Settings (MT-4)

`aiPrefsOf` in `src/server/workspace.ts` becomes `{ writing: b.ai?.writing || standardDefault('writing'), research: … }`.
The client already renders `B.ai[kind]` from the server, so Settings shows Opus in tiered mode and GPT-6 Sol under
`off`. `settings.ai` is unchanged and remains the only writer of `businesses.ai.{writing,research}`; a business row
has those keys only when a member picked a model, which is what "explicit choice" means.

### 1.5 `src/server/ai/index.ts`

- `DEFAULT_API_IDS['claude-fable-5.2'] = 'claude-fable-5-2'`. `OPENROUTER_IDS['claude-fable-5.2'] = 'anthropic/claude-fable-5.2'`
  (listed today with Google, Bedrock, Azure and Anthropic endpoints at $8/$40).
- `routes(task, chosen, fallbacks = FALLBACKS[task], force = true)`: with `force === false` an empty result stays
  empty instead of forcing `chosen`. Existing two-argument callers and tests are unaffected.
- `ProviderCall` gains `effort?: Effort`. `ProviderResult` gains `searches?: number` (web-search tool calls billed).
- `run()`:

```ts
const settings = await aiSettingsFor(opts.businessId);
const r = resolve(task, input.purpose, settings, FALLBACKS);
const chosen = r.chosen;
const plan = env.devStubs ? [{ modelId: chosen, via: 'direct' }]
  : dedupe(r.steps.flatMap((s, i) => routes(task, s.chosen, s.fallbacks, i === r.steps.length - 1)
      .map(x => ({ ...x, effort: effortOn() ? s.effort : undefined, boost: s.boost }))));   // dedupe on modelId+via
const skipModels = new Set<string>(); let premiumOver = false;
for each route:
  if (skipModels.has(modelId) || (route.boost === 'premium' && premiumOver)) continue;
  const base = input.maxTokens || 4000;
  maxTokens = route.boost === 'utility' ? Math.max(base, UTILITY_MIN_TOKENS) : route.boost === 'premium' ? base + PREMIUM_TOKEN_HEADROOM : base;
  timeoutMs = input.timeoutMs || defaultTimeout(base, !!input.webSearch);   // from the caller's value, as today
  if (route.boost === 'premium') timeoutMs = Math.max(timeoutMs, PREMIUM_MIN_TIMEOUT_MS);
  call.effort = route.effort;
  ...attempt loop (§3.3 for its try/catch)...
  in catch: if (e?.refusal) skipModels.add(modelId);
            if (route.boost === 'premium' && isOpenrouterTimeout(e)) { premiumOver = true; break; }
```

  `isOpenrouterTimeout` is the existing helper (`e.timeout`, `AbortError`, `TimeoutError`); it is provider-neutral.
  Everything else in `run()` (breaker checks, `directNext`, retries, cooldowns, final report) is unchanged.
- MT-5 is the existing line `if (modelId !== chosen) console.warn('[ai] … used X (fallback from Y)')` plus the
  `ai_calls` row (`task = 'premium'`, `model` = the model that answered). No premium model configured, both refused,
  both failing: the plan simply continues into the standard step.
- Dev stubs (UT-4): `stubRun` is still keyed by `input.purpose` and is called exactly as today. Only the `model`
  and `task` written to `ai_calls` differ in dev. Saved writing instructions are applied from `settings` before
  routing, whatever the tier (`article.meta` keeps `instructions: { surface: 'article' }`).

### 1.6 Why these models

- Utility `claude-haiku-5.5`: $0.10/$0.50, the same price as `gpt-6-luna`; same provider and structured-output path
  (`output_config.format`) as the standard default, so one account carries the normal load. Luna is the cross-provider
  fallback at the same price. `grok-4.7` ($2/$6) is reached only when Anthropic and OpenAI are both unavailable on
  both routes; without it `brief.rank` and `visibility.extract` (no heuristic fallback) would fail outright.
- Premium `claude-fable-5.2`: owner decision. I found no reason against it. It is on OpenRouter and on the direct
  API, costs less than 5.1, and has the same request surface as the Claude 5.5 models the adapter already serves.
  Its two operational conditions are in §2.4 (data retention) and §2.3 (refusals).

## 2. Reasoning effort (EF) and the Claude 5.x request surface

### 2.1 Request shapes (`c.effort` set; nothing is sent when it is undefined)

| Route | Field | Verified |
|---|---|---|
| Anthropic Messages (direct) | `output_config: { effort }`. With a schema: `output_config: { format: {…}, effort }`, one object. Never send `thinking`, `temperature` or `tool_choice`. | Yes |
| OpenAI Responses (direct) | `reasoning: { effort }` | Yes (`reasoning.effort`; `low` and `medium` are not among the values the page excludes for any GPT-6 model) |
| xAI Responses (direct, same adapter) | `reasoning: { effort }` | Yes (`low/medium/high/xhigh` on grok-4.7 and grok-4.6) |
| OpenRouter chat completions, every family | `reasoning: { effort }` | The parameter and its values, yes; every endpoint of the five models involved lists `reasoning` in `supported_parameters`, so `require_parameters: true` still routes. How OpenRouter translates effort for Claude 5.x is not documented (§13). |

Effort applies to every HTTP request of the call, including both passes of a web-search-plus-schema call and the
plain-JSON retry.

### 2.2 EF-2: `src/server/ai/adapters/effort.ts` (new)

```ts
/** A provider said no to the effort field itself. */
export const isEffortRejection = (e: any) => { const s = Number(e?.status), m = String(e?.message || '');
  return (s === 400 && /effort|reasoning/i.test(m)) || (s === 404 && /parameter|support/i.test(m)); };
/** Build-and-send with effort; on a rejection send once more without it and remember that for 10 minutes. */
export async function withEffort<T>(key: string, effort: Effort | undefined, send: (effort?: Effort) => Promise<T>): Promise<T>;
```

- `key` is `` `${routeBase}:${apiModel}` `` (`openrouter:`, `https://api.openai.com/v1:`, …). A remembered key sends
  no effort until the 10 minutes pass; one `console.warn` per rejection.
- Every `fetchJson`/`fetch`/`openrouterChat` call in the three adapters is wrapped, at the request, not at the stream
  consumer: a 400 arrives before any delta, so a resend never duplicates streamed text.
- Order matters in `anthropic.ts` and `openrouter.ts`: the effort wrapper is innermost, the existing schema-400
  plain-JSON fallback is outside it. The effort test does not match `output_config`, so a 400 about
  `output_config.format` still takes the existing path, and a 400 about effort keeps the schema.
- The utility floor of 2,048 `max_tokens` is part of EF-2: Haiku 5.5 thinks by default and thinking counts against
  `max_tokens` (`article.meta` asks for 500), and OpenRouter documents a reasoning budget that must stay under
  `max_tokens` with a 1,024 minimum.

### 2.3 Refusals (D8)

A refusal error is `Object.assign(new Error('Model declined the request' + (category ? ` (${category})` : '')), { refusal: true, permanent: true, billed })`
where `billed` is `{ inputTokens, outputTokens, costUsd? }` when the response reported usage.

| Adapter | Detection |
|---|---|
| `anthropic.ts` `collect(res)` | `res.stop_reason === 'refusal'` → throw (category from `res.stop_details?.category`, usage from `res.usage`). Covers both non-streaming paths. |
| `anthropic.ts` streaming | Keep `d.delta?.stop_reason` from `message_delta`; after the loop, `'refusal'` → throw with `{ inTok, outTok }`. The partial text already streamed is dropped by the existing `onReset` on the next attempt. |
| `openrouter.ts` `collect(j)` (text calls only, not `openrouterMessage`, which visibility shares) | `choices[0].finish_reason` is `'content_filter'` or `'refusal'`, or `choices[0].native_finish_reason === 'refusal'` → throw with usage. `openrouterChat` must copy `native_finish_reason` from the stream chunk into the reassembled `choices[0]`. |
| `openai.ts` | Unchanged: a refusal there yields no `output_text`, which is already an empty-answer failure. |

In `run()`, `permanent` ends the retries on that route (existing) and `refusal` adds the model to `skipModels`, so
the same model is not asked again through its other route. The next model in the plan is tried. `article.draft`
therefore never saves a refused or half-written draft as a success.

Server-side `fallbacks` (beta `server-side-fallback-2026-07-01`) is not used: it does not exist on OpenRouter
(the primary route) or for Haiku 5.5, its targets are Anthropic-only models outside Radar's catalogue and price
table, and Radar's failover already crosses providers and records each attempt.

### 2.4 Claude Fable 5.2 on each route

| Concern | Direct (`api.anthropic.com`) | OpenRouter |
|---|---|---|
| Data retention | Needs 30-day retention on the Anthropic organization. A zero-retention org gets `400 invalid_request_error`. `fetchJson` marks 400 `permanent`; it is not an account error (`isAccountError` is 401/402/403/quota-429), so Anthropic is **not** marked down and the plan moves to `gpt-6-astra`. | `provider.data_collection: 'deny'` is sent on every call and is not the same thing as zero retention; today's Claude traffic already routes with it. If OpenRouter ever answers 404 "no endpoints" for this model, `isOpenrouterModelMissing` skips OpenRouter for that model only (10 min) and the direct route is tried. |
| Always-on thinking | No `thinking` field is sent anywhere. Confirmed in `anthropic.ts`. | Same; only `reasoning.effort`. |
| Forced `tool_choice` | Not used: structured output is `output_config.format`. | `response_format`. |
| `temperature` | `anthropic.ts` never sends it. | `openrouterRun` sends it only for `x-ai/` models. |
| Refusal | §2.3 | §2.3 |
| `max_tokens` | Thinking counts against it: premium adds 8,000. | Same. |

A persistent direct-route 400 costs one fast failed request per premium call and shows in `ai_calls` as
`ok = false`, `model = 'claude-fable-5.2'`, `provider = 'Anthropic'`. The fix is the org's retention setting, or
`RADAR_AI_PREMIUM_MODEL`.

### 2.5 Premium effort and timeouts

Send `medium`. Fable's default is `high`, where one request can run for minutes; `article.draft` streams to a
person watching, and thinking precedes the first visible token. Anthropic's own guidance is to include low and
medium in effort sweeps for routine work. `RADAR_AI_PREMIUM_EFFORT=high` is the knob if the owner wants it.

| Purpose | Caller's `maxTokens` / timeout today | Premium attempt |
|---|---|---|
| `article.draft` | `words × 2.2 + 600` / 240 s (streamed) | `+8000` / 360 s |
| `suggestions.refreshDraft` | 6000 / 270 s | 14000 / 360 s |
| `calendar.topics` | 8000 / 360 s | 16000 / 360 s |

A premium timeout ends the premium tier for that call (`premiumOver`), so the worst case before the standard model
starts is one 360 s wait, inside the job limits (`article.draft` 15 min, `calendar.generate` 10 min). Once the plan
reaches the standard step, the caller's own `maxTokens` and timeout apply again.

### 2.6 EF-3, restated

As written ("calls not on the utility tier send the same request they send today") EF-3 cannot hold once MT-2 and
MT-3 change defaults. What the design guarantees, and what the tests prove:

1. `RADAR_AI_TIERS=off`: every request, on every route, is byte-identical to today. Proof: the golden `calls` in
   `openrouter.qa.test.ts` (§9).
2. Tiered mode, standard tier: for the model it resolves to, the request body equals the body that model receives
   under `off`. Proof: a test that runs one input in both modes for a business that chose a model and deep-compares
   the bodies on OpenRouter, Anthropic, OpenAI and xAI.
3. Only utility and premium attempts carry effort, the token floor/headroom and the premium timeout.

## 3. Spend records (LG)

### 3.1 `src/server/ai/prices.ts` (new, pure) and `src/server/ai/record.ts` (new)

`record.ts` imports `../db`, `../env` and `./prices` only. `index.ts`, `images.ts`, `engines.ts` and
`brief/sources/search.ts` import it; it imports none of them, so there is no cycle.

```ts
// prices.ts
export interface Price { in: number; out: number; long?: { over: number; in: number; out: number } }   // USD per 1M tokens
export const PRICE: Record<string, Price>;            // §4
export const IMAGE_PRICE: Record<string, number>;     // USD per image, by model id
export const SEARCH_FEE: Record<string, number>;      // USD per web-search tool call, by provider label
export const REQUEST_PRICE: Record<string, number>;   // USD per API request, by model id
export interface Usage { inputTokens?: number | null; outputTokens?: number | null; images?: number; searches?: number; requests?: number }
/** null when the call's main billable unit has no known rate. Never a guess. */
export function costOf(model: string, usage: Usage, provider?: string): number | null;

// record.ts
export interface AiCallRecord extends Usage {
  businessId?: string | null;
  task: string;        // 'writing' | 'research' | 'utility' | 'premium' | 'visibility' | 'image' | 'search'
  purpose: string;
  model: string;       // the model asked on that route
  provider: string;    // 'openrouter' | 'Anthropic' | 'OpenAI' | 'SpaceX' | 'Perplexity' | 'Google'
  latencyMs: number;
  costUsd?: number | null;   // reported by the route; wins over the table
  ok: boolean;
  error?: unknown;
}
export function recordAiCall(r: AiCallRecord): void;
```

`costOf`: the key is `model` with a vendor prefix removed (`anthropic/…`) and a trailing `-5-5` style version turned
into `.5` form, so `claude-sonnet-5-5`, `anthropic/claude-sonnet-5.5` and `claude-sonnet-5.5` share a row. Token cost
needs a `PRICE` row and at least one token count: `((in × p.in) + (out × p.out)) / 1e6`, using `long` rates for the
whole request when `inputTokens > long.over`. Images need an `IMAGE_PRICE` row; requests a `REQUEST_PRICE` row. If
tokens, images or requests were reported and that unit has no row, the result is `null`. `searches` add
`SEARCH_FEE[provider]` when there is one and are otherwise left out (documented beside the table).

`recordAiCall`: synchronous, returns nothing, whole body in `try/catch`, the insert is not awaited and its rejection
is swallowed (LG-5). `costUsd = r.costUsd ?? costOf(...)`. `error` is `String(e?.message || e).slice(0, 500)` (500
keeps today's text rows unchanged; the longest today is 410) with every configured key value replaced by
`[redacted]`. The inserted object has exactly today's columns: `businessId, task, purpose, model, provider,
latencyMs, inputTokens, outputTokens, costUsd, ok, error`. No prompt or answer text is ever passed in.

The private `log()` in `index.ts` is deleted; `run()` calls `recordAiCall` directly. `ai_calls.task` is free text,
so the new values need no schema change (LG-6).

### 3.2 What each surface writes

| Surface | One row per | `task` / `purpose` | `model` / `provider` | Tokens | Cost |
|---|---|---|---|---|---|
| Text `run()` | attempt | `logTask` / caller's purpose | catalogue id / `openrouter` or `Anthropic`, `OpenAI`, `SpaceX` | adapter result | OpenRouter `usage.cost`; else table, plus `SEARCH_FEE × res.searches` |
| Visibility, OpenRouter | request | `visibility` / `visibility.collect` | OpenRouter id / `openrouter` | `usage.prompt_tokens`, `usage.completion_tokens` | `usage.cost` when a number, else null |
| Visibility, ChatGPT direct | request | same | `env.visChatgptModel` / `OpenAI` | `usage.input_tokens`, `usage.output_tokens`; `searches` = count of `output[]` items with `type === 'web_search_call'` | table + $0.01 per search |
| Visibility, Claude direct | request | same | `env.visClaudeModel` / `Anthropic` | `usage.input_tokens`, `usage.output_tokens`; `searches` = `usage.server_tool_use?.web_search_requests` | table + $0.01 per search |
| Visibility, Grok direct | request | same | `env.visGrokModel` / `SpaceX` | `usage.input_tokens`, `usage.output_tokens` | table, tokens only (xAI's search fee is not published where I could cite it) |
| Visibility, Perplexity direct | request | same | `env.visPerplexityModel` / `Perplexity` | `usage.prompt_tokens`, `usage.completion_tokens` | `usage.cost.total_cost` when a number, else null |
| Visibility, Gemini direct | request | same | `env.visGeminiModel` / `Google` | `usageMetadata.promptTokenCount`; `candidatesTokenCount + thoughtsTokenCount` | table (no row for `gemini-flash-latest` → null) |
| Image, OpenRouter | provider attempt | `image` / `image.${r.kind \|\| 'images'}` | `openrouterImageModel()` / `openrouter` | `usage.prompt_tokens`, `usage.completion_tokens` when present | `usage.cost` when a number, else null |
| Image, OpenAI | provider attempt | same | `OPENAI_IMAGE_MODEL \|\| 'gpt-image-1'` / `OpenAI` | `usage.input_tokens`, `usage.output_tokens` when present | null (no published rate found for `gpt-image-1`) |
| Image, xAI | provider attempt | same | `XAI_IMAGE_MODEL \|\| 'grok-imagine-image'` / `SpaceX` | none | `images: 1` → $0.02 |
| Perplexity Search | HTTP request, inside the `withRetry` callback | `search` / `brief.search` | `perplexity-search` / `Perplexity` | none | `requests: 1` → $0.005 on success; null on failure |

Rules common to visibility, images and search:

- Failure rows: `ok = false`, the error, no tokens, cost null, unless the provider answered first (below).
- A provider that answered and was then rejected by Radar (empty visibility answer, empty or SVG image, a body
  `error`) keeps the usage it reported and `ok = false`.
- No request, no row: `EngineUnavailable`, a provider skipped by a cooldown or the breaker, dev stubs
  (`stubEngine`, template images), template renders (LG-2).
- `businessId` needs no new plumbing: `askEngine` already receives `ctx.stub.bid`; `ImageReq.bid` and `SourceCtx.bid`
  already exist. No signature changes.

Implementation notes for E2:

- `engines.ts`: time and record inside `askOpenrouter` (it has `j`) and around each `case` of `askDirect`. A small
  local helper keeps it to one line per engine: `logged(bid, model, provider, () => post(...), usageOf)`. A direct
  answer whose text is empty is recorded `ok = false, error = 'empty response'` with its usage; `collectOne` still
  throws as today.
- `images.ts`: `openrouterImage`, `openaiImage`, `xaiImage` return `{ buf, usage? }`; the loop in
  `generatePhotoRaw` (§5) writes the row for each attempt. The `model` expression already in the catch block moves
  above the `try`.
- `search.ts`: wrap the `fetchJson` call inside the function given to `withRetry`, so a retry writes its own row.
  A multi-query POST is one billed request (Perplexity states this).

### 3.3 LG-4: the `try/catch` in `run()`

```ts
const t0 = Date.now(); input.onReset?.();
let res: ProviderResult | null = null;          // set once the provider has answered
try {
  res = env.devStubs ? await stubRun(...) : viaOr ? await openrouterRun(call) : await callProvider(modelId, call);
  if (viaOr) noteOpenrouterOutcome();
  if (!String(res.text || '').trim() && res.json == null) throw new Error('Empty response from ' + logProvider);
  ...schema validation, may throw...
  recordAiCall({ businessId, task: r.logTask, purpose, model: modelId, provider: logProvider, latencyMs: Date.now() - t0,
    inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, searches: res.searches, ok: true });
  return ...;
} catch (e: any) {
  ...reportFailure as today...
  const billed = res ?? e?.billed ?? null;      // answered-then-rejected, or a refusal that reported usage
  recordAiCall({ ...same identity..., inputTokens: billed?.inputTokens, outputTokens: billed?.outputTokens,
    costUsd: billed?.costUsd, searches: billed?.searches, ok: false, error: e });
  ...cooldowns, skipModels, premiumOver, backoff as today...
}
```

Adapters add `searches`: `anthropic.ts` from `usage.server_tool_use?.web_search_requests` (summed over both
passes), `openai.ts` from the count of `web_search_call` output items when the base is `api.openai.com`.

## 4. Prices (PR-1)

Per 1M tokens, USD, input / output. This table goes into `prices.ts` with the source and date as comments.

| Key | Rate | Long-prompt rate | Source (all read 2026-11-10) |
|---|---|---|---|
| `claude-fable-5.2` | 8 / 40 | none | Anthropic pricing page |
| `claude-fable-5.1` | 10 / 50 | none | Anthropic pricing page |
| `claude-opus-5.5` | 4 / 20 | none | Anthropic pricing page |
| `claude-sonnet-5.5` | 2 / 10 | none | Anthropic pricing page |
| `claude-haiku-5.5` | 0.10 / 0.50 | over 100,000 input tokens: 0.50 / 2.50 | Anthropic pricing page |
| `gpt-6-astra` | 10 / 50 | over 272,000: 20 / 75 | OpenAI pricing page; OpenRouter endpoint listing agrees |
| `gpt-6.1-sol` | 2 / 10 | over 272,000: 4 / 15 | OpenAI pricing page; OpenRouter agrees |
| `gpt-6-sol` | 2 / 10 | over 272,000: 4 / 15 | OpenAI pricing page; OpenRouter agrees |
| `gpt-6-luna` | 0.10 / 0.50 | over 272,000: 0.20 / 0.75 | OpenAI pricing page; OpenRouter agrees |
| `grok-4.7` | 2 / 6 | 200,000 or more: 4 / 12 | xAI models page; OpenRouter agrees |
| `grok-4.6` | 2 / 6 | 200,000 or more: 4 / 12 | xAI models page; OpenRouter agrees |

`long.over` is "strictly greater than" for Anthropic and OpenAI and 199,999 for xAI (its rule is "200k or more").
The higher rate applies to every token of that request, which is how all three providers bill it.

| Other units | Rate | Source |
|---|---|---|
| `IMAGE_PRICE['grok-imagine-image']` | $0.02 per image | xAI models page |
| `SEARCH_FEE.Anthropic` | $0.01 per search ($10 per 1,000) | Anthropic pricing page |
| `SEARCH_FEE.OpenAI` | $0.01 per call ($10 per 1,000) | OpenAI pricing page |
| `REQUEST_PRICE['perplexity-search']` | $0.005 per request ($5 per 1,000, no token charge, a multi-query request is one) | Perplexity pricing page and Search quickstart |

Deliberately absent, so their cost logs null unless the route reports one: `gpt-image-1` (not on OpenAI's current
pricing page), `sonar-pro` on Perplexity's own API (rates not on the pages I could read), `gemini-flash-latest`
(the alias is not on Google's pricing page), the OpenRouter image model (per-image tokens vary; `usage.cost` is
used), xAI's web-search fee, Gemini's grounding fee (5,000 free a month, so no per-call figure).

Every one of the ten rows in today's `PRICE` differs from the published rate (for example Opus 5/25, Sonnet 3/15, Haiku 1/5, GPT-6 Sol 2/8, Grok 4.7 3/15).

## 5. One image per social pack (IM)

### 5.1 `src/server/services/images.ts`

```ts
export interface ImageReq { …existing…; /** Ask for a centred subject with spare background (shared pack image). */ cropSafe?: boolean }
/** Provider loop only: the raw model image, uncropped. Writes the ai_calls rows (§3.2). */
export async function generatePhotoRaw(r: ImageReq): Promise<Buffer>;
/** Cover-crop to exactly w×h PNG (the code at the end of today's generatePhoto). */
export async function coverCrop(raw: Buffer, w: number, h: number): Promise<Buffer>;
export async function generatePhoto(r: ImageReq): Promise<Buffer>;   // = coverCrop(await generatePhotoRaw(r), r.w, r.h); behaviour unchanged
export type ImageSource = { raw: Buffer } | 'template';
export async function renderImageFile(r: ImageReq, from?: ImageSource): Promise<{ url: string; bytes: number; type: string }>;
```

`renderImageFile` with `from` undefined is today's function, line for line. With `from === 'template'` it renders
`renderTemplatePng(r)` and stores it, with no model call. With `from.raw` it stores `coverCrop(from.raw, r.w, r.h)`;
if that throws it reports the failure as today's fallback does and stores the template.

`imagePrompt` adds one sentence after `Variation N.` only when `r.cropSafe`: `Keep the main subject in the centre
with background to spare on every side, so the image can be cropped.` Every other image request keeps today's
prompt (the golden pins it).

### 5.2 `src/server/services/social/generate.ts`

```ts
/** The aspect (w/h) to generate a pack's shared image at: the geometric mean of the widest and tallest platform ratio. */
export function packAspect(platforms: Platform[]): number;
export async function renderPostImage(bid, p, k, post, headline, custom?, from?: ImageSource): Promise<{ url; photo; meta }>;
```

`createPack`, before its loop: `const modelPack = MODEL_STYLES.includes(renderStyle(style)) && imageModelConfigured();`
`let shared: ImageSource | undefined;`. Inside the loop, in the existing `try` around the image:

```ts
if (modelPack && shared === undefined) {
  const a = packAspect(input.platforms), sizes = new Set(input.platforms.map(k => IMG_SIZES[k].join('x')));
  shared = await generatePhotoRaw({ bid, kind: 'social', style: renderStyle(style), brand: p.brand, headline, name: p.business.name,
      seed: seed0 * 7, prompt: postImagePrompt(post, headline, input.custom), w: 1200, h: Math.round(1200 / a), cropSafe: sizes.size > 1 })
    .then(raw => ({ raw }), async e => { await reportFailure(e, { source: 'image', operation: 'image.generate', businessId: bid, degraded: true });
      console.error('[social] pack image failed, using templates', e?.message); return 'template' as const; });
}
const r = await renderPostImage(bid, p, k, post, headline, input.custom, modelPack ? shared : undefined);
```

`postImagePrompt(post, headline, custom)` is the prompt expression already inside `renderPostImage`, lifted into a
helper so both use it. Progress events, the pack record and the transaction are untouched.

| Question | Answer |
|---|---|
| Where is the one generation? | In `createPack`, at the first platform's image step, so text for platform 1 still comes first and `onProgress` fires as today. |
| What aspect, and why? | Geometric mean of the pack's extreme ratios, so the worst crop is as small as it can be for that pack. The existing per-provider mapping snaps it: all five platforms or any mix with Reddit → 1.60 → OpenRouter `3:2` (LinkedIn/Facebook/Quora keep 78% of the height, X 84%, Reddit 89% of the width); no Reddit → 1.84 → `16:9` (1.91:1 keeps 93%, X is exact); a single platform → that platform's own request, identical to today's. Every crop is a centred band from one landscape image, and the `cropSafe` sentence asks the model to compose for that. |
| How is each platform's file made? | `coverCrop(raw, …IMG_SIZES[k])` → PNG → `putObject(objectKey(bid, 'social', 'png'))`: its own file, URL and `imageMeta { bytes, type: 'image/png' }`. |
| What `seed` does a post keep? | Today's: `seed0 * 7 + i`. It still drives the live template preview and is the base for Regenerate (`+ 11`). The shared generation uses the first post's seed. |
| `photo` | Same expression as today. |
| The model fails | One failure report for the pack; every platform gets `renderTemplatePng` at its own size (`from: 'template'`). The model is not retried per platform. A crop or storage error on one platform behaves as today (template, or `imageUrl` stays null and publish-time rendering fills it). |
| Still one generation per platform | `social.regenImage` and `social.style` (`changeImage` in `actions/social.ts`), a per-post custom prompt (`imagePrompt`, `modelRequired`), and publish-time `ensureImages` in `social/publish/pubs.ts`. They call `renderPostImage` without `from`, so their code path is today's. |
| Template styles, dev stubs | `modelPack` is false: today's path. |

## 6. Weekly AI Visibility (VW)

### 6.1 The rule: `src/server/idle.ts` (thresholds live here, as the file header says)

```ts
export const VIS_EVERY_DAYS = 7;
/** Business-local weekday of the scheduled run. 0 = Sunday: the night before the Monday 08:00 UTC report. */
export const VIS_WEEKDAY = 0;
export const visibilityCadence = (): 'weekly' | 'nightly' =>
  ((process.env.RADAR_VISIBILITY_CADENCE || '').trim().toLowerCase() === 'nightly' ? 'nightly' : 'weekly');
/** Pure. Not dormant, today in `tz` is VIS_WEEKDAY, and the newest full run started 7 or more local calendar days ago (or never). */
export function visibilityDue(tier: Tier, tz: string, lastFullRunAt: Date | null, now: Date): boolean;
/** Newest full `visibility.run` per business: payload without `promptIds`, status not `failed`, created in the last 8 days. */
export async function lastFullVisibilityRuns(bids: string[]): Promise<Map<string, Date>>;
```

Calendar days are compared as `todayIn(tz, …)` strings, so Sunday-to-Sunday is always 7 whatever the time of
night, and the run cannot ratchet later each week. The 8-day lookback is enough because anything older is due.

`nightlyTick` (`visibility/jobs.ts`; the cron keeps its name `visibility.nightly`, which alerting keys on):

- `visibilityCadence() === 'nightly'` → today's body, unchanged (VW-6).
- otherwise: businesses inside 02:00–05:59 local, not dormant, whose local weekday is `VIS_WEEKDAY` →
  `lastFullVisibilityRuns` → `visibilityDue` → `once(visNightKey(...))` → enqueue, as today.

Active, idle and Autopilot businesses all get the same weekly rule; dormant none (VW-1). `activityTier` is not
changed, so Autopilot still protects social packs and the brief.

`visNightKey` stays a per-local-day mark. It still stops a second enqueue during the four-hour window and is still
shared with the `touchActive` catch-up; after the first tick the new job also makes `visibilityDue` false.

Two deliberate readings of VW-1, both for the PM to confirm:

1. **Full runs only.** A prompt-scoped run (`promptIds`) collects a few cells. Counting it would let "add a prompt on
   Saturday" cancel Sunday's full collection. A full run of any origin (first run, catch-up on return, scheduled)
   does count.
2. **Failed jobs do not count.** Otherwise a first run that crashed on Tuesday would block the next Sunday.

Unchanged (VW-2): `startFirstRun`, `touchActive`, `visibility.collect`, and the prompt-scoped run from
`visibility.list`. Effect of an off-cycle full run on Monday to Saturday: that Sunday is skipped, the following one
runs. Every Monday-to-Sunday week still holds at least one full run.

### 6.2 New prompts (D11)

`visibility.addPrompt` (`actions/visibility.ts`) enqueues
`enqueue('visibility.run', { promptIds: [id] }, { businessId: ctx.bid, ref: ctx.bid, singletonKey: 'vis-prompt:' + id })`
after `addPrompt`. Today a user-added prompt waits for that night's batch; with a weekly batch it would sit at
"No data" for up to 13 days. The response shape is unchanged, and `listVisibility` already shows the cells of a
queued prompt-scoped run as collecting.

### 6.3 The weekly email (VW-3)

`collectAiReports` runs on Mondays from 08:00 UTC and reports UTC days `[Monday − 7, Monday)`. A Sunday 02:00 local
run lands between Saturday 12:00 UTC (UTC+14) and Sunday 14:00 UTC (UTC−12): always inside that period and 18 to 44
hours before the email. No change to `digest.ts`.

When the Sunday run was skipped (an off-cycle full run earlier that week) or missed, the data is older. So the email
always states the date. `digestContent.ts` `paragraphs()`, new second paragraph, built from
`(w.days || []).filter(d => d.collected > 0)`:

- one day: `Radar checks your tracked questions once a week. These answers were collected on ${day}.`
- several: `Radar checks your tracked questions once a week. These answers were collected between ${first} and ${last}.`

### 6.4 What the screens assume (VW-5)

| Place | Assumption | Change |
|---|---|---|
| `Performance.tsx` AI tab | Reads the latest-result grid (`ai_results`), shows `Last collected {date}` and a per-cell `collected {date}`. No staleness logic, no trend chart. | Only the add-prompt toast (§7 row 13). |
| `listVisibility` | "Collecting" comes from a queued or running `visibility.run`. | None. |
| `recommendationShare.ts` | One latest observation per UTC day and cell, summed over the week. With one run a week the share is that run. | Comment only ("nightly cell"). |
| `history.ts`, `digest.ts` | Need at least one observation in the period; the comparison needs the previous week too. | None. The first weekly email after release compares one run against seven; shares stay comparable, counts differ once. |
| `firstRun.ts` `supersede` | A failed first-run row clears when a later run succeeds. | None in code. A failed first visibility row now waits for Retry or the next Sunday rather than the next night. |

## 7. Cadence copy (VW-4): every statement found

| # | File:line | Now | Replace with |
|---|---|---|---|
| 1 | `src/features/marketing/Home.tsx:12` | `Checked every night across five` | `Checked every week across five` |
| 2 | `src/features/marketing/Home.tsx:19` | `Nightly checks across ChatGPT, Perplexity, Gemini, Claude and Grok.` | `Weekly checks across ChatGPT, Perplexity, Gemini, Claude and Grok.` |
| 3 | `src/features/marketing/Home.tsx:40` | `Radar checks five assistants nightly and turns every gap into a topic.` | `Radar checks five assistants every week and turns every gap into a topic.` |
| 4 | `src/features/marketing/Home.tsx:95` | `Yes. Radar checks your prompts nightly across ChatGPT, …` | `Yes. Radar checks your prompts every week across ChatGPT, …` (rest of the answer unchanged) |
| 5 | `src/features/marketing/HomeStory.tsx:147` | `Every night, Radar asks five assistants what your customers ask, and shows where you stand.` | `Every week, Radar asks five assistants what your customers ask, and shows where you stand.` |
| 6 | `src/features/marketing/AiVisibility.tsx:12` | `Every night, Radar asks ChatGPT, Perplexity, Gemini, Claude and Grok the questions your customers ask, …` | `Every week, Radar asks ChatGPT, …` |
| 7 | `src/features/marketing/AiVisibility.tsx:13` | fact value `Every night` | `Every week` |
| 8 | `src/features/marketing/AiVisibility.tsx:15` | `Five assistants answer, every night.` | `Five assistants answer, every week.` |
| 9 | `src/features/marketing/AiVisibility.tsx:17` | `For each assistant, every night.` | `For each assistant, every week.` |
| 10 | `src/features/marketing/AiVisibility.tsx:20` | `Every night. Collect now runs a check on demand.` | `Once a week. Collect now runs a check on demand.` |
| 11 | `src/lib/seo.ts:17` (`cardDescription`, also the social card) | `Five assistants. Nightly checks. Clear next steps.` | `Five assistants. Weekly checks. Clear next steps.` |
| 12 | `src/lib/marketing-posts.ts:20` | `Radar asks five assistants your customers’ questions every night.` | `Radar asks five assistants your customers’ questions every week.` |
| 13 | `src/features/performance/Performance.tsx:218` (toast) | `Prompt added. First collection runs tonight.` | `Prompt added. Radar is collecting its first answers now.` |
| 14 | `src/server/services/lifecycle/educationContent.ts:55` (lesson email) | `New questions are collected overnight. You can also open a result and choose Collect now to request an answer sooner.` | `Radar collects answers to a new question as soon as you add it, then checks every question once a week.` |
| 15 | `src/server/services/visibility/digestContent.ts` (weekly report) | no statement | the sentence in §6.3 |

Checked and already free of any cadence claim: `llms.txt` and `llms-full.txt` (`llmsText`/`llmsFullText` in
`src/lib/seo.ts`: "Radar checks prompts across … with web search enabled"), `pricing.md` ("AI visibility checks"),
`docs/EMAILS.md`, `ai-email-preferences`, `AiReportPreferences.tsx` ("Weekly AI recommendation reports", already
true), blog bodies. "Every morning" and "overnight" in `marketing/DailyBrief.tsx`, `marketing-links.ts` and
`features/brief` are about the Daily Brief and stay.

Internal text to make true in the same change (not customer-facing): comments at `actions/visibility.ts:21`,
`idle.ts:40-46`, `visibility/jobs.ts:13,20-23`, `firstRun.ts:67`, `lib/recommendationShare.ts:35`; `README.md:106-108`
(the idle paragraph: visibility is weekly for every business that is not dormant); `docs/CONTRACTS.md:222`;
a new `DIVERGENCES.md` row that supersedes P20 and O2 for visibility.

## 8. Cost effect of the model tiers

Price ratios are exact at equal token counts: Opus 5.5 is 2.0× GPT-6 Sol on input and output, Fable 5.2 is 4.0×,
GPT-6 Astra 5.0×, Haiku 5.5 is 1/20 of Sol and 1/40 of Opus. Token counts below are my assumptions (no production
`ai_calls` access); thinking tokens bill as output and may differ by model.

| Call (assumed tokens in / out) | Today | After | Change per call |
|---|---|---|---|
| `article.draft` (6,000 / 4,500), no explicit choice | $0.057 (Sol) | $0.228 (Fable 5.2) | +$0.171 |
| same, served by the Astra fallback | $0.057 | $0.285 | +$0.228 |
| `suggestions.refreshDraft` (5,000 / 5,000) | $0.060 | $0.240 | +$0.180 |
| `calendar.topics` (4,000 / 6,000) | $0.068 | $0.272 | +$0.204 |
| A standard writing call, e.g. `social.post` (2,500 / 600) | $0.011 (Sol) | $0.022 (Opus) | +$0.011 (2×) |
| A standard research call | Opus | Opus | none |
| `brief.rank` (9,000 / 2,500) | $0.086 (Opus) | $0.0022 (Haiku) | −$0.084 |
| A writing-kind utility call (2,000 / 500) | $0.009 (Sol) | $0.00045 (Haiku) | −$0.0086 |

A business that explicitly chose a model in Settings sees no change on standard and premium calls.

## 9. Tests

### 9.1 The failing golden test (`src/server/ai/openrouter.qa.test.ts`, "parity")

Its only diff at baseline is `i2.stored[0]`: the hash of a brand-template PNG, stale since `src/lib/visual.ts`
changed after the golden was captured. It has nothing to do with AI requests.

- The suite keeps describing today's routing. Its `boot()` sets `RADAR_AI_TIERS=off` (add it to `VARS` and to the
  defaults), which turns the whole file into the proof of D5 and EF-3(1).
- GOLDEN `calls`, `logs`, `backoffs`, `stored`, `r`/`e` blocks are **not edited**. Only `rows` change, because this
  feature changes rows on purpose: corrected prices (E1: p1, p3, p4, p5, p6, p7, p9), tokens and cost on rejected
  attempts (E1: p5), new image rows (E2: i1, i1b) and visibility rows (E2: v1, v2).
- Method: `QA_CAPTURE=<scratch>/golden.json npx vitest run src/server/ai/openrouter.qa.test.ts -t parity`, copy only
  the `rows` arrays into GOLDEN, and show `git diff` proving no other GOLDEN field moved.
- Done means the test's diff is still exactly the one `i2.stored` line. Re-pinning that hash is a separate, one-line
  decision for the PM (§14); do not delete or skip the test.

Other suites that assume `gpt-6-sol` as the default (`openrouter.test.ts`, `fallbackAlerts.test.ts`,
`providers.observability.test.ts`, `instructions.run.test.ts`, `instructions.test.ts`,
`actions/writingInstructions.db.test.ts`) also set `RADAR_AI_TIERS=off` in their setup wherever they call `run()`
and are otherwise left alone. Assertions on `H.inserted` that assumed images and visibility write no rows will legitimately change in E2.

### 9.2 E1 adds

`src/server/ai/tiers.test.ts` (pure):
- every key of `PURPOSE_TIER` appears as a `purpose: '…'` literal somewhere under `src/server` (catches renames);
  an unlisted purpose is standard.
- `resolve` for each row of §1.1, including: a business's `writing: 'grok-4.7'` leaves the utility chain untouched;
  an explicit choice replaces the premium chain; `off` yields `gpt-6-sol`/`claude-opus-5.5` and no effort; an env
  model id outside the catalogue is ignored.
- `costOf`: Haiku at 100,000 and 100,001 input tokens; an unknown model → null; an image with no rate → null;
  searches add the fee for Anthropic and nothing for SpaceX.

`src/server/ai/tiers.run.test.ts` (fetch and db mocked, tiered mode):
- utility: `keywords.intent` goes to `anthropic/claude-haiku-5.5` on OpenRouter with `reasoning: { effort: 'low' }` and
  `max_tokens ≥ 2048`; with no OpenRouter key the Anthropic body has `output_config.effort === 'low'` next to
  `format`; Haiku failing → `gpt-6-luna` with `reasoning: { effort: 'low' }`; the row's `task` is `'utility'`.
- EF-2: a 400 naming the effort field → exactly one resend without it, the call succeeds, the schema is still in the
  resend; the next call inside 10 minutes sends no effort.
- EF-3(2): same input, a business that chose `gpt-6-sol` (then `claude-sonnet-5.5`, then `grok-4.7`): bodies under
  tiered mode deep-equal the bodies under `off`, on OpenRouter and direct.
- MT-2: an unlisted purpose with no business choice asks `claude-opus-5.5` and sends no `reasoning`/`effort`.
- premium: `article.draft` asks Fable 5.2 first with `medium` and `max_tokens = caller + 8000`; an explicit writing
  choice is used instead, with no effort.
- refusal: a streamed Fable answer that ends `stop_reason: 'refusal'` after partial text → `onReset` fired, Astra
  asked next, Fable not asked on its other route, the Fable row is `ok = false` with tokens.
- retention: Fable direct 400 `invalid_request_error` → Astra answers; a following standard call still uses
  Anthropic (not marked down).
- MT-5: both premium models failing → `claude-opus-5.5` answers, `result.model` says so, a warn is logged, the task
  did not throw.
- switches: `RADAR_AI_TIERS=off` sends `brief.rank` to the business's research model and `article.meta` to its
  writing model; `premium` alone turns utility off; `RADAR_AI_EFFORT=off` removes the field.
- LG-4: malformed JSON and an empty answer each write `ok = false` with input and output tokens and a cost; an HTTP
  500 writes nulls.
- LG-5: `recordAiCall` with a `db.insert` that throws, and one that rejects, neither throws nor delays the caller.

Settings: `aiPrefsOf` returns Opus by default and GPT-6 Sol under `off`; `settings.ai` accepts `claude-fable-5.2`.

### 9.3 E2 adds

- Visibility rows: each engine through OpenRouter and through its own API writes one row with the fields of §3.2;
  OpenRouter failing then the direct API answering writes two; not configured, and dev stubs, write none; an empty
  direct answer is `ok = false` with usage; a rejecting insert does not fail `askEngine`.
- Image rows: OpenRouter success with `usage.cost`; OpenRouter 500 then OpenAI success → two rows; xAI → $0.02; a
  template style → none; `modelRequired` with every provider failing still throws as today and has its rows.
- Search rows: success → one row at $0.005; a failure then a retry that succeeds → two rows, the first with null cost.
- Pack image (fetch and storage mocked, no DB needed: drive `packAspect` and `renderPostImage(..., from)`, plus the
  shared-source step): three platforms, a model style → exactly one image request; three stored PNGs whose decoded
  sizes are 1200×628, 1200×675, 1200×900; the request's aspect is `3:2` with Reddit in the pack and `16:9` without.
- Model failure → no further image request, three template files at the right sizes.
- Unchanged paths: `renderPostImage` without `from` (regenerate, publish-time) makes one request at that
  platform's size with today's prompt; a per-post `imagePrompt` still sets `modelRequired`.

### 9.4 E3 adds and changes

- `idle.test.ts`: a table for `visibilityDue` (weekday in the business's zone across UTC−12 and UTC+14, a full run
  6 and 7 local days ago, 23:59 against 00:01, each tier), and `visibilityCadence`.
- `idle.cadence.db.test.ts`: the existing nightly cases move under a `describe` with
  `RADAR_VISIBILITY_CADENCE=nightly` and keep their assertions (that is the VW-6 proof). New weekly cases: active
  and Autopilot businesses get one run in the Sunday window and none on other nights; no second run that Sunday; a
  full run on Tuesday skips the coming Sunday and the next one runs; a prompt-scoped run and a failed run do not
  skip it; dormant gets none; the catch-up on return is unchanged.
- `visibility.addPrompt` enqueues one prompt-scoped run for the new prompt.
- `digestContent.test.ts`: the collected-on sentence for one day and for several.
- One copy guard: none of the strings in §7 rows 1 to 14 matches `/night/i` any more.

## 10. Work split

| | E1: AI core | E2: records and pack image | E3: weekly visibility and copy |
|---|---|---|---|
| Owns | `src/lib/constants.ts` (AI block only), `src/server/ai/index.ts`, `ai/tiers.ts`, `ai/prices.ts`, `ai/record.ts`, `ai/adapters/{anthropic,openai,openrouter,effort}.ts`, `src/server/workspace.ts` (`aiPrefsOf`), all `src/server/ai/*.test.ts`, `actions/writingInstructions.db.test.ts`; the AI lines of `.env.example`, `DIVERGENCES.md`, `docs/LAUNCH.md` | `src/server/services/visibility/engines.ts`, `services/images.ts`, `services/brief/sources/search.ts`, `services/social/generate.ts`, their tests | `src/server/idle.ts`, `services/visibility/jobs.ts`, `services/visibility/digestContent.ts`, `actions/visibility.ts`, `lib/recommendationShare.ts` (comment), `features/performance/Performance.tsx`, `features/marketing/{Home,HomeStory,AiVisibility}.tsx`, `lib/seo.ts`, `lib/marketing-posts.ts`, `services/lifecycle/educationContent.ts`, `services/firstRun.ts` (comment), `idle*.test.ts`, `digestContent.test.ts` |
| Edits after another track | none | `src/server/ai/openrouter.qa.test.ts` (GOLDEN rows for i1, i1b, v1, v2 and image/visibility row assertions), strictly after E1 | `.env.example`, `README.md`, `DIVERGENCES.md`, `docs/CONTRACTS.md`, `docs/LAUNCH.md`: after E1 has added its own lines |
| Must land first | The shared contract: `recordAiCall`/`AiCallRecord`, `costOf`/`Usage` and the price tables, exactly as in §3.1 and §4 | | |

The six utility call sites and the three premium call sites are not edited by anyone.

Order: **E1 → E2**, serial (E2 builds on E1's contract and edits E1's test file). **E3 shares no source file with
E1 or E2**, so it can run alongside either, with two cautions that come from sharing one worktree: each engineer's
`npm run typecheck` and full `npm test` see the other's half-finished edits, and the `*.db.test.ts` suites share one
local Postgres. If E3 runs in parallel, engineers run only their own test files while both are active, E3 leaves
the five shared docs files to the end, and the PM runs the full typecheck and suite once after all three. Fully
serial (E1, E2, E3) costs time and removes both cautions.

QA in a real browser:

- Settings → AI models: a business with no choice shows Claude Opus 5.5 for both rows; a business that chose a
  model still shows it; Claude Fable 5.2 is in the list with its description, Fable 5.1 shows the new wording;
  picking a model saves and toasts as before. No utility or premium row exists.
- Performance → AI Visibility: grid and `Last collected` read correctly; adding a prompt shows the new toast and its
  cells go to collecting, then fill; Collect now on a not-collected cell.
- Marketing: `/` (comparison row, feature list, problem card, FAQ answer, story section), `/features/ai-visibility`
  (hero, facts, step 2, "In every result", FAQ "How often?"), the feature's social card, the blog post CTA that
  uses `marketing-posts.ts:20`, and `/llms.txt`, `/llms-full.txt`, `/pricing.md` for no leftover claim.
- Emails (preview routes): the weekly AI report with the collected-on sentence; the AI visibility lesson.
- Social: create a pack with three platforms. With dev stubs the image model is off, so the browser only shows
  templates; the one-generation behaviour is proven by the unit tests, and the crops need a staging key to be
  judged by eye.

## 11. Risks and rollback

| Risk | Detection | Way back (environment only) |
|---|---|---|
| Utility model ranks or extracts worse (`brief.rank` is the accepted one) | Brief quality; `ai_calls` where `task = 'utility'` and `ok = false` | `RADAR_AI_TIERS=premium`, or `RADAR_AI_UTILITY_MODEL=claude-sonnet-5.5` |
| A provider rejects the effort field in a way the test does not match | Utility or premium rows failing with HTTP 400 | `RADAR_AI_EFFORT=off` |
| Opus as the writing default: 2× cost, and thinking can eat small `max_tokens` budgets (`article.rewrite` 800, `backlinks.placement` 800, `article.videoWhy` 600) | Spend by `task = 'writing'`; rows with `ok = false` and "Empty response" or "failed validation" that now carry output tokens (LG-4) | `RADAR_AI_WRITING_MODEL=gpt-6-sol` |
| Premium is slow, refuses, or 400s on retention | Rows `task = 'premium'` with `ok = false`; `[ai] … used X (fallback from claude-fable-5.2)` | `RADAR_AI_PREMIUM_MODEL=…`, `RADAR_AI_PREMIUM_EFFORT=low`, or `RADAR_AI_TIERS=utility` |
| Anything in tier routing | as above | `RADAR_AI_TIERS=off` restores today's routing and requests |
| Recording slows or breaks work | It cannot throw or be awaited by design; tested | none needed; rows are additive |
| Wrong price row | Compare a direct-route row with the provider invoice; OpenRouter rows use the reported cost | Fix the table (code); null is the safe value |
| A pack's crops look wrong on one platform | Visual check on staging; user regenerates that platform (one generation, own size) | None by environment: revert `createPack` to per-platform. Flag if the owner wants a switch. |
| Weekly cadence leaves data older than expected, or a week with no run | `jobs` rows of kind `visibility.run`; the report email's collected-on date | `RADAR_VISIBILITY_CADENCE=nightly` (copy would then understate the cadence) |
| Sunday-night load: every business in a zone at 02:00 | Queue depth on Sunday | Same as nightly today, one night in seven |
| `content_filter` finishes through OpenRouter now fail over instead of returning a partial answer | Rows with error "Model declined the request" | Behaviour is intended; no switch |

## 12. Sources (read 2026-11-10)

- Anthropic: pricing `platform.claude.com/docs/en/about-claude/pricing`; refusals and fallback
  `platform.claude.com/docs/en/build-with-claude/refusals-and-fallback`; model and effort facts from the Claude API
  reference bundled with this tool (cached 2026-11-03).
- OpenAI: pricing `developers.openai.com/api/docs/pricing`; reasoning `developers.openai.com/api/docs/guides/reasoning`.
- xAI: `docs.x.ai/docs/models`, `docs.x.ai/docs/guides/reasoning`.
- OpenRouter: `openrouter.ai/api/v1/models/{id}/endpoints` for `anthropic/claude-fable-5.2`, `anthropic/claude-haiku-5.5`,
  `openai/gpt-6-luna`, `openai/gpt-6-sol`, `openai/gpt-6-astra`, `openai/gpt-6.1-sol`, `x-ai/grok-4.7`, `x-ai/grok-4.6`,
  `perplexity/sonar-pro`, `google/gemini-4-argon`, `google/gemini-nano-banana-2.1`; reasoning tokens guide; provider
  routing guide; API overview; image generation reference.
- Perplexity: `docs.perplexity.ai/docs/getting-started/pricing`, the Search quickstart, the Sonar Pro model page.
- Google: `aistudio.google.com/docs/pricing`.

## 13. Not verified, and what the design assumes instead

| Item | Assumption / safe behaviour |
|---|---|
| How OpenRouter translates `reasoning.effort` for Claude 5.x (its guide still describes a token budget) | Send it; resend without on 400/404; keep utility `max_tokens ≥ 2048` |
| OpenRouter's `finish_reason` for an Anthropic refusal | Treat `content_filter`, `refusal` and `native_finish_reason: 'refusal'` alike |
| That `data_collection: 'deny'` keeps Fable 5.2's endpoints routable | If not, the existing 404 path sends that model direct |
| The production Anthropic org's retention setting | Direct Fable calls fail over to Astra if it is zero-retention (§2.4) |
| Fable 5.2 speed at `medium` | 360 s per premium attempt, one timeout ends premium for the call |
| Which effort values each GPT-6 model accepts beyond the documented exclusions | `low` and `medium` are accepted; EF-2 covers a rejection |
| `gpt-image-1`, Sonar Pro (direct), `gemini-flash-latest` rates; xAI and Gemini search fees | No row: cost null, or the fee left out |
| Gemini `usageMetadata` and OpenAI image `usage` field names | Read defensively; missing → null |
| Token counts in §8 | Assumptions; ratios are exact |

## 14. For the PM or owner

1. Settings shows Opus while article drafts, refresh drafts and calendar topics run on Fable 5.2, and a member who
   then picks Opus (or anything) explicitly moves those three tasks to that model, with no way back to automatic.
   MT-4 asks for exactly this; say if the owner wants an "Automatic" option instead (a UI change).
2. VW-1 as built counts full, non-failed runs (§6.1). The literal text says "any origin".
3. D11: user-added prompts are collected at once. The alternative that keeps today's "tonight" wording is a
   nightly sweep for never-collected prompts, which is more code and one more query per tick.
4. Fable 5.2 appears in the Settings list and Fable 5.1's description changes: a visible change beyond "the default
   shown in Settings" in NC-1.
5. Whether to re-pin the stale `i2.stored` hash so the parity test goes green.
6. Found while checking, outside this scope: Perplexity says Sonar Chat Completions support ended on 2026-09-27
   (synchronous calls "keep working" while being moved to its Agent API), so the direct Perplexity visibility
   fallback is on a retired endpoint; `gpt-image-1` is no longer on OpenAI's pricing page; Google doubles Gemini 4
   Argon's price on 2026-12-01 and Gemini Flash's on 2027-01-01, which raises the Gemini visibility column.

## 15. PM resolutions (2026-11-10). Where these differ from the sections above, these win.

| # | Resolution | Changes |
|---|---|---|
| R1 | **A way back to automatic without UI.** For a premium purpose, a Settings choice equal to `standardDefault(kind)` counts as no choice: the premium chain runs. So "Settings shows Claude Opus 5.5" always means drafts, refresh drafts and calendar topics run on the premium chain, whether Opus is shown by default or was picked. Any other explicit choice replaces the premium chain as in §1.1. | §1.1 `resolve`, row "premium, `explicit` set": applies only when `explicit !== standardDefault(kind)`. E1 tests both cases. |
| R2 | **Thinking headroom on standard Claude attempts.** In tiered mode (not `off`), a standard-tier attempt whose model is a Claude model and whose caller budget is under 4,000 tokens gets `max_tokens = base + 2048` (`STANDARD_CLAUDE_HEADROOM`). Claude 5.x always thinks and thinking counts against `max_tokens`; with Opus as the writing default, calls that ask for 600 to 900 tokens would otherwise truncate. Non-Claude attempts and legacy mode are untouched. | §1.5 `maxTokens`; §2.6 restated: in tiered mode a standard call's body for a non-Claude model is today's; for a Claude model only `max_tokens` may differ. |
| R3 | **Low effort on three user-waiting standard purposes:** `support.answer` (12 s timeout, no retries), `article.rewrite`, `brief.rewrite`. `tiers.ts` gains `STANDARD_EFFORT: Record<string, Effort>` with those three at `'low'`; the standard step carries that effort when tiers are on and `RADAR_AI_EFFORT` is not `off`. EF-2 covers a rejection. All other standard purposes send no effort field. | §1.1 standard row; §2.6. |
| R4 | VW-1 counts full, non-failed runs, as §6.1 builds it. | Brief VW-1 reworded. |
| R5 | D11 stands: a prompt the user adds is collected at once. | Brief VW-2 reworded. |
| R6 | **A switch for the pack image.** `RADAR_SOCIAL_PACK_IMAGE=per_platform` restores one generation per platform (today's code path). Unset = one per pack. | §5.2; E2 owns it and its `.env.example` line. |
| R7 | The stale `i2.stored` hash in `openrouter.qa.test.ts` is not re-pinned in this work. The parity test's diff must remain exactly that one line. | §9.1 unchanged. |
| R8 | Premium effort `medium`, Sunday local night, and Fable 5.1's new description are accepted as designed. | none |
| R9 | Nothing is committed. Engineers leave their work in the working tree. | none |
| R10 | **Weekly rule revised after QA (DEF-1).** `visibilityDue` is true when the business is not dormant and either (a) today in `tz` is `VIS_WEEKDAY` and the newest full run started 3 or more local calendar days ago, or never; or (b) the newest full run started 8 or more local calendar days ago, or there is none in the lookback, on any weekday. (a) keeps every week's Sunday run even after an off-cycle full run early in the week; (b) catches up a missed or failed Sunday the next night and the schedule returns to Sunday. Thresholds `VIS_SKIP_WITHIN_DAYS = 3` and `VIS_OVERDUE_DAYS = 8` live in `idle.ts`. | §6.1; brief VW-1, VW-1a. |
| R11 | **A provider marked unavailable during a call is not asked again in that call (DEF-2).** Before a direct attempt, a route whose provider was marked down earlier in this same `run()` is skipped when a later usable route exists; the last-resort behaviour (everything looks unavailable: still try) is kept. | §1.5. |
| R12 | `VIS_SKIP_WITHIN_DAYS = 2` (not 3): every scheduled run is on Sunday unless it is catching up a miss; only a Saturday or same-Sunday full run skips it. Maximum gap stays 8 local days. | R10; brief VW-1a. |
| R13 | A finished full run with `total > 0` and `collected = 0` does not count as the week's run (brief VW-1b). `collectAll` returns `{ total, collected }`; job results without `collected` count as before. | §6.1; `collect.ts` return values only. |
