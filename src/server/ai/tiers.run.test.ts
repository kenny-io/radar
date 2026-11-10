// Model tiers through the real ai.run: the request each route receives, the model plan taken, the ai_calls row written
// and the failover on a refusal, a retention 400, a rejected effort field or a timeout. fetch and the database are
// replaced; every test boots fresh modules from process.env so cooldowns never leak between tests.
// Tiers are ON here (RADAR_AI_TIERS unset) unless a test says otherwise. The routing with tiers off is pinned by the
// golden snapshot in openrouter.qa.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const H = vi.hoisted(() => ({ inserted: [] as any[], aiChoice: {} as Record<string, any> }));
vi.mock('../db', () => ({
  db: {
    insert: () => ({ values: (v: any) => { H.inserted.push(v); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ai: H.aiChoice }] }) }) }),
  },
  schema: { aiCalls: {}, businesses: { ai: 'ai', id: 'id' } },
}));
vi.mock('../observability/failures', () => ({ reportFailure: vi.fn(async () => {}) }));

/* ── harness ── */
const VARS = ['APP_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENROUTER_MODEL_MAP', 'AI_MODEL_MAP', 'RADAR_DEV_STUBS',
  'RADAR_AI_TIERS', 'RADAR_AI_UTILITY_MODEL', 'RADAR_AI_WRITING_MODEL', 'RADAR_AI_RESEARCH_MODEL', 'RADAR_AI_PREMIUM_MODEL', 'RADAR_AI_PREMIUM_FALLBACK', 'RADAR_AI_PREMIUM_EFFORT', 'RADAR_AI_EFFORT'];
const KEYS = { OPENAI_API_KEY: 'oa-key', ANTHROPIC_API_KEY: 'an-key', XAI_API_KEY: 'xa-key' };
const savedEnv: Record<string, string | undefined> = {};
for (const v of VARS) savedEnv[v] = process.env[v];
type Env = Record<string, string | undefined>;
/** Fresh modules with the three direct keys and no OpenRouter key; `over` adds, replaces or (undefined) removes variables. */
async function boot(over: Env = {}) {
  for (const v of VARS) delete process.env[v];
  for (const [k, v] of Object.entries({ ...KEYS, ...over })) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  vi.resetModules();
  return import('./index');
}
const bootOR = (over: Env = {}) => boot({ OPENROUTER_API_KEY: 'or-key', ...over });

type Call = { url: string; body: any };
let calls: Call[] = [];
let warns: string[] = [];
function mockFetch(handler: (url: string, body: any, init: any) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    return handler(String(url), body, init);
  }));
}
/** A request that never answers: it ends only when the caller's own timer aborts it. */
const hang = (init: any) => new Promise<Response>((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
/** Make chosen timers short, e.g. { 45000: 40 } turns OpenRouter's 45 s idle cutoff into 40 ms. Every other timer is untouched. */
function shrinkTimers(map: Record<number, number>) {
  const real = globalThis.setTimeout;
  vi.stubGlobal('setTimeout', ((fn: any, ms?: number, ...a: any[]) => real(fn, ms != null && map[ms] != null ? map[ms] : ms, ...a)) as any);
}
beforeEach(() => {
  H.inserted.length = 0; H.aiChoice = {}; calls = []; warns = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: any[]) => { warns.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const v of VARS) if (savedEnv[v] === undefined) delete process.env[v]; else process.env[v] = savedEnv[v];
});

const OR = 'https://openrouter.ai/api/v1/chat/completions', AN = 'https://api.anthropic.com/v1/messages', OA = 'https://api.openai.com/v1/responses', XA = 'https://api.x.ai/v1/responses';
/** `or:` / `an:` / `oa:` / `xa:` + the model id the request asked for. */
const tag = (c: Call) => `${c.url === OR ? 'or' : c.url === AN ? 'an' : c.url === OA ? 'oa' : c.url === XA ? 'xa' : c.url}:${c.body?.model}`;
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, message: string) => json({ error: { code: status, message } }, status);
const anErr = (status: number, type: string, message: string) => json({ type: 'error', error: { type, message } }, status);
const anText = (text: string, usage: any = { input_tokens: 30, output_tokens: 20 }) => json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage });
const oaText = (text: string, usage: any = { input_tokens: 100, output_tokens: 50 }) => json({ output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }], usage });
const orText = (text: string, usage: any = { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 }, finish = 'stop') => json({ id: 'gen-1', choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }], usage });
const sse = (events: any[]) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
/** Any provider answers with this text, in its own response shape. */
const anyText = (text: string) => (url: string) => (url === OR ? orText(text) : url === AN ? anText(text) : oaText(text));
const caught = (p: Promise<any>) => p.then(() => null, (e: any) => e);

const Intent = z.object({ intents: z.array(z.string()).max(5) });
const INTENT = '{"intents":["buy"]}';
const Post = z.object({ title: z.string().max(60), tags: z.array(z.string()).max(3) });
const POST = '{"title":"T","tags":[]}';
const intent = (over: any = {}) => ({ purpose: 'keywords.intent', prompt: 'classify these', schema: Intent, schemaName: 'intents', maxTokens: 500, ...over });
const draft = (over: any = {}) => ({ purpose: 'article.draft', system: 'sys', prompt: 'write the article', maxTokens: 5000, timeoutMs: 240_000, ...over });

/* ════════════════════════════ utility ════════════════════════════ */

