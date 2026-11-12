// T4b QA recheck of the fixes for D1, D2, D4 and O1 (revision 207ac9ab and later). Same harness as pipeline.db.qa.test.ts:
// real Postgres, the REAL image service with a faked provider (`fetch`) and a faked file store, the dev stub text
// adapter with a model-like `article.imageDirections` answer. NO REAL PROVIDER IS CALLED.
//   DATABASE_URL=postgres://postgres@127.0.0.1:55432/radar_qa_tests3 QA_EVIDENCE_DIR=.factory/contextual-article-images/qa/evidence/recheck \
//     npx vitest run --config .factory/contextual-article-images/qa/vitest.config.ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  return { jar: new Map<string, string>(), model: true, provider: 'ok' as 'ok' | '503', requests: [] as { url: string; prompt: string }[], put: [] as string[], directionCalls: [] as string[], answer: null as null | ((ctx: any) => any) };
});
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string) => { M.put.push(key); return `/api/files/${key}`; } }));
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

import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import { db, pool, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { getJob, runJobNow } from '@/server/jobs/queue';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { buildPayload } from '@/server/services/publishing/publisher';
import { defaultArticle } from '@/features/article/blocks';
import { articleSave, coverDirectionHint } from '@/features/article/autosave';
import { entryFromRow } from '@/server/workspace';
import { defaultCoverDirection, planArticleBodyImages } from '@/lib/articleImages';
import type { Article, Block, Profile } from '@/lib/types';
import { startBodyImages } from '@/server/services/drafting/bodyImages';
import { startDraft } from '@/server/services/drafting/start';
import '@/server/services/drafting/jobs';
import { registerStub } from '@/server/ai/adapters/stub';
import { cleanImageDirections } from '@/server/services/drafting/imageDirections';

const HAS_DB = !!process.env.DATABASE_URL;
const stubbed = ((globalThis as any).__radarStubs as Map<string, (input: any, ctx: any) => any>).get('article.imageDirections')!;
registerStub('article.imageDirections', (input, ctx) => { M.directionCalls.push(ctx.title); return M.answer ? M.answer(ctx) : stubbed(input, ctx); });
const png = (() => { const c = createCanvas(64, 64); c.getContext('2d').fillRect(0, 0, 64, 64); return c.toBuffer('image/png').toString('base64'); })();
vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  if (!/api\.openai\.com\/v1\/images/.test(url)) throw new Error('QA: unexpected outbound request to ' + new URL(url).host);
  M.requests.push({ url, prompt: JSON.parse(init.body).prompt });
  if (M.provider === '503') return new Response('provider down', { status: 503 });
  return Response.json({ data: [{ b64_json: png }] });
}));

const OUT = (process.env.QA_EVIDENCE_DIR || '.factory/contextual-article-images/qa/evidence/recheck') + '/recheck.txt';
const lines: string[] = []; const log = (s: string) => lines.push(s);
const F = new Fixtures();
const profile: Profile = {
  domain: 'lived-qa.test', business: { name: 'Lived QA', description: 'Tenant reviews of residential buildings', offerings: ['Reviews'], industry: 'Property reviews', positioning: '', differentiators: ['Verified tenants'] },
  audience: { segments: ['Tenants'], buyers: ['Tenants'], needs: ['Honest reviews'], competitors: [] }, keywords: { list: [] },
  brand: { logo: null, primary: '#0B5FFF', secondary: '#FFB000', voice: 'Plain', language: 'English', markets: ['United Arab Emirates'] },
} as any;
const TITLE = 'Wasl 611 Reviews: Tenant Ratings and What to Check First'; const KW = 'wasl 611 reviews'; const DEFAULT = defaultCoverDirection(KW);
const COVER = 'The exterior of Wasl 611, a gated staff accommodation community, seen from outside the entrance gate in daylight.';
const RADAR_ALT = 'Illustration of Wasl 611 seen from its entrance gate'; const NEUTRAL_ALT = `Illustration for ${TITLE}`;
const SCENES = ['A furnished bedroom with two single beds and a wardrobe, seen from the doorway.', 'A staff bus waiting beside a main gate in the early morning, with workers boarding.', 'A shared kitchen with long counters and cooking hobs, seen from one end of the room.'];
const modelAnswer = (ctx: any) => ({ subject: 'Wasl 611', subjectKind: 'building', cover: { direction: COVER, alt: RADAR_ALT }, sections: ctx.plans.map((p: any, i: number) => ({ i, direction: SCENES[i], alt: `Illustration of ${String(p.heading || 'the section').replace(/[.!?]+$/, '')}` })) });
const legacyBody: Article['body'] = [['p', 'Wasl 611 is a gated staff accommodation community in Al Warsan, Dubai.'], ['h2', 'What tenants say about the rooms'], ['p', 'Rooms are furnished with two single beds and a wardrobe.'], ['h2', 'Getting to work'], ['p', 'A staff bus leaves from the main gate each morning.'], ['h2', 'What to check before you sign'], ['p', 'Visit the shared kitchen and the laundry room in person.']];

