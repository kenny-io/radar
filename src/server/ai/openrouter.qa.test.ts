// Independent QA for the OpenRouter primary route (feat/openrouter). fetch is mocked throughout; the DB and object
// storage are mocked to capture ai_calls rows and stored images. Every test boots fresh modules from process.env so
// module-level cooldown state never leaks between tests.
//
// "parity" tests run the SAME scenarios with OPENROUTER_API_KEY unset and compare every request (URL, method, body,
// header names, auth), every ai_calls row, every console line and the retry backoff schedule against a golden snapshot
// captured from the parent commit (ed5ec34). Re-capture with: QA_CAPTURE=/path/out.json vitest run -t parity
// (run in a checkout of the parent commit).
//
// Two tests here were it.fails (bugs found by QA); both are fixed and now plain tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const H = vi.hoisted(() => ({ inserted: [] as any[], stored: [] as Buffer[], aiChoice: {} as Record<string, string> }));
vi.mock('../db', () => ({
  db: {
    insert: () => ({ values: (v: any) => { H.inserted.push(v); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ai: H.aiChoice }] }) }) }),
  },
  schema: { aiCalls: {}, businesses: { ai: 'ai', id: 'id' } },
}));
vi.mock('../services/storage', () => ({
  objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/x.${ext}`,
  putObject: async (key: string, body: Buffer) => { H.stored.push(body); return `mem://${key}`; },
}));

/* ── harness ── */
const OR_KEY = 'sk-or-v1-QASECRETdeadbeef0123456789';
const VARS = ['APP_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'PERPLEXITY_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL_MAP',
  'OPENROUTER_IMAGE_MODEL', 'OPENROUTER_VIS_MODELS', 'RADAR_DEV_STUBS', 'AI_MODEL_MAP', 'OPENAI_IMAGE_MODEL', 'XAI_IMAGE_MODEL',
  'VIS_CHATGPT_MODEL', 'VIS_PERPLEXITY_MODEL', 'VIS_GEMINI_MODEL', 'VIS_CLAUDE_MODEL', 'VIS_GROK_MODEL'];
const DIRECT = { APP_URL: 'https://radar.qa.example/', OPENAI_API_KEY: 'oa-key', ANTHROPIC_API_KEY: 'an-key', XAI_API_KEY: 'xa-key', PERPLEXITY_API_KEY: 'pp-key', GEMINI_API_KEY: 'gm-key' };
const savedEnv: Record<string, string | undefined> = {};
for (const v of VARS) savedEnv[v] = process.env[v];

async function boot(over: Record<string, string | undefined> = {}) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries({ ...DIRECT, ...over })) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  vi.resetModules();
  const ai = await import('./index');
  const images = await import('../services/images');
  const vis = await import('../services/visibility/engines');
  return { ai, images, vis };
}
const bootOR = (over: Record<string, string | undefined> = {}) => boot({ OPENROUTER_API_KEY: OR_KEY, ...over });
const orMod = () => import('./adapters/openrouter');

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
let calls: Call[] = [];
let logs: string[] = [];
let backoffs: number[] = [];
/** Per-test timer shrinking (e.g. { 45000: 60 } makes the 45 s stream idle cutoff 60 ms). */
let shrink: Record<number, number> = {};
function mockFetch(handler: (url: string, body: any, init: any) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method || 'GET', body, headers: { ...(init.headers || {}) } });
    return handler(String(url), body, init);
  }));
}
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  H.inserted.length = 0; H.stored.length = 0; H.aiChoice = {}; logs = []; backoffs = []; calls = []; shrink = {};
  // Retry backoff (800ms · 2^n) runs instantly but is recorded; every other timer (request timeouts) is untouched.
  vi.stubGlobal('setTimeout', ((fn: any, ms?: number, ...a: any[]) => {
    if (ms === 800 || ms === 1600 || ms === 3200) { backoffs.push(ms); ms = 0; }
    else if (ms != null && shrink[ms] != null) ms = shrink[ms];
    return realSetTimeout(fn, ms, ...a);
  }) as any);
  for (const m of ['warn', 'error', 'log', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: any[]) => { logs.push(`${m}: ${a.map(x => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`); });
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const v of VARS) if (savedEnv[v] === undefined) delete process.env[v]; else process.env[v] = savedEnv[v];
});

const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, message: string, code: any = status) => json({ error: { code, message } }, status);
const oaText = (text: string, usage: any = { input_tokens: 100, output_tokens: 50 }) => json({ output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }], usage });
const anText = (text: string) => json({ content: [{ type: 'text', text }], usage: { input_tokens: 30, output_tokens: 20 } });
const orText = (text: string, usage: any = { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 }, extra: any = {}) => json({ id: 'gen-1', choices: [{ message: { role: 'assistant', content: text, ...extra }, finish_reason: 'stop' }], usage });
const sse = (events: any[]) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
const OR_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const OR_IMG = 'https://openrouter.ai/api/v1/images';
const OA = 'https://api.openai.com/v1/responses';
const AN = 'https://api.anthropic.com/v1/messages';
const XA = 'https://api.x.ai/v1/responses';
const isOR = (u: string) => u.startsWith('https://openrouter.ai/');
const tag = (c: Call) => (isOR(c.url) ? `or:${c.body?.model}` : c.url);
const pngB64 = (w = 64, h = 48, type: 'image/png' | 'image/jpeg' = 'image/png') => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#e33'; x.fillRect(0, 0, w, h); x.fillStyle = '#33e'; x.fillRect(0, 0, w / 2, h / 2); return (type === 'image/png' ? c.toBuffer('image/png') : c.toBuffer('image/jpeg')).toString('base64'); };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const imgReq = (w: number, h: number) => ({ bid: 'b1', style: 'illustration', brand: { primary: '#112233', secondary: '#445566' }, headline: 'Ship docs faster', name: 'Acme', seed: 3, w, h, kind: 'hero' });
const visCtx = { stub: { bid: 'b', profile: {}, pages: [], manual: false } };
const Post = z.object({ title: z.string().max(60), tags: z.array(z.string()).max(3) });
const caught = (p: Promise<any>) => p.then(() => null, (e: any) => e);

/* ════════════════════════════ 1. Key unset = parent-commit behaviour (golden) ════════════════════════════ */

function snap(extra: any = {}) {
  return {
    calls: calls.map(c => ({ url: c.url, method: c.method, body: c.body, headerKeys: Object.keys(c.headers).sort(), auth: c.headers.authorization || c.headers['x-api-key'] || c.headers['x-goog-api-key'] || null })),
    rows: H.inserted.map(({ latencyMs: _l, ...r }) => r),
    logs: [...logs], backoffs: [...backoffs], stored: H.stored.map(sha), ...extra,
  };
}
const reset = () => { calls.length = 0; H.inserted.length = 0; logs.length = 0; backoffs.length = 0; H.stored.length = 0; };
const errOut = (e: any) => (e ? { name: e.constructor?.name, message: e.message, status: e.status, code: e.code } : null);