describe('utility tier', () => {
  it('OpenRouter: the small model at low effort with a 2,048-token floor, whatever the business chose', async () => {
    const ai = await bootOR(); H.aiChoice = { writing: 'grok-4.7', research: 'gpt-6-astra' };
    mockFetch(() => orText(INTENT));
    const r = await ai.run('writing', intent(), { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-haiku-5.5']);
    expect(calls[0].body).toMatchObject({ reasoning: { effort: 'low' }, max_tokens: 2048, response_format: { type: 'json_schema' }, provider: { require_parameters: true, data_collection: 'deny' } });
    expect(r).toMatchObject({ model: 'claude-haiku-5.5', provider: 'openrouter', json: { intents: ['buy'] } });
    expect(H.inserted).toMatchObject([{ businessId: 'biz', task: 'utility', purpose: 'keywords.intent', model: 'claude-haiku-5.5', provider: 'openrouter', ok: true, costUsd: 0.0042 }]);
  });
  it('a research-kind utility call (brief.rank) takes the same plan and keeps a caller budget above the floor', async () => {
    const ai = await bootOR(); H.aiChoice = { research: 'gpt-6-astra' };
    mockFetch(() => orText(INTENT));
    await ai.run('research', intent({ purpose: 'brief.rank', maxTokens: 4000 }), { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-haiku-5.5']);
    expect(calls[0].body).toMatchObject({ reasoning: { effort: 'low' }, max_tokens: 4000 });
    expect(H.inserted[0]).toMatchObject({ task: 'utility', purpose: 'brief.rank' });
  });
  it('direct Anthropic: effort sits beside the schema in one output_config; no thinking, temperature or tool_choice', async () => {
    const ai = await boot();
    mockFetch(() => anText(INTENT));
    await ai.run('writing', intent({ temperature: 0.3 }));
    expect(calls.map(tag)).toEqual(['an:claude-haiku-5-5']);
    expect(calls[0].body.output_config).toEqual({ format: { type: 'json_schema', schema: expect.objectContaining({ type: 'object' }) }, effort: 'low' });
    expect(calls[0].body.max_tokens).toBe(2048);
    for (const k of ['thinking', 'temperature', 'tool_choice', 'reasoning']) expect(calls[0].body).not.toHaveProperty(k);
    expect(H.inserted).toMatchObject([{ task: 'utility', model: 'claude-haiku-5.5', provider: 'Anthropic', inputTokens: 30, outputTokens: 20, costUsd: expect.closeTo((30 * 0.1 + 20 * 0.5) / 1e6, 12) }]);
  });
  it('Haiku failing moves to GPT-6 Luna, then Grok 4.7, each at low effort; every attempt is a utility row', async () => {
    const ai = await boot();
    mockFetch(url => (url === XA ? oaText(INTENT) : err(500, 'down')));
    const r = await ai.run('writing', intent(), { retries: 0 });
    expect(calls.map(tag)).toEqual(['an:claude-haiku-5-5', 'oa:gpt-6-luna', 'xa:grok-4.7']);
    expect(calls[1].body).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 2048 });
    expect(calls[2].body).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 2048 });
    expect(r.model).toBe('grok-4.7');
    expect(H.inserted.map(x => [x.task, x.model, x.ok])).toEqual([['utility', 'claude-haiku-5.5', false], ['utility', 'gpt-6-luna', false], ['utility', 'grok-4.7', true]]);
    expect(warns.some(w => w.includes('keywords.intent: used grok-4.7 (fallback from claude-haiku-5.5)'))).toBe(true);
  });
  it('RADAR_AI_UTILITY_MODEL moves utility calls to another catalogue model', async () => {
    const ai = await boot({ RADAR_AI_UTILITY_MODEL: 'gpt-6-luna' });
    mockFetch(() => oaText(INTENT));
    await ai.run('writing', intent());
    expect(calls.map(tag)).toEqual(['oa:gpt-6-luna']);
    expect(calls[0].body.reasoning).toEqual({ effort: 'low' });
  });
  it('dev stubs: the stub is still picked by purpose and saved writing instructions still reach it; only the logged model and task differ', async () => {
    const ai = await boot({ RADAR_DEV_STUBS: '1' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    H.aiChoice = { writing: 'grok-4.7', instructions: { all: 'Use British spelling.' } };
    mockFetch(() => err(500, 'no request is expected'));
    const r = await ai.run('writing', { purpose: 'article.meta', system: 'SYS', prompt: 'p', schema: Post, maxTokens: 500, instructions: { surface: 'article' } }, { businessId: 'biz' });
    expect(calls).toEqual([]);
    expect(r.json).toEqual({ title: 'Sample title', tags: ['Sample tags', 'Sample tags'] });
    expect(info.mock.calls.map(c => String(c[0])).join('\n')).toMatch(/article\.meta received workspace writing instructions[\s\S]*Use British spelling\./);
    expect(H.inserted).toMatchObject([{ task: 'utility', purpose: 'article.meta', model: 'claude-haiku-5.5', ok: true, costUsd: null }]);
  });
});

/* ════════════════════════════ effort: every request, and a rejection never fails the task ════════════════════════════ */

describe('reasoning effort', () => {
  it.each([
    ['OpenRouter', { OPENROUTER_API_KEY: 'or-key' }, (b: any) => b.reasoning],
    ['direct Anthropic', {}, (b: any) => b.output_config?.effort && { effort: b.output_config.effort }],
    ['direct OpenAI', { RADAR_AI_PREMIUM_MODEL: 'gpt-6-astra' }, (b: any) => b.reasoning],
  ] as const)('%s: both passes of a web-search-plus-schema call carry it', async (_route, env, effortOf) => {
    const ai = await boot(env);
    let n = 0;
    mockFetch(url => (++n === 1 ? anyText('findings https://s.example/1')(url) : anyText(POST)(url)));
    await ai.run('research', { purpose: 'calendar.topics', prompt: 'find topics', schema: Post, webSearch: true, maxTokens: 8000 });
    expect(calls).toHaveLength(2);
    expect(calls.map(c => effortOf(c.body))).toEqual([{ effort: 'medium' }, { effort: 'medium' }]);
  });

  it.each([
    ['OpenRouter, 400', { OPENROUTER_API_KEY: 'or-key' }, () => err(400, 'reasoning.effort is not supported by this model'), 'or:anthropic/claude-haiku-5.5', (b: any) => !!b.reasoning, (b: any) => !!b.response_format],
    ['OpenRouter, 404 no endpoint supports the parameters', { OPENROUTER_API_KEY: 'or-key' }, () => err(404, 'No endpoints found that support the requested parameters'), 'or:anthropic/claude-haiku-5.5', (b: any) => !!b.reasoning, (b: any) => !!b.response_format],
    ['direct Anthropic', {}, () => anErr(400, 'invalid_request_error', 'output_config.effort: Extra inputs are not permitted'), 'an:claude-haiku-5-5', (b: any) => !!b.output_config?.effort, (b: any) => !!b.output_config?.format],
    ['direct OpenAI', { RADAR_AI_UTILITY_MODEL: 'gpt-6-luna' }, () => err(400, "Unsupported parameter: 'reasoning.effort' is not supported with this model."), 'oa:gpt-6-luna', (b: any) => !!b.reasoning, (b: any) => !!b.text?.format],
  ] as const)('%s rejects the field: one resend without it, the schema kept, the call succeeds, and the next call skips the field', async (_l, env, rejection, model, hasEffort, hasSchema) => {
    const ai = await boot(env);
    mockFetch((url, body) => (hasEffort(body) ? rejection() : anyText(INTENT)(url)));
    const r = await ai.run('writing', intent());
    expect(r.json).toEqual({ intents: ['buy'] });
    expect(calls.map(tag)).toEqual([model, model]);
    expect(calls.map(c => hasEffort(c.body))).toEqual([true, false]);
    expect(calls.map(c => hasSchema(c.body))).toEqual([true, true]);
    const { reasoning: _r, output_config: _o, ...first } = calls[0].body; const { reasoning: _r2, output_config: _o2, ...second } = calls[1].body;
    expect(second).toEqual(first);
    // The task never saw the rejection: one successful row, no failed attempt.
    expect(H.inserted.map(x => x.ok)).toEqual([true]);
    expect(warns.filter(w => w.includes('rejected the effort setting'))).toHaveLength(1);
    // Inside 10 minutes the field is not sent at all; after that it is tried again.
    await ai.run('writing', intent());
    expect(calls).toHaveLength(3);
    expect(hasEffort(calls[2].body)).toBe(false);
    const real = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => real + 11 * 60_000);
    await ai.run('writing', intent());
    expect(hasEffort(calls[3].body)).toBe(true);
  });

  it('a 400 about the schema still takes the plain-JSON path, and that request keeps the effort', async () => {
    const ai = await boot();
    mockFetch((_url, body) => (body.output_config?.format ? anErr(400, 'invalid_request_error', 'output_config.format.schema: unsupported keyword') : anText(INTENT)));
    const r = await ai.run('writing', intent());
    expect(r.json).toEqual({ intents: ['buy'] });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.output_config).toEqual({ effort: 'low' });
    expect(calls[1].body.messages[0].content).toContain('Return only a JSON value');
  });

  it('a streamed call whose effort is rejected is resent before any text is shown, so nothing is shown twice', async () => {
    const ai = await boot();
    mockFetch((_url, body) => (body.output_config ? anErr(400, 'invalid_request_error', 'output_config.effort: not supported') : sse([
      { type: 'message_start', message: { usage: { input_tokens: 9 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }])));
    let shown = '';
    const r = await ai.run('writing', draft({ onDelta: (d: string) => { shown += d; } }));
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'an:claude-fable-5-2']);
    expect(calls.map(c => [c.body.stream, c.body.output_config])).toEqual([[true, { effort: 'medium' }], [true, undefined]]);
    expect(shown).toBe('Hello');
    expect(r).toMatchObject({ text: 'Hello', model: 'claude-fable-5.2' });
  });

  it('RADAR_AI_EFFORT=off removes the field everywhere and keeps the models and token budgets', async () => {
    const ai = await boot({ RADAR_AI_EFFORT: 'off' });
    mockFetch(url => anyText(INTENT)(url));
    await ai.run('writing', intent());
    await ai.run('writing', draft());
    await ai.run('writing', { purpose: 'support.answer', prompt: 'help' });
    expect(calls.map(tag)).toEqual(['an:claude-haiku-5-5', 'an:claude-fable-5-2', 'an:claude-opus-5-5']);
    expect(calls[0].body.output_config).toEqual({ format: expect.anything() });
    expect(calls[1].body).not.toHaveProperty('output_config');
    expect(calls[2].body).not.toHaveProperty('output_config');
    expect(calls.map(c => c.body.max_tokens)).toEqual([2048, 13000, 4000]);
  });
});

/* ════════════════════════════ standard ════════════════════════════ */

