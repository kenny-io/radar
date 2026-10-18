// Anthropic Messages API adapter: system prompt, forced-tool JSON output, server web search, streaming.
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

export async function anthropicRun(c: ProviderCall): Promise<ProviderResult> {
  const base: any = { model: c.apiModel, max_tokens: c.maxTokens, system: c.system, ...(c.temperature != null ? { temperature: c.temperature } : {}) };
  const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 6 };
  // Pass 1 (optional): research with web search, free text.
  let researched: ProviderResult | null = null;
  if (c.webSearch) {
    const body = { ...base, tools: [search], messages: [{ role: 'user', content: c.prompt + (c.jsonSchema ? '\n\nResearch this thoroughly. Report your findings with source URLs.' : '') }] };
    researched = collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    if (!c.jsonSchema) return researched;
  }
  if (c.jsonSchema) {
    const tool = { name: c.schemaName || 'output', description: 'Return the result in exactly this structure.', input_schema: c.jsonSchema };
    const prompt = researched ? `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}` : c.prompt;
    const body = { ...base, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: prompt }] };
    const out = collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    if (researched) { out.citations = [...researched.citations, ...out.citations]; out.inputTokens = (out.inputTokens || 0) + (researched.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (researched.outputTokens || 0); }
    return out;
  }
  const body = { ...base, messages: [{ role: 'user', content: c.prompt }] };
  if (!c.onDelta) return collect(await fetchJson(URL, { method: 'POST', headers: headers(), body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
  // Streaming
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    const r = await fetch(URL, { method: 'POST', headers: headers(), body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
    if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
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
