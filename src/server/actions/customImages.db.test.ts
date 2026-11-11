// Real tenant-scoped JSON persistence, row locks, publication locks and job ownership; image provider/storage is mocked.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all';
  return { file: vi.fn(), render: vi.fn() };
});
vi.mock('../services/images', () => ({ renderImageFile: M.file, renderImage: M.render, imageModelConfigured: () => true, defaultArticleImageStyle: () => 'branded', MODEL_STYLES: ['illustration', 'photography'] }));
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures } from '../testing/fixtures';
import { requireRole } from '../access';
import { RadarError } from '../errors';
import { bizToday, getBiz, loadWorkspace } from '../workspace';
import { getJob, jobDefs, type JobCtx } from '../jobs/queue';
import { actions as social } from './social';
import { actions as brief } from './brief';
import { actions as article } from './article';
import { getPack, updatePack } from '../services/social/generate';
import { getDay, withDay } from '../services/brief/store';
import { briefSid, packSid } from '@/lib/socialPublish';
import type { BriefItem, Profile, SocialPack } from '@/lib/types';

const F = new Fixtures(); let seq = 0;
const profile = { domain: 'lived.test', business: { name: 'Lived' }, brand: { primary: '#123456', secondary: '#abcdef' }, audience: { competitors: [] }, keywords: { list: [] } } as unknown as Profile;
async function fixture() {
  const user = await F.user(); const biz = await F.biz(user, { profile }); const day = bizToday(biz);
  const id = `p_custom_${F.tag}_${++seq}`;
  const pack: SocialPack = { id, name: 'Sobha Sapphire', source: { kind: 'idea', label: 'Resident views of Sobha Sapphire' }, created: day, style: 'branded', auto: false, posts: {
    linkedin: { text: 'Keep this LinkedIn post', style: 'branded', seed: 1, imageUrl: '/old-linkedin.png', imageMeta: { bytes: 99, type: 'image/png' }, copiedAt: null, v: 0 },
    x: { text: 'Keep this X post', style: 'branded', seed: 2, imageUrl: '/old-x.png', copiedAt: null, v: 0 },
  } };
  await db.insert(schema.socialPacks).values({ id, businessId: biz.id, data: pack });
  const item: BriefItem = { id: 'post' + seq, kind: 'post', title: 'Sobha Sapphire', tag: 'Housing', why: 'Useful', st: 'open', drafts: { linkedin: 'The post says something specific.' }, edits: {}, mention: false, plats: ['linkedin'], pl: 'linkedin', img: { style: 'editorial', seed: 5, n: 1, urls: ['/old-brief.png'], meta: [{ bytes: 99, type: 'image/png' }], status: 'ready' } };
  await db.insert(schema.briefDays).values({ businessId: biz.id, date: day, scannedAt: new Date().toISOString(), items: [item] });
  return { user, biz, day, id, pack, item, ctx: { user, biz, bid: biz.id, role: 'Owner' } as any };
}
const act = (map: typeof social, name: string, ctx: any, input: any) => map[name].run(ctx, map[name].input!.parse(input));
const savedItem = async (f: Awaited<ReturnType<typeof fixture>>) => (await getDay(f.biz.id, f.day))!.items[0] as BriefItem;
async function publication(f: Awaited<ReturnType<typeof fixture>>, sid: string, src: 'pack' | 'brief') {
  await db.insert(schema.socialPubs).values({ businessId: f.biz.id, sid, src, platform: 'linkedin', ch: 'li_profile', acctLabel: 'Lived', status: 'scheduled', date: f.day, time: '12:00', dueAt: new Date(Date.now() + 60_000) });
}
async function runDefined(id: string) {
  await db.update(schema.jobs).set({ status: 'running', lockedBy: 'custom-image-test', lockedAt: new Date() }).where(eq(schema.jobs.id, id));
  const job = (await getJob(id))!;
  const ctx: JobCtx = { job, payload: job.payload, businessId: job.businessId, attempt: job.attempts, progress: async () => {}, touch: async () => {} };
  try { const result = await jobDefs().get(job.kind)!.run(ctx); await db.update(schema.jobs).set({ status: 'done', result }).where(eq(schema.jobs.id, id)); return result; }
  catch (error) { await db.update(schema.jobs).set({ status: 'failed' }).where(eq(schema.jobs.id, id)); throw error; }
}
beforeEach(() => {
  M.file.mockReset(); M.render.mockReset(); let n = 0;
  M.file.mockImplementation(async req => ({ url: `/api/files/${req.bid}/${req.kind}/custom-${++n}.png`, bytes: 1234, type: 'image/png' }));
});
afterAll(() => F.cleanup());

