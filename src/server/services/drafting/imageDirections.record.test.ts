// The direction step through the real ai.run: which model it asks, how often, what it records in ai_calls, and that a
// failing provider is reported and never fails the article. fetch and the database are replaced; ai.run, the Anthropic
// adapter, the dev stub and resolveImageDirections are real. Modules are booted fresh per test from process.env.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, Block, CalendarEntry, Profile } from '@/lib/types';

const H = vi.hoisted(() => ({ inserted: [] as any[], report: vi.fn(async (..._args: any[]) => {}), aiChoice: {} as Record<string, any> }));
vi.mock('../../db', () => ({
  db: {
    insert: () => ({ values: (value: any) => { H.inserted.push(value); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ai: H.aiChoice }] }) }) }),
  },
  schema: { aiCalls: {}, businesses: { ai: 'ai', id: 'id' } },
}));
vi.mock('../../observability/failures', () => ({ reportFailure: H.report }));
vi.mock('../calendar/research', () => ({ tokens: (s: string) => s.toLowerCase().split(/\W+/).filter(word => word.length > 2) }));

const VARS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'RADAR_DEV_STUBS', 'RADAR_AI_TIERS', 'RADAR_AI_UTILITY_MODEL', 'RADAR_AI_EFFORT', 'AI_MODEL_MAP'];
const saved: Record<string, string | undefined> = {};
for (const name of VARS) saved[name] = process.env[name];
async function boot(over: Record<string, string>) {
  for (const name of VARS) delete process.env[name];
  Object.assign(process.env, over);
  vi.resetModules();
  return import('./imageDirections');
}

const profile = { domain: 'lived.test', business: { name: 'Lived', industry: 'Property reviews' }, brand: { language: 'English', markets: ['AE'] } } as unknown as Profile;
const e = { title: 'Wasl 611 Reviews: Tenant Ratings and What to Check First', kw: 'wasl 611 reviews', type: 'Guide' } as CalendarEntry;
const body: Block[] = [
  ['p', 'Wasl 611 is a gated staff accommodation community of three buildings in Al Warsan, Dubai.'],
  ['h2', 'What tenants say about maintenance'], ['p', 'Repairs are logged at the gate office and most are handled within the week.'],
  ['h2', 'What to check first'], ['p', 'Walk the corridor and look at the shared kitchen before you sign.'],
];
const a = { body, brief: { angle: '', outline: [], words: 1400 }, img: { style: 'illustration', seed: 1, prompt: 'Calm, editorial image about wasl 611 reviews', alt: '', url: null } } as Pick<Article, 'body' | 'brief' | 'img' | 'imageDirections'>;
const ANSWER = {
  subject: 'Wasl 611', subjectKind: 'building',
  cover: { direction: 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, seen from outside the entrance gate.', alt: 'Illustration of Wasl 611 in Al Warsan' },
  sections: [
    { i: 0, direction: 'A maintenance worker repairing a door hinge in a plain residential corridor, with a toolbox open on the floor.', alt: 'Illustration of a repair in a corridor' },
    { i: 1, direction: 'A shared kitchen in staff accommodation, seen from the doorway, with a cooker, a sink and a long counter.', alt: 'Illustration of a shared kitchen' },
  ],
};
const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let requests: { url: string; body: any }[] = [];
const answer = (handler: () => Response) => vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => { requests.push({ url: String(url), body: JSON.parse(init.body) }); return handler(); }));
const rows = () => H.inserted.map(r => ({ businessId: r.businessId, task: r.task, purpose: r.purpose, model: r.model, provider: r.provider, ok: r.ok }));

beforeEach(() => {
  H.inserted.length = 0; H.report.mockClear(); H.aiChoice = {}; requests = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const name of VARS) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
});

