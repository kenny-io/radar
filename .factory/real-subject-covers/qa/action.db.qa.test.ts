// QA probe: the owner action, the record, the switch back, autosave and publishing (AC1, AC4, AC6, AC8, D4, D5, D7),
// end to end through the real route (POST /api/b/[bid]/act) in dev-stub mode. Nothing in the feature is replaced:
// the stub site answers fetchOwn, the real decoder child draws the cover, storage is the local disk, the cover
// template and the "no image model" error are the real ones. Only the stub site module is wrapped, to count requests.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = '.data/real-cover-qa'; process.env.RADAR_BILLING = 'off';
  for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY']) delete process.env[k];
  return { jar: new Map<string, string>(), fetched: [] as string[], during: null as null | (() => Promise<void>) };
});
vi.mock('@/server/services/analysis/devsite', async original => {
  const real = await original<typeof import('@/server/services/analysis/devsite')>();
  return { ...real, devFetch: async (url: string) => { M.fetched.push(url); if (M.during) { const run = M.during; M.during = null; await run(); } return real.devFetch(url); } };
});
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => M.jar));

import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures, clearLimits, uniq, type TUser } from '@/server/testing/fixtures';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import { buildPayload } from '@/server/services/publishing/publisher';
import { readStored, storedKey } from '@/server/services/storage';
import { probeImage } from '@/server/services/realCover/picture';
import { defaultArticle } from '@/features/article/blocks';
import { realCoverOf } from '@/lib/articleImages';
import { entryFromRow } from '@/server/workspace';
import type { Article, Profile } from '@/lib/types';

