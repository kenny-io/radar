// T4 QA: the whole article-image pipeline against real Postgres with the REAL image service. Only the network and the
// file store are replaced: `fetch` is a fake image provider (OpenAI Images shape) and putObject returns a path.
// The text model is the dev stub adapter through the real ai.run; QA overrides the `article.imageDirections` stub with a
// model-like answer about a named building. NO REAL PROVIDER IS CALLED ANYWHERE IN THIS FILE.
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/radar_qa_tests npx vitest run --config .factory/contextual-article-images/qa/vitest.config.ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  return { jar: new Map<string, string>(), model: true, provider: 'ok' as 'ok' | '503' | '402', requests: [] as { url: string; prompt: string }[], put: [] as string[], published: [] as any[], directionCalls: [] as { title: string; prompt: string }[], answer: null as null | ((ctx: any) => any) };
});
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string) => { M.put.push(key); return `/api/files/${key}`; } }));
// The real image service. While a request runs, the environment looks like production with one image key, so the real
// provider loop, placeholder logic and ai_calls rows are exercised; the key is a dummy and fetch is faked below.
vi.mock('@/server/services/images', async original => {
  const real = await original<typeof import('@/server/services/images')>();
  const { env } = await import('@/server/env');
  const withModel = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (!M.model) return fn();
    const before = { devStubs: env.devStubs, openaiKey: env.openaiKey, openrouterKey: env.openrouterKey, xaiKey: env.xaiKey };
    Object.assign(env, { devStubs: false, openaiKey: 'qa-dummy-not-a-key', openrouterKey: '', xaiKey: '' });
    try { return await fn(); } finally { Object.assign(env, before); }
  };
  return { ...real, renderImageFile: (r: any, from?: any) => withModel(() => real.renderImageFile(r, from)), renderImage: (r: any) => withModel(() => real.renderImage(r)), defaultArticleImageStyle: () => (M.model ? 'illustration' : 'branded') };
});
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));
vi.mock('@/server/services/publishing/connectors', () => ({ connectorFor: () => ({ createDraft: async (_c: any, payload: any) => { M.published.push(payload); return { id: 'qa-remote' }; }, publish: async () => ({ url: 'https://lived.test/post' }) }) }));

import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, gte } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import { db, pool, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { actions } from '@/server/actions/article';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { buildPayload, publishEntry } from '@/server/services/publishing/publisher';
import { defaultArticle } from '@/features/article/blocks';
import { entryFromRow } from '@/server/workspace';
import { defaultCoverDirection, planArticleBodyImages } from '@/lib/articleImages';
import type { Article, Profile } from '@/lib/types';
import { startBodyImages } from '@/server/services/drafting/bodyImages';
import { startDraft } from '@/server/services/drafting/start';
import '@/server/services/drafting/jobs';
import { registerStub } from '@/server/ai/adapters/stub';
import { imagePrompt } from '@/server/services/images';

const HAS_DB = !!process.env.DATABASE_URL;
const stubbed = ((globalThis as any).__radarStubs as Map<string, (input: any, ctx: any) => any>).get('article.imageDirections')!;
registerStub('article.imageDirections', (input, ctx) => { M.directionCalls.push({ title: ctx.title, prompt: String(input?.prompt || '') }); return M.answer ? M.answer(ctx) : stubbed(input, ctx); });

const png = (() => { const c = createCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64); return c.toBuffer('image/png').toString('base64'); })();
const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  if (!/api\.openai\.com\/v1\/images|openrouter\.ai|api\.x\.ai/.test(url)) throw new Error('QA: unexpected outbound request to ' + new URL(url).host);
  M.requests.push({ url, prompt: JSON.parse(init.body).prompt });
  if (M.provider === '503') return new Response('provider down', { status: 503 });
  if (M.provider === '402') return new Response('{"error":{"message":"You have no credits remaining"}}', { status: 402 });
  return Response.json({ data: [{ b64_json: png }] });
}));
void realFetch;

