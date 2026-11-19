import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.STORAGE_DIR = `.data/test-multiplatform-uploads/${process.pid}-${Date.now()}`; });
import fs from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema as S } from '../../../db';
import { ACTIONS } from '../../../actions';
import { requireRole } from '../../../access';
import { getBiz, loadWorkspace, defaultProfile } from '../../../workspace';
import { encrypt } from '../../../crypto';
import { objectKey, putObject, readStored, storedKey } from '../../storage';
import { getPack, updatePack } from '../generate';
import { setAdapterForTests } from './accounts';
import { stubAdapter, stubTokens } from './stubs';
import { SendError, type Adapter } from './api';
import { attachVideo } from './video';
import { P, loadTarget } from './pubs';
import { recoverStuck } from './send';
import { instagramAdapter } from './instagram';
import { env } from '../../../env';
const savedAppUrl = env.appUrl;
import type { SocialChannel, SocialPost, User } from '@/lib/types';

const ON = !!process.env.DATABASE_URL;
const PACK = 'multiplatform-' + Date.now().toString(36);
let owner: User, viewer: User, bid: string, foreign: string;
const ids: Partial<Record<SocialChannel, string>> = {};
const basePost = (): SocialPost => ({ text: 'A useful caption', style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 });
const box = (type: string, data: Buffer) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); data.copy(b, 8); return b; };
function mp4() { const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(6000, 16); const hdlr = Buffer.alloc(12); hdlr.write('vide', 8); return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr)))])), box('mdat', Buffer.from([1]))]); }
const pub = async (platform: string) => (await db.select().from(P).where(and(eq(P.businessId, bid), eq(P.sid, `s:${PACK}:${platform}`))))[0];
async function act(name: string, input: unknown, user = owner) { const a = ACTIONS[name]; const role = await requireRole(bid, user.id, a.role || (a.read ? 'Viewer' : 'Editor')); return a.run({ user, bid, role, biz: await getBiz(bid) }, a.input ? a.input.parse(input) : input); }
async function options(platform: string, options: unknown) { return act('social.publishOptions', { packId: PACK, platform, options }); }
async function age(platform: string) { const p = await pub(platform); await db.update(P).set({ claimedAt: new Date(Date.now() - 181_000) }).where(eq(P.id, p.id)); return p.id; }