const F = new Fixtures(); let seq = 0; const lines: string[] = [];
const body: Article['body'] = [['p', 'Harbour House is a short walk from the station.'], ['h2', 'Getting there'], ['p', 'Trains run every ten minutes.'], ['h2', 'What it costs'], ['p', 'Prices change with the season.']];
async function fixture(o: { status?: string; img?: Partial<Article['img']>; article?: Partial<Article>; domain?: string; noArticle?: boolean } = {}) {
  const owner = await F.user(); const domain = o.domain || `qa-${uniq()}.test`;
  const profile: Profile = { domain, business: { name: 'Harbour Stays', description: 'Short lets', offerings: ['Short lets'], industry: 'Hospitality', positioning: '', differentiators: ['Local hosts'] }, audience: { segments: ['Travellers'], buyers: ['Guests'], needs: ['A place to stay'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#123456', secondary: '#abcdef', voice: 'Clear', language: 'English', markets: [] } };
  const biz = await F.biz(owner, { profile, domain });
  const id = `e_qa_${F.tag}_${++seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: 'Living at Harbour House: what to expect', kw: 'harbour house', type: 'Guide', date: '2026-11-20', status: o.status || 'review' }).returning();
  const a: Article = { ...defaultArticle(entryFromRow(entry)), generated: true, body, brief: { angle: 'A stay', outline: ['Getting there', 'What it costs'], words: 1400 }, seo: { title: 'Harbour House', meta: 'What to expect', slug: 'harbour-house' },
    img: { style: 'branded', seed: 1, prompt: 'A view of the harbour', promptBy: 'radar', alt: 'Cover alt', url: `/api/files/${biz.id}/hero/cover.png`, urlKey: 'branded:1', ...o.img }, ...o.article };
  if (!o.noArticle) await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  return { owner, biz, domain, entry, a, id };
}
type Fx = Awaited<ReturnType<typeof fixture>>;
const article = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0]?.data as Article;
async function act(user: TUser, bid: string, action: string, input: any) {
  M.jar.clear(); await F.signIn(user, M.jar);
  const response = await ACT(new Request('http://t/act', { method: 'POST', headers: { 'x-radar-client': '1', 'content-type': 'application/json' }, body: JSON.stringify({ action, input }) }), { params: Promise.resolve({ bid }) });
  const json: any = await response.json().catch(() => ({}));
  return { status: response.status, json, message: json?.error?.message ?? json?.message ?? json?.error ?? '', code: json?.error?.code ?? json?.code ?? '' };
}
const use = (f: Fx, url: string, user = f.owner, bid = f.biz.id, entryId = f.id) => act(user, bid, 'article.useSitePicture', { entryId, url });
const storedFile = async (bid: string, url: string) => { if (!storedKey(bid, url)) return null; const r = await readStored(bid, url); return r ? { buf: r.body, type: r.type } : null; };

beforeEach(() => { M.fetched = []; M.during = null; vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(async () => {
  await fs.mkdir('.factory/real-subject-covers/qa/evidence', { recursive: true }); await fs.writeFile('.factory/real-subject-covers/qa/evidence/action-outcomes.txt', lines.join('\n') + '\n');
  await clearLimits('sitepic:biz:');
  for (let attempt = 1; ; attempt++) { try { await F.cleanup(); break; } catch (e: any) { if (attempt >= 4) throw e; await new Promise(r => setTimeout(r, 300 * attempt)); } }
  await fs.rm(path.join(process.cwd(), '.data/real-cover-qa'), { recursive: true, force: true });
});

describe.skipIf(!process.env.DATABASE_URL)('article.useSitePicture through the route, stub site, nothing replaced', () => {
  it('a page address: the stored file is a 1200×628 PNG under the business’s hero folder, and the record says where it came from', async () => {
    const f = await fixture({ article: { imageDirections: { key: 'k', source: 'ai', subject: { name: 'Harbour House', kind: 'building' }, cover: { prompt: 'x', alt: 'Illustration of Harbour House' }, sections: [], at: '2026-11-01T00:00:00.000Z' } as any } });
    const r = await use(f, `https://${f.domain}/places/harbour-house`);
    expect(r.status).toBe(200);
    const a = await article(f.id); const real = realCoverOf(a.img)!;
    expect(real).toMatchObject({ by: 'owner', page: `https://${f.domain}/places/harbour-house`, src: `https://${f.domain}/media/harbour-house.png`, w: 1600, h: 900, fit: 'crop', url: a.img.url });
    expect(Number.isNaN(Date.parse(real.at))).toBe(false); expect(real.subject).toBeUndefined();
    expect(a.img.url).toMatch(new RegExp(`/${f.biz.id}/hero/[^/]+\\.png$`)); expect(a.img.urlKey).toBe('branded:1'); expect(a.img.placeholder).toBeUndefined();
    expect(a.img.alt).toBe('Harbour House'); expect(a.img.alt).not.toMatch(/^Illustration of/); expect(a.img.altBy).toBeUndefined();
    expect(a.img.prompt).toBe('A view of the harbour'); expect(a.img.noReal).toBeUndefined();
    const file = await storedFile(f.biz.id, a.img.url!); expect(file).toBeTruthy();
    expect(probeImage(file!.buf)).toEqual({ type: 'image/png', width: 1200, height: 628, complete: true }); expect(file!.type).toBe('image/png');
    expect(M.fetched.every(u => new URL(u).hostname === f.domain)).toBe(true);
    lines.push(`page address: 200; requests to the stub site: ${M.fetched.map(u => new URL(u).pathname).join(', ')}; stored ${file!.buf.length} bytes; record ${JSON.stringify({ ...real, url: '<stored>', page: new URL(real.page!).pathname, src: new URL(real.src).pathname })}`);
  });
  it('a picture address: page is null; a portrait picture is stored whole on a backdrop; with no subject the alt is the title; an owner’s alt is kept', async () => {
    const f = await fixture();
    expect((await use(f, `${f.domain}/media/harbour-house.png`)).status).toBe(200); // no scheme typed
    let a = await article(f.id);
    expect(realCoverOf(a.img)).toMatchObject({ by: 'owner', page: null, src: `https://${f.domain}/media/harbour-house.png`, fit: 'crop' });
    expect(a.img.alt).toBe('Living at Harbour House: what to expect');
    await act(f.owner, f.biz.id, 'article.save', { entryId: f.id, patch: { img: { alt: 'My own words' } } });
    const first = a.img.url;
    expect((await use(f, `/media/portrait.png`)).status).toBe(200); // a path only
    a = await article(f.id);
    expect(realCoverOf(a.img)).toMatchObject({ fit: 'backdrop', w: 800, h: 1200, src: `https://${f.domain}/media/portrait.png` });
    expect(a.img.url).not.toBe(first); expect(a.img.alt).toBe('My own words'); expect(a.img.altBy).toBe('owner');
  });
  it('an entry with no article row yet (never opened, never drafted)', async () => {
    const f = await fixture({ noArticle: true });
    const r = await use(f, `/media/harbour-house.png`);
    expect(r.status).toBe(200);
    const a = await article(f.id); expect(realCoverOf(a.img)).toMatchObject({ by: 'owner' }); expect(a.generated).toBe(false);
  });

  describe('every message in architecture §7.2 that the stub site can produce', () => {
    const cases: [string, (d: string) => string, number, string, (d: string) => string][] = [
      ['not your site', () => 'https://example.org/a.png', 400, 'not_your_site', d => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['look-alike host', d => `https://${d}.evil.com/a.png`, 400, 'not_your_site', d => `That address isn’t on ${d}. Radar only uses pictures from your own site.`],
      ['a port', d => `https://${d}:8443/a.png`, 400, 'invalid_address', d => `Enter the address of a page or picture on ${d}.`],
      ['userinfo', d => `https://admin:pw@${d}/a.png`, 400, 'invalid_address', d => `Enter the address of a page or picture on ${d}.`],
      ['javascript:', () => 'javascript:alert(1)', 400, 'invalid_address', d => `Enter the address of a page or picture on ${d}.`],
      ['page with only the site default card', d => `https://${d}/places/mill-lane-studios`, 422, 'no_picture', () => 'Radar couldn’t find a picture it can use on that page. Try the address of the picture itself.'],
      ['tiny picture', d => `https://${d}/media/tiny.png`, 422, 'too_small', () => 'That picture is too small for a cover. It needs to be at least 600 by 314 pixels.'],
      ['9 MB file', d => `https://${d}/media/too-large.png`, 422, 'too_large', () => 'That picture is too large. Radar accepts pictures up to 8 MB and 25 megapixels.'],
      ['cut-short picture', d => `https://${d}/media/broken.png`, 422, 'not_a_picture', () => 'That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.'],
      ['svg logo', d => `https://${d}/brand/logo.svg`, 422, 'not_a_picture', () => 'That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.'],
      ['css file', d => `https://${d}/assets/site.css`, 422, 'not_a_picture', () => 'That address isn’t a picture Radar can use. Radar accepts JPEG, PNG and WebP.'],
      ['missing page', d => `https://${d}/nope`, 422, 'unreachable', () => 'Radar couldn’t reach that address. Check it and try again.'],
      ['html behind a picture name', d => `https://${d}/media/page.png`, 422, 'no_picture', () => 'Radar couldn’t find a picture it can use on that page. Try the address of the picture itself.'],
    ];
    it.each(cases)('%s', async (name, address, status, code, message) => {
      const f = await fixture(); const before = await article(f.id);
      const r = await use(f, address(f.domain));
      lines.push(`${name.padEnd(40)} ${r.status} ${String(r.code).padEnd(16)} ${r.message}`.replaceAll(f.domain, '<domain>'));
      expect(r.status).toBe(status); expect(r.code).toBe(code); expect(r.message).toBe(message(f.domain));
      expect(await article(f.id)).toEqual(before);
      if (status === 400) expect(M.fetched).toEqual([]);
    });
    it('an unreachable site', async () => {
      const f = await fixture({ domain: `qa-unreachable-${uniq()}.test` });
      const r = await use(f, `https://${f.domain}/places/harbour-house`);
      expect(r).toMatchObject({ status: 422, code: 'unreachable', message: 'Radar couldn’t reach that address. Check it and try again.' });
    });
  });

  describe('refused before any request to the site', () => {
    const untouched = async (f: Fx) => { expect(M.fetched).toEqual([]); if (await article(f.id)) expect(await article(f.id)).toEqual(f.a); };
    it('a Viewer (403), a signed-in stranger, nobody signed in, and an owner of another business using this entry id', async () => {
      const f = await fixture(); const address = `https://${f.domain}/media/harbour-house.png`;
      const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer');
      const v = await use(f, address, viewer); expect(v.status).toBe(403);
      const stranger = await F.user(); const s = await use(f, address, stranger); expect([403, 404]).toContain(s.status);
      M.jar.clear(); const anon = await ACT(new Request('http://t/act', { method: 'POST', headers: { 'x-radar-client': '1' }, body: JSON.stringify({ action: 'article.useSitePicture', input: { entryId: f.id, url: address } }) }), { params: Promise.resolve({ bid: f.biz.id }) }); expect([401, 403]).toContain(anon.status);
      const other = await fixture();
      // The other owner, in their own business, names this business's entry: with their own domain, and with this one's.
      const x1 = await use(other, `https://${other.domain}/media/harbour-house.png`, other.owner, other.biz.id, f.id); expect(x1.status).toBe(404);
      const x2 = await use(other, address, other.owner, other.biz.id, f.id); expect(x2.status).toBe(404);
      // And posts to this business's id directly.
      const x3 = await use(f, address, other.owner); expect([403, 404]).toContain(x3.status);
      lines.push(`viewer ${v.status}; stranger ${s.status}; signed out ${anon.status}; other owner with this entry id ${x1.status}/${x2.status}; other owner on this business ${x3.status}`);
      await untouched(f);
    });
    it('an Editor and an Admin are allowed', async () => {
      for (const role of ['Editor', 'Admin'] as const) { const f = await fixture(); const u = await F.user(); await F.member(f.biz.id, u, role); expect((await use(f, '/media/harbour-house.png', u)).status).toBe(200); }
    });
    it.each([['scheduled', null], ['scheduled', { id: 'remote-0' }], ['publishing', null], ['published', null], ['failed', { id: 'remote-1' }]] as const)('status %s, remote %j', async (status, remote) => {
      const f = await fixture({ status });
      if (remote) await db.update(schema.calendarEntries).set({ publishRemote: remote as any }).where(eq(schema.calendarEntries.id, f.id));
      const r = await use(f, '/media/harbour-house.png');
      lines.push(`locked: status ${status}, remote ${JSON.stringify(remote)} → ${r.status} ${r.code}`);
      expect(r.status).toBe(409); await untouched(f);
    });
    it.each(['article.draft', 'article.bodyImages'])('active %s work, queued or running', async kind => {
      for (const status of ['queued', 'running'] as const) {
        const f = await fixture();
        await db.insert(schema.jobs).values({ kind, payload: { entryId: f.id }, businessId: f.biz.id, ref: f.id, status, maxAttempts: 1, ...(status === 'running' ? { lockedBy: 'qa', lockedAt: new Date() } : {}) });
        const r = await use(f, '/media/harbour-house.png');
        expect(r).toMatchObject({ status: 409, code: 'article_busy' }); await untouched(f);
      }
    });
    it('bad input: no address, a blank one, one over 2,000 characters, a number', async () => {
      const f = await fixture();
      for (const url of [undefined, '', '   ', 'x'.repeat(2001), 5, null, { href: 'x' }, ['https://a']]) { const r = await use(f, url as any); expect(r.status).toBe(400); }
      await untouched(f);
    });
  });

  it('storage fails after the picture is fetched: 502 image_failed with its own message, and the cover is unchanged', async () => {
    const f = await fixture();
    // Make the business's storage folder impossible to create: a file stands where the folder would be.
    await fs.mkdir(path.join(process.cwd(), '.data/real-cover-qa'), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), '.data/real-cover-qa', f.biz.id), 'not a folder');
    const r = await use(f, '/media/harbour-house.png');
    lines.push(`storage failure: ${r.status} ${r.code} "${r.message}"`);
    expect(r).toMatchObject({ status: 502, code: 'image_failed', message: 'Radar couldn’t save that picture. Your cover is unchanged. Try again.' });
    expect(await article(f.id)).toEqual(f.a);
    await fs.rm(path.join(process.cwd(), '.data/real-cover-qa', f.biz.id), { force: true });
  });
  it('the hourly limit: 30 attempts for one business whoever makes them, the 31st is refused with no request; another business is not affected', async () => {
    const f = await fixture(); const editor = await F.user(); await F.member(f.biz.id, editor, 'Editor');
    for (let i = 0; i < 30; i++) expect((await use(f, '/nope', i % 2 ? editor : f.owner)).code).toBe('unreachable');
    M.fetched = [];
    const r = await use(f, '/media/harbour-house.png');
    expect(r).toMatchObject({ status: 429, code: 'rate_limited', message: 'You’ve tried a lot of pictures in a short time. Try again in an hour.' });
    expect(M.fetched).toEqual([]); expect(await article(f.id)).toEqual(f.a);
    // Addresses refused by the domain rule are not counted, and still get their own message when the limit is spent.
    expect((await use(f, 'https://example.org/a.png')).code).toBe('not_your_site');
    const other = await fixture(); expect((await use(other, '/media/harbour-house.png')).status).toBe(200);
  });

  describe('the article changes while the picture is being fetched', () => {
    it('the cover was replaced meanwhile: 409, and the newer cover is kept', async () => {
      const f = await fixture();
      M.during = async () => { await db.update(schema.articles).set({ data: { ...f.a, img: { ...f.a.img, url: `/api/files/${f.biz.id}/hero/newer.png` } } }).where(eq(schema.articles.entryId, f.id)); };
      const r = await use(f, '/media/harbour-house.png');
      expect(r).toMatchObject({ status: 409, code: 'article_changed', message: 'The cover changed while Radar was fetching the picture. Try again.' });
      const a = await article(f.id); expect(a.img.url).toBe(`/api/files/${f.biz.id}/hero/newer.png`); expect(a.img.real).toBeUndefined();
    });
    it('it was scheduled meanwhile: refused under the row lock, and the cover that will be published is unchanged', async () => {
      const f = await fixture();
      M.during = async () => { await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id)); };
      const r = await use(f, '/media/harbour-house.png');
      expect(r.status).toBe(409); expect(await article(f.id)).toEqual(f.a);
    });
    it('a draft started meanwhile: refused under the row lock', async () => {
      const f = await fixture();
      M.during = async () => { await db.insert(schema.jobs).values({ kind: 'article.draft', payload: { entryId: f.id }, businessId: f.biz.id, ref: f.id, status: 'queued', maxAttempts: 1 }); };
      const r = await use(f, '/media/harbour-house.png');
      expect(r).toMatchObject({ status: 409, code: 'article_busy' }); expect(await article(f.id)).toEqual(f.a);
    });
    it('two requests at once for the same article: one cover wins, the record matches the file that is stored, nothing is half written', async () => {
      const f = await fixture();
      M.jar.clear(); await F.signIn(f.owner, M.jar);
      const post = (url: string) => ACT(new Request('http://t/act', { method: 'POST', headers: { 'x-radar-client': '1' }, body: JSON.stringify({ action: 'article.useSitePicture', input: { entryId: f.id, url } }) }), { params: Promise.resolve({ bid: f.biz.id }) }).then(r => r.status);
      const statuses = await Promise.all([post('/media/harbour-house.png'), post('/media/portrait.png')]);
      const a = await article(f.id); const real = realCoverOf(a.img);
      lines.push(`two at once: statuses ${statuses.join(', ')}; cover is ${real ? new URL(real.src).pathname : 'not real'}`);
      expect(statuses.filter(s => s === 200).length).toBeGreaterThanOrEqual(1); expect(statuses.every(s => s === 200 || s === 409)).toBe(true);
      expect(real).toBeTruthy(); expect(real!.url).toBe(a.img.url); expect(await storedFile(f.biz.id, a.img.url!)).toBeTruthy();
      // The business cannot read another business's stored cover through its own id.
      const other = await fixture(); expect(storedKey(other.biz.id, a.img.url!)).toBeNull();
    });
  });
});

