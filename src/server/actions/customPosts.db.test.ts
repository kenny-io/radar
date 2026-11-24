// Custom posts (custom-post-scheduling architecture §9): real tenant-scoped pack rows, row locks, social_pubs, the stub
// adapters and the real child-process image decode. No AI, image model or network is ever reached.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.RADAR_BILLING = 'off';
  process.env.STORAGE_DIR = `.data/test-custom-posts/${process.pid}-${Date.now()}`;
  return { file: vi.fn(), postImage: vi.fn() };
});
vi.mock('../services/images', async original => ({ ...(await original<typeof import('../services/images')>()), renderImageFile: M.file }));
vi.mock('../services/social/generate', async original => {
  const m = await original<typeof import('../services/social/generate')>();
  return { ...m, renderPostImage: (...a: Parameters<typeof m.renderPostImage>) => { M.postImage(...a); return m.renderPostImage(...a); } };
});
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { and, eq, like } from 'drizzle-orm';
import { db, schema as S } from '../db';
import { ai } from '../ai';
import { ACTIONS } from '.';
import { gateBusiness, requireRole } from '../access';
import { encrypt } from '../crypto';
import { Fixtures } from '../testing/fixtures';
import { bizToday, defaultProfile, getBiz, loadWorkspace } from '../workspace';
import { getPack, updatePack, type StoredPack } from '../services/social/generate';
import { attachImage } from '../services/social/publish/upload';
import { attachVideo } from '../services/social/publish/video';
import { autoSchedule } from '../services/social/publish/schedule';
import { claimScheduled, runSend } from '../services/social/publish/send';
import { P, loadTarget } from '../services/social/publish/pubs';
import { setAdapterForTests } from '../services/social/publish/accounts';
import { stubAdapter, stubTokens } from '../services/social/publish/stubs';
import type { Adapter } from '../services/social/publish/api';
import { readStored, storedKey } from '../services/storage';
import { setAutopilot } from '../services/autopilot/control';
import { autopilotOf } from '../services/autopilot/policy';
import { runAutopilot } from '../services/autopilot/run';
import { jobDefs, type JobCtx } from '../jobs/queue';
import '../services/social/jobs';
import '../services/autopilot/jobs';
import { addDays } from '@/lib/format';
import { packSid, socialItems, zonedTimeToUtc } from '@/lib/socialPublish';
import type { Platform, SocialChannel, User } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
let owner: User, viewer: User, bid = '', foreign = '';
const accts: Partial<Record<SocialChannel, string>> = {};
const png = (w = 400, h = 300) => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#2255aa'; x.fillRect(0, 0, w, h); return c.toBuffer('image/png'); };
async function act(name: string, input: unknown, user: User = owner, b = bid) {
  const a = ACTIONS[name]; const role = await requireRole(b, user.id, a.role || (a.read ? 'Viewer' : 'Editor'));
  return a.run({ user, bid: b, role, biz: await getBiz(b) }, a.input ? a.input.parse(input) : input);
}
const create = (posts: { platform: Platform; text: string }[], name?: string): Promise<{ packId: string }> => act('social.createCustom', { posts, ...(name !== undefined ? { name } : {}) });
const pack = async (id: string) => (await getPack(bid, id))!;
const rowsFor = (id: string) => db.select().from(P).where(and(eq(P.businessId, bid), like(P.sid, `s:${id}:%`)));
async function pubAt(id: string, k: 'x' | 'linkedin', o: { status?: 'scheduled' | 'posted'; dueInMs: number }) {
  await db.insert(P).values({ businessId: bid, sid: packSid(id, k), src: 'pack', platform: k, ch: k === 'x' ? 'x' : 'li_profile', acctId: accts[k === 'x' ? 'x' : 'li_profile']!, acctLabel: 'Me', status: o.status || 'scheduled', date: bizToday(await getBiz(bid)), time: '12:00', dueAt: new Date(Date.now() + o.dueInMs), ...(o.status === 'posted' ? { postedAt: new Date() } : {}) });
}
/** The stub adapters, recording what each provider call received. */
const sent: { ch: string; kind: 'create' | 'upload' | 'publish'; p: any }[] = [];
function recording(ch: SocialChannel): Adapter {
  const base = stubAdapter(ch);
  return { ...base, upload: async (a, m) => { sent.push({ ch, kind: 'upload', p: m }); return base.upload(a, m); }, create: async (a, p) => { sent.push({ ch, kind: 'create', p }); return base.create(a, p); },
    ...(base.publish ? { publish: async (a, p) => { sent.push({ ch, kind: 'publish', p }); return base.publish!(a, p); } } : {}) };
}