describe('standard tier', () => {
  it('with no business choice, writing asks Claude Opus 5.5 and sends no effort field (OpenRouter and direct)', async () => {
    let ai = await bootOR();
    mockFetch(() => orText('hello'));
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-opus-5.5']);
    expect(calls[0].body).not.toHaveProperty('reasoning');
    ai = await boot();
    mockFetch(() => anText('hello'));
    const r = await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5']);
    expect(calls[0].body).toEqual({ model: 'claude-opus-5-5', max_tokens: 4000, messages: [{ role: 'user', content: 'p' }] });
    expect(r.model).toBe('claude-opus-5.5');
    expect(H.inserted.at(-1)).toMatchObject({ task: 'writing', model: 'claude-opus-5.5', costUsd: expect.closeTo((30 * 4 + 20 * 20) / 1e6, 12) });
  });
  it('RADAR_AI_WRITING_MODEL and RADAR_AI_RESEARCH_MODEL set the default per kind; a business choice still wins', async () => {
    const ai = await boot({ RADAR_AI_WRITING_MODEL: 'gpt-6-sol', RADAR_AI_RESEARCH_MODEL: 'grok-4.7' });
    mockFetch(url => anyText('hello')(url));
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    await ai.run('research', { purpose: 'brief.scan', prompt: 'p' });
    H.aiChoice = { writing: 'claude-sonnet-5.5' };
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' }, { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['oa:gpt-6-sol', 'xa:grok-4.7', 'an:claude-sonnet-5-5']);
  });

  /** The requests one call makes for a business that chose `chosen`, with tiers on (unset) or off. */
  async function requests(tiers: string | undefined, orKey: boolean, chosen: string, input: any): Promise<Call[]> {
    const ai = await boot({ RADAR_AI_TIERS: tiers, ...(orKey ? { OPENROUTER_API_KEY: 'or-key' } : {}) });
    H.aiChoice = { writing: chosen, research: chosen };
    let n = 0;
    mockFetch(url => (input.webSearch && ++n === 1 ? anyText('findings https://s.example/1')(url) : input.onDelta ? streamOf(url) : anyText(input.schema ? POST : 'plain answer')(url)));
    await ai.run(input.webSearch ? 'research' : 'writing', input, { businessId: 'biz' });
    return calls;
  }
  const streamOf = (url: string) => (url === OR ? sse([{ id: 'g', choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }, 'data: [DONE]\n\n'])
    : url === AN ? sse([{ type: 'message_start', message: { usage: { input_tokens: 1 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }])
      : sse([{ type: 'response.output_text.delta', delta: 'Hi' }, { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } }]));
  const SHAPES: [string, () => any][] = [
    ['structured', () => ({ purpose: 'social.post', system: 'sys', prompt: 'write', schema: Post, schemaName: 'post idea', temperature: 0.7 })],
    ['streamed text', () => ({ purpose: 'social.post', system: 'sys', prompt: 'write', temperature: 0.7, maxTokens: 6000, onDelta: () => {} })],
    ['web search + schema', () => ({ purpose: 'brief.scan', prompt: 'find threads', schema: Post, webSearch: true })],
  ];
  const CASES = ['gpt-6-sol', 'claude-sonnet-5.5', 'grok-4.7'].flatMap(chosen => [true, false].flatMap(orKey => SHAPES.map(([shape, input]) => [chosen, orKey ? 'OpenRouter' : 'direct', shape, orKey, input] as const)));
  it.each(CASES)('a business that chose %s gets, on %s, exactly the %s request it gets with tiers off', async (chosen, _route, _shape, orKey, input) => {
    const legacy = await requests('off', orKey, chosen, input());
    const tiered = await requests(undefined, orKey, chosen, input());
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy[0].body.model).toContain(chosen.replace('.5', '').replace('claude-', ''));
    expect(tiered).toEqual(legacy);
  });

  it('a Claude attempt with a small budget gets 2,048 tokens of thinking headroom; nothing else in the request changes', async () => {
    const small = () => ({ purpose: 'backlinks.placement', system: 'sys', prompt: 'place it', schema: Post, maxTokens: 800 });
    for (const orKey of [true, false]) {
      const legacy = await requests('off', orKey, 'claude-sonnet-5.5', small());
      const tiered = await requests(undefined, orKey, 'claude-sonnet-5.5', small());
      expect(legacy[0].body.max_tokens).toBe(800);
      expect(tiered[0].body).toEqual({ ...legacy[0].body, max_tokens: 2848 });
    }
  });
  it('the headroom is for Claude only, only under 4,000, and also reaches a Claude fallback attempt', async () => {
    // A model from another provider keeps the caller's budget.
    expect((await requests(undefined, false, 'gpt-6-sol', { purpose: 'backlinks.placement', prompt: 'p', maxTokens: 800 }))[0].body.max_output_tokens).toBe(800);
    expect((await requests(undefined, false, 'grok-4.7', { purpose: 'backlinks.placement', prompt: 'p', maxTokens: 800 }))[0].body.max_output_tokens).toBe(800);
    // 4,000 and above is left alone.
    expect((await requests(undefined, false, 'claude-opus-5.5', { purpose: 'social.post', prompt: 'p', maxTokens: 4000 }))[0].body.max_tokens).toBe(4000);
    expect((await requests(undefined, false, 'claude-opus-5.5', { purpose: 'social.post', prompt: 'p', maxTokens: 3999 }))[0].body.max_tokens).toBe(6047);
    // GPT-6 Sol fails, the Claude fallback is a standard Claude attempt too.
    const ai = await boot(); H.aiChoice = { writing: 'gpt-6-sol' };
    mockFetch(url => (url === OA ? err(500, 'down') : anText('ok')));
    await ai.run('writing', { purpose: 'backlinks.placement', prompt: 'p', maxTokens: 800 }, { businessId: 'biz', retries: 0 });
    expect(calls.map(c => [tag(c), c.body.max_tokens ?? c.body.max_output_tokens])).toEqual([['oa:gpt-6-sol', 800], ['an:claude-sonnet-5-5', 2848]]);
  });

  it.each(['support.answer', 'article.rewrite', 'brief.rewrite'])('%s asks for low effort on the standard model, on every route', async purpose => {
    let ai = await boot();
    mockFetch(url => anyText(POST)(url));
    await ai.run('writing', { purpose, prompt: 'p', schema: Post });
    await ai.run('writing', { purpose, prompt: 'p' });
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5', 'an:claude-opus-5-5']);
    expect(calls[0].body.output_config).toEqual({ format: expect.anything(), effort: 'low' });
    expect(calls[1].body.output_config).toEqual({ effort: 'low' });
    expect(H.inserted.map(x => x.task)).toEqual(['writing', 'writing']);
    ai = await bootOR(); H.aiChoice = { writing: 'gpt-6-sol' };
    mockFetch(url => anyText('ok')(url));
    await ai.run('writing', { purpose, prompt: 'p' }, { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['or:openai/gpt-6-sol']);
    expect(calls[0].body.reasoning).toEqual({ effort: 'low' });
    ai = await boot(); H.aiChoice = { writing: 'grok-4.7' };
    mockFetch(url => anyText('ok')(url));
    await ai.run('writing', { purpose, prompt: 'p' }, { businessId: 'biz' });
    expect(calls.map(c => [tag(c), c.body.reasoning])).toEqual([['xa:grok-4.7', { effort: 'low' }]]);
  });
  it('no other standard purpose sends an effort field, and tiers off sends none for those three either', async () => {
    let ai = await boot();
    mockFetch(url => anyText('ok')(url));
    for (const purpose of ['social.post', 'brief.reply', 'article.videoWhy']) await ai.run('writing', { purpose, prompt: 'p' });
    for (const c of calls) expect(c.body).not.toHaveProperty('output_config');
    ai = await boot({ RADAR_AI_TIERS: 'off' });
    mockFetch(url => anyText('ok')(url));
    for (const purpose of ['support.answer', 'article.rewrite', 'brief.rewrite']) await ai.run('writing', { purpose, prompt: 'p' });
    expect(calls.map(tag)).toEqual(['oa:gpt-6-sol', 'oa:gpt-6-sol', 'oa:gpt-6-sol']);
    for (const c of calls) expect(c.body).not.toHaveProperty('reasoning');
  });
});

/* ════════════════════════════ premium ════════════════════════════ */

describe('premium tier', () => {
  it('OpenRouter: article.draft asks Claude Fable 5.2 first at medium effort with 8,000 tokens of headroom', async () => {
    const ai = await bootOR();
    mockFetch(() => orText('the article'));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-fable-5.2']);
    expect(calls[0].body).toMatchObject({ reasoning: { effort: 'medium' }, max_tokens: 13000 });
    expect(r).toMatchObject({ model: 'claude-fable-5.2', provider: 'openrouter' });
    expect(H.inserted).toMatchObject([{ task: 'premium', purpose: 'article.draft', model: 'claude-fable-5.2', provider: 'openrouter', ok: true }]);
  });
  it('direct Anthropic: the hyphenated API id, output_config.effort only, and a 360 s minimum timeout', async () => {
    const ai = await boot();
    const timers = vi.spyOn(globalThis, 'setTimeout');
    mockFetch(() => anText('the article'));
    await ai.run('writing', draft());
    expect(calls[0].body).toEqual({ model: 'claude-fable-5-2', max_tokens: 13000, system: 'sys', output_config: { effort: 'medium' }, messages: [{ role: 'user', content: 'write the article' }] });
    expect(timers.mock.calls.map(c => c[1])).toContain(360_000);
    expect(timers.mock.calls.map(c => c[1])).not.toContain(240_000);
    expect(H.inserted[0]).toMatchObject({ task: 'premium', model: 'claude-fable-5.2', provider: 'Anthropic', costUsd: expect.closeTo((30 * 8 + 20 * 40) / 1e6, 12) });
  });
  it.each(['suggestions.refreshDraft', 'calendar.topics'])('%s is premium too', async purpose => {
    const ai = await boot();
    mockFetch(() => anText(POST));
    await ai.run('writing', { purpose, prompt: 'p', schema: Post, maxTokens: 6000 });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2']);
    expect(calls[0].body).toMatchObject({ max_tokens: 14000, output_config: { effort: 'medium' } });
  });
  it('a business that chose another writing model keeps it: no premium chain, no effort, the caller\'s budget and timeout', async () => {
    const ai = await boot(); H.aiChoice = { writing: 'gpt-6.1-sol' };
    const timers = vi.spyOn(globalThis, 'setTimeout');
    mockFetch(() => oaText('the article'));
    const r = await ai.run('writing', draft(), { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['oa:gpt-6.1-sol']);
    expect(calls[0].body).toEqual({ model: 'gpt-6.1-sol', input: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'write the article' }], max_output_tokens: 5000 });
    expect(timers.mock.calls.map(c => c[1])).toContain(240_000);
    expect(timers.mock.calls.map(c => c[1])).not.toContain(360_000);
    expect(r.model).toBe('gpt-6.1-sol');
    expect(H.inserted[0]).toMatchObject({ task: 'premium', model: 'gpt-6.1-sol' });
  });
  it('a business that picked the default model again is back on the premium chain', async () => {
    const ai = await boot(); H.aiChoice = { writing: 'claude-opus-5.5' };
    mockFetch(() => anText('the article'));
    await ai.run('writing', draft(), { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2']);
    // The same business's standard calls stay on the model Settings shows.
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' }, { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'an:claude-opus-5-5']);
  });
  it('RADAR_AI_PREMIUM_MODEL, _FALLBACK and _EFFORT configure the chain', async () => {
    const ai = await boot({ RADAR_AI_PREMIUM_MODEL: 'gpt-6-astra', RADAR_AI_PREMIUM_FALLBACK: 'claude-fable-5.1', RADAR_AI_PREMIUM_EFFORT: 'high' });
    mockFetch(url => (url === OA ? err(500, 'down') : anText('the article')));
    await ai.run('writing', draft(), { retries: 0 });
    expect(calls.map(tag)).toEqual(['oa:gpt-6-astra', 'an:claude-fable-5-1']);
    expect(calls[0].body.reasoning).toEqual({ effort: 'high' });
    expect(calls[1].body.output_config).toEqual({ effort: 'high' });
  });

  it('both premium models failing: the standard model writes it, the fallback is logged, and the task does not fail', async () => {
    const ai = await boot();
    mockFetch((url, body) => (url === AN && body.model === 'claude-opus-5-5' ? anText('the article') : err(500, 'down')));
    const r = await ai.run('writing', draft(), { retries: 0 });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra', 'an:claude-opus-5-5']);
    expect(r).toMatchObject({ text: 'the article', model: 'claude-opus-5.5', provider: 'Anthropic' });
    expect(warns.some(w => w.includes('[ai] article.draft: used claude-opus-5.5 (fallback from claude-fable-5.2)'))).toBe(true);
    // Premium extras end with the premium step: the standard attempt is the caller's own request.
    expect(calls[1].body).toMatchObject({ reasoning: { effort: 'medium' }, max_output_tokens: 13000 });
    expect(calls[2].body).toEqual({ model: 'claude-opus-5-5', max_tokens: 5000, system: 'sys', messages: [{ role: 'user', content: 'write the article' }] });
    expect(H.inserted.map(x => [x.task, x.model, x.ok])).toEqual([['premium', 'claude-fable-5.2', false], ['premium', 'gpt-6-astra', false], ['premium', 'claude-opus-5.5', true]]);
  });
  it('no premium provider configured: the plan goes straight to the standard chain', async () => {
    const ai = await boot({ ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined });
    mockFetch(() => oaText('the article'));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['xa:grok-4.7']);
    expect(calls[0].body).not.toHaveProperty('reasoning');
    expect(r.model).toBe('grok-4.7');
    // Nothing was attempted for the premium models: no failed row, no failure report.
    expect(H.inserted.map(x => [x.model, x.ok])).toEqual([['grok-4.7', true]]);
  });
  it('a premium attempt that times out ends the premium step: the next request is the standard model, not the other premium model', async () => {
    const ai = await boot();
    mockFetch((_url, body) => { if (body.model === 'claude-fable-5-2') throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }); return anText('the article'); });
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'an:claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5.5');
  });
});

