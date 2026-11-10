// Which actions on today's brief earn the next background rescan (IS-7): each one is run through its real action and the
// day's `acted_at` is read back. Counted: copied, marked posted, skipped, scheduled from Radar, posted from Radar. Not
// counted: edits, toggles, undo, rewrite, visuals, moving or unscheduling, a send that failed, the worker's own send, expiry.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; });

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { ACTIONS } from '@/server/actions';
import { requireRole } from '@/server/access';
import { getBiz } from '@/server/workspace';
import { oauthProvider } from '@/server/oauth/registry';
import '@/server/oauth/providers';
import { RadarError } from '@/server/errors';
import { Fixtures, type TUser } from '@/server/testing/fixtures';
import { addDays, todayIn } from '@/lib/format';
import { briefSid } from '@/lib/socialPublish';
import type { BriefItem } from '@/lib/types';
import { P } from '../social/publish/pubs';
import { claimScheduled, runSend } from '../social/publish/send';
import { expirePastDays } from './store';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const TZ = 'America/New_York';
const D = schema.briefDays;
let owner: TUser; let bid = ''; let today = '';

async function act(name: string, input: any): Promise<any> {
  const def = ACTIONS[name];
  const role = await requireRole(bid, owner.id, def.role || (def.read ? 'Viewer' : 'Editor'));
  return def.run({ user: owner as any, bid, role, biz: await getBiz(bid) }, def.input ? def.input.parse(input ?? {}) : input);
}
const refusal = async (p: Promise<any>) => { try { await p; } catch (e: any) { return e instanceof RadarError ? e.code : String(e); } return 'no refusal'; };
const day = async (date = today) => (await db.select().from(D).where(and(eq(D.businessId, bid), eq(D.date, date))).limit(1))[0];
const item = async (id: string) => ((await day()).items as BriefItem[]).find(i => i.id === id)!;
const pub = async (id: string) => (await db.select().from(P).where(and(eq(P.businessId, bid), eq(P.sid, briefSid(today, id)))).limit(1))[0];
/** Run `fn` on a day nobody has acted on and say whether it counted. A counted action stamps the database's current time. */
async function counts(fn: () => Promise<unknown>): Promise<boolean> {
  await db.update(D).set({ actedAt: null }).where(and(eq(D.businessId, bid), eq(D.date, today)));
  const t0 = Date.now();
  await fn();
  const at = (await day()).actedAt;
  if (at) expect(Math.abs(at.getTime() - t0)).toBeLessThan(30_000);
  return !!at;
}
const reply = (id: string): BriefItem => ({ id, kind: 'reply', plat: 'reddit', where: 'r/freelance', url: `https://www.reddit.com/r/freelance/comments/${id}/`, title: 'How do you track hours?', tag: 't', why: 'w', drafts: { help: 'A helpful reply.', mention: 'A helpful reply that mentions Fieldnote.' }, edits: {}, mention: false, st: 'open' } as BriefItem);
const post = (id: string, pl: 'x' | 'linkedin', text = 'A post about billing by the hour.'): BriefItem => ({ id, kind: 'post', title: 'Billing', tag: 't', why: 'w', drafts: { linkedin: text, x: text }, edits: {}, mention: false, st: 'open', plats: ['linkedin', 'x'], pl, acct: 'founder' } as BriefItem);
async function connect(ch: 'x' | 'li_profile') {
  const r = await oauthProvider(ch === 'x' ? 'x' : 'linkedin')!.callback({ user: owner as any, bid, data: {}, redirectUri: 'http://test/cb', params: new URLSearchParams({ code: 'stub-code' }) });
  expect(r.ok).toBe(true);
  return act('social.connect', { ch, oauthRef: r.result.oauthRef });
}

