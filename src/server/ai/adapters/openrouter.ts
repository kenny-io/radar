// OpenRouter adapter (openrouter.ai): OpenAI-compatible Chat Completions with streaming, structured outputs and the
// openrouter:web_search server tool. Shared OpenRouter config (model map, headers, account cooldown) lives here too so
// text calls (ai/index.ts), images (services/images.ts) and AI Visibility (services/visibility/engines.ts) agree.
// Only used when OPENROUTER_API_KEY is set; the direct providers stay as fallback (DIVERGENCES: OpenRouter primary route).
import { env } from '../../env';
import { sseEvents } from './http';
import { claudeSchema } from './anthropic';
import type { ProviderCall, ProviderResult } from '../index';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const openrouterEnabled = () => !!env.openrouterKey;
/** HTTP-Referer / X-Title identify the app on OpenRouter (attribution and per-app analytics). */
export const openrouterHeaders = (): Record<string, string> => ({ 'content-type': 'application/json', authorization: `Bearer ${env.openrouterKey}`, 'HTTP-Referer': env.appUrl, 'X-Title': 'Radar' });

/** Catalogue id (Settings → AI models) → OpenRouter model id. Verified 2026-10-23 against OpenRouter's public API:
 *  - listed in GET /api/v1/models: claude-opus/sonnet/haiku-5.5, gpt-6.1-sol, gpt-6-sol, gpt-6-luna, grok-4.7;
 *  - confirmed one by one with GET /api/v1/models/{id}/endpoints (the full list was too long to read in one fetch):
 *    claude-fable-5.1 (4 endpoints), gpt-6-astra (7), grok-4.6 (6); also grok-4.7, claude-sonnet-5.5, gpt-6-sol,
 *    which all have endpoints supporting structured_outputs.
 *  A model left out here (or set to "" in OPENROUTER_MODEL_MAP) is only served by its direct provider. */
export const OPENROUTER_IDS: Record<string, string> = {
  'claude-fable-5.1': 'anthropic/claude-fable-5.1', 'claude-opus-5.5': 'anthropic/claude-opus-5.5', 'claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5', 'claude-haiku-5.5': 'anthropic/claude-haiku-5.5',
  'gpt-6-astra': 'openai/gpt-6-astra', 'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gpt-6-sol': 'openai/gpt-6-sol', 'gpt-6-luna': 'openai/gpt-6-luna',
  'grok-4.7': 'x-ai/grok-4.7', 'grok-4.6': 'x-ai/grok-4.6',
};
/** Image model default: listed in GET /api/v1/images/models (2026-10-23) with 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9 among its ratios. */
export const OPENROUTER_IMAGE_DEFAULT = 'google/gemini-nano-banana-2.1';

