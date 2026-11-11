import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; });
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { encrypt } from '@/server/crypto';
import { getBiz } from '@/server/workspace';
import { addDays, todayIn } from '@/lib/format';
import { packSid } from '@/lib/socialPublish';
import { updateEngagementPreferences } from './preferences';
import * as engagement from './engagement';
import { resolve, writeScheduled } from '@/server/services/social/publish/schedule';
import { claimManual, runSend } from '@/server/services/social/publish/send';
import { stubState, stubTokens } from '@/server/services/social/publish/stubs';
import * as pubs from '@/server/services/social/publish/pubs';
const F = new Fixtures();
async function setup() {
  const user = await F.user(), business = await F.biz(user);
  const packId = `work-pack-${business.id}`, tokens = stubTokens('x');
  await updateEngagementPreferences(user.id, { articleSocial: true });
  await db.insert(schema.socialPacks).values({ id: packId, businessId: business.id, data: { id: packId, name: 'Useful update', source: { kind: 'idea', label: 'Useful update' }, style: 'branded', headline: 'Useful update', posts: { x: { text: 'A useful update for our customers.', style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 } } } });
  await db.insert(schema.socialAccounts).values({ businessId: business.id, ch: 'x', remoteId: 'stub-' + business.id, name: 'Fieldnote', handle: '@fieldnote', tokensEnc: encrypt(tokens), expiresAt: new Date(tokens.expires_at!) });
  await engagement.recordEngagement(db, { businessId: business.id, kind: 'social_publish', ref: packId });
  const event = async () => (await db.select().from(schema.engagementEvents).where(eq(schema.engagementEvents.businessId, business.id)))[0];
  const r = await resolve(business.id, packSid(packId, 'x'));
  return { user, business, packId, r, event, biz: await getBiz(business.id) };
}
describe.skipIf(!process.env.DATABASE_URL)('publishing follow-through resolves reminders (local DB, fake provider)', () => {
  beforeEach(() => { vi.spyOn(pubs, 'ensureImages').mockImplementation(async (_biz, target) => ({ ...target, images: [], needsRender: false })); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => F.cleanup());
  it('atomically resolves scheduling and never reopens the reminder after unscheduling or source replay', async () => {
    const s = await setup();
    const written = await writeScheduled(db, { biz: s.biz, r: s.r, date: addDays(todayIn(s.biz.timezone), 1), time: '09:00', userId: s.user.id });
    expect(written?.status).toBe('scheduled'); expect((await s.event()).resolvedReason).toBe('action_taken');
    await db.delete(schema.socialPubs).where(and(eq(schema.socialPubs.businessId, s.business.id), eq(schema.socialPubs.sid, s.r.t.sid)));
    await engagement.recordEngagement(db, { businessId: s.business.id, kind: 'social_publish', ref: s.packId });
    expect((await s.event()).resolvedReason).toBe('action_taken');
  });
  it('rolls reminder resolution back when scheduling does not commit', async () => {
    const s = await setup();
    await expect(db.transaction(async tx => {
      await writeScheduled(tx, { biz: s.biz, r: s.r, date: addDays(todayIn(s.biz.timezone), 1), time: '09:00', userId: s.user.id });
      throw new Error('test rollback');
    })).rejects.toThrow('test rollback');
    expect((await s.event()).resolvedAt).toBeNull();
    expect(await db.select().from(schema.socialPubs).where(eq(schema.socialPubs.businessId, s.business.id))).toHaveLength(0);
  });
  it('keeps a live provider acknowledgment saved even when reminder resolution fails, with no duplicate create', async () => {
    const s = await setup(), creates = stubState.creates;
    const claimed = await claimManual({ bid: s.business.id, t: s.r.t, acct: s.r.acct!, userId: s.user.id, tz: s.biz.timezone });
    expect(claimed).not.toBeNull();
    vi.spyOn(engagement, 'resolveEngagement').mockRejectedValueOnce(new Error('test reminder unavailable'));
    const result = await runSend(claimed!, { manual: true, userId: s.user.id });
    expect(result?.status).toBe('posted'); expect(result?.remoteId).toBeTruthy();
    expect(stubState.creates - creates).toBe(1);
    expect(await runSend(claimed!, { manual: true, userId: s.user.id })).toBeNull();
    expect(stubState.creates - creates).toBe(1);
    const [saved] = await db.select().from(schema.socialPubs).where(eq(schema.socialPubs.id, claimed!.id)); expect(saved.status).toBe('posted');
  });
});
