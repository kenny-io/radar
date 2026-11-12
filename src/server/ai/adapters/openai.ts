// OpenAI Responses API adapter. Also used for xAI (OpenAI-compatible Responses API at api.x.ai/v1).
import { fetchJson, sseEvents } from './http';
import { withEffort } from './effort';
import { billedWith } from './anthropic';
import type { ProviderCall, ProviderResult } from '../index';
import type { Effort } from '../tiers';

/** Web-search tool calls in a response's output: OpenAI bills each one. */
const searchCalls = (output: any) => (Array.isArray(output) ? output.filter((item: any) => item?.type === 'web_search_call').length : 0);

function collect(res: any, countSearches = false): ProviderResult {
  let text = ''; const citations: { url: string; title?: string }[] = [];
  for (const item of res.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) {
      if (c.type === 'output_text') { text += c.text; for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url) citations.push({ url: a.url, title: a.title }); }
    }
  }
  if (!text && typeof res.output_text === 'string') text = res.output_text;
  const searches = countSearches ? searchCalls(res.output) : 0;
  const truncated = res.status === 'incomplete' && res.incomplete_details?.reason === 'max_output_tokens';
  return { text, citations, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens, ...(searches ? { searches } : {}), ...(truncated ? { truncated } : {}) };
}

export async function openaiRun(c: ProviderCall, cfg: { base: string; key: string }): Promise<ProviderResult> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` };
  const input: any[] = [];
  if (c.system) input.push({ role: 'system', content: c.system });
  input.push({ role: 'user', content: c.prompt });
  // temperature: only xAI accepts it; OpenAI's GPT-6 models reject it ("Unsupported parameter: 'temperature'").
  const body: any = { model: c.apiModel, input, max_output_tokens: c.maxTokens, ...(c.temperature != null && cfg.base.includes('x.ai') ? { temperature: c.temperature } : {}) };
  // Reasoning effort (OpenAI and xAI Responses take the same field) goes on every request of the call; a rejection of
  // the field is resent once without it (./effort.ts). With no effort the body is sent untouched.
  const withReasoning = (b: any, effort?: Effort) => (effort ? { ...b, reasoning: { effort } } : b);
  const key = `${cfg.base}:${c.apiModel}`;
  const post = (b: any) => withEffort(key, c.effort, effort => fetchJson(`${cfg.base}/responses`, { method: 'POST', headers, body: JSON.stringify(withReasoning(b, effort)), timeoutMs: c.timeoutMs }));
  // The per-call search fee is OpenAI's; xAI publishes none, so its searches are not counted.
  const billsSearch = cfg.base.includes('api.openai.com');
  if (c.webSearch && c.jsonSchema) {
    // Two passes, as in the Anthropic adapter: research with web search in free text, then structure the findings.
    // A single search+schema call can return an empty structure after searching (seen with Grok).
    const researched = collect(await post({ ...body, tools: [{ type: 'web_search' }], input: [...input.slice(0, -1), { role: 'user', content: c.prompt + '\n\nResearch this thoroughly. Report your findings with source URLs.' }] }), billsSearch);
    const prompt = `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}`;
    // Pass 1 was answered and billed: a pass 2 that fails still reports it.
    const out = await openaiRun({ ...c, webSearch: false, prompt }, cfg).catch(e => { throw billedWith(e, researched); });
    out.citations = [...researched.citations, ...out.citations];
    out.inputTokens = (out.inputTokens || 0) + (researched.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (researched.outputTokens || 0);
    if (researched.searches || out.searches) out.searches = (researched.searches || 0) + (out.searches || 0);
    return out;
  }
  if (c.webSearch) body.tools = [{ type: 'web_search' }];
  if (c.jsonSchema) body.text = { format: { type: 'json_schema', name: (c.schemaName || 'output').replace(/[^a-zA-Z0-9_-]/g, '_'), schema: c.jsonSchema, strict: false } };
  if (!c.onDelta || c.jsonSchema) {
    const res = collect(await post(body), billsSearch);
    if (c.jsonSchema) { try { res.json = JSON.parse(res.text); } catch { /* validated upstream */ } }
    return res;
  }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), c.timeoutMs);
  try {
    // The effort resend wraps the request only: a rejection is the HTTP status, before any text has been streamed.
    const r = await withEffort(key, c.effort, async effort => {
      const r = await fetch(`${cfg.base}/responses`, { method: 'POST', headers, body: JSON.stringify({ ...withReasoning(body, effort), stream: true }), signal: ctl.signal });
      if (!r.ok) { const e: any = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429; throw e; }
      return r;
    });
    let text = ''; let usage: any = {}; let searches = 0;
    for await (const ev of sseEvents(r)) {
      if (ev.data === '[DONE]') break;
      const d = JSON.parse(ev.data);
      if (d.type === 'response.output_text.delta' && d.delta) { text += d.delta; c.onDelta(d.delta); }
      if (d.type === 'response.completed') { usage = d.response?.usage || {}; if (billsSearch) searches = searchCalls(d.response?.output); }
      // Errors arrive inside a 200 stream (e.g. out of credit): surface them so the call fails over instead of returning ''.
      if (d.type === 'error' || d.type === 'response.failed' || d.type === 'response.incomplete') {
        const m = d.error?.message || d.message || d.response?.error?.message || d.response?.incomplete_details?.reason || d.type;
        const code = d.error?.code || d.code || d.response?.error?.code || '';
        if (d.type === 'response.incomplete' && text) break; // truncated by max tokens: keep what was written
        const e: any = new Error(`Stream ${d.type}: ${code} ${m}`.slice(0, 300)); e.status = /quota|credit|billing/i.test(m + code) ? 429 : 500; throw e;
      }
    }
    return { text, citations: [], inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, ...(searches ? { searches } : {}) };
  } finally { clearTimeout(t); }
}