describe('custom image input validation', () => {
  it('trims explicit requests, rejects whitespace/overlong inputs and preserves old omitted-prompt calls', () => {
    for (const [map, name, base] of [[social, 'social.regenImage', { packId: 'p', platform: 'linkedin' }], [brief, 'brief.visuals', { date: '2026-10-31', id: 'post1', style: 'editorial' }], [article, 'article.regenerateImage', { entryId: 'e' }]] as const) {
      const schema = map[name].input!;
      expect(schema.parse({ ...base, prompt: '  A building  ' })).toMatchObject({ prompt: 'A building' });
      expect(schema.safeParse({ ...base, prompt: '  ' }).success).toBe(false);
      expect(schema.safeParse({ ...base, prompt: 'x'.repeat(1001) }).success).toBe(false);
      expect(schema.safeParse(base).success).toBe(true);
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)('custom social images (database)', () => {
  it('sends a selected platform subject with exact dimensions, persists it on reload and reuses it on regeneration', async () => {
    const f = await fixture();
    await act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: '  Sobha Sapphire at sunset  ' });
    expect(M.file.mock.calls[0][0]).toMatchObject({ style: 'branded', prompt: 'Sobha Sapphire at sunset', modelRequired: true, w: 1200, h: 628 });
    const pack = (await getPack(f.biz.id, f.id))!;
    expect(pack.posts.linkedin).toMatchObject({ imagePrompt: 'Sobha Sapphire at sunset', imageMeta: { bytes: 1234, type: 'image/png' }, text: f.pack.posts.linkedin!.text });
    expect(pack.posts.x).toEqual(f.pack.posts.x);
    await act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin' });
    expect(M.file.mock.calls[1][0]).toMatchObject({ prompt: 'Sobha Sapphire at sunset', modelRequired: true });
    await act(social, 'social.style', f.ctx, { packId: f.id, platform: 'linkedin', style: 'photography' });
    expect(M.file.mock.calls[2][0]).toMatchObject({ style: 'photography', prompt: 'Sobha Sapphire at sunset', modelRequired: true });
  });
  it('keeps existing image metadata and a retryable desired prompt when model or storage fails', async () => {
    const f = await fixture(); M.file.mockRejectedValue(new Error('storage down'));
    await expect(act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'A new subject' })).rejects.toMatchObject({ code: 'image_failed' });
    const post = (await getPack(f.biz.id, f.id))!.posts.linkedin!;
    expect(post).toMatchObject({ imageUrl: '/old-linkedin.png', imageMeta: { bytes: 99, type: 'image/png' }, seed: 1, imagePrompt: 'A new subject' });
    M.file.mockRejectedValue(new RadarError('Image generation is unavailable right now. Please contact support to enable it.', 503, 'image_unavailable'));
    await expect(act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin' })).rejects.toMatchObject({ code: 'image_unavailable', status: 503 });
  });
  it('preserves concurrent text, copied state and another platform while committing only the completed image', async () => {
    const f = await fixture();
    M.file.mockImplementation(async req => {
      await updatePack(f.biz.id, f.id, p => ({ ...p, posts: { ...p.posts, linkedin: { ...p.posts.linkedin!, text: 'New edited text', copiedAt: 123 }, x: { ...p.posts.x!, text: 'Other platform edited' } } }));
      return { url: `/api/files/${req.bid}/social/new.png`, bytes: 456, type: 'image/png' };
    });
    await act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'A building' });
    const pack = (await getPack(f.biz.id, f.id))!;
    expect(pack.posts.linkedin).toMatchObject({ text: 'New edited text', copiedAt: 123, imageUrl: `/api/files/${f.biz.id}/social/new.png` });
    expect(pack.posts.x!.text).toBe('Other platform edited');
  });
  it('rejects stale completion after a newer request and rechecks a newly scheduled publication', async () => {
    const f = await fixture(); let first = true;
    M.file.mockImplementation(async req => {
      if (first) { first = false; await act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'Newest subject' }); }
      return { url: `/api/files/${req.bid}/social/${req.prompt}.png`, bytes: 100, type: 'image/png' };
    });
    await expect(act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'Stale subject' })).rejects.toMatchObject({ code: 'image_changed' });
    expect((await getPack(f.biz.id, f.id))!.posts.linkedin!.imageUrl).toContain('Newest subject');
    M.file.mockImplementation(async () => { await publication(f, packSid(f.id, 'linkedin'), 'pack'); return { url: '/new-but-locked.png', bytes: 100, type: 'image/png' }; });
    await expect(act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'Queued subject' })).rejects.toMatchObject({ code: 'locked' });
    expect((await getPack(f.biz.id, f.id))!.posts.linkedin!.imageUrl).toContain('Newest subject');
  });
  it('rejects tenant mismatches, locked posts and Viewer writes before rendering', async () => {
    const f = await fixture(); const other = await fixture();
    await expect(act(social, 'social.regenImage', other.ctx, { packId: f.id, platform: 'linkedin', prompt: 'Foreign' })).rejects.toMatchObject({ status: 404 });
    await publication(f, packSid(f.id, 'linkedin'), 'pack');
    await expect(act(social, 'social.regenImage', f.ctx, { packId: f.id, platform: 'linkedin', prompt: 'Locked' })).rejects.toMatchObject({ code: 'locked' });
    const viewer = await F.user(); await F.member(f.biz.id, viewer, 'Viewer');
    for (const [map, name] of [[social, 'social.regenImage'], [brief, 'brief.visuals'], [article, 'article.regenerateImage']] as const) await expect(requireRole(f.biz.id, viewer.id, map[name].role || 'Editor')).rejects.toMatchObject({ status: 403 });
    expect(M.file).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.DATABASE_URL)('custom Daily Brief visuals (database)', () => {
  it('persists prompt and pending settings, replaces a complete set atomically and keeps edited post text', async () => {
    const f = await fixture();
    const r = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'photography', n: 2, prompt: 'Sobha Sapphire at sunset' });
    expect((await savedItem(f)).img).toMatchObject({ urls: ['/old-brief.png'], status: 'generating', prompt: 'Sobha Sapphire at sunset', pending: { style: 'photography', n: 2 }, jobId: r.jobId });
    let calls = 0;
    M.file.mockImplementation(async req => {
      expect((await savedItem(f)).img!.urls).toEqual(['/old-brief.png']);
      await withDay(f.biz.id, f.day, row => ({ items: (row.items as BriefItem[]).map(it => ({ ...it, edits: { linkedin: 'Edited during generation' } })), ret: true }));
      return { url: `/api/files/${req.bid}/brief/${++calls}.png`, bytes: 987, type: 'image/png' };
    });
    await runDefined(r.jobId);
    const saved = await savedItem(f);
    expect(saved.edits.linkedin).toBe('Edited during generation');
    expect(saved.img).toMatchObject({ style: 'photography', n: 2, prompt: 'Sobha Sapphire at sunset', status: 'ready', meta: [{ bytes: 987, type: 'image/png' }, { bytes: 987, type: 'image/png' }] });
    expect(saved.img!.urls).toHaveLength(2); expect(saved.img!.pending).toBeUndefined();
    expect(M.file.mock.calls.every(([req]) => req.modelRequired && req.prompt === 'Sobha Sapphire at sunset' && req.w === 1200 && req.h === 675)).toBe(true);
  });
  it('a partial custom failure retains the complete prior set and desired settings for retry', async () => {
    const f = await fixture();
    const r = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'photography', n: 2, prompt: 'A building' });
    M.file.mockResolvedValueOnce({ url: '/partial.png', bytes: 100, type: 'image/png' }).mockRejectedValueOnce(new Error('provider failed'));
    await expect(runDefined(r.jobId)).rejects.toMatchObject({ code: 'image_failed' });
    expect((await savedItem(f)).img).toMatchObject({ urls: ['/old-brief.png'], meta: f.item.img!.meta, status: 'failed', prompt: 'A building', pending: { style: 'photography', n: 2 } });
    M.file.mockResolvedValue({ url: '/retry.png', bytes: 200, type: 'image/png' });
    const retry = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'photography', n: 2 });
    await runDefined(retry.jobId);
    expect((await savedItem(f)).img).toMatchObject({ prompt: 'A building', status: 'ready', urls: ['/retry.png', '/retry.png'] });
  });
  it('does not apply stale output after remove/re-add even when random seeds collide', async () => {
    const f = await fixture(); const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      const old = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'Old subject' });
      const oldJob = (await getJob(old.jobId))!;
      await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: null });
      const latest = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'New subject' });
      expect((await getJob(latest.jobId))!.payload.seed).toBe(oldJob.payload.seed);
      expect(await runDefined(old.jobId)).toEqual({ skipped: true });
      expect(M.file).not.toHaveBeenCalled();
      await runDefined(latest.jobId);
      expect((await savedItem(f)).img).toMatchObject({ prompt: 'New subject', status: 'ready' });
    } finally { random.mockRestore(); }
  });
  it('an expired worker cannot overwrite the previous set and a publication scheduled mid-render stays unchanged', async () => {
    const f = await fixture();
    const r = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'Building' });
    M.file.mockImplementation(async () => { await db.update(schema.jobs).set({ attempts: 99, lockedBy: 'new-worker' }).where(eq(schema.jobs.id, r.jobId)); return { url: '/stale.png', bytes: 100, type: 'image/png' }; });
    await expect(runDefined(r.jobId)).rejects.toMatchObject({ code: 'stale_job' });
    expect((await savedItem(f)).img!.urls).toEqual(['/old-brief.png']);
    const retry = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'Building again' });
    M.file.mockImplementation(async () => { await publication(f, briefSid(f.day, f.item.id), 'brief'); return { url: '/locked.png', bytes: 100, type: 'image/png' }; });
    expect(await runDefined(retry.jobId)).toEqual({ skipped: true });
    expect((await savedItem(f)).img!.urls).toEqual(['/old-brief.png']);
  });
  it('reloads an aged failed/expired visual job as retryable while preserving the prior complete set and prompt', async () => {
    const f = await fixture();
    const r = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'photography', n: 2, prompt: 'Keep this custom subject' });
    await db.update(schema.jobs).set({ status: 'failed', finishedAt: new Date(Date.now() - 10 * 60_000), error: 'Radar couldn’t finish this. Try again.' }).where(eq(schema.jobs.id, r.jobId));
    const workspace = await loadWorkspace(f.biz.id, f.user.id, 'Owner');
    expect(workspace.jobs.some(job => job.id === r.jobId)).toBe(false); // aged out of the ordinary recent feed
    expect(workspace.brief.days[f.day].items[0].img).toMatchObject({ status: 'failed', urls: ['/old-brief.png'], prompt: 'Keep this custom subject', pending: { style: 'photography', n: 2 } });
    // A later current request is not failed by the older terminal job.
    const latest = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'New request' });
    expect((await loadWorkspace(f.biz.id, f.user.id, 'Owner')).brief.days[f.day].items[0].img).toMatchObject({ status: 'generating', jobId: latest.jobId, prompt: 'New request' });
  });
  it('rejects scheduled/past/foreign requests and keeps legacy default visuals usable', async () => {
    const f = await fixture(); const other = await fixture();
    await expect(act(brief, 'brief.visuals', other.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'Foreign' })).rejects.toMatchObject({ status: 404 });
    await expect(act(brief, 'brief.visuals', f.ctx, { date: '2000-01-01', id: f.item.id, style: 'editorial', prompt: 'Past' })).rejects.toMatchObject({ code: 'read_only' });
    const r = await act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'flat', n: 1 });
    await runDefined(r.jobId);
    expect(M.file.mock.calls[0][0]).toMatchObject({ modelRequired: false, style: 'flat' });
    await publication(f, briefSid(f.day, f.item.id), 'brief');
    await expect(act(brief, 'brief.visuals', f.ctx, { date: f.day, id: f.item.id, style: 'editorial', prompt: 'Scheduled' })).rejects.toMatchObject({ status: 409 });
  });
});
