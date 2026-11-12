// The article draft through the real AI layer: a streamed answer that is cut off must never be saved as the draft.
// The first sandbox pull request carried an article that ended mid-sentence ("A landlord who responds calmly and
// specifically to a") and had been saved as ready for review. fetch and the database are replaced; ai.run, the
// Anthropic adapter and draftArticle are real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block, CalendarEntry, Profile } from '@/lib/types';

const H = vi.hoisted(() => ({ inserted: [] as any[] }));
vi.mock('../../db', () => {
  // Every read returns no rows: no crawled pages, no saved AI settings.
  const rows: any = { where: () => rows, limit: async () => [], then: (resolve: any) => Promise.resolve([]).then(resolve) };
  return { db: { select: () => ({ from: () => rows }), insert: () => ({ values: (value: any) => { H.inserted.push(value); return Promise.resolve(); } }) }, schema: { aiCalls: {}, businesses: { ai: 'ai', id: 'id' }, crawlPages: { businessId: 'businessId' }, calendarEntries: {} } };
});
vi.mock('../../observability/failures', () => ({ reportFailure: vi.fn(async () => {}) }));
vi.mock('../images', () => ({ renderImage: vi.fn(async () => 'https://images.example.test/hero.png'), renderImageFile: vi.fn(async () => ({ url: 'https://images.example.test/hero.png', bytes: 1, type: 'image/png' })), defaultArticleImageStyle: () => 'branded', MODEL_STYLES: ['illustration', 'photography'] }));
vi.mock('./bodyImages', () => ({ generateArticleBodyImages: vi.fn(async () => []) }));
vi.mock('../gsc/metrics', () => ({ normKw: (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(), topQueries: async () => [] }));
vi.mock('../calendar/research', () => ({ tokens: (s: string) => s.toLowerCase().split(/\W+/).filter(word => word.length > 2) }));

const VARS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'RADAR_DEV_STUBS', 'RADAR_AI_TIERS', 'AI_MODEL_MAP'];
const saved: Record<string, string | undefined> = {};
for (const name of VARS) saved[name] = process.env[name];

const INTRO = 'Tenant reviews are useful when you read them for patterns rather than for single stories.';
const LAST = 'A landlord who responds calmly and specifically to a complaint is telling you how the next repair will go.';
const WHOLE = `${INTRO}\n\n## What a reply tells you\n\n${LAST}`;
/** The same answer stopped at the output limit, mid-sentence. */
const PARTIAL = WHOLE.slice(0, WHOLE.indexOf(' complaint'));

const sse = (events: any[]) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
/** An Anthropic text stream; `stop` null closes it with no stop reason, as a dropped connection does. */
const stream = (text: string, stop: string | null) => sse([
  { type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 1 } } },
  ...(text.match(/.{1,40}/gs) || []).map(part => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: part } })),
  ...(stop ? [{ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 400 } }, { type: 'message_stop' }] : []),
]);
const json = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

let drafts: (() => Response)[];
let draftLimits: number[];
beforeEach(() => {
  H.inserted.length = 0; drafts = []; draftLimits = [];
  for (const name of VARS) delete process.env[name];
  process.env.ANTHROPIC_API_KEY = 'placeholder-key-for-this-test';
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // The pauses between retries pass at once; every other timer is real.
  const real = globalThis.setTimeout;
  vi.stubGlobal('setTimeout', ((fn: any, ms?: number, ...rest: any[]) => real(fn, ms === 800 || ms === 1600 ? 1 : ms, ...rest)) as any);
  vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any = {}) => {
    const body = JSON.parse(init.body);
    // The streamed call is the article itself; each attempt takes the next scripted answer (the last one repeats).
    if (body.stream) { draftLimits.push(body.max_tokens); return (drafts.length > 1 ? drafts.shift()! : drafts[0])(); }
    // Research has no search here and fails at once; the draft goes on with the site's own sources.
    if (body.tools) return json({ type: 'error', error: { type: 'invalid_request_error', message: 'web search is not available in this test' } }, 400);
    return json({ content: [{ type: 'text', text: JSON.stringify({ seoTitle: 'Reading tenant reviews', meta: 'How to read tenant reviews for patterns.', alt: 'A person reading reviews on a laptop.' }) }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 30 } });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const name of VARS) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
});