describe.skipIf(!process.env.DATABASE_URL)('autosave, style, switch back (through the route)', () => {
  const real = async () => { const f = await fixture(); expect((await use(f, `https://${f.domain}/places/harbour-house`)).status).toBe(200); return { f, a: await article(f.id) }; };
  it('an autosave patch cannot set real, noReal or realCoverMiss, on a generated cover or a real one', async () => {
    const f = await fixture();
    const forged = { by: 'owner', url: f.a.img.url, page: 'https://evil.example/', src: 'https://evil.example/x.png', at: '2026-01-01T00:00:00.000Z', w: 1, h: 1, fit: 'crop' };
    const r = await act(f.owner, f.biz.id, 'article.save', { entryId: f.id, patch: { img: { alt: 'changed', real: forged, noReal: true, url: 'https://evil.example/x.png', urlKey: 'branded:1', placeholder: null }, realCoverMiss: { key: 'k', at: 'x' } }, realCoverMiss: { key: 'k', at: 'x' } });
    const a = await article(f.id);
    lines.push(`forged autosave: ${r.status}; img keys after: ${Object.keys(a.img).sort().join(',')}`);
    expect(a.img.real).toBeUndefined(); expect(a.img.noReal).toBeUndefined(); expect((a as any).realCoverMiss).toBeUndefined(); expect(a.img.url).toBe(f.a.img.url);
    const { f: g, a: before } = await real();
    await act(g.owner, g.biz.id, 'article.save', { entryId: g.id, patch: { img: { real: null, noReal: true, url: null } } });
    await act(g.owner, g.biz.id, 'article.save', { entryId: g.id, patch: { img: { prompt: before.img.prompt, real: { ...before.img.real, page: 'https://evil.example/', by: 'radar', subject: 'Forged' } } } });
    const after = await article(g.id);
    expect(after.img.real).toEqual(before.img.real); expect(after.img.noReal).toBeUndefined(); expect(after.img.url).toBe(before.img.url);
  });
  it('a style change on a real cover: nothing is rendered, the file and the record stay, urlKey follows the style (so the picture stays on screen), every style', async () => {
    const { f, a: before } = await real();
    for (const style of ['illustration', 'photography', 'infographic', 'branded']) {
      const r = await act(f.owner, f.biz.id, 'article.save', { entryId: f.id, patch: { img: { style } } });
      expect(r.status).toBe(200);
      const a = await article(f.id);
      expect(a.img.url).toBe(before.img.url); expect(a.img.style).toBe(style); expect(a.img.urlKey).toBe(`${style}:${a.img.seed}`); expect(realCoverOf(a.img)).toEqual(before.img.real); expect(a.img.placeholder).toBeUndefined();
    }
  });
  it('"Use a generated cover instead" with Branded graphic: the template replaces the picture, the record goes, noReal is set, the alt no longer is the bare name', async () => {
    const { f, a: before } = await real();
    const r = await act(f.owner, f.biz.id, 'article.regenerateImage', { entryId: f.id });
    expect(r.status).toBe(200);
    const a = await article(f.id);
    lines.push(`switch back, branded: ${r.status}; real ${JSON.stringify(a.img.real ?? null)}; noReal ${a.img.noReal}; alt "${a.img.alt}"; placeholder ${JSON.stringify(a.img.placeholder ?? null)}`);
    expect(a.img.real).toBeUndefined(); expect(realCoverOf(a.img)).toBeNull(); expect(a.img.noReal).toBe(true); expect(a.img.url).not.toBe(before.img.url); expect(a.img.urlKey).toBe(`branded:${a.img.seed}`);
    expect(probeImage((await storedFile(f.biz.id, a.img.url!))!.buf)).toMatchObject({ type: 'image/png', width: 1200, height: 628 });
    expect(a.img.alt).not.toBe(before.img.alt);
    // Then a person may choose a picture again, and switch back again.
    expect((await use(f, '/media/portrait.png')).status).toBe(200);
    const again = await article(f.id); expect(realCoverOf(again.img)).toMatchObject({ fit: 'backdrop' }); expect(again.img.noReal).toBe(true);
  });
  it('"Use a generated cover instead" with Illustration and no image model: the existing error, and the picture, the record and the alt are kept exactly; noReal is not set', async () => {
    const { f } = await real();
    await act(f.owner, f.biz.id, 'article.save', { entryId: f.id, patch: { img: { style: 'illustration' } } });
    const before = await article(f.id);
    const r = await act(f.owner, f.biz.id, 'article.regenerateImage', { entryId: f.id });
    lines.push(`switch back, illustration, no model: ${r.status} ${r.code} "${r.message}"`);
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.code).toBe('image_unavailable');
    expect(await article(f.id)).toEqual(before);
  });
  it('a Viewer cannot switch back, and cannot on a scheduled article either', async () => {
    const { f } = await real(); const before = await article(f.id);
    const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer');
    expect((await act(viewer, f.biz.id, 'article.regenerateImage', { entryId: f.id })).status).toBe(403);
    await db.update(schema.calendarEntries).set({ status: 'scheduled' }).where(eq(schema.calendarEntries.id, f.id));
    expect((await act(f.owner, f.biz.id, 'article.regenerateImage', { entryId: f.id })).status).toBe(409);
    expect(await article(f.id)).toEqual(before);
  });
});

