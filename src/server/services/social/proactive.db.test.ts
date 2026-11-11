import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.STORAGE_DIR = '.data/daily-social-engineer'; });
import { and, eq, inArray, like } from 'drizzle-orm';
import { db, schema as S } from '../../db';
import { defaultProfile, getBiz, socialAutoOf } from '../../workspace';
import { ai } from '../../ai';
import { addDays, todayIn } from '@/lib/format';
import { autoRun, autoTick, dailyPackId } from './auto';
import { dailyContext } from './proactive';
import { createPack, getPack, updatePack } from './generate';
import { readArticle } from './source';
import * as sourceModule from './source';
import { actions } from '../../actions/social';
import type { Profile } from '@/lib/types';
import fs from 'node:fs/promises';

let uid = '', bid = '', foreign = '';
const date = todayIn('UTC');
const p: Profile = defaultProfile('daily.test'); p.business.name = 'Daily'; p.business.offerings = ['Calendar time tracking']; p.audience.needs = ['Track billable time'];
const entries = (status = 'published', businessId = bid, title = 'How calendar tracking works') => ({ id: `entry-${crypto.randomUUID()}`, businessId, title, kw: 'tracking', type: 'Guide', date, status, audience: 'Freelance designers', relevance: 'Keep billable hours accurate', publishedUrl: status === 'published' ? 'https://daily.test/blog/tracking' : null });
const currentPacks = () => db.select().from(S.socialPacks).where(eq(S.socialPacks.businessId, bid));

