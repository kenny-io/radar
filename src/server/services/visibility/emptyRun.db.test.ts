// A full AI visibility run that collected nothing is not the business's weekly run. When every assistant fails for
// every cell (the provider account is out of credit) the job still ends `done`; counting it would leave the business
// with no answers and no retry for a week. On the database: the real cron on a simulated clock, the real job and the
// real collectAll, with the assistants replaced by a switch that answers or fails.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { answer: (_engine: string, _prompt: string): any => ({ text: '', cites: [], raw: null }) }; });
vi.mock('./engines', async orig => ({ ...(await orig<typeof import('./engines')>()), askEngine: async (engine: string, prompt: string) => H.answer(engine, prompt) }));

import { and, eq, inArray, like } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures, type TUser } from '@/server/testing/fixtures';
import { runJobNow } from '@/server/jobs/queue';
import { lastFullVisibilityRuns } from '@/server/idle';
import { AI_ENGINES } from '@/lib/constants';
import { nowHMIn, todayIn } from '@/lib/format';
import { nightlyTick } from './jobs';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses, J = schema.jobs, A = schema.aiResults;
const DAY = 864e5, HOUR = 3600e3;
// Sunday 2027-06-06, 03:00 at UTC−5. `at(days, hours)` is that many days and hours later.
const TZ = 'Etc/GMT+5', SUNDAY = new Date('2027-06-06T08:00:00Z');
const at = (days: number, hours = 0) => new Date(SUNDAY.getTime() + days * DAY + hours * HOUR);
const weekdayOf = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(todayIn(TZ, d) + 'T00:00:00Z').getUTCDay()];
const N = AI_ENGINES.length;
const works = () => ({ text: 'Popular options include Tallyhour and Billable.', cites: [], raw: null });
const outOfCredit = () => { throw new Error('insufficient credit'); };
const profile = (domain: string) => ({ domain, business: { name: 'Fieldnote', description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: ['Tallyhour', 'Billable'] }, keywords: { list: [] }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } });

