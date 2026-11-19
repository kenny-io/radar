import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.RADAR_SOCIAL_MEDIA_GENERATION = 'all'; process.env.RADAR_BILLING = 'off'; process.env.RADAR_FAILURE_ALERTS = 'off'; });
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema as S } from '@/server/db';
import { ACTIONS } from '@/server/actions';
import { requireRole } from '@/server/access';
import { defaultProfile, getBiz, socialAutoOf } from '@/server/workspace';
import type { User } from '@/lib/types';
const ON = !!process.env.DATABASE_URL;
let bid: string, owner: User, editor: User, viewer: User, outsider: User;
const preferences = () => ({ on: false, freq: 'custom' as const, days: ['Mon'], platforms: ['instagram' as const], style: 'branded' as const, time: '14:20', post: 'library' as const, youtubeDefaults: null, youtubeDefaultsVersion: '49dbe0ae-cc53-4c12-b30d-55f396839509' });
async function act(name: string, input: unknown, user = editor) { const a = ACTIONS[name]; const role = await requireRole(bid, user.id, a.role || (a.read ? 'Viewer' : 'Editor')); return a.run({ bid, user, role, biz: await getBiz(bid) }, a.input!.parse(input)); }
describe.skipIf(!ON)('video style default and normal generation boundaries', () => {
  beforeAll(async () => {
    [owner, editor, viewer, outsider] = await db.insert(S.users).values(['owner', 'editor', 'viewer', 'outsider'].map(role => ({ name: `Style ${role}`, email: `styles-${role}-${randomUUID()}@test.local` }))).returning() as User[];
    const [b] = await db.insert(S.businesses).values({ ownerId: owner.id, status: 'active', domain: 'styles.test', profile: defaultProfile('styles.test'), timezone: 'UTC' }).returning(); bid = b.id;
    await db.insert(S.members).values([{ businessId: bid, userId: owner.id, email: owner.email, role: 'Owner' }, { businessId: bid, userId: editor.id, email: editor.email, role: 'Editor' }, { businessId: bid, userId: viewer.id, email: viewer.email, role: 'Viewer' }]);
  });
  beforeEach(async () => { await db.delete(S.jobs).where(eq(S.jobs.businessId, bid)); await db.update(S.businesses).set({ socialAuto: preferences(), autopilot: { enabled: false } }).where(eq(S.businesses.id, bid)); });
  afterAll(async () => { await db.delete(S.businesses).where(eq(S.businesses.id, bid)); for (const user of [owner, editor, viewer, outsider]) await db.delete(S.users).where(eq(S.users.id, user.id)); });
  it('projects a deliberate Drawn default for legacy settings', async () => { expect(socialAutoOf(await getBiz(bid)).videoStyle).toBe('drawn'); });
  it('Editor saves only the style while automation and all owner choices stay intact', async () => {
    await act('social.videoStyleDefault', { videoStyle: 'paper-cut' }); const b = await getBiz(bid);
    expect(b.socialAuto).toEqual({ ...preferences(), videoStyle: 'paper-cut' }); expect(b.autopilot.enabled).toBe(false);
    expect(await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).toHaveLength(0);
    expect(await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid))).toHaveLength(0);
  });
  it('style changes preserve an already enabled master program without restarting it', async () => {
    await db.update(S.businesses).set({ autopilot: { enabled: true, activationId: 'existing-activation', enabledBy: owner.id, enabledAt: '2026-11-19T00:00:00Z' } }).where(eq(S.businesses.id, bid));
    const before = (await getBiz(bid)).autopilot; await act('social.videoStyleDefault', { videoStyle: 'blueprint' }, owner); expect((await getBiz(bid)).autopilot).toEqual(before);
  });
  it.each(['viewer', 'outsider'] as const)('%s cannot save another business default', async role => { await expect(act('social.videoStyleDefault', { videoStyle: 'kinetic' }, role === 'viewer' ? viewer : outsider)).rejects.toMatchObject({ status: role === 'viewer' ? 403 : 404 }); expect((await getBiz(bid)).socialAuto).toEqual(preferences()); });
  it('rejects unsupported styles and unrelated mutation fields before writing', async () => {
    for (const input of [{ videoStyle: 'cinematic' }, { videoStyle: 'editorial', on: true }, { videoStyle: 'editorial', youtubeDefaults: { privacy: 'public' } }]) await expect(act('social.videoStyleDefault', input)).rejects.toBeTruthy();
    expect((await getBiz(bid)).socialAuto).toEqual(preferences());
  });
  it('a stale broad automatic-settings save cannot overwrite the independently saved style', async () => {
    const stale = { ...preferences(), videoStyle: 'drawn' }; await act('social.videoStyleDefault', { videoStyle: 'kinetic' });
    await act('social.auto', { auto: stale }); expect((await getBiz(bid)).socialAuto).toEqual({ ...preferences(), videoStyle: 'kinetic' });
  });
  it('normal Generate captures explicit styles and default fallback without publishing or recording', async () => {
    await act('social.videoStyleDefault', { videoStyle: 'blueprint' });
    await act('social.generate', { token: 'styles-request-token', source: { kind: 'idea', label: 'A checklist keeps independent checks separate.' }, platforms: ['instagram', 'tiktok', 'youtube'], style: 'branded', media: [{ platform: 'instagram', format: 'recommended', videoStyle: 'editorial' }, { platform: 'tiktok', format: 'video' }] });
    const jobs = await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid)); expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.media).toEqual([{ platform: 'instagram', format: 'recommended', videoStyle: 'editorial' }, { platform: 'tiktok', format: 'video', videoStyle: 'blueprint' }, { platform: 'youtube', format: 'video', videoStyle: 'blueprint' }]);
    expect(await db.select().from(S.socialMediaGenerations).where(eq(S.socialMediaGenerations.businessId, bid))).toHaveLength(0);
  });
});