function jsonEnv(raw: string): Record<string, string> {
  try { const v = JSON.parse(raw || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
/** OpenRouter id for a catalogue model, or null when the model has no OpenRouter route. */
export function openrouterId(catalogueId: string): string | null {
  const over = jsonEnv(env.openrouterModelMap);
  if (Object.prototype.hasOwnProperty.call(over, catalogueId)) return String(over[catalogueId] || '') || null;
  return OPENROUTER_IDS[catalogueId] || null;
}
export const openrouterImageModel = () => env.openrouterImageModel || OPENROUTER_IMAGE_DEFAULT;

/* ── Cooldowns (shared by text, images and visibility) ──
   Account errors (no credit, bad key) pause OpenRouter for 10 minutes, like the direct providers.
   A model OpenRouter doesn't know is skipped for that model only, for the same period. */
const DOWN_MS = 10 * 60_000;
let downUntil = 0;
const modelSkip = new Map<string, number>();
export const openrouterDown = () => downUntil > Date.now();
export function markOpenrouterDown(reason: string) { downUntil = Date.now() + DOWN_MS; console.warn(`[ai] OpenRouter unavailable for 10 min: ${reason.slice(0, 160)}`); }
export const openrouterSkips = (orModel: string) => (modelSkip.get(orModel) || 0) > Date.now();
export function skipOpenrouterModel(orModel: string, reason: string) { modelSkip.set(orModel, Date.now() + DOWN_MS); console.warn(`[ai] OpenRouter can't serve ${orModel}, using its direct provider: ${reason.slice(0, 160)}`); }

/* Circuit breaker for brownouts: 3 consecutive transient failures (timeout, 5xx, network) skip OpenRouter for 2 minutes
   wherever another route exists, so calls stop waiting out timeouts before going direct. A single timeout counts as 3. Any other outcome (success,
   or an answer OpenRouter did give, even an unusable one) resets the count. Separate from the 10-minute account cooldown. */
export const BREAKER_FAILS = 3;
export const BREAKER_MS = 2 * 60_000;
let strikes = 0;
let breakerUntil = 0;
export const openrouterTripped = () => breakerUntil > Date.now();
export function isOpenrouterTransient(e: any): boolean {
  if (e?.timeout || e?.transient || e?.name === 'AbortError' || e?.name === 'TimeoutError') return true;
  const st = statusOf(e);
  if (st >= 500) return true;
  return !st && (e instanceof TypeError || /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|aborted|terminated/i.test(String(e?.message || '')));
}
/** Record the outcome of an OpenRouter request (text, image or visibility) for the circuit breaker. */
export const isOpenrouterTimeout = (e: any) => !!(e?.timeout || e?.name === 'AbortError' || e?.name === 'TimeoutError');
export function noteOpenrouterOutcome(e?: any) {
  if (!e || !isOpenrouterTransient(e)) { strikes = 0; return; }
  // A timeout (idle or total) is the clearest brownout signal: it opens the breaker at once. 5xx/network: 3 in a row.
  strikes += isOpenrouterTimeout(e) ? BREAKER_FAILS : 1;
  if (strikes >= BREAKER_FAILS) {
    strikes = 0; breakerUntil = Date.now() + BREAKER_MS;
    console.warn(`[ai] OpenRouter timing out or failing, using direct providers for 2 min: ${String(e?.message || e).slice(0, 160)}`);
  }
}
/** Tests only. */
export function resetOpenrouterState() { downUntil = 0; modelSkip.clear(); strikes = 0; breakerUntil = 0; }

const statusOf = (e: any) => Number(e?.status) || Number(String(e?.message || '').match(/^HTTP (\d{3})/)?.[1]) || 0;
const ACCOUNT_WORDING = /quota|credit|billing|insufficient|spend limit|payment|key limit|limit exceeded|api key|key (is )?(disabled|revoked|invalid)|account (is )?(suspended|disabled|banned|deactivated)|suspend|banned/i;
const isModeration = (msg: string) => /moderation|flagged/i.test(msg);
/** Billing / auth failure on the OpenRouter account. A 403 is an account error only with key/credit wording: a moderation
 *  flag is about the request, and other 403s (e.g. a model blocked in a region) are about that model. */
export function isOpenrouterAccountError(e: any): boolean {
  const st = statusOf(e); const msg = String(e?.message || '');
  if (isModeration(msg)) return false;
  if (st === 401 || st === 402) return true;
  if (st === 403) return ACCOUNT_WORDING.test(msg);
  return st === 429 && /quota|credit|billing|insufficient|spend limit|payment|key limit/i.test(msg);
}
/** OpenRouter can't serve this model (unknown id, no provider serving it, or a 403 that's about the model). */
export function isOpenrouterModelMissing(e: any): boolean {
  const st = statusOf(e); const msg = String(e?.message || '');
  if (st === 403 && !isModeration(msg) && !ACCOUNT_WORDING.test(msg)) return true;
  if (/not a valid model id|model[^.]{0,80}(not found|does not exist|is not available)|no endpoints found for/i.test(msg)) return true;
  // A 404 because no endpoint supports the requested parameters is about this call (e.g. structured outputs), not the model.
  return st === 404 && !/parameter|support/i.test(msg);
}

/** Error object from an OpenRouter body or stream chunk ({ error: { code, message } }) → Error with an HTTP-like status. */
function bodyError(err: any, where: string): Error {
  const msg = String(err?.message || err?.metadata?.raw || 'unknown error');
  const code = Number(err?.code);
  const e: any = new Error(`${where}: ${err?.code ?? ''} ${msg}`.slice(0, 300));
  e.status = code >= 400 && code < 600 ? code : /quota|credit|billing|insufficient|payment/i.test(msg) ? 402 : 500;
  return e;
}

/** Text + url_citation annotations (+ Perplexity's top-level citations / search_results) from a Chat Completions body. */
export function openrouterMessage(j: any): { text: string; citations: { url: string; title?: string }[] } {
  if (j?.error) throw bodyError(j.error, 'OpenRouter error');
  const ch = j?.choices?.[0];
  if (ch?.finish_reason === 'error' || ch?.error) throw bodyError(ch?.error || { message: 'finish_reason error' }, 'OpenRouter error');
  const m = ch?.message || {};
  const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p: any) => p?.text || '').join('') : '';
  const citations: { url: string; title?: string }[] = [];
  for (const a of m.annotations || []) {
    if (a?.type !== 'url_citation') continue;
    const u = a.url_citation?.url || a.url; if (u) citations.push({ url: u, title: a.url_citation?.title || a.title });
  }
  for (const u of j?.citations || []) { const url = typeof u === 'string' ? u : u?.url; if (url) citations.push({ url }); }
  if (!citations.length) for (const s of j?.search_results || []) if (s?.url) citations.push({ url: s.url, title: s.title });
  return { text, citations };
}
function collect(j: any): ProviderResult {
  const { text, citations } = openrouterMessage(j);
  return { text, citations, inputTokens: j?.usage?.prompt_tokens, outputTokens: j?.usage?.completion_tokens, costUsd: typeof j?.usage?.cost === 'number' ? j.usage.cost : undefined };
}
const addUsage = (out: ProviderResult, r: ProviderResult) => {
  out.inputTokens = (out.inputTokens || 0) + (r.inputTokens || 0); out.outputTokens = (out.outputTokens || 0) + (r.outputTokens || 0);
  if (out.costUsd != null || r.costUsd != null) out.costUsd = (out.costUsd || 0) + (r.costUsd || 0);
};

/** Web search the current OpenRouter way (the `web` plugin and `:online` suffix are deprecated). Engine "auto" uses the
 *  model provider's native search where it has one, else Exa. Citations come back as url_citation annotations. */
export const WEB_SEARCH_TOOL = { type: 'openrouter:web_search' };

/** Every object closes and lists all of its properties as required: what OpenAI-style strict mode demands. */
export function strictCompatible(node: any): boolean {
  if (Array.isArray(node)) return node.every(strictCompatible);
  if (!node || typeof node !== 'object') return true;
  if (node.type === 'object' || node.properties) {
    const keys = Object.keys(node.properties || {});
    if (node.additionalProperties !== false) return false;
    if (!keys.every(k => (node.required || []).includes(k))) return false;
  }
  for (const [k, v] of Object.entries(node)) {
    if (['required', 'enum', 'const', 'default', 'examples'].includes(k)) continue;
    // Maps of names → subschemas (a property may itself be called "type" or "properties").
    if ((k === 'properties' || k === '$defs' || k === 'definitions') && v && typeof v === 'object' && !Array.isArray(v)) { if (!Object.values(v).every(strictCompatible)) return false; continue; }
    if (!strictCompatible(v)) return false;
  }
  return true;
}
/** response_format for a model family. Anthropic models get the same schema subset the direct adapter sends. */
export function openrouterResponseFormat(apiModel: string, schemaName: string | undefined, jsonSchema: any) {
  const anthropic = apiModel.startsWith('anthropic/');
  const { $schema: _drop, ...rest } = jsonSchema || {};
  const schema = anthropic ? claudeSchema(jsonSchema) : rest;
  return { type: 'json_schema', json_schema: { name: (schemaName || 'output').replace(/[^a-zA-Z0-9_-]/g, '_'), strict: anthropic || strictCompatible(schema), schema } };
}

/** A stream with no bytes (not even a keep-alive comment) for this long is treated as hung. */
export const STREAM_IDLE_MS = 45_000;

async function readAll(r: Response, onChunk: () => void): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader(); const dec = new TextDecoder(); let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; onChunk(); out += dec.decode(value, { stream: true }); }
  return out + dec.decode();
}