async function parityScenarios(): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  const S = Post;
  { // P1 plain text, OpenAI answers
    const { ai } = await boot(); reset(); mockFetch(() => oaText('hello'));
    const r = await ai.run('writing', { purpose: 'p1', prompt: 'hi', system: 'sys', maxTokens: 300, temperature: 0.7 });
    out.p1 = snap({ r });
  }
  { // P2 everything 500 → 3 tries × 3 providers, then generic error
    const { ai } = await boot(); reset(); mockFetch(() => err(500, 'down'));
    const e = await caught(ai.run('writing', { purpose: 'p2', prompt: 'hi' }));
    out.p2 = snap({ e: errOut(e) });
  }
  { // P3 OpenAI 402 → Anthropic; a second call skips OpenAI (10-minute cooldown)
    const { ai } = await boot(); reset(); mockFetch(u => (u === OA ? err(402, 'Insufficient credits') : anText('from claude')));
    const r1 = await ai.run('writing', { purpose: 'p3a', prompt: 'hi' });
    const r2 = await ai.run('writing', { purpose: 'p3b', prompt: 'hi' });
    out.p3 = snap({ r1, r2 });
  }
  { // P4 structured output via OpenAI
    const { ai } = await boot(); reset(); mockFetch(() => oaText('{"title":"T","tags":["a"]}'));
    const r = await ai.run('writing', { purpose: 'p4', prompt: 'p', schema: S, schemaName: 'post idea' });
    out.p4 = snap({ r });
  }
  { // P5 malformed JSON from OpenAI (retried) then Anthropic
    const { ai } = await boot(); reset(); mockFetch(u => (u === OA ? oaText('not json {') : anText('```json\n{"title":"T","tags":[]}\n```')));
    const r = await ai.run('writing', { purpose: 'p5', prompt: 'p', schema: S });
    out.p5 = snap({ r });
  }
  { // P6 streaming via OpenAI, first attempt errors in-stream
    const { ai } = await boot(); reset(); let n = 0;
    mockFetch(() => (++n === 1 ? sse([{ type: 'response.output_text.delta', delta: 'part' }, { type: 'error', error: { code: 'server_error', message: 'boom' } }]) : sse([{ type: 'response.output_text.delta', delta: 'Hel' }, { type: 'response.output_text.delta', delta: 'lo' }, { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 2 } } }])));
    let shown = ''; let resets = 0;
    const r = await ai.run('writing', { purpose: 'p6', prompt: 'p', onDelta: d => { shown += d; }, onReset: () => { resets++; shown = ''; } });
    out.p6 = snap({ r, shown, resets });
  }
  { // P7 research (web search + schema) via Anthropic
    const { ai } = await boot(); reset(); let n = 0;
    mockFetch(() => (++n === 1 ? json({ content: [{ type: 'text', text: 'findings', citations: [{ url: 'https://s.example/1', title: 'S1' }] }], usage: { input_tokens: 9, output_tokens: 9 } }) : anText('{"title":"R","tags":[]}')));
    const r = await ai.run('research', { purpose: 'p7', prompt: 'research', schema: S, webSearch: true });
    out.p7 = snap({ r });
  }
  { // P8 no AI keys at all
    const { ai } = await boot({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined }); reset(); mockFetch(() => oaText('x'));
    const e = await caught(ai.run('writing', { purpose: 'p8', prompt: 'hi' }));
    out.p8 = snap({ e: errOut(e) });
  }
  { // P9 chosen grok-4.7 with temperature (business setting)
    const { ai } = await boot(); reset(); H.aiChoice = { writing: 'grok-4.7' }; mockFetch(() => oaText('grok says'));
    const r = await ai.run('writing', { purpose: 'p9', prompt: 'hi', temperature: 0.8 }, { businessId: 'biz' });
    out.p9 = snap({ r });
  }
  { // I1 images: OpenAI 500 → xAI; second render after an OpenAI 402 skips OpenAI
    const { images } = await boot(); reset(); const b64 = pngB64();
    mockFetch(u => (u.includes('api.openai.com') ? err(500, 'img down') : json({ data: [{ b64_json: b64 }] })));
    const u1 = await images.renderImage(imgReq(1200, 628) as any);
    out.i1 = snap({ u1, configured: images.imageModelConfigured(), style: images.defaultArticleImageStyle() });
    reset(); mockFetch(u => (u.includes('api.openai.com') ? err(402, 'billing hard limit') : json({ data: [{ b64_json: b64 }] })));
    await images.renderImage(imgReq(1200, 900) as any); await images.renderImage(imgReq(1200, 675) as any);
    out.i1b = snap();
  }
  { // I2 no image keys → template, no requests
    const { images } = await boot({ OPENAI_API_KEY: undefined, XAI_API_KEY: undefined }); reset(); mockFetch(() => json({}));
    await images.renderImage(imgReq(1200, 628) as any);
    out.i2 = snap({ configured: images.imageModelConfigured(), style: images.defaultArticleImageStyle() });
  }
  { // V1 visibility: every engine through its official API
    const { vis } = await boot(); reset();
    mockFetch(u => (u.includes('openai.com') || u.includes('x.ai') ? json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ans', annotations: [{ type: 'url_citation', url: 'https://c.example' }] }] }] })
      : u.includes('perplexity') ? json({ choices: [{ message: { content: 'pp' } }], citations: ['https://p.example'] })
        : u.includes('googleapis') ? json({ candidates: [{ content: { parts: [{ text: 'gm' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://g.example/x', title: 'g.example' } }] } }] })
          : json({ content: [{ type: 'text', text: 'cl', citations: [{ url: 'https://a.example' }] }] })));
    const res: any = {};
    for (const e of ['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'Grok'] as const) { const a = await vis.askEngine(e, 'best tool?', visCtx); res[e] = { text: a.text, cites: a.cites }; }
    out.v1 = snap({ res });
  }
  { // V2 visibility: not configured / failure semantics
    const { vis } = await boot({ PERPLEXITY_API_KEY: undefined, GEMINI_API_KEY: undefined }); reset(); mockFetch(() => err(500, 'oops'));
    const e1 = await caught(vis.askEngine('Perplexity', 'q', visCtx));
    const e2 = await caught(vis.askEngine('ChatGPT', 'q', visCtx));
    out.v2 = snap({ e1: { ...errOut(e1), unavailable: e1 instanceof vis.EngineUnavailable }, e2: { ...errOut(e2), unavailable: e2 instanceof vis.EngineUnavailable } });
  }
  return JSON.parse(JSON.stringify(out));
}

describe('parity: OPENROUTER_API_KEY unset behaves exactly like the parent commit', () => {
  it('requests, ai_calls rows, logs, retries, images and visibility match the golden snapshot', async () => {
    const actual = await parityScenarios();
    if (process.env.QA_CAPTURE) { fs.writeFileSync(process.env.QA_CAPTURE, JSON.stringify(actual, null, 1)); return; }
    expect(actual).toEqual(GOLDEN);
  });
  it('an empty OPENROUTER_API_KEY counts as unset (no OpenRouter request)', async () => {
    const { ai } = await boot({ OPENROUTER_API_KEY: '' });
    mockFetch(() => oaText('hi'));
    await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(calls.map(c => c.url)).toEqual([OA]);
  });
});

/* ════════════════════════════ 2. Route order and call counts (key set) ════════════════════════════ */

describe('route order with OPENROUTER_API_KEY', () => {
  it('research: OR(opus) → direct(opus) → OR(gpt-6-sol) → direct → OR(grok) → direct', async () => {
    const { ai } = await bootOR();
    expect(ai.routes('research', 'claude-opus-5.5').map(r => `${r.via}:${r.modelId}`)).toEqual([
      'openrouter:claude-opus-5.5', 'direct:claude-opus-5.5', 'openrouter:gpt-6-sol', 'direct:gpt-6-sol', 'openrouter:grok-4.7', 'direct:grok-4.7']);
  });
  it('total transient failure: OR gets 1 try per model, direct keeps its 3 (12 fetches, not more)', async () => {
    const { ai } = await bootOR();
    mockFetch(() => err(500, 'down'));
    const e = await caught(ai.run('writing', { purpose: 'x', prompt: 'p' }));
    expect(e?.code).toBe('ai_failed');
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA, OA, OA, 'or:anthropic/claude-sonnet-5.5', AN, AN, AN, 'or:x-ai/grok-4.7', XA, XA, XA]);
    expect(backoffs).toEqual([800, 1600, 800, 1600, 800, 1600]);
    expect(H.inserted).toHaveLength(12);
    expect(H.inserted.filter(r => r.provider === 'openrouter')).toHaveLength(3);
  });
  it('OpenRouter only (no direct keys): each model gets the usual 3 attempts on OpenRouter (9 fetches)', async () => {
    const { ai } = await bootOR({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined });
    mockFetch(() => err(503, 'busy'));
    await caught(ai.run('writing', { purpose: 'x', prompt: 'p' }));
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', 'or:openai/gpt-6-sol', 'or:openai/gpt-6-sol', 'or:anthropic/claude-sonnet-5.5', 'or:anthropic/claude-sonnet-5.5', 'or:anthropic/claude-sonnet-5.5', 'or:x-ai/grok-4.7', 'or:x-ai/grok-4.7', 'or:x-ai/grok-4.7']);
  });
  it('a model with no direct key is still served by OpenRouter, in one call', async () => {
    const { ai } = await bootOR({ OPENAI_API_KEY: undefined });
    mockFetch(() => orText('via or'));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(r).toMatchObject({ provider: 'openrouter', model: 'gpt-6-sol', text: 'via or' });
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol']);
    expect(H.inserted).toMatchObject([{ provider: 'openrouter', model: 'gpt-6-sol', ok: true, costUsd: 0.0042, inputTokens: 11, outputTokens: 7 }]);
  });
  it('a business-chosen Grok model goes OR(grok) first and keeps temperature only for Grok', async () => {
    const { ai } = await bootOR();
    H.aiChoice = { writing: 'grok-4.7' };
    mockFetch(() => orText('g'));
    await ai.run('writing', { purpose: 'x', prompt: 'p', temperature: 0.8 }, { businessId: 'biz' });
    expect(calls[0].body).toMatchObject({ model: 'x-ai/grok-4.7', temperature: 0.8 });
    H.aiChoice = { writing: 'claude-sonnet-5.5' };
    await ai.run('writing', { purpose: 'x', prompt: 'p', temperature: 0.8 }, { businessId: 'biz' });
    expect(calls[1].body.model).toBe('anthropic/claude-sonnet-5.5');
    expect(calls[1].body.temperature).toBeUndefined();
  });
  it('OPENROUTER_MODEL_MAP "" sends that model straight to its direct provider', async () => {
    const { ai } = await bootOR({ OPENROUTER_MODEL_MAP: '{"gpt-6-sol":""}' });
    mockFetch(() => oaText('direct'));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(r.provider).toBe('OpenAI');
    expect(calls.map(tag)).toEqual([OA]);
  });
  it('after an OpenRouter account error, later models in the SAME call skip OpenRouter', async () => {
    // Was a bug: routes() is computed once, so each OpenRouter step now re-checks the cooldown before running.
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? err(402, 'Insufficient credits') : err(500, 'down')));
    await caught(ai.run('writing', { purpose: 'x', prompt: 'p' }));
    expect(calls.filter(c => isOR(c.url))).toHaveLength(1); // was 3 (or:gpt, or:claude, or:grok)
  });
});

/* ════════════════════════════ 3. Failure handling ════════════════════════════ */

describe('OpenRouter failure handling', () => {
  const orThenDirect = (orRes: () => Response | Promise<Response>) => (u: string) => (isOR(u) ? orRes() : u === OA ? oaText('direct') : anText('claude'));
  for (const [label, status, msg] of [
    ['401 bad key', 401, 'No auth credentials found'],
    ['402 no credit', 402, 'Insufficient credits. Add more using https://openrouter.ai/settings/credits'],
    ['403 key limit', 403, 'Key limit exceeded (total limit)'],
    ['429 credit wording', 429, 'Insufficient credits for this request'],
  ] as const) {
    it(`${label} → 10-minute cooldown for text and images; next calls go direct`, async () => {
      const { ai, images } = await bootOR();
      mockFetch(orThenDirect(() => err(status, msg)));
      const r1 = await ai.run('writing', { purpose: 'x', prompt: 'p' });
      expect(r1.provider).toBe('OpenAI');
      expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
      calls.length = 0;
      await ai.run('research', { purpose: 'y', prompt: 'p' });
      expect(calls.some(c => isOR(c.url))).toBe(false);
      const b64 = pngB64(); calls.length = 0;
      mockFetch(u => (isOR(u) ? err(500, 'should not be called') : json({ data: [{ b64_json: b64 }] })));
      await images.generatePhoto(imgReq(1200, 628) as any);
      expect(calls.map(c => c.url)).toEqual(['https://api.openai.com/v1/images/generations']);
      // Cooldown ends after 10 minutes.
      const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000 + 1);
      expect(ai.routes('writing', 'gpt-6-sol')[0]).toEqual({ modelId: 'gpt-6-sol', via: 'openrouter' });
    });
  }
  it('moderation-flagged 403 → this call goes direct, no cooldown (next call tries OpenRouter again)', async () => {
    const { ai } = await bootOR();
    mockFetch(orThenDirect(() => json({ error: { code: 403, message: 'openai/gpt-6-sol requires moderation on OpenAI. Your input was flagged for "harassment"', metadata: { reasons: ['harassment'], flagged_input: '...' } } }, 403)));
    await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
    calls.length = 0;
    await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(calls.map(tag)[0]).toBe('or:openai/gpt-6-sol');
  });
  it('a moderation-flagged 403 on an IMAGE request does not pause OpenRouter', async () => {
    const { ai, images } = await bootOR();
    const b64 = pngB64();
    mockFetch(u => (isOR(u) ? json({ error: { code: 403, message: 'Your input was flagged by moderation' } }, 403) : json({ data: [{ b64_json: b64 }] })));
    await images.generatePhoto(imgReq(1200, 628) as any);
    // Request-level refusal: OpenRouter stays available (images.ts used to treat any 403 as an account error).
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter');
  });
  it('404 unknown model → skips OpenRouter for that model only (10 min), others still use it', async () => {
    const { ai } = await bootOR();
    mockFetch((u, b) => (isOR(u) && b.model === 'openai/gpt-6-sol' ? err(404, 'No endpoints found for openai/gpt-6-sol.') : isOR(u) ? orText('or') : oaText('direct')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(r.provider).toBe('OpenAI');
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
    calls.length = 0;
    await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(calls.map(tag)).toEqual([OA]);
    H.aiChoice = { writing: 'claude-sonnet-5.5' }; calls.length = 0;
    const r3 = await ai.run('writing', { purpose: 'x', prompt: 'p' }, { businessId: 'b' });
    expect(r3.provider).toBe('openrouter');
  });
  it('404 "no endpoints support the requested parameters" → direct for this call only', async () => {
    const { ai } = await bootOR();
    let n = 0;
    mockFetch(u => (isOR(u) ? (++n === 1 ? err(404, 'No endpoints found that support the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing') : orText('{"title":"T","tags":[]}')) : oaText('{"title":"D","tags":[]}')));
    const r1 = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r1.provider).toBe('OpenAI');
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
    calls.length = 0;
    const r2 = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r2.provider).toBe('openrouter');
  });
  for (const [label, res] of [['429 rate limit', () => err(429, 'Rate limit exceeded: free-models-per-min')], ['500', () => err(500, 'Internal Server Error')], ['502 provider error', () => err(502, 'Provider returned error')], ['503', () => err(503, 'No instances available')]] as const) {
    it(`${label} → falls back to direct, no cooldown`, async () => {
      const { ai } = await bootOR();
      mockFetch(orThenDirect(res as any));
      const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
      expect(r.provider).toBe('OpenAI');
      expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
      expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter');
    });
  }
  it('network timeout → aborts after timeoutMs, falls back, opens the 2-minute breaker (not the 10-minute cooldown)', async () => {
    const { ai } = await bootOR();
    mockFetch((u, _b, init) => (isOR(u) ? new Promise<Response>((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))) : oaText('direct')));
    const t0 = Date.now();
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 60 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.provider).toBe('OpenAI');
    // PM 2026-10-23: one timeout counts as 3 strikes → breaker open for 2 minutes.
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('direct');
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60_000 + 1);
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter');
  });
  it('network error (fetch rejects) → falls back', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? Promise.reject(new TypeError('fetch failed')) : oaText('direct')));
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p' })).provider).toBe('OpenAI');
  });
  it('in-stream error chunk: partial OR text discarded via onReset, direct answer shown, no partial in result', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? sse([': OPENROUTER PROCESSING\n\n', { choices: [{ delta: { content: 'PARTIAL-OR ' } }] }, { error: { code: 'server_error', message: 'Provider disconnected' }, choices: [{ delta: {}, finish_reason: 'error' }] }])
      : sse([{ type: 'response.output_text.delta', delta: 'clean ' }, { type: 'response.output_text.delta', delta: 'answer' }, { type: 'response.completed', response: { usage: {} } }])));
    let shown = ''; const seen: string[] = []; let resets = 0;
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', onDelta: d => { shown += d; seen.push(d); }, onReset: () => { resets++; shown = ''; } });
    expect(seen[0]).toBe('PARTIAL-OR '); // it did stream...
    expect(resets).toBe(2); // ...and was reset before the direct attempt
    expect(shown).toBe('clean answer');
    expect(r.text).toBe('clean answer');
    expect(calls[0].body.stream).toBe(true);
  });
  it('in-stream credit error (402 chunk) → cooldown', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? sse([{ error: { code: 402, message: 'Insufficient credits' }, choices: [{ delta: {}, finish_reason: 'error' }] }]) : sse([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response: { usage: {} } }])));
    await ai.run('writing', { purpose: 'x', prompt: 'p', onDelta: () => {} });
    expect(ai.routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
  });
  it('stream that ends with no content → treated as failure and falls back', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? sse(['data: [DONE]\n\n']) : sse([{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed', response: { usage: {} } }])));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', onDelta: () => {} });
    expect(r.provider).toBe('OpenAI');
    expect(H.inserted[0]).toMatchObject({ provider: 'openrouter', ok: false, error: 'Empty response from openrouter' });
  });
  it('malformed JSON in structured output → schema validation fails, one OR call, then direct', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? orText('{"title": "unterminated') : oaText('{"title":"D","tags":[]}')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r).toMatchObject({ provider: 'OpenAI', json: { title: 'D', tags: [] } });
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
    expect(H.inserted[0].error).toMatch(/^Structured output failed validation/);
  });
  it('JSON wrapped in prose/code fences from OpenRouter is still extracted and fitted to the schema', async () => {
    const { ai } = await bootOR();
    mockFetch(() => orText('Sure!\n```json\n{"title":"' + 'x'.repeat(80) + '","tags":["a","b","c","d"]}\n```'));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r.provider).toBe('openrouter');
    expect(r.json!.title.length).toBeLessThanOrEqual(60);
    expect(r.json!.tags).toHaveLength(3);
  });
  it('200 body with an error object (no choices) → fails over', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? json({ error: { code: 502, message: 'Upstream error' } }) : oaText('direct')));
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p' })).provider).toBe('OpenAI');
  });
});

