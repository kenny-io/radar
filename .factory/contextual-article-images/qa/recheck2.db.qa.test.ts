// T4c QA recheck of the N1 fix (revision 6266ec2c): "Generate from prompt" on a direction nobody typed. Same harness as
// recheck.db.qa.test.ts: real Postgres, the REAL image service with a faked provider and file store, stub text adapter.
// NO REAL PROVIDER IS CALLED.
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
import { defaultArticle } from '@/features/article/blocks';
import { entryFromRow } from '@/server/workspace';
import { defaultCoverDirection, planArticleBodyImages } from '@/lib/articleImages';
import type { Article, Block, Profile } from '@/lib/types';
import { startBodyImages } from '@/server/services/drafting/bodyImages';
import { startDraft } from '@/server/services/drafting/start';
import '@/server/services/drafting/jobs';
import { registerStub } from '@/server/ai/adapters/stub';

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

const OUT = (process.env.QA_EVIDENCE_DIR || '.factory/contextual-article-images/qa/evidence/recheck2') + '/recheck2.txt';
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
  const user = await F.user(); const biz = await F.biz(user, { profile, domain: `lived-r2-${F.tag}-${++seq}.test` });
  const id = `e_r2_${F.tag}_${seq}`;
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

void planArticleBodyImages; void ({} as Block);
const press = (f: { biz: { id: string }; id: string }, prompt?: string) => act(f.biz.id, 'article.regenerateImage', { entryId: f.id, ...(prompt !== undefined ? { prompt } : {}) });
const shown = (img: Article['img']) => !!img.url && img.urlKey === `${img.style}:${img.seed}`;
const literal = (p?: string) => !!p && p.includes('Show exactly this scene: ');
const OWN = 'A watercolour of the Al Warsan skyline at dusk, seen from a rooftop';
const NEW_COVER = 'The inner courtyard of Wasl 611, with benches under shade trees between the buildings.';

