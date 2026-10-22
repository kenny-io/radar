// OpenRouter primary route: routing order, request shapes, streaming, cooldowns, images, AI Visibility, cost log.
// fetch is mocked throughout (the sandbox can't reach OpenRouter); the DB is mocked to capture ai_calls rows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const { inserted } = vi.hoisted(() => ({ inserted: [] as any[] }));
vi.mock('../db', () => ({
  db: { insert: () => ({ values: (v: any) => { inserted.push(v); return Promise.resolve(); } }) },
  schema: { aiCalls: {}, businesses: {} },
}));

import { env } from '../env';
import { run, routes } from './index';
import { openrouterRun, resetOpenrouterState, isOpenrouterAccountError, isOpenrouterModelMissing, openrouterId, strictCompatible, openrouterTripped, STREAM_IDLE_MS, BREAKER_MS } from './adapters/openrouter';
import { OPENROUTER_IMAGE_TIMEOUT_MS } from '../services/images';
import { generatePhoto, openrouterAspect } from '../services/images';
import { askEngine, EngineUnavailable } from '../services/visibility/engines';

type Call = { url: string; body: any; headers: any };
let calls: Call[] = [];
/** Install a fetch mock; the handler gets (url, parsed body) and returns a Response. */
function mockFetch(handler: (url: string, body: any) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, headers: init.headers || {} });
    return handler(String(url), body);
  }));
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const orText = (text: string, usage: any = { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 }) => json({ id: 'gen-1', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage });
const sseRaw = (chunks: string[]) => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
const sseData = (events: any[]) => events.map(e => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`));
const isOR = (u: string) => u.startsWith('https://openrouter.ai/api/v1/');
const anthropicOk = (text: string) => json({ content: [{ type: 'text', text }], usage: { input_tokens: 3, output_tokens: 2 } });

const saved = { ...env };
beforeEach(() => {
  resetOpenrouterState(); inserted.length = 0;
  Object.assign(env, { openrouterKey: 'or-key', openaiKey: 'oa-key', anthropicKey: 'an-key', xaiKey: 'xa-key', perplexityKey: '', geminiKey: '', openrouterModelMap: '', openrouterImageModel: '', openrouterVisModels: '', devStubs: false, appUrl: 'https://radar.example' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { Object.assign(env, saved); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OpenRouter route order', () => {
  it('tries each model on OpenRouter, then its direct provider, then the next model', () => {
    expect(routes('writing', 'gpt-6-sol')).toEqual([
      { modelId: 'gpt-6-sol', via: 'openrouter' }, { modelId: 'gpt-6-sol', via: 'direct' },
      { modelId: 'claude-sonnet-5.5', via: 'openrouter' }, { modelId: 'claude-sonnet-5.5', via: 'direct' },
      { modelId: 'grok-4.7', via: 'openrouter' }, { modelId: 'grok-4.7', via: 'direct' },
    ]);
  });
  it('keeps a model whose direct key is missing on its OpenRouter route', () => {
    env.openaiKey = '';
    expect(routes('writing', 'gpt-6-sol').slice(0, 2)).toEqual([{ modelId: 'gpt-6-sol', via: 'openrouter' }, { modelId: 'claude-sonnet-5.5', via: 'openrouter' }]);
  });
  it('runs the calls in that order, discarding nothing it shouldn\'t', async () => {
    mockFetch((url) => (url === 'https://api.anthropic.com/v1/messages' ? anthropicOk('from claude') : json({ error: { message: 'upstream down' } }, 500)));
    const resets = vi.fn();
    const out = await run('writing', { purpose: 't.order', prompt: 'hi', onReset: resets }, { retries: 0 });
    expect(calls.map(c => (isOR(c.url) ? `or:${c.body.model}` : c.url))).toEqual([
      'or:openai/gpt-6-sol', 'https://api.openai.com/v1/responses', 'or:anthropic/claude-sonnet-5.5', 'https://api.anthropic.com/v1/messages',
    ]);
    expect(out).toMatchObject({ text: 'from claude', model: 'claude-sonnet-5.5', provider: 'Anthropic' });
    expect(resets).toHaveBeenCalledTimes(4);
  });
  it('gives OpenRouter a single attempt when the same model\'s direct provider is next', async () => {
    mockFetch((url) => (isOR(url) ? json({ error: { message: 'busy' } }, 503) : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
    const out = await run('writing', { purpose: 't.once', prompt: 'hi' }); // default retries (2)
    expect(out.provider).toBe('OpenAI');
    expect(calls.map(c => isOR(c.url))).toEqual([true, false]);
  });
  it('serves from OpenRouter when it answers, with the attribution headers', async () => {
    mockFetch(() => orText('hello from OR'));
    const out = await run('writing', { purpose: 't.ok', prompt: 'hi', system: 'sys', maxTokens: 321 });
    expect(out).toMatchObject({ text: 'hello from OR', provider: 'openrouter', model: 'gpt-6-sol' });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(c.headers).toMatchObject({ authorization: 'Bearer or-key', 'HTTP-Referer': 'https://radar.example', 'X-Title': 'Radar' });
    expect(c.body).toMatchObject({ model: 'openai/gpt-6-sol', max_tokens: 321, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] });
    expect(c.body.temperature).toBeUndefined();
    expect(c.body.stream).toBeUndefined();
  });
});

describe('OpenRouter structured outputs', () => {
  const S = z.object({ title: z.string().max(40), tags: z.array(z.string()).max(3) });
  it('sends response_format json_schema (strict) and validates the result', async () => {
    mockFetch(() => orText(JSON.stringify({ title: 'A title', tags: ['x'] })));
    const out = await run('writing', { purpose: 't.json', prompt: 'p', schema: S, schemaName: 'post idea' });
    expect(out.json).toEqual({ title: 'A title', tags: ['x'] });
    const rf = calls[0].body.response_format;
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema).toMatchObject({ name: 'post_idea', strict: true });
    expect(rf.json_schema.schema.$schema).toBeUndefined();
    expect(rf.json_schema.schema.properties.title.maxLength).toBe(40);
    expect(calls[0].body.provider).toEqual({ require_parameters: true });
  });
  it('gives Claude models the Claude schema subset', async () => {
    mockFetch(() => orText('{"title":"t","tags":[]}'));
    const js: any = z.toJSONSchema(S as any, { target: 'draft-7' } as any);
    const out = await openrouterRun({ apiModel: 'anthropic/claude-opus-5.5', prompt: 'p', jsonSchema: js, schemaName: 'x', maxTokens: 50, timeoutMs: 5000 });
    expect(out.json).toEqual({ title: 't', tags: [] });
    const sch = calls[0].body.response_format.json_schema;
    expect(sch.strict).toBe(true);
    expect(JSON.stringify(sch.schema)).not.toContain('maxLength');
    expect(sch.schema.additionalProperties).toBe(false);
  });
  it('uses strict:false for schemas with optional fields on non-Claude models', () => {
    expect(strictCompatible(z.toJSONSchema(S as any, { target: 'draft-7' } as any))).toBe(true);
    expect(strictCompatible(z.toJSONSchema(z.object({ a: z.string(), b: z.string().optional() }) as any, { target: 'draft-7' } as any))).toBe(false);
  });
  it('retries a rejected schema as plain-JSON instructions on OpenRouter', async () => {
    let n = 0;
    mockFetch(() => (++n === 1 ? json({ error: { code: 400, message: 'Invalid schema for response_format' } }, 400) : orText('{"title":"t","tags":[]}')));
    const out = await run('writing', { purpose: 't.json2', prompt: 'p', schema: S });
    expect(out.provider).toBe('openrouter');
    expect(calls).toHaveLength(2);
    expect(calls[1].body.response_format).toBeUndefined();
    expect(calls[1].body.messages.at(-1).content).toMatch(/Return only a JSON value/);
  });
  it('researches with the openrouter:web_search tool, then structures, merging citations', async () => {
    let n = 0;
    mockFetch(() => (++n === 1
      ? json({ choices: [{ message: { content: 'findings', annotations: [{ type: 'url_citation', url_citation: { url: 'https://src.example/a', title: 'A' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 5, cost: 0.01 } })
      : orText('{"title":"t","tags":[]}', { prompt_tokens: 2, completion_tokens: 2, cost: 0.002 })));
    const out = await run('research', { purpose: 't.research', prompt: 'p', schema: S, webSearch: true });
    expect(calls[0].body.tools).toEqual([{ type: 'openrouter:web_search' }]);
    expect(calls[0].body.response_format).toBeUndefined();
    expect(calls[1].body.tools).toBeUndefined();
    expect(calls[1].body.messages.at(-1).content).toContain('https://src.example/a');
    expect(out.citations).toEqual([{ url: 'https://src.example/a', title: 'A' }]);
    expect(out.model).toBe('claude-opus-5.5');
    expect(inserted.at(-1).costUsd).toBeCloseTo(0.012);
  });
});

describe('OpenRouter streaming', () => {
  const call = (onDelta: (d: string) => void) => openrouterRun({ apiModel: 'openai/gpt-6-sol', prompt: 'p', maxTokens: 10, timeoutMs: 5000, onDelta });
  it('parses SSE deltas, skips comment lines, reads usage', async () => {
    mockFetch(() => sseRaw([': OPENROUTER PROCESSING\n\n', ...sseData([{ choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, cost: 0.001 } }]), 'data: [DONE]\n\n']));
    const deltas: string[] = [];
    const out = await call(d => deltas.push(d));
    expect(calls[0].body.stream).toBe(true);
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(out).toMatchObject({ text: 'Hello', inputTokens: 4, outputTokens: 2, costUsd: 0.001 });
  });
  it('turns an in-stream credit error into an account error', async () => {
    mockFetch(() => sseRaw(sseData([{ choices: [{ delta: { content: 'Par' } }] }, { error: { code: 402, message: 'Insufficient credits' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] }])));
    const err = await call(() => {}).catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(isOpenrouterAccountError(err)).toBe(true);
  });
  it('treats an in-stream provider error as transient', async () => {
    mockFetch(() => sseRaw(sseData([{ error: { code: 'server_error', message: 'Provider disconnected' }, choices: [{ delta: {}, finish_reason: 'error' }] }])));
    const err = await call(() => {}).catch(e => e);
    expect(err.status).toBe(500);
    expect(isOpenrouterAccountError(err)).toBe(false);
  });
  it('discards text streamed by a failed OpenRouter attempt and fails over to the direct provider', async () => {
    mockFetch((url) => (isOR(url)
      ? sseRaw(sseData([{ choices: [{ delta: { content: 'partial ' } }] }, { error: { code: 502, message: 'Provider returned error' }, choices: [{ delta: {}, finish_reason: 'error' }] }]))
      : sseRaw(sseData([{ type: 'response.output_text.delta', delta: 'direct ' }, { type: 'response.output_text.delta', delta: 'text' }, { type: 'response.completed', response: { usage: {} } }]))));
    let shown = '';
    const out = await run('writing', { purpose: 't.stream', prompt: 'p', onDelta: d => { shown += d; }, onReset: () => { shown = ''; } }, { retries: 0 });
    expect(out.provider).toBe('OpenAI');
    expect(shown).toBe('direct text');
    expect(out.text).toBe('direct text');
  });
});

describe('OpenRouter cooldowns', () => {
  it('pauses OpenRouter for 10 minutes on an account error', async () => {
    mockFetch((url) => (isOR(url) ? json({ error: { code: 402, message: 'Insufficient credits. Add more using https://openrouter.ai/credits' } }, 402) : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
    const a = await run('writing', { purpose: 't.acct', prompt: 'p' });
    expect(a.provider).toBe('OpenAI');
    expect(calls.filter(c => isOR(c.url))).toHaveLength(1);
    calls.length = 0;
    const b = await run('writing', { purpose: 't.acct2', prompt: 'p' });
    expect(b.provider).toBe('OpenAI');
    expect(calls.some(c => isOR(c.url))).toBe(false);
    expect(routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
    // Images skip it too (one account).
    expect(isOpenrouterAccountError({ status: 403, message: 'HTTP 403: Your chosen model requires moderation and your input was flagged' })).toBe(false);
  });
  it('skips OpenRouter only for a model it does not have', async () => {
    mockFetch((url, body) => (isOR(url) && body.model === 'openai/gpt-6-sol' ? json({ error: { code: 400, message: 'openai/gpt-6-sol is not a valid model ID' } }, 400) : isOR(url) ? orText('or') : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] })));
    const a = await run('writing', { purpose: 't.missing', prompt: 'p' });
    expect(a.provider).toBe('OpenAI');
    expect(calls.map(c => c.url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://api.openai.com/v1/responses']);
    const r = routes('writing', 'gpt-6-sol');
    expect(r[0]).toEqual({ modelId: 'gpt-6-sol', via: 'direct' });
    expect(r).toContainEqual({ modelId: 'claude-sonnet-5.5', via: 'openrouter' });
    expect(isOpenrouterModelMissing({ status: 404, message: 'HTTP 404: No endpoints found for openai/x.' })).toBe(true);
    expect(isOpenrouterModelMissing({ status: 404, message: 'HTTP 404: No endpoints found that support the requested parameters' })).toBe(false);
  });
  it('honours OPENROUTER_MODEL_MAP overrides and "" to disable a model', () => {
    env.openrouterModelMap = '{"gpt-6-sol":"openai/gpt-6-sol-pro","grok-4.7":""}';
    expect(openrouterId('gpt-6-sol')).toBe('openai/gpt-6-sol-pro');
    expect(openrouterId('grok-4.7')).toBeNull();
    expect(openrouterId('claude-opus-5.5')).toBe('anthropic/claude-opus-5.5');
    expect(routes('writing', 'grok-4.7')[0]).toEqual({ modelId: 'grok-4.7', via: 'direct' });
  });
});

describe('without OPENROUTER_API_KEY', () => {
  it('uses the direct providers exactly as before', async () => {
    env.openrouterKey = '';
    expect(routes('writing', 'gpt-6-sol')).toEqual([{ modelId: 'gpt-6-sol', via: 'direct' }, { modelId: 'claude-sonnet-5.5', via: 'direct' }, { modelId: 'grok-4.7', via: 'direct' }]);
    mockFetch(() => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }], usage: { input_tokens: 1000, output_tokens: 1000 } }));
    const out = await run('writing', { purpose: 't.nokey', prompt: 'p' });
    expect(out).toMatchObject({ provider: 'OpenAI', model: 'gpt-6-sol', text: 'direct' });
    expect(calls.map(c => c.url)).toEqual(['https://api.openai.com/v1/responses']);
    expect(calls[0].body).toEqual({ model: 'gpt-6-sol', input: [{ role: 'user', content: 'p' }], max_output_tokens: 4000 });
    expect(inserted.at(-1)).toMatchObject({ provider: 'OpenAI', model: 'gpt-6-sol', ok: true, costUsd: (1000 * 2 + 1000 * 8) / 1e6 });
  });
});

describe('ai_calls log', () => {
  it('records the route that served the call, with OpenRouter cost', async () => {
    let n = 0;
    mockFetch(() => (++n === 1 ? json({ error: { message: 'busy' } }, 500) : orText('ok', { prompt_tokens: 10, completion_tokens: 20, cost: 0.0123 })));
    env.openaiKey = ''; // no direct route → OpenRouter keeps its retries
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const p = run('writing', { purpose: 't.log', prompt: 'p' }, { retries: 1 });
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    expect(inserted.map(r => [r.provider, r.model, r.ok])).toEqual([['openrouter', 'gpt-6-sol', false], ['openrouter', 'gpt-6-sol', true]]);
    expect(inserted[1]).toMatchObject({ inputTokens: 10, outputTokens: 20, costUsd: 0.0123, purpose: 't.log' });
  });
});

describe('images via OpenRouter', () => {
  const req = { bid: 'b', style: 'illustration', brand: { primary: '#112233', secondary: '#445566' }, headline: 'Ship docs', name: 'Acme', seed: 1, w: 1200, h: 630 };
  const pngB64 = () => { const c = createCanvas(64, 48); const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 64, 48); return c.toBuffer('image/png').toString('base64'); };
  it('picks the nearest supported aspect ratio', () => {
    expect(openrouterAspect(1200, 630)).toBe('16:9');
    expect(openrouterAspect(1080, 1080)).toBe('1:1');
    expect(openrouterAspect(1080, 1350)).toBe('3:4');
    expect(openrouterAspect(1080, 1920)).toBe('9:16');
  });
  it('asks OpenRouter first, decodes base64 and cover-crops to the exact size', async () => {
    const b64 = pngB64();
    mockFetch(() => json({ created: 1, data: [{ b64_json: b64, media_type: 'image/png' }] }));
    const png = await generatePhoto(req);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/images');
    expect(calls[0].body).toMatchObject({ model: 'google/gemini-nano-banana-2.1', aspect_ratio: '16:9', n: 1 });
    expect(calls[0].body.prompt).toMatch(/No words, letters/);
    expect(calls[0].body.prompt).toContain('#112233');
    const img = await loadImage(png);
    expect([img.width, img.height]).toEqual([1200, 630]);
  });
  it('falls back OpenRouter → OpenAI → xAI', async () => {
    const b64 = pngB64();
    mockFetch((url) => (url.includes('x.ai') ? json({ data: [{ b64_json: b64 }] }) : json({ error: { message: 'boom' } }, 500)));
    env.openrouterImageModel = 'openai/gpt-image-1';
    await generatePhoto(req);
    expect(calls.map(c => c.url)).toEqual(['https://openrouter.ai/api/v1/images', 'https://api.openai.com/v1/images/generations', 'https://api.x.ai/v1/images/generations']);
    expect(calls[0].body.model).toBe('openai/gpt-image-1');
  });
  it('skips OpenRouter images after an account error', async () => {
    const b64 = pngB64();
    mockFetch((url) => (isOR(url) ? json({ error: { code: 402, message: 'Insufficient credits' } }, 402) : json({ data: [{ b64_json: b64 }] })));
    await generatePhoto(req);
    calls.length = 0;
    await generatePhoto(req);
    expect(calls.map(c => c.url)).toEqual(['https://api.openai.com/v1/images/generations']);
    expect(routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
  });
});

describe('AI Visibility via OpenRouter', () => {
  const ctx = { stub: { bid: 'b', profile: {}, pages: [], manual: false } };
  it('asks the engine through OpenRouter with web search and reads url_citation annotations', async () => {
    mockFetch(() => json({ choices: [{ message: { content: 'Try Acme and Foo.', annotations: [{ type: 'url_citation', url_citation: { url: 'https://acme.example/', title: 'Acme' } }, { type: 'url_citation', url_citation: { url: 'https://foo.example/x' } }] } }] }));
    const a = await askEngine('ChatGPT', 'best docs tool?', ctx);
    expect(a.text).toBe('Try Acme and Foo.');
    expect(a.cites).toEqual(['https://acme.example/', 'https://foo.example/x']);
    expect(calls[0].body).toEqual({ model: 'openai/gpt-6-sol', messages: [{ role: 'user', content: 'best docs tool?' }], tools: [{ type: 'openrouter:web_search' }] });
  });
  it('uses each engine\'s model family; Perplexity searches on its own', async () => {
    mockFetch(() => json({ choices: [{ message: { content: 'answer' } }], citations: ['https://p.example/1'] }));
    const p = await askEngine('Perplexity', 'q', ctx);
    expect(p.cites).toEqual(['https://p.example/1']);
    expect(calls[0].body.model).toBe('perplexity/sonar-pro');
    expect(calls[0].body.tools).toBeUndefined();
    for (const [engine, model] of [['Claude', 'anthropic/claude-sonnet-5.5'], ['Grok', 'x-ai/grok-4.7'], ['Gemini', 'google/gemini-4-argon']] as const) {
      await askEngine(engine, 'q', ctx);
      expect(calls.at(-1)!.body.model).toBe(model);
    }
    env.openrouterVisModels = '{"gemini":"google/gemini-other"}';
    await askEngine('Gemini', 'q', ctx);
    expect(calls.at(-1)!.body.model).toBe('google/gemini-other');
  });
  it('falls back to the official API on any OpenRouter failure', async () => {
    mockFetch((url) => (isOR(url) ? json({ choices: [{ message: { content: '' } }] }) : json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct answer', annotations: [{ type: 'url_citation', url: 'https://d.example' }] }] }] })));
    const a = await askEngine('ChatGPT', 'q', ctx);
    expect(a).toMatchObject({ text: 'direct answer', cites: ['https://d.example'] });
    expect(calls.map(c => c.url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://api.openai.com/v1/responses']);
  });
  it('keeps "not configured" semantics', async () => {
    // OpenRouter tried and failed, no direct key: a real failure (cell stays "not collected" with the error).
    mockFetch(() => json({ error: { message: 'boom' } }, 500));
    const e1 = await askEngine('Perplexity', 'q', ctx).catch(e => e);
    expect(e1).not.toBeInstanceOf(EngineUnavailable);
    expect(String(e1.message)).toContain('HTTP 500');
    // No OpenRouter key and no direct key: not configured, no request made.
    env.openrouterKey = '';
    mockFetch(() => json({}));
    const e2 = await askEngine('Perplexity', 'q', ctx).catch(e => e);
    expect(e2).toBeInstanceOf(EngineUnavailable);
    expect(calls).toHaveLength(0);
    // Engine disabled for OpenRouter and no direct key: not configured either.
    env.openrouterKey = 'or-key'; env.openrouterVisModels = '{"Perplexity":""}';
    const e3 = await askEngine('Perplexity', 'q', ctx).catch(e => e);
    expect(e3).toBeInstanceOf(EngineUnavailable);
    expect(calls).toHaveLength(0);
  });
});

/** A fetch body that sends `parts` at the given fake-timer offsets and errors when the request is aborted. */
function timedStream(signal: AbortSignal | undefined, parts: [number, string][], close = true) {
  return new Response(new ReadableStream({ start(c) {
    let at = 0; const timers: any[] = [];
    for (const [ms, text] of parts) { at = ms; timers.push(setTimeout(() => c.enqueue(new TextEncoder().encode(text)), ms)); }
    if (close) timers.push(setTimeout(() => c.close(), at + 1));
    signal?.addEventListener('abort', () => { timers.forEach(clearTimeout); c.error(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })); });
  } }), { status: 200 });
}
function mockFetchInit(handler: (url: string, body: any, init: any) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { const body = init.body ? JSON.parse(init.body) : null; calls.push({ url: String(url), body, headers: init.headers || {} }); return handler(String(url), body, init); }));
}
const hang = (init: any) => new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
const oaOk = () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct' }] }] });

describe('OpenRouter timeouts', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('drops a stream that sends no bytes for 45 s and fails over to the direct provider', async () => {
    vi.useFakeTimers();
    mockFetchInit((url, _b, init) => (isOR(url) ? timedStream(init.signal, [[1000, ': OPENROUTER PROCESSING\n\n']], false)
      : sseRaw(sseData([{ type: 'response.output_text.delta', delta: 'direct' }, { type: 'response.completed', response: { usage: {} } }]))));
    let shown = '';
    const p = run('writing', { purpose: 't.idle', prompt: 'p', onDelta: d => { shown += d; }, onReset: () => { shown = ''; } });
    await vi.advanceTimersByTimeAsync(1000 + STREAM_IDLE_MS + 10);
    const out = await p;
    expect(out.provider).toBe('OpenAI');
    expect(shown).toBe('direct');
    expect(inserted[0]).toMatchObject({ provider: 'openrouter', ok: false, error: 'OpenRouter stream idle for 45s' });
  });
  it('keeps a slow stream alive while keep-alive comments arrive', async () => {
    vi.useFakeTimers();
    const ka = ': OPENROUTER PROCESSING\n\n';
    mockFetchInit((url, _b, init) => timedStream(init.signal, [[30_000, ka], [60_000, ka], [90_000, ka], [120_000, `data: ${JSON.stringify({ choices: [{ delta: { content: 'slow but fine' } }] })}\n\n`], [120_001, 'data: [DONE]\n\n']]));
    const p = run('writing', { purpose: 't.slow', prompt: 'p', onDelta: () => {} });
    await vi.advanceTimersByTimeAsync(121_000);
    expect(await p).toMatchObject({ provider: 'openrouter', text: 'slow but fine' });
  });
  it('drops a stream whose response headers never arrive within 45 s', async () => {
    vi.useFakeTimers();
    mockFetchInit((_u, _b, init) => hang(init));
    const p = openrouterRun({ apiModel: 'openai/gpt-6-sol', prompt: 'p', maxTokens: 10, timeoutMs: 600_000, onDelta: () => {} }).catch(e => e);
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS + 10);
    const e = await p;
    expect(e.message).toMatch(/idle for 45s/);
    expect(e.timeout).toBe(true);
  });
  it('gives the OpenRouter image call 60 s, then tries OpenAI', async () => {
    vi.useFakeTimers();
    const c = createCanvas(32, 32); const b64 = c.toBuffer('image/png').toString('base64');
    mockFetchInit((url, _b, init) => (isOR(url) ? hang(init) : json({ data: [{ b64_json: b64 }] })));
    const p = generatePhoto({ bid: 'b', style: 'illustration', brand: { primary: '#000', secondary: '#fff' }, headline: 'h', name: 'n', seed: 1, w: 100, h: 100 });
    await vi.advanceTimersByTimeAsync(OPENROUTER_IMAGE_TIMEOUT_MS + 10);
    expect(await p).toBeInstanceOf(Buffer);
    expect(OPENROUTER_IMAGE_TIMEOUT_MS).toBe(60_000);
    expect(calls.map(x => x.url)).toEqual(['https://openrouter.ai/api/v1/images', 'https://api.openai.com/v1/images/generations']);
  });
});

describe('OpenRouter circuit breaker', () => {
  it('opens after 3 consecutive transient failures and skips OpenRouter for 2 minutes', async () => {
    mockFetch((url) => (isOR(url) ? json({ error: { message: 'busy' } }, 503) : oaOk()));
    for (let i = 0; i < 3; i++) expect((await run('writing', { purpose: 't.cb', prompt: 'p' })).provider).toBe('OpenAI');
    expect(calls.filter(c => isOR(c.url))).toHaveLength(3);
    expect(openrouterTripped()).toBe(true);
    calls.length = 0;
    await run('writing', { purpose: 't.cb4', prompt: 'p' });
    expect(calls.map(c => c.url)).toEqual(['https://api.openai.com/v1/responses']);
    expect(routes('writing', 'gpt-6-sol').every(r => r.via === 'direct')).toBe(true);
    // Not the 10-minute account cooldown: back after 2 minutes.
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + BREAKER_MS + 1);
    expect(routes('writing', 'gpt-6-sol')[0]).toEqual({ modelId: 'gpt-6-sol', via: 'openrouter' });
  });
  it('trips within a single call (three models) and skips the rest of that call', async () => {
    mockFetch((url) => (isOR(url) ? json({ error: { message: 'down' } }, 500) : json({ error: { message: 'down' } }, 500)));
    await run('writing', { purpose: 't.cb1', prompt: 'p' }, { retries: 0 }).catch(() => {});
    expect(calls.filter(c => isOR(c.url))).toHaveLength(3);
    expect(openrouterTripped()).toBe(true);
  });
  it('counts timeouts and network errors; any OpenRouter answer resets the count', async () => {
    let mode = 'net';
    mockFetchInit((url, _b, init) => (!isOR(url) ? oaOk() : mode === 'net' ? Promise.reject(new TypeError('fetch failed')) : mode === 'hang' ? hang(init) : orText('ok')));
    await run('writing', { purpose: 'a', prompt: 'p' });
    mode = 'hang'; await run('writing', { purpose: 'b', prompt: 'p', timeoutMs: 20 });
    expect(openrouterTripped()).toBe(false);
    mode = 'ok'; expect((await run('writing', { purpose: 'c', prompt: 'p' })).provider).toBe('openrouter');
    mode = 'net'; await run('writing', { purpose: 'd', prompt: 'p' }); await run('writing', { purpose: 'e', prompt: 'p' });
    expect(openrouterTripped()).toBe(false); // 2 in a row after the reset
    await run('writing', { purpose: 'f', prompt: 'p' });
    expect(openrouterTripped()).toBe(true);
  });
  it('does not count request-level errors (400/429/validation)', async () => {
    mockFetch((url) => (isOR(url) ? json({ error: { message: 'Rate limit exceeded' } }, 429) : oaOk()));
    for (let i = 0; i < 4; i++) await run('writing', { purpose: 't.429', prompt: 'p' });
    expect(openrouterTripped()).toBe(false);
  });
  it('still uses OpenRouter while open when there is no other route (OpenRouter-only setups)', async () => {
    mockFetch(() => json({ error: { message: 'busy' } }, 503));
    for (let i = 0; i < 3; i++) await run('writing', { purpose: 't.trip', prompt: 'p' }, { retries: 0 }).catch(() => {});
    expect(openrouterTripped()).toBe(true);
    env.openaiKey = ''; env.anthropicKey = ''; env.xaiKey = '';
    expect(routes('writing', 'gpt-6-sol').map(r => r.via)).toEqual(['openrouter', 'openrouter', 'openrouter']);
  });
  it('applies to AI Visibility and images too, only where an official API exists', async () => {
    mockFetch(() => json({ error: { message: 'busy' } }, 503));
    for (let i = 0; i < 3; i++) await run('writing', { purpose: 't.trip', prompt: 'p' }, { retries: 0 }).catch(() => {});
    expect(openrouterTripped()).toBe(true);
    const c = createCanvas(16, 16); const b64 = c.toBuffer('image/png').toString('base64');
    mockFetch((url) => (url.includes('/images') ? json({ data: [{ b64_json: b64 }] }) : url.includes('openai.com') ? oaOk() : json({ choices: [{ message: { content: 'pp' } }] })));
    await askEngine('ChatGPT', 'q', { stub: { bid: 'b', profile: {}, pages: [], manual: false } });
    expect(calls.map(x => x.url)).toEqual(['https://api.openai.com/v1/responses']);
    calls.length = 0;
    await askEngine('Perplexity', 'q', { stub: { bid: 'b', profile: {}, pages: [], manual: false } }); // no PERPLEXITY_API_KEY
    expect(calls.map(x => x.url)).toEqual(['https://openrouter.ai/api/v1/chat/completions']);
    calls.length = 0;
    await generatePhoto({ bid: 'b', style: 'illustration', brand: { primary: '#000', secondary: '#fff' }, headline: 'h', name: 'n', seed: 1, w: 50, h: 50 });
    expect(calls.map(x => x.url)).toEqual(['https://api.openai.com/v1/images/generations']);
  });
});

describe('OpenRouter 403s', () => {
  it('a 403 that is about one model skips OpenRouter for that model only', async () => {
    mockFetch((url, body) => (isOR(url) && body.model === 'openai/gpt-6-sol' ? json({ error: { code: 403, message: 'This model is not available in your region' } }, 403) : isOR(url) ? orText('or') : oaOk()));
    expect((await run('writing', { purpose: 't.403', prompt: 'p' })).provider).toBe('OpenAI');
    const r = routes('writing', 'gpt-6-sol');
    expect(r[0]).toEqual({ modelId: 'gpt-6-sol', via: 'direct' });
    expect(r).toContainEqual({ modelId: 'claude-sonnet-5.5', via: 'openrouter' });
  });
  it('classifies 403s: key/credit wording = account; moderation = this request only; other = model', () => {
    const e = (m: string) => ({ status: 403, message: `HTTP 403: ${m}` });
    expect(isOpenrouterAccountError(e('Key limit exceeded (total limit)'))).toBe(true);
    expect(isOpenrouterAccountError(e('Insufficient credits'))).toBe(true);
    expect(isOpenrouterAccountError(e('Your input was flagged by moderation'))).toBe(false);
    expect(isOpenrouterModelMissing(e('Your input was flagged by moderation'))).toBe(false);
    expect(isOpenrouterAccountError(e('This model is not available in your region'))).toBe(false);
    expect(isOpenrouterModelMissing(e('This model is not available in your region'))).toBe(true);
  });
});
