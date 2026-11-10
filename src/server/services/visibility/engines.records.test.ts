// AI Visibility spend records (LG-1, LG-5): every engine request, through OpenRouter or the engine's own API, answered
// or not, writes exactly one ai_calls row. fetch is mocked (no provider is called); the db mock captures the rows.
// Modules are booted fresh from process.env per test so OpenRouter cooldown state never leaks between tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ inserted: [] as any[], values: (_row: any): any => Promise.resolve() }));
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: (row: any) => { H.inserted.push(row); return H.values(row); } }) }, schema: { aiCalls: {} } }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));

const KEYS = { OPENAI_API_KEY: 'oa-key-0123456789', ANTHROPIC_API_KEY: 'an-key-0123456789', XAI_API_KEY: 'xa-key-0123456789', PERPLEXITY_API_KEY: 'pp-key-0123456789', GEMINI_API_KEY: 'gm-key-0123456789' };
const OR_KEY = 'sk-or-v1-recordstest0123456789';
const VARS = [...Object.keys(KEYS), 'OPENROUTER_API_KEY', 'OPENROUTER_VIS_MODELS', 'RADAR_DEV_STUBS', 'VIS_CHATGPT_MODEL', 'VIS_PERPLEXITY_MODEL', 'VIS_GEMINI_MODEL', 'VIS_CLAUDE_MODEL', 'VIS_GROK_MODEL'];
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];

async function boot(over: Record<string, string | undefined> = {}) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries({ ...KEYS, ...over })) if (v !== undefined) process.env[k] = v;
  vi.resetModules();
  return import('./engines');
}
const bootOR = (over: Record<string, string | undefined> = {}) => boot({ OPENROUTER_API_KEY: OR_KEY, ...over });

let urls: string[] = [];
function mockFetch(handler: (url: string, body: any) => Response | Promise<Response>) {
  urls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { urls.push(String(url)); return handler(String(url), typeof init.body === 'string' ? JSON.parse(init.body) : null); }));
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const isOR = (u: string) => u.startsWith('https://openrouter.ai/');
const PROMPT = 'Which invoicing tool suits a two-person studio?';
const ANSWER = 'Fieldnote and Docly are both good options.';
const ctx = { stub: { bid: 'biz-1', profile: {}, pages: [], manual: false } };
const caught = (p: Promise<any>) => p.then(() => null, (e: any) => e);

/** Each engine's own API answering with the usage shape that API documents. */
const DIRECT: Record<string, { host: string; body: any }> = {
  ChatGPT: { host: 'api.openai.com', body: { output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: ANSWER, annotations: [{ type: 'url_citation', url: 'https://c.example' }] }] }], usage: { input_tokens: 1000, output_tokens: 500 } } },
  Perplexity: { host: 'api.perplexity.ai', body: { choices: [{ message: { content: ANSWER } }], citations: ['https://p.example'], usage: { prompt_tokens: 40, completion_tokens: 60, cost: { total_cost: 0.0123 } } } },
  Gemini: { host: 'generativelanguage.googleapis.com', body: { candidates: [{ content: { parts: [{ text: ANSWER }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20, thoughtsTokenCount: 30 } } },
  Claude: { host: 'api.anthropic.com', body: { content: [{ type: 'text', text: ANSWER, citations: [{ url: 'https://a.example' }] }], usage: { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 3 } } } },
  Grok: { host: 'api.x.ai', body: { output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: ANSWER }] }], usage: { input_tokens: 1000, output_tokens: 1000 } } },
};
const direct = (u: string) => json(Object.values(DIRECT).find(d => u.includes(d.host))!.body);
const orAnswer = (text: string, usage: any = { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 }) => json({ id: 'gen-1', choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], ...(usage ? { usage } : {}) });
const ROW = { businessId: 'biz-1', task: 'visibility', purpose: 'visibility.collect' };

beforeEach(() => {
  H.inserted.length = 0; H.values = () => Promise.resolve();
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const v of VARS) if (saved[v] === undefined) delete process.env[v]; else process.env[v] = saved[v];
});