describe('a premium attempt that times out', () => {
  const tripped = async () => (await import('./adapters/openrouter')).openrouterTripped();
  it('OpenRouter\'s idle cutoff is an ordinary failed attempt: the same model is asked on its direct route, and the breaker opens', async () => {
    const ai = await bootOR(); shrinkTimers({ 45_000: 40 });
    mockFetch((url, _body, init) => (url === OR ? hang(init) : anText('the article')));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-fable-5.2', 'an:claude-fable-5-2']);
    expect(r).toMatchObject({ text: 'the article', model: 'claude-fable-5.2', provider: 'Anthropic' });
    expect(calls[1].body).toMatchObject({ max_tokens: 13000, output_config: { effort: 'medium' } });
    expect(H.inserted[0]).toMatchObject({ task: 'premium', model: 'claude-fable-5.2', provider: 'openrouter', ok: false, error: 'OpenRouter stream idle for 45s' });
    expect(await tripped()).toBe(true);
  });
  it('after an idle cutoff the premium fallback is still tried when the direct route fails too', async () => {
    const ai = await bootOR(); shrinkTimers({ 45_000: 40 });
    mockFetch((url, _body, init) => (url === OR ? hang(init) : url === AN ? err(500, 'down') : oaText('the article')));
    const r = await ai.run('writing', draft(), { retries: 0 });
    // The breaker is open, so GPT-6 Astra goes straight to its direct route.
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-fable-5.2', 'an:claude-fable-5-2', 'oa:gpt-6-astra']);
    expect(r.model).toBe('gpt-6-astra');
  });
  it('using up the whole timeout on OpenRouter ends the premium step: the standard model runs next, and the breaker opens the same way', async () => {
    const ai = await bootOR(); shrinkTimers({ 360_000: 40 });
    mockFetch((url, _body, init) => (url === OR ? hang(init) : anText('the article')));
    const r = await ai.run('writing', draft());
    // Not Fable direct, not GPT-6 Astra: straight to Claude Opus 5.5 (direct, because the breaker is open).
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-fable-5.2', 'an:claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5.5');
    expect(H.inserted[0]).toMatchObject({ task: 'premium', model: 'claude-fable-5.2', provider: 'openrouter', ok: false, error: 'OpenRouter timed out after 360s' });
    expect(await tripped()).toBe(true);
  });
  it('using up the whole timeout on the direct route ends it too, after one wait', async () => {
    const ai = await boot(); shrinkTimers({ 360_000: 40 });
    mockFetch((_url, body, init) => (body.model === 'claude-fable-5-2' ? hang(init) : anText('the article')));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'an:claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5.5');
  });
});

