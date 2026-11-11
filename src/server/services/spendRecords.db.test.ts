// The new spend records against the real ai_calls table: AI Visibility, images and Perplexity Search rows are written
// with the existing columns (no migration), and a real pack of three platforms is one image row. Providers are mocked
// at fetch; the writing model and object storage are mocked; the database is real.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';

const M = vi.hoisted(() => ({ put: vi.fn(async (key: string, _body: Buffer) => `/api/files/${key}`) }));
vi.mock('./storage', async original => ({ ...(await original<typeof import('./storage')>()), putObject: M.put }));
vi.mock('@/server/ai', () => ({ ai: { run: async (_task: string, input: any) => ({ json: { text: `Docs drift when nobody owns them. Give each page an owner. (${input.stubContext.platform})` } }) }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
import { db, schema } from '../db';
import { env } from '../env';
import { Fixtures } from '../testing/fixtures';
import { askEngine } from './visibility/engines';
import { generatePhoto } from './images';
import { searchSource } from './brief/sources/search';
import { createPack, getPack } from './social/generate';
import { IMG_SIZES } from '@/lib/constants';
import type { StoredPack } from './social/generate';

const F = new Fixtures(); const C = schema.aiCalls;
const savedEnv = { ...env };
const bids: string[] = [];
const profile = { domain: 'fieldnote.test', business: { name: 'Fieldnote', description: 'Documentation tools' }, brand: { voice: 'Clear', language: 'English (US)', primary: '#112233', secondary: '#445566' }, audience: { competitors: [] }, keywords: { list: [] } };
async function business() { const b = await F.biz(await F.user(), { profile }); bids.push(b.id); return b; }
/** recordAiCall does not wait for its insert, so read once the expected rows have landed. */
async function rowsFor(bid: string, n: number) {
  for (let i = 0; i < 100; i++) {
    const rows = await db.select().from(C).where(eq(C.businessId, bid)).orderBy(asc(C.createdAt), asc(C.task));
    if (rows.length >= n) return rows;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`fewer than ${n} ai_calls rows for ${bid}`);
}
const json = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const png = (() => { const c = createCanvas(96, 64); const x = c.getContext('2d'); x.fillStyle = '#12ab34'; x.fillRect(0, 0, 96, 64); return c.toBuffer('image/png').toString('base64'); })();
const imageUrls: string[] = [];
function providers() {
  imageUrls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/images')) { imageUrls.push(u); return json({ data: [{ b64_json: png }] }); }
    if (u.includes('api.anthropic.com')) return json({ content: [{ type: 'text', text: 'Fieldnote is one option.', citations: [{ url: 'https://a.example' }] }], usage: { input_tokens: 2000, output_tokens: 300, server_tool_use: { web_search_requests: 3 } } });
    if (u.includes('api.perplexity.ai/search')) return json({ results: [] });
    return json({ error: { message: 'overloaded' } }, 529);
  }));
}

describe.skipIf(!process.env.DATABASE_URL)('spend records in the real ai_calls table (providers mocked)', () => {
  beforeEach(() => {
    Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: 'test-oa-key-0123', anthropicKey: 'test-an-key-0123', xaiKey: 'test-xa-key-0123', perplexityKey: 'test-pp-key-0123', geminiKey: '' });
    delete process.env.RADAR_SOCIAL_PACK_IMAGE; M.put.mockClear(); providers();
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { Object.assign(env, savedEnv); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(async () => { for (const bid of bids) await db.delete(C).where(eq(C.businessId, bid)); await F.cleanup(); });

  it('a visibility answer, a failed engine request, an image and a search each land as one row for the business', async () => {
    const b = await business(); const ctx = { stub: { bid: b.id, profile, pages: [], manual: false } };
    await askEngine('Claude', 'Which tool keeps docs current?', ctx);
    await expect(askEngine('ChatGPT', 'Which tool keeps docs current?', ctx)).rejects.toThrow(/HTTP 529/);
    env.openaiKey = ''; // the image goes to xAI
    await generatePhoto({ bid: b.id, kind: 'hero', style: 'illustration', brand: profile.brand, headline: 'Keeping docs current', name: 'Fieldnote', seed: 3, w: 1200, h: 628 });
    await searchSource('reddit')({ bid: b.id, plan: { queries: ['docs tooling'] }, round: 0, onRead: () => {}, setSub: () => {} } as any);
    const rows = await rowsFor(b.id, 4);
    expect(rows.map(r => ({ task: r.task, purpose: r.purpose, model: r.model, provider: r.provider, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, ok: r.ok })).sort((x, y) => x.provider.localeCompare(y.provider))).toEqual([
      { task: 'visibility', purpose: 'visibility.collect', model: env.visClaudeModel, provider: 'Anthropic', inputTokens: 2000, outputTokens: 300, costUsd: expect.closeTo(0.037, 10), ok: true },
      { task: 'visibility', purpose: 'visibility.collect', model: env.visChatgptModel, provider: 'OpenAI', inputTokens: null, outputTokens: null, costUsd: null, ok: false },
      { task: 'search', purpose: 'brief.search', model: 'perplexity-search', provider: 'Perplexity', inputTokens: null, outputTokens: null, costUsd: 0.005, ok: true },
      { task: 'image', purpose: 'image.hero', model: 'grok-imagine-image', provider: 'SpaceX', inputTokens: null, outputTokens: null, costUsd: 0.02, ok: true },
    ]);
    expect(rows.find(r => r.provider === 'OpenAI')!.error).toMatch(/^HTTP 529/);
    expect(rows.every(r => typeof r.latencyMs === 'number' && r.latencyMs >= 0)).toBe(true);
  });

  it('a saved pack of three platforms is one generation and one image row, with a file per platform', async () => {
    const b = await business(); env.openaiKey = '';
    const id = await createPack(b.id, { source: { kind: 'idea', label: 'Keeping docs current' }, platforms: ['linkedin', 'x', 'reddit'], style: 'illustration' });
    expect(imageUrls).toHaveLength(1);
    const pack = await getPack(b.id, id) as StoredPack;
    expect(M.put).toHaveBeenCalledTimes(3);
    (['linkedin', 'x', 'reddit'] as const).forEach((k, i) => {
      const post = pack.posts[k]!;
      expect(post).toMatchObject({ style: 'illustration', imageUrl: `/api/files/${M.put.mock.calls[i][0]}`, imageMeta: { bytes: M.put.mock.calls[i][1].length, type: 'image/png' }, photo: true });
      expect([M.put.mock.calls[i][1].readUInt32BE(16), M.put.mock.calls[i][1].readUInt32BE(20)]).toEqual(IMG_SIZES[k]); // PNG IHDR width, height
    });
    const rows = await rowsFor(b.id, 1);
    await new Promise(r => setTimeout(r, 100)); // any further row would have landed by now
    expect((await db.select().from(C).where(eq(C.businessId, b.id))).length).toBe(1);
    expect(rows[0]).toMatchObject({ task: 'image', purpose: 'image.social', model: 'grok-imagine-image', provider: 'SpaceX', costUsd: 0.02, ok: true });
  });
});
