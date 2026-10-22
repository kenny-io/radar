// AI Visibility collection (02-system.md §11): ask each assistant through its official API with web/search grounding on.
// These engines are measurement targets, not Radar's own models. Model ids are configurable (VIS_*_MODEL in env.ts).
// With OPENROUTER_API_KEY set, each engine is asked through OpenRouter first (same model family, web search on) and
// falls back to its official API on any failure (OPENROUTER_VIS_MODELS overrides the models).
import { env } from '../../env';
import { openrouterChat, openrouterEnabled, openrouterDown, markOpenrouterDown, isOpenrouterAccountError, openrouterMessage, WEB_SEARCH_TOOL, openrouterTripped, noteOpenrouterOutcome } from '../../ai/adapters/openrouter';
import type { AiEngine } from '@/lib/types';
import { stubEngine } from './stub';

export interface EngineAnswer { text: string; cites: string[]; raw: any }
/** Not configured → the cell stays "not collected" (never "not mentioned"). */
export class EngineUnavailable extends Error { constructor(public engine: AiEngine) { super(`${engine} is not configured`); } }

async function post(url: string, headers: Record<string, string>, body: any, timeoutMs = 90_000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

/** OpenAI-style Responses API output → text + url_citation annotations. */
function responsesText(j: any) {
  let text = ''; const cites: string[] = [];
  for (const item of j.output || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) if (c.type === 'output_text') { text += c.text; for (const a of c.annotations || []) if (a.url) cites.push(a.url); }
  }
  if (!text && typeof j.output_text === 'string') text = j.output_text;
  for (const u of j.citations || []) if (typeof u === 'string') cites.push(u); else if (u?.url) cites.push(u.url);
  return { text, cites };
}

/** Gemini grounding chunks are redirect links; resolve them to the cited page (fallback: the source's domain title). */
async function resolveRedirect(uri: string, title?: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(uri)) return uri;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(uri, { method: 'HEAD', redirect: 'manual', signal: ctl.signal }); clearTimeout(t);
    const loc = r.headers.get('location'); if (loc) return loc;
  } catch { /* fall through */ }
  return title && /\./.test(title) ? `https://${title}` : uri;
}

/** OpenRouter model per engine, same family as the official API. Ids verified 2026-10-23 (GET /api/v1/models and
 *  /api/v1/models/{id}/endpoints). Perplexity's Sonar models search on their own; the others use openrouter:web_search. */
export const OPENROUTER_VIS_DEFAULTS: Record<AiEngine, string> = {
  ChatGPT: 'openai/gpt-6-sol', Claude: 'anthropic/claude-sonnet-5.5', Grok: 'x-ai/grok-4.7', Gemini: 'google/gemini-4-argon', Perplexity: 'perplexity/sonar-pro',
};
export function openrouterVisModel(engine: AiEngine): string | null {
  let over: Record<string, string> = {};
  try { const v = JSON.parse(env.openrouterVisModels || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) over = v; } catch { /* */ }
  const k = Object.keys(over).find(x => x.toLowerCase() === engine.toLowerCase());
  if (k !== undefined) return String(over[k] || '') || null;
  return OPENROUTER_VIS_DEFAULTS[engine] || null;
}

async function askOpenrouter(model: string, prompt: string): Promise<EngineAnswer> {
  const body: any = { model, messages: [{ role: 'user', content: prompt }] };
  if (!model.startsWith('perplexity/')) body.tools = [WEB_SEARCH_TOOL];
  if (model.startsWith('anthropic/')) body.max_tokens = 2048; // as the direct Claude request
  // Streamed like every OpenRouter text call (45 s idle timeout), within the same 90 s total as the official APIs.
  // `raw` is the reassembled chat.completion.
  let j: any;
  try { j = await openrouterChat(body, { timeoutMs: 90_000 }); } catch (e) { noteOpenrouterOutcome(e); throw e; }
  let m: ReturnType<typeof openrouterMessage>;
  try { m = openrouterMessage(j); } catch (e) { noteOpenrouterOutcome(e); throw e; }
  noteOpenrouterOutcome(); // OpenRouter answered
  if (!m.text.trim()) throw new Error('empty response');
  // Google-grounded answers can cite redirect links; resolve them like the direct Gemini path.
  const cites = await Promise.all(m.citations.map(c => resolveRedirect(c.url, c.title)));
  return { text: m.text, cites, raw: j };
}