describe('a provider marked unavailable during a call (out of credit, key rejected)', () => {
  const noCredit = () => err(402, 'Insufficient credits');
  const reports = async () => vi.mocked((await import('../observability/failures')).reportFailure).mock.calls.length;
  const down = (provider: string) => warns.filter(w => w.includes(`${provider} unavailable for 10 min`)).length;

  it('is not asked again later in that call: Fable (402), Astra (500), then Grok, with no second Anthropic request', async () => {
    const ai = await boot();
    mockFetch(url => (url === AN ? noCredit() : url === OA ? err(500, 'down') : oaText('the article')));
    const r = await ai.run('writing', draft(), { retries: 0 });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra', 'xa:grok-4.7']);
    expect(r).toMatchObject({ text: 'the article', model: 'grok-4.7', provider: 'SpaceX' });
    expect(H.inserted.map(x => [x.task, x.model, x.ok])).toEqual([['premium', 'claude-fable-5.2', false], ['premium', 'gpt-6-astra', false], ['premium', 'grok-4.7', true]]);
    expect(await reports()).toBe(2);
    expect(down('Anthropic')).toBe(1);
    // The standard attempt that answers is the caller's own request (no premium extras).
    expect(calls[2].body).toEqual({ model: 'grok-4.7', input: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'write the article' }], max_output_tokens: 5000 });
  });
  it('premium with Anthropic out of credit and OpenAI healthy: GPT-6 Astra answers after one Anthropic request', async () => {
    const ai = await boot();
    mockFetch(url => (url === AN ? noCredit() : oaText('the article')));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra']);
    expect(r.model).toBe('gpt-6-astra');
    expect(H.inserted.map(x => [x.model, x.ok])).toEqual([['claude-fable-5.2', false], ['gpt-6-astra', true]]);
  });
  it('a utility call with Anthropic out of credit goes to GPT-6 Luna, with one Anthropic request', async () => {
    const ai = await boot();
    mockFetch(url => (url === AN ? noCredit() : oaText(INTENT)));
    const r = await ai.run('writing', intent());
    expect(calls.map(tag)).toEqual(['an:claude-haiku-5-5', 'oa:gpt-6-luna']);
    expect(r.model).toBe('gpt-6-luna');
  });
  it('with OpenRouter failing too, the direct Anthropic route is asked once and skipped when the standard step names Anthropic again', async () => {
    const ai = await bootOR();
    mockFetch(url => (url === OR ? err(500, 'down') : url === AN ? noCredit() : url === OA ? err(500, 'down') : oaText('the article')));
    const r = await ai.run('writing', draft(), { retries: 0 });
    expect(calls.map(tag).filter(t => t.startsWith('an:'))).toEqual(['an:claude-fable-5-2']);
    expect(calls.map(tag).at(-1)).toBe('xa:grok-4.7');
    expect(r.model).toBe('grok-4.7');
  });
  it('every provider marked unavailable during the call: the last remaining route is still asked, and the caller gets the generic failure', async () => {
    const ai = await boot();
    mockFetch(() => noCredit());
    const e = await caught(ai.run('writing', draft()));
    // Opus is skipped while Grok can still be tried; GPT-6 Sol is the last route left, so it is asked although OpenAI
    // was marked unavailable a moment earlier.
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra', 'xa:grok-4.7', 'oa:gpt-6-sol']);
    expect(e).toMatchObject({ code: 'ai_failed', status: 502, message: 'Radar couldn’t finish this. Try again.' });
    expect(H.inserted.map(x => x.ok)).toEqual([false, false, false, false]);
    expect([down('Anthropic'), down('OpenAI'), down('SpaceX')]).toEqual([1, 2, 1]);
  });
  it('only one provider configured and it is out of credit: its second route is still the last resort', async () => {
    const ai = await boot({ OPENAI_API_KEY: undefined, XAI_API_KEY: undefined });
    mockFetch(() => noCredit());
    const e = await caught(ai.run('writing', draft()));
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'an:claude-opus-5-5']);
    expect(e?.code).toBe('ai_failed');
  });
  it('a provider marked unavailable by an earlier, separate call is left out of the next plan, as before', async () => {
    const ai = await boot();
    mockFetch(url => (url === AN ? noCredit() : oaText('ok')));
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5', 'xa:grok-4.7']);
    await ai.run('writing', draft());
    await ai.run('writing', intent({ schema: undefined }));
    expect(calls.map(tag).slice(2)).toEqual(['oa:gpt-6-astra', 'oa:gpt-6-luna']);
    expect(down('Anthropic')).toBe(1);
  });
  it('every provider marked unavailable by earlier calls: the next call still asks its first model, as before', async () => {
    const ai = await boot();
    mockFetch(() => noCredit());
    await caught(ai.run('writing', { purpose: 'social.post', prompt: 'p' }));
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5', 'xa:grok-4.7', 'oa:gpt-6-sol']);
    mockFetch(() => anText('ok'));
    const r = await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5.5');
  });
  it('tiers off: a plan names each provider once, so the order of requests is what it always was', async () => {
    const ai = await boot({ RADAR_AI_TIERS: 'off' });
    mockFetch(() => noCredit());
    await caught(ai.run('writing', draft()));
    expect(calls.map(tag)).toEqual(['oa:gpt-6-sol', 'an:claude-sonnet-5-5', 'xa:grok-4.7']);
  });
});

/* ════════════════════════════ Claude Fable 5.2: refusals and data retention ════════════════════════════ */