describe.skipIf(!ON)('what earns a background rescan: acted_at per action (database)', () => {
  beforeAll(async () => {
    owner = await F.user(); const domain = `acted-${F.tag}.test`;
    const b = await F.biz(owner, { domain, profile: { domain, business: { name: 'Fieldnote', description: 'Time tracking and invoicing for independent designers.', offerings: ['Calendar-based time tracking'], industry: 'B2B software', positioning: '', differentiators: ['Tracks time from your calendar'] }, audience: { segments: ['Freelance designers'], buyers: ['Solo freelancer'], needs: ['Bill accurately'], competitors: ['Tallyhour'] }, keywords: { list: [{ kw: 'calendar time tracking', priority: true }] }, brand: { primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain-spoken and warm.', language: 'English (US)', markets: ['United States'] } } });
    bid = b.id; today = todayIn(TZ);
    await db.update(schema.businesses).set({ timezone: TZ, briefSetup: true }).where(eq(schema.businesses.id, bid));
    await db.insert(D).values({ businessId: bid, date: today, scannedAt: '06:00', items: [
      reply('r1'), reply('r2'), reply('r3'), reply('r4'),
      post('sched', 'linkedin'), post('now', 'x'), post('fail', 'x', 'This one is refused. [[radar:reject]]'), post('worker', 'x'), post('vis', 'linkedin'),
    ] });
    await connect('x'); await connect('li_profile');
  }, 30_000);
  afterAll(async () => { if (bid) { await db.delete(schema.events).where(eq(schema.events.businessId, bid)); } await F.cleanup(); });

  it('a new day starts with nothing earned', async () => {
    expect((await day()).actedAt).toBeNull();
  });

  it('counted: copying, marking posted and skipping an item', async () => {
    expect(await counts(() => act('brief.item', { date: today, id: 'r1', st: 'copied' }))).toBe(true);
    expect(await counts(() => act('brief.item', { date: today, id: 'r1', st: 'posted' }))).toBe(true);      // copied → posted
    expect(await counts(() => act('brief.item', { date: today, id: 'r2', st: 'posted' }))).toBe(true);      // straight to posted
    expect(await counts(() => act('brief.item', { date: today, id: 'r3', st: 'skipped' }))).toBe(true);
    // Copy with the unsaved edit the page sends along: still a copy.
    expect(await counts(() => act('brief.item', { date: today, id: 'r4', st: 'copied', edit: { v: 'help', text: 'My own words.' } }))).toBe(true);
    expect((await item('r4')).edits).toEqual({ help: 'My own words.' });
  });

  it('not counted: text edits, Restore draft, the mention toggle, a platform switch, visuals, a rewrite', async () => {
    expect(await counts(() => act('brief.item', { date: today, id: 'r4', edit: { v: 'help', text: 'Edited again.' } }))).toBe(false);
    expect(await counts(() => act('brief.item', { date: today, id: 'r4', edit: { v: 'help', text: null } }))).toBe(false);
    expect(await counts(() => act('brief.item', { date: today, id: 'r4', mention: true }))).toBe(false);
    expect((await item('r4')).mention).toBe(true);
    expect(await counts(() => act('brief.item', { date: today, id: 'vis', pl: 'x' }))).toBe(false);
    expect((await item('vis')).pl).toBe('x');
    expect(await counts(() => act('brief.visuals', { date: today, id: 'vis', style: null }))).toBe(false);
    expect(await counts(() => act('brief.rewrite', { date: today, id: 'r4', v: 'mention', text: 'A helpful reply.', instruction: 'Make it shorter' }))).toBe(false);
    expect((await item('r4')).st).toBe('open');               // a rewrite sends a copied item back to open: that is no action either
  });

  it('not counted: Undo back to open, and sending the state an item already has', async () => {
    expect((await item('r3')).st).toBe('skipped');
    expect(await counts(() => act('brief.item', { date: today, id: 'r3', st: 'open' }))).toBe(false);
    expect(await counts(() => act('brief.item', { date: today, id: 'r1', st: 'posted' }))).toBe(false);      // already posted
    expect(await counts(() => act('brief.item', { date: today, id: 'r3', st: 'open' }))).toBe(false);        // already open
    expect(await refusal(act('brief.item', { date: today, id: 'nope', st: 'copied' }))).toBe('not_found');
    expect((await day()).actedAt).toBeNull();                 // a refused action earns nothing
  });

  it('counted: scheduling and rescheduling from Radar; not counted: dragging to another day, unscheduling', async () => {
    const sid = briefSid(today, 'sched'); const tomorrow = addDays(today, 1);
    expect(await counts(() => act('social.schedule', { sid, date: tomorrow, time: '09:00' }))).toBe(true);
    expect((await pub('sched')).status).toBe('scheduled');
    expect(await counts(() => act('social.schedule', { sid, date: tomorrow, time: '10:30' }))).toBe(true);
    expect(await counts(() => act('social.move', { sid, date: addDays(today, 2) }))).toBe(false);
    expect(String((await pub('sched')).date)).toBe(addDays(today, 2));
    expect(await counts(() => act('social.unschedule', { sid }))).toBe(false);
    expect(await pub('sched')).toBeUndefined();
    // A schedule that is refused (a time already past) earns nothing.
    expect(await counts(async () => { expect(await refusal(act('social.schedule', { sid, date: addDays(today, -1), time: '09:00' }))).not.toBe('no refusal'); })).toBe(false);
  });

  it('counted: Post now that went out; not counted: Post now that failed, or the worker sending a scheduled post', async () => {
    expect(await counts(async () => { expect((await act('social.postNow', { sid: briefSid(today, 'now') })).pub.status).toBe('posted'); })).toBe(true);
    expect((await item('now')).st).toBe('posted');
    expect(await counts(async () => { expect((await act('social.postNow', { sid: briefSid(today, 'fail') })).pub.status).toBe('failed'); })).toBe(false);
    expect((await item('fail')).st).toBe('open');

    await act('social.schedule', { sid: briefSid(today, 'worker'), date: addDays(today, 1), time: '09:00' });
    expect(await counts(async () => {
      const row = await pub('worker');
      await db.update(P).set({ dueAt: new Date(Date.now() - 60_000), retryAt: null }).where(eq(P.id, row.id));
      const claimed = (await claimScheduled(row.id))!;
      expect((await runSend(claimed, { manual: false }))?.status).toBe('posted');
    })).toBe(false);
    expect((await item('worker')).st).toBe('posted');          // the item moved, nobody acted
  });

  it('not counted: the nightly expiry of a past day', async () => {
    const yesterday = addDays(today, -1);
    await db.insert(D).values({ businessId: bid, date: yesterday, scannedAt: '06:00', items: [reply('old1'), { ...reply('old2'), st: 'copied' }] });
    expect(await expirePastDays(bid, today)).toBe(1);
    const y = await day(yesterday);
    expect((y.items as BriefItem[]).map(i => i.st)).toEqual(['expired', 'expired']);
    expect(y.actedAt).toBeNull();
  });
});