const OUT = (process.env.QA_EVIDENCE_DIR || '.factory/contextual-article-images/qa/evidence') + '/pipeline.txt';
const lines: string[] = []; const log = (s: string) => lines.push(s);
const F = new Fixtures();
const profile: Profile = {
  domain: 'lived-qa.test', business: { name: 'Lived QA', description: 'Tenant reviews of residential buildings', offerings: ['Reviews'], industry: 'Property reviews', positioning: '', differentiators: ['Verified tenants'] },
  audience: { segments: ['Tenants'], buyers: ['Tenants'], needs: ['Honest reviews'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#0B5FFF', secondary: '#FFB000', voice: 'Plain', language: 'English', markets: ['United Arab Emirates'] },
} as any;
const TITLE = 'Wasl 611 Reviews: Tenant Ratings and What to Check First'; const KW = 'wasl 611 reviews';
const COVER = 'The exterior of Wasl 611, a gated staff accommodation community, seen from outside the entrance gate in daylight.';
const SCENES = ['A furnished bedroom with two single beds and a wardrobe, seen from the doorway.', 'A staff bus waiting beside a main gate in the early morning, with workers boarding.', 'A shared kitchen with long counters and cooking hobs, seen from one end of the room.'];
const modelAnswer = (ctx: any) => ({ subject: 'Wasl 611', subjectKind: 'building', cover: { direction: COVER, alt: 'Illustration of Wasl 611 seen from its entrance gate' }, sections: ctx.plans.map((p: any, i: number) => ({ i, direction: SCENES[i], alt: `Illustration of ${String(p.heading || 'the section').replace(/[.!?]+$/, '')}` })) });
const legacyBody: Article['body'] = [['p', 'Wasl 611 is a gated staff accommodation community in Al Warsan, Dubai.'], ['h2', 'What tenants say about the rooms'], ['p', 'Rooms are furnished with two single beds and a wardrobe.'], ['h2', 'Getting to work'], ['p', 'A staff bus leaves from the main gate each morning.'], ['h2', 'What to check before you sign'], ['p', 'Visit the shared kitchen and the laundry room in person.']];

let seq = 0;
async function fixture(o: { status?: string; data?: (bid: string, base: Article) => Article } = {}) {
  const user = await F.user(); const biz = await F.biz(user, { profile, domain: `lived-qa-${F.tag}-${++seq}.test` });
  const id = `e_qa_${F.tag}_${seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: TITLE, kw: KW, type: 'Guide', date: '2026-11-20', status: o.status || 'approved' }).returning();
  const base = defaultArticle(entryFromRow(entry));
  const a = o.data ? o.data(biz.id, base) : base;
  await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  return { user, biz, entry, a, id, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
const article = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0].data as Article;
const entry = async (id: string) => (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, id)))[0];
const draft = async (bid: string, id: string) => { const job = await startDraft(bid, id, 'user'); await runJobNow(job); return (await getJob(job))!; };
const act = async (bid: string, action: string, input: any) => { const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input }) }), { params: Promise.resolve({ bid }) }); let body: any = null; try { body = await r.json(); } catch { /* empty */ } return { status: r.status, body }; };
const calls = async (bid: string, since: Date) => { await new Promise(r => setTimeout(r, 400)); return (await db.select().from(schema.aiCalls).where(and(eq(schema.aiCalls.businessId, bid), gte(schema.aiCalls.createdAt, since)))).map(r => ({ task: r.task, purpose: r.purpose, provider: r.provider, model: r.model, ok: r.ok })); };
const quiet = () => [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];

beforeEach(() => { M.jar.clear(); M.model = true; M.provider = 'ok'; M.requests = []; M.put = []; M.published = []; M.directionCalls = []; M.answer = modelAnswer; });
afterAll(async () => {
  fs.mkdirSync('.factory/contextual-article-images/qa/evidence', { recursive: true }); fs.writeFileSync(OUT, lines.join('\n') + '\n');
  if (!HAS_DB) return;
  for (let attempt = 1; ; attempt++) { try { await F.cleanup(); break; } catch (e) { if (attempt >= 4) throw e; await new Promise(r => setTimeout(r, 300)); } }
  await pool.end();
});

describe.skipIf(!HAS_DB)('contextual article images, end to end with a faked image provider', () => {
  it('AC1 AC2 AC3 AC10: a new draft about a named building saves a direction naming it, literal requests, distinct body pictures, and its ai_calls rows', async () => {
    const since = new Date(Date.now() - 1000); const f = await fixture();
    expect(f.a.img.prompt).toBe(defaultCoverDirection(KW));
    const job = await draft(f.biz.id, f.id);
    const a = await article(f.id);
    log('## 1. New draft, image model answers (faked provider)');
    log(`job: ${job.status}; entry: ${(await entry(f.id)).status}`);
    log('img: ' + JSON.stringify(a.img)); log('imageDirections: ' + JSON.stringify(a.imageDirections));
    log('bodyImages: ' + JSON.stringify(a.bodyImages)); log('bodyImagesIssue: ' + JSON.stringify(a.bodyImagesIssue ?? null));
    M.requests.forEach((r, i) => log(`provider request ${i}: ${r.prompt}`));
    expect(job.status).toBe('done'); expect((await entry(f.id)).status).toBe('review');
    expect(a.img.prompt).toBe(COVER); expect(a.img.prompt).not.toMatch(/^Calm, editorial image about/);
    expect(a.img).toMatchObject({ style: 'illustration', promptBy: 'radar', alt: 'Illustration of Wasl 611 seen from its entrance gate', urlKey: 'illustration:1' });
    expect('placeholder' in a.img).toBe(false);
    expect(a.imageDirections).toMatchObject({ source: 'ai', subject: { name: 'Wasl 611', kind: 'building' } });
    const plans = planArticleBodyImages(a.body, a.brief.words);
    expect(a.bodyImages).toHaveLength(plans.length); expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(new Set([a.img.prompt, ...a.bodyImages!.map(i => i.prompt)]).size).toBe(plans.length + 1);
    expect(a.bodyImages!.map(i => i.prompt)).toEqual(SCENES.slice(0, plans.length));
    expect(a.bodyImages!.every(i => /^Illustration of /.test(i.alt))).toBe(true);
    expect('bodyImagesIssue' in a).toBe(false);
    expect(M.requests).toHaveLength(plans.length + 1);
    expect(M.requests[0].prompt).toBe(imagePrompt({ style: 'illustration', prompt: COVER, headline: TITLE, name: 'Lived QA', brand: profile.brand, seed: 1, kind: 'hero', literal: true }));
    expect(M.requests.every(r => r.prompt.includes('Show exactly this scene: ') && r.prompt.includes('Do not replace it with a visual metaphor'))).toBe(true);
    expect(M.requests.some(r => /visual metaphor specific|Calm, editorial image/.test(r.prompt))).toBe(false);
    const rows = await calls(f.biz.id, since);
    log('ai_calls: ' + JSON.stringify(rows));
    expect(rows.filter(r => r.purpose === 'article.imageDirections')).toEqual([expect.objectContaining({ task: 'utility', ok: true })]);
    expect(rows.filter(r => r.purpose === 'image.hero')).toHaveLength(1);
    expect(rows.filter(r => r.purpose === 'image.article-body')).toHaveLength(plans.length);
    expect(M.directionCalls).toHaveLength(1);
    expect(M.directionCalls[0].prompt).toContain(TITLE); expect(M.directionCalls[0].prompt).not.toContain('The owner has chosen this cover');
  });

  it('AC3: one unusable slot in the model answer is replaced on its own; the rest of the answer is kept', async () => {
    M.answer = ctx => { const out = modelAnswer(ctx); out.sections[0].direction = 'A bar chart of tenant ratings with a caption underneath.'; return out; };
    const f = await fixture(); await draft(f.biz.id, f.id); const a = await article(f.id);
    log('\n## 2. One bad slot'); log('section prompts: ' + JSON.stringify(a.bodyImages!.map(i => i.prompt)));
    expect(a.img.prompt).toBe(COVER);
    expect(a.bodyImages![0].prompt).toMatch(/^A literal, realistic scene showing /); expect(a.bodyImages![0].prompt).toContain(TITLE.replace(/[.!?]+$/, ''));
    expect(a.bodyImages![1].prompt).toBe(SCENES[1]); expect(a.imageDirections!.source).toBe('ai');
  });

  it('AC4: the direction step failing or answering rubbish never fails the draft', async () => {
    const q = quiet(); log('\n## 3. Direction step fails');
    for (const [name, answer] of [['throws', () => { throw new Error('model down'); }], ['returns an object of the wrong shape', () => ({ nonsense: true })], ['returns every slot unusable', (ctx: any) => ({ subject: 'Elsewhere Tower', subjectKind: 'building', cover: { direction: 'A logo.', alt: '' }, sections: ctx.plans.map((_p: any, i: number) => ({ i, direction: 'An abstract metaphor for housing.', alt: '' })) })]] as [string, (ctx: any) => any][]) {
      M.answer = answer; const f = await fixture(); const job = await draft(f.biz.id, f.id); const a = await article(f.id);
      log(`${name}: job=${job.status}, entry=${(await entry(f.id)).status}, source=${a.imageDirections?.source}, subject=${JSON.stringify(a.imageDirections?.subject)}, cover=${a.img.prompt}`);
      expect(job.status, name).toBe('done'); expect((await entry(f.id)).status, name).toBe('review');
      expect(a.imageDirections!.source, name).toBe('fallback'); expect(a.imageDirections!.subject, name).toBeNull();
      expect(a.img.prompt, name).toMatch(/^A literal, realistic scene showing the subject of an article titled Wasl 611 Reviews/);
      expect(a.img.promptBy).toBe('radar'); expect(a.bodyImages!.length).toBeGreaterThanOrEqual(2);
    }
    q.forEach(s => s.mockRestore());
  });

  it('AC5 (check 4): a direction the owner types is theirs, survives a rewrite unchanged, guides body images, and reaches the model as written', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); let a = await article(f.id);
    await F.signIn(f.user, M.jar);
    const OWN = 'A watercolour of the Al Warsan skyline at dusk, seen from a rooftop';
    const saved = await act(f.biz.id, 'article.save', { entryId: f.id, patch: { img: { style: a.img.style, prompt: OWN, alt: a.img.alt } } });
    expect(saved.status).toBe(200);
    a = await article(f.id); log('\n## 4. Owner-typed direction'); log('after typing: ' + JSON.stringify(a.img));
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner' }); expect(a.img.altBy).toBeUndefined();
    const coverUrl = a.img.url;
    M.requests = []; M.directionCalls = [];
    const job = await draft(f.biz.id, f.id); a = await article(f.id);
    log(`after "Rewrite from brief": job=${job.status}; img=${JSON.stringify(a.img)}`);
    M.requests.forEach((r, i) => log(`provider request ${i}: ${r.prompt}`));
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner', url: coverUrl });
    expect(M.directionCalls[0].prompt).toContain(`The owner has chosen this cover: ${OWN}. Do not change it.`);
    expect(M.requests.length).toBe(a.bodyImages!.length); // the cover was not rendered again
    expect(M.requests.every(r => r.prompt.includes(` Overall look the owner asked for: ${OWN}.`))).toBe(true);
    expect(a.bodyImages!.every(i => !i.prompt.includes(OWN))).toBe(true);
    // "Generate from prompt": the owner's words, in the wrapper every caller had before this change.
    M.requests = [];
    expect((await act(f.biz.id, 'article.regenerateImage', { entryId: f.id, prompt: OWN })).status).toBe(200);
    a = await article(f.id); log('after "Generate from prompt": ' + JSON.stringify(a.img)); log('provider request: ' + M.requests[0].prompt);
    expect(M.requests).toHaveLength(1);
    expect(M.requests[0].prompt).toBe(imagePrompt({ style: 'illustration', prompt: OWN, headline: TITLE, name: 'Lived QA', brand: profile.brand, seed: a.img.seed, kind: 'hero' }));
    expect(M.requests[0].prompt).toContain(`Subject: ${OWN}.`); expect(M.requests[0].prompt).not.toContain('Show exactly this scene');
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner', modelRequired: true });
    // Plain Regenerate afterwards: still the owner's words, no direction step.
    M.requests = []; M.directionCalls = [];
    expect((await act(f.biz.id, 'article.regenerateImage', { entryId: f.id })).status).toBe(200);
    expect(M.directionCalls).toEqual([]); expect(M.requests[0].prompt).toContain(`Subject: ${OWN}.`);
    expect((await article(f.id)).img).toMatchObject({ prompt: OWN, promptBy: 'owner' });
  });

  it('AC6 AC7 D7 D9: a failing provider gives a marked title-card cover and no body images; Regenerate is strict; a later success clears both', async () => {
    const q = quiet(); M.provider = '503'; const f = await fixture(); const job = await draft(f.biz.id, f.id); let a = await article(f.id);
    log('\n## 5. Provider answers 503 during a new draft'); log(`job=${job.status}; entry=${(await entry(f.id)).status}`); log('img: ' + JSON.stringify(a.img)); log('bodyImages: ' + JSON.stringify(a.bodyImages) + '; issue: ' + JSON.stringify(a.bodyImagesIssue)); log('stored objects: ' + JSON.stringify(M.put.map(k => k.split('/')[1])));
    expect(job.status).toBe('done'); expect((await entry(f.id)).status).toBe('review'); expect(a.generated).toBe(true);
    expect(a.img).toMatchObject({ style: 'illustration', prompt: COVER, promptBy: 'radar', placeholder: { reason: 'failed' } }); expect(a.img.url).toBeTruthy();
    expect(a.bodyImages).toEqual([]); expect(a.bodyImagesIssue).toMatchObject({ reason: 'failed' });
    expect(M.put.filter(k => k.includes('/article-body/'))).toEqual([]); // no template was stored for the body
    // Regenerate while the provider is still failing: an error, and the article is exactly as it was.
    await F.signIn(f.user, M.jar);
    const failed = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id });
    log('Regenerate while failing: ' + JSON.stringify(failed));
    expect(failed.status).toBeGreaterThanOrEqual(500); expect(await article(f.id)).toEqual(a);
    // Body-image job while failing: fails, nothing partial.
    const bj = await startBodyImages(f.biz.id, f.id); await db.update(schema.jobs).set({ attempts: 1, maxAttempts: 1 }).where(eq(schema.jobs.id, bj)); await runJobNow(bj);
    expect((await getJob(bj))!.status).toBe('failed'); expect((await article(f.id)).bodyImages).toEqual([]); expect((await article(f.id)).bodyImagesIssue).toMatchObject({ reason: 'failed' });
    // The provider recovers.
    M.provider = 'ok'; M.directionCalls = []; M.requests = [];
    const ok = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id }); expect(ok.status).toBe(200);
    a = await article(f.id); log('after a successful Regenerate: ' + JSON.stringify(a.img) + `; direction calls: ${M.directionCalls.length}`);
    expect('placeholder' in a.img).toBe(false); expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', seed: 2, urlKey: 'illustration:2' });
    expect(M.directionCalls).toEqual([]); // cached from the draft: no second text call
    expect(M.requests[0].prompt).toContain('Show exactly this scene: ' + COVER);
    const bj2 = await startBodyImages(f.biz.id, f.id); await runJobNow(bj2); a = await article(f.id);
    log('after a successful body-image job: ' + JSON.stringify(a.bodyImages!.map(i => i.prompt)) + '; issue present: ' + ('bodyImagesIssue' in a));
    expect((await getJob(bj2))!.status).toBe('done'); expect(a.bodyImages!.length).toBeGreaterThanOrEqual(2); expect('bodyImagesIssue' in a).toBe(false);
    expect(M.directionCalls).toEqual([]);
    q.forEach(s => s.mockRestore());
  });

  it('AC8 AC9: an article saved before this change gets a contextual direction on Regenerate and on the body-image job; a legacy typed direction is left alone', async () => {
    const legacy = (prompt: string) => (bid: string, base: Article): Article => ({ ...base, generated: true, body: legacyBody, img: { style: 'illustration', seed: 4, prompt, alt: 'Old alt', url: `/api/files/${bid}/hero/old.png`, urlKey: 'illustration:4' }, bodyImages: [{ id: 'old', after: { heading: 'getting to work', occurrence: 0, block: 3 }, url: `/api/files/${bid}/article-body/old.png`, alt: 'Old body alt', prompt: 'Create a useful editorial visual … Show a concrete visual metaphor', seed: 5 }], bodyImagesGeneratedAt: '2026-11-01T00:00:00.000Z' });
    const f = await fixture({ status: 'review', data: legacy(defaultCoverDirection(KW)) }); await F.signIn(f.user, M.jar);
    log('\n## 6. Legacy article'); log('stored before: ' + JSON.stringify(f.a.img));
    const got = await act(f.biz.id, 'article.get', { entryId: f.id }); expect(got.status).toBe(200);
    expect(got.body.article ?? got.body.result?.article ?? got.body).toBeTruthy();
    expect(await article(f.id)).toEqual(f.a); // opening it writes nothing
    expect((await act(f.biz.id, 'article.regenerateImage', { entryId: f.id })).status).toBe(200);
    let a = await article(f.id); log('after Regenerate: ' + JSON.stringify(a.img)); log('provider request: ' + M.requests[0].prompt);
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: 'Illustration of Wasl 611 seen from its entrance gate', seed: 5 }); expect(a.imageDirections!.source).toBe('ai');
    expect(a.bodyImages).toEqual(f.a.bodyImages); // the cover action never touches body images
    M.directionCalls = []; M.requests = [];
    const bj = await startBodyImages(f.biz.id, f.id); await runJobNow(bj); a = await article(f.id);
    log('after the body-image job: ' + JSON.stringify(a.bodyImages!.map(i => ({ prompt: i.prompt, alt: i.alt }))) + `; direction calls: ${M.directionCalls.length}`);
    expect(a.bodyImages!.map(i => i.prompt)).toEqual(SCENES.slice(0, a.bodyImages!.length)); expect(M.directionCalls).toEqual([]);
    expect(M.requests.every(r => !/visual metaphor specific/.test(r.prompt))).toBe(true);
    // A legacy article whose direction is not the creation default: a person typed it.
    const g = await fixture({ status: 'review', data: legacy('Calm, editorial image about wasl 611 reviews, at sunset') }); M.jar.clear(); await F.signIn(g.user, M.jar);
    M.directionCalls = []; M.requests = [];
    expect((await act(g.biz.id, 'article.regenerateImage', { entryId: g.id })).status).toBe(200);
    const b = await article(g.id); log('legacy typed direction after Regenerate: ' + JSON.stringify(b.img));
    expect(b.img.prompt).toBe('Calm, editorial image about wasl 611 reviews, at sunset'); expect(M.directionCalls).toEqual([]);
    expect(M.requests[0].prompt).toContain('Subject: Calm, editorial image about wasl 611 reviews, at sunset.');
  });

  it('check 5 (server side): what article.save stores when a tab sends back the old default direction with a changed alt', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const before = await article(f.id); await F.signIn(f.user, M.jar);
    const stale = { style: before.img.style, prompt: defaultCoverDirection(KW), alt: 'A new alt typed in a stale tab' };
    const r = await act(f.biz.id, 'article.save', { entryId: f.id, patch: { img: stale } });
    const after = await article(f.id);
    log('\n## 7. Stale tab sends the old default direction back'); log('before: ' + JSON.stringify(before.img)); log('patch:  ' + JSON.stringify(stale)); log(`reply ${r.status}; after: ` + JSON.stringify(after.img));
    M.directionCalls = []; M.requests = [];
    await draft(f.biz.id, f.id); const redrafted = await article(f.id);
    log('after a later rewrite: ' + JSON.stringify(redrafted.img)); log('body request 0: ' + (M.requests[0]?.prompt || ''));
    log(`=> the generic sentence is now treated as the owner's: promptBy=${redrafted.img.promptBy}, prompt=${redrafted.img.prompt}`);
    expect(r.status).toBe(200);
  });

  it('AC10 (check 3): tenant and role boundaries through the real action route; a client cannot set the new fields', async () => {
    const q = quiet(); M.provider = '503'; const f = await fixture(); await draft(f.biz.id, f.id); M.provider = 'ok';
    const before = await article(f.id); expect(before.img.placeholder).toBeTruthy(); expect(before.bodyImagesIssue).toBeTruthy();
    log('\n## 8. Boundaries');
    // A signed-in user who is not a member of the business.
    const outsider = await F.user(); await F.signIn(outsider, M.jar);
    for (const [action, input] of [['article.get', { entryId: f.id }], ['article.save', { entryId: f.id, patch: { img: { style: 'branded', prompt: 'x', alt: 'y' } } }], ['article.regenerateImage', { entryId: f.id }], ['article.regenerateBodyImages', { entryId: f.id }]] as [string, any][]) {
      const r = await act(f.biz.id, action, input); log(`outsider ${action}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      expect([401, 403, 404], action).toContain(r.status); expect(JSON.stringify(r.body)).not.toContain('Wasl 611, a gated');
    }
    // The owner of another business, through their own business id, naming this article.
    const other = await fixture(); M.jar.clear(); await F.signIn(other.user, M.jar);
    for (const [action, input] of [['article.get', { entryId: f.id }], ['article.save', { entryId: f.id, patch: { img: { style: 'branded', prompt: 'x', alt: 'y' } } }], ['article.regenerateImage', { entryId: f.id }], ['article.regenerateBodyImages', { entryId: f.id }]] as [string, any][]) {
      const r = await act(other.biz.id, action, input); log(`other business ${action}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
      expect(r.status, action).toBeGreaterThanOrEqual(400); expect(JSON.stringify(r.body)).not.toContain('Wasl 611, a gated');
    }
    expect(await article(f.id)).toEqual(before);
    // A Viewer of the business: reads the marks, changes nothing.
    const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer'); M.jar.clear(); await F.signIn(viewer, M.jar);
    const seen = await act(f.biz.id, 'article.get', { entryId: f.id }); log(`viewer article.get: ${seen.status}; sees placeholder: ${JSON.stringify(seen.body).includes('"placeholder"')}; sees bodyImagesIssue: ${JSON.stringify(seen.body).includes('"bodyImagesIssue"')}`);
    expect(seen.status).toBe(200); expect(JSON.stringify(seen.body)).toContain('"placeholder"');
    for (const [action, input] of [['article.save', { entryId: f.id, patch: { img: { style: 'branded', prompt: 'x', alt: 'y' } } }], ['article.regenerateImage', { entryId: f.id }], ['article.regenerateBodyImages', { entryId: f.id }], ['article.draft', { entryId: f.id }]] as [string, any][]) {
      const r = await act(f.biz.id, action, input); log(`viewer ${action}: ${r.status}`); expect(r.status, action).toBe(403);
    }
    expect(await article(f.id)).toEqual(before);
    // The owner, with forged fields in an autosave.
    M.jar.clear(); await F.signIn(f.user, M.jar);
    const forged = { style: before.img.style, prompt: before.img.prompt, alt: before.img.alt, promptBy: 'owner', altBy: 'owner', placeholder: null, url: 'https://evil.test/x.png', urlKey: 'illustration:1', modelRequired: true, seed: 99 };
    const r = await act(f.biz.id, 'article.save', { entryId: f.id, patch: { img: forged, imageDirections: { key: 'x', source: 'ai', subject: { name: 'Forged', kind: 'building' }, cover: { prompt: 'p', alt: 'a' }, sections: [], at: 'x' }, bodyImagesIssue: null, bodyImages: [{ id: 'x', after: { heading: 'h', occurrence: 0, block: 1 }, url: 'https://evil.test/b.png', alt: 'a', prompt: 'p', seed: 1 }] }, imageDirections: null, bodyImagesIssue: null });
    log(`owner autosave with forged fields: ${r.status}; article unchanged: ${isDeepStrictEqual(await article(f.id), before)}`);
    expect(r.status).toBe(200); expect(await article(f.id)).toEqual(before);
    // Locks: scheduled, publishing, published.
    for (const status of ['scheduled', 'publishing', 'published']) {
      await db.update(schema.calendarEntries).set({ status }).where(eq(schema.calendarEntries.id, f.id));
      for (const action of ['article.regenerateImage', 'article.regenerateBodyImages']) { const lr = await act(f.biz.id, action, { entryId: f.id }); log(`owner ${action} while ${status}: ${lr.status} ${lr.body?.code || lr.body?.error?.code || ''}`); expect(lr.status, `${action} ${status}`).toBeGreaterThanOrEqual(400); }
      const sr = await act(f.biz.id, 'article.save', { entryId: f.id, patch: { img: { style: 'branded', prompt: before.img.prompt, alt: before.img.alt } } }); log(`owner restyle while ${status}: ${sr.status}`); expect(sr.status).toBeGreaterThanOrEqual(400);
    }
    expect(await article(f.id)).toEqual(before); expect(M.requests.filter(x => x.prompt).length).toBeGreaterThan(0);
    q.forEach(s => s.mockRestore());
  });

  it('AC6 AC9 (checks 6, 7): publishing with a placeholder cover and no body images; a legacy article with body images publishes them', async () => {
    const q = quiet(); M.provider = '503'; const f = await fixture(); await draft(f.biz.id, f.id); M.provider = 'ok';
    const a = await article(f.id); expect(a.bodyImages).toEqual([]); expect(a.img.placeholder).toBeTruthy();
    await db.insert(schema.connections).values({ businessId: f.biz.id, type: 'wordpress', url: 'https://lived-qa.test', fields: {} });
    const payload = await buildPayload(f.biz, entryFromRow(await entry(f.id) as any), a);
    log('\n## 9. Publishing'); log(`placeholder cover, bodyImages []: html has figure=${/<figure/.test(payload.html)}, html has <img=${/<img/.test(payload.html)}, markdown has image=${/!\[/.test(payload.markdown)}, payload.bodyImages=${JSON.stringify(payload.bodyImages)}, cover=${payload.image?.url}`);
    expect(payload.html).not.toContain('radar-body-image'); expect(payload.html).not.toContain('<figure'); expect(payload.html).not.toContain('<img'); expect(payload.markdown).not.toContain('![');
    expect(payload.bodyImages).toEqual([]); expect(payload.image!.url).toContain(`/api/files/${f.biz.id}/hero/`);
    await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id));
    const outcome = await publishEntry(f.id, { attempt: 1, maxAttempts: 1 }); log('publishEntry: ' + JSON.stringify(outcome));
    expect(outcome).toMatchObject({ status: 'published' }); expect(M.published[0].html).not.toContain('<figure'); expect(M.published[0].markdown).not.toContain('![');
    expect((await article(f.id)).img.placeholder).toEqual(a.img.placeholder); // published as it is; the mark stays true
    // Legacy article with stored body images and none of the new fields.
    const g = await fixture({ status: 'review', data: (bid, base) => ({ ...base, generated: true, body: legacyBody, seo: { title: 'Legacy SEO', meta: 'Legacy meta', slug: 'legacy-slug' }, img: { style: 'branded', seed: 1, prompt: 'Custom cover', alt: 'Cover alt', url: `/api/files/${bid}/hero/cover.png`, urlKey: 'branded:1' }, bodyImages: [{ id: 'l1', after: { heading: 'what tenants say about the rooms', occurrence: 0, block: 1 }, url: `/api/files/${bid}/article-body/l1.png`, alt: 'Legacy body one', prompt: '', seed: 2 }, { id: 'l2', after: { heading: 'getting to work', occurrence: 0, block: 3 }, url: `/api/files/${bid}/article-body/l2.png`, alt: 'Legacy body two', prompt: '', seed: 3 }], bodyImagesGeneratedAt: '2026-11-01T00:00:00.000Z' }) });
    M.jar.clear(); await F.signIn(g.user, M.jar);
    expect((await act(g.biz.id, 'article.get', { entryId: g.id })).status).toBe(200);
    expect((await act(g.biz.id, 'article.save', { entryId: g.id, patch: { seo: { meta: 'Edited meta' } } })).status).toBe(200);
    expect((await act(g.biz.id, 'article.save', { entryId: g.id, patch: { img: { style: 'branded', prompt: 'Custom cover', alt: 'Cover alt' } } })).status).toBe(200);
    const saved = await article(g.id);
    expect(saved).toEqual({ ...g.a, seo: { ...g.a.seo, meta: 'Edited meta' } });
    const lp = await buildPayload(g.biz, entryFromRow(await entry(g.id) as any), saved);
    const figures = lp.html.match(/<figure class="radar-body-image">/g) || []; const mdImages = lp.markdown.match(/!\[Legacy body (one|two)\]\(/g) || [];
    log(`legacy with two body images: html figures=${figures.length}, markdown images=${mdImages.length}, keys added to the stored article=${JSON.stringify(Object.keys(saved).filter(k => !(k in g.a)))}, keys added to img=${JSON.stringify(Object.keys(saved.img).filter(k => !(k in g.a.img)))}`);
    log('legacy html excerpt: ' + lp.html.slice(lp.html.indexOf('<figure'), lp.html.indexOf('</figure>') + 9).replace(/https?:\/\/[^/]+/g, '<origin>'));
    expect(figures).toHaveLength(2); expect(mdImages).toHaveLength(2); expect(lp.image).toMatchObject({ alt: 'Cover alt' });
    q.forEach(s => s.mockRestore());
  });

  it('QA observations: an alt typed before this change, the alt after the owner replaces the direction, and a text call spent when no image model exists', async () => {
    const q = quiet(); log('\n## 11. Observations');
    // (a) Legacy article, model style, default direction, an alt a person typed before this change (no altBy exists for it).
    const f = await fixture({ status: 'review', data: (bid, base) => ({ ...base, generated: true, body: legacyBody, img: { style: 'illustration', seed: 4, prompt: defaultCoverDirection(KW), alt: 'Front gate of Wasl 611 at dusk, hand-written by the owner in October', url: `/api/files/${bid}/hero/old.png`, urlKey: 'illustration:4' } }) });
    await draft(f.biz.id, f.id); const a = await article(f.id);
    log('(a) legacy hand-written alt after "Rewrite from brief": ' + JSON.stringify(a.img.alt) + ' (was: "Front gate of Wasl 611 at dusk, hand-written by the owner in October")');
    // (b) No image model at all (stubs): Regenerate on a legacy model-style article.
    M.model = false; M.directionCalls = [];
    const g = await fixture({ status: 'review', data: (bid, base) => ({ ...base, generated: true, body: legacyBody, img: { style: 'illustration', seed: 4, prompt: defaultCoverDirection(KW), alt: '', url: `/api/files/${bid}/hero/old.png`, urlKey: 'illustration:4' } }) });
    await F.signIn(g.user, M.jar);
    const r1 = await act(g.biz.id, 'article.regenerateImage', { entryId: g.id }); const r2 = await act(g.biz.id, 'article.regenerateImage', { entryId: g.id });
    log(`(b) no image model: two Regenerate clicks -> ${r1.status} ${r1.body?.code}, ${r2.status} ${r2.body?.code}; direction text calls made and thrown away: ${M.directionCalls.length}; article unchanged: ${isDeepStrictEqual(await article(g.id), g.a)}`);
    const bj = await startBodyImages(g.biz.id, g.id); await runJobNow(bj); const first = (await getJob(bj))!.status; await runJobNow(bj);
    log(`(b) no image model: one "Add body images" click -> job ${first} after the first attempt, ${(await getJob(bj))!.status} after the second (the queue allows two); direction text calls in total now: ${M.directionCalls.length}`);
    q.forEach(s => s.mockRestore());
  });

  it('AC6 AC7: every image account blocked (402) gives the `unavailable` reason for the cover and the body images', async () => {
    const q = quiet(); M.provider = '402'; const f = await fixture(); const job = await draft(f.biz.id, f.id); const a = await article(f.id);
    log('\n## 10. Provider answers 402 (no credit), the outage in the brief'); log(`job=${job.status}; entry=${(await entry(f.id)).status}`); log('img: ' + JSON.stringify(a.img)); log('bodyImages: ' + JSON.stringify(a.bodyImages) + '; issue: ' + JSON.stringify(a.bodyImagesIssue));
    expect(job.status).toBe('done'); expect((await entry(f.id)).status).toBe('review');
    expect(a.img.placeholder).toMatchObject({ reason: 'unavailable' }); expect(a.bodyImages).toEqual([]); expect(a.bodyImagesIssue).toMatchObject({ reason: 'unavailable' });
    await F.signIn(f.user, M.jar);
    const r = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id }); log('Regenerate: ' + JSON.stringify(r));
    expect(r.status).toBe(503); expect(JSON.stringify(r.body)).toContain('image_unavailable'); expect(await article(f.id)).toEqual(a);
    q.forEach(s => s.mockRestore());
  });
});
