// What a person gets when the image model's picture cannot be used, through the real actions, jobs, row locks and
// images.ts, with a real database. Only the provider's HTTP answer, storage and the failure reports are replaced.
// The same file runs against the base (main b3ad2d50) and the revision under test, and writes what each caller answered
// and stored to QA_OUT, so the two can be compared:
//   the provider answers with an HTML page   → the base's decoder threw "Unsupported image type" (a decode error before the change)
//   the provider answers with a crashing PNG → only run on the revision under test (QA_ANSWERS); it ends the base's process
// Needs DATABASE_URL (a migrated throwaway database). No text model is asked: every flow here is one that asks none.
import { afterAll, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all';
  return { stored: [] as { key: string; bytes: number; sha: string }[], reports: [] as any[], asked: [] as string[], answer: Buffer.alloc(0) };
});
vi.mock('@/server/services/storage', async original => {
  const real = await original<typeof import('@/server/services/storage')>(); const crypto = await import('node:crypto');
  return { ...real, putObject: async (key: string, body: Buffer) => { M.stored.push({ key, bytes: body.length, sha: crypto.createHash('sha256').update(body).digest('hex') }); return `/api/files/${key}`; } };
});
vi.mock('@/server/observability/failures', () => ({ reportFailure: async (e: any, context: any) => { M.reports.push({ ...context, error: String(e?.message).slice(0, 80) }); } }));
import crypto from 'node:crypto';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { createCanvas } from '@napi-rs/canvas';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { Fixtures, uniq } from '@/server/testing/fixtures';
import { RadarError } from '@/server/errors';
import { bizToday, entryFromRow } from '@/server/workspace';
import { getJob, jobDefs, type JobCtx } from '@/server/jobs/queue';
import { actions as social } from '@/server/actions/social';
import { actions as brief } from '@/server/actions/brief';
import { actions as article } from '@/server/actions/article';
import '@/server/services/brief/visuals';
import { getPack } from '@/server/services/social/generate';
import { getDay } from '@/server/services/brief/store';
import { generateArticleBodyImages } from '@/server/services/drafting/bodyImages';
import { renderTemplatePng } from '@/server/services/images';
import { defaultArticle } from '@/features/article/blocks';
import type { Article, BriefItem, Profile, SocialPack } from '@/lib/types';

const F = new Fixtures(); let seq = 0;
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const BRAND = { primary: '#123456', secondary: '#abcdef' };
const profile = { domain: 'lived.test', business: { name: 'Lived', description: 'Homes', offerings: ['Homes'], industry: 'Housing', positioning: '', differentiators: [] }, brand: { logo: null, ...BRAND, voice: 'Clear', language: 'English', markets: [] }, audience: { segments: [], buyers: [], needs: [], competitors: [] }, keywords: { list: [] } } as unknown as Profile;
const good = (() => { const c = createCanvas(1536, 1024); const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1536, 1024); g.addColorStop(0, '#0b3954'); g.addColorStop(1, '#ffd166'); x.fillStyle = g; x.fillRect(0, 0, 1536, 1024); x.fillStyle = '#ef476f'; x.fillRect(100, 80, 400, 300); return c.toBuffer('image/png'); })();
const small = (() => { const c = createCanvas(160, 120); c.getContext('2d').fillRect(0, 0, 80, 60); return c.toBuffer('image/png'); })();
const ANSWERS: Record<string, Buffer> = {
  good,
  html: Buffer.from('<!doctype html><html><body><h1>Image unavailable</h1></body></html>'),
  // IHDR and IEND with no IDAT: ends a process that decodes it (SIGSEGV), so never used against the base here.
  crasher: Buffer.concat([small.subarray(0, 33), small.subarray(small.length - 12)]),
  // A whole PNG with one byte after it: decoded before the change, refused by the bytes check after it.
  trailing: Buffer.concat([good, Buffer.from('\n')]),
};
const WHICH = (process.env.QA_ANSWERS || 'good,html').split(',');