describe.skipIf(!ON)('direct multiplatform publishing integration', () => {
  beforeAll(async () => {
    const tag = Date.now().toString(36);
    [owner] = await db.insert(S.users).values({ name: 'Video owner', email: `video-owner-${tag}@test.local` }).returning() as any;
    [viewer] = await db.insert(S.users).values({ name: 'Video viewer', email: `video-viewer-${tag}@test.local` }).returning() as any;
    const [b] = await db.insert(S.businesses).values({ ownerId: owner.id, status: 'active', domain: `${tag}.test`, profile: { ...defaultProfile(`${tag}.test`), business: { ...defaultProfile(`${tag}.test`).business, name: 'Video Co' } } }).returning(); bid = b.id;
    const [f] = await db.insert(S.businesses).values({ ownerId: viewer.id, status: 'active', domain: `foreign-${tag}.test`, profile: defaultProfile(`foreign-${tag}.test`) }).returning(); foreign = f.id;
    await db.insert(S.members).values([{ businessId: bid, userId: owner.id, email: owner.email, role: 'Owner' }, { businessId: bid, userId: viewer.id, email: viewer.email, role: 'Viewer' }]);
    for (const ch of ['instagram', 'tiktok', 'youtube'] as const) {
      const [a] = await db.insert(S.socialAccounts).values({ businessId: bid, ch, remoteId: `remote-${ch}`, name: `My ${ch}`, handle: `@${ch}`, tokensEnc: encrypt(stubTokens(ch)), connectedBy: owner.id }).returning(); ids[ch] = a.id;
    }
    await db.insert(S.socialPacks).values({ id: PACK, businessId: bid, data: { id: PACK, name: 'Videos', source: { kind: 'idea', label: 'Useful practical ideas' }, created: '2026-11-19', style: 'branded', auto: false, posts: {} } });
  });
  beforeEach(async () => {
    process.env.RADAR_SOCIAL_PUBLISHING = 'all';
    env.appUrl = 'https://multiplatform.test';
    for (const ch of ['instagram', 'tiktok', 'youtube'] as const) setAdapterForTests(ch, null);
    await db.update(S.businesses).set({ status: 'active', deletedAt: null, purgeAt: null }).where(eq(S.businesses.id, bid));
    await db.delete(P).where(eq(P.businessId, bid));
    await db.update(S.socialAccounts).set({ expired: false }).where(eq(S.socialAccounts.businessId, bid));
    await updatePack(bid, PACK, p => ({ ...p, posts: { instagram: basePost(), tiktok: basePost(), youtube: { ...basePost(), photo: true } as SocialPost } }));
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    env.appUrl = savedAppUrl;
    for (const ch of ['instagram', 'tiktok', 'youtube'] as const) setAdapterForTests(ch, null);
    if (bid) await db.delete(S.businesses).where(eq(S.businesses.id, bid));
    if (foreign) await db.delete(S.businesses).where(eq(S.businesses.id, foreign));
    if (owner) await db.delete(S.users).where(eq(S.users.id, owner.id));
    if (viewer) await db.delete(S.users).where(eq(S.users.id, viewer.id));
    await fs.rm(path.join(process.cwd(), process.env.STORAGE_DIR!), { recursive: true, force: true });
  });
  it('posts generated JPEG media to the Instagram account and projects the returned link', async () => {
    const r = await act('social.postNow', { sid: `s:${PACK}:instagram`, acctId: ids.instagram });
    expect(r.pub.status).toBe('posted'); expect(r.pub.url).toContain('instagram.com');
    const post = (await getPack(bid, PACK))!.posts.instagram!;
    expect(post.imageMeta?.type).toBe('image/jpeg');
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    expect(ws.social.packs.find(p => p.id === PACK)!.posts.instagram!.pub?.status).toBe('posted');
    expect(JSON.stringify(ws.social.accounts)).not.toContain('access_token');
  });
  it('sends every generated carousel slide in order through the actual Instagram adapter', async () => {
    const bytes = createCanvas(108, 135).toBuffer('image/jpeg');
    const slides = await Promise.all([1, 2, 3].map(async n => ({ url: await putObject(objectKey(bid, 'slide', 'jpg'), bytes, 'image/jpeg'), alt: `Step ${n}`, meta: { bytes: 1, type: 'image/png' } })));
    await updatePack(bid, PACK, p => ({ ...p, posts: { ...p.posts, instagram: { ...p.posts.instagram!, imageUrl: 'unused-thumbnail', slides, generatedMedia: { id: 'render', format: 'carousel', sourceHash: 'source', aiGenerated: true } } } }));
    const bodies: URLSearchParams[] = []; let child = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit = {}) => {
      const body = new URLSearchParams(String(init.body || ''));
      if (body.get('image_url')) { bodies.push(body); return Response.json({ id: String(100 + ++child) }); }
      if (body.get('media_type') === 'CAROUSEL') { bodies.push(body); return Response.json({ id: '999' }); }
      if (String(_url).includes('status_code')) return Response.json({ status_code: 'FINISHED' });
      if (String(_url).endsWith('/media_publish')) return Response.json({ id: '777' });
      return Response.json({ permalink: 'https://www.instagram.com/p/carousel/' });
    }));
    setAdapterForTests('instagram', instagramAdapter);
    const r = await act('social.postNow', { sid: `s:${PACK}:instagram`, acctId: ids.instagram });
    expect(r.pub.status).toBe('posted');
    expect(bodies.slice(0, 3).map(body => body.get('image_url'))).toEqual(slides.map(slide => new URL(slide.url, env.appUrl).toString()));
    expect(bodies.slice(0, 3).every(body => body.get('is_carousel_item') === 'true')).toBe(true);
    expect(bodies[3].get('children')).toBe('101,102,103');
    const post = (await getPack(bid, PACK))!.posts.instagram!;
    expect(post.slides?.every(slide => slide.meta.type === 'image/jpeg' && slide.meta.bytes === bytes.length)).toBe(true);
  });
  it('blocks pending replacement before claim and retains a carousel when video upload is refused', async () => {
    const bytes = createCanvas(108, 135).toBuffer('image/jpeg');
    const url = await putObject(objectKey(bid, 'slide', 'jpg'), bytes, 'image/jpeg');
    await updatePack(bid, PACK, p => ({ ...p, posts: { ...p.posts, instagram: { ...p.posts.instagram!, slides: [1, 2, 3].map(n => ({ url, meta: { bytes: bytes.length, type: 'image/jpeg' }, alt: `Step ${n}` })), mediaGeneration: { id: 'pending', requestId: 'request', format: 'video', status: 'rendering', reason: 'A process', overridden: false } } } }));
    await expect(act('social.postNow', { sid: `s:${PACK}:instagram` })).rejects.toMatchObject({ code: 'media_pending' });
    expect(await pub('instagram')).toBeUndefined();
    await expect(attachVideo(await getBiz(bid), PACK, 'instagram', mp4())).rejects.toMatchObject({ code: 'media_pending' });
    await expect(act('social.regenImage', { packId: PACK, platform: 'instagram', prompt: 'A replacement image' })).rejects.toMatchObject({ code: 'media_pending' });
    expect((await getPack(bid, PACK))!.posts.instagram!.imagePrompt).toBeUndefined();
    expect((await getPack(bid, PACK))!.posts.instagram!.slides).toHaveLength(3);
    await updatePack(bid, PACK, p => ({ ...p, posts: { ...p.posts, instagram: { ...p.posts.instagram!, mediaGeneration: null } } }));
    await attachVideo(await getBiz(bid), PACK, 'instagram', mp4());
    expect((await getPack(bid, PACK))!.posts.instagram).toMatchObject({ slides: null, mediaRevision: 1, video: { meta: { type: 'video/mp4' } } });
  });
  it('rejects foreign, malformed and wrongly shaped carousel slides before any provider call', async () => {
    const square = createCanvas(108, 135).toBuffer('image/jpeg'); const foreignUrl = await putObject(objectKey(foreign, 'slide', 'jpg'), square, 'image/jpeg');
    const ownUrl = await putObject(objectKey(bid, 'slide', 'jpg'), square, 'image/jpeg');
    const invalidUrl = await putObject(objectKey(bid, 'slide', 'jpg'), Buffer.from('not a JPEG'), 'image/jpeg');
    const wide = createCanvas(250, 100).toBuffer('image/jpeg'); const wideUrl = await putObject(objectKey(bid, 'slide', 'jpg'), wide, 'image/jpeg');
    const publish = vi.fn(async () => ({ remoteId: 'unexpected', url: '' })); setAdapterForTests('instagram', { ...stubAdapter('instagram'), publish });
    for (const url of [foreignUrl, invalidUrl, wideUrl]) {
      await updatePack(bid, PACK, p => ({ ...p, posts: { ...p.posts, instagram: { ...basePost(), slides: [ownUrl, url].map(url => ({ url, meta: { bytes: 1, type: 'image/jpeg' }, alt: 'Slide' })) } } }));
      await expect(act('social.postNow', { sid: `s:${PACK}:instagram` })).rejects.toMatchObject({ code: 'media' });
    }
    expect(publish).not.toHaveBeenCalled();
  });
  it('passes actual video bytes, parsed duration and explicit YouTube settings without generated AI preview metadata', async () => {
    await attachVideo(await getBiz(bid), PACK, 'youtube', mp4());
    await options('youtube', { title: 'My useful video', privacy: 'unlisted', madeForKids: false });
    const publish = vi.fn(async () => ({ remoteId: 'video123', url: 'https://www.youtube.com/watch?v=video123' }));
    setAdapterForTests('youtube', { ...stubAdapter('youtube'), publish });
    const r = await act('social.postNow', { sid: `s:${PACK}:youtube`, acctId: ids.youtube });
    expect(r.pub.status).toBe('posted'); expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]).toMatchObject([{ ch: 'youtube' }, { images: [], video: { type: 'video/mp4', durationSec: 6 }, options: { privacy: 'unlisted', madeForKids: false }, aiMedia: false }]);
    expect((publish.mock.calls[0] as any)[1].video.bytes.equals(mp4())).toBe(true);
    expect((await loadTarget(bid, `s:${PACK}:youtube`))?.aiMedia).toBe(false);
  });
  it('attaches and publishes tenant-owned video through the configured R2 public URL, never accepting another tenant URL', async () => {
    const sdk = await import('@aws-sdk/client-s3');
    const previous = { s3Bucket: env.s3Bucket, s3PublicUrl: env.s3PublicUrl };
    const base = 'https://pub-6570838483bc471db790d04d3dd0df51.r2.dev';
    const objects = new Map<string, Buffer>();
    const send = vi.spyOn(sdk.S3Client.prototype, 'send').mockImplementation((async (command: any) => {
      if (!(command instanceof sdk.PutObjectCommand)) throw new Error('Unexpected object-store request');
      expect(command.input.Bucket).toBe('video-qa'); expect(command.input.Key).toMatch(new RegExp('^' + bid + '/social-video/'));
      const key = command.input.Key; const body = command.input.Body;
      if (!key || !Buffer.isBuffer(body)) throw new Error('Unexpected object-store payload');
      objects.set(key, body); return {};
    }) as any);
    const fetch = vi.fn(async (url: unknown) => {
      expect(String(url).startsWith(base + '/' + bid + '/social-video/')).toBe(true);
      const body = objects.get(String(url).slice(base.length + 1));
      return body ? new Response(new Uint8Array(body), { headers: { 'content-type': 'video/mp4' } }) : new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      Object.assign(env, { s3Bucket: 'video-qa', s3PublicUrl: base + '/' });
      const attached = await attachVideo(await getBiz(bid), PACK, 'youtube', mp4());
      expect(attached.url.startsWith(base + '/' + bid + '/social-video/')).toBe(true);
      expect(storedKey(bid, attached.url)).toMatch(new RegExp('^' + bid + '/social-video/'));
      expect(storedKey(foreign, attached.url)).toBeNull(); expect(await readStored(foreign, attached.url)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
      await options('youtube', { title: 'R2 video', privacy: 'private', madeForKids: false });
      const publish = vi.fn(async () => ({ remoteId: 'r2-video', url: 'https://www.youtube.com/watch?v=r2-video' }));
      setAdapterForTests('youtube', { ...stubAdapter('youtube'), publish });
      const result = await act('social.postNow', { sid: `s:${PACK}:youtube`, acctId: ids.youtube });
      expect(result.pub.status).toBe('posted');
      expect(publish.mock.calls[0]).toMatchObject([{ ch: 'youtube' }, { video: { url: attached.url, type: 'video/mp4', durationSec: 6 } }]);
      expect((publish.mock.calls[0] as any)[1].video.bytes.equals(mp4())).toBe(true);
      expect(send).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalled();
    } finally { send.mockRestore(); Object.assign(env, previous); }
  });
  it('blocks missing YouTube media/options and missing TikTok approval before claiming a publication', async () => {
    await expect(act('social.postNow', { sid: `s:${PACK}:youtube` })).rejects.toMatchObject({ code: 'preflight' });
    await expect(act('social.postNow', { sid: `s:${PACK}:tiktok` })).rejects.toMatchObject({ code: 'preflight' });
    expect(await pub('youtube')).toBeUndefined(); expect(await pub('tiktok')).toBeUndefined();
  });
  it('persists accepted processing and resumes the same provider reference through outages and reconnect', async () => {
    await options('tiktok', { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } });
    const publish = vi.fn(async (_a, p) => { await p.progress('accepted-123'); return { remoteId: 'accepted-123', url: 'https://www.tiktok.com/', pending: true }; });
    const resume = vi.fn<NonNullable<Adapter['resume']>>().mockRejectedValueOnce(new SendError('transient', 'unavailable', 'status outage')).mockRejectedValueOnce(new SendError('auth', 'auth', 'expired access token')).mockResolvedValueOnce({ remoteId: 'accepted-123', url: 'https://www.tiktok.com/', pending: true }).mockResolvedValueOnce({ remoteId: 'final-456', url: 'https://www.tiktok.com/@creator' });
    setAdapterForTests('tiktok', { ...stubAdapter('tiktok'), publish, resume });
    expect((await act('social.postNow', { sid: `s:${PACK}:tiktok` })).pub.status).toBe('sending');
    expect((await pub('tiktok')).payload!.providerRef).toBe('accepted-123');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    await db.update(S.socialAccounts).set({ expired: true }).where(eq(S.socialAccounts.id, ids.tiktok!));
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    await db.update(S.socialAccounts).set({ expired: false }).where(eq(S.socialAccounts.id, ids.tiktok!));
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('posted');
    expect(publish).toHaveBeenCalledTimes(1); expect(resume.mock.calls.every(call => call[1] === 'accepted-123')).toBe(true);
  });
  it('retains accepted work without resuming or reinitializing it while the business is deleted', async () => {
    await options('tiktok', { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } });
    const publish = vi.fn(async (_a, p) => { await p.progress('accepted-before-delete'); return { remoteId: 'accepted-before-delete', url: 'https://www.tiktok.com/', pending: true }; });
    const resume = vi.fn(async () => ({ remoteId: 'completed-existing-operation', url: 'https://www.tiktok.com/' }));
    setAdapterForTests('tiktok', { ...stubAdapter('tiktok'), publish, resume });
    await act('social.postNow', { sid: `s:${PACK}:tiktok` });
    await db.update(S.businesses).set({ status: 'deleted', deletedAt: new Date(), purgeAt: new Date(Date.now() + 168 * 3600_000) }).where(eq(S.businesses.id, bid));
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    expect(resume).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledTimes(1);
    expect((await pub('tiktok')).payload!.providerRef).toBe('accepted-before-delete');
    await db.update(S.businesses).set({ status: 'active', deletedAt: null, purgeAt: null }).where(eq(S.businesses.id, bid));
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('posted'); expect(publish).toHaveBeenCalledTimes(1);
  });
  it('does not publish an Instagram container when the business is deleted during the status request', async () => {
    let reads = 0; const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url); urls.push(u);
      if (u.includes('status_code')) {
        if (++reads === 1) return new Response(JSON.stringify({ status_code: 'IN_PROGRESS' }));
        await db.update(S.businesses).set({ status: 'deleted', deletedAt: new Date(), purgeAt: new Date(Date.now() + 168 * 3600_000) }).where(eq(S.businesses.id, bid));
        return new Response(JSON.stringify({ status_code: 'FINISHED' }));
      }
      if (u.endsWith('/media')) return new Response(JSON.stringify({ id: '987654' }));
      throw new Error('unexpected Instagram publication');
    }));
    setAdapterForTests('instagram', instagramAdapter);
    expect((await act('social.postNow', { sid: `s:${PACK}:instagram` })).pub.status).toBe('sending');
    expect((await recoverStuck(await age('instagram')))?.status).toBe('sending');
    expect(urls.some(u => u.includes('media_publish'))).toBe(false);
    expect((await pub('instagram')).payload!.providerRef).toBe('987654');
    expect(urls.filter(u => u.endsWith('/media'))).toHaveLength(1);
  });
  it('keeps tracking after a lost status response and never automatically reinitializes an unknown init', async () => {
    await options('tiktok', { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } });
    const publish = vi.fn(async (_a, p) => { await p.progress('saved-before-error'); throw new SendError('unknown', 'unknown', 'lost response'); });
    setAdapterForTests('tiktok', { ...stubAdapter('tiktok'), publish, resume: async () => ({ remoteId: 'done', url: 'https://www.tiktok.com/' }) });
    expect((await act('social.postNow', { sid: `s:${PACK}:tiktok` })).pub.status).toBe('sending');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('posted'); expect(publish).toHaveBeenCalledTimes(1);
    const unknown = vi.fn(async () => { throw new SendError('unknown', 'unknown', 'init response lost'); });
    setAdapterForTests('instagram', { ...stubAdapter('instagram'), publish: unknown });
    const r = await act('social.postNow', { sid: `s:${PACK}:instagram` });
    expect(r.pub).toMatchObject({ status: 'failed', code: 'unknown' });
    expect(await recoverStuck((await pub('instagram')).id)).toBeNull(); expect(unknown).toHaveBeenCalledTimes(1);
  });
  it('keeps accepted references through definitive status errors and only fails confirmed terminal states', async () => {
    await options('tiktok', { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } });
    const publish = vi.fn(async (_a, p) => { await p.progress('durable-403'); return { remoteId: 'durable-403', url: 'https://www.tiktok.com/', pending: true }; });
    const resume = vi.fn<NonNullable<Adapter['resume']>>().mockRejectedValueOnce(new SendError('definitive', 'auth', 'status403')).mockRejectedValueOnce(new SendError('definitive', 'media', 'status404')).mockRejectedValueOnce(Object.assign(new SendError('definitive', 'media', 'provider FAILED'), { confirmedUnpublished: true }));
    setAdapterForTests('tiktok', { ...stubAdapter('tiktok'), publish, resume });
    expect((await act('social.postNow', { sid: `s:${PACK}:tiktok` })).pub.status).toBe('sending');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('sending');
    expect((await pub('tiktok')).payload!.providerRef).toBe('durable-403');
    expect((await recoverStuck(await age('tiktok')))?.status).toBe('failed');
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('clears TikTok approval on text, regenerated caption, image/style and video changes', async () => {
    const approve = () => options('tiktok', { tiktok: { privacyLevel: 'SELF_ONLY', consent: true } });
    const consent = async () => (await getPack(bid, PACK))!.posts.tiktok!.publishOptions?.tiktok?.consent;
    await approve(); await act('social.text', { packId: PACK, platform: 'tiktok', text: 'Changed caption' }); expect(await consent()).toBe(false);
    await approve(); await act('social.regenText', { packId: PACK, platform: 'tiktok' }); expect(await consent()).toBe(false);
    await approve(); await act('social.style', { packId: PACK, platform: 'tiktok', style: 'branded' }); expect(await consent()).toBe(false);
    await approve(); await attachVideo(await getBiz(bid), PACK, 'tiktok', mp4()); expect(await consent()).toBe(false);
    await approve(); await act('social.videoRemove', { packId: PACK, platform: 'tiktok' }); expect(await consent()).toBe(false);
  });
  it('refuses viewer writes, foreign media/accounts and disabled publishing', async () => {
    await expect(act('social.publishOptions', { packId: PACK, platform: 'youtube', options: {} }, viewer)).rejects.toMatchObject({ status: 403 });
    await expect(act('social.tiktokCreatorInfo', { acctId: ids.youtube })).rejects.toMatchObject({ status: 404 });
    const foreignUrl = await putObject(objectKey(foreign, 'video', 'mp4'), mp4(), 'video/mp4');
    await updatePack(bid, PACK, p => ({ ...p, posts: { ...p.posts, youtube: { ...p.posts.youtube!, video: { url: foreignUrl, meta: { bytes: 1, type: 'video/mp4' } } } } }));
    await options('youtube', { title: 'A video', privacy: 'private', madeForKids: false });
    await expect(act('social.postNow', { sid: `s:${PACK}:youtube` })).rejects.toMatchObject({ code: 'media' });
    process.env.RADAR_SOCIAL_PUBLISHING = 'off';
    await expect(options('youtube', {})).rejects.toMatchObject({ code: 'not_enabled' });
  });
});