describe.skipIf(!ON)('custom posts (database)', () => {
  beforeAll(async () => {
    owner = await F.user({ name: 'Custom owner' }) as unknown as User; viewer = await F.user({ name: 'Custom viewer' }) as unknown as User;
    const domain = `custom-${F.tag}.test`; const profile = defaultProfile(domain); profile.business.name = 'Custom Co';
    const b = await F.biz(owner as any, { domain, profile }); bid = b.id;
    await db.update(S.businesses).set({ timezone: 'America/New_York' }).where(eq(S.businesses.id, bid));
    await F.member(bid, viewer as any, 'Viewer');
    foreign = (await F.biz(viewer as any)).id;
    for (const ch of ['x', 'li_profile', 'instagram', 'tiktok'] as const) {
      const [a] = await db.insert(S.socialAccounts).values({ businessId: bid, ch, remoteId: `remote-${ch}-${F.tag}`, name: `My ${ch}`, handle: `@${ch}`, tokensEnc: encrypt(stubTokens(ch)), connectedBy: owner.id }).returning(); accts[ch] = a.id;
    }
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); process.env.RADAR_SOCIAL_PUBLISHING = 'all'; sent.length = 0;
    M.file.mockReset(); M.postImage.mockReset();
    M.file.mockImplementation(async () => { throw new Error('Radar must never render an image for a custom post'); });
    for (const ch of ['x', 'li_profile', 'instagram', 'tiktok'] as const) setAdapterForTests(ch, recording(ch));
    await db.delete(P).where(eq(P.businessId, bid));
    await db.update(S.businesses).set({ status: 'active', deletedAt: null, purgeAt: null, autopilot: {}, socialAuto: { on: false, post: 'library', freq: 'daily', days: [], platforms: ['x'], time: '08:00', style: 'branded' } }).where(eq(S.businesses.id, bid));
  });
  afterEach(() => { for (const ch of ['x', 'li_profile', 'instagram', 'tiktok'] as const) setAdapterForTests(ch, null); });
  afterAll(async () => {
    if (bid) await db.delete(S.jobs).where(eq(S.jobs.businessId, bid));
    await F.cleanup();
    await fs.rm(path.join(process.cwd(), process.env.STORAGE_DIR!), { recursive: true, force: true });
  });

  it('1. createCustom stores the user’s text verbatim with no job, no AI call and no reminder', async () => {
    const aiRun = vi.spyOn(ai, 'run');
    const jobsBefore = (await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).length;
    const long = 'Compare us with https://competitor.example/pricing 🎉 日本語 ' + 'a'.repeat(400);
    const { packId } = await create([{ platform: 'linkedin', text: '' }, { platform: 'x', text: long }, { platform: 'youtube', text: 'Watch <this>' }]);
    expect(packId).toMatch(/^c[0-9a-z]+[A-Za-z0-9_-]+$/); expect(packId.startsWith('auto-')).toBe(false); expect(packId).not.toContain(':');
    const p = await pack(packId);
    expect(p).toMatchObject({ source: { kind: 'custom', ref: null }, auto: false, order: ['linkedin', 'x', 'youtube'] });
    expect([...p.name].length).toBeLessThanOrEqual(64); expect(p.name.startsWith('Compare us with https://competitor.example/pricing')).toBe(true);
    expect(p.posts.x).toMatchObject({ author: 'user', text: long, imageUrl: null, imageMeta: null, v: 0 });
    expect(p.posts.linkedin).toMatchObject({ author: 'user', text: '' });
    expect(p.posts.youtube).toMatchObject({ author: 'user', publishOptions: { title: p.name.replace(/[<>]/g, '') }, publishOptionsRevision: 0 });
    expect(p.posts.youtube!.youtubeGeneratedTitle).toBeUndefined();
    expect(Object.values(p.posts).every(q => q!.author === 'user')).toBe(true);
    const emoji = await create([{ platform: 'youtube', text: 'Video' }], '🎉'.repeat(60));
    expect((await pack(emoji.packId)).posts.youtube!.publishOptions!.title).toHaveLength(100);
    const named = await create([{ platform: 'x', text: 'hi' }], '  Launch\u0007   day \n ');
    expect((await pack(named.packId)).name).toBe('Launch day');
    expect(aiRun).not.toHaveBeenCalled();
    expect((await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).length).toBe(jobsBefore);
    expect(await db.select().from(S.engagementEvents).where(eq(S.engagementEvents.businessId, bid))).toEqual([]);
    // The client sees the marker and the kind.
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    expect(ws.social.packs.find(x => x.id === packId)).toMatchObject({ source: { kind: 'custom' }, posts: { x: { author: 'user', text: long } } });
  });
  it('1b. createCustom refuses duplicate platforms, all-blank text and Viewers', async () => {
    await expect(create([{ platform: 'x', text: 'a' }, { platform: 'x', text: 'b' }])).rejects.toMatchObject({ status: 400, userMessage: 'Pick each platform once.', code: 'duplicate_platform' });
    await expect(create([{ platform: 'x', text: '  \n ' }, { platform: 'linkedin', text: '' }])).rejects.toMatchObject({ status: 400, userMessage: 'Write something to post.', code: 'empty' });
    await expect(act('social.createCustom', { posts: [{ platform: 'x', text: 'hi' }] }, viewer)).rejects.toMatchObject({ status: 403 });
    expect(ACTIONS['social.createCustom'].input!.safeParse({ posts: [{ platform: 'x', text: 'hi' }], extra: 1 }).success).toBe(false);
  });

  it('2. upload attaches, replaces and keeps the previous image on every refusal', async () => {
    const { packId } = await create([{ platform: 'x', text: 'With a picture' }, { platform: 'tiktok', text: 'Photo post' }]);
    await updatePack(bid, packId, p => ({ ...p, posts: { ...p.posts, x: { ...p.posts.x!, video: { url: '/v', meta: { bytes: 1, type: 'video/mp4' } }, slides: [{ url: '/s', alt: 'a', meta: { bytes: 1, type: 'image/jpeg' } }], mediaRevision: 4 }, tiktok: { ...p.posts.tiktok!, publishOptions: { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } } } } }));
    const biz = await getBiz(bid);
    const first = await attachImage(biz, packId, 'x', png(), owner.id);
    expect(first).toMatchObject({ meta: { type: 'image/png' }, width: 400, height: 300 });
    expect(storedKey(bid, first.url)?.startsWith(`${bid}/social-upload/`)).toBe(true);
    let x = (await pack(packId)).posts.x!;
    expect(x).toMatchObject({ imageUrl: first.url, imageMeta: first.meta, video: null, slides: null, mediaRevision: 5, compressed: false, author: 'user' });
    const second = await attachImage(biz, packId, 'x', png(500, 500), owner.id);
    expect(second.url).not.toBe(first.url); expect((await pack(packId)).posts.x!.imageUrl).toBe(second.url);
    for (const bad of [Buffer.from('GIF89a........'), png().subarray(0, 100), Buffer.from('<svg/>')]) await expect(attachImage(biz, packId, 'x', bad)).rejects.toMatchObject({ status: 400, code: 'invalid_image' });
    x = (await pack(packId)).posts.x!; expect(x.imageUrl).toBe(second.url); expect(x.mediaRevision).toBe(6);
    await attachImage(biz, packId, 'tiktok', png(), owner.id);
    expect((await pack(packId)).posts.tiktok).toMatchObject({ imageMeta: { type: 'image/jpeg' }, publishOptions: { tiktok: { consent: false } } });
    // Locked (sends in 3 minutes) and posted.
    await pubAt(packId, 'x', { dueInMs: 3 * 60_000 });
    await expect(attachImage(biz, packId, 'x', png())).rejects.toMatchObject({ status: 409, code: 'locked' });
    await db.update(P).set({ status: 'posted', postedAt: new Date() }).where(and(eq(P.businessId, bid), eq(P.sid, packSid(packId, 'x'))));
    await expect(attachImage(biz, packId, 'x', png())).rejects.toMatchObject({ status: 409, code: 'posted' });
    expect((await pack(packId)).posts.x!.imageUrl).toBe(second.url);
  });
  it('2b. upload refuses a pack Radar wrote, another business’s pack and YouTube', async () => {
    const gid = 'p-gen-' + F.tag;
    await db.insert(S.socialPacks).values({ id: gid, businessId: bid, data: { id: gid, name: 'Generated', source: { kind: 'idea', label: 'An idea' }, created: '2026-11-24', style: 'branded', auto: false, posts: { x: { text: 'Radar wrote this', style: 'branded', seed: 1, imageUrl: '/old.png', copiedAt: null, v: 0 } } } });
    const biz = await getBiz(bid);
    await expect(attachImage(biz, gid, 'x', png())).rejects.toMatchObject({ status: 409, code: 'not_custom', userMessage: 'Radar can only add your images to posts you wrote.' });
    expect((await pack(gid)).posts.x!.imageUrl).toBe('/old.png');
    const { packId } = await create([{ platform: 'x', text: 'Mine' }, { platform: 'youtube', text: 'Video' }]);
    await expect(attachImage(await getBiz(foreign), packId, 'x', png())).rejects.toMatchObject({ status: 404 });
    await expect(attachImage(biz, packId, 'youtube', png())).rejects.toMatchObject({ status: 400 });
    await expect(attachImage(biz, packId, 'linkedin', png())).rejects.toMatchObject({ status: 404 });
  });

  it('2c. a video on a custom post replaces the image, so removing the video never brings an old image back', async () => {
    const box = (type: string, data: Buffer) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); data.copy(b, 8); return b; };
    const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(6000, 16); const hdlr = Buffer.alloc(12); hdlr.write('vide', 8);
    const mp4 = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr)))])), box('mdat', Buffer.from([1]))]);
    const { packId } = await create([{ platform: 'instagram', text: 'Reel' }]);
    const biz = await getBiz(bid);
    const img = await attachImage(biz, packId, 'instagram', png(800, 800));
    await attachVideo(biz, packId, 'instagram', mp4);
    expect(await readStored(bid, img.url)).toBeNull(); // the replaced upload is deleted
    expect((await pack(packId)).posts.instagram).toMatchObject({ imageUrl: null, imageMeta: null, video: { meta: { type: 'video/mp4' } } });
    await act('social.videoRemove', { packId, platform: 'instagram' });
    expect((await pack(packId)).posts.instagram).toMatchObject({ imageUrl: null, video: null });
  });

  it('3. imageRemove clears the image with the same guards', async () => {
    const { packId } = await create([{ platform: 'x', text: 'Pic' }, { platform: 'facebook', text: 'Copy only' }]);
    const biz = await getBiz(bid);
    await attachImage(biz, packId, 'x', png()); await attachImage(biz, packId, 'facebook', png());
    const rev = (await pack(packId)).posts.x!.mediaRevision!;
    expect(await act('social.imageRemove', { packId, platform: 'facebook' })).toEqual({ removed: true });
    await pubAt(packId, 'x', { dueInMs: 3 * 60_000 });
    await expect(act('social.imageRemove', { packId, platform: 'x' })).rejects.toMatchObject({ status: 409, code: 'locked' });
    await db.delete(P).where(eq(P.businessId, bid));
    expect(await act('social.imageRemove', { packId, platform: 'x' })).toEqual({ removed: true });
    expect((await pack(packId)).posts.x).toMatchObject({ imageUrl: null, imageMeta: null, mediaRevision: rev + 1 });
    expect((await pack(packId)).posts.facebook).toMatchObject({ imageUrl: null });
    await expect(act('social.imageRemove', { packId, platform: 'x' }, viewer)).rejects.toMatchObject({ status: 403 });
    await expect(act('social.imageRemove', { packId, platform: 'x' }, viewer, foreign)).rejects.toMatchObject({ status: 404 });
    const gid = 'p-gen2-' + F.tag;
    await db.insert(S.socialPacks).values({ id: gid, businessId: bid, data: { id: gid, name: 'Generated', source: { kind: 'idea', label: 'An idea' }, created: '2026-11-24', style: 'branded', auto: false, posts: { x: { text: 'Radar', style: 'branded', seed: 1, imageUrl: '/old.png', copiedAt: null, v: 0 } } } });
    await expect(act('social.imageRemove', { packId: gid, platform: 'x' })).rejects.toMatchObject({ status: 409, code: 'not_custom' });
    expect((await pack(gid)).posts.x!.imageUrl).toBe('/old.png');
  });

  it('3b. replaced and removed uploads are deleted, except one a send recorded', async () => {
    const { packId } = await create([{ platform: 'x', text: 'Pictures' }]);
    const biz = await getBiz(bid);
    const first = await attachImage(biz, packId, 'x', png());
    const second = await attachImage(biz, packId, 'x', png(500, 500));
    expect(await readStored(bid, first.url)).toBeNull();
    expect(await readStored(bid, second.url)).not.toBeNull();
    await act('social.imageRemove', { packId, platform: 'x' });
    expect(await readStored(bid, second.url)).toBeNull();
    // A send snapshot recorded the file (a provider may still pull it): removing the image keeps the file.
    const third = await attachImage(biz, packId, 'x', png(600, 400));
    await pubAt(packId, 'x', { dueInMs: 24 * 3_600_000 });
    await db.update(P).set({ payload: { text: 'Pictures', media: [{ url: third.url, bytes: third.meta.bytes, type: third.meta.type }] } as any }).where(and(eq(P.businessId, bid), eq(P.sid, packSid(packId, 'x'))));
    await act('social.imageRemove', { packId, platform: 'x' });
    expect((await pack(packId)).posts.x!.imageUrl).toBeNull();
    expect(await readStored(bid, third.url)).not.toBeNull();
    await db.delete(P).where(eq(P.businessId, bid));
  });

  it('3c. an upload refused under the pack lock leaves no file behind', async () => {
    const { packId } = await create([{ platform: 'x', text: 'Busy' }]);
    const biz = await getBiz(bid);
    const kept = await attachImage(biz, packId, 'x', png());
    // Explainer generation is only checked under the lock, after the new file is stored.
    await updatePack(bid, packId, p => ({ ...p, posts: { ...p.posts, x: { ...p.posts.x!, mediaGeneration: { id: 'g', requestId: 'r', format: 'video', status: 'rendering', reason: '', overridden: false } } } }));
    const dir = path.join(process.cwd(), process.env.STORAGE_DIR!, bid, 'social-upload');
    const before = (await fs.readdir(dir)).length;
    await expect(attachImage(biz, packId, 'x', png(300, 300))).rejects.toMatchObject({ status: 409, code: 'media_pending' });
    expect((await fs.readdir(dir)).length).toBe(before);
    expect((await pack(packId)).posts.x!.imageUrl).toBe(kept.url);
    expect(await readStored(bid, kept.url)).not.toBeNull();
  });

  it('3d. a posted post’s text can no longer be changed', async () => {
    const { packId } = await create([{ platform: 'x', text: 'What went out' }, { platform: 'facebook', text: 'Copy only' }]);
    await pubAt(packId, 'x', { status: 'posted', dueInMs: -60_000 });
    await expect(act('social.text', { packId, platform: 'x', text: 'Something else' })).rejects.toMatchObject({ status: 409, code: 'posted' });
    expect((await pack(packId)).posts.x!.text).toBe('What went out');
    await act('social.text', { packId, platform: 'facebook', text: 'Still editable' }); // copy-and-paste platforms have no pub
    expect((await pack(packId)).posts.facebook!.text).toBe('Still editable');
    await db.delete(P).where(eq(P.businessId, bid));
  });

  it('4. every AI rewrite and media generation entry point refuses a custom pack', async () => {
    const { packId } = await create([{ platform: 'x', text: 'My words' }, { platform: 'instagram', text: 'My caption' }]);
    const before = await pack(packId);
    const refusals: [string, unknown][] = [
      ['social.regenText', { packId, platform: 'x' }],
      ['social.regenImage', { packId, platform: 'x' }],
      ['social.style', { packId, platform: 'x', style: 'photography' }],
      ['social.mediaPrepare', { packId, platforms: ['instagram'] }],
      ['social.mediaGenerate', { packId, choices: [{ platform: 'instagram', format: 'video' }] }],
      ['social.mediaStyle', { packId, platform: 'instagram', videoStyle: 'kinetic', expectedMediaRevision: 0 }],
    ];
    for (const [name, input] of refusals) await expect(act(name, input), name).rejects.toMatchObject({ status: 409, code: 'custom_pack', userMessage: 'You wrote this post, so Radar won’t rewrite it.' });
    // mediaRetry can only resume a generation one of the refused paths started; a custom pack has none.
    await expect(act('social.mediaRetry', { generationId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ status: 404 });
    expect(await pack(packId)).toEqual(before);
    expect(M.file).not.toHaveBeenCalled(); expect(M.postImage).not.toHaveBeenCalled();
    expect(await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), like(S.jobs.kind, 'social.media%')))).toEqual([]);
  });

  it('5. a text-only custom X post goes out with no image and no AI label; an uploaded image is not labelled AI', async () => {
    const { packId } = await create([{ platform: 'x', text: 'Just words' }, { platform: 'linkedin', text: 'With my photo' }]);
    // Control: the same post in a pack Radar wrote would be rendered before sending, and a photo would be labelled AI.
    const gid = 'p-gen3-' + F.tag;
    await db.insert(S.socialPacks).values({ id: gid, businessId: bid, data: { id: gid, name: 'Generated', source: { kind: 'idea', label: 'An idea' }, created: '2026-11-24', style: 'branded', auto: false, posts: { x: { text: 'Just words', style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0, photo: true } as any } } });
    expect(await loadTarget(bid, packSid(gid, 'x'))).toMatchObject({ needsRender: true, aiMedia: true });
    await updatePack(bid, packId, p => ({ ...p, posts: { ...p.posts, x: { ...p.posts.x!, photo: true } as any } }));
    expect(await loadTarget(bid, packSid(packId, 'x'))).toMatchObject({ needsRender: false, aiMedia: false, own: true, images: [] });
    const r = await act('social.postNow', { sid: packSid(packId, 'x'), acctId: accts.x });
    expect(r.pub.status).toBe('posted');
    expect(sent.filter(s => s.ch === 'x')).toEqual([{ ch: 'x', kind: 'create', p: { text: 'Just words', mediaIds: [], aiMedia: false } }]);
    expect((await pack(packId)).posts.x!.imageUrl).toBeNull();
    await attachImage(await getBiz(bid), packId, 'linkedin', png());
    await updatePack(bid, packId, p => ({ ...p, posts: { ...p.posts, linkedin: { ...p.posts.linkedin!, photo: true } as any } }));
    expect((await act('social.postNow', { sid: packSid(packId, 'linkedin'), acctId: accts.li_profile })).pub.status).toBe('posted');
    expect(sent.filter(s => s.ch === 'li_profile').map(s => s.kind)).toEqual(['upload', 'create']);
    expect(sent.find(s => s.ch === 'li_profile' && s.kind === 'create')!.p).toMatchObject({ text: 'With my photo', aiMedia: false });
    expect(M.file).not.toHaveBeenCalled(); expect(M.postImage).not.toHaveBeenCalled();
  });

  it('6. C1: LinkedIn tomorrow 14:00 and X tomorrow 12:00, each sent at its own time with its own text', async () => {
    const { packId } = await create([{ platform: 'linkedin', text: 'The LinkedIn version, longer and calmer.' }, { platform: 'x', text: 'The X version 🚀' }], 'Launch');
    const biz = await getBiz(bid); const tomorrow = addDays(bizToday(biz), 1);
    await act('social.schedule', { sid: packSid(packId, 'linkedin'), date: tomorrow, time: '14:00', acctId: accts.li_profile });
    await act('social.schedule', { sid: packSid(packId, 'x'), date: tomorrow, time: '12:00', acctId: accts.x });
    const rows = await rowsFor(packId);
    const due = (k: string) => rows.find(r => r.platform === k)!.dueAt.getTime();
    expect(due('linkedin')).toBe(zonedTimeToUtc(tomorrow, '14:00', 'America/New_York'));
    expect(due('x')).toBe(zonedTimeToUtc(tomorrow, '12:00', 'America/New_York'));
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    const wp = ws.social.packs.find(p => p.id === packId)!;
    expect(wp.posts.linkedin!.pub).toMatchObject({ status: 'scheduled', date: tomorrow, time: '14:00' });
    expect(wp.posts.x!.pub).toMatchObject({ status: 'scheduled', date: tomorrow, time: '12:00' });
    expect(socialItems(ws, Date.now()).filter(i => i.packId === packId).map(i => [i.k, i.time, i.status])).toEqual([['x', '12:00', 'scheduled'], ['linkedin', '14:00', 'scheduled']]);
    // X comes due first.
    const xRow = rows.find(r => r.platform === 'x')!; const liRow = rows.find(r => r.platform === 'linkedin')!;
    await db.update(P).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(P.id, xRow.id));
    expect(await claimScheduled(liRow.id)).toBeNull();
    const x = await runSend((await claimScheduled(xRow.id))!, { manual: false });
    expect(x).toMatchObject({ status: 'posted' }); expect(x!.remoteUrl).toBeTruthy();
    expect((await rowsFor(packId)).find(r => r.platform === 'linkedin')!.status).toBe('scheduled');
    await db.update(P).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(P.id, liRow.id));
    expect(await runSend((await claimScheduled(liRow.id))!, { manual: false })).toMatchObject({ status: 'posted' });
    expect(sent.filter(s => s.kind === 'create').map(s => [s.ch, s.p.text, s.p.mediaIds])).toEqual([['x', 'The X version 🚀', []], ['li_profile', 'The LinkedIn version, longer and calmer.', []]]);
    const after = (await loadWorkspace(bid, owner.id, 'Owner')).social.packs.find(p => p.id === packId)!;
    expect(after.posts.x!.pub).toMatchObject({ status: 'posted', url: expect.any(String) });
    expect(after.posts.linkedin!.pub).toMatchObject({ status: 'posted', url: expect.any(String) });
  });

  it('7. an edit after scheduling is what gets sent, and is checked again', async () => {
    const { packId } = await create([{ platform: 'x', text: 'Short and fine' }]);
    const tomorrow = addDays(bizToday(await getBiz(bid)), 1);
    await act('social.schedule', { sid: packSid(packId, 'x'), date: tomorrow, time: '12:00', acctId: accts.x });
    await act('social.text', { packId, platform: 'x', text: 'a'.repeat(300) });
    expect((await pack(packId)).posts.x!.text).toHaveLength(300);
    const [row] = await rowsFor(packId);
    await db.update(P).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(P.id, row.id));
    const failed = await runSend((await claimScheduled(row.id))!, { manual: false });
    expect(failed).toMatchObject({ status: 'failed', errCode: 'too_long', err: 'Shorten to 280 characters to post on X. It’s 300 now.' });
    expect(sent).toEqual([]);
    await act('social.text', { packId, platform: 'x', text: 'Fixed it' });
    expect((await act('social.postNow', { sid: packSid(packId, 'x'), acctId: accts.x })).pub.status).toBe('posted');
    expect(sent.map(s => s.p.text)).toEqual(['Fixed it']);
  });

  it('8. publishing off: create and image upload work; scheduling is not offered', async () => {
    process.env.RADAR_SOCIAL_PUBLISHING = 'off';
    const { packId } = await create([{ platform: 'x', text: 'Copy me' }, { platform: 'reddit', text: 'Copy me too' }]);
    await attachImage(await getBiz(bid), packId, 'x', png());
    await expect(act('social.schedule', { sid: packSid(packId, 'x'), date: addDays(bizToday(await getBiz(bid)), 1), time: '12:00' })).rejects.toMatchObject({ status: 404, code: 'not_enabled' });
    const wp = (await loadWorkspace(bid, owner.id, 'Owner')).social.packs.find(p => p.id === packId)!;
    expect(wp.posts.x!.imageUrl).toMatch(/social-upload/);
    expect('pub' in wp.posts.x!).toBe(false); expect('imageMeta' in wp.posts.x!).toBe(false);
    expect(await rowsFor(packId)).toEqual([]);
  });

  it('9. automatic code never schedules or rewrites a custom pack', async () => {
    await db.update(S.businesses).set({ timezone: 'UTC', socialAuto: { on: true, post: 'schedule', freq: 'daily', days: [], platforms: ['x', 'linkedin'], time: '08:00', style: 'branded' } }).where(eq(S.businesses.id, bid));
    const { packId } = await create([{ platform: 'x', text: 'Ready to go' }, { platform: 'linkedin', text: 'Also ready' }]);
    const before = await pack(packId);
    expect(await autoSchedule(bid, packId)).toBe(0);
    expect(await rowsFor(packId)).toEqual([]);
    const ctx = { user: owner, bid, role: 'Owner', biz: await getBiz(bid) } as any;
    await setAutopilot(ctx, true); const a = autopilotOf(await getBiz(bid));
    const runCtx = (): JobCtx<any> => ({ businessId: bid, payload: { activationId: a.activationId }, attempt: 1, job: { id: crypto.randomUUID(), maxAttempts: 3 } as any, progress: async () => {}, touch: async () => {} });
    await runAutopilot(runCtx()); await runAutopilot(runCtx());
    const autoJobs = await db.select().from(S.jobs).where(and(eq(S.jobs.businessId, bid), eq(S.jobs.kind, 'social.autoRun')));
    expect(autoJobs.length).toBeGreaterThan(0);
    for (const job of autoJobs) {
      M.file.mockImplementation(async (req: any) => ({ url: `/api/files/${req.bid}/social/auto-${Date.now()}.png`, bytes: 10, type: 'image/png' }));
      await jobDefs().get('social.autoRun')!.run({ ...runCtx(), job, payload: job.payload });
    }
    await runAutopilot(runCtx());
    expect(await rowsFor(packId)).toEqual([]);
    expect(await pack(packId)).toEqual(before);
    await setAutopilot({ ...ctx, biz: await getBiz(bid) }, false);
  }, 60_000);

  it('10. a deleted business can do nothing', async () => {
    const gone = (await F.biz(owner as any, { status: 'deleted' })).id;
    await expect(requireRole(gone, owner.id, 'Editor')).rejects.toMatchObject({ status: 404 });
    await expect(gateBusiness({ id: owner.id, guest: false } as any, gone)).rejects.toMatchObject({ status: 404 });
    await expect(act('social.createCustom', { posts: [{ platform: 'x', text: 'hi' }] }, owner, gone)).rejects.toMatchObject({ status: 404 });
    expect(await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId, gone))).toEqual([]);
  });
});