describe('a declined request (stop_reason "refusal")', () => {
  const refusedStream = () => sse([
    { type: 'message_start', message: { usage: { input_tokens: 40 } } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Partial par' } },
    { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }, usage: { output_tokens: 12 } }]);
  const astraStream = () => sse([{ type: 'response.output_text.delta', delta: 'Full ' }, { type: 'response.output_text.delta', delta: 'draft' }, { type: 'response.completed', response: { usage: { input_tokens: 5, output_tokens: 2 } } }]);

  it('mid-stream on the direct route: the partial text is discarded, GPT-6 Astra writes it, and the Fable row is a failure with its tokens', async () => {
    const ai = await boot();
    mockFetch(url => (url === AN ? refusedStream() : astraStream()));
    let shown = ''; let resets = 0;
    const r = await ai.run('writing', draft({ onDelta: (d: string) => { shown += d; }, onReset: () => { resets++; shown = ''; } }));
    // One Fable request: a refusal is not retried.
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra']);
    expect(resets).toBe(2);
    expect(shown).toBe('Full draft');
    expect(r).toMatchObject({ text: 'Full draft', model: 'gpt-6-astra' });
    expect(H.inserted).toMatchObject([
      { task: 'premium', model: 'claude-fable-5.2', provider: 'Anthropic', ok: false, inputTokens: 40, outputTokens: 12, costUsd: expect.closeTo((40 * 8 + 12 * 40) / 1e6, 12), error: 'Model declined the request (cyber)' },
      { task: 'premium', model: 'gpt-6-astra', provider: 'OpenAI', ok: true },
    ]);
  });
  it('through OpenRouter: the same model is not asked again on its direct route; the next model is', async () => {
    const ai = await bootOR();
    mockFetch((_url, body) => (body.model === 'anthropic/claude-fable-5.2'
      ? sse([{ id: 'g', choices: [{ delta: { content: 'Partial par' } }] }, { choices: [{ delta: {}, finish_reason: 'stop', native_finish_reason: 'refusal' }], usage: { prompt_tokens: 40, completion_tokens: 12, cost: 0.0011 } }, 'data: [DONE]\n\n'])
      : orText('Full draft')));
    let shown = '';
    const r = await ai.run('writing', draft({ onDelta: (d: string) => { shown += d; }, onReset: () => { shown = ''; } }));
    expect(calls.map(tag)).toEqual(['or:anthropic/claude-fable-5.2', 'or:openai/gpt-6-astra']);
    expect(r).toMatchObject({ text: 'Full draft', model: 'gpt-6-astra', provider: 'openrouter' });
    expect(shown).not.toContain('Partial');
    expect(H.inserted[0]).toMatchObject({ model: 'claude-fable-5.2', provider: 'openrouter', ok: false, inputTokens: 40, outputTokens: 12, costUsd: 0.0011, error: 'Model declined the request' });
  });
  it.each([
    ['OpenRouter finish_reason content_filter', { OPENROUTER_API_KEY: 'or-key' }, () => orText('half an ans', { prompt_tokens: 40, completion_tokens: 12 }, 'content_filter'), ['or:anthropic/claude-fable-5.2', 'or:openai/gpt-6-astra']],
    ['OpenRouter finish_reason refusal', { OPENROUTER_API_KEY: 'or-key' }, () => orText('', { prompt_tokens: 40, completion_tokens: 0 }, 'refusal'), ['or:anthropic/claude-fable-5.2', 'or:openai/gpt-6-astra']],
    ['direct, not streamed', {}, () => json({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'bio' }, usage: { input_tokens: 40, output_tokens: 0 } }), ['an:claude-fable-5-2', 'oa:gpt-6-astra']],
  ] as const)('%s: never saved as an answer, the next model is asked', async (_l, env, refusal, order) => {
    const ai = await boot(env);
    mockFetch((url, body) => (/fable/.test(body.model) ? refusal() : anyText(POST)(url)));
    const r = await ai.run('writing', { purpose: 'suggestions.refreshDraft', prompt: 'p', schema: Post, maxTokens: 6000 });
    expect(calls.map(tag)).toEqual(order);
    expect(r).toMatchObject({ model: 'gpt-6-astra', json: { title: 'T', tags: [] } });
    expect(H.inserted[0]).toMatchObject({ model: 'claude-fable-5.2', ok: false, inputTokens: 40, error: expect.stringMatching(/^Model declined the request/) });
  });
  it('does not mark Anthropic unavailable: the next calls still go there, and Fable is asked again on the next premium call', async () => {
    const ai = await boot();
    mockFetch((url, body) => (body.model === 'claude-fable-5-2' ? json({ content: [], stop_reason: 'refusal', usage: { input_tokens: 4, output_tokens: 0 } }) : anyText('ok')(url)));
    await ai.run('writing', draft());
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra', 'an:claude-opus-5-5', 'an:claude-fable-5-2', 'oa:gpt-6-astra']);
    expect(warns.some(w => w.includes('unavailable for 10 min'))).toBe(false);
  });
  it('every premium model declining still ends on the standard model rather than failing', async () => {
    const ai = await boot();
    mockFetch((url, body) => (body.model === 'claude-fable-5-2' ? json({ content: [], stop_reason: 'refusal', usage: { input_tokens: 4, output_tokens: 0 } }) : url === OA ? err(500, 'down') : anText('the article')));
    const r = await ai.run('writing', draft(), { retries: 0 });
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra', 'an:claude-opus-5-5']);
    expect(r.model).toBe('claude-opus-5.5');
  });
});

describe('Claude Fable 5.2 on a zero-retention Anthropic organization', () => {
  it('the direct 400 is one failed attempt: GPT-6 Astra answers and Anthropic is not marked unavailable', async () => {
    const ai = await boot();
    mockFetch((url, body) => (body.model === 'claude-fable-5-2' ? anErr(400, 'invalid_request_error', 'This model is not available under your organization\'s data retention configuration.') : anyText('the article')(url)));
    const r = await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-fable-5-2', 'oa:gpt-6-astra']);
    expect(r.model).toBe('gpt-6-astra');
    expect(H.inserted[0]).toMatchObject({ task: 'premium', model: 'claude-fable-5.2', provider: 'Anthropic', ok: false, inputTokens: null, outputTokens: null, costUsd: null, error: expect.stringMatching(/^HTTP 400: .*invalid_request_error/) });
    await ai.run('writing', { purpose: 'social.post', prompt: 'p' });
    expect(calls.map(tag).at(-1)).toBe('an:claude-opus-5-5');
    expect(warns.some(w => w.includes('unavailable for 10 min'))).toBe(false);
  });
});

/* ════════════════════════════ switches ════════════════════════════ */

describe('RADAR_AI_TIERS', () => {
  it('off: utility and premium purposes go back to the business\'s research or writing model, untouched', async () => {
    const ai = await boot({ RADAR_AI_TIERS: 'off' }); H.aiChoice = { research: 'gpt-6-sol', writing: 'grok-4.7' };
    mockFetch(url => anyText(INTENT)(url));
    await ai.run('research', intent({ purpose: 'brief.rank' }), { businessId: 'biz' });
    await ai.run('writing', intent({ purpose: 'article.meta' }), { businessId: 'biz' });
    await ai.run('writing', draft(), { businessId: 'biz' });
    expect(calls.map(tag)).toEqual(['oa:gpt-6-sol', 'xa:grok-4.7', 'xa:grok-4.7']);
    expect(calls.map(c => c.body.max_output_tokens)).toEqual([500, 500, 5000]);
    for (const c of calls) expect(c.body).not.toHaveProperty('reasoning');
    expect(H.inserted.map(x => x.task)).toEqual(['research', 'writing', 'writing']);
  });
  it('off with no business choice: writing is GPT-6 Sol again', async () => {
    const ai = await boot({ RADAR_AI_TIERS: 'off' });
    mockFetch(url => anyText(INTENT)(url));
    await ai.run('writing', intent());
    await ai.run('writing', draft());
    await ai.run('research', intent({ purpose: 'brief.rank' }));
    expect(calls.map(tag)).toEqual(['oa:gpt-6-sol', 'oa:gpt-6-sol', 'an:claude-opus-5-5']);
  });
  it('premium alone turns utility off: those purposes are standard calls of their kind, premium still runs', async () => {
    const ai = await boot({ RADAR_AI_TIERS: 'premium' });
    mockFetch(url => anyText(INTENT)(url));
    await ai.run('writing', intent());
    await ai.run('writing', draft());
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5', 'an:claude-fable-5-2']);
    expect(calls[0].body.output_config).toEqual({ format: expect.anything() });
    expect(H.inserted.map(x => x.task)).toEqual(['writing', 'premium']);
  });
  it('utility alone turns premium off: drafts run on the standard model, utility still runs', async () => {
    const ai = await boot({ RADAR_AI_TIERS: 'utility' });
    mockFetch(url => anyText(INTENT)(url));
    await ai.run('writing', draft());
    await ai.run('writing', intent());
    expect(calls.map(tag)).toEqual(['an:claude-opus-5-5', 'an:claude-haiku-5-5']);
    expect(calls[0].body).not.toHaveProperty('output_config');
    expect(calls[0].body.max_tokens).toBe(5000);
    expect(H.inserted.map(x => x.task)).toEqual(['writing', 'utility']);
  });
});

/* ════════════════════════════ spend records for rejected answers ════════════════════════════ */