let seq = 0;
async function fixture(o: { status?: string; data?: (bid: string, base: Article) => Article } = {}) {
  const user = await F.user(); const biz = await F.biz(user, { profile, domain: `lived-rq-${F.tag}-${++seq}.test` });
  const id = `e_rq_${F.tag}_${seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: TITLE, kw: KW, type: 'Guide', date: '2026-11-20', status: o.status || 'approved' }).returning();
  const base = defaultArticle(entryFromRow(entry)); const a = o.data ? o.data(biz.id, base) : base;
  await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  await F.signIn(user, M.jar);
  return { user, biz, entry, a, id };
}
const article = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0].data as Article;
const entry = async (id: string) => (await db.select().from(schema.calendarEntries).where(eq(schema.calendarEntries.id, id)))[0];
const draft = async (bid: string, id: string) => { const job = await startDraft(bid, id, 'user'); await runJobNow(job); return (await getJob(job))!; };
const act = async (bid: string, action: string, input: any) => { const r = await ACT(new Request('http://t/act', { method: 'POST', body: JSON.stringify({ action, input }) }), { params: Promise.resolve({ bid }) }); let body: any = null; try { body = await r.json(); } catch { /* empty */ } return { status: r.status, body }; };
const save = (f: { biz: { id: string }; id: string }, img: any) => act(f.biz.id, 'article.save', { entryId: f.id, patch: { img } });
const quiet = () => [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
const show = (img: Article['img']) => JSON.stringify({ style: img.style, seed: img.seed, prompt: img.prompt, promptBy: img.promptBy ?? null, alt: img.alt, altBy: img.altBy ?? null, urlKey: img.urlKey ?? null, placeholder: img.placeholder?.reason ?? null, modelRequired: img.modelRequired ?? null });

beforeEach(() => { M.jar.clear(); M.model = true; M.provider = 'ok'; M.requests = []; M.put = []; M.directionCalls = []; M.answer = modelAnswer; });
afterAll(async () => {
  fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(OUT, lines.join('\n') + '\n');
  if (!HAS_DB) return;
  for (let attempt = 1; ; attempt++) { try { await F.cleanup(); break; } catch (e) { if (attempt >= 4) throw e; await new Promise(r => setTimeout(r, 300)); } }
  await pool.end();
});

describe('what the workspace sends (D1a, O6), pure', () => {
  const cur = { body: [] as Block[], brief: { angle: '', outline: [], words: 1400 as const }, seo: { title: '', meta: '', slug: '' }, img: { style: 'branded' as const, seed: 1, prompt: DEFAULT, alt: 'typed alt', url: null }, videos: [] };
  it('an alt edit sends the alt alone; a direction edit sends the direction alone; their debounce keys differ', () => {
    const alt = articleSave('e1', cur, { img: { alt: 'typed alt' } }); const prompt = articleSave('e1', cur, { img: { prompt: DEFAULT } });
    log('## R0. Client patch'); log('alt edit: ' + JSON.stringify(alt)); log('direction edit: ' + JSON.stringify(prompt));
    expect(alt.patch).toEqual({ img: { alt: 'typed alt' } }); expect(prompt.patch).toEqual({ img: { prompt: DEFAULT } });
    expect(alt.key).not.toBe(prompt.key);
    expect(articleSave('e1', cur, { seo: cur.seo }).key).toBe('art:e1:seo'); expect(articleSave('e1', cur, { brief: cur.brief }).patch).toEqual({ brief: cur.brief });
    expect(articleSave('e1', cur, { videos: [] }).patch).toEqual({ videos: [] });
    // An edit that sets a field to an empty string is still that field's edit.
    expect(articleSave('e1', { ...cur, img: { ...cur.img, alt: '' } }, { img: { alt: '' } }).patch).toEqual({ img: { alt: '' } });
  });
  it('the hint says "when it drafts it" before the first draft only', () => {
    expect(coverDirectionHint(false)).toBe('Radar writes this from your article when it drafts it. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.');
    expect(coverDirectionHint(true)).toBe('Radar writes this from your article. Edit it to describe the cover you want: your wording is used as written and also guides body images. Generated pictures are illustrations and may differ from the real subject.');
  });
});

describe('O1: the accepted subject’s own name is not a reason to refuse a direction, pure', () => {
  const run = (title: string, lead: string, answer: { subject: string; kind?: string; cover: string; sections?: string[] }) => {
    const body: Block[] = [['p', lead], ['h2', 'Rooms'], ['p', 'Rooms are furnished and bright, with a balcony.'], ['h2', 'Transport'], ['p', 'A bus stop is outside the entrance.']];
    const plans = planArticleBodyImages(body, 900);
    const sections = answer.sections || ['A furnished bright room with a balcony door standing open.', 'A bus stop outside the entrance of a low-rise residential building.'];
    return cleanImageDirections({ subject: answer.subject, subjectKind: (answer.kind || 'building') as any, cover: { direction: answer.cover, alt: 'Illustration of ' + answer.subject }, sections: plans.map((p, i) => ({ i, direction: sections[i], alt: 'Illustration of ' + p.heading })) }, { title, body, plans });
  };
  it('named subjects that contain a refused word are kept; everything else is still refused', () => {
    log('\n## R-O1. Subject names and the wording check');
    const cases: [string, ReturnType<typeof run>, string | null][] = [
      ['Chart House named in the cover', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of Chart House, a low-rise residential building near the marina, seen from the street.' }), null],
      ['Chart House named in a section too', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of Chart House, a low-rise residential building near the marina, seen from the street.', sections: ['A furnished bright room inside Chart House with a balcony door standing open.', 'A bus stop outside the entrance of Chart House on a quiet road.'] }), null],
      ['The Abstract Hotel', run('The Abstract Hotel: A Stay Review', 'The Abstract Hotel is a boutique hotel beside the river.', { subject: 'The Abstract Hotel', cover: 'The entrance of The Abstract Hotel, a boutique hotel beside the river, seen from the pavement.' }), null],
      ['name in another case and with two spaces', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of CHART  HOUSE, a low-rise residential building near the marina, seen from the street.' }), null],
      ['name with regex characters', run('Logo (C++) Tower [East] Reviews', 'Logo (C++) Tower [East] is a residential high-rise near the marina.', { subject: 'Logo (C++) Tower [East]', cover: 'The exterior of Logo (C++) Tower [East], a residential high-rise near the marina, seen from the street.' }), null],
      ['Chart House plus a real chart', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'A bar chart of tenant ratings beside the exterior of Chart House near the marina.' }), 'asks for writing'],
      ['Chart House plus a caption', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of Chart House near the marina with a caption underneath naming the street.' }), 'asks for writing'],
      ['Chart House plus quoted wording', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of Chart House near the marina with a board showing “Flats to let” by the door.' }), 'asks for writing'],
      ['The Abstract Hotel as a metaphor', run('The Abstract Hotel: A Stay Review', 'The Abstract Hotel is a boutique hotel beside the river.', { subject: 'The Abstract Hotel', cover: 'A visual metaphor for rest: a key on a pillow in front of The Abstract Hotel by the river.' }), 'symbolic'],
      ['subject the article does not name gets no excuse', run('Marina Flats Reviews: What Tenants Say', 'Marina Flats is a low-rise residential building near the marina.', { subject: 'Chart House', cover: 'The exterior of Chart House, a low-rise residential building near the marina, seen from the street.' }), 'asks for writing'],
      ['subject with kind none gets no excuse', run('Chart House Reviews: What Tenants Say', 'Chart House is a low-rise residential building near the marina.', { subject: 'Chart House', kind: 'none', cover: 'The exterior of Chart House, a low-rise residential building near the marina, seen from the street.' }), 'asks for writing'],
      ['no subject: ordinary rejection holds', run('How Tenants Rate Their Flats', 'Tenants rate flats on light, noise and transport.', { subject: '', kind: 'none', cover: 'An infographic of tenant ratings for light, noise and transport in a block of flats.' }), 'asks for writing'],
    ];
    for (const [name, out, want] of cases) {
      const why = out.replaced.find(r => r.slot === 'cover')?.why ?? null;
      log(`${name}: cover ${why ? 'REFUSED (' + why + ')' : 'kept'}; sections refused: ${out.replaced.filter(r => r.slot !== 'cover').length}; subject: ${JSON.stringify(out.subject?.name ?? null)}`);
      expect(why, name).toBe(want);
    }
    expect(cases[1][1].replaced).toEqual([]);
  });
  it('QA probe: a common noun given as the "subject" switches the check off for that word', () => {
    const out = run('10 Charts Every Landlord Needs', 'A chart can show a landlord where the rent goes each month.', { subject: 'chart', kind: 'other', cover: 'A bar chart of monthly rent pinned to an office wall beside a desk and a lamp.' });
    log(`common noun as subject ("chart", kind other, article about charts): cover ${out.replaced.some(r => r.slot === 'cover') ? 'refused' : 'KEPT'} -> ${out.cover.prompt}`);
  });
});

describe.skipIf(!HAS_DB)('recheck against the database with a faked image provider', () => {
  it('D1b: an old bundle’s save (style, the default direction and a new alt together) keeps Radar’s direction', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const before = await article(f.id);
    expect(before.img).toMatchObject({ prompt: COVER, promptBy: 'radar', style: 'illustration' });
    log('\n## R1. Old bundle: style + default direction + new alt in one save'); log('before: ' + show(before.img));
    const r = await save(f, { style: before.img.style, prompt: DEFAULT, alt: 'A new alt typed in a stale tab' });
    let a = await article(f.id); log(`reply ${r.status}; after: ` + show(a.img));
    expect(r.status).toBe(200);
    expect(a.img).toEqual({ ...before.img, alt: 'A new alt typed in a stale tab', altBy: 'owner' });
    // Variants of the same stale value.
    for (const stale of [DEFAULT + ' ', '  ' + DEFAULT + '\n']) { await save(f, { style: before.img.style, prompt: stale, alt: 'A new alt typed in a stale tab' }); expect((await article(f.id)).img.prompt, JSON.stringify(stale)).toBe(COVER); }
    // The new bundle: the alt alone.
    await save(f, { alt: 'Second alt' }); a = await article(f.id);
    expect(a.img).toEqual({ ...before.img, alt: 'Second alt', altBy: 'owner' });
    // A later rewrite and Regenerate still treat the direction as Radar's.
    M.requests = []; await draft(f.biz.id, f.id); a = await article(f.id);
    log('after a later rewrite: ' + show(a.img) + '; body request 0 ends: …' + (M.requests[0]?.prompt.slice(150, 330) || ''));
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: 'Second alt', altBy: 'owner' });
    expect(M.requests.some(q => q.prompt.includes('Overall look the owner asked for'))).toBe(false);
    // Not drafted yet: the default stays the default and gets no author.
    const g = await fixture(); await save(g, { style: 'branded', prompt: DEFAULT, alt: 'Alt before the draft' });
    const b = await article(g.id); log('undrafted article, same save: ' + show(b.img));
    expect(b.img.prompt).toBe(DEFAULT); expect('promptBy' in b.img).toBe(false); expect(b.img.altBy).toBe('owner');
    // A direction from the built-in fallback is Radar's too.
    M.answer = () => { throw new Error('model down'); }; const q = quiet();
    const h = await fixture(); await draft(h.biz.id, h.id); const fb = await article(h.id); q.forEach(s => s.mockRestore());
    await save(h, { style: fb.img.style, prompt: DEFAULT, alt: 'x' });
    expect((await article(h.id)).img).toMatchObject({ prompt: fb.img.prompt, promptBy: 'radar' }); expect(fb.img.prompt).toMatch(/^A literal, realistic scene/);
  });

  it('checks 2 and 3: a typed direction is the owner’s and survives a rewrite; direction and alt saved separately both land; retyping the default clears the mark', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const OWN = 'A watercolour of the Al Warsan skyline at dusk, seen from a rooftop';
    log('\n## R2. Typed direction');
    // The two saves a new bundle sends when both fields are edited inside the debounce window, in flight together.
    const [r1, r2] = await Promise.all([save(f, { prompt: OWN }), save(f, { alt: 'Skyline alt typed by the owner' })]);
    let a = await article(f.id); log(`direction and alt saved as two concurrent requests (${r1.status}, ${r2.status}): ` + show(a.img));
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: 'Skyline alt typed by the owner', altBy: 'owner' });
    M.requests = []; M.directionCalls = []; await draft(f.biz.id, f.id); a = await article(f.id);
    log('after a rewrite: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: 'Skyline alt typed by the owner', altBy: 'owner' });
    expect(M.requests.every(q => q.prompt.includes(` Overall look the owner asked for: ${OWN}.`))).toBe(true);
    // Retyping the creation default over a typed direction: stored, with no author.
    const r = await save(f, { prompt: DEFAULT }); a = await article(f.id); log(`default sentence retyped over it (${r.status}): ` + show(a.img));
    expect(a.img.prompt).toBe(DEFAULT); expect('promptBy' in a.img).toBe(false);
    M.requests = []; await draft(f.biz.id, f.id); a = await article(f.id); log('next rewrite: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar' });
    // The default typed over Radar's direction is ignored (this is what protects against the stale tab).
    await save(f, { prompt: DEFAULT }); expect((await article(f.id)).img).toMatchObject({ prompt: COVER, promptBy: 'radar' });
    // Anything else typed over Radar's direction is the owner's, the empty string included.
    await save(f, { prompt: DEFAULT + ' at sunset' }); expect((await article(f.id)).img).toMatchObject({ prompt: DEFAULT + ' at sunset', promptBy: 'owner' });
    await save(f, { prompt: '' }); a = await article(f.id); log('direction cleared: ' + show(a.img));
  });

  it('D2: "Generate from prompt" with a typed direction gives the neutral alt, keeps an alt the owner typed, and changes nothing when it fails', async () => {
    const OWN = 'A watercolour of the Al Warsan skyline at dusk, seen from a rooftop';
    const f = await fixture(); await draft(f.biz.id, f.id); let a = await article(f.id); expect(a.img.alt).toBe(RADAR_ALT);
    log('\n## R3. D2: the alt after a typed direction'); log('after the draft: ' + show(a.img));
    const q = quiet(); M.provider = '503'; const before = a;
    const bad = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id, prompt: OWN }); M.provider = 'ok'; q.forEach(s => s.mockRestore());
    expect(bad.status).toBe(502); expect(await article(f.id)).toEqual(before);
    M.requests = [];
    expect((await act(f.biz.id, 'article.regenerateImage', { entryId: f.id, prompt: OWN })).status).toBe(200);
    a = await article(f.id); log('after "Generate from prompt" with a typed direction: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: NEUTRAL_ALT, modelRequired: true }); expect(a.img.altBy).toBeUndefined();
    expect(M.requests[0].prompt).toContain(`Subject: ${OWN}.`);
    // An alt the owner typed stays.
    const g = await fixture(); await draft(g.biz.id, g.id); await save(g, { alt: 'My own alt' });
    expect((await act(g.biz.id, 'article.regenerateImage', { entryId: g.id, prompt: OWN })).status).toBe(200);
    const b = await article(g.id); log('same, after the owner had edited the alt: ' + show(b.img));
    expect(b.img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: 'My own alt', altBy: 'owner' });
  });

  it('QA probe: "Generate from prompt" pressed on Radar’s own untouched direction', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const before = await article(f.id);
    M.requests = [];
    const r = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id, prompt: before.img.prompt });
    const a = await article(f.id);
    log('\n## R4. "Generate from prompt" with the direction Radar wrote, unedited'); log('before: ' + show(before.img)); log(`reply ${r.status}; after: ` + show(a.img)); log('cover request: ' + M.requests[0]?.prompt);
    M.requests = []; const bj = await startBodyImages(f.biz.id, f.id); await runJobNow(bj);
    log('next body-image request: ' + M.requests[0]?.prompt);
    M.requests = []; M.answer = ctx => { const out = modelAnswer(ctx); out.cover.direction = 'The inner courtyard of Wasl 611, with benches under shade trees between the buildings.'; return out; };
    await db.update(schema.calendarEntries).set({ title: TITLE + ' (Updated)' }).where(eq(schema.calendarEntries.id, f.id));
    await draft(f.biz.id, f.id); const later = await article(f.id);
    log('after a later rewrite for which Radar would write a new direction: ' + show(later.img));
  });

  it('D4: a cover drawn at publish time is stored with its urlKey, and its placeholder mark when it fell back', async () => {
    const data = (style: Article['img']['style']) => (_bid: string, base: Article): Article => ({ ...base, generated: true, body: legacyBody, img: { style, seed: 3, prompt: COVER, promptBy: 'radar', alt: RADAR_ALT, url: null, urlKey: null } });
    log('\n## R5. D4: the publisher’s late cover render'); const q = quiet();
    const cases: [string, Article['img']['style'], () => void, string | null][] = [
      ['model style, provider fails', 'illustration', () => { M.provider = '503'; }, 'failed'],
      ['model style, no image model', 'photography', () => { M.model = false; }, 'unavailable'],
      ['model style, provider answers', 'illustration', () => {}, null],
      ['template style', 'branded', () => {}, null],
    ];
    for (const [name, style, arrange, mark] of cases) {
      M.model = true; M.provider = 'ok'; const f = await fixture({ status: 'scheduled', data: data(style) }); arrange();
      const payload = await buildPayload(f.biz, entryFromRow(await entry(f.id) as any), f.a); const a = await article(f.id);
      log(`${name}: ` + show(a.img) + `; shown by the editor: ${!!a.img.url && a.img.urlKey === `${a.img.style}:${a.img.seed}`}`);
      expect(payload.image!.url).toContain(`/api/files/${f.biz.id}/hero/`);
      expect(a.img.url).toBeTruthy(); expect(a.img.urlKey, name).toBe(`${style}:3`);
      expect(a.img.placeholder?.reason ?? null, name).toBe(mark);
      expect({ ...a.img, url: null, urlKey: null, placeholder: undefined }).toEqual({ ...f.a.img, placeholder: undefined });
    }
    q.forEach(s => s.mockRestore());
  });

  it('flag 6a: a typed direction on a legacy article with a hand-written alt', async () => {
    const HAND = 'Front gate of Wasl 611 at dusk, hand-written by the owner in October';
    const legacy = (style: Article['img']['style'], prompt: string) => (bid: string, base: Article): Article => ({ ...base, generated: true, body: legacyBody, img: { style, seed: 4, prompt, alt: HAND, url: `/api/files/${bid}/hero/old.png`, urlKey: `${style}:4` } });
    log('\n## R6. Flag 6a: legacy hand-written alt and "Generate from prompt"');
    for (const [name, style, stored, typed] of [['model style, the owner types a new direction', 'illustration', DEFAULT, 'The front gate of the community at dusk'], ['legacy direction the owner had typed, generated again unchanged', 'illustration', 'The front gate of the community at dusk', 'The front gate of the community at dusk'], ['template style, typed direction', 'branded', DEFAULT, 'The front gate of the community at dusk']] as [string, Article['img']['style'], string, string][]) {
      const f = await fixture({ status: 'review', data: legacy(style, stored) });
      const r = await act(f.biz.id, 'article.regenerateImage', { entryId: f.id, prompt: typed }); const a = await article(f.id);
      log(`${name}: reply ${r.status}; alt before: ${JSON.stringify(HAND)}; alt after: ${JSON.stringify(a.img.alt)}; altBy: ${a.img.altBy ?? null}`);
    }
    // Editing the alt once (after this change) protects it.
    const g = await fixture({ status: 'review', data: legacy('illustration', DEFAULT) }); await save(g, { alt: HAND + '.' });
    await act(g.biz.id, 'article.regenerateImage', { entryId: g.id, prompt: 'The front gate of the community at dusk' });
    expect((await article(g.id)).img).toMatchObject({ alt: HAND + '.', altBy: 'owner' });
  });

  it('flag 6b: a stale tab and the first-draft style upgrade', async () => {
    const f = await fixture(); expect(f.a.img.style).toBe('branded');
    await draft(f.biz.id, f.id); const drafted = await article(f.id);
    log('\n## R7. Flag 6b: stale tab and the first-draft style upgrade'); log('stored before the draft: ' + show(f.a.img)); log('after the first draft (an image model is available): ' + show(drafted.img));
    expect(drafted.img).toMatchObject({ style: 'illustration', prompt: COVER, promptBy: 'radar', urlKey: 'illustration:1' });
    // New bundle, stale tab: the alt alone.
    await save(f, { alt: 'Alt typed in a stale tab' }); let a = await article(f.id);
    log('new bundle, alt edit from a stale tab: ' + show(a.img));
    expect(a.img).toMatchObject({ style: 'illustration', prompt: COVER, promptBy: 'radar', urlKey: 'illustration:1' }); expect(a.img.url).toBe(drafted.img.url);
    // Old bundle, stale tab: style, direction and alt as the tab last saw them.
    M.requests = []; M.put = [];
    const r = await save(f, { style: 'branded', prompt: DEFAULT, alt: 'Alt typed in a stale tab, old bundle' }); a = await article(f.id);
    log(`old bundle, alt edit from a stale tab (reply ${r.status}): ` + show(a.img) + `; cover file replaced: ${a.img.url !== drafted.img.url}; image model asked: ${M.requests.length}`);
    // What the owner must do to get the picture back.
    const back = await save(f, { style: 'illustration' }); a = await article(f.id);
    log(`owner picks Illustration again (reply ${back.status}): ` + show(a.img) + `; image model asked: ${M.requests.length}`);
  });

  it('regressions: style changes, cover Regenerate and the body-image job on a drafted article', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const drafted = await article(f.id);
    log('\n## R8. Regressions with a working image model');
    M.requests = [];
    expect((await save(f, { style: 'photography' })).status).toBe(200); let a = await article(f.id); log('style -> Photography: ' + show(a.img) + '; request: ' + M.requests[0]?.prompt.slice(0, 120));
    expect(a.img).toMatchObject({ style: 'photography', prompt: COVER, promptBy: 'radar', urlKey: 'photography:1' }); expect('placeholder' in a.img).toBe(false);
    expect(M.requests[0].prompt).toContain('Show exactly this scene: ' + COVER);
    const q = quiet(); M.provider = '503';
    expect((await save(f, { style: 'illustration' })).status).toBe(200); a = await article(f.id); log('style -> Illustration while the provider fails: ' + show(a.img));
    expect(a.img.placeholder).toMatchObject({ reason: 'failed' }); expect(a.img.promptBy).toBe('radar');
    M.provider = 'ok'; q.forEach(s => s.mockRestore());
    expect((await save(f, { style: 'infographic' })).status).toBe(200); a = await article(f.id); log('style -> Infographic: ' + show(a.img));
    expect('placeholder' in a.img).toBe(false); expect(a.img).toMatchObject({ style: 'infographic', prompt: COVER, promptBy: 'radar' });
    expect((await save(f, { style: 'illustration' })).status).toBe(200);
    M.requests = []; M.directionCalls = [];
    expect((await act(f.biz.id, 'article.regenerateImage', { entryId: f.id })).status).toBe(200); a = await article(f.id); log('cover Regenerate: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: RADAR_ALT, seed: 2 }); expect(M.directionCalls).toEqual([]); expect(M.requests[0].prompt).toContain('Show exactly this scene');
    const bj = await startBodyImages(f.biz.id, f.id); await runJobNow(bj); a = await article(f.id);
    expect((await getJob(bj))!.status).toBe('done'); expect(a.bodyImages!.map(i => i.prompt)).toEqual(drafted.bodyImages!.map(i => i.prompt)); expect(a.img.promptBy).toBe('radar');
    // A patch carrying fields the client may not set still changes nothing.
    const before = await article(f.id);
    await act(f.biz.id, 'article.save', { entryId: f.id, patch: { img: { alt: before.img.alt, promptBy: 'owner', altBy: 'owner', placeholder: { reason: 'failed', at: 'x' }, url: 'https://evil.test/x.png', urlKey: 'x', seed: 9, modelRequired: true }, imageDirections: null, bodyImagesIssue: { reason: 'failed', at: 'x' } } });
    expect(await article(f.id)).toEqual(before);
  });
});