describe.skipIf(!process.env.DATABASE_URL)('daily social drafts (database)', () => {
  beforeAll(async () => {
    [ { id: uid } ] = await db.insert(S.users).values({ name: 'Daily tests', email: `daily-${crypto.randomUUID()}@test.local` }).returning();
    [ { id: bid } ] = await db.insert(S.businesses).values({ ownerId: uid, domain: p.domain, profile: p, timezone: 'UTC', status: 'active' }).returning();
    [ { id: foreign } ] = await db.insert(S.businesses).values({ ownerId: uid, domain: 'foreign.test', profile: p, timezone: 'UTC', status: 'onboarding' }).returning();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete(S.jobs).where(eq(S.jobs.businessId, bid));
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    await db.delete(S.socialPacks).where(eq(S.socialPacks.businessId, bid));
    await db.delete(S.calendarEntries).where(eq(S.calendarEntries.businessId, bid));
    await db.delete(S.crawlPages).where(eq(S.crawlPages.businessId, bid));
    await db.update(S.businesses).set({ socialAuto: { platforms: ['x'] }, status: 'active', profile: p }).where(eq(S.businesses.id, bid));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${bid}%`));
    await db.delete(S.events).where(inArray(S.events.businessId, [bid, foreign]));
    await db.delete(S.businesses).where(inArray(S.businesses.id, [bid, foreign]));
    await db.delete(S.users).where(eq(S.users.id, uid));
    await fs.rm('.data/daily-social-engineer', { recursive: true, force: true });
  });
  it('queues exactly once for unset settings under concurrent and delayed ticks', async () => {
    await db.update(S.businesses).set({ socialAuto: {} }).where(eq(S.businesses.id, bid));
    const now = new Date(date + 'T20:00:00Z');
    await Promise.all([autoTick(now), autoTick(now)]); await autoTick(now);
    expect(await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).toHaveLength(1);
    expect(await db.select().from(S.jobs).where(eq(S.jobs.businessId, foreign))).toHaveLength(0);
  });
  it('rolls back the daily mark on enqueue failure and recovers next tick', async () => {
    const key = `social.auto:${bid}:${date}`;
    const [conflict] = await db.insert(S.jobs).values({ businessId: bid, kind: 'test-conflict', singletonKey: key }).returning();
    await expect(autoTick(new Date(date + 'T20:00:00Z'))).rejects.toThrow();
    expect(await db.select().from(S.cronMarks).where(eq(S.cronMarks.key, key))).toHaveLength(0);
    await db.delete(S.jobs).where(eq(S.jobs.id, conflict.id));
    await autoTick(new Date(date + 'T20:00:00Z'));
    expect(await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).toHaveLength(1);
  });
  it('honors opt-outs, runtime pauses, onboarding and stale payload dates', async () => {
    await db.update(S.businesses).set({ socialAuto: { on: false } }).where(eq(S.businesses.id, bid));
    await autoTick(new Date(date + 'T20:00:00Z'));
    expect(await db.select().from(S.jobs).where(eq(S.jobs.businessId, bid))).toHaveLength(0);
    expect(await autoRun(bid, date)).toBeNull();
    await db.update(S.businesses).set({ socialAuto: { platforms: ['x'] }, status: 'onboarding' }).where(eq(S.businesses.id, bid));
    expect(await autoRun(bid, date)).toBeNull();
    await db.update(S.businesses).set({ status: 'active' }).where(eq(S.businesses.id, bid));
    expect(await autoRun(bid, addDays(date, -1))).toBeNull();
    expect(await currentPacks()).toHaveLength(0);
  });
  it('generates a profile-only draft and returns saved edits without another AI call', async () => {
    const id = await autoRun(bid, date); expect(id).toBe(dailyPackId(bid, date));
    expect((await getPack(bid, id!))).toMatchObject({ auto: true, created: date, source: { kind: 'suggest' } });
    await updatePack(bid, id!, pack => ({ ...pack, posts: { ...pack.posts, x: { ...pack.posts.x!, text: 'My reviewed version.' } } }));
    const spy = vi.spyOn(ai, 'run');
    expect(await autoRun(bid, date)).toBe(id);
    expect(spy).not.toHaveBeenCalled();
    expect((await getPack(bid, id!))?.posts.x?.text).toBe('My reviewed version.');
    expect(await db.select().from(S.socialPubs).where(eq(S.socialPubs.businessId, bid))).toHaveLength(0);
  });
  it('concurrent generation persists a single daily pack', async () => {
    const ids = await Promise.all([autoRun(bid, date), autoRun(bid, date)]);
    expect(ids[0]).toBe(ids[1]); expect(await currentPacks()).toHaveLength(1);
  });
  it('retains the immutable original date for an after-midnight completion retry', async () => {
    const yesterday = addDays(date, -1); const id = dailyPackId(bid, yesterday);
    await createPack(bid, { source: { kind: 'idea', label: 'Yesterday' }, platforms: ['x'], style: 'branded', auto: true }, undefined, { id, created: yesterday });
    expect(await autoRun(bid, yesterday)).toBe(id);
    expect((await getPack(bid, id))?.created).toBe(yesterday); expect(await currentPacks()).toHaveLength(1);
  });
  it('grounds published Radar posts in their actual body and upcoming calendar context', async () => {
    const [e] = await db.insert(S.calendarEntries).values(entries()).returning();
    await db.insert(S.articles).values({ businessId: bid, entryId: e.id, data: { generated: true, body: [['p', 'Calendar events become tracked hours after your review.']], brief: { angle: 'Review first' }, seo: { meta: 'Accurate tracking' } } });
    await db.insert(S.calendarEntries).values({ ...entries('approved', bid, 'Billing checklist'), date: addDays(date, 2) });
    const spy = vi.spyOn(ai, 'run');
    const id = await autoRun(bid, date); const pack = await getPack(bid, id!);
    expect(pack?.grounding?.brief).toContain('Calendar events become tracked hours');
    expect(pack?.grounding?.link).toBe(e.publishedUrl);
    const prompt = spy.mock.calls.find(c => c[1].purpose === 'social.post')?.[1].prompt;
    expect(prompt).toContain('Billing checklist'); expect(prompt).toContain('upcoming entries are not published');
  });
  it('uses unpublished approved topics without suggesting an available article or link', async () => {
    await db.insert(S.calendarEntries).values(entries('approved'));
    const s = await dailyContext(bid, p, date, []);
    expect(s.grounding.brief).toContain('has not been published'); expect(s.grounding.link).toBeNull();
    expect(s.source.kind).toBe('article');
  });
  it('grounds cached business blogs without fetching and names the draft with its readable headline', async () => {
    await db.insert(S.crawlPages).values({ businessId: bid, url: 'https://daily.test/blog/real-post', path: '/blog/real-post', kind: 'article', title: 'Real cached blog', text: 'A known detail from the existing business blog.' });
    const id = await autoRun(bid, date); const pack = await getPack(bid, id!);
    expect(pack?.name).toBe('Real cached blog');
    expect(pack?.grounding?.brief).toContain('known detail'); expect(pack?.grounding?.brief).toContain('Publication date is unknown');
  });
  it('falls through an unreadable Radar source to a cached blog', async () => {
    await db.insert(S.calendarEntries).values(entries());
    await db.insert(S.crawlPages).values({ businessId: bid, url: 'https://daily.test/blog/fallback', path: '/blog/fallback', kind: 'article', title: 'Readable fallback', text: 'Business content that is still available.' });
    vi.spyOn(sourceModule, 'readArticle').mockRejectedValueOnce(new Error('Article unavailable'));
    const s = await dailyContext(bid, p, date, []);
    expect(s.source).toEqual({ kind: 'url', label: 'https://daily.test/blog/fallback' });
  });
  it('falls back to business knowledge if search idea generation fails', async () => {
    const withKeyword = structuredClone(p);
    withKeyword.keywords.list = [{ kw: 'calendar time tracking', vol: 100, kd: 20, intent: 'Commercial', src: 'user', priority: true }];
    await db.update(S.businesses).set({ profile: withKeyword }).where(eq(S.businesses.id, bid));
    const original = ai.run.bind(ai);
    vi.spyOn(ai, 'run').mockImplementation(async (...args: Parameters<typeof ai.run>) => {
      if (args[1].purpose === 'social.angles') throw new Error('Ideas unavailable');
      return original(...args);
    });
    const s = await dailyContext(bid, withKeyword, date, []);
    expect(s.grounding.brief).toContain('Business-profile angle');
    expect(s.grounding.brief).not.toContain('Search data:');
  });
  it('keeps foreign tenant content out of source selection and rejects foreign article refs', async () => {
    const [e] = await db.insert(S.calendarEntries).values(entries('published', foreign, 'Private foreign article')).returning();
    await db.insert(S.crawlPages).values({ businessId: foreign, url: 'https://foreign.test/blog/private', path: '/blog/private', kind: 'article', title: 'Private foreign blog', text: 'Foreign secret.' });
    const s = await dailyContext(bid, p, date, []);
    expect(JSON.stringify(s)).not.toMatch(/Private foreign|Foreign secret/);
    await expect(readArticle(bid, e.id)).rejects.toThrow('Choose an article');
  });
  it('passes bounded recent-post guidance to the writer', async () => {
    await db.insert(S.socialPacks).values({ id: 'history-' + bid, businessId: bid, data: { source: { kind: 'idea', label: 'Previous topic' }, posts: { x: { text: 'Previously reviewed opening.' } } } });
    const spy = vi.spyOn(ai, 'run'); await autoRun(bid, date);
    expect(spy.mock.calls.find(c => c[1].purpose === 'social.post')?.[1].prompt).toContain('Previously reviewed opening.');
  });
  it('rejects an enabled custom schedule with no days while preserving explicit library defaults', async () => {
    const auto = { ...socialAutoOf(await getBiz(bid)), freq: 'custom' as const, days: [] };
    const ctx = { bid, biz: await getBiz(bid), role: 'Owner', user: { id: uid, name: 'Daily tests', email: 'daily@test.local' } } as any;
    await expect(actions['social.auto'].run(ctx, { auto })).rejects.toThrow('Pick at least one day');
  });
  it('honors a pause made while the model is drafting before persistence', async () => {
    const original = ai.run.bind(ai);
    vi.spyOn(ai, 'run').mockImplementation(async (...args: Parameters<typeof ai.run>) => {
      const result = await original(...args);
      if (args[1].purpose === 'social.post') await db.update(S.businesses).set({ socialAuto: { on: false } }).where(eq(S.businesses.id, bid));
      return result;
    });
    expect(await autoRun(bid, date)).toBeNull(); expect(await currentPacks()).toHaveLength(0);
  });
});
