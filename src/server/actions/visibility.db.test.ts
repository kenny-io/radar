// visibility.addPrompt on the database, through the real route and the real job (VW-2): the new prompt's cells are
// collected at once and nothing else is; the run is prompt-scoped, so it does not count as the week's full run (VW-1).
// And what the grid shows meanwhile (visibility.list): a cell reads collecting when any queued or running run covers it.
// The assistants are replaced by a canned answer; everything else is real.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>(), asked: [] as string[] }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
vi.mock('@/server/services/visibility/engines', async orig => ({ ...(await orig<typeof import('@/server/services/visibility/engines')>()),
  askEngine: async (engine: string, prompt: string) => { H.asked.push(`${engine}|${prompt}`); return { text: 'Most teams pick Tallyhour or Billable.', cites: [], raw: null }; } }));

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures } from '../testing/fixtures';
import { runJobNow } from '../jobs/queue';
import { lastFullVisibilityRuns } from '../idle';
import { AI_ENGINES } from '@/lib/constants';
import { POST as ACT } from '@/app/api/b/[bid]/act/route';
import '../services/visibility/jobs';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const A = schema.aiResults; const J = schema.jobs;
const act = (bid: string, action: string, input: any = {}) => ACT(new Request('http://t/api/b/x/act', { method: 'POST', body: JSON.stringify({ action, input }), headers: { 'x-forwarded-for': '10.9.0.7' } }), { params: Promise.resolve({ bid }) });
const profile = (domain: string) => ({ domain, business: { name: 'Fieldnote', description: '', offerings: [], industry: '', positioning: '', differentiators: [] }, audience: { segments: [], buyers: [], needs: [], competitors: ['Tallyhour', 'Billable'] }, keywords: { list: [] }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } });
afterEach(() => { H.jar.clear(); H.asked.length = 0; });

