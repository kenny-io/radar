// AI visibility collection on the database (IS-5, IS-6): an answer that cannot name the business costs no extraction
// call and stores what the not-mentioned branch stores; a run bumps the workspace revision once, while the read model
// still shows each cell as it lands. The assistants are replaced by canned answers; everything else is real.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { answer: (_engine: string, _prompt: string): any => ({ text: '', cites: [], raw: null }), asked: 0, onAsk: null as null | ((n: number) => Promise<void>), tracked: [] as { kind: string; ref?: string | null; props?: any }[] }; });
vi.mock('./engines', async orig => ({ ...(await orig<typeof import('./engines')>()), askEngine: async (engine: string, prompt: string) => { const n = ++H.asked; if (H.onAsk) await H.onAsk(n); return H.answer(engine, prompt); } }));
vi.mock('@/server/events', async orig => ({ ...(await orig<typeof import('@/server/events')>()), trackSoon: (kind: string, o: any = {}) => { H.tracked.push({ kind, ref: o.ref, props: o.props }); } }));

import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { Fixtures } from '@/server/testing/fixtures';
import { enqueue, getJob, runJobNow } from '@/server/jobs/queue';
import { ai } from '@/server/ai';
import { AI_ENGINES } from '@/lib/constants';
import { todayIn } from '@/lib/format';
import { collectOne, listVisibility } from './collect';
import './jobs';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const TZ = 'America/New_York';
const A = schema.aiResults;
const profile = (domain: string) => ({ domain, business: { name: 'Fieldnote', description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: ['Tallyhour', 'Billable'] }, keywords: { list: [] }, brand: { primary: '#1F4D3A', secondary: '#F2B544', voice: '', language: 'English (US)', markets: ['United States'] } });
async function biz(prompts: string[]) {
  const u = await F.user(); const domain = `vis-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.test`;
  const b = await F.biz(u, { profile: profile(domain), domain });
  const ps = await db.insert(schema.aiPrompts).values(prompts.map(prompt => ({ businessId: b.id, prompt, source: 'keyword' as const }))).returning();
  const cells = await db.insert(A).values(ps.flatMap(p => AI_ENGINES.map(engine => ({ businessId: b.id, promptId: p.id, engine })))).returning();
  return { id: b.id, cells };
}
const cell = async (id: string) => (await db.select().from(A).where(eq(A.id, id)).limit(1))[0];
const rev = async (bid: string) => (await db.select({ rev: schema.businesses.rev }).from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0].rev;
const eventsFor = (ref: string) => H.tracked.filter(t => t.ref === ref && t.kind.startsWith('visibility.'));
const extractCalls = (spy: { mock: { calls: any[][] } }) => spy.mock.calls.filter(c => c[1]?.purpose === 'visibility.extract');
/** What a collected cell stores, apart from its own answer and the two timestamps. */
const stored = (r: typeof A.$inferSelect) => ({ status: r.status, pos: r.pos, error: r.error, date: String(r.date), cites: r.cites, raw: r.raw, collected: r.collectedAt instanceof Date, attempted: r.attemptedAt instanceof Date });

beforeEach(() => { H.asked = 0; H.onAsk = null; H.tracked.length = 0; vi.restoreAllMocks(); });

