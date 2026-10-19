// Anthropic Messages API adapter: system prompt, structured JSON output (output_config.format), server web search, streaming.
import { env } from '../../env';
import { fetchJson, sseEvents } from './http';
import type { ProviderCall, ProviderResult } from '../index';

const URL = 'https://api.anthropic.com/v1/messages';
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01' });

function collect(res: any): ProviderResult {
  let text = ''; let json: any = undefined; const citations: { url: string; title?: string }[] = [];
  for (const b of res.content || []) {
    if (b.type === 'text') { text += b.text; for (const c of b.citations || []) if (c.url) citations.push({ url: c.url, title: c.title }); }
    if (b.type === 'tool_use') json = b.input;
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) citations.push({ url: r.url, title: r.title });
  }
  return { text, json, citations, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
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
  // No temperature: Claude 5.x rejects it ("`temperature` is deprecated for this model").
  const base: any = { model: c.apiModel, max_tokens: c.maxTokens, system: c.system };
  const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 6 };
  // Pass 1 (optional): research with web search, free text.
  let researched: ProviderResult | null = null;
  if (c.webSearch) {
    const body = { ...base, tools: [search], messages: [{ role: 'user', content: c.prompt + (c.jsonSchema ? '\n\nResearch this thoroughly. Report your findings with source URLs.' : '') }] };
    researched = collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    if (!c.jsonSchema) return researched;
  }
  if (c.jsonSchema) {
    const prompt = researched ? `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}` : c.prompt;
    let out: ProviderResult;
    try {
      // Structured outputs: the JSON arrives in the text block. Claude 5.x rejects forced tool_choice, so tools aren't used here.
      const body = { ...base, output_config: { format: { type: 'json_schema', schema: claudeSchema(c.jsonSchema) } }, messages: [{ role: 'user', content: prompt }] };
      out = collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    } catch (e: any) {
      // A schema Claude can't compile: ask for JSON in plain text instead (the caller validates against the full schema).
      if (!(e?.status === 400 && /schema|output_config|format/i.test(String(e?.message)))) throw e;
      const body = { ...base, messages: [{ role: 'user', content: `${prompt}\n\nReturn only a JSON value (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(c.jsonSchema)}` }] };
      out = collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    }
    if (researched) { out.citations = [...researched.citations, ...out.citations]; out.inputTokens = (out.inputTokens || 0) + (researched.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (researched.outputTokens || 0); }
    return out;
  }
  const body = { ...base, messages: [{ role: 'user', content: c.prompt }] };
  if (!c.onDelta) return collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
  // Streaming
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    const r = await fetch(URL, { method: 'POST', headers: headers(), body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
    if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
    let text = ''; let inTok = 0, outTok = 0;
    for await (const ev of sseEvents(r)) {
      const d = JSON.parse(ev.data);
      if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') { text += d.delta.text; c.onDelta(d.delta.text); }
      if (d.type === 'message_start') inTok = d.message?.usage?.input_tokens || 0;
      if (d.type === 'message_delta') outTok = d.usage?.output_tokens || outTok;
    }
    return { text, citations: [], inputTokens: inTok, outputTokens: outTok };
  } finally { clearTimeout(t); }
}