describe('an answer the provider billed and Radar rejected', () => {
  const only = { OPENAI_API_KEY: undefined, XAI_API_KEY: undefined };
  it('invalid JSON: the row is a failure with its tokens and cost', async () => {
    const ai = await boot(only);
    mockFetch(() => anText('not json {'));
    const e = await caught(ai.run('writing', { purpose: 'social.post', prompt: 'p', schema: Post }, { retries: 0 }));
    expect(e?.code).toBe('ai_failed');
    expect(H.inserted).toEqual([expect.objectContaining({ ok: false, model: 'claude-opus-5.5', provider: 'Anthropic', inputTokens: 30, outputTokens: 20, costUsd: expect.closeTo((30 * 4 + 20 * 20) / 1e6, 12), error: expect.stringMatching(/^Structured output failed validation/) })]);
  });
  it('an empty answer: the same, on every retry', async () => {
    const ai = await boot(only);
    mockFetch(() => anText('', { input_tokens: 30, output_tokens: 900 }));
    const e = await caught(ai.run('writing', { purpose: 'social.post', prompt: 'p' }, { retries: 1 }));
    expect(e?.code).toBe('ai_failed');
    expect(H.inserted).toHaveLength(2);
    for (const row of H.inserted) expect(row).toMatchObject({ ok: false, inputTokens: 30, outputTokens: 900, costUsd: expect.closeTo((30 * 4 + 900 * 20) / 1e6, 12), error: 'Empty response from Anthropic' });
  });
  it('through OpenRouter the reported cost is kept', async () => {
    const ai = await bootOR({ ...only, ANTHROPIC_API_KEY: undefined });
    mockFetch(() => orText('not json {'));
    await caught(ai.run('writing', { purpose: 'social.post', prompt: 'p', schema: Post }, { retries: 0 }));
    expect(H.inserted[0]).toMatchObject({ ok: false, provider: 'openrouter', inputTokens: 11, outputTokens: 7, costUsd: 0.0042 });
  });
  it('a request the provider never answered (HTTP 500) records no tokens and no cost', async () => {
    const ai = await boot(only);
    mockFetch(() => err(500, 'down'));
    await caught(ai.run('writing', { purpose: 'social.post', prompt: 'p' }, { retries: 0 }));
    expect(H.inserted).toEqual([expect.objectContaining({ ok: false, inputTokens: null, outputTokens: null, costUsd: null })]);
  });
  it('web searches the provider billed are added to a direct call\'s cost', async () => {
    const ai = await boot(only);
    mockFetch(() => json({ content: [{ type: 'text', text: 'findings' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 1000, server_tool_use: { web_search_requests: 3 } } }));
    await ai.run('research', { purpose: 'brief.scan', prompt: 'p', webSearch: true });
    expect(H.inserted[0]).toMatchObject({ ok: true, inputTokens: 1000, outputTokens: 1000, costUsd: expect.closeTo((1000 * 4 + 1000 * 20) / 1e6 + 0.03, 12) });
    const oa = await boot({ ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined, RADAR_AI_RESEARCH_MODEL: 'gpt-6-sol' });
    mockFetch(() => json({ output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'findings', annotations: [] }] }], usage: { input_tokens: 1000, output_tokens: 1000 } }));
    await oa.run('research', { purpose: 'brief.scan', prompt: 'p', webSearch: true });
    expect(H.inserted.at(-1)).toMatchObject({ provider: 'OpenAI', costUsd: expect.closeTo((1000 * 2 + 1000 * 10) / 1e6 + 0.02, 12) });
  });
});

describe('a web-search-plus-schema call whose first pass was billed before the second failed', () => {
  const scan = { purpose: 'brief.scan', prompt: 'find threads', schema: Post, webSearch: true };
  const anFound = () => json({ content: [{ type: 'text', text: 'findings' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } } });
  const oaFound = () => json({ output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'findings', annotations: [] }] }], usage: { input_tokens: 1000, output_tokens: 1000 } });
  const orFound = () => orText('findings', { prompt_tokens: 11, completion_tokens: 7, cost: 0.0042 });
  const opus = (i: number, o: number, searches: number) => (i * 4 + o * 20) / 1e6 + searches * 0.01;
  const sol = (i: number, o: number, searches: number) => (i * 2 + o * 10) / 1e6 + searches * 0.01;
  const ROUTES = [
    ['direct Anthropic', { OPENAI_API_KEY: undefined, XAI_API_KEY: undefined }, anFound, 'Anthropic'],
    ['direct OpenAI', { ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined, RADAR_AI_RESEARCH_MODEL: 'gpt-6-sol' }, oaFound, 'OpenAI'],
    // One model on one route each, so the call writes exactly one row (OpenRouter is kept to GPT-6 Sol by the model map).
    ['OpenRouter', { ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined, XAI_API_KEY: undefined, OPENROUTER_API_KEY: 'or-key', RADAR_AI_RESEARCH_MODEL: 'gpt-6-sol', OPENROUTER_MODEL_MAP: '{"claude-opus-5.5":"","grok-4.7":""}' }, orFound, 'openrouter'],
  ] as const;
  /** Run the call with pass 1 answered by `found` and pass 2 by `second`; the one ai_calls row it wrote. */
  async function rowFor(env: Env, first: () => Response, second: () => Response) {
    const ai = await boot(env);
    let n = 0;
    mockFetch(() => (++n === 1 ? first() : second()));
    const e = await caught(ai.run('research', scan, { retries: 0 }));
    expect(e?.code).toBe('ai_failed');
    expect(H.inserted).toHaveLength(1);
    return { row: H.inserted[0], requests: calls.length };
  }

  it.each(ROUTES)('%s: pass 2 answers HTTP 500, the failed row carries pass 1\'s tokens, searches and cost', async (_l, env, found, provider) => {
    const { row, requests } = await rowFor(env, found, () => err(500, 'down'));
    expect(requests).toBe(2);
    expect(row).toMatchObject({ task: 'research', provider, ok: false, error: expect.stringMatching(/^HTTP 500/) });
    if (provider === 'openrouter') expect(row).toMatchObject({ inputTokens: 11, outputTokens: 7, costUsd: 0.0042 });
    else expect(row).toMatchObject({ inputTokens: 1000, outputTokens: 1000, costUsd: expect.closeTo((provider === 'Anthropic' ? opus : sol)(1000, 1000, 2), 12) });
  });
  it.each(ROUTES)('%s: pass 1 itself failing still writes no tokens and no cost', async (_l, env, _found, provider) => {
    const { row, requests } = await rowFor(env, () => err(500, 'down'), () => err(500, 'down'));
    expect(requests).toBe(1);
    expect(row).toMatchObject({ provider, ok: false, inputTokens: null, outputTokens: null, costUsd: null });
  });
  it('direct Anthropic: pass 2 is declined, the row is pass 1 plus what the declined pass reported', async () => {
    const { row, requests } = await rowFor(ROUTES[0][1], anFound, () => json({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, usage: { input_tokens: 200, output_tokens: 0 } }));
    expect(requests).toBe(2);
    expect(row).toMatchObject({ ok: false, inputTokens: 1200, outputTokens: 1000, costUsd: expect.closeTo(opus(1200, 1000, 2), 12), error: 'Model declined the request (cyber)' });
  });
  it('OpenRouter: pass 2 is declined, the reported costs of both passes are added', async () => {
    const { row } = await rowFor(ROUTES[2][1], orFound, () => orText('half', { prompt_tokens: 5, completion_tokens: 3, cost: 0.001 }, 'content_filter'));
    expect(row).toMatchObject({ ok: false, inputTokens: 16, outputTokens: 10, costUsd: expect.closeTo(0.0052, 12), error: 'Model declined the request' });
  });
  it('direct OpenAI: a declined pass 2 arrives as an empty answer, and the row is pass 1 plus pass 2', async () => {
    const { row } = await rowFor(ROUTES[1][1], oaFound, () => json({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I can\'t help with that.' }] }], usage: { input_tokens: 200, output_tokens: 10 } }));
    expect(row).toMatchObject({ ok: false, inputTokens: 1200, outputTokens: 1010, costUsd: expect.closeTo(sol(1200, 1010, 2), 12), error: 'Empty response from OpenAI' });
  });
  it('a pass 2 that succeeds is unchanged: one successful row with both passes added', async () => {
    const ai = await boot(ROUTES[0][1]);
    let n = 0;
    mockFetch(() => (++n === 1 ? anFound() : anText(POST, { input_tokens: 200, output_tokens: 50 })));
    await ai.run('research', scan);
    expect(H.inserted).toMatchObject([{ ok: true, inputTokens: 1200, outputTokens: 1050, costUsd: expect.closeTo(opus(1200, 1050, 2), 12) }]);
  });
});

/* ════════════════════════════ Settings ════════════════════════════ */