describe.skipIf(!ON)('AI visibility collection (database)', () => {
  afterAll(() => F.cleanup());

  it('an answer that cannot name the business makes no extraction call and stores exactly the not-mentioned result', async () => {
    const b = await biz(['What’s the best time tracking app for designers?']);
    const [skip, asked, named] = b.cells;
    // Every cell starts from an older measurement, so each path is seen to overwrite the same fields.
    await db.update(A).set({ status: 'mentioned', pos: 2, error: 'old failure', cites: ['https://old.example/'], resp: 'old', raw: { old: true } }).where(eq(A.businessId, b.id));
    const cites = ['https://www.g2.com/categories/time-tracking', 'https://www.g2.com/categories/time-tracking', '', 'https://zapier.com/blog/best-time-tracking-apps/'];
    const run = vi.spyOn(ai, 'run');

    // 1. Cannot match: the business is nowhere in the answer.
    H.answer = () => ({ text: 'Popular options include **Tallyhour** and Billable. Try a couple of free trials.', cites, raw: { engine: 'canned' } });
    expect(await collectOne(skip.id, { manual: false })).toEqual({ status: 'not-mentioned', collected: true });
    expect(extractCalls(run)).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();

    // 2. Might match ("Fieldnotes"), so extraction runs, and finds other names only: today's not-mentioned branch.
    H.answer = () => ({ text: 'Fieldnotes-style apps such as **Tallyhour** and Billable are popular.', cites, raw: { engine: 'canned' } });
    run.mockResolvedValueOnce({ json: { products: ['Tallyhour', 'Billable'] } } as any);
    expect(await collectOne(asked.id, { manual: false })).toEqual({ status: 'not-mentioned', collected: true });
    expect(extractCalls(run)).toHaveLength(1);

    const [s, a] = [await cell(skip.id), await cell(asked.id)];
    expect(stored(s)).toEqual(stored(a));
    expect(stored(s)).toEqual({ status: 'not-mentioned', pos: null, error: null, date: todayIn(TZ), cites: [cites[0], cites[3]], raw: { engine: 'canned' }, collected: true, attempted: true });
    expect(s.resp).toBe('Popular options include Tallyhour and Billable. Try a couple of free trials.');   // the cleaned answer, as always
    // Events: one "checked" each, the same shape, and no "mentioned".
    expect(eventsFor(skip.id)).toEqual([{ kind: 'visibility.checked', ref: skip.id, props: { engine: skip.engine, mentioned: false, pos: null, cites: 2 } }]);
    expect(eventsFor(asked.id)).toEqual([{ kind: 'visibility.checked', ref: asked.id, props: { engine: asked.engine, mentioned: false, pos: null, cites: 2 } }]);

    // 3. Named: extraction still runs (the dev stub lists known names in order) and the position comes from it.
    H.answer = () => ({ text: 'Tallyhour is popular; Fieldnote is worth a look.', cites: [], raw: null });
    expect(await collectOne(named.id, { manual: false })).toEqual({ status: 'mentioned', collected: true });
    expect(extractCalls(run)).toHaveLength(2);
    expect(await cell(named.id)).toMatchObject({ status: 'mentioned', pos: 2, error: null });
    expect(eventsFor(named.id).map(e => [e.kind, e.props.pos])).toEqual([['visibility.checked', 2], ['visibility.mentioned', 2]]);
  });

  it('a failed answer still leaves the earlier measurement and makes no extraction call', async () => {
    const b = await biz(['How should freelancers track billable hours?']);
    const [c] = b.cells;
    await db.update(A).set({ status: 'not-mentioned', resp: 'earlier' }).where(eq(A.id, c.id));
    const run = vi.spyOn(ai, 'run'); const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.answer = () => { throw new Error('assistant did not respond'); };
    // The earlier status comes back, but nothing was collected this time.
    expect(await collectOne(c.id, { manual: false })).toEqual({ status: 'not-mentioned', collected: false });
    expect(run).not.toHaveBeenCalled();
    expect(await cell(c.id)).toMatchObject({ status: 'not-mentioned', resp: 'earlier', error: 'assistant did not respond' });
    log.mockRestore();
  });

  it('a run bumps the workspace revision once, however many cells it collects, and the grid’s data fills in meanwhile', async () => {
    const b = await biz(['What’s the best time tracking app for designers?', 'How should small studios approach project budgets?']);
    expect(b.cells).toHaveLength(2 * AI_ENGINES.length);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A mix of outcomes: named, not named (extraction skipped), and one assistant that fails.
    H.answer = (engine, prompt) => { if (engine === AI_ENGINES[1] && /studios/.test(prompt)) throw new Error('assistant did not respond'); return { text: engine === AI_ENGINES[0] ? 'Tallyhour first, then Fieldnote.' : 'Popular options include Tallyhour and Billable.', cites: [], raw: null }; };
    // As the scheduled cron and the catch-up enqueue it.
    const id = await enqueue('visibility.run', {}, { businessId: b.id, ref: b.id, singletonKey: 'vis-run:' + b.id });
    const rev0 = await rev(b.id);
    const usedAt = async () => (await db.select({ at: schema.businesses.lastActiveAt }).from(schema.businesses).where(eq(schema.businesses.id, b.id)).limit(1))[0].at;
    await db.update(schema.businesses).set({ lastActiveAt: new Date(Date.now() - 3 * 3600e3) }).where(eq(schema.businesses.id, b.id));
    const used0 = await usedAt();
    // Part-way through (four cells at a time, so by the 7th question at least three answers are stored): what the AI
    // Visibility tab would load right now, and the revision at that moment.
    let mid: { landed: number; collecting: number; rev: number } | null = null;
    H.onAsk = async n => { if (n !== 7) return; const v = await listVisibility(b.id); mid = { landed: v.results.filter(r => !r.collecting).length, collecting: v.results.filter(r => r.collecting).length, rev: await rev(b.id) }; };
    await runJobNow(id);

    const j = (await getJob(id))!;
    expect([j.status, j.result, j.progress]).toEqual(['done', { total: 10, collected: 9 }, { done: 10, total: 10 }]);   // one assistant failed for one cell
    expect(await rev(b.id)).toBe(rev0 + 1);
    expect(await usedAt()).toEqual(used0);                    // a background job is not a member using the app
    expect(mid).not.toBeNull();
    expect(mid!.rev).toBe(rev0);                              // nothing bumped while cells were landing
    expect(mid!.landed).toBeGreaterThanOrEqual(3);            // ...yet the read model already shows them
    expect(mid!.collecting).toBeGreaterThanOrEqual(1);
    expect(mid!.landed + mid!.collecting).toBe(10);
    const after = await listVisibility(b.id);
    expect(after.results.filter(r => r.collecting)).toHaveLength(0);
    expect(after.results.map(r => r.status).sort()).toEqual([...Array(2).fill('mentioned'), ...Array(1).fill('not-collected'), ...Array(7).fill('not-mentioned')]);
  }, 30_000);

  it('“Collect now” for one cell bumps the revision once', async () => {
    const b = await biz(['What’s the best time tracking app for designers?']);
    H.answer = () => ({ text: 'Popular options include Tallyhour and Billable.', cites: [], raw: null });
    const id = await enqueue('visibility.collect', { resultId: b.cells[0].id }, { businessId: b.id, ref: b.cells[0].id, singletonKey: 'vis-collect:' + b.cells[0].id });
    const rev0 = await rev(b.id);
    await runJobNow(id);
    expect([(await getJob(id))!.status, (await cell(b.cells[0].id)).status]).toEqual(['done', 'not-mentioned']);
    expect((await getJob(id))!.result).toEqual({ status: 'not-mentioned' });   // the job's result is what it always was
    expect(await rev(b.id)).toBe(rev0 + 1);
  });
});
