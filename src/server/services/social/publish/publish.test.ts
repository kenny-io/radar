// Posting from Radar against a real Postgres (DATABASE_URL, e.g. the radar_server dev database) with dev stubs. Each run
// creates its own users and business and deletes them afterwards. Skipped when DATABASE_URL isn't set.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1';
  process.env.RADAR_SOCIAL_PUBLISHING = 'all';
  process.env.STORAGE_DIR = '.data/test-social-uploads';
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db, schema } from '../../../db';
import { ACTIONS } from '../../../actions';
import { requireRole } from '../../../access';
import { getBiz, loadWorkspace } from '../../../workspace';
import { oauthProvider } from '../../../oauth/registry';
import '../../../oauth/providers';
import { jobDefs } from '../../../jobs/queue';
import '../../../jobs/all';
import { RadarError } from '../../../errors';
import { encrypt } from '../../../crypto';
import { COPY, briefSid, errCopy, failedLine, packSid, zonedTimeToUtc } from '@/lib/socialPublish';
import { addDays, todayIn } from '@/lib/format';
import type { BriefItem, User } from '@/lib/types';
import { type Adapter, TokenError } from './api';
import { ensureToken, setAdapterForTests, tokensOf, tokensTick, AccountExpired } from './accounts';
import { stubAdapter, stubState } from './stubs';
import { claimScheduled, recoverStuck, runSend, sendHooks } from './send';
import { publisherTick } from './jobs';
import { P } from './pubs';
import { REPLY_SCHEDULE } from './schedule';

const ON = !!process.env.DATABASE_URL;
const TZ = 'America/New_York';
const S = schema;
let owner: User; let viewer: User; let bid = ''; let today = '';
const PACK = 'ptest' + Date.now().toString(36);

async function act(name: string, input: any, u: User = owner): Promise<any> {
  const def = ACTIONS[name];
  if (!def) throw new RadarError('Unknown action', 404, 'unknown_action');
  const role = await requireRole(bid, u.id, def.role || (def.read ? 'Viewer' : 'Editor'));
  return def.run({ user: u, bid, role, biz: await getBiz(bid) }, def.input ? def.input.parse(input ?? {}) : input);
}
const refusal = async (p: Promise<any>) => { try { await p; } catch (e: any) { return e instanceof RadarError ? e.userMessage : String(e); } return 'no refusal'; };
async function connect(ch: 'x' | 'li_profile' | 'li_page', o: { as?: string; pageId?: string } = {}) {
  const provider = ch === 'x' ? 'x' : ch === 'li_profile' ? 'linkedin' : 'linkedin_page';
  const params = new URLSearchParams({ code: 'stub-code', ...(o.as ? { stub_as: o.as } : {}) });
  const r = await oauthProvider(provider)!.callback({ user: owner, bid, data: {}, redirectUri: 'http://test/cb', params });
  expect(r.ok).toBe(true);
  return act('social.connect', { ch, oauthRef: r.result.oauthRef, ...(o.pageId ? { pageId: o.pageId } : {}) });
}
const accts = () => db.select().from(S.socialAccounts).where(eq(S.socialAccounts.businessId, bid));
const pub = async (sid: string) => (await db.select().from(P).where(and(eq(P.businessId, bid), eq(P.sid, sid))).limit(1))[0];
const setText = (k: 'x' | 'linkedin', text: string) => act('social.text', { packId: PACK, platform: k, text });
/** Make a scheduled row due now (as if its time had come), bypassing the schedule window. */
const makeDue = (sid: string, agoMs = 60_000) => db.update(P).set({ dueAt: new Date(Date.now() - agoMs), retryAt: null }).where(and(eq(P.businessId, bid), eq(P.sid, sid)));
const tomorrow9 = () => ({ date: addDays(today, 1), time: '09:00' });
async function clearPubs() { await db.delete(P).where(eq(P.businessId, bid)); }
const item = (id: string, o: Partial<BriefItem>): BriefItem => ({ id, kind: 'post', title: 'Billing', tag: 't', why: 'w', drafts: { linkedin: 'A LinkedIn feed post about billing.', x: 'An X post about billing.' }, edits: {}, mention: false, st: 'open', plats: ['linkedin', 'x'], pl: 'linkedin', ...o });

