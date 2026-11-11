// Perplexity Search spend records (LG-3, LG-5): one ai_calls row per HTTP request, so a retried request writes its own.
// fetch is mocked (Perplexity is never called); the db mock captures the rows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ inserted: [] as any[], values: (_row: any): any => Promise.resolve() }));
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: (row: any) => { H.inserted.push(row); return H.values(row); } }) }, schema: { aiCalls: {} } }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));
import { env } from '@/server/env';
import { searchSource } from './search';
import { SourceError } from './types';

const KEY = 'pplx-searchrecords0123456789';
const savedKey = env.perplexityKey;
let bodies: any[] = [];
function mockFetch(...answers: Array<() => Response | Promise<Response>>) {
  bodies = []; let n = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: any, init: any) => { bodies.push(JSON.parse(init.body)); return answers[Math.min(n++, answers.length - 1)](); }));
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const THREAD = { url: 'https://www.reddit.com/r/smallbusiness/comments/abc123/how_do_you_invoice/', title: 'How do you invoice clients? : r/smallbusiness', snippet: 'Looking for a simple tool.', date: '2026-11-08' };
const hits = () => json({ results: [[THREAD], []] });
const QUERIES = ['invoicing for freelancers', 'late payment reminders'];
const ctx = () => ({ bid: 'biz-1', plan: { queries: QUERIES }, round: 0, onRead: vi.fn(), setSub: vi.fn() }) as any;
const ROW = { businessId: 'biz-1', task: 'search', purpose: 'brief.search', model: 'perplexity-search', provider: 'Perplexity' };
const realSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  H.inserted.length = 0; H.values = () => Promise.resolve(); env.perplexityKey = KEY;
  // withRetry waits 700 ms × attempt between tries: run that instantly, leave the request timeout alone.
  vi.stubGlobal('setTimeout', ((fn: any, ms?: number, ...a: any[]) => realSetTimeout(fn, ms === 700 || ms === 1400 ? 0 : ms, ...a)) as any);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); env.perplexityKey = savedKey; });

describe('Perplexity Search rows', () => {
  it('one request, one row at $0.005, however many queries the request carries', async () => {
    mockFetch(hits);
    const found = await searchSource('reddit')(ctx());
    expect(found.map(c => c.url)).toEqual([THREAD.url]);
    expect(bodies).toHaveLength(1); expect(bodies[0].query).toEqual(QUERIES);
    expect(H.inserted).toEqual([{ ...ROW, latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: 0.005, ok: true, error: null }]);
  });
  it('a failed request that is retried and then answered writes two rows, the first with no cost', async () => {
    mockFetch(() => json({ error: 'busy' }, 503), hits);
    const found = await searchSource('reddit')(ctx());
    expect(found).toHaveLength(1);
    expect(bodies).toHaveLength(2);
    expect(H.inserted).toEqual([
      { ...ROW, latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: null, ok: false, error: expect.stringMatching(/^HTTP 503/) },
      { ...ROW, latencyMs: expect.any(Number), inputTokens: null, outputTokens: null, costUsd: 0.005, ok: true, error: null },
    ]);
  });
  it('both tries failing writes two failed rows and the source still fails as before', async () => {
    mockFetch(() => json({ error: 'busy' }, 503));
    await expect(searchSource('linkedin')(ctx())).rejects.toBeInstanceOf(SourceError);
    expect(bodies).toHaveLength(2);
    expect(H.inserted.map(r => [r.ok, r.costUsd])).toEqual([[false, null], [false, null]]);
  });
  it('a request that is not retried (bad key) writes exactly one row', async () => {
    mockFetch(() => json({ error: { message: `Invalid API key ${KEY}` } }, 401));
    await expect(searchSource('x')(ctx())).rejects.toBeInstanceOf(SourceError);
    expect(bodies).toHaveLength(1);
    expect(H.inserted).toHaveLength(1);
    expect(H.inserted[0]).toMatchObject({ ...ROW, ok: false, costUsd: null });
    expect(H.inserted[0].error).toContain('[redacted]'); expect(H.inserted[0].error).not.toContain(KEY);
  });
  it('no request (a platform with no search domain, or no queries), no row', async () => {
    mockFetch(hits);
    expect(await searchSource('hn')(ctx())).toEqual([]);
    expect(await searchSource('reddit')({ ...ctx(), plan: { queries: [] } })).toEqual([]);
    expect(bodies).toHaveLength(0); expect(H.inserted).toHaveLength(0);
  });
  it('an insert that rejects, and one that throws, do not fail the search; rows hold no query or result text', async () => {
    mockFetch(hits);
    H.values = () => Promise.reject(new Error('db down'));
    expect(await searchSource('reddit')(ctx())).toHaveLength(1);
    H.values = () => { throw new Error('db exploded'); };
    expect(await searchSource('reddit')(ctx())).toHaveLength(1);
    await new Promise(r => realSetTimeout(r, 0)); // a swallowed rejection would surface here as an unhandled rejection
    expect(H.inserted).toHaveLength(2);
    const blob = JSON.stringify(H.inserted);
    for (const text of [...QUERIES, THREAD.title, THREAD.snippet, KEY]) expect(blob).not.toContain(text);
  });
});