/* ════════════════════════════ 4. Structured outputs ════════════════════════════ */

describe('OpenRouter structured outputs', () => {
  it('request shape: json_schema + strict + require_parameters, streamed (PM 2026-10-23) but no JSON deltas shown, no tools', async () => {
    const { ai } = await bootOR();
    mockFetch(() => orText('{"title":"T","tags":[]}'));
    const onDelta = vi.fn();
    await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post, schemaName: 'social post!', onDelta });
    const b = calls[0].body;
    expect(b.stream).toBe(true); // every OpenRouter text call streams so the 45 s idle timeout covers it
    expect(onDelta).not.toHaveBeenCalled();
    expect(b.tools).toBeUndefined();
    expect(b.provider).toEqual({ require_parameters: true });
    expect(b.response_format.type).toBe('json_schema');
    expect(b.response_format.json_schema).toMatchObject({ name: 'social_post_', strict: true });
    expect(b.response_format.json_schema.schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['title', 'tags'] });
    expect(b.response_format.json_schema.schema.$schema).toBeUndefined();
  });
  it('optional / record fields → strict:false for non-Claude models; Claude models always strict with the Claude subset', async () => {
    const { ai } = await bootOR();
    const Opt = z.object({ a: z.string(), b: z.string().optional(), m: z.record(z.string(), z.number()) });
    mockFetch(() => orText('{"a":"x","m":{},"title":"T","tags":[]}'));
    await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Opt });
    expect(calls[0].body.response_format.json_schema.strict).toBe(false);
    H.aiChoice = { writing: 'claude-haiku-5.5' };
    await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post }, { businessId: 'b' });
    const cs = calls[1].body.response_format.json_schema;
    expect(calls[1].body.model).toBe('anthropic/claude-haiku-5.5');
    expect(cs.strict).toBe(true);
    expect(JSON.stringify(cs.schema)).not.toMatch(/maxLength|maxItems/);
  });
  it('schema 400 → exactly one plain-JSON retry on OpenRouter; a second 400 moves on (no loop)', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? err(400, 'Invalid schema for response_format: strict mode requires ...') : oaText('{"title":"D","tags":[]}')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r.provider).toBe('OpenAI');
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', 'or:openai/gpt-6-sol', OA]);
    expect(calls[0].body.response_format).toBeDefined();
    expect(calls[1].body.response_format).toBeUndefined();
    expect(calls[1].body.provider).toBeUndefined();
    expect(calls[1].body.messages.at(-1).content).toMatch(/Return only a JSON value[\s\S]*"title"/);
  });
  it('schema 400 with OpenRouter as the only route: 2 calls per model, never more', async () => {
    const { ai } = await bootOR({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined });
    mockFetch(() => err(400, 'Invalid schema for response_format'));
    await caught(ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post }));
    expect(calls).toHaveLength(6);
    expect(backoffs).toEqual([]);
  });
  it('a non-schema 400 is not retried as plain JSON', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? err(400, 'max_tokens must be at least 16') : oaText('{"title":"D","tags":[]}')));
    await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', OA]);
  });
  it('research + schema: web_search pass then structuring pass; failure in pass 2 → direct does both passes (4 fetches)', async () => {
    const { ai } = await bootOR();
    let n = 0;
    mockFetch(u => (isOR(u) ? (++n === 1 ? orText('found', undefined, { annotations: [{ type: 'url_citation', url_citation: { url: 'https://s.example/a', title: 'A' } }] }) : err(500, 'down'))
      : u === AN && calls.filter(c => c.url === AN).length === 1 ? json({ content: [{ type: 'text', text: 'direct findings' }], usage: {} }) : anText('{"title":"R","tags":[]}')));
    const r = await ai.run('research', { purpose: 'x', prompt: 'p', schema: Post, webSearch: true });
    expect(r.provider).toBe('Anthropic');
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-opus-5.5', 'or:anthropic/claude-opus-5.5', AN, AN]);
    expect(calls[0].body.tools).toEqual([{ type: 'openrouter:web_search' }]);
    expect(calls[1].body.response_format.json_schema.strict).toBe(true);
  });
  it('plain research (web search, no schema) sends the web_search tool and returns url_citation citations', async () => {
    const { ai } = await bootOR();
    mockFetch(() => orText('answer', undefined, { annotations: [{ type: 'url_citation', url_citation: { url: 'https://x.example/1', title: 'X' } }, { type: 'url_citation', url: 'https://flat.example' }, { type: 'file', file: {} }] }));
    const r = await ai.run('research', { purpose: 'x', prompt: 'p', webSearch: true });
    expect(calls[0].body.tools).toEqual([{ type: 'openrouter:web_search' }]);
    expect(r.citations.map(c => c.url)).toEqual(['https://x.example/1', 'https://flat.example']);
  });
});