describe.skipIf(!ON)('social channels (database)', () => {
  beforeAll(async () => {
    const tag = Date.now().toString(36);
    [owner] = await db.insert(S.users).values({ name: 'Test Owner', email: `sc-owner-${tag}@test.local` }).returning() as any;
    [viewer] = await db.insert(S.users).values({ name: 'Test Viewer', email: `sc-viewer-${tag}@test.local` }).returning() as any;
    const [b] = await db.insert(S.businesses).values({ ownerId: owner.id, domain: `sc-${tag}.test`, status: 'active', timezone: TZ, profile: { business: { name: 'Fieldnote' }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } } }).returning();
    bid = b.id; today = todayIn(TZ);
    await db.insert(S.members).values([{ businessId: bid, userId: owner.id, email: owner.email, role: 'Owner' }, { businessId: bid, userId: viewer.id, email: viewer.email, role: 'Viewer' }]);
    await db.insert(S.socialPacks).values({ id: PACK, businessId: bid, data: { id: PACK, name: 'Billing', source: { kind: 'idea', label: 'Billing' }, created: today, style: 'branded', auto: false, headline: 'Billing',
      posts: { x: { text: 'How we bill by the hour.', style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 }, linkedin: { text: 'How we bill by the hour, on LinkedIn.', style: 'branded', seed: 2, imageUrl: null, copiedAt: null, v: 0 }, reddit: { text: 'r', style: 'branded', seed: 3, imageUrl: null, copiedAt: null, v: 0 } } } });
    await db.insert(S.briefDays).values({ businessId: bid, date: today, scannedAt: new Date().toISOString(), items: [
      item('feed1', { acct: 'founder' }), item('co1', { acct: 'company' }),
      { ...item('x:1843000000000000001', { kind: 'reply', plat: 'x', url: 'https://x.com/someone/status/1843000000000000001', drafts: { help: 'A helpful reply.' } }), plats: undefined, pl: undefined },
    ] });
  }, 30_000);
  afterAll(async () => {
    if (!bid) return;
    const ids = (await accts()).map(a => a.id);
    for (const id of ids) await db.delete(S.cronMarks).where(like(S.cronMarks.key, `%${id}%`));
    await db.delete(S.events).where(eq(S.events.businessId, bid));
    await db.delete(S.notifications).where(eq(S.notifications.businessId, bid));
    await db.delete(S.businesses).where(eq(S.businesses.id, bid));
    await db.delete(S.users).where(inArray(S.users.id, [owner.id, viewer.id]));
    await fs.rm(path.join(process.cwd(), '.data/test-social-uploads'), { recursive: true, force: true });
  });
  beforeEach(() => { process.env.RADAR_SOCIAL_PUBLISHING = 'all'; setAdapterForTests('x', null); setAdapterForTests('li_profile', null); setAdapterForTests('li_page', null); });

  it('connects all three channels through the OAuth callback and projects them (no tokens in the workspace)', async () => {
    const x = await connect('x');
    expect(x).toMatchObject({ reconnected: false, released: 0, account: { ch: 'x', handle: '@fieldnoteapp', name: 'Fieldnote', expired: false, expiresAt: null } });
    const pend = (await oauthProvider('linkedin_page')!.callback({ user: owner, bid, data: {}, redirectUri: 'http://test/cb', params: new URLSearchParams({ code: 'stub-code' }) })).result.oauthRef;
    expect((await act('social.pages', { oauthRef: pend })).pages.map((p: any) => p.id)).toEqual(['stub-pg1', 'stub-pg2']);
    expect((await act('social.pages', { oauthRef: 'spend_nope' })).error).toBe('The sign-in expired. Try again.');
    await connect('li_page', { pageId: 'stub-pg1' });
    const prof = await connect('li_profile');
    expect(Date.parse(prof.account.expiresAt) - Date.now()).toBeGreaterThan(59 * 864e5); // 60-day token, no refresh
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    expect(ws.social.publishing).toBe(true);
    expect(ws.social.channels).toEqual(['x', 'li_profile', 'li_page']);
    expect(ws.social.accounts!.map(a => a.ch).sort()).toEqual(['li_page', 'li_profile', 'x']);
    expect(typeof ws.now).toBe('string');
    expect(JSON.stringify(ws)).not.toMatch(/stub-(x|li|lp)-(at|rt)-/);
    expect(ws.social.packs.find(p => p.id === PACK)!.posts.x!.pub).toBeNull();
  });

  it('Viewers are refused every new action; Editors pass the role check', async () => {
    for (const name of Object.keys(ACTIONS).filter(n => n.startsWith('social.') && !['social.copied', 'social.ideas', 'social.generate', 'social.text', 'social.regenText', 'social.regenImage', 'social.style', 'social.auto'].includes(n))) {
      expect(await refusal(act(name, {}, viewer)), name).toBe('You don’t have permission to do that.');
    }
  });

  it('routes Brief posts: feed → profile, company → page; X replies are refused by Post now and Schedule', async () => {
    const accounts = await accts(); const by = (ch: string) => accounts.find(a => a.ch === ch)!.id;
    const feed = await act('social.schedule', { sid: briefSid(today, 'feed1'), ...tomorrow9() });
    expect(feed.pub.acct).toBe(by('li_profile'));
    const co = await act('social.schedule', { sid: briefSid(today, 'co1'), ...tomorrow9() });
    expect(co.pub.acct).toBe(by('li_page'));
    expect(co.pub.direct).toBe(true);
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    const items = ws.brief.days[today].items;
    expect(items.find(i => i.id === 'co1')!.st).toBe('scheduled');
    expect(ws.counts.briefOpen).toBe(1); // only the reply: scheduled posts leave the to-do count
    const reply = briefSid(today, 'x:1843000000000000001');
    expect(await refusal(act('social.postNow', { sid: reply }))).toBe(COPY.replyNotAllowed);
    expect(await refusal(act('social.schedule', { sid: reply, ...tomorrow9() }))).toBe(REPLY_SCHEDULE);
    // A scheduled Brief item keeps its state and platform until it's unscheduled.
    expect(await refusal(act('brief.item', { date: today, id: 'co1', st: 'skipped' }))).toBe(COPY.unscheduleFirst);
    expect(await refusal(act('brief.item', { date: today, id: 'co1', pl: 'x' }))).toBe(COPY.unscheduleFirst);
    await act('social.unschedule', { sid: briefSid(today, 'co1') });
    await act('social.unschedule', { sid: briefSid(today, 'feed1') });
    expect((await loadWorkspace(bid, owner.id, 'Owner')).brief.days[today].items.find(i => i.id === 'co1')!.st).toBe('open');
  });

  it('enforces preflight, past-time, too-far and lock rules on the server', async () => {
    const sx = packSid(PACK, 'x');
    await setText('x', 'a'.repeat(281));
    expect(await refusal(act('social.schedule', { sid: sx, ...tomorrow9() }))).toBe('Shorten to 280 characters to post on X. It’s 281 now.');
    expect(await refusal(act('social.postNow', { sid: sx }))).toBe('Shorten to 280 characters to post on X. It’s 281 now.');
    await setText('x', 'a'.repeat(250) + ' https://fieldnote.app/a/very/long/path/that/counts/as/twenty-three'); // a URL counts 23
    expect(await refusal(act('social.schedule', { sid: sx, date: addDays(today, -1), time: '09:00' }))).toBe(COPY.pastDay);
    expect(await refusal(act('social.schedule', { sid: sx, date: today, time: '00:00' }))).toBe(COPY.pastTime);
    expect(await refusal(act('social.schedule', { sid: sx, date: addDays(today, 400), time: '09:00' }))).toBe(COPY.tooFar);
    const ok = await act('social.schedule', { sid: sx, ...tomorrow9() });
    expect(ok.pub).toMatchObject({ status: 'scheduled', date: addDays(today, 1), time: '09:00', dueAt: new Date(zonedTimeToUtc(addDays(today, 1), '09:00', TZ)).toISOString() });
    // The image was rendered on the server and its meta recorded for the checks.
    const post = (await db.select().from(S.socialPacks).where(eq(S.socialPacks.id, PACK)))[0].data.posts.x;
    expect(post.imageUrl).toMatch(/^\/api\/files\//); expect(post.imageMeta).toMatchObject({ type: 'image/png' });
    // Inside the 5-minute window: no edits, moves, reschedules or unschedules.
    await db.update(P).set({ dueAt: new Date(Date.now() + 3 * 60_000) }).where(and(eq(P.businessId, bid), eq(P.sid, sx)));
    expect(await refusal(setText('x', 'changed'))).toBe(COPY.lockedEdit);
    expect(await refusal(act('social.regenImage', { packId: PACK, platform: 'x' }))).toBe(COPY.lockedEdit);
    expect(await refusal(act('social.move', { sid: sx, date: addDays(today, 2) }))).toBe(COPY.lockedMove);
    expect(await refusal(act('social.schedule', { sid: sx, ...tomorrow9() }))).toBe(COPY.lockedMove);
    expect(await refusal(act('social.unschedule', { sid: sx }))).toBe(COPY.lockedMove);
    expect(await refusal(act('social.postNow', { sid: sx }))).toBe(COPY.sending);
    // Out of the window: drag keeps the time; past days refused.
    await db.update(P).set({ dueAt: new Date(zonedTimeToUtc(addDays(today, 1), '09:00', TZ)) }).where(and(eq(P.businessId, bid), eq(P.sid, sx)));
    expect(await refusal(act('social.move', { sid: sx, date: addDays(today, -1) }))).toBe(COPY.pastDay);
    const mv = await act('social.move', { sid: sx, date: addDays(today, 3) });
    expect(mv.pub).toMatchObject({ date: addDays(today, 3), time: '09:00' });
    await act('social.unschedule', { sid: sx });
    expect(await pub(sx)).toBeUndefined();
  });

  it('two concurrent Post now clicks produce one post', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'One post only, please.');
    const before = stubState.creates;
    const rs = await Promise.allSettled([act('social.postNow', { sid: sx }), act('social.postNow', { sid: sx })]);
    expect(stubState.creates - before).toBe(1);
    const ok = rs.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(1);
    expect(ok[0].value.pub).toMatchObject({ status: 'posted', url: expect.stringMatching(/^https:\/\/x\.com\/fieldnoteapp\/status\/\d+$/) });
    expect([COPY.sending, COPY.alreadyPosted]).toContain((rs.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.userMessage);
    expect(await refusal(act('social.postNow', { sid: sx }))).toBe(COPY.alreadyPosted);
    expect(await refusal(act('social.schedule', { sid: sx, ...tomorrow9() }))).toBe(COPY.alreadyPosted);
    const ev = await db.select().from(S.events).where(and(eq(S.events.businessId, bid), eq(S.events.kind, 'social.posted')));
    expect(ev[0].props).toMatchObject({ sid: sx, platform: 'x', scheduled: false, costUsd: 0.015 });
    expect(JSON.stringify(ev[0].props)).not.toContain('One post only');
    await clearPubs();
  });

  it('a scheduled post is claimed once, sends the latest text, and a re-run job does nothing', async () => {
    const sl = packSid(PACK, 'linkedin');
    await act('social.schedule', { sid: sl, ...tomorrow9() });
    await act('social.text', { packId: PACK, platform: 'linkedin', text: 'Edited after scheduling.' });
    await makeDue(sl);
    const id = (await pub(sl)).id;
    const [a, b] = await Promise.all([claimScheduled(id), claimScheduled(id)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const done = await runSend((a || b)!, { manual: false });
    expect(done).toMatchObject({ status: 'posted', remoteUrl: expect.stringContaining('linkedin.com/feed/update/urn:li:share:') });
    expect(done!.payload.text).toBe('Edited after scheduling.');
    const before = stubState.creates;
    const r = await jobDefs().get('social.send')!.run({ payload: { pubId: id } } as any);
    expect(r).toMatchObject({ skipped: 'posted' });
    expect(stubState.creates).toBe(before);
    await clearPubs();
  });

  it('nothing after a successful create can cause a resend (posted is saved first)', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Live even if the follow-up breaks.');
    const keep = sendHooks.afterPosted; sendHooks.afterPosted = async () => { throw new Error('follow-up exploded'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const before = stubState.creates;
      const r = await act('social.postNow', { sid: sx });
      expect(r.pub.status).toBe('posted');
      await publisherTick(new Date());
      await jobDefs().get('social.send')!.run({ payload: { pubId: (await pub(sx)).id } } as any);
      expect(stubState.creates - before).toBe(1);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('follow-up failed'));
    } finally { sendHooks.afterPosted = keep; err.mockRestore(); await clearPubs(); }
  });

  it('rate limits back off three times, then fail with "Try again later"', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Busy day [[radar:ratelimit]]');
    await act('social.schedule', { sid: sx, ...tomorrow9() });
    for (let i = 1; i <= 4; i++) {
      await makeDue(sx);
      const c = await claimScheduled((await pub(sx)).id);
      expect(c?.attempts).toBe(i);
      const r = await runSend(c!, { manual: false });
      if (i < 4) { expect(r).toMatchObject({ status: 'scheduled' }); expect(r!.retryAt!.getTime()).toBeGreaterThan(Date.now()); }
      else expect(r).toMatchObject({ status: 'failed', errCode: 'rate_limit', err: errCopy('rate_limit', 'x') });
    }
    expect(failedLine({ err: (await pub(sx)).err, code: 'rate_limit', platform: 'x' })).toBe('X is limiting posts right now. Try again later. Nothing was published.');
    expect((await db.select().from(S.notifications).where(eq(S.notifications.businessId, bid))).some(n => n.payload.msg === 'A X post didn’t go out.')).toBe(true);
    // Try again (Post now) on the failed row reuses it; a manual transient failure fails at once.
    const again = await act('social.postNow', { sid: sx });
    expect(again.pub).toMatchObject({ status: 'failed', code: 'rate_limit' });
    await clearPubs();
  });

  it('unknown outcome: X reads back (found → posted, not found → unknown); LinkedIn fails as unknown, never resent', async () => {
    const sx = packSid(PACK, 'x'); const sl = packSid(PACK, 'linkedin');
    await setText('x', 'Lost response [[radar:lost]]');
    const before = stubState.creates;
    expect((await act('social.postNow', { sid: sx })).pub).toMatchObject({ status: 'posted' });
    expect(stubState.creates - before).toBe(1);
    await clearPubs();
    await setText('x', 'Timed out [[radar:timeout]]');
    const t = (await act('social.postNow', { sid: sx })).pub;
    expect(t).toMatchObject({ status: 'failed', code: 'unknown' });
    expect(failedLine(t)).toBe('Radar couldn’t confirm the post went out. Check X before trying again.');
    await act('social.text', { packId: PACK, platform: 'linkedin', text: 'LinkedIn lost [[radar:lost]]' });
    const l = (await act('social.postNow', { sid: sl })).pub;
    expect(l).toMatchObject({ status: 'failed', code: 'unknown' });
    expect(failedLine(l)).not.toMatch(/Nothing was published/);
    await clearPubs();
  });

  it('a stuck sending row is verified, not resent; one stuck before create retries', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Crashed after create [[radar:lost]]');
    await act('social.schedule', { sid: sx, ...tomorrow9() });
    await makeDue(sx);
    const c = (await claimScheduled((await pub(sx)).id))!;
    // Simulate a crash after the create request: the platform has it, the row says sending/create.
    const a = (await accts()).find(x => x.ch === 'x')!;
    await stubAdapter('x').create({ ch: 'x', remoteId: a.remoteId, handle: a.handle, token: '' }, { text: 'Crashed after create [[radar:lost]]', mediaIds: [] }).catch(() => {});
    await db.update(P).set({ stage: 'create', payload: { text: 'Crashed after create [[radar:lost]]', media: [] }, claimedAt: new Date(Date.now() - 4 * 60_000) }).where(eq(P.id, c.id));
    const before = stubState.creates;
    // The dead attempt can no longer write once the row is re-keyed.
    const r = await recoverStuck(c.id);
    expect(r).toMatchObject({ status: 'posted' });
    expect(stubState.creates).toBe(before);
    expect(await runSend(c, { manual: false })).toBeNull();
    await clearPubs();
    await setText('x', 'Crashed during media upload.');
    await act('social.schedule', { sid: sx, ...tomorrow9() }); await makeDue(sx);
    const c2 = (await claimScheduled((await pub(sx)).id))!;
    await db.update(P).set({ claimedAt: new Date(Date.now() - 4 * 60_000) }).where(eq(P.id, c2.id));
    expect(await recoverStuck(c2.id)).toMatchObject({ status: 'scheduled', retryAt: expect.any(Date) });
    await clearPubs();
  });

  it('a post more than 24 h late fails as stale and is never sent', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Old news.');
    await act('social.schedule', { sid: sx, ...tomorrow9() });
    await makeDue(sx, 25 * 3600e3);
    expect(await claimScheduled((await pub(sx)).id)).toBeNull();
    await publisherTick(new Date());
    expect(await pub(sx)).toMatchObject({ status: 'failed', errCode: 'stale', err: errCopy('stale', 'x') });
    await clearPubs();
  });

  it('token refresh: one refresh under the row lock, the rotated pair is saved; transient vs definitive', async () => {
    const a = (await accts()).find(x => x.ch === 'x')!;
    let n = 0; const seen: string[] = [];
    const rot: Adapter = { ...stubAdapter('x'), refresh: async t => { n++; seen.push(String(t.refresh_token)); await new Promise(r => setTimeout(r, 150)); return { ...t, access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_at: Date.now() + 7200e3 }; } };
    setAdapterForTests('x', rot);
    const t0 = tokensOf(a)!;
    await db.update(S.socialAccounts).set({ tokensEnc: encrypt({ ...t0, refresh_token: 'rt-0', expires_at: Date.now() - 1000 }) }).where(eq(S.socialAccounts.id, a.id));
    const [r1, r2] = await Promise.all([ensureToken(a.id), ensureToken(a.id)]);
    expect(n).toBe(1); expect(seen).toEqual(['rt-0']);
    expect(r1.t.access_token).toBe('at-1'); expect(r2.t.access_token).toBe('at-1');
    expect(tokensOf((await accts()).find(x => x.id === a.id)!)).toMatchObject({ access_token: 'at-1', refresh_token: 'rt-1', stub: true });
    // Transient (5xx / network): not expired.
    setAdapterForTests('x', { ...rot, refresh: async () => { throw new TokenError(false, '503'); } });
    await expect(ensureToken(a.id, { force: true })).rejects.toMatchObject({ kind: 'transient', code: 'unavailable' });
    expect((await accts()).find(x => x.id === a.id)!.expired).toBe(false);
    setAdapterForTests('x', null);
  });

  it('expired account: posts are held, a reconnect keeps the id and releases them, another account is refused', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Held until reconnect.');
    await act('social.schedule', { sid: sx, ...tomorrow9() });
    const a = (await accts()).find(x => x.ch === 'x')!;
    await act('social.devSimulate', { acctId: a.id, what: 'expire' });
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    expect(ws.social.accounts!.find(x => x.id === a.id)!.expired).toBe(true);
    expect(ws.social.packs.find(p => p.id === PACK)!.posts.x!.pub).toMatchObject({ status: 'scheduled', held: true });
    expect((await db.select().from(S.notifications).where(eq(S.notifications.businessId, bid))).some(x => x.payload.msg === 'X needs reconnecting. 1 scheduled post is on hold.')).toBe(true);
    await makeDue(sx);
    expect(await claimScheduled((await pub(sx)).id)).toBeNull(); // held posts never send
    expect(await refusal(act('social.schedule', { sid: packSid(PACK, 'x'), ...tomorrow9() }))).toBe(COPY.expired('x'));
    // A held post past its time can still be moved (never locked while held).
    await act('social.move', { sid: sx, date: addDays(today, 2) });
    expect(await refusal(connect('x', { as: 'other' }))).toBe('You signed in as @otherapp. Sign in as @fieldnoteapp to keep its scheduled posts, or disconnect it first.');
    const re = await connect('x');
    expect(re).toMatchObject({ reconnected: true, released: 1, account: { id: a.id, expired: false } });
    await clearPubs();
  });

  it('LinkedIn profile: social.tokens expires it at expires_at with no refresh call; later posts are held', async () => {
    const a = (await accts()).find(x => x.ch === 'li_profile')!;
    let refreshes = 0; setAdapterForTests('li_profile', { ...stubAdapter('li_profile'), refresh: async t => { refreshes++; return t; } });
    await act('social.schedule', { sid: briefSid(today, 'feed1'), ...tomorrow9() });
    await act('social.devSimulate', { acctId: a.id, what: 'lapse' });
    await tokensTick(new Date());
    expect((await accts()).find(x => x.id === a.id)!.expired).toBe(false); // still 2 minutes left
    const ws0 = await loadWorkspace(bid, owner.id, 'Owner');
    expect(Date.parse(ws0.social.accounts!.find(x => x.id === a.id)!.expiresAt!) - Date.now()).toBeLessThan(3 * 60_000);
    // Two minutes later: the 60-day token has ended.
    const lapsed = { ...tokensOf((await accts()).find(x => x.id === a.id)!)!, expires_at: Date.now() - 1000 };
    await db.update(S.socialAccounts).set({ tokensEnc: encrypt(lapsed), expiresAt: new Date(lapsed.expires_at) }).where(eq(S.socialAccounts.id, a.id));
    await tokensTick(new Date());
    expect((await accts()).find(x => x.id === a.id)!.expired).toBe(true);
    expect(refreshes).toBe(0);
    const ev = await db.select().from(S.events).where(and(eq(S.events.businessId, bid), eq(S.events.kind, 'social.expired'), eq(S.events.ref, a.id)));
    expect(ev.at(-1)!.props).toMatchObject({ ch: 'li_profile', held: 1 });
    expect((await loadWorkspace(bid, owner.id, 'Owner')).brief.days[today].items.find(i => i.id === 'feed1')!.pub).toMatchObject({ held: true });
    await expect(ensureToken(a.id)).rejects.toBeInstanceOf(AccountExpired);
    await connect('li_profile'); // reconnect for later tests
    await clearPubs();
  });

  it('disconnect deletes the tokens and unschedules that account’s posts, with the count; posted history stays', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Before disconnect.');
    await act('social.postNow', { sid: sx });
    await act('social.schedule', { sid: briefSid(today, 'co1'), ...tomorrow9() });
    await act('social.schedule', { sid: packSid(PACK, 'linkedin'), ...tomorrow9() }); // pickAccount → the page
    const page = (await accts()).find(x => x.ch === 'li_page')!;
    expect((await pub(packSid(PACK, 'linkedin'))).acctId).toBe(page.id);
    expect(await act('social.disconnect', { acctId: page.id })).toEqual({ ch: 'li_page', unscheduled: 2 });
    expect((await accts()).some(x => x.ch === 'li_page')).toBe(false);
    expect(await pub(briefSid(today, 'co1'))).toBeUndefined();
    const x = (await accts()).find(a => a.ch === 'x')!;
    expect(await act('social.disconnect', { acctId: x.id })).toEqual({ ch: 'x', unscheduled: 0 });
    expect(await pub(sx)).toMatchObject({ status: 'posted', acctId: null, acctLabel: '@fieldnoteapp' });
    expect(await refusal(act('social.postNow', { sid: packSid(PACK, 'x') }))).toBe(COPY.alreadyPosted);
    await clearPubs();
    await connect('x'); await connect('li_page', { pageId: 'stub-pg1' });
  });

  it('a Brief post sent directly is posted for good, like "I posted it", and keeps counting in impact events', async () => {
    const sid = briefSid(today, 'feed1');
    const r = await act('social.postNow', { sid });
    expect(r.pub).toMatchObject({ status: 'posted', platform: 'linkedin', direct: true });
    const it = (await loadWorkspace(bid, owner.id, 'Owner')).brief.days[today].items.find(i => i.id === 'feed1')!;
    expect(it.st).toBe('posted');
    expect(await refusal(act('brief.item', { date: today, id: 'feed1', st: 'open' }))).toBe(COPY.alreadyPosted); // no Undo
    const ev = await db.select().from(S.events).where(and(eq(S.events.businessId, bid), eq(S.events.kind, 'brief.post_posted')));
    expect(ev.at(-1)!.props).toMatchObject({ direct: true, plat: 'linkedin' });
    await clearPubs();
    await db.update(S.briefDays).set({ items: sql`jsonb_set(items, '{0,st}', '"open"')` }).where(and(eq(S.briefDays.businessId, bid), eq(S.briefDays.date, today)));
  });

  it('an image LinkedIn can’t take blocks scheduling until Compress images re-encodes it', async () => {
    const { createCanvas } = await import('@napi-rs/canvas');
    const { putObject, objectKey } = await import('../../storage');
    const c = createCanvas(400, 300); c.getContext('2d').fillRect(0, 0, 200, 150);
    const url = await putObject(objectKey(bid, 'social', 'webp'), c.toBuffer('image/webp'), 'image/webp');
    const { updatePack } = await import('../generate');
    await updatePack(bid, PACK, x => ({ ...x, posts: { ...x.posts, linkedin: { ...x.posts.linkedin!, text: 'Fine text.', imageUrl: url, imageMeta: null } } }));
    const sl = packSid(PACK, 'linkedin');
    expect(await refusal(act('social.schedule', { sid: sl, ...tomorrow9() }))).toBe('Image 1 is a WEBP file, which LinkedIn doesn’t accept.');
    expect(await act('social.compress', { sid: sl })).toEqual({ compressed: 1 });
    const post = (await db.select().from(S.socialPacks).where(eq(S.socialPacks.id, PACK)))[0].data.posts.linkedin;
    expect(post).toMatchObject({ compressed: true, imageMeta: { type: 'image/jpeg' } });
    expect((await act('social.schedule', { sid: sl, ...tomorrow9() })).pub.status).toBe('scheduled');
    expect(await act('social.compress', { sid: sl })).toEqual({ compressed: 0 });
    await clearPubs();
  });

  it('time zone change keeps the wall-clock time and moves due_at', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Nine sharp.');
    const r = await act('social.schedule', { sid: sx, ...tomorrow9() });
    await act('blog.schedule', { tz: 'Europe/London' });
    const p2 = await pub(sx);
    expect([String(p2.date), p2.time]).toEqual([addDays(today, 1), '09:00']);
    expect(p2.dueAt.toISOString()).toBe(new Date(zonedTimeToUtc(addDays(today, 1), '09:00', 'Europe/London')).toISOString());
    expect(p2.dueAt.toISOString()).not.toBe(r.pub.dueAt);
    await act('blog.schedule', { tz: TZ });
    await clearPubs();
  });

  it('automatic generation: Schedule posts needs a live account on the server', async () => {
    const auto = { on: true, freq: 'daily', days: [], platforms: ['x', 'linkedin'], style: 'branded', time: '08:00', post: 'schedule' };
    expect((await act('social.auto', { auto })).post).toBe('schedule');
    const ids = (await accts()).map(a => a.id);
    await db.update(S.socialAccounts).set({ expired: true }).where(inArray(S.socialAccounts.id, ids));
    expect(await refusal(act('social.auto', { auto }))).toBe(COPY.noAccountForAuto);
    await db.update(S.socialAccounts).set({ expired: false }).where(inArray(S.socialAccounts.id, ids));
    const { autoSchedule } = await import('./schedule');
    expect(await autoSchedule(bid, PACK)).toBe(2);
    const rows = await db.select().from(P).where(eq(P.businessId, bid));
    expect(rows.map(r => [r.platform, String(r.date), r.time, r.auto]).sort()).toEqual([['linkedin', addDays(today, 1), '08:00', true], ['x', addDays(today, 1), '08:00', true]]);
    await clearPubs();
  });

  it('flag off: no projection, actions 404 not_enabled, nothing is sent, auto coerced to library', async () => {
    const sx = packSid(PACK, 'x'); await setText('x', 'Flag test.');
    await act('social.schedule', { sid: sx, ...tomorrow9() }); await makeDue(sx);
    process.env.RADAR_SOCIAL_PUBLISHING = '';
    const ws = await loadWorkspace(bid, owner.id, 'Owner');
    expect(ws.now).toBeUndefined();
    expect(ws.social).not.toHaveProperty('publishing'); expect(ws.social).not.toHaveProperty('accounts'); expect(ws.social).not.toHaveProperty('channels');
    expect(ws.social.auto).not.toHaveProperty('post');
    const post = ws.social.packs.find(p => p.id === PACK)!.posts.x!;
    expect(post).not.toHaveProperty('pub'); expect(post).not.toHaveProperty('imageMeta');
    for (const name of ['social.postNow', 'social.schedule', 'social.connect', 'social.disconnect', 'social.pages', 'social.move', 'social.unschedule', 'social.scheduleAll', 'social.compress', 'social.devSimulate']) {
      const e: any = await act(name, { sid: sx, date: today, time: '09:00', ch: 'x', oauthRef: 'x', acctId: '00000000-0000-0000-0000-000000000000', packId: PACK, rows: [{ platform: 'x', time: '09:00', acctId: '00000000-0000-0000-0000-000000000000' }], what: 'expire' }).catch(x => x);
      expect([e.status, e.code], name).toEqual([404, 'not_enabled']);
    }
    await publisherTick(new Date());
    expect(await jobDefs().get('social.send')!.run({ payload: { pubId: (await pub(sx)).id } } as any)).toEqual({ skipped: 'not_enabled' });
    expect((await pub(sx)).status).toBe('scheduled');
    expect(await refusal(setText('x', 'Edits are free while off.'))).toBe('no refusal'); // no lock checks
    const a = await act('social.auto', { auto: { on: false, freq: 'daily', days: [], platforms: ['x'], style: 'branded', time: '08:00', post: 'schedule' } });
    expect(a.post).toBe('library');
    process.env.RADAR_SOCIAL_PUBLISHING = 'all';
    await clearPubs();
  });

  it('opt-in group: business ids and owner emails, case-insensitive', async () => {
    const { socialOn } = await import('../../../flags');
    const b = await getBiz(bid);
    process.env.RADAR_SOCIAL_PUBLISHING = `someone@else.test, ${owner.email.toUpperCase()}`; expect(await socialOn(b)).toBe(true);
    process.env.RADAR_SOCIAL_PUBLISHING = bid; expect(await socialOn(b)).toBe(true);
    process.env.RADAR_SOCIAL_PUBLISHING = 'off'; expect(await socialOn(b)).toBe(false);
    process.env.RADAR_SOCIAL_PUBLISHING = '00000000-0000-0000-0000-000000000000'; expect(await socialOn(b)).toBe(false);
  });
});