describe.skipIf(!HAS_DB)('N1: "Generate from prompt" on a direction nobody typed', () => {
  it('check 1: Radar’s unedited direction stays Radar’s; literal request; alt kept; body requests clean; a later direction can replace it', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const before = await article(f.id);
    log('## T1. N1: press "Generate from prompt" on Radar’s unedited direction (model style, working model)'); log('before: ' + show(before.img));
    // A failing provider and no provider: an error, nothing changes.
    const q = quiet(); M.provider = '503'; const bad = await press(f, before.img.prompt); M.provider = 'ok';
    M.model = false; const none = await press(f, before.img.prompt); M.model = true; q.forEach(s => s.mockRestore());
    log(`provider fails: ${bad.status} ${bad.body?.code}; no image model: ${none.status} ${none.body?.code}`);
    expect(bad.status).toBe(502); expect(none.status).toBe(503); expect(await article(f.id)).toEqual(before);
    M.requests = []; M.directionCalls = [];
    const r = await press(f, before.img.prompt); let a = await article(f.id);
    log(`reply ${r.status}; after: ` + show(a.img)); log('cover request: ' + M.requests[0]?.prompt);
    expect(r.status).toBe(200);
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: RADAR_ALT, seed: 2, urlKey: 'illustration:2' });
    expect('modelRequired' in a.img).toBe(false); expect(a.img.altBy).toBeUndefined(); expect(a.img.url).not.toBe(before.img.url);
    expect(M.requests).toHaveLength(1); expect(literal(M.requests[0].prompt)).toBe(true); expect(M.requests[0].prompt).not.toContain('Subject: ');
    expect(M.directionCalls).toEqual([]); // cached from the draft
    M.requests = []; const bj = await startBodyImages(f.biz.id, f.id); await runJobNow(bj);
    log('next body-image request: ' + M.requests[0]?.prompt.slice(0, 260));
    expect((await getJob(bj))!.status).toBe('done'); expect(M.requests.length).toBeGreaterThanOrEqual(2);
    expect(M.requests.some(x => x.prompt.includes('Overall look the owner asked for'))).toBe(false);
    // The article changes and Radar writes a new direction for it.
    M.answer = ctx => { const out = modelAnswer(ctx); out.cover.direction = NEW_COVER; return out; };
    await db.update(schema.calendarEntries).set({ title: TITLE + ' (Updated)' }).where(eq(schema.calendarEntries.id, f.id));
    M.requests = []; await draft(f.biz.id, f.id); a = await article(f.id);
    log('after a rewrite of the changed article: img ' + show(a.img) + '; directions cached for it: ' + JSON.stringify(a.imageDirections?.cover.prompt));
    expect(a.img.promptBy).toBe('radar'); expect(a.imageDirections!.cover.prompt).toBe(NEW_COVER);
    const again = await press(f, a.img.prompt); a = await article(f.id);
    log(`pressed again (${again.status}): ` + show(a.img));
    expect(a.img).toMatchObject({ prompt: NEW_COVER, promptBy: 'radar' }); expect('modelRequired' in a.img).toBe(false);
  });

  it('check 2: an edited prompt is the owner’s; an unedited prompt over the owner’s stays theirs; whitespace is not an edit', async () => {
    log('\n## T2. Edited, unedited-over-owner, whitespace');
    const f = await fixture(); await draft(f.biz.id, f.id);
    // Whitespace only: leading and trailing spaces, a doubled space, a newline inside.
    const spaced = '  ' + COVER.replace('Wasl 611, a', 'Wasl 611,  a').replace(' seen from', '\nseen from') + ' \n';
    M.requests = []; expect((await press(f, spaced)).status).toBe(200); let a = await article(f.id);
    log('whitespace-only difference: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: RADAR_ALT }); expect('modelRequired' in a.img).toBe(false); expect(literal(M.requests[0].prompt)).toBe(true);
    // One changed word.
    const edited = COVER.replace('daylight', 'moonlight');
    M.requests = []; expect((await press(f, edited)).status).toBe(200); a = await article(f.id);
    log('one word changed: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: edited, promptBy: 'owner', modelRequired: true, alt: NEUTRAL_ALT }); expect(M.requests[0].prompt).toContain(`Subject: ${edited}`);
    // The same owner's direction pressed again, unedited.
    M.requests = []; M.directionCalls = []; expect((await press(f, edited)).status).toBe(200); a = await article(f.id);
    log('the owner’s direction pressed again unedited: ' + show(a.img));
    expect(a.img).toMatchObject({ prompt: edited, promptBy: 'owner', modelRequired: true }); expect(M.directionCalls).toEqual([]); expect(literal(M.requests[0].prompt)).toBe(false);
    // A direction typed into the field (autosave) and then pressed, as the workspace does it: save first, then generate.
    const g = await fixture(); await draft(g.biz.id, g.id); await save(g, { prompt: OWN });
    M.requests = []; expect((await press(g, OWN)).status).toBe(200); const b = await article(g.id);
    log('typed in the field, autosaved, then pressed: ' + show(b.img));
    expect(b.img).toMatchObject({ prompt: OWN, promptBy: 'owner', modelRequired: true, alt: NEUTRAL_ALT }); expect(M.requests[0].prompt).toContain(`Subject: ${OWN}.`);
    // Case matters: a different capital letter is an edit.
    const h = await fixture(); await draft(h.biz.id, h.id); await press(h, COVER.toUpperCase());
    expect((await article(h.id)).img.promptBy).toBe('owner');
  });

  it('check 3: an undrafted article keeps its direction as stored, and the first draft still adopts Radar’s', async () => {
    const f = await fixture(); log('\n## T3. Undrafted article'); log('stored: ' + show(f.a.img));
    M.requests = []; M.directionCalls = [];
    const r = await press(f, DEFAULT); let a = await article(f.id);
    log(`pressed with the default (${r.status}): ` + show(a.img) + `; shown by the editor: ${shown(a.img)}; direction step calls: ${M.directionCalls.length}`); log('request: ' + M.requests[0]?.prompt.slice(0, 200));
    expect(r.status).toBe(200); expect(a.img.prompt).toBe(DEFAULT); expect('promptBy' in a.img).toBe(false); expect('modelRequired' in a.img).toBe(false); expect(a.generated).toBe(false); expect(M.directionCalls).toEqual([]);
    M.requests = []; const job = await draft(f.biz.id, f.id); a = await article(f.id);
    log(`after the first draft (${job.status}): ` + show(a.img) + `; cover requests: ${M.requests.filter(x => !x.prompt.includes('bedroom') && !x.prompt.includes('staff bus')).length}`);
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: RADAR_ALT }); expect(shown(a.img)).toBe(true); expect(literal(M.requests[0].prompt)).toBe(true);
    // Typed before the first draft: the owner's, kept by the draft.
    const g = await fixture(); await press(g, OWN); await draft(g.biz.id, g.id); const b = await article(g.id);
    log('typed before the first draft, after it: ' + show(b.img));
    expect(b.img).toMatchObject({ prompt: OWN, promptBy: 'owner', modelRequired: true });
  });

  it('check 4: a legacy drafted article with the creation default gets a contextual direction from an unedited press', async () => {
    log('\n## T4. Legacy drafted article, creation default');
    for (const style of ['illustration', 'branded'] as const) {
      const f = await fixture({ status: 'review', data: (bid, base) => ({ ...base, generated: true, body: legacyBody, img: { style, seed: 4, prompt: DEFAULT, alt: 'Old alt', url: `/api/files/${bid}/hero/old.png`, urlKey: `${style}:4` } }) });
      M.requests = []; M.directionCalls = []; const r = await press(f, DEFAULT); const a = await article(f.id);
      log(`${style} (${r.status}): ` + show(a.img) + `; literal request: ${literal(M.requests[0]?.prompt)}; direction step calls: ${M.directionCalls.length}; shown by the editor: ${shown(a.img)}`);
      expect(r.status).toBe(200); expect(a.img).toMatchObject({ style, prompt: COVER, promptBy: 'radar', seed: 5, urlKey: `${style}:5` }); expect('modelRequired' in a.img).toBe(false);
      expect(literal(M.requests[0].prompt)).toBe(true); expect(M.directionCalls).toHaveLength(1); expect(a.imageDirections!.source).toBe('ai');
    }
  });

  it('check 5: Branded graphic, unedited prompt, working model: what is stored and what happens to the picture afterwards', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); await save(f, { style: 'branded' }); const before = await article(f.id);
    log('\n## T5. Template style (Branded graphic), unedited prompt, working model'); log('before (a title card): ' + show(before.img));
    M.requests = []; M.put = [];
    const r = await press(f, before.img.prompt); let a = await article(f.id); const generated = a.img.url;
    log(`pressed (${r.status}): ` + show(a.img) + `; image model asked: ${M.requests.length}; shown by the editor as the stored file: ${shown(a.img)}`); log('request: ' + M.requests[0]?.prompt.slice(0, 230));
    expect(r.status).toBe(200); expect(M.requests).toHaveLength(1); expect(shown(a.img)).toBe(true);
    // What later actions do to that generated picture while the style still says Branded graphic.
    M.requests = []; await draft(f.biz.id, f.id); a = await article(f.id);
    log(`after a rewrite: cover file kept: ${a.img.url === generated}; ` + show(a.img));
    M.requests = []; const plain = await press(f); a = await article(f.id);
    log(`after the plain Regenerate button (${plain.status}): cover file kept: ${a.img.url === generated}; image model asked: ${M.requests.length}; ` + show(a.img));
    const again = await press(f, a.img.prompt); a = await article(f.id); const second = a.img.url;
    M.requests = []; await save(f, { style: 'infographic' }); await save(f, { style: 'branded' }); a = await article(f.id);
    log(`pressed again (${again.status}), then Style changed away and back: generated file kept: ${a.img.url === second}; image model asked by the style changes: ${M.requests.length}; ` + show(a.img));
  });

  it('check 6: cover Regenerate without a prompt, the D1 old-bundle save and the D2 alt still behave', async () => {
    const f = await fixture(); await draft(f.biz.id, f.id); const drafted = await article(f.id);
    M.requests = []; M.directionCalls = []; expect((await press(f)).status).toBe(200); let a = await article(f.id);
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: RADAR_ALT, seed: 2 }); expect('modelRequired' in a.img).toBe(false); expect(literal(M.requests[0].prompt)).toBe(true); expect(M.directionCalls).toEqual([]);
    expect((await save(f, { style: a.img.style, prompt: DEFAULT, alt: 'Old bundle alt' })).status).toBe(200); a = await article(f.id);
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: 'Old bundle alt', altBy: 'owner' });
    // An unedited press keeps the owner's alt; a typed one keeps it too.
    expect((await press(f, COVER)).status).toBe(200); expect((await article(f.id)).img).toMatchObject({ promptBy: 'radar', alt: 'Old bundle alt', altBy: 'owner' });
    expect((await press(f, OWN)).status).toBe(200); expect((await article(f.id)).img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: 'Old bundle alt', altBy: 'owner' });
    const g = await fixture(); await draft(g.biz.id, g.id); expect((await press(g, OWN)).status).toBe(200);
    expect((await article(g.id)).img).toMatchObject({ prompt: OWN, promptBy: 'owner', alt: NEUTRAL_ALT });
    log('\n## T6. Regressions: plain Regenerate, old-bundle save and the neutral alt all as in the first recheck'); void drafted;
  });
});