describe.skipIf(!ON)('visibility.addPrompt (database, real route and job)', () => {
  afterAll(() => F.cleanup());

  it('queues one run for the new prompt, shows its cells as collecting, collects only them, and leaves the week’s full run due', async () => {
    const owner = await F.user(); const domain = `vis-add-${Date.now().toString(36)}.test`;
    const b = await F.biz(owner, { profile: profile(domain), domain });
    // A prompt already tracked, never collected: the new prompt's run must not touch it.
    const [old] = await db.insert(schema.aiPrompts).values({ businessId: b.id, prompt: 'What is the best time tracker for designers?', source: 'keyword' }).returning();
    await db.insert(A).values(AI_ENGINES.map(engine => ({ businessId: b.id, promptId: old.id, engine })));
    await F.signIn(owner, H.jar);

    const res = await act(b.id, 'visibility.addPrompt', { prompt: '  Which invoicing tool suits a small studio?  ' });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(['id', 'lastCollected', 'prompts', 'results']);
    expect(data.prompts.map((p: any) => [p.prompt, p.source])).toEqual([[old.prompt, 'keyword'], ['Which invoicing tool suits a small studio?', 'user']]);
    // Straight away the new prompt's five cells read as collecting, and the other prompt's do not.
    expect(data.results.filter((r: any) => r.promptId === data.id).map((r: any) => [r.engine, r.status, !!r.collecting])).toEqual(AI_ENGINES.map(e => [e, 'not-collected', true]));
    expect(data.results.filter((r: any) => r.promptId === old.id).some((r: any) => r.collecting)).toBe(false);

    const queued = await db.select().from(J).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run')));
    expect(queued.map(j => [j.status, j.payload, j.ref, j.singletonKey])).toEqual([['queued', { promptIds: [data.id] }, b.id, 'vis-prompt:' + data.id]]);
    // It is not a full run: the business's weekly run is still due on its Sunday.
    expect((await lastFullVisibilityRuns([b.id])).has(b.id)).toBe(false);

    await runJobNow(queued[0].id);
    expect((await db.select().from(J).where(eq(J.id, queued[0].id)))[0].status).toBe('done');
    expect(H.asked.sort()).toEqual(AI_ENGINES.map(e => `${e}|Which invoicing tool suits a small studio?`).sort());
    const cells = await db.select().from(A).where(eq(A.businessId, b.id));
    expect(cells.filter(c => c.promptId === data.id).map(c => c.status)).toEqual(AI_ENGINES.map(() => 'not-mentioned'));
    expect(cells.filter(c => c.promptId === old.id).map(c => [c.status, c.attemptedAt])).toEqual(AI_ENGINES.map(() => ['not-collected', null]));
    expect((await lastFullVisibilityRuns([b.id])).has(b.id)).toBe(false);
  });

  it('two prompts added one after the other each get their own run', async () => {
    const owner = await F.user(); const domain = `vis-add2-${Date.now().toString(36)}.test`;
    const b = await F.biz(owner, { profile: profile(domain), domain });
    await F.signIn(owner, H.jar);
    const first = (await (await act(b.id, 'visibility.addPrompt', { prompt: 'Which invoicing tool suits a small studio?' })).json()).data;
    const second = (await (await act(b.id, 'visibility.addPrompt', { prompt: 'How do freelancers track billable hours?' })).json()).data;
    const queued = await db.select().from(J).where(and(eq(J.businessId, b.id), eq(J.kind, 'visibility.run')));
    expect(queued.map(j => j.payload.promptIds[0]).sort()).toEqual([first.id, second.id].sort());
    // Both runs are queued: both prompts' cells read collecting, in the add response and in the grid, not only the first's.
    const collecting = (data: any, promptId: string) => data.results.filter((r: any) => r.promptId === promptId).map((r: any) => !!r.collecting);
    const grid = (await (await act(b.id, 'visibility.list')).json()).data;
    for (const data of [second, grid]) expect([collecting(data, first.id), collecting(data, second.id)]).toEqual([AI_ENGINES.map(() => true), AI_ENGINES.map(() => true)]);
    expect(Object.keys(grid).sort()).toEqual(['lastCollected', 'prompts', 'results']);
    // The first run finishes: its cells show their answers, the second prompt's are still collecting.
    await runJobNow(queued.find(j => j.payload.promptIds[0] === first.id)!.id);
    const after = (await (await act(b.id, 'visibility.list')).json()).data;
    expect([collecting(after, first.id), collecting(after, second.id)]).toEqual([AI_ENGINES.map(() => false), AI_ENGINES.map(() => true)]);
    expect(after.results.filter((r: any) => r.promptId === first.id).map((r: any) => r.status)).toEqual(AI_ENGINES.map(() => 'not-mentioned'));
  });

  it('a prompt-scoped run marks only its own prompt; a full run queued behind it marks every cell not attempted since', async () => {
    const owner = await F.user(); const domain = `vis-add3-${Date.now().toString(36)}.test`;
    const b = await F.biz(owner, { profile: profile(domain), domain });
    // A prompt collected an hour ago.
    const hourAgo = new Date(Date.now() - 3600e3);
    const [old] = await db.insert(schema.aiPrompts).values({ businessId: b.id, prompt: 'What is the best time tracker for designers?', source: 'keyword' }).returning();
    await db.insert(A).values(AI_ENGINES.map(engine => ({ businessId: b.id, promptId: old.id, engine, status: 'not-mentioned' as const, attemptedAt: hourAgo, collectedAt: hourAgo })));
    await F.signIn(owner, H.jar);
    const added = (await (await act(b.id, 'visibility.addPrompt', { prompt: 'Which invoicing tool suits a small studio?' })).json()).data;
    const collecting = (data: any, promptId: string) => data.results.filter((r: any) => r.promptId === promptId).map((r: any) => !!r.collecting);
    expect([collecting(added, old.id), collecting(added, added.id)]).toEqual([AI_ENGINES.map(() => false), AI_ENGINES.map(() => true)]);

    // The weekly run (or a catch-up) is queued behind the prompt's own run.
    const [full] = await db.insert(J).values({ businessId: b.id, kind: 'visibility.run', ref: b.id, status: 'queued', payload: {} }).returning({ id: J.id });
    const both = (await (await act(b.id, 'visibility.list')).json()).data;
    expect([collecting(both, old.id), collecting(both, added.id)]).toEqual([AI_ENGINES.map(() => true), AI_ENGINES.map(() => true)]);

    // The full run is under way and has reached one cell: that cell shows its answer, the rest still read collecting.
    const cells = await db.select().from(A).where(eq(A.businessId, b.id));
    const done = cells.find(c => c.promptId === old.id)!;
    await db.update(J).set({ status: 'running' }).where(eq(J.id, full.id));
    await db.update(A).set({ attemptedAt: new Date(Date.now() + 1000) }).where(eq(A.id, done.id));
    const midway = (await (await act(b.id, 'visibility.list')).json()).data;
    expect(midway.results.filter((r: any) => r.collecting).length).toBe(AI_ENGINES.length * 2 - 1);
    expect(midway.results.find((r: any) => r.id === done.id).collecting).toBeUndefined();

    // Nothing queued or running: nothing reads collecting.
    await db.update(J).set({ status: 'done', finishedAt: new Date() }).where(eq(J.businessId, b.id));
    const idle = (await (await act(b.id, 'visibility.list')).json()).data;
    expect(idle.results.some((r: any) => r.collecting)).toBe(false);
  });
});