describe('each engine through its own API writes one row', () => {
  // Costs are worked out by the real price table: tokens at the published rate, plus $0.01 per web search where the
  // provider publishes that fee (OpenAI, Anthropic). Perplexity reports its own cost; Gemini's alias has no rate.
  it.each([
    ['ChatGPT', { model: 'gpt-6-sol', provider: 'OpenAI', inputTokens: 1000, outputTokens: 500, costUsd: expect.closeTo(0.007 + 0.02, 10) }],
    ['Perplexity', { model: 'sonar-pro', provider: 'Perplexity', inputTokens: 40, outputTokens: 60, costUsd: 0.0123 }],
    ['Gemini', { model: 'gemini-flash-latest', provider: 'Google', inputTokens: 50, outputTokens: 50, costUsd: null }],
    ['Claude', { model: 'claude-sonnet-5-5', provider: 'Anthropic', inputTokens: 2000, outputTokens: 300, costUsd: expect.closeTo(0.007 + 0.03, 10) }],
    ['Grok', { model: 'grok-4.7', provider: 'SpaceX', inputTokens: 1000, outputTokens: 1000, costUsd: expect.closeTo(0.008, 10) }],
  ] as const)('%s', async (engine, want) => {
    const vis = await boot(); mockFetch(direct);
    const a = await vis.askEngine(engine, PROMPT, ctx);
    expect(a.text).toBe(ANSWER);
    expect(urls).toHaveLength(1);
    expect(H.inserted).toEqual([{ ...ROW, ...want, latencyMs: expect.any(Number), ok: true, error: null }]);
  });
  it('the model in the row is the one asked (VIS_*_MODEL), and an unlisted model logs a null cost', async () => {
    const vis = await boot({ VIS_CHATGPT_MODEL: 'gpt-6-quasar' }); mockFetch(direct);
    await vis.askEngine('ChatGPT', PROMPT, ctx);
    expect(H.inserted).toMatchObject([{ model: 'gpt-6-quasar', provider: 'OpenAI', inputTokens: 1000, outputTokens: 500, costUsd: null, ok: true }]);
  });
  it('an answer that reports no usage logs null tokens and a null cost', async () => {
    const vis = await boot(); mockFetch(u => (u.includes('googleapis') ? json({ candidates: [{ content: { parts: [{ text: ANSWER }] } }] }) : json({ content: [{ type: 'text', text: ANSWER }] })));
    await vis.askEngine('Gemini', PROMPT, ctx); await vis.askEngine('Claude', PROMPT, ctx);
    expect(H.inserted).toMatchObject([{ provider: 'Google', inputTokens: null, outputTokens: null, costUsd: null, ok: true }, { provider: 'Anthropic', inputTokens: null, outputTokens: null, costUsd: null, ok: true }]);
  });
});

describe('each engine through OpenRouter writes one row', () => {
  it.each([['ChatGPT', 'openai/gpt-6-sol'], ['Claude', 'anthropic/claude-sonnet-5.5'], ['Grok', 'x-ai/grok-4.7'], ['Gemini', 'google/gemini-4-argon'], ['Perplexity', 'perplexity/sonar-pro']] as const)('%s → %s, with the cost OpenRouter reported', async (engine, model) => {
    const vis = await bootOR(); mockFetch(() => orAnswer(ANSWER));
    await vis.askEngine(engine, PROMPT, ctx);
    expect(urls).toHaveLength(1);
    expect(H.inserted).toEqual([{ ...ROW, model, provider: 'openrouter', latencyMs: expect.any(Number), inputTokens: 11, outputTokens: 7, costUsd: 0.0042, ok: true, error: null }]);
  });
  it('a reported cost of zero is kept, and a missing one is never guessed for a model with no listed rate', async () => {
    const vis = await bootOR();
    mockFetch(() => orAnswer(ANSWER, { prompt_tokens: 11, completion_tokens: 7, cost: 0 }));
    await vis.askEngine('ChatGPT', PROMPT, ctx);
    mockFetch(() => orAnswer(ANSWER, { prompt_tokens: 11, completion_tokens: 7 }));
    await vis.askEngine('Gemini', PROMPT, ctx);
    mockFetch(() => orAnswer(ANSWER, null));
    await vis.askEngine('Perplexity', PROMPT, ctx);
    expect(H.inserted.map(r => [r.model, r.inputTokens, r.outputTokens, r.costUsd])).toEqual([['openai/gpt-6-sol', 11, 7, 0], ['google/gemini-4-argon', 11, 7, null], ['perplexity/sonar-pro', null, null, null]]);
  });
});