/** POST /chat/completions, always with stream:true so every call is covered by the idle timeout: the request is dropped
 *  when no bytes (not even OpenRouter's ": OPENROUTER PROCESSING" keep-alive comments) arrive for STREAM_IDLE_MS, from
 *  the moment it's sent; `timeoutMs` still caps the whole call. The SSE stream is reassembled into the usual
 *  chat.completion shape (text, url_citation annotations, Perplexity citations/search_results, usage) so callers parse
 *  one format; a plain JSON body is accepted too. Errors inside the stream throw (so the call fails over). */
export async function openrouterChat(body: any, opts: { timeoutMs: number; onDelta?: (d: string) => void }): Promise<any> {
  const ctl = new AbortController(); let idle = false;
  const idleMs = Math.min(STREAM_IDLE_MS, opts.timeoutMs);
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs);
  let it: ReturnType<typeof setTimeout> | undefined;
  const touch = () => { clearTimeout(it); it = setTimeout(() => { idle = true; ctl.abort(); }, idleMs); };
  touch();
  try {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, { method: 'POST', headers: openrouterHeaders(), body: JSON.stringify({ ...body, stream: true }), signal: ctl.signal });
    touch();
    if (!r.ok) { const txt = await readAll(r, touch); const e: any = new Error(`HTTP ${r.status}: ${txt.slice(0, 400)}`); e.status = r.status; e.permanent = r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408; throw e; }
    if (/application\/json/i.test(r.headers.get('content-type') || '')) { const txt = await readAll(r, touch); return txt ? JSON.parse(txt) : {}; }
    let text = ''; let id: any, model: any, usage: any, finish: any, citations: any, searchResults: any; let done = false;
    const annotations: any[] = [];
    for await (const ev of sseEvents(r, touch)) {
      if (ev.data === '[DONE]') { done = true; break; }
      let d: any; try { d = JSON.parse(ev.data); } catch { continue; }
      // Errors after the 200 arrive as a chunk with `error` (and finish_reason "error"): fail so the call fails over.
      if (d.error) throw bodyError(d.error, 'Stream error');
      id ??= d.id; model ??= d.model;
      const ch = d.choices?.[0];
      const delta = ch?.delta?.content;
      if (typeof delta === 'string' && delta) { text += delta; opts.onDelta?.(delta); }
      for (const a of ch?.delta?.annotations || ch?.message?.annotations || []) annotations.push(a);
      if (Array.isArray(d.citations)) citations = d.citations;
      if (Array.isArray(d.search_results)) searchResults = d.search_results;
      if (ch?.finish_reason === 'error') throw bodyError(ch.error || { message: 'finish_reason error' }, 'Stream error');
      if (ch?.finish_reason) finish = ch.finish_reason;
      if (d.usage) usage = d.usage;
    }
    // A stream that closes without [DONE] or a finish_reason was cut off mid-answer: never save a truncated answer.
    if (!done && !finish) throw Object.assign(new Error('OpenRouter stream ended before the answer finished'), { transient: true });
    return {
      id, model, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: text, ...(annotations.length ? { annotations } : {}) }, finish_reason: finish ?? null }],
      ...(usage ? { usage } : {}), ...(citations ? { citations } : {}), ...(searchResults ? { search_results: searchResults } : {}),
    };
  } catch (e: any) {
    if (ctl.signal.aborted) throw Object.assign(new Error(idle ? `OpenRouter stream idle for ${Math.round(idleMs / 1000)}s` : `OpenRouter timed out after ${Math.round(opts.timeoutMs / 1000)}s`), { timeout: true });
    throw e;
  } finally { clearTimeout(t); clearTimeout(it); }
}

