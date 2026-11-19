import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_MEDIA_GENERATION = 'all'; process.env.RADAR_BILLING = 'off'; });
import { eq } from 'drizzle-orm';
import { db, schema as S } from '@/server/db';
import { jobDefs, type JobCtx } from '@/server/jobs/queue';
import { defaultProfile } from '@/server/workspace';
import { type PackInput } from './generate';
import './jobs';

describe.skipIf(!process.env.DATABASE_URL)('new explainer pack recovery', () => {
  let bid = ''; let uid = '';
  beforeAll(async () => {
    const tag = Date.now();
    const [u] = await db.insert(S.users).values({ email: `media-job-${tag}@test.local`, name: 'Media job owner', emailVerifiedAt: new Date() }).returning(); uid = u.id;
    const [b] = await db.insert(S.businesses).values({ ownerId: uid, status: 'active', domain: 'media-job.test', profile: defaultProfile('media-job.test') }).returning(); bid = b.id;
  });
  afterAll(async () => { if (bid) await db.delete(S.businesses).where(eq(S.businesses.id, bid)); if (uid) await db.delete(S.users).where(eq(S.users.id, uid)); });
  it('reuses the saved pack and preparation intent after the worker fails after commit', async () => {
    const payload: PackInput = { source: { kind: 'idea', label: 'A schedule stores a send time. A worker claims the due post and checks the account. It saves an upload receipt before checking status, so a lost response can be checked using the same receipt.' }, platforms: ['instagram'], style: 'branded' };
    const ctx = { businessId: bid, payload, job: { id: 'a-worker-job', ref: 'same-client-request' }, progress: async () => {}, touch: vi.fn().mockRejectedValueOnce(new Error('worker died after save')).mockResolvedValue(undefined) } as unknown as JobCtx<PackInput>;
    const run = jobDefs().get('social.generate')!.run;
    await expect(run(ctx)).rejects.toThrow('worker died after save');
    const first = await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId, bid));
    expect(first).toHaveLength(1);
    const result = await run(ctx);
    expect(result).toEqual({ packId: first[0].id });
    expect(await db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId, bid))).toHaveLength(1);
    expect(await db.select().from(S.socialMediaGenerations).where(eq(S.socialMediaGenerations.businessId, bid))).toHaveLength(1);
    const jobs = await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid));
    expect(jobs.filter(job => job.kind === 'social.media')).toHaveLength(1);
    expect((first[0].data as any).posts.instagram.imageUrl).toBeNull();
    const generations = await db.select().from(S.socialMediaGenerations).where(eq(S.socialMediaGenerations.businessId, bid));
    expect((generations[0].checkpoint as any).options.generateAfterPrepare).toBe(true);
  });
});