/* ════════════════════════════ 5. Images ════════════════════════════ */

describe('images via OpenRouter', () => {
  it('aspect ratio for every size Radar requests (hero/linkedin/facebook/quora 1200×628, x/brief 1200×675, reddit 1200×900)', async () => {
    const { images } = await bootOR();
    const { IMG_SIZES } = await import('@/lib/constants');
    const { BRIEF_IMG_W, BRIEF_IMG_H } = await import('../services/brief/visuals').catch(() => ({ BRIEF_IMG_W: 1200, BRIEF_IMG_H: 675 }));
    const got = Object.fromEntries([...Object.entries(IMG_SIZES), ['brief', [BRIEF_IMG_W, BRIEF_IMG_H]]].map(([k, [w, h]]: any) => [k, images.openrouterAspect(w, h)]));
    expect(got).toEqual({ hero: '16:9', linkedin: '16:9', facebook: '16:9', quora: '16:9', x: '16:9', reddit: '4:3', brief: '16:9' });
  });
  for (const [type, w, h] of [['image/png', 1200, 628], ['image/jpeg', 1200, 900], ['image/jpeg', 1200, 675]] as const) {
    it(`decodes ${type} (with and without data: prefix) and cover-crops to exactly ${w}×${h}`, async () => {
      const { images } = await bootOR();
      const b64 = pngB64(160, 90, type);
      for (const payload of [b64, `data:${type};base64,${b64}`]) {
        mockFetch(() => json({ created: 1, data: [{ b64_json: payload, media_type: type }], usage: { cost: 0.04 } }));
        const out = await images.generatePhoto(imgReq(w, h) as any);
        const img = await loadImage(out);
        expect([img.width, img.height]).toEqual([w, h]);
        expect(out.subarray(0, 4).toString('hex')).toBe('89504e47'); // stored as PNG
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual({ model: 'google/gemini-nano-banana-2.1', prompt: expect.stringContaining('No words, letters'), aspect_ratio: images.openrouterAspect(w, h), n: 1 });
        expect(calls[0].headers).toMatchObject({ authorization: `Bearer ${OR_KEY}`, 'HTTP-Referer': 'https://radar.qa.example', 'X-Title': 'Radar' });
      }
    });
  }
  it('missing media_type is fine; SVG and empty data fall back to OpenAI', async () => {
    const { images } = await bootOR();
    const b64 = pngB64();
    mockFetch(() => json({ data: [{ b64_json: b64 }] }));
    await images.generatePhoto(imgReq(1200, 628) as any);
    expect(calls).toHaveLength(1);
    for (const bad of [{ data: [{ b64_json: Buffer.from('<svg/>').toString('base64'), media_type: 'image/svg+xml' }] }, { data: [] }, { error: { code: 502, message: 'provider error' } }]) {
      mockFetch(u => (isOR(u) ? json(bad) : json({ data: [{ b64_json: b64 }] })));
      await images.generatePhoto(imgReq(1200, 628) as any);
      expect(calls.map(c => c.url)).toEqual([OR_IMG, 'https://api.openai.com/v1/images/generations']);
    }
  });
  it('renderImage: OR failure with no other image key → brand template (no throw)', async () => {
    const { images } = await bootOR({ OPENAI_API_KEY: undefined, XAI_API_KEY: undefined });
    expect(images.imageModelConfigured()).toBe(true);
    expect(images.defaultArticleImageStyle()).toBe('illustration');
    mockFetch(() => err(500, 'down'));
    const url = await images.renderImage(imgReq(1200, 628) as any);
    expect(url).toMatch(/^mem:\/\//);
    expect(calls.map(c => c.url)).toEqual([OR_IMG]);
    const img = await loadImage(H.stored[0]);
    expect([img.width, img.height]).toEqual([1200, 628]);
  });
  it('an image account error (402) pauses OpenRouter for text too', async () => {
    const { ai, images } = await bootOR();
    const b64 = pngB64();
    mockFetch(u => (isOR(u) ? err(402, 'Insufficient credits') : json({ data: [{ b64_json: b64 }] })));
    await images.generatePhoto(imgReq(1200, 628) as any);
    expect(ai.routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
  });
  it('dev stubs: no image model even with a key', async () => {
    const { images } = await bootOR({ RADAR_DEV_STUBS: '1' });
    expect(images.imageModelConfigured()).toBe(false);
  });
});

/* ════════════════════════════ 6. AI Visibility ════════════════════════════ */

describe('AI Visibility via OpenRouter', () => {
  it('each engine → its model, web search tool (not for Sonar), Claude max_tokens 2048, attribution headers', async () => {
    const { vis } = await bootOR();
    mockFetch(() => orText('answer'));
    const expectModel = { ChatGPT: 'openai/gpt-6-sol', Claude: 'anthropic/claude-sonnet-5.5', Grok: 'x-ai/grok-4.7', Gemini: 'google/gemini-4-argon', Perplexity: 'perplexity/sonar-pro' } as const;
    for (const [engine, model] of Object.entries(expectModel)) {
      calls.length = 0;
      await vis.askEngine(engine as any, 'which tool?', visCtx);
      expect(calls).toHaveLength(1);
      const b = calls[0].body;
      expect(calls[0].url).toBe(OR_CHAT);
      expect(b.model).toBe(model);
      expect(b.messages).toEqual([{ role: 'user', content: 'which tool?' }]);
      if (engine === 'Perplexity') expect(b.tools).toBeUndefined(); else expect(b.tools).toEqual([{ type: 'openrouter:web_search' }]);
      if (engine === 'Claude') expect(b.max_tokens).toBe(2048);
      expect(calls[0].headers).toMatchObject({ 'content-type': 'application/json', authorization: `Bearer ${OR_KEY}`, 'HTTP-Referer': 'https://radar.qa.example', 'X-Title': 'Radar' });
    }
  });
  it('citations: nested url_citation, flat url, Perplexity citations (strings/objects), search_results fallback', async () => {
    const { vis } = await bootOR();
    mockFetch(() => orText('a', undefined, { annotations: [{ type: 'url_citation', url_citation: { url: 'https://n.example/1', title: 'N' } }, { type: 'url_citation', url: 'https://flat.example/2' }, { type: 'other', url: 'https://ignored.example' }] }));
    expect((await vis.askEngine('ChatGPT', 'q', visCtx)).cites).toEqual(['https://n.example/1', 'https://flat.example/2']);
    mockFetch(() => json({ choices: [{ message: { content: 'p' } }], citations: ['https://p.example/1', { url: 'https://p.example/2' }] }));
    expect((await vis.askEngine('Perplexity', 'q', visCtx)).cites).toEqual(['https://p.example/1', 'https://p.example/2']);
    mockFetch(() => json({ choices: [{ message: { content: 'p' } }], search_results: [{ url: 'https://sr.example/1', title: 'SR' }] }));
    expect((await vis.askEngine('Perplexity', 'q', visCtx)).cites).toEqual(['https://sr.example/1']);
  });
  it('Gemini grounding redirect links in OR citations are resolved like the direct path (no key sent to Google)', async () => {
    const { vis } = await bootOR();
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
    mockFetch(u => (u === redirect ? new Response(null, { status: 302, headers: { location: 'https://real.example/page' } }) : orText('g', undefined, { annotations: [{ type: 'url_citation', url_citation: { url: redirect, title: 'real.example' } }] })));
    const a = await vis.askEngine('Gemini', 'q', visCtx);
    expect(a.cites).toEqual(['https://real.example/page']);
    expect(calls.find(c => c.url === redirect)!.headers.authorization).toBeUndefined();
  });
  it('falls back to the official API on OR failure, with the exact parent-commit direct request', async () => {
    const { vis } = await bootOR();
    mockFetch(u => (isOR(u) ? err(500, 'down') : json({ choices: [{ message: { content: 'direct pp' } }], citations: ['https://d.example'] })));
    const a = await vis.askEngine('Perplexity', 'q', visCtx);
    expect(a).toMatchObject({ text: 'direct pp', cites: ['https://d.example'] });
    expect(calls.map(c => c.url)).toEqual([OR_CHAT, 'https://api.perplexity.ai/chat/completions']);
    expect(calls[1].body).toEqual({ model: 'sonar-pro', messages: [{ role: 'user', content: 'q' }] });
    expect(calls[1].headers.authorization).toBe('Bearer pp-key');
  });
  it('fetch rejection / 429 / 200-with-error → falls back to the official API', async () => {
    const { vis } = await bootOR();
    for (const orRes of [() => Promise.reject(new TypeError('fetch failed')), () => err(429, 'Rate limit exceeded'), () => json({ error: { code: 502, message: 'bad gateway' } })]) {
      mockFetch(u => (isOR(u) ? orRes() : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
      expect((await vis.askEngine('ChatGPT', 'q', visCtx)).text).toBe('direct');
    }
  });
  it('OR account error from visibility → cooldown shared with text; next engine call goes direct only', async () => {
    const { ai, vis } = await bootOR();
    mockFetch(u => (isOR(u) ? err(402, 'Insufficient credits') : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
    await vis.askEngine('ChatGPT', 'q', visCtx);
    calls.length = 0;
    await vis.askEngine('Grok', 'q', visCtx);
    expect(calls.map(c => c.url)).toEqual([XA]);
    expect(ai.routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
  });
  it('"not collected" semantics: OR fails + no direct key → real error; no OR + no key → EngineUnavailable with zero requests', async () => {
    const { vis } = await bootOR({ GEMINI_API_KEY: undefined });
    mockFetch(() => err(503, 'busy'));
    const e1 = await caught(vis.askEngine('Gemini', 'q', visCtx));
    expect(e1).not.toBeInstanceOf(vis.EngineUnavailable);
    expect(e1.message).toMatch(/HTTP 503/);
    const v2 = await boot({ GEMINI_API_KEY: undefined });
    mockFetch(() => json({}));
    expect(await caught(v2.vis.askEngine('Gemini', 'q', visCtx))).toBeInstanceOf(v2.vis.EngineUnavailable);
    expect(calls).toHaveLength(0);
  });
  it('OR in cooldown + no direct key → reported as "not configured" (EngineUnavailable), no request', async () => {
    // Documents current behaviour (see report: nit). The cell stays "not collected", but the stored reason is not_configured.
    const { vis } = await bootOR({ GEMINI_API_KEY: undefined });
    (await orMod()).markOpenrouterDown('test');
    mockFetch(() => json({}));
    expect(await caught(vis.askEngine('Gemini', 'q', visCtx))).toBeInstanceOf(vis.EngineUnavailable);
    expect(calls).toHaveLength(0);
  });
  it('dev stubs bypass OpenRouter entirely', async () => {
    const { vis } = await bootOR({ RADAR_DEV_STUBS: '1' });
    mockFetch(() => json({}));
    await vis.askEngine('ChatGPT', 'best tool?', { stub: { bid: 'b', profile: { business: { name: 'Acme' }, domain: 'acme.example', audience: { competitors: [] } }, pages: [], manual: false } }).catch(() => null);
    expect(calls).toHaveLength(0);
  });
});

/* ════════════════════════════ 7. Security / hygiene ════════════════════════════ */

describe('the OpenRouter key never leaks', () => {
  it('not in logs, ai_calls rows, thrown errors, visibility errors; only ever sent to openrouter.ai', async () => {
    const { ai, images, vis } = await bootOR();
    const thrown: string[] = [];
    // A hostile/verbose error body that echoes request headers back must not be the only line of defence; we check
    // that Radar itself never adds the key. (Real OpenRouter doesn't echo it.)
    const handlers = [
      () => err(401, 'No auth credentials found'), () => err(402, 'Insufficient credits'), () => err(500, 'boom'),
      () => sse([{ error: { code: 502, message: 'Provider returned error' } }]), () => Promise.reject(new TypeError('fetch failed')),
    ];
    for (const h of handlers) {
      const { resetOpenrouterState } = await orMod(); resetOpenrouterState();
      mockFetch(u => (isOR(u) ? (h as any)() : err(500, 'direct down')));
      const all = calls;
      for (const p of [
        ai.run('writing', { purpose: 'k1', prompt: 'p' }, { retries: 0 }),
        ai.run('writing', { purpose: 'k2', prompt: 'p', onDelta: () => {} }, { retries: 0 }),
        ai.run('research', { purpose: 'k3', prompt: 'p', schema: Post, webSearch: true }, { retries: 0 }),
        images.generatePhoto(imgReq(1200, 628) as any),
        vis.askEngine('Perplexity', 'q', visCtx), vis.askEngine('ChatGPT', 'q', visCtx),
      ]) { const e = await caught(p); if (e) thrown.push(String(e.message) + ' ' + String(e.stack || '')); }
      for (const c of all) {
        const blob = JSON.stringify(c.headers);
        if (blob.includes(OR_KEY)) expect(c.url.startsWith('https://openrouter.ai/api/v1/')).toBe(true);
        expect(JSON.stringify(c.body)).not.toContain(OR_KEY);
      }
    }
    expect(H.inserted.length).toBeGreaterThan(0);
    expect(JSON.stringify(H.inserted)).not.toContain(OR_KEY);
    expect(logs.join('\n')).not.toContain(OR_KEY);
    expect(thrown.join('\n')).not.toContain(OR_KEY);
    expect(JSON.stringify(H.inserted)).not.toMatch(/sk-or-v1/);
  });
  it('HTTP-Referer is APP_URL without trailing slash; defaults to localhost when APP_URL unset', async () => {
    await bootOR();
    expect((await orMod()).openrouterHeaders()['HTTP-Referer']).toBe('https://radar.qa.example');
    await bootOR({ APP_URL: undefined });
    expect((await orMod()).openrouterHeaders()['HTTP-Referer']).toBe('http://localhost:3000');
  });
  it('ai_calls row for an OR failure stores the provider error text, not request headers', async () => {
    const { ai } = await bootOR({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined });
    mockFetch(() => err(401, 'No auth credentials found'));
    await caught(ai.run('writing', { purpose: 'x', prompt: 'p' }));
    expect(H.inserted[0]).toMatchObject({ provider: 'openrouter', ok: false, model: 'gpt-6-sol' });
    expect(H.inserted[0].error).toMatch(/^HTTP 401: /);
    expect(H.inserted[0].error).not.toMatch(/Bearer|authorization/i);
  });
});

/* ════════════════════════════ 8. Retest: streaming everywhere, idle cutoff, circuit breaker ════════════════════════════ */

const enc = new TextEncoder();
const sseLine = (v: any) => (typeof v === 'string' ? v : `data: ${JSON.stringify(v)}\n\n`);
/** A stream fed step by step (strings are written, numbers are pauses in ms). Errors the body when the request is
 *  aborted (as undici does). `close: false` leaves it hanging after the last step. */
function slowStream(steps: Array<string | number | object>, signal: AbortSignal, opts: { close?: boolean } = {}) {
  return new Response(new ReadableStream({
    async start(c) {
      let dead = false;
      signal?.addEventListener('abort', () => { dead = true; try { c.error(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })); } catch { /* */ } });
      for (const s of steps) {
        if (dead) return;
        if (typeof s === 'number') await new Promise(r => realSetTimeout(r, s)); else c.enqueue(enc.encode(sseLine(s)));
      }
      if (opts.close !== false && !dead) c.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const hang = (signal: AbortSignal) => new Promise<Response>((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
const chunk = (content: string, extra: any = {}) => ({ id: 'gen-x', choices: [{ index: 0, delta: { content }, ...extra }] });
const done = [{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.001 } }, 'data: [DONE]\n\n'];
const sleep = (ms: number) => new Promise(r => realSetTimeout(r, ms));

describe('retest: OpenRouter streaming for every text call', () => {
  it('JSON split at arbitrary byte boundaries (inside the data: line and inside UTF-8 characters) reassembles exactly', async () => {
    const { ai } = await bootOR();
    const answer = JSON.stringify({ title: 'Café — ✓ fast invoices 🧾', tags: ['naïve', 'ünïcode'] });
    const pieces = [answer.slice(0, 7), answer.slice(7, 19), answer.slice(19)];
    const full = enc.encode([': OPENROUTER PROCESSING\n\n', ...pieces.map(p => sseLine(chunk(p))), ...done.map(sseLine)].join(''));
    for (const size of [1, 2, 3, 5, 7, 64]) {
      mockFetch(() => new Response(new ReadableStream({ start(c) { for (let i = 0; i < full.length; i += size) c.enqueue(full.slice(i, i + size)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
      const r = await ai.run('writing', { purpose: 'split', prompt: 'p', schema: Post });
      expect(r.provider).toBe('openrouter');
      expect(r.json).toEqual(JSON.parse(answer));
    }
    expect(H.inserted.every(x => x.ok && x.costUsd === 0.001 && x.inputTokens === 3)).toBe(true);
  });
  it('plain-text (no onDelta) and visibility calls now send stream:true and parse the reassembled answer', async () => {
    const { ai, vis } = await bootOR();
    mockFetch((_u, _b, init) => slowStream([chunk('Hello '), chunk('world', { delta: { content: 'world', annotations: [{ type: 'url_citation', url_citation: { url: 'https://a.example' } }] } }), ...done], init.signal));
    const r = await ai.run('research', { purpose: 'x', prompt: 'p', webSearch: true });
    expect(calls[0].body.stream).toBe(true);
    expect(r).toMatchObject({ text: 'Hello world', provider: 'openrouter' });
    const a = await vis.askEngine('ChatGPT', 'q', visCtx);
    expect(calls[1].body).toMatchObject({ stream: true, model: 'openai/gpt-6-sol', tools: [{ type: 'openrouter:web_search' }] });
    expect(a.text).toBe('Hello world');
  });
  it('stream that ends with finish_reason but no [DONE] → accepted', async () => {
    const { ai } = await bootOR();
    mockFetch(() => sse([chunk('ok'), { choices: [{ delta: {}, finish_reason: 'stop' }] }]));
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p' })).text).toBe('ok');
  });
  it.fails('BUG (low): a stream that closes mid-answer (no finish_reason, no [DONE]) is accepted as a complete answer', async () => {
    const { ai, vis } = await bootOR();
    mockFetch(u => (isOR(u) ? sse([chunk('The best tools are Acme, Fo')]) : oaText('complete direct answer')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
    expect(r.provider).toBe('OpenAI'); // actual: openrouter, text 'The best tools are Acme, Fo'
    mockFetch(u => (isOR(u) ? sse([chunk('Acme is one opt')]) : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
    expect((await vis.askEngine('ChatGPT', 'q', visCtx)).text).toBe('direct');
  });
  it('error chunk in the middle of a JSON answer → partial JSON discarded, falls back, counts as one transient strike', async () => {
    const { ai } = await bootOR();
    mockFetch(u => (isOR(u) ? sse([chunk('{"title":"Half'), { error: { code: 502, message: 'Provider returned error' }, choices: [{ delta: {}, finish_reason: 'error' }] }]) : oaText('{"title":"D","tags":[]}')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', schema: Post });
    expect(r).toMatchObject({ provider: 'OpenAI', json: { title: 'D', tags: [] } });
    expect(H.inserted[0]).toMatchObject({ provider: 'openrouter', ok: false });
    expect(H.inserted[0].error).toMatch(/Stream error: 502 Provider returned error/);
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter'); // one strike, breaker still closed
  });
});

describe('retest: idle cutoff and timers', () => {
  it('idle and total timers are cleared after success / HTTP error / JSON body: nothing aborts later, breaker stays closed', async () => {
    const { ai } = await bootOR();
    shrink = { 45000: 40 };
    const signals: AbortSignal[] = [];
    for (const make of [() => sse([chunk('ok'), ...done]), () => orText('ok'), () => err(500, 'x')]) {
      mockFetch((u, _b, init) => { if (isOR(u)) signals.push(init.signal); return isOR(u) ? make() : oaText('direct'); });
      await ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 120 });
    }
    await sleep(250); // well past both the 40 ms idle and the 120 ms total
    expect(signals).toHaveLength(3);
    expect(signals.map(s => s.aborted)).toEqual([false, false, false]);
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter');
    expect(logs.join('\n')).not.toMatch(/timing out/);
  });
  it('keep-alive comments count as activity: a slow-but-alive stream is not cut', async () => {
    const { ai } = await bootOR();
    shrink = { 45000: 60 };
    mockFetch((_u, _b, init) => slowStream([': OPENROUTER PROCESSING\n\n', 35, ': OPENROUTER PROCESSING\n\n', 35, ': OPENROUTER PROCESSING\n\n', 35, chunk('alive'), 35, ...done], init.signal));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 100_000 });
    expect(r).toMatchObject({ provider: 'openrouter', text: 'alive' });
  });
  it('stalled stream after partial text → idle cutoff, partial discarded via onReset, direct answer, breaker opens', async () => {
    const { ai } = await bootOR();
    shrink = { 45000: 50 };
    mockFetch((u, _b, init) => (isOR(u) ? slowStream([chunk('PARTIAL ')], init.signal, { close: false })
      : sse([{ type: 'response.output_text.delta', delta: 'clean' }, { type: 'response.completed', response: { usage: {} } }])));
    let shown = '';
    const t0 = Date.now();
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 100_000, onDelta: d => { shown += d; }, onReset: () => { shown = ''; } });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r.provider).toBe('OpenAI');
    expect(shown).toBe('clean');
    expect(H.inserted[0].error).toMatch(/OpenRouter stream idle/);
    calls.length = 0;
    await ai.run('writing', { purpose: 'x', prompt: 'p', onDelta: () => {} });
    expect(calls.some(c => isOR(c.url))).toBe(false); // breaker open: direct only
  });
  it('hang before response headers → idle cutoff also applies', async () => {
    const { ai } = await bootOR();
    shrink = { 45000: 50 };
    mockFetch((u, _b, init) => (isOR(u) ? hang(init.signal) : oaText('direct')));
    const t0 = Date.now();
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 100_000 })).provider).toBe('OpenAI');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('retest: circuit breaker', () => {
  const orFailThenDirect = (orRes: () => Response | Promise<Response>) => (u: string) => (isOR(u) ? orRes() : oaText('direct'));
  it('3 consecutive 5xx open it; a success in between resets the count; it closes after 2 minutes', async () => {
    const { ai } = await bootOR();
    const once = async (orRes: () => Response) => { calls.length = 0; mockFetch(orFailThenDirect(orRes)); return ai.run('writing', { purpose: 'x', prompt: 'p' }); };
    await once(() => err(500, 'a')); await once(() => err(502, 'b'));
    await once(() => orText('ok')); // reset
    await once(() => err(503, 'c')); await once(() => err(500, 'd'));
    await once(() => orText('ok'));
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol']); // still closed after 2 + reset + 2
    await once(() => err(500, 'e')); await once(() => err(500, 'f')); await once(() => err(500, 'g'));
    await once(() => orText('ok'));
    expect(calls.map(tag)).toEqual([OA]); // open
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 2 * 60_000 + 1);
    await once(() => orText('ok'));
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol']);
  });
  it('4xx answers (rate limit, schema, moderation) do not count as strikes', async () => {
    const { ai } = await bootOR();
    for (let i = 0; i < 4; i++) { mockFetch(orFailThenDirect(() => err(429, 'Rate limit exceeded'))); await ai.run('writing', { purpose: 'x', prompt: 'p' }); }
    expect(ai.routes('writing', 'gpt-6-sol')[0].via).toBe('openrouter');
  });
  it('does not block OpenRouter-only setups: text, images and visibility still use OpenRouter while it is open', async () => {
    const { ai, images, vis } = await bootOR({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined, GEMINI_API_KEY: undefined });
    shrink = { 45000: 40 };
    mockFetch((_u, _b, init) => hang(init.signal));
    await caught(ai.run('writing', { purpose: 'x', prompt: 'p', timeoutMs: 100_000 }, { retries: 0 }));
    expect((await orMod()).openrouterTripped()).toBe(true);
    const b64 = pngB64();
    mockFetch(u => (u === OR_IMG ? json({ data: [{ b64_json: b64 }] }) : orText('still served')));
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p' })).provider).toBe('openrouter');
    await images.generatePhoto(imgReq(1200, 628) as any);
    expect((await vis.askEngine('Gemini', 'q', visCtx)).text).toBe('still served');
    expect(calls.map(c => c.url)).toEqual([OR_CHAT, OR_IMG, OR_CHAT]);
  });
  it('while open, it is skipped per model only where that model has a direct route', async () => {
    const { ai } = await bootOR({ OPENAI_API_KEY: undefined });
    (await orMod()).noteOpenrouterOutcome(Object.assign(new Error('t'), { timeout: true }));
    mockFetch(u => (isOR(u) ? err(500, 'down') : anText('claude direct')));
    const r = await ai.run('writing', { purpose: 'x', prompt: 'p' });
    // gpt-6-sol has no direct key → OpenRouter still tried for it; claude-sonnet has one → OpenRouter skipped.
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol', 'or:openai/gpt-6-sol', 'or:openai/gpt-6-sol', AN]);
    expect(r.provider).toBe('Anthropic');
  });
  it('an image timeout (60 s total) falls back to OpenAI and opens the breaker for text', async () => {
    const { ai, images } = await bootOR();
    shrink = { 60000: 50 };
    const b64 = pngB64();
    mockFetch((u, _b, init) => (u === OR_IMG ? hang(init.signal) : json({ data: [{ b64_json: b64 }] })));
    const t0 = Date.now();
    await images.generatePhoto(imgReq(1200, 628) as any);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(calls.map(c => c.url)).toEqual([OR_IMG, 'https://api.openai.com/v1/images/generations']);
    expect(ai.routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
    calls.length = 0;
    await images.generatePhoto(imgReq(1200, 628) as any);
    expect(calls.map(c => c.url)).toEqual(['https://api.openai.com/v1/images/generations']);
  });
  it('visibility: idle cutoff falls back to the official API and opens the breaker', async () => {
    const { vis } = await bootOR();
    shrink = { 45000: 40 };
    mockFetch((u, _b, init) => (isOR(u) ? slowStream([': OPENROUTER PROCESSING\n\n'], init.signal, { close: false }) : json({ choices: [{ message: { content: 'pp direct' } }], citations: [] })));
    expect((await vis.askEngine('Perplexity', 'q', visCtx)).text).toBe('pp direct');
    calls.length = 0;
    await vis.askEngine('Perplexity', 'q', visCtx);
    expect(calls.map(c => c.url)).toEqual(['https://api.perplexity.ai/chat/completions']);
  });
  it('non-credit 403 (e.g. region block) skips only that model, no global cooldown', async () => {
    const { ai } = await bootOR();
    mockFetch((u, b) => (isOR(u) && b.model === 'openai/gpt-6-sol' ? err(403, 'This model is not available in your region') : isOR(u) ? orText('or') : oaText('direct')));
    expect((await ai.run('writing', { purpose: 'x', prompt: 'p' })).provider).toBe('OpenAI');
    const r = ai.routes('writing', 'gpt-6-sol');
    expect(r[0]).toEqual({ modelId: 'gpt-6-sol', via: 'direct' });
    expect(r).toContainEqual({ modelId: 'claude-sonnet-5.5', via: 'openrouter' });
  });
});

describe('retest: concurrent calls', () => {
  it('6 concurrent calls hitting a 402: each tries OpenRouter at most once, none tries it for a second model, all succeed direct', async () => {
    const { ai } = await bootOR();
    mockFetch(async u => { await sleep(5); return isOR(u) ? err(402, 'Insufficient credits') : u === OA ? err(500, 'oa down') : anText('claude'); });
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => ai.run('writing', { purpose: 'c' + i, prompt: 'p' }, { retries: 0 })));
    expect(rs.every(r => r.provider === 'Anthropic')).toBe(true);
    const orCalls = calls.filter(c => isOR(c.url));
    expect(orCalls.length).toBeLessThanOrEqual(6);
    expect(orCalls.every(c => c.body.model === 'openai/gpt-6-sol')).toBe(true);
    calls.length = 0;
    await ai.run('writing', { purpose: 'after', prompt: 'p' }, { retries: 0 });
    expect(calls.some(c => isOR(c.url))).toBe(false);
  });
  it('3 concurrent calls into a hung OpenRouter each wait one idle cutoff, then go direct; the 4th skips OpenRouter', async () => {
    const { ai } = await bootOR();
    shrink = { 45000: 60 };
    mockFetch((u, _b, init) => (isOR(u) ? hang(init.signal) : oaText('direct')));
    const t0 = Date.now();
    const rs = await Promise.all([0, 1, 2].map(i => ai.run('writing', { purpose: 'h' + i, prompt: 'p', timeoutMs: 100_000 })));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rs.map(r => r.provider)).toEqual(['OpenAI', 'OpenAI', 'OpenAI']);
    expect(calls.filter(c => isOR(c.url))).toHaveLength(3);
    calls.length = 0;
    await ai.run('writing', { purpose: 'h4', prompt: 'p' });
    expect(calls.map(tag)).toEqual([OA]);
  });
});

/* ════════════════════════════ golden (captured from ed5ec34 with QA_CAPTURE) ════════════════════════════ */
// eslint-disable-next-line
const GOLDEN: any = {
  "p1": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}], "max_output_tokens": 300}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p1", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": 100, "outputTokens": 50, "costUsd": 0.0006, "ok": true, "error": null}], "logs": [], "backoffs": [], "stored": [], "r": {"text": "hello", "json": null, "citations": [], "model": "gpt-6-sol", "provider": "OpenAI"}},
  "p2": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "messages": [{"role": "user", "content": "hi"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "messages": [{"role": "user", "content": "hi"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "messages": [{"role": "user", "content": "hi"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.x.ai/v1/responses", "method": "POST", "body": {"model": "grok-4.7", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}, {"url": "https://api.x.ai/v1/responses", "method": "POST", "body": {"model": "grok-4.7", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}, {"url": "https://api.x.ai/v1/responses", "method": "POST", "body": {"model": "grok-4.7", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p2", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "grok-4.7", "provider": "SpaceX", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "grok-4.7", "provider": "SpaceX", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}, {"businessId": null, "task": "writing", "purpose": "p2", "model": "grok-4.7", "provider": "SpaceX", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"}], "logs": ["error: [ai] p2 failed HTTP 500: {\"error\":{\"code\":500,\"message\":\"down\"}}"], "backoffs": [800, 1600, 800, 1600, 800, 1600], "stored": [], "e": {"name": "RadarError", "message": "Radar couldn’t finish this. Try again.", "status": 502, "code": "ai_failed"}},
  "p3": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "messages": [{"role": "user", "content": "hi"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "messages": [{"role": "user", "content": "hi"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p3a", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "HTTP 402: {\"error\":{\"code\":402,\"message\":\"Insufficient credits\"}}"}, {"businessId": null, "task": "writing", "purpose": "p3a", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": 30, "outputTokens": 20, "costUsd": 0.00039, "ok": true, "error": null}, {"businessId": null, "task": "writing", "purpose": "p3b", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": 30, "outputTokens": 20, "costUsd": 0.00039, "ok": true, "error": null}], "logs": ["warn: [ai] OpenAI unavailable for 10 min: HTTP 402: {\"error\":{\"code\":402,\"message\":\"Insufficient credits\"}}", "warn: [ai] p3a: used claude-sonnet-5.5 (fallback from gpt-6-sol)", "warn: [ai] p3b: used claude-sonnet-5.5 (fallback from gpt-6-sol)"], "backoffs": [], "stored": [], "r1": {"text": "from claude", "json": null, "citations": [], "model": "claude-sonnet-5.5", "provider": "Anthropic"}, "r2": {"text": "from claude", "json": null, "citations": [], "model": "claude-sonnet-5.5", "provider": "Anthropic"}},
  "p4": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "text": {"format": {"type": "json_schema", "name": "post_idea", "schema": {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {"title": {"type": "string", "maxLength": 60}, "tags": {"maxItems": 3, "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}, "strict": false}}}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p4", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": 100, "outputTokens": 50, "costUsd": 0.0006, "ok": true, "error": null}], "logs": [], "backoffs": [], "stored": [], "r": {"text": "{\"title\":\"T\",\"tags\":[\"a\"]}", "json": {"title": "T", "tags": ["a"]}, "citations": [], "model": "gpt-6-sol", "provider": "OpenAI"}},
  "p5": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "text": {"format": {"type": "json_schema", "name": "output", "schema": {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {"title": {"type": "string", "maxLength": 60}, "tags": {"maxItems": 3, "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}, "strict": false}}}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "text": {"format": {"type": "json_schema", "name": "output", "schema": {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {"title": {"type": "string", "maxLength": 60}, "tags": {"maxItems": 3, "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}, "strict": false}}}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "text": {"format": {"type": "json_schema", "name": "output", "schema": {"$schema": "http://json-schema.org/draft-07/schema#", "type": "object", "properties": {"title": {"type": "string", "maxLength": 60}, "tags": {"maxItems": 3, "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}, "strict": false}}}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 4000, "output_config": {"format": {"type": "json_schema", "schema": {"type": "object", "properties": {"title": {"description": "At most 60 characters.", "type": "string"}, "tags": {"description": "At most 3 items.", "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}}}, "messages": [{"role": "user", "content": "p"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p5", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "Structured output failed validation: [\n  {\n    \"expected\": \"object\",\n    \"code\": \"invalid_type\",\n    \"path\": [],\n    \"message\": \"Invalid input: expected object, received null\"\n  }\n]"}, {"businessId": null, "task": "writing", "purpose": "p5", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "Structured output failed validation: [\n  {\n    \"expected\": \"object\",\n    \"code\": \"invalid_type\",\n    \"path\": [],\n    \"message\": \"Invalid input: expected object, received null\"\n  }\n]"}, {"businessId": null, "task": "writing", "purpose": "p5", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "Structured output failed validation: [\n  {\n    \"expected\": \"object\",\n    \"code\": \"invalid_type\",\n    \"path\": [],\n    \"message\": \"Invalid input: expected object, received null\"\n  }\n]"}, {"businessId": null, "task": "writing", "purpose": "p5", "model": "claude-sonnet-5.5", "provider": "Anthropic", "inputTokens": 30, "outputTokens": 20, "costUsd": 0.00039, "ok": true, "error": null}], "logs": ["warn: [ai] p5: used claude-sonnet-5.5 (fallback from gpt-6-sol)"], "backoffs": [800, 1600], "stored": [], "r": {"text": "```json\n{\"title\":\"T\",\"tags\":[]}\n```", "json": {"title": "T", "tags": []}, "citations": [], "model": "claude-sonnet-5.5", "provider": "Anthropic"}},
  "p6": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "stream": true}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": [{"role": "user", "content": "p"}], "max_output_tokens": 4000, "stream": true}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}], "rows": [{"businessId": null, "task": "writing", "purpose": "p6", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "Stream error: server_error boom"}, {"businessId": null, "task": "writing", "purpose": "p6", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": 5, "outputTokens": 2, "costUsd": 2.6e-05, "ok": true, "error": null}], "logs": [], "backoffs": [800], "stored": [], "r": {"text": "Hello", "json": null, "citations": [], "model": "gpt-6-sol", "provider": "OpenAI"}, "shown": "Hello", "resets": 2},
  "p7": {"calls": [{"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-opus-5-5", "max_tokens": 4000, "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 6}], "messages": [{"role": "user", "content": "research\n\nResearch this thoroughly. Report your findings with source URLs."}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-opus-5-5", "max_tokens": 4000, "output_config": {"format": {"type": "json_schema", "schema": {"type": "object", "properties": {"title": {"description": "At most 60 characters.", "type": "string"}, "tags": {"description": "At most 3 items.", "type": "array", "items": {"type": "string"}}}, "required": ["title", "tags"], "additionalProperties": false}}}, "messages": [{"role": "user", "content": "research\n\nResearch findings to use:\nfindings\n\nSources found:\n- https://s.example/1"}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}], "rows": [{"businessId": null, "task": "research", "purpose": "p7", "model": "claude-opus-5.5", "provider": "Anthropic", "inputTokens": 39, "outputTokens": 29, "costUsd": 0.00092, "ok": true, "error": null}], "logs": [], "backoffs": [], "stored": [], "r": {"text": "{\"title\":\"R\",\"tags\":[]}", "json": {"title": "R", "tags": []}, "citations": [{"url": "https://s.example/1", "title": "S1"}], "model": "claude-opus-5.5", "provider": "Anthropic"}},
  "p8": {"calls": [], "rows": [{"businessId": null, "task": "writing", "purpose": "p8", "model": "gpt-6-sol", "provider": "OpenAI", "inputTokens": null, "outputTokens": null, "costUsd": null, "ok": false, "error": "No API key configured for OpenAI"}], "logs": ["error: [ai] p8 failed No API key configured for OpenAI"], "backoffs": [], "stored": [], "e": {"name": "RadarError", "message": "Radar couldn’t finish this. Try again.", "status": 502, "code": "ai_failed"}},
  "p9": {"calls": [{"url": "https://api.x.ai/v1/responses", "method": "POST", "body": {"model": "grok-4.7", "input": [{"role": "user", "content": "hi"}], "max_output_tokens": 4000, "temperature": 0.8}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}], "rows": [{"businessId": "biz", "task": "writing", "purpose": "p9", "model": "grok-4.7", "provider": "SpaceX", "inputTokens": 100, "outputTokens": 50, "costUsd": 0.00105, "ok": true, "error": null}], "logs": [], "backoffs": [], "stored": [], "r": {"text": "grok says", "json": null, "citations": [], "model": "grok-4.7", "provider": "SpaceX"}},
  "i1": {"calls": [{"url": "https://api.openai.com/v1/images/generations", "method": "POST", "body": {"model": "gpt-image-1", "prompt": "Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Ship docs faster. Made for Acme's blog. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.", "size": "1536x1024", "n": 1}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.x.ai/v1/images/generations", "method": "POST", "body": {"model": "grok-imagine-image", "prompt": "Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Ship docs faster. Made for Acme's blog. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.", "n": 1, "aspect_ratio": "2:1", "response_format": "b64_json"}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}], "rows": [], "logs": ["warn: [images] openai image 500: {\"error\":{\"code\":500,\"message\":\"img down\"}}"], "backoffs": [], "stored": ["244247df5afbb667"], "u1": "mem://b1/hero/x.png", "configured": true, "style": "illustration"},
  "i1b": {"calls": [{"url": "https://api.openai.com/v1/images/generations", "method": "POST", "body": {"model": "gpt-image-1", "prompt": "Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Ship docs faster. Made for Acme's blog. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.", "size": "1536x1024", "n": 1}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.x.ai/v1/images/generations", "method": "POST", "body": {"model": "grok-imagine-image", "prompt": "Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Ship docs faster. Made for Acme's blog. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.", "n": 1, "aspect_ratio": "16:9", "response_format": "b64_json"}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}, {"url": "https://api.x.ai/v1/images/generations", "method": "POST", "body": {"model": "grok-imagine-image", "prompt": "Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional. Subject: Ship docs faster. Made for Acme's blog. Color palette built around the brand colors #112233 and #445566, with neutral tones. Variation 3. No words, letters, numbers, logos or watermarks anywhere in the image.", "n": 1, "aspect_ratio": "2:1", "response_format": "b64_json"}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}], "rows": [], "logs": ["warn: [images] openai image 402: {\"error\":{\"code\":402,\"message\":\"billing hard limit\"}}"], "backoffs": [], "stored": ["dff4fc0677fad560", "d180f1a2b2283a22"]},
  "i2": {"calls": [], "rows": [], "logs": [], "backoffs": [], "stored": ["f883614e6a7dfb07"], "configured": false, "style": "branded"},
  "v1": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": "best tool?", "tools": [{"type": "web_search"}]}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}, {"url": "https://api.perplexity.ai/chat/completions", "method": "POST", "body": {"model": "sonar-pro", "messages": [{"role": "user", "content": "best tool?"}]}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer pp-key"}, {"url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", "method": "POST", "body": {"contents": [{"role": "user", "parts": [{"text": "best tool?"}]}], "tools": [{"google_search": {}}]}, "headerKeys": ["content-type", "x-goog-api-key"], "auth": "gm-key"}, {"url": "https://api.anthropic.com/v1/messages", "method": "POST", "body": {"model": "claude-sonnet-5-5", "max_tokens": 2048, "messages": [{"role": "user", "content": "best tool?"}], "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}]}, "headerKeys": ["anthropic-version", "content-type", "x-api-key"], "auth": "an-key"}, {"url": "https://api.x.ai/v1/responses", "method": "POST", "body": {"model": "grok-4.7", "input": [{"role": "user", "content": "best tool?"}], "tools": [{"type": "web_search"}]}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer xa-key"}], "rows": [], "logs": [], "backoffs": [], "stored": [], "res": {"ChatGPT": {"text": "ans", "cites": ["https://c.example"]}, "Perplexity": {"text": "pp", "cites": ["https://p.example"]}, "Gemini": {"text": "gm", "cites": ["https://g.example/x"]}, "Claude": {"text": "cl", "cites": ["https://a.example"]}, "Grok": {"text": "ans", "cites": ["https://c.example"]}}},
  "v2": {"calls": [{"url": "https://api.openai.com/v1/responses", "method": "POST", "body": {"model": "gpt-6-sol", "input": "q", "tools": [{"type": "web_search"}]}, "headerKeys": ["authorization", "content-type"], "auth": "Bearer oa-key"}], "rows": [], "logs": [], "backoffs": [], "stored": [], "e1": {"name": "EngineUnavailable", "message": "Perplexity is not configured", "unavailable": true}, "e2": {"name": "Error", "message": "HTTP 500: {\"error\":{\"code\":500,\"message\":\"oops\"}}", "unavailable": false}}
};