const profile = {
  domain: 'rentals.example.test', business: { name: 'Example Rentals', description: 'Rental listings', industry: 'Property', positioning: 'Plain advice', offerings: ['Listings'], differentiators: ['Verified reviews'] },
  audience: { segments: ['Tenants'], buyers: ['Tenants'], needs: ['Honest reviews'], competitors: [] }, brand: { voice: 'Plain', language: 'English', markets: ['AE'] }, keywords: { list: [] },
} as unknown as Profile;
const entry = { id: 'e_test01', title: 'How to read tenant reviews', kw: 'tenant reviews', type: 'guide', audience: 'Tenants', relevance: 'Read reviews for patterns', mode: 'new', url: null } as unknown as CalendarEntry;
async function draftIt() {
  const { draftArticle } = await import('./draft');
  const progress = vi.fn(async (_update: any) => {});
  const article = draftArticle({ businessId: 'biz', progress } as any, entry, null, profile, false, 'Example Rentals');
  return { article, progress };
}
const textOf = (body: Block[]) => body.map(block => (Array.isArray(block[1]) ? block[1].join(' ') : block[1])).join('\n');
const draftRows = () => H.inserted.filter(row => row.purpose === 'article.draft').map(row => [row.ok, row.error ?? null]);

describe('an article draft whose answer is cut off', () => {
  it('stopped at the output limit: the partial text is discarded and the saved draft is the complete retry', async () => {
    drafts = [() => stream(PARTIAL, 'max_tokens'), () => stream(WHOLE, 'end_turn')];
    const { article, progress } = await draftIt();
    const saved = await article;
    expect(saved.generated).toBe(true);
    expect(saved.body).toEqual([['p', INTRO], ['h2', 'What a reply tells you'], ['p', LAST]]);
    // Two attempts, the second with twice the room; the first is on record as cut off, not as an answer.
    expect(draftLimits).toHaveLength(2);
    expect(draftLimits[1]).toBe(2 * draftLimits[0]);
    expect(draftRows()).toEqual([[false, `Answer cut off at the ${draftLimits[0]}-token output limit (Anthropic)`], [true, null]]);
    // The editor was told to clear what the first attempt had shown before the second began.
    const updates = progress.mock.calls.map(call => call[0]);
    const shownPartial = updates.findIndex(update => update.partial?.endsWith('specifically to a') || textOf(update.blocks || []).endsWith('specifically to a'));
    const cleared = updates.findIndex((update, index) => index > shownPartial && update.stage === 'writing' && update.partial === '' && update.blocks?.length === 0);
    expect(shownPartial).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(shownPartial);
  });

  it('closed with no stop reason: also retried, and the partial text is not saved', async () => {
    drafts = [() => stream(PARTIAL, null), () => stream(WHOLE, 'end_turn')];
    const saved = await (await draftIt()).article;
    expect(textOf(saved.body).endsWith(LAST)).toBe(true);
    expect(draftLimits).toHaveLength(2);
    expect(draftLimits[1]).toBe(draftLimits[0]);
    expect(draftRows()).toEqual([[false, 'Anthropic stream ended before the answer finished'], [true, null]]);
  });

  it('cut off on every attempt: drafting fails and no article is returned', async () => {
    drafts = [() => stream(PARTIAL, 'max_tokens')];
    const { article } = await draftIt();
    await expect(article).rejects.toMatchObject({ code: 'ai_failed' });
    expect(draftLimits.length).toBeGreaterThanOrEqual(3);
    expect(draftRows().every(([ok, error]) => ok === false && /^Answer cut off at the \d+-token output limit \(Anthropic\)$/.test(String(error)))).toBe(true);
  });
});