describe('the direction step as an AI call', () => {
  it('is one request to the utility model at low effort, recorded as one utility row for the business', async () => {
    const { resolveImageDirections } = await boot({ ANTHROPIC_API_KEY: 'placeholder-key-for-this-test' });
    H.aiChoice = { writing: 'claude-opus-5.5' }; // the business's own writing model is not what a utility purpose asks
    answer(() => json({ content: [{ type: 'text', text: JSON.stringify(ANSWER) }], stop_reason: 'end_turn', usage: { input_tokens: 3400, output_tokens: 520 } }));
    const d = await resolveImageDirections('biz', profile, e, a);
    expect(d).toMatchObject({ source: 'ai', subject: { name: 'Wasl 611', kind: 'building' }, cover: { prompt: ANSWER.cover.direction, alt: ANSWER.cover.alt } });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(requests[0].body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 2048 });
    expect(requests[0].body.output_config.effort).toBe('low');
    expect(JSON.stringify(requests[0].body)).toContain('Wasl 611 is a gated staff accommodation community');
    expect(rows()).toEqual([{ businessId: 'biz', task: 'utility', purpose: 'article.imageDirections', model: 'claude-haiku-5.5', provider: 'Anthropic', ok: true }]);
    expect(H.inserted[0]).toMatchObject({ inputTokens: 3400, outputTokens: 520 });
    expect(H.report).not.toHaveBeenCalled();
  });
  it('a failing provider is asked once, recorded and reported, and the article still gets directions', async () => {
    const { resolveImageDirections } = await boot({ ANTHROPIC_API_KEY: 'placeholder-key-for-this-test' });
    answer(() => json({ type: 'error', error: { type: 'api_error', message: 'internal error' } }, 500));
    const d = await resolveImageDirections('biz', profile, e, a);
    expect(d.source).toBe('fallback');
    expect(d.cover.prompt).toContain('Wasl 611 Reviews');
    expect(d.sections).toHaveLength(2);
    expect(requests).toHaveLength(1); // retries: 0
    expect(rows()).toEqual([{ businessId: 'biz', task: 'utility', purpose: 'article.imageDirections', model: 'claude-haiku-5.5', provider: 'Anthropic', ok: false }]);
    expect(H.report).toHaveBeenCalled();
    expect(H.report.mock.calls.at(-1)![1]).toMatchObject({ source: 'ai', operation: 'article.imageDirections', businessId: 'biz', retrying: false });
  });
  it('an answer that does not fit the schema is a failed, recorded attempt, not a crash', async () => {
    const { resolveImageDirections } = await boot({ ANTHROPIC_API_KEY: 'placeholder-key-for-this-test' });
    answer(() => json({ content: [{ type: 'text', text: JSON.stringify({ cover: 'a nice picture' }) }], stop_reason: 'end_turn', usage: { input_tokens: 3400, output_tokens: 12 } }));
    expect((await resolveImageDirections('biz', profile, e, a)).source).toBe('fallback');
    expect(rows()).toEqual([{ businessId: 'biz', task: 'utility', purpose: 'article.imageDirections', model: 'claude-haiku-5.5', provider: 'Anthropic', ok: false }]);
  });
  it('with tiers off it runs on the business’s writing model, as the other utility purposes do', async () => {
    const { resolveImageDirections } = await boot({ ANTHROPIC_API_KEY: 'placeholder-key-for-this-test', RADAR_AI_TIERS: 'off' });
    H.aiChoice = { writing: 'claude-sonnet-5.5' };
    answer(() => json({ content: [{ type: 'text', text: JSON.stringify(ANSWER) }], stop_reason: 'end_turn', usage: { input_tokens: 3400, output_tokens: 520 } }));
    expect((await resolveImageDirections('biz', profile, e, a)).source).toBe('ai');
    expect(requests[0].body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 900 });
    expect(rows()).toEqual([{ businessId: 'biz', task: 'writing', purpose: 'article.imageDirections', model: 'claude-sonnet-5.5', provider: 'Anthropic', ok: true }]);
  });
  it('dev stubs: no network, the stub’s directions are used as they are, and the same row is written', async () => {
    const { resolveImageDirections } = await boot({ RADAR_DEV_STUBS: '1' });
    answer(() => json({}));
    const d = await resolveImageDirections('biz', profile, e, a);
    expect(requests).toHaveLength(0);
    expect(d).toMatchObject({ source: 'ai', subject: null });
    expect(d.cover.prompt).toContain('Wasl 611 Reviews');
    expect(d.sections.map(s => s.prompt).every((p, i) => p.includes(['What tenants say about maintenance', 'What to check first'][i]))).toBe(true);
    expect(rows()).toEqual([{ businessId: 'biz', task: 'utility', purpose: 'article.imageDirections', model: 'claude-haiku-5.5', provider: 'Anthropic', ok: true }]);
  });
});