type Biz = { id: string };
describe.skipIf(!ON)('a full run that collected nothing does not count (database, real cron, real collectAll)', () => {
  let owner: TUser; const mine: string[] = [];
  beforeAll(async () => { vi.stubEnv('RADAR_VISIBILITY_CADENCE', ''); owner = await F.user(); });
  beforeEach(() => { H.answer = works; vi.spyOn(console, 'error').mockImplementation(() => {}); });
  // Each case retires its businesses, so a later case's ticks do not keep queueing runs for them.
  afterEach(async () => { vi.restoreAllMocks(); for (const id of mine) await db.delete(schema.cronMarks).where(like(schema.cronMarks.key, `%${id}%`)); if (mine.length) await db.update(B).set({ status: 'onboarding' }).where(inArray(B.id, mine.splice(0))); });
  afterAll(async () => { vi.unstubAllEnvs(); await F.cleanup(); });

  /** An Autopilot business (active however long nobody opens the app) tracking `prompts` questions: 5 cells each. */
  async function biz(prompts = 1): Promise<Biz> {
    const domain = `empty-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.test`;
    const b = await F.biz(owner, { profile: profile(domain), domain }); mine.push(b.id);
    await db.update(B).set({ timezone: TZ, autopilot: { enabled: true, activationId: 'a1' } }).where(eq(B.id, b.id));
    for (let i = 0; i < prompts; i++) {
      const [p] = await db.insert(schema.aiPrompts).values({ businessId: b.id, prompt: `Which time tracker suits a studio of ${i + 3}?`, source: 'keyword' }).returning();
      await db.insert(A).values(AI_ENGINES.map(engine => ({ businessId: b.id, promptId: p.id, engine })));
    }
    return { id: b.id };
  }
  /** A run on record from before the simulated clock reaches it. */
  const ran = (b: Biz, when: Date, result: any, status: 'queued' | 'running' | 'done' | 'failed' = 'done') => db.insert(J).values({ businessId: b.id, kind: 'visibility.run', ref: b.id, status, payload: {}, result, createdAt: when });
  /** One look by the scheduler at `when`. A run it queued for `b` is executed for real and given the simulated time.
   *  Returns that run's stored result, or null when nothing was queued. */
  async function look(b: Biz, when: Date): Promise<any> {
    await nightlyTick(when);
    const queued = await db.select({ id: J.id }).from(J).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run'), eq(J.status, 'queued')));
    if (!queued.length) return null;
    expect(queued).toHaveLength(1);
    await runJobNow(queued[0].id);
    await db.update(J).set({ createdAt: when }).where(eq(J.id, queued[0].id));
    const [j] = await db.select({ status: J.status, result: J.result }).from(J).where(eq(J.id, queued[0].id));
    expect(j.status).toBe('done');
    return j.result;
  }
  /** Every night from `from` to `to`: the weekday and what the run stored, for the nights that had one. */
  async function nights(b: Biz, from: number, to: number, engines: (n: number) => () => any = () => works) {
    const out: [string, string, any][] = [];
    for (let n = from; n <= to; n++) { H.answer = engines(n); const r = await look(b, at(n)); if (r) out.push([todayIn(TZ, at(n)), weekdayOf(at(n)), r]); }
    return out;
  }
  const counted = async (b: Biz, now: Date) => (await lastFullVisibilityRuns([b.id], now)).get(b.id)?.toISOString() ?? null;

  it('the clock: 03:00 on Sunday 2027-06-06 in the business’s zone', () => {
    expect([todayIn(TZ, SUNDAY), nowHMIn(TZ, SUNDAY), weekdayOf(SUNDAY), weekdayOf(at(8))]).toEqual(['2027-06-06', '03:00', 'Sun', 'Mon']);
  });

  it('an empty Sunday run is retried on Monday night; once a run collects, the schedule returns to Sunday', async () => {
    const b = await biz();
    expect(await look(b, at(0))).toEqual({ total: N, collected: N });   // last Sunday's run, a good one: every cell has an answer
    expect(await nights(b, 1, 6)).toEqual([]);                    // an ordinary week
    // Sunday: every assistant fails for every cell. The job ends `done` with nothing collected. The grid still shows
    // last week's answers (each cell keeps its earlier status), which is why the statuses cannot be what is counted.
    H.answer = outOfCredit;
    expect(await look(b, at(7))).toEqual({ total: N, collected: 0 });
    expect((await db.select({ status: A.status, error: A.error }).from(A).where(eq(A.businessId, b.id))).map(c => [c.status, c.error])).toEqual(Array(N).fill(['not-mentioned', 'insufficient credit']));
    expect(await counted(b, at(7, 1))).toBe(at(0).toISOString());  // the run that counts is still last Sunday's
    for (const h of [0.5, 1, 2.9]) expect(await look(b, at(7, h))).toBeNull();   // not again the same night
    // Monday night it is tried again, and this time the provider answers.
    H.answer = works;
    expect(await look(b, at(8))).toEqual({ total: N, collected: N });
    expect(await counted(b, at(8, 1))).toBe(at(8).toISOString());
    // The rest of that week nothing; the following Sunday (6 days on) and the one after, as usual.
    expect(await nights(b, 9, 21)).toEqual([['2027-06-20', 'Sun', { total: N, collected: N }], ['2027-06-27', 'Sun', { total: N, collected: N }]]);
  });

  it('the provider is out of credit from Sunday to Tuesday: one empty run a night, then the first good one, then Sunday again', async () => {
    const b = await biz(2);
    await ran(b, at(0), { total: 2 * N, collected: 2 * N });
    const down = (n: number) => (n >= 7 && n <= 9 ? outOfCredit : works);
    const empty = { total: 2 * N, collected: 0 }, good = { total: 2 * N, collected: 2 * N };
    expect(await nights(b, 1, 21, down)).toEqual([
      ['2027-06-13', 'Sun', empty], ['2027-06-14', 'Mon', empty], ['2027-06-15', 'Tue', empty],
      ['2027-06-16', 'Wed', good],                                // nothing on Thursday, Friday or Saturday
      ['2027-06-20', 'Sun', good],                                // 4 days after the good run: the Sunday run goes ahead
      ['2027-06-27', 'Sun', good],
    ]);
    // One run a night while it was down, no burst afterwards: seven jobs in all, the seeded one included.
    expect((await db.select({ id: J.id }).from(J).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run')))).length).toBe(7);
  });

  it('a business that has never had a run that collected is tried once a night, whatever the weekday', async () => {
    const b = await biz();
    const down = (n: number) => (n <= 4 ? outOfCredit : works);
    const empty = { total: N, collected: 0 }, good = { total: N, collected: N };
    // Monday to Thursday empty, Friday good; Sunday is 2 days later and runs.
    expect(await nights(b, 1, 7, down)).toEqual([['2027-06-07', 'Mon', empty], ['2027-06-08', 'Tue', empty], ['2027-06-09', 'Wed', empty], ['2027-06-10', 'Thu', empty], ['2027-06-11', 'Fri', good], ['2027-06-13', 'Sun', good]]);
  });

  it('one assistant answering for one cell is a collection: the run counts and Monday night is not due', async () => {
    const b = await biz();
    await ran(b, at(0), { total: N, collected: N });
    H.answer = (engine: string) => { if (engine !== AI_ENGINES[0]) throw new Error('insufficient credit'); return works(); };
    expect(await look(b, at(7))).toEqual({ total: N, collected: 1 });
    expect(await counted(b, at(8))).toBe(at(7).toISOString());
    expect(await nights(b, 8, 14)).toEqual([['2027-06-20', 'Sun', { total: N, collected: N }]]);
  });

  it('a business with no prompts: its run has nothing to collect, counts, and is not retried nightly', async () => {
    const b = await biz(0);
    await ran(b, at(0), { total: 0, collected: 0 });
    H.answer = outOfCredit;                                       // nothing is asked, so this cannot matter
    expect(await look(b, at(7))).toEqual({ total: 0, collected: 0 });
    expect(await counted(b, at(8))).toBe(at(7).toISOString());
    expect(await nights(b, 8, 14, () => outOfCredit)).toEqual([['2027-06-20', 'Sun', { total: 0, collected: 0 }]]);
  });

  it('runs recorded before `collected` existed, skipped runs and runs still under way all count as before', async () => {
    const legacy = await biz(), noResult = await biz(), skipped = await biz(), running = await biz(), queued = await biz(), empty = await biz();
    await ran(legacy, at(7), { total: N });                       // the result every run stored before this change
    await ran(noResult, at(7), null);
    await ran(skipped, at(7), { skipped: 'no_access' });
    await ran(running, at(7), null, 'running'); await ran(queued, at(7), null, 'queued');
    await ran(empty, at(7), { total: N, collected: 0 });
    const m = await lastFullVisibilityRuns([legacy, noResult, skipped, running, queued, empty].map(b => b.id), at(8));
    expect([legacy, noResult, skipped, running, queued, empty].map(b => m.has(b.id))).toEqual([true, true, true, true, true, false]);
    // On Monday night only the business whose Sunday run came back empty is due.
    await nightlyTick(at(8));
    const newRuns = async (b: Biz) => (await db.select({ id: J.id }).from(J).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run')))).length - 1;
    expect(await Promise.all([legacy, noResult, skipped, running, queued, empty].map(newRuns))).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it('an empty Sunday run after a good run earlier that week waits until that good run is 8 days old', async () => {
    // Not the next night: the business still has Wednesday's answers, and the overdue rule counts from them.
    const b = await biz();
    await ran(b, at(0), { total: N, collected: N });
    await ran(b, at(3, 9), { total: N, collected: N });           // a catch-up on return, Wednesday midday
    const down = (n: number) => (n === 7 ? outOfCredit : works);
    expect(await nights(b, 4, 21, down)).toEqual([
      ['2027-06-13', 'Sun', { total: N, collected: 0 }],          // Monday, Tuesday, Wednesday: not due
      ['2027-06-17', 'Thu', { total: N, collected: N }],          // 8 days after Wednesday's run
      ['2027-06-20', 'Sun', { total: N, collected: N }], ['2027-06-27', 'Sun', { total: N, collected: N }],
    ]);
  });
});