export async function askEngine(engine: AiEngine, prompt: string, ctx: { stub: { bid: string; profile: any; pages: string[]; manual: boolean } }): Promise<EngineAnswer> {
  if (env.devStubs) return stubEngine(engine, prompt, ctx.stub);
  let orErr: any = null;
  const model = openrouterEnabled() ? openrouterVisModel(engine) : null;
  // The breaker (repeated OpenRouter timeouts/5xx) only skips OpenRouter when the engine's official API is configured.
  if (model && !openrouterDown() && !(openrouterTripped() && hasDirect(engine))) {
    try { return await askOpenrouter(model, prompt); } catch (e: any) {
      orErr = e;
      if (isOpenrouterAccountError(e)) markOpenrouterDown(String(e?.message || e));
      console.warn(`[visibility] ${engine} via OpenRouter failed, trying its official API: ${String(e?.message || e).slice(0, 200)}`);
    }
  }
  try { return await askDirect(engine, prompt); } catch (e) {
    // OpenRouter was tried and failed, and the official API isn't configured: report the real failure. The cell still
    // stays "not collected" (never "not mentioned"); EngineUnavailable is reserved for "nothing configured".
    if (e instanceof EngineUnavailable && orErr) throw orErr;
    throw e;
  }
}

const hasDirect = (engine: AiEngine) => !!({ ChatGPT: env.openaiKey, Perplexity: env.perplexityKey, Gemini: env.geminiKey, Claude: env.anthropicKey, Grok: env.xaiKey } as Record<AiEngine, string>)[engine];

async function askDirect(engine: AiEngine, prompt: string): Promise<EngineAnswer> {
  switch (engine) {
    case 'ChatGPT': {
      if (!env.openaiKey) throw new EngineUnavailable(engine);
      const j = await post('https://api.openai.com/v1/responses', { authorization: `Bearer ${env.openaiKey}` }, { model: env.visChatgptModel, input: prompt, tools: [{ type: 'web_search' }] });
      return { ...responsesText(j), raw: j };
    }
    case 'Perplexity': {
      if (!env.perplexityKey) throw new EngineUnavailable(engine);
      const j = await post('https://api.perplexity.ai/chat/completions', { authorization: `Bearer ${env.perplexityKey}` }, { model: env.visPerplexityModel, messages: [{ role: 'user', content: prompt }] });
      const cites: string[] = (j.citations || []).map((c: any) => (typeof c === 'string' ? c : c?.url)).filter(Boolean);
      if (!cites.length) for (const s of j.search_results || []) if (s?.url) cites.push(s.url);
      return { text: j.choices?.[0]?.message?.content || '', cites, raw: j };
    }
    case 'Gemini': {
      if (!env.geminiKey) throw new EngineUnavailable(engine);
      const j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.visGeminiModel)}:generateContent`, { 'x-goog-api-key': env.geminiKey }, { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] });
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p: any) => p.text || '').join('');
      const chunks = cand?.groundingMetadata?.groundingChunks || [];
      const cites = await Promise.all(chunks.filter((c: any) => c.web?.uri).map((c: any) => resolveRedirect(c.web.uri, c.web.title)));
      return { text, cites, raw: j };
    }
    case 'Claude': {
      if (!env.anthropicKey) throw new EngineUnavailable(engine);
      const j = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': env.anthropicKey, 'anthropic-version': '2023-06-01' }, { model: env.visClaudeModel, max_tokens: 2048, messages: [{ role: 'user', content: prompt }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] });
      let text = ''; const cites: string[] = [];
      for (const b of j.content || []) if (b.type === 'text') { text += b.text; for (const c of b.citations || []) if (c.url) cites.push(c.url); }
      return { text, cites, raw: j };
    }
    case 'Grok': {
      if (!env.xaiKey) throw new EngineUnavailable(engine);
      const j = await post('https://api.x.ai/v1/responses', { authorization: `Bearer ${env.xaiKey}` }, { model: env.visGrokModel, input: [{ role: 'user', content: prompt }], tools: [{ type: 'web_search' }] });
      return { ...responsesText(j), raw: j };
    }
  }
}
