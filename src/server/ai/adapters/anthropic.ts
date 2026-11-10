// Anthropic Messages API adapter: system prompt, structured JSON output (output_config.format), reasoning effort
// (output_config.effort), server web search, streaming.
import { env } from '../../env';
import { fetchJson, sseEvents } from './http';
import { withEffort } from './effort';
import type { ProviderCall, ProviderResult } from '../index';
import type { Effort } from '../tiers';

const URL = 'https://api.anthropic.com/v1/messages';
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01' });

/** The model declined the request (HTTP 200, stop_reason "refusal"; through OpenRouter, a content_filter finish). A
 *  failed attempt, never an answer: `permanent` ends the retries on this route and `refusal` tells ai.run not to ask
 *  the same model on its other route. `billed` is the usage the response reported, so the attempt is still costed. */
export function refusalError(category?: unknown, billed?: Pick<ProviderResult, 'inputTokens' | 'outputTokens' | 'costUsd'>): Error {
  const cat = typeof category === 'string' ? category.replace(/[^\w.-]/g, '').slice(0, 40) : '';
  return Object.assign(new Error('Model declined the request' + (cat ? ` (${cat})` : '')), { refusal: true, permanent: true, billed });
}
/** Pass 1 of a two-pass call (web search, then structure) was answered and billed before pass 2 failed: the error
 *  carries that usage, plus whatever pass 2 itself reported, so the failed attempt is still costed. Returns the error. */
export function billedWith(e: any, prior: Pick<ProviderResult, 'inputTokens' | 'outputTokens' | 'costUsd' | 'searches'>): any {
  const sum = (a?: number, b?: number) => (a == null && b == null ? undefined : (a || 0) + (b || 0));
  try { const b = e.billed || {}; e.billed = { inputTokens: sum(prior.inputTokens, b.inputTokens), outputTokens: sum(prior.outputTokens, b.outputTokens), costUsd: sum(prior.costUsd, b.costUsd), searches: sum(prior.searches, b.searches) }; } catch { /* not an object we can annotate */ }
  return e;
}
/** output_config for one request: the structured-output format and the effort share one object; neither → no field. */
const outputConfig = (effort?: Effort, format?: any) => (format || effort ? { output_config: { ...(format ? { format } : {}), ...(effort ? { effort } : {}) } } : {});

function collect(res: any): ProviderResult {
  const usage = { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
  if (res.stop_reason === 'refusal') throw refusalError(res.stop_details?.category, res.usage ? usage : undefined);
  let text = ''; let json: any = undefined; const citations: { url: string; title?: string }[] = [];
  for (const b of res.content || []) {
    if (b.type === 'text') { text += b.text; for (const c of b.citations || []) if (c.url) citations.push({ url: c.url, title: c.title }); }
    if (b.type === 'tool_use') json = b.input;
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) citations.push({ url: r.url, title: r.title });
  }
  const searches = res.usage?.server_tool_use?.web_search_requests;
  return { text, json, citations, ...usage, ...(searches ? { searches } : {}) };
}

/** JSON Schema subset accepted by Claude structured outputs: objects closed, no numeric/length bounds, minItems ≤ 1. */
export function claudeSchema(node: any): any {
  if (Array.isArray(node)) return node.map(claudeSchema);
  if (!node || typeof node !== 'object') return node;
  const out: any = {};
  // Limits Claude can't enforce are stated in the description instead (and enforced afterwards by fitToSchema + validation).
  const notes: string[] = [];
  if (node.maxLength != null) notes.push(`At most ${node.maxLength} characters.`);
  if (node.minLength != null && node.minLength > 1) notes.push(`At least ${node.minLength} characters.`);
  if (node.maxItems != null) notes.push(`At most ${node.maxItems} items.`);
  if (node.minItems != null && node.minItems > 1) notes.push(`At least ${node.minItems} items.`);
  if (node.minimum != null) notes.push(`Minimum ${node.minimum}.`);
  if (node.maximum != null) notes.push(`Maximum ${node.maximum}.`);
  if (notes.length) out.description = [node.description, ...notes].filter(Boolean).join(' ');
  for (const [k, v] of Object.entries(node)) {
    if (k === 'description' && notes.length) continue;
    // Maps of names → subschemas: keep every name, sanitize each subschema.
    if ((k === 'properties' || k === '$defs' || k === 'definitions') && v && typeof v === 'object' && !Array.isArray(v)) { out[k] = Object.fromEntries(Object.entries(v).map(([n, sub]) => [n, claudeSchema(sub)])); continue; }
    if (['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern', 'uniqueItems', 'minProperties', 'maxProperties', 'propertyNames', 'patternProperties'].includes(k)) continue;
    if (k === 'minItems') { if (Number(v) >= 1) out.minItems = 1; continue; }
    if (k === 'format' && typeof v === 'string' && !['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid'].includes(v)) continue;
    out[k] = claudeSchema(v);
  }
  if (out.type === 'object' || out.properties) out.additionalProperties = false;
  return out;
}