function provider(file: Buffer) {
  M.answer = file; M.asked.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    M.asked.push(String(url));
    if (!String(url).startsWith('https://openrouter.ai/api/v1/images')) throw new Error('unexpected request to ' + String(url).slice(0, 60));
    return new Response(JSON.stringify({ data: [{ b64_json: M.answer.toString('base64'), media_type: 'image/png' }], usage: { prompt_tokens: 60, completion_tokens: 1290, cost: 0.039 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}
/** Image model on (dev stubs off for images.ts, one provider key) for the length of `fn`. */
async function withModel<T>(fn: () => Promise<T>): Promise<T> {
  const was = { devStubs: env.devStubs, openrouterKey: env.openrouterKey, openaiKey: env.openaiKey, xaiKey: env.xaiKey };
  Object.assign(env, { devStubs: false, openrouterKey: 'sk-or-v1-qa0123456789', openaiKey: '', xaiKey: '' });
  try { return await fn(); } finally { Object.assign(env, was); }
}
const outcome = async (p: Promise<any>) => p.then(
  v => ({ resolved: v === undefined ? null : JSON.parse(JSON.stringify(v, (k, x) => (k === 'jobId' || k === 'request' ? '<id>' : typeof x === 'string' ? x.replace(/\/api\/files\/\S+/g, '<stored file>') : x))) }),
  (e: any) => ({ rejected: { radarError: e instanceof RadarError, errorClass: e?.constructor?.name, userMessage: e?.userMessage ?? null, status: e?.status ?? null, code: e?.code ?? null, message: String(e?.message) } }));
const act = (map: typeof social, name: string, ctx: any, input: any) => map[name].run(ctx, map[name].input!.parse(input));
async function runJob(id: string) {
  await db.update(schema.jobs).set({ status: 'running', lockedBy: 'qa', lockedAt: new Date() }).where(eq(schema.jobs.id, id));
  const job = (await getJob(id))!;
  const ctx: JobCtx = { job, payload: job.payload, businessId: job.businessId, attempt: job.attempts, progress: async () => {}, touch: async () => {} };
  try { const result = await jobDefs().get(job.kind)!.run(ctx); await db.update(schema.jobs).set({ status: 'done', result }).where(eq(schema.jobs.id, id)); return result; }
  catch (error) { await db.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, id)); throw error; }
}
/** Which of the stored files are brand templates: the sizes say it (a crop of the gradient compresses far worse), and
 *  for the cover the template is rebuilt and compared. */
const storedSince = (n: number) => M.stored.slice(n).map(s => ({ kind: s.key.split('/')[1], bytes: s.bytes, sha: s.sha.slice(0, 12) }));

async function socialFixture() {
  const user = await F.user(); const biz = await F.biz(user, { profile }); const day = bizToday(biz);
  const id = `p_qa_${F.tag}_${++seq}`;
  const pack: SocialPack = { id, name: 'Sobha Sapphire', source: { kind: 'idea', label: 'Resident views of Sobha Sapphire' }, created: day, style: 'branded', auto: false, posts: {
    linkedin: { text: 'Keep this LinkedIn post', style: 'branded', seed: 1, imageUrl: '/old-linkedin.png', imageMeta: { bytes: 99, type: 'image/png' }, copiedAt: null, v: 0 },
  } } as any;
  await db.insert(schema.socialPacks).values({ id, businessId: biz.id, data: pack });
  const item: BriefItem = { id: 'post' + seq, kind: 'post', title: 'Sobha Sapphire', tag: 'Housing', why: 'Useful', st: 'open', drafts: { linkedin: 'The post says something specific.' }, edits: {}, mention: false, plats: ['linkedin'], pl: 'linkedin', img: { style: 'editorial', seed: 5, n: 1, urls: ['/old-brief.png'], meta: [{ bytes: 99, type: 'image/png' }], status: 'ready' } } as any;
  await db.insert(schema.briefDays).values({ businessId: biz.id, date: day, scannedAt: new Date().toISOString(), items: [item] });
  return { user, biz, day, id, item, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
const body: Article['body'] = [['p', 'Intro'], ['h2', 'Measure drift'], ['p', 'Compare docs and code.'], ['h2', 'Review changes'], ['p', 'Review with the pull request.'], ['h2', 'Ship safely'], ['p', 'Publish checked docs.']] as any;
async function articleFixture(img: Partial<Article['img']>) {
  const user = await F.user(); const biz = await F.biz(user, { profile: { ...profile, domain: `qa-${uniq()}.test` } });
  const id = `e_qa_${F.tag}_${++seq}`;
  const [entry] = await db.insert(schema.calendarEntries).values({ id, businessId: biz.id, title: 'Keeping docs current', kw: 'docs drift', type: 'Guide', date: '2026-11-20', status: 'review' }).returning();
  const a: Article = { ...defaultArticle(entryFromRow(entry)), generated: true, body, brief: { angle: 'How', outline: ['Measure drift'], words: 1400 }, seo: { title: 'Docs', meta: 'Docs', slug: 'docs' },
    img: { style: 'illustration', seed: 1, prompt: 'A desk with a notebook', promptBy: 'owner', alt: 'Cover alt', url: `/api/files/${biz.id}/hero/old-cover.png`, urlKey: 'illustration:1', ...img } } as any;
  await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: a });
  return { user, biz, entry, a, id, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
const savedArticle = async (id: string) => (await db.select().from(schema.articles).where(eq(schema.articles.entryId, id)))[0].data as Article;

const results: Record<string, any> = {};
afterAll(async () => {
  if (process.env.QA_OUT) fs.writeFileSync(process.env.QA_OUT, JSON.stringify(results, null, 1));
  vi.unstubAllGlobals(); await F.cleanup();
});

describe.skipIf(!process.env.DATABASE_URL)('what each caller answers and stores', () => {
  for (const name of WHICH) {
    it(`the provider answers with: ${name}`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
      const R: Record<string, any> = (results[name] = {});
      const step = async (label: string, run: () => Promise<any>, after: () => Promise<any>) => {
        provider(ANSWERS[name]); const before = M.stored.length; M.reports.length = 0;
        const out = await withModel(() => outcome(run()));
        R[label] = { ...out, providerCalls: M.asked.length, stored: storedSince(before), reports: M.reports.map(r => ({ operation: r.operation, degraded: !!r.degraded })), after: await after() };
      };

      // 1. Social post, "regenerate with my own directions": strict (the post has an image prompt).
      const s1 = await socialFixture();
      await step('social.regenImage with a prompt (strict)', () => act(social, 'social.regenImage', s1.ctx, { packId: s1.id, platform: 'linkedin', prompt: 'Sobha Sapphire at sunset' }),
        async () => { const q = (await getPack(s1.biz.id, s1.id))!.posts.linkedin!; return { imageUrl: q.imageUrl === '/old-linkedin.png' ? 'the previous image' : 'a new file', seed: q.seed, style: q.style }; });
      // 2. Social post, a new style with no prompt: not strict.
      const s2 = await socialFixture();
      await step('social.style to illustration (not strict)', () => act(social, 'social.style', s2.ctx, { packId: s2.id, platform: 'linkedin', style: 'illustration' }),
        async () => { const q = (await getPack(s2.biz.id, s2.id))!.posts.linkedin!; return { imageUrl: q.imageUrl === '/old-linkedin.png' ? 'the previous image' : 'a new file', seed: q.seed, style: q.style, photo: (q as any).photo }; });
      // 3. Daily Brief visuals with custom directions: strict, in the brief.visuals job.
      const s3 = await socialFixture();
      await step('brief.visuals with a prompt (strict, job)', async () => { const r = await act(brief, 'brief.visuals', s3.ctx, { date: s3.day, id: s3.item.id, style: 'photography', n: 2, prompt: 'Sobha Sapphire at sunset' }); return runJob(r.jobId); },
        async () => { const it = (await getDay(s3.biz.id, s3.day))!.items[0] as BriefItem; return { status: it.img?.status, error: (it.img as any)?.error ?? null, urls: it.img?.urls.map(u => (u === '/old-brief.png' ? 'the previous image' : u ? 'a new file' : null)) }; });
      // 4. Daily Brief visuals in a model style, no directions: not strict.
      const s4 = await socialFixture();
      await step('brief.visuals without a prompt (not strict, job)', async () => { const r = await act(brief, 'brief.visuals', s4.ctx, { date: s4.day, id: s4.item.id, style: 'photography', n: 2 }); return runJob(r.jobId); },
        async () => { const it = (await getDay(s4.biz.id, s4.day))!.items[0] as BriefItem; return { status: it.img?.status, error: (it.img as any)?.error ?? null, urls: it.img?.urls.map(u => (u === '/old-brief.png' ? 'the previous image' : u ? 'a new file' : null)) }; });
      // 5. Article cover, a person types a direction and regenerates: strict.
      const a5 = await articleFixture({});
      await step('article.regenerateImage with a typed prompt (strict)', () => act(article as any, 'article.regenerateImage', a5.ctx, { entryId: a5.id, prompt: 'A lighthouse at dusk' }),
        async () => { const img = (await savedArticle(a5.id)).img; return { url: img.url?.endsWith('old-cover.png') ? 'the previous cover' : 'a new file', seed: img.seed, placeholder: img.placeholder?.reason ?? null, prompt: img.prompt }; });
      // 6. Article cover in a model style, regenerate with the direction the owner already has: strict for this request.
      const a6 = await articleFixture({});
      await step('article.regenerateImage, model style, no new prompt (strict)', () => act(article as any, 'article.regenerateImage', a6.ctx, { entryId: a6.id }),
        async () => { const img = (await savedArticle(a6.id)).img; return { url: img.url?.endsWith('old-cover.png') ? 'the previous cover' : 'a new file', seed: img.seed, placeholder: img.placeholder?.reason ?? null }; });
      // 7. Article cover, the style changes in the editor (autosave): not strict.
      const a7 = await articleFixture({ style: 'branded', urlKey: 'branded:1', promptBy: 'radar' });
      await step('article.save with a new model style (not strict)', () => act(article as any, 'article.save', a7.ctx, { entryId: a7.id, patch: { img: { style: 'illustration' } } }).then(() => 'saved'),
        async () => { const img = (await savedArticle(a7.id)).img; return { url: img.url?.endsWith('old-cover.png') ? 'the previous cover' : img.url ? 'a new file' : null, style: img.style, placeholder: img.placeholder?.reason ?? null }; });
      // 7b. The same with a cover whose direction requires the model (a person typed it earlier): strict.
      const a7b = await articleFixture({ style: 'branded', urlKey: 'branded:1', modelRequired: true });
      await step('article.save with a new style, cover requires the model (strict)', () => act(article as any, 'article.save', a7b.ctx, { entryId: a7b.id, patch: { img: { style: 'photography' } } }).then(() => 'saved'),
        async () => { const img = (await savedArticle(a7b.id)).img; return { url: img.url?.endsWith('old-cover.png') ? 'the previous cover' : img.url ? 'a new file' : null, style: img.style, placeholder: img.placeholder?.reason ?? null }; });
      // 8. Article body images: strict, every one. The function the article.bodyImages job calls, with no cached directions.
      const a8 = await articleFixture({});
      await step('generateArticleBodyImages (strict)', async () => (await generateArticleBodyImages({ businessId: a8.biz.id, progress: async () => {} } as any, entryFromRow(a8.entry), a8.a, { ...profile, domain: a8.biz.domain } as any)).length + ' images',
        async () => ({ bodyImages: ((await savedArticle(a8.id)).bodyImages || []).length }));

      // The cover template, for reference: a not-strict cover that fell back stores exactly these bytes.
      R.reference = { coverTemplate: sha(renderTemplatePng({ style: 'illustration', brand: BRAND, headline: 'Keeping docs current', name: 'Lived', seed: 1, w: 1200, h: 628 } as any)).slice(0, 12) };
      expect(Object.keys(R).length).toBe(10);
    });
  }
});