export async function openrouterRun(c: ProviderCall): Promise<ProviderResult> {
  try { return await openrouterRunOnce(c); } catch (e: any) {
    if (c.effort && e?.status === 400 && /reasoning|effort/i.test(String(e?.message))) return openrouterRunOnce({ ...c, effort: undefined });
    throw e;
  }
}
async function openrouterRunOnce(c: ProviderCall): Promise<ProviderResult> {
  const messages: any[] = [];
  if (c.system) messages.push({ role: 'system', content: c.system });
  messages.push({ role: 'user', content: c.prompt });
  // temperature: only for Grok, as with the direct adapters (GPT-6 and Claude 5.x reject it).
  const base: any = { model: c.apiModel, messages, max_tokens: c.maxTokens, ...(c.temperature != null && c.apiModel.startsWith('x-ai/') ? { temperature: c.temperature } : {}) };
  if (c.effort && c.apiModel.startsWith('x-ai/')) base.reasoning = { effort: c.effort };
  const send = (body: any, onDelta?: (d: string) => void) => openrouterChat(body, { timeoutMs: c.timeoutMs, onDelta });

  if (c.webSearch && c.jsonSchema) {
    // Two passes, as in the direct adapters: research with web search in free text, then structure the findings.
    const researched = collect(await send({ ...base, tools: [WEB_SEARCH_TOOL], messages: [...messages.slice(0, -1), { role: 'user', content: c.prompt + '\n\nResearch this thoroughly. Report your findings with source URLs.' }] }));
    const prompt = `${c.prompt}\n\nResearch findings to use:\n${researched.text}\n\nSources found:\n${researched.citations.map(x => '- ' + x.url).join('\n')}`;
    const out = await openrouterRunOnce({ ...c, webSearch: false, prompt });
    out.citations = [...researched.citations, ...out.citations];
    addUsage(out, researched);
    return out;
  }
  if (c.jsonSchema) {
    // Streamed too (for the idle timeout), but JSON deltas aren't shown to the user: parsed once the stream ends.
    let out: ProviderResult;
    try {
      // require_parameters: only route to endpoints that honour response_format (some Claude hosts don't).
      out = collect(await send({ ...base, response_format: openrouterResponseFormat(c.apiModel, c.schemaName, c.jsonSchema), provider: { require_parameters: true } }));
    } catch (e: any) {
      // A schema the model can't compile: ask for JSON in plain text instead (the caller validates against the full schema).
      if (!(e?.status === 400 && /schema|response_format|json_schema|strict|structured/i.test(String(e?.message)))) throw e;
      out = collect(await send({ ...base, messages: [...messages.slice(0, -1), { role: 'user', content: `${c.prompt}\n\nReturn only a JSON value (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(c.jsonSchema)}` }] }));
    }
    try { out.json = JSON.parse(out.text); } catch { /* extracted and validated upstream */ }
    return out;
  }
  return collect(await send(c.webSearch ? { ...base, tools: [WEB_SEARCH_TOOL] } : base, c.onDelta));
}