describe('failures are rows too', () => {
  it('OpenRouter fails, then the engine\'s own API answers: two requests, two rows', async () => {
    const vis = await bootOR(); mockFetch(u => (isOR(u) ? json({ error: { code: 500, message: 'upstream down' } }, 500) : direct(u)));
    const a = await vis.askEngine('ChatGPT', PROMPT, ctx);
    expect(a.text).toBe(ANSWER);
    expect(urls).toHaveLength(2);
    expect(H.inserted).toEqual([
      { ...ROW, model: 'openai/gpt-6-sol', provider: 'openrouter', latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: null, ok: false, error: expect.stringMatching(/^HTTP 500/) },
      { ...ROW, model: 'gpt-6-sol', provider: 'OpenAI', latencyMs: expect.any(Number), inputTokens: 1000, outputTokens: 500, costUsd: expect.closeTo(0.027, 10), ok: true, error: null },
    ]);
  });
  it('OpenRouter answered with no text: the row keeps the usage it was billed, ok = false, and the direct API is asked', async () => {
    const vis = await bootOR(); mockFetch(u => (isOR(u) ? orAnswer('   ') : direct(u)));
    await vis.askEngine('Claude', PROMPT, ctx);
    expect(H.inserted).toMatchObject([
      { model: 'anthropic/claude-sonnet-5.5', provider: 'openrouter', inputTokens: 11, outputTokens: 7, costUsd: 0.0042, ok: false, error: 'empty response' },
      { model: 'claude-sonnet-5-5', provider: 'Anthropic', ok: true },
    ]);
  });
  it('OpenRouter answered 200 with an error body: one failed row that keeps any usage it reported', async () => {
    const vis = await bootOR({ GEMINI_API_KEY: undefined });
    mockFetch(() => json({ error: { code: 502, message: 'bad gateway' }, usage: { prompt_tokens: 9, completion_tokens: 0, cost: 0.0001 } }));
    const e = await caught(vis.askEngine('Gemini', PROMPT, ctx));
    expect(e).toBeInstanceOf(Error); expect(e).not.toBeInstanceOf(vis.EngineUnavailable);
    expect(H.inserted).toMatchObject([{ model: 'google/gemini-4-argon', provider: 'openrouter', inputTokens: 9, outputTokens: 0, costUsd: 0.0001, ok: false, error: expect.stringContaining('bad gateway') }]);
  });
  it('a direct API that fails writes one failed row with no usage, and the error still reaches the caller', async () => {
    const vis = await boot(); mockFetch(() => json({ error: { message: 'overloaded' } }, 529));
    for (const engine of ['ChatGPT', 'Perplexity', 'Gemini', 'Claude', 'Grok'] as const) expect((await caught(vis.askEngine(engine, PROMPT, ctx))).message).toMatch(/^HTTP 529/);
    expect(H.inserted.map(r => [r.provider, r.ok, r.inputTokens, r.outputTokens, r.costUsd])).toEqual(['OpenAI', 'Perplexity', 'Google', 'Anthropic', 'SpaceX'].map(p => [p, false, null, null, null]));
    expect(H.inserted.every(r => /^HTTP 529/.test(r.error) && r.task === 'visibility' && r.businessId === 'biz-1')).toBe(true);
  });
  it('a direct answer with no text is ok = false with its usage; the caller still gets the answer it got before', async () => {
    const vis = await boot();
    mockFetch(() => json({ content: [{ type: 'server_tool_use', id: 't1' }], usage: { input_tokens: 2000, output_tokens: 40, server_tool_use: { web_search_requests: 1 } } }));
    const a = await vis.askEngine('Claude', PROMPT, ctx);
    expect(a.text).toBe(''); // collectOne turns this into "empty response" and the cell stays not collected
    expect(H.inserted).toMatchObject([{ provider: 'Anthropic', inputTokens: 2000, outputTokens: 40, costUsd: expect.closeTo(0.0044 + 0.01, 10), ok: false, error: 'empty response' }]);
  });
  it('a network failure (no response at all) is one failed row', async () => {
    const vis = await boot(); mockFetch(() => Promise.reject(new TypeError('fetch failed')));
    await caught(vis.askEngine('Grok', PROMPT, ctx));
    expect(H.inserted).toMatchObject([{ provider: 'SpaceX', model: 'grok-4.7', ok: false, error: 'fetch failed', costUsd: null }]);
  });
});

