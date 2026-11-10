// Published prices, for cost logging in ai_calls only (never shown to a customer, never used to bill).
// Every figure was read from the provider's own page on 2026-11-10; the page is named beside each block. A model or
// unit that is not listed here logs a null cost: never a guess. A cost the route itself reports (OpenRouter
// usage.cost, Perplexity usage.cost.total_cost) is passed to recordAiCall as costUsd and wins over this table.

/** USD per 1M tokens. `long`: when input tokens exceed `over`, these rates apply to every token of that request. */
export interface Price { in: number; out: number; long?: { over: number; in: number; out: number } }

const OPENAI_LONG = 272_000;   // "over 272,000 input tokens"
const XAI_LONG = 199_999;      // xAI's rule is "200k or more"
export const PRICE: Record<string, Price> = {
  // Anthropic: platform.claude.com/docs/en/about-claude/pricing (2026-11-10)
  'claude-fable-5.2': { in: 8, out: 40 },
  'claude-fable-5.1': { in: 10, out: 50 },
  'claude-opus-5.5': { in: 4, out: 20 },
  'claude-sonnet-5.5': { in: 2, out: 10 },
  'claude-haiku-5.5': { in: 0.10, out: 0.50, long: { over: 100_000, in: 0.50, out: 2.50 } },
  // OpenAI: developers.openai.com/api/docs/pricing (2026-11-10); OpenRouter's endpoint listings agree
  'gpt-6-astra': { in: 10, out: 50, long: { over: OPENAI_LONG, in: 20, out: 75 } },
  'gpt-6.1-sol': { in: 2, out: 10, long: { over: OPENAI_LONG, in: 4, out: 15 } },
  'gpt-6-sol': { in: 2, out: 10, long: { over: OPENAI_LONG, in: 4, out: 15 } },
  'gpt-6-luna': { in: 0.10, out: 0.50, long: { over: OPENAI_LONG, in: 0.20, out: 0.75 } },
  // xAI: docs.x.ai/docs/models (2026-11-10); OpenRouter's endpoint listings agree
  'grok-4.7': { in: 2, out: 6, long: { over: XAI_LONG, in: 4, out: 12 } },
  'grok-4.6': { in: 2, out: 6, long: { over: XAI_LONG, in: 4, out: 12 } },
};
/** USD per image, by model id. xAI: docs.x.ai/docs/models (2026-11-10). gpt-image-1 is not on OpenAI's pricing page, and
 *  the OpenRouter image model is billed in tokens that vary per image (its usage.cost is used), so neither has a row. */
export const IMAGE_PRICE: Record<string, number> = { 'grok-imagine-image': 0.02 };
/** USD per web-search tool call, by provider label: $10 per 1,000 on both pricing pages above (2026-11-10). xAI's search
 *  fee and Gemini's grounding fee are not published as a per-call figure, so searches there add nothing. */
export const SEARCH_FEE: Record<string, number> = { Anthropic: 0.01, OpenAI: 0.01 };
/** USD per API request, by model id. Perplexity Search: $5 per 1,000 requests, no token charge, a multi-query request is
 *  one request (docs.perplexity.ai/docs/getting-started/pricing and the Search quickstart, 2026-11-10). */
export const REQUEST_PRICE: Record<string, number> = { 'perplexity-search': 0.005 };

/** What a provider billed for one request. Pass only what it reported: a failed request that was never answered has none. */
export interface Usage { inputTokens?: number | null; outputTokens?: number | null; images?: number; searches?: number; requests?: number }

/** One key per model whatever the route calls it: anthropic/claude-sonnet-5.5, claude-sonnet-5-5 and claude-sonnet-5.5 share a row. */
const priceKey = (model: string) => String(model || '').toLowerCase().replace(/^[^/]+\//, '').replace(/-(\d+)-(\d+)$/, '-$1.$2');

/** null when the call's main billable unit has no known rate. Never a guess. */
export function costOf(model: string, usage: Usage, provider?: string): number | null {
  const key = priceKey(model);
  let cost = 0, billed = false;
  if (usage.inputTokens != null || usage.outputTokens != null) {
    const p = PRICE[key]; if (!p) return null;
    const inTok = usage.inputTokens || 0, outTok = usage.outputTokens || 0;
    const rate = p.long && inTok > p.long.over ? p.long : p;
    cost += (inTok * rate.in + outTok * rate.out) / 1e6; billed = true;
  }
  if (usage.images) { const p = IMAGE_PRICE[key]; if (p == null) return null; cost += usage.images * p; billed = true; }
  if (usage.requests) { const p = REQUEST_PRICE[key]; if (p == null) return null; cost += usage.requests * p; billed = true; }
  if (!billed) return null;
  // A search fee is an extra on a priced call. A provider with no published fee adds nothing (the cost is then a floor).
  if (usage.searches && provider && SEARCH_FEE[provider] != null) cost += usage.searches * SEARCH_FEE[provider];
  return cost;
}