describe.skipIf(!process.env.DATABASE_URL)('publishing (AC8)', () => {
  it('a real cover and a generated cover build payloads of the same shape; the real one carries the stored PNG and the new alt', async () => {
    const g = await fixture(); await act(g.owner, g.biz.id, 'article.regenerateImage', { entryId: g.id }); // a generated (template) cover, stored
    const f = await fixture(); expect((await use(f, `https://${f.domain}/places/harbour-house`)).status).toBe(200);
    const shape = (v: any): any => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])])) : typeof v);
    const [pg, pf] = [await buildPayload(g.biz, entryFromRow(g.entry), await article(g.id)), await buildPayload(f.biz, entryFromRow(f.entry), await article(f.id))];
    expect(shape(pf)).toEqual(shape(pg));
    const a = await article(f.id);
    expect(pf.image!.url.endsWith(a.img.url!)).toBe(true); expect(pf.image!.alt).toBe(a.img.alt);
    // Architecture §5: with no subject on the article, the alt is "the picture's own alt text from the page". The stub page gives its photo the alt "Harbour House · photo 1".
    expect.soft(pf.image!.alt, 'alt taken from the page').toBe('Harbour House · photo 1');
    const [bf, bg] = [await pf.image!.bytes(), await pg.image!.bytes()];
    expect(bf.type).toBe('image/png'); expect(bg.type).toBe('image/png'); expect(bf.name).toBe(bg.name);
    expect(probeImage(bf.buf)).toEqual({ type: 'image/png', width: 1200, height: 628, complete: true });
    expect(JSON.stringify({ ...pf, image: { ...pf.image, bytes: undefined } })).not.toMatch(/"real"|noReal|realCoverMiss/);
    lines.push(`payload shape (both): ${JSON.stringify(shape(pf))}`);
    lines.push(`payload image, real cover: alt "${pf.image!.alt}", bytes ${bf.buf.length} ${bf.type} named ${bf.name}`);
    expect(await article(f.id)).toEqual(a); // building the payload changes nothing
  });
  it('an article with none of the new fields: get, save and payload as before, and none of the fields appears', async () => {
    const f = await fixture();
    const got = await act(f.owner, f.biz.id, 'article.get', { entryId: f.id });
    expect(got.status).toBe(200);
    await act(f.owner, f.biz.id, 'article.save', { entryId: f.id, patch: { seo: { meta: 'Edited' } } });
    const a = await article(f.id);
    expect(a).toEqual({ ...f.a, seo: { ...f.a.seo, meta: 'Edited' } });
    const p = await buildPayload(f.biz, entryFromRow(f.entry), a);
    expect(p.image).toMatchObject({ alt: 'Cover alt' }); expect(p.image!.url).toContain('/hero/cover.png');
  });
});