describe('no request, no row', () => {
  it('an engine that is not configured', async () => {
    const vis = await boot({ GEMINI_API_KEY: undefined }); mockFetch(() => json({}));
    expect(await caught(vis.askEngine('Gemini', PROMPT, ctx))).toBeInstanceOf(vis.EngineUnavailable);
    expect(urls).toHaveLength(0); expect(H.inserted).toHaveLength(0);
  });
  it('dev stubs', async () => {
    const vis = await bootOR({ RADAR_DEV_STUBS: '1' }); mockFetch(() => json({}));
    await vis.askEngine('ChatGPT', PROMPT, { stub: { bid: 'biz-1', profile: { business: { name: 'Fieldnote' }, domain: 'fieldnote.test', audience: { competitors: [] } }, pages: [], manual: false } }).catch(() => null);
    expect(urls).toHaveLength(0); expect(H.inserted).toHaveLength(0);
  });
  it('OpenRouter skipped during its account cooldown: only the direct request is recorded', async () => {
    const vis = await bootOR();
    (await import('@/server/ai/adapters/openrouter')).markOpenrouterDown('test');
    mockFetch(direct);
    await vis.askEngine('Grok', PROMPT, ctx);
    expect(urls).toEqual(['https://api.x.ai/v1/responses']);
    expect(H.inserted).toMatchObject([{ provider: 'SpaceX', ok: true }]);
  });
});

describe('recording never reaches the work, and rows hold no content', () => {
  it('an insert that rejects, and one that throws, do not fail or change the answer', async () => {
    const vis = await bootOR();
    H.values = () => Promise.reject(new Error('db down'));
    mockFetch(() => orAnswer(ANSWER));
    expect((await vis.askEngine('ChatGPT', PROMPT, ctx)).text).toBe(ANSWER);
    H.values = () => { throw new Error('db exploded'); };
    mockFetch(u => (isOR(u) ? json({ error: { message: 'down' } }, 500) : direct(u)));
    expect((await vis.askEngine('Perplexity', PROMPT, ctx)).text).toBe(ANSWER);
    await new Promise(r => setTimeout(r, 0)); // a swallowed rejection would surface here as an unhandled rejection
    expect(H.inserted).toHaveLength(3);
  });
  it('no prompt, no answer text and no key in any row, even when a provider echoes the key back', async () => {
    const vis = await bootOR();
    mockFetch(u => (isOR(u) ? json({ error: { message: `bad key ${OR_KEY}` } }, 500) : u.includes('openai.com') ? json({ error: { message: `Incorrect API key provided: ${KEYS.OPENAI_API_KEY}` } }, 500) : direct(u)));
    await caught(vis.askEngine('ChatGPT', PROMPT, ctx));
    await vis.askEngine('Claude', PROMPT, ctx);
    const blob = JSON.stringify(H.inserted);
    expect(H.inserted).toHaveLength(4);
    expect(blob).not.toContain(OR_KEY); expect(blob).not.toContain(KEYS.OPENAI_API_KEY); expect(blob).toContain('[redacted]');
    expect(blob).not.toContain(PROMPT); expect(blob).not.toContain(ANSWER);
    for (const r of H.inserted) expect(Object.keys(r).sort()).toEqual(['businessId', 'costUsd', 'error', 'inputTokens', 'latencyMs', 'model', 'ok', 'outputTokens', 'provider', 'purpose', 'task']);
  });
});