describe('Settings → AI models', () => {
  it('shows the model standard calls really use: Claude Opus 5.5 by default, the old default with tiers off, a saved choice always', async () => {
    await boot();
    const { aiPrefsOf } = await import('../workspace');
    const biz = (ai: any) => ({ ai }) as any;
    expect(aiPrefsOf(biz({}))).toEqual({ writing: 'claude-opus-5.5', research: 'claude-opus-5.5' });
    expect(aiPrefsOf(biz(null))).toEqual({ writing: 'claude-opus-5.5', research: 'claude-opus-5.5' });
    expect(aiPrefsOf(biz({ writing: 'grok-4.7', instructions: { all: 'Use British spelling.' } }))).toEqual({ writing: 'grok-4.7', research: 'claude-opus-5.5' });
    process.env.RADAR_AI_WRITING_MODEL = 'claude-sonnet-5.5';
    expect(aiPrefsOf(biz({}))).toEqual({ writing: 'claude-sonnet-5.5', research: 'claude-opus-5.5' });
    process.env.RADAR_AI_TIERS = 'off';
    expect(aiPrefsOf(biz({}))).toEqual({ writing: 'gpt-6-sol', research: 'claude-opus-5.5' });
    expect(aiPrefsOf(biz({ writing: 'claude-fable-5.2' }))).toEqual({ writing: 'claude-fable-5.2', research: 'claude-opus-5.5' });
  });
  it('the catalogue offers Claude Fable 5.2 and keeps Fable 5.1 selectable; no utility or premium row exists', async () => {
    const { AI_MODELS, AI_TASKS, aiFind } = await import('@/lib/constants');
    expect(aiFind('claude-fable-5.2')).toMatchObject({ l: 'Claude Fable 5.2', p: 'Anthropic' });
    expect(aiFind('claude-fable-5.1')).toMatchObject({ l: 'Claude Fable 5.1', d: 'The previous Fable model. Costs more than Fable 5.2.' });
    expect(AI_MODELS[0].list.map(m => m.id).slice(0, 2)).toEqual(['claude-fable-5.2', 'claude-fable-5.1']);
    expect(AI_TASKS.map(t => t.k)).toEqual(['writing', 'research']);
  });
  it('every catalogue model has a provider API id, a price and, where listed, an OpenRouter id (so none logs a null cost or an unmapped id)', async () => {
    const ai = await bootOR();
    const { AI_MODELS } = await import('@/lib/constants');
    const { costOf } = await import('./prices');
    const { openrouterId } = await import('./adapters/openrouter');
    for (const id of AI_MODELS.flatMap(g => g.list.map(m => m.id))) {
      expect(costOf(id, { inputTokens: 1, outputTokens: 1 }), id).not.toBeNull();
      expect(openrouterId(id), id).toMatch(/^(anthropic|openai|x-ai)\//);
      H.aiChoice = { writing: id };
      mockFetch(url => anyText('ok')(url));
      await ai.run('writing', { purpose: 'social.post', prompt: 'p' }, { businessId: 'biz' });
      expect(calls[0].body.model, id).toBe(openrouterId(id));
    }
    // Anthropic's own API takes hyphenated ids.
    const direct = await boot(); H.aiChoice = { writing: 'claude-fable-5.2' };
    mockFetch(() => anText('ok'));
    await direct.run('writing', { purpose: 'social.post', prompt: 'p' }, { businessId: 'biz' });
    expect(calls[0].body.model).toBe('claude-fable-5-2');
  });
});

/* ════════════════════════════ cut off at the output limit ════════════════════════════ */
describe('an answer cut off at the output-token limit', () => {
  const only = { OPENAI_API_KEY: undefined, XAI_API_KEY: undefined };
  const Rank = z.object({ results: z.array(z.object({ id: z.string(), fit: z.number() })) });
  const rank = (over: any = {}) => ({ purpose: 'brief.rank', prompt: 'score these', schema: Rank, schemaName: 'ranking', maxTokens: 8000, ...over });
  const FULL = '{"results":[{"id":"a","fit":0.5}]}';
  const cut = (text: string) => json({ content: [{ type: 'text', text }], stop_reason: 'max_tokens', usage: { input_tokens: 900, output_tokens: 8000 } });
  /** Sleeps between retries pass at once; every other timer is real. */
  const fastRetries = () => shrinkTimers({ 800: 1, 1600: 1 });

  it('Anthropic: the failure names the limit, keeps its tokens, and the retry asks for twice the room', async () => {
    const ai = await boot(only); fastRetries();
    let n = 0;
    mockFetch(() => (++n === 1 ? cut('{"results":[{"id":"a","fit":0.5},{"id":"b"') : anText(FULL)));
    const out = await ai.run('research', rank());
    expect(out.json).toEqual({ results: [{ id: 'a', fit: 0.5 }] });
    expect(calls.map(c => c.body.max_tokens)).toEqual([8000, 16000]);
    expect(calls.map(tag)).toEqual(['an:claude-haiku-5-5', 'an:claude-haiku-5-5']);
    expect(H.inserted).toEqual([
      expect.objectContaining({ ok: false, task: 'utility', purpose: 'brief.rank', inputTokens: 900, outputTokens: 8000, error: 'Structured output cut off at the 8000-token output limit (Anthropic)' }),
      expect.objectContaining({ ok: true, task: 'utility', purpose: 'brief.rank' }),
    ]);
  });
  it('nothing but thinking before the limit: named too, not "Empty response"', async () => {
    const ai = await boot(only); fastRetries();
    let n = 0;
    mockFetch(() => (++n === 1 ? cut('') : anText(FULL)));
    await ai.run('research', rank({ maxTokens: 4000 }));
    expect(calls.map(c => c.body.max_tokens)).toEqual([4000, 8000]);
    expect(H.inserted[0]).toMatchObject({ ok: false, error: 'Answer cut off at the 4000-token output limit (Anthropic)' });
  });
  it('the room stops doubling at the ceiling, and a request already above it is not lowered', async () => {
    const ai = await boot(only); fastRetries();
    mockFetch(() => cut('{"results":['));
    await caught(ai.run('research', rank({ maxTokens: 12000 })));
    expect(calls.map(c => c.body.max_tokens)).toEqual([12000, 24000, 32000]);
    mockFetch(() => cut('{"results":['));
    await caught(ai.run('research', rank({ maxTokens: 40000 })));
    expect(calls.map(c => c.body.max_tokens)).toEqual([40000, 40000, 40000]);
  });
  it('a cut-off answer that still validates is an answer: nothing is retried', async () => {
    const ai = await boot(only);
    mockFetch(() => cut(FULL));
    const out = await ai.run('research', rank());
    expect(out.json).toEqual({ results: [{ id: 'a', fit: 0.5 }] });
    expect(calls).toHaveLength(1);
    expect(H.inserted).toEqual([expect.objectContaining({ ok: true })]);
  });
  it('an invalid answer that was not cut off keeps the validation message and the same limit', async () => {
    const ai = await boot(only); fastRetries();
    mockFetch(() => anText('{"results":"none"}'));
    await caught(ai.run('research', rank()));
    expect(calls.map(c => c.body.max_tokens)).toEqual([8000, 8000, 8000]);
    for (const row of H.inserted) expect(row.error).toMatch(/^Structured output failed validation/);
  });
  it('OpenRouter (finish_reason "length") and OpenAI (incomplete: max_output_tokens) are named the same way', async () => {
    let ai = await bootOR({ ...only, ANTHROPIC_API_KEY: undefined }); fastRetries();
    let n = 0;
    mockFetch(() => (++n === 1 ? orText('{"results":[', { prompt_tokens: 900, completion_tokens: 8000, cost: 0.004 }, 'length') : orText(FULL)));
    await ai.run('research', rank());
    expect(calls.map(c => c.body.max_tokens)).toEqual([8000, 16000]);
    expect(H.inserted[0]).toMatchObject({ ok: false, costUsd: 0.004, error: 'Structured output cut off at the 8000-token output limit (openrouter)' });

    H.inserted.length = 0; n = 0;
    ai = await boot({ ANTHROPIC_API_KEY: undefined, XAI_API_KEY: undefined, RADAR_AI_UTILITY_MODEL: 'gpt-6-luna' });
    mockFetch(() => (++n === 1
      ? json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'message', content: [{ type: 'output_text', text: '{"results":[', annotations: [] }] }], usage: { input_tokens: 900, output_tokens: 8000 } })
      : oaText(FULL)));
    await ai.run('research', rank());
    expect(calls.map(c => c.body.max_output_tokens)).toEqual([8000, 16000]);
    expect(H.inserted[0]).toMatchObject({ ok: false, outputTokens: 8000, error: 'Structured output cut off at the 8000-token output limit (OpenAI)' });
  });
  it('the Daily Brief ranking call asks for 8,000 tokens', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../services/brief/rank.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/purpose: 'brief\.rank'[^\n]*maxTokens: 8000/);
  });
});