export async function anthropicRun(c: ProviderCall): Promise<ProviderResult> {
  // No temperature: Claude 5.x rejects it ("`temperature` is deprecated for this model"). No `thinking` either: Claude
  // 5.x thinks on its own and rejects an explicit setting; depth is steered by output_config.effort alone.
  const base: any = { model: c.apiModel, max_tokens: c.maxTokens, system: c.system };
  const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 6 };
  // Every request of the call carries the effort; a rejection of the field is resent once without it (./effort.ts).
  const post = (body: (effort?: Effort) => any) => withEffort(`${URL}:${c.apiModel}`, c.effort, effort => fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body(effort)), timeoutMs: c.timeoutMs }));
  // Pass 1 (optional): research with web search, free text.
  let researched: ProviderResult | null = null;
  if (c.webSearch) {
    researched = collect(await post(effort => ({ ...base, ...outputConfig(effort), tools: [search], messages: [{ role: 'user', content: c.prompt + (c.jsonSchema ? '\n\nResearch this thoroughly. Report your findings with source URLs.' : '') }] })));
    if (!c.jsonSchema) return researched;
  }
  if (c.jsonSchema) {
    const prompt = researched ? `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}` : c.prompt;
    let out: ProviderResult;
    try {
      try {
        // Structured outputs: the JSON arrives in the text block. Claude 5.x rejects forced tool_choice, so tools aren't used here.
        const format = { type: 'json_schema', schema: claudeSchema(c.jsonSchema) };
        out = collect(await post(effort => ({ ...base, ...outputConfig(effort, format), messages: [{ role: 'user', content: prompt }] })));
      } catch (e: any) {
        // A schema Claude can't compile: ask for JSON in plain text instead (the caller validates against the full schema).
        // A 400 about the effort field never reaches here: the resend inside post() keeps the schema.
        if (!(e?.status === 400 && /schema|output_config|format/i.test(String(e?.message)))) throw e;
        out = collect(await post(effort => ({ ...base, ...outputConfig(effort), messages: [{ role: 'user', content: `${prompt}\n\nReturn only a JSON value (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(c.jsonSchema)}` }] })));
      }
    } catch (e: any) {
      // The research pass was answered and billed: a structuring pass that fails or is declined still reports it.
      throw researched ? billedWith(e, researched) : e;
    }
    if (researched) {
      out.citations = [...researched.citations, ...out.citations]; out.inputTokens = (out.inputTokens || 0) + (researched.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (researched.outputTokens || 0);
      if (researched.searches || out.searches) out.searches = (researched.searches || 0) + (out.searches || 0);
    }
    return out;
  }
  const body = (effort?: Effort) => ({ ...base, ...outputConfig(effort), messages: [{ role: 'user', content: c.prompt }] });
  if (!c.onDelta) return collect(await post(body));
  // Streaming
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    // The effort resend wraps the request only: a rejection is the HTTP status, before any text has been streamed.
    const r = await withEffort(`${URL}:${c.apiModel}`, c.effort, async effort => {
      const r = await fetch(URL, { method: 'POST', headers: headers(), body: JSON.stringify({ ...body(effort), stream: true }), signal: ctl.signal });
      if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
      return r;
    });
    let text = ''; let inTok = 0, outTok = 0; let stop: any = null, category: any = null;
    for await (const ev of sseEvents(r)) {
      const d = JSON.parse(ev.data);
      if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') { text += d.delta.text; c.onDelta(d.delta.text); }
      if (d.type === 'message_start') inTok = d.message?.usage?.input_tokens || 0;
      if (d.type === 'message_delta') { outTok = d.usage?.output_tokens || outTok; if (d.delta?.stop_reason) { stop = d.delta.stop_reason; category = d.delta.stop_details?.category; } }
      if (d.type === 'error') { const e: any = new Error(`Stream error: ${d.error?.type || ''} ${d.error?.message || ''}`.slice(0, 300)); e.status = d.error?.type === 'overloaded_error' ? 529 : /credit|billing/i.test(d.error?.message || '') ? 402 : 500; throw e; }
    }
    // Declined mid-stream: the text already shown is partial. Fail the attempt (the next one starts with onReset).
    if (stop === 'refusal') throw refusalError(category, { inputTokens: inTok, outputTokens: outTok });
    return { text, citations: [], inputTokens: inTok, outputTokens: outTok };
  } finally { clearTimeout(t); }
}
