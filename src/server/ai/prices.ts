// Published prices, for cost logging in ai_calls only (never shown to a customer, never used to bill).
// Every figure was read from the provider's own page on the date beside its block; the page is named there. A model or
// unit that is not listed here logs a null cost: never a guess. A cost the route itself reports (OpenRouter
// usage.cost, Perplexity usage.cost.total_cost) is passed to recordAiCall as costUsd and wins over this table.

/** Prompt-caching rates, USD per 1M tokens: a cache read ("cache hits and refreshes"), a 5-minute cache write and a
 *  1-hour cache write. Only models whose provider publishes them have them. */
export interface CacheRates { cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number }
/** USD per 1M tokens. `long`: when input tokens exceed `over`, these rates apply to every token of that request. */
export interface Price extends CacheRates { in: number; out: number; long?: { over: number; in: number; out: number } & CacheRates }

const OPENAI_LONG = 272_000;   // "over 272,000 input tokens"
const XAI_LONG = 199_999;      // xAI's rule is "200k or more"
export const PRICE: Record<string, Price> = {
  // Anthropic: platform.claude.com/docs/en/about-claude/pricing (2026-11-10). The cache rates are the "5m cache writes",
  // "1h cache writes" and "Cache hits and refreshes" columns of the same table, read on 2026-11-12. Not modelled, because
  // nothing in a token count shows them: fast mode (`speed`) and US-only inference (`inference_geo`, 1.1x). The sandbox
  // model proxy removes both fields from the requests it forwards so that these rates stay true for what it records.
  'claude-fable-5.2': { in: 8, out: 40, cacheRead: 0.20, cacheWrite: 10, cacheWrite1h: 16 },
  'claude-fable-5.1': { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.50, cacheWrite1h: 20 },
  'claude-opus-5.5': { in: 4, out: 20, cacheRead: 0.20, cacheWrite: 5, cacheWrite1h: 8 },
  'claude-sonnet-5.5': { in: 2, out: 10, cacheRead: 0.10, cacheWrite: 2.50, cacheWrite1h: 4 },
  'claude-haiku-5.5': { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.20, long: { over: 100_000, in: 0.50, out: 2.50, cacheRead: 0.05, cacheWrite: 0.625, cacheWrite1h: 1 } },
  // OpenAI: developers.openai.com/api/docs/pricing (2026-11-10); OpenRouter's endpoint listings agree
  'gpt-6-astra': { in: 10, out: 50, long: { over: OPENAI_LONG, in: 20, out: 75 } },
  'gpt-6.1-sol': { in: 2, out: 10, long: { over: OPENAI_LONG, in: 4, out: 15 } },
  'gpt-6-sol': { in: 2, out: 10, long: { over: OPENAI_LONG, in: 4, out: 15 } },
  'gpt-6-luna': { in: 0.10, out: 0.50, long: { over: OPENAI_LONG, in: 0.20, out: 0.75 } },
  // OpenAI GPT image models: developers.openai.com/api/docs/pricing (2026-11-13). `in` is the text input rate and `out`
  // the image output rate: Radar's Images API call sends a text prompt only and gets image tokens back. A call that
  // sent an image as input ($8) would be undercounted by this row. Cached input does not apply to the Images API.
  'gpt-image-2.5-flare': { in: 5, out: 30 },
  'gpt-image-2.5-sunburst': { in: 5, out: 30 },
  'gpt-image-2.6-flare': { in: 5, out: 30 },
  'gpt-image-2.6-sunburst': { in: 5, out: 30 },
  // xAI: docs.x.ai/docs/models (2026-11-10); OpenRouter's endpoint listings agree
  'grok-4.7': { in: 2, out: 6, long: { over: XAI_LONG, in: 4, out: 12 } },
  'grok-4.6': { in: 2, out: 6, long: { over: XAI_LONG, in: 4, out: 12 } },
};
/** USD per image, by model id. xAI: docs.x.ai/docs/models (2026-11-10). OpenAI's GPT image models are billed in tokens
 *  (PRICE above), and the OpenRouter image model in tokens that vary per image (its usage.cost is used), so neither has
 *  a row here. */
export const IMAGE_PRICE: Record<string, number> = { 'grok-imagine-image': 0.02 };
/** USD per web-search tool call, by provider label: $10 per 1,000 on both pricing pages above (2026-11-10). xAI's search
 *  fee and Gemini's grounding fee are not published as a per-call figure, so searches there add nothing. */
export const SEARCH_FEE: Record<string, number> = { Anthropic: 0.01, OpenAI: 0.01 };
/** USD per API request, by model id. Perplexity Search: $5 per 1,000 requests, no token charge, a multi-query request is
 *  one request (docs.perplexity.ai/docs/getting-started/pricing and the Search quickstart, 2026-11-10). */
export const REQUEST_PRICE: Record<string, number> = { 'perplexity-search': 0.005 };

/** What a provider billed for one request. Pass only what it reported: a failed request that was never answered has none.
 *  The three cache counts are for a caller that reads a provider's prompt-caching usage (the sandbox model proxy): tokens
 *  read from cache, written to a 5-minute entry and written to a 1-hour entry. They are billed at their own rates and are
 *  not part of `inputTokens`, which is then the uncached remainder, exactly as Anthropic reports `input_tokens`. */
export interface Usage {
  inputTokens?: number | null; outputTokens?: number | null; images?: number; searches?: number; requests?: number;
  cacheReadTokens?: number | null; cacheWriteTokens?: number | null; cacheWrite1hTokens?: number | null;
}

/** One key per model whatever the route calls it: anthropic/claude-sonnet-5.5, claude-sonnet-5-5 and claude-sonnet-5.5 share a row. */
export const priceKey = (model: string) => String(model || '').toLowerCase().replace(/^[^/]+\//, '').replace(/-(\d+)-(\d+)$/, '-$1.$2');

/** null when the call's main billable unit has no known rate. Never a guess. */
export function costOf(model: string, usage: Usage, provider?: string): number | null {
  const key = priceKey(model);
  let cost = 0, billed = false;
  const read = usage.cacheReadTokens || 0, write = usage.cacheWriteTokens || 0, write1h = usage.cacheWrite1hTokens || 0;
  if (usage.inputTokens != null || usage.outputTokens != null || read || write || write1h) {
    const p = PRICE[key]; if (!p) return null;
    const inTok = usage.inputTokens || 0, outTok = usage.outputTokens || 0;
    // Prompt length counts every input token, cached or not (Anthropic's long-context rule says so in those words).
    const rate = p.long && inTok + read + write + write1h > p.long.over ? p.long : p;
    // Cached tokens on a model with no published cache rate are an unknown cost, not a free one.
    if (read && rate.cacheRead == null || write && rate.cacheWrite == null || write1h && rate.cacheWrite1h == null) return null;
    cost += (inTok * rate.in + outTok * rate.out + read * (rate.cacheRead ?? 0) + write * (rate.cacheWrite ?? 0) + write1h * (rate.cacheWrite1h ?? 0)) / 1e6; billed = true;
  }
  if (usage.images) { const p = IMAGE_PRICE[key]; if (p == null) return null; cost += usage.images * p; billed = true; }
  if (usage.requests) { const p = REQUEST_PRICE[key]; if (p == null) return null; cost += usage.requests * p; billed = true; }
  if (!billed) return null;
  // A search fee is an extra on a priced call. A provider with no published fee adds nothing (the cost is then a floor).
  if (usage.searches && provider && SEARCH_FEE[provider] != null) cost += usage.searches * SEARCH_FEE[provider];
  return cost;
}
