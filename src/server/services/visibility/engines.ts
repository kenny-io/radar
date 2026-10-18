// AI Visibility collection (02-system.md §11): ask each assistant through its official API with web/search grounding on.
// These engines are measurement targets, not Radar's own models. Model ids are configurable (VIS_*_MODEL in env.ts).
import { env } from '../../env';
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

export async function askEngine(engine: AiEngine, prompt: string, ctx: { stub: { bid: string; profile: any; pages: string[]; manual: boolean } }): Promise<EngineAnswer> {
  if (env.devStubs) return stubEngine(engine, prompt, ctx.stub);
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
