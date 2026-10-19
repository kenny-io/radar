// OpenAI Responses API adapter. Also used for xAI (OpenAI-compatible Responses API at api.x.ai/v1).
import { fetchJson, sseEvents } from './http';
import type { ProviderCall, ProviderResult } from '../index';

function collect(res: any): ProviderResult {
  let text = ''; const citations: { url: string; title?: string }[] = [];
  for (const item of res.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text') { text += c.text; for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title }); }
    }
  }
  if (!text && typeof res.output_text === 'string') text = res.output_text;
  return { text, citations, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
}

export async function openaiRun(c: ProviderCall, cfg: { base: string; key: string }): Promise<ProviderResult> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` };
  const input: any[] = [];
  if (c.system) input.push({ role: 'system', content: c.system });
  input.push({ role: 'user', content: c.prompt });
  // temperature: only xAI accepts it; OpenAI's GPT-6 models reject it ("Unsupported parameter: 'temperature'").
  const body: any = { model: c.apiModel, input, max_output_tokens: c.maxTokens, ...(c.temperature != null && cfg.base.includes('x.ai') ? { temperature: c.temperature } : {}) };
  if (c.webSearch && c.jsonSchema) {
    // Two passes, as in the Anthropic adapter: research with web search in free text, then structure the findings.
    // A single search+schema call can return an empty structure after searching (seen with Grok).
    const researched = collect(await fetchJson(`${cfg.base}/responses`, { method: 'POST', headers, body: JSON.stringify({ ...body, tools: [{ type: 'web_search' }], input: [...input.slice(0, -1), { role: 'user', content: c.prompt + '\n\nResearch this thoroughly. Report your findings with source URLs.' }] }), timeoutMs: c.timeoutMs }));
    const prompt = `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}`;
    const out = await openaiRun({ ...c, webSearch: false, prompt }, cfg);
    out.citations = [...researched.citations, ...out.citations];
    out.inputTokens = (out.inputTokens || 0) + (researched.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (researched.outputTokens || 0);
    return out;
  }
  if (c.webSearch) body.tools = [{ type: 'web_search' }];
  if (c.jsonSchema) body.text = { format: { type: 'json_schema', name: (c.schemaName || 'output').replace(/[^a-zA-Z0-9_-]/g, '_'), schema: c.jsonSchema, strict: false } };
  if (!c.onDelta || c.jsonSchema) {
    const res = collect(await fetchJson(`${cfg.base}/responses`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs: c.timeoutMs }));
    if (c.jsonSchema) { try { res.json = JSON.parse(res.text); } catch { /* validated upstream */ } }
    return res;
  }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    const r = await fetch(`${cfg.base}/responses`, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
    if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
    let text = ''; let usage: any = {};
    for await (const ev of sseEvents(r)) {
      if (ev.data === '[DONE]') break;
      const d = JSON.parse(ev.data);
      if (d.type === 'response.output_text.delta' && d.delta) { text += d.delta; c.onDelta(d.delta); }
      if (d.type === 'response.completed') usage = d.response?.usage || {};
    }
    return { text, citations: [], inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  } finally { clearTimeout(t); }
}
