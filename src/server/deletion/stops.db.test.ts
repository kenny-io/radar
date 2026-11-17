// What stops when a business is deleted (DEL-4..8): the job queue, model calls, publishing, partner mail, invites,
// the event stream, and the one email that is sent (the cron hooks are in crons.db.test.ts). Real database, real route handlers and job queue; the blog
// connector is a counting fake. Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; return { jar: new Map<string, string>(), drafts: 0, publishes: 0 }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
vi.mock('../services/publishing/connectors', () => ({ connectorFor: () => ({ createDraft: async () => { H.drafts++; return { id: 'remote-1' }; }, publish: async () => { H.publishes++; return { url: 'https://site.test/post' }; } }) }));

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { decrypt } from '../crypto';
import { Fixtures, uniq, type TUser } from '../testing/fixtures';
import { defineJob, enqueue, getJob, jobDefs, runJobNow, DELETED_RECHECK_MS } from '../jobs/queue';
import '../jobs/all';
import * as failures from '../observability/failures';
import * as state from './state';
import * as lifecycleQueue from '../services/lifecycle/queue';
import { lifecycleEligible } from '../services/lifecycle/dispatch';
import { ai } from '../ai';
import { registerStub } from '../ai/adapters/stub';
import { loadWorkspace } from '../workspace';
import { publishEntry } from '../services/publishing/publisher';
import { hostBusiness, runDecisionNotice } from '../services/backlinks/decisions';
import { networkBusinesses } from '../services/backlinks/network';
import { acceptInvite, newInviteToken } from '../services/team/invites';
import { digestPreferencesToken, disableDigestEmail, managedDigestPreferences, updateDigestPreference } from '../services/visibility/digestPreferences';
import { deleteBusiness, restoreBusiness } from './index';
import { GET as EVENTS } from '@/app/api/b/[bid]/events/route';
import { GET as CURRENT } from '@/app/api/b/current/route';
import { addDays, todayIn } from '@/lib/format';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const B = schema.businesses; const J = schema.jobs; const E = schema.calendarEntries; const M = schema.lifecycleEmails;
const prior = { key: env.resendKey, stub: env.devStubs };
const as = async (u: TUser) => { H.jar.clear(); await F.signIn(u, H.jar); };
const row = async (bid: string) => (await db.select().from(B).where(eq(B.id, bid)))[0];
const gone = (bid: string) => db.execute(sql`UPDATE businesses SET status = 'deleted', deleted_at = now(), purge_at = now() + interval '168 hours', rev = rev + 1 WHERE id = ${bid}`);
const back = (bid: string) => db.execute(sql`UPDATE businesses SET status = 'active', deleted_at = NULL, purge_at = NULL WHERE id = ${bid}`);
afterEach(() => { vi.restoreAllMocks(); delete process.env.RADAR_BILLING; H.jar.clear(); env.devStubs = prior.stub; env.resendKey = prior.key; });

describe.skipIf(!ON)('a deleted business does nothing (database)', () => {
  afterAll(async () => { if (F.users.length) await db.delete(M).where(inArray(M.userId, F.users)); await F.cleanup(); });

  it('an open event stream ends after a delete (DEL-4)', async () => {
    const owner = await F.user(); const member = await F.user(); const biz = await F.biz(owner); await F.member(biz.id, member, 'Viewer');
    await as(member);
    const ac = new AbortController();
    const res = await EVENTS(new Request('http://t/e', { signal: ac.signal }), { params: Promise.resolve({ bid: biz.id }) });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let seen = '';
    await new Promise(r => setTimeout(r, 300));               // the first poll has read the active business
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });
    const started = Date.now();
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; seen += dec.decode(value); if (Date.now() - started > 12_000) throw new Error('the stream is still open'); }
    } finally { ac.abort(); }
    expect(Date.now() - started).toBeLessThan(8000);          // its next 5 s poll, not the 60 s recheck
    expect(seen).toContain(`event: rev\ndata: {"rev":${biz.rev + 1}}`);   // the tab is told to refresh, then nothing more
  }, 20_000);

  it('delete cancels queued jobs, and a job enqueued afterwards is recorded as skipped without running, social.send included, with billing off (DEL-5)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner); const other = await F.biz(owner);
    const kind = `test.deleted.${uniq()}`; const ran: string[] = [];
    defineJob({ kind, run: async ctx => { ran.push(ctx.businessId!); return { ran: true }; } });
    const send = vi.spyOn(jobDefs().get('social.send')!, 'run');
    const before = await enqueue(kind, {}, { businessId: biz.id });
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });
    expect(await getJob(before)).toMatchObject({ status: 'done', result: { skipped: 'deleted' } });
    await runJobNow(before);                                   // a worker that had already read it: nothing happens twice
    const after = await enqueue(kind, {}, { businessId: biz.id });
    const post = await enqueue('social.send', { pubId: '00000000-0000-4000-8000-000000000000' }, { businessId: biz.id });
    const control = await enqueue(kind, {}, { businessId: other.id });
    const rev = (await row(biz.id)).rev;
    for (const id of [after, post, control]) await runJobNow(id);
    for (const id of [after, post]) expect(await getJob(id)).toMatchObject({ status: 'done', result: { skipped: 'deleted' }, error: null });
    expect(await getJob(control)).toMatchObject({ status: 'done', result: { ran: true } });
    expect(ran).toEqual([other.id]);
    expect(send).not.toHaveBeenCalled();
    expect((await row(biz.id)).rev).toBe(rev);                 // a skipped job does not touch the deleted row
  });

  it('a job whose deleted check cannot be made fails the attempt and is retried; it never runs unchecked (DEL-5)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const kind = `test.unchecked.${uniq()}`; let ran = 0;
    defineJob({ kind, maxAttempts: 2, run: async () => { ran++; } });
    const id = await enqueue(kind, {}, { businessId: biz.id });
    const check = vi.spyOn(state, 'isBusinessDeleted').mockRejectedValue(new Error('database is away'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.update(J).set({ attempts: 1 }).where(eq(J.id, id));
    await runJobNow(id);
    expect(ran).toBe(0);
    expect(await getJob(id)).toMatchObject({ status: 'queued', error: 'Radar couldn’t finish this. Try again.' });
    await db.update(J).set({ attempts: 2 }).where(eq(J.id, id));
    await runJobNow(id);
    expect(ran).toBe(0);
    expect(await getJob(id)).toMatchObject({ status: 'failed' });
    check.mockRestore();
  });

  it('a running job that reports progress after the delete stops and is recorded as skipped, with no failure alert (DEL-5)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const kind = `test.running.${uniq()}`; const steps: string[] = [];
    defineJob({ kind, maxAttempts: 1, run: async ctx => {
      await ctx.progress({ step: 1 }); steps.push('one');
      await gone(biz.id);
      await ctx.progress({ step: 2 }); steps.push('two');      // inside the 5 s since the last check: not re-read yet
      const real = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => real + DELETED_RECHECK_MS + 1);
      await ctx.progress({ step: 3 }); steps.push('three');
    } });
    const report = vi.spyOn(failures, 'reportFailure');
    const id = await enqueue(kind, {}, { businessId: biz.id });
    const rev = (await row(biz.id)).rev;
    await db.update(J).set({ attempts: 1 }).where(eq(J.id, id));
    await runJobNow(id);
    expect(steps).toEqual(['one', 'two']);
    expect(await getJob(id)).toMatchObject({ status: 'done', result: { skipped: 'deleted' }, error: null });
    expect(report).not.toHaveBeenCalled();
    expect((await row(biz.id)).rev).toBe(rev + 1);            // only the delete's own bump
    // A job that fails for its own reasons after the delete is not an incident either.
    const kind2 = `test.throws.${uniq()}`;
    defineJob({ kind: kind2, maxAttempts: 1, run: async () => { await gone(biz.id); throw new Error('the provider went away'); } });
    await back(biz.id);
    const id2 = await enqueue(kind2, {}, { businessId: biz.id }); await db.update(J).set({ attempts: 1 }).where(eq(J.id, id2));
    await runJobNow(id2);
    expect(await getJob(id2)).toMatchObject({ status: 'done', result: { skipped: 'deleted' } });
    expect(report).not.toHaveBeenCalled();
  });

  it('ai.run refuses a deleted business before any provider call (DEL-5)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const purpose = `test.deleted.${uniq()}`; let reached = 0;
    registerStub(purpose, () => { reached++; return 'ok'; });   // the provider, with dev stubs on
    const ask = () => ai.run('writing', { purpose, system: 's', prompt: 'p' }, { businessId: biz.id });
    await ask();
    expect(reached).toBe(1);
    await gone(biz.id);
    await expect(ask()).rejects.toMatchObject({ status: 404, code: 'business_deleted' });
    expect(reached).toBe(1);
    await back(biz.id);
    await ask();
    expect(reached).toBe(2);
  });

  it('a publish already admitted creates no draft and publishes nothing once the business is deleted, and the entry is `scheduled` again (DEL-5)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const [conn] = await db.insert(schema.connections).values({ businessId: biz.id, type: 'wordpress', url: 'https://site.test', fields: {} }).returning();
    const date = addDays(todayIn(biz.timezone), -1);
    const mk = async (o: Partial<typeof E.$inferInsert> = {}) => {
      const id = `e-${uniq()}`;
      await db.insert(E).values({ id, businessId: biz.id, title: 'T', kw: 'kw', type: 'Guide', date, status: 'scheduled', ...o });
      await db.insert(schema.articles).values({ entryId: id, businessId: biz.id, data: { entryId: id, generated: true, body: [{ t: 'p', text: 'Hello.' }], seo: { title: 'T', meta: '', slug: 't' } } });
      return id;
    };
    const fresh = await mk(); const drafted = await mk({ publishRemote: { connId: conn.id, id: 'remote-0' } }); const control = await mk();
    H.drafts = 0; H.publishes = 0;
    await gone(biz.id);
    // Before the draft is created, and (with a draft already on the site) before it is published.
    for (const id of [fresh, drafted]) {
      expect(await publishEntry(id, { attempt: 1, maxAttempts: 1, manual: true })).toEqual({ status: 'skipped', reason: 'deleted' });
      expect((await db.select().from(E).where(eq(E.id, id)))[0]).toMatchObject({ status: 'scheduled', publishedUrl: null, publishError: null });
    }
    expect([H.drafts, H.publishes]).toEqual([0, 0]);
    expect((await db.select().from(E).where(eq(E.id, fresh)))[0].publishRemote).toBeNull();
    await back(biz.id);
    expect(await publishEntry(control, { attempt: 1, maxAttempts: 1, manual: true })).toMatchObject({ status: 'published' });
    expect([H.drafts, H.publishes]).toEqual([1, 1]);
  });

  it('a deleted business is not matched, its undecided proposals are hidden from the partner, and no partner mail goes to its owner (DEL-6)', async () => {
    const owner = await F.user(); const partnerOwner = await F.user();
    const domain = `gone-${uniq()}.test`;
    const dead = await F.biz(owner, { domain }); const partner = await F.biz(partnerOwner);
    for (const b of [dead, partner]) await db.update(B).set({ backlinks: { joined: true } }).where(eq(B.id, b.id));
    const key = new Date().toISOString();
    const data = { page: `https://${domain}/guide`, target: `https://${partner.domain}/pricing`, anchor: 'pricing', before: 'See ', after: '.', rel: 'follow', noticeKey: key };
    const [undecided, approved] = await db.insert(schema.proposals).values([
      { businessId: partner.id, direction: 'in', partnerBusinessId: dead.id, data },
      { businessId: partner.id, direction: 'in', partnerBusinessId: dead.id, data, decision: 'approved', decidedAt: new Date() },
    ]).returning();
    const ids = async () => { const w = await loadWorkspace(partner.id, partnerOwner.id, 'Owner'); return [...w.backlinks.inbound, ...w.backlinks.outbound].map(p => p.id).sort(); };
    expect(await ids()).toEqual([undecided.id, approved.id].sort());
    expect((await networkBusinesses(false)).map(b => b.id)).toContain(dead.id);
    expect((await hostBusiness(`https://${domain}/guide`))?.id).toBe(dead.id);

    await deleteBusiness(owner.id, dead.id, { domain });
    expect(await ids()).toEqual([approved.id]);               // the decided one is the partner's own record
    expect((await networkBusinesses(false)).map(b => b.id)).not.toContain(dead.id);
    expect(await hostBusiness(`https://${domain}/guide`)).toBeNull();
    const outbox = async () => (await db.select({ id: schema.outboxEmails.id }).from(schema.outboxEmails).where(eq(schema.outboxEmails.to, owner.email))).length;
    const mails = await outbox();
    expect(await runDecisionNotice({ proposalId: approved.id, decision: 'approved', key })).toEqual({ skipped: true });
    expect(await outbox()).toBe(mails);
    // The same domain added again is the one a page on it belongs to; restored, the first one hears from partners again.
    const again = await F.biz(owner, { domain });
    expect((await hostBusiness(`https://${domain}/guide`))?.id).toBe(again.id);
    await restoreBusiness(owner.id, dead.id);
    expect(await ids()).toEqual([undecided.id, approved.id].sort());
    expect(await runDecisionNotice({ proposalId: approved.id, decision: 'approved', key })).toEqual({ sent: 'approved' });
    expect(await outbox()).toBe(mails + 1);
  });

  it('delete queues exactly one `business_deleted` mail with the wipe date and `/restore`, and succeeds when queueing throws (DEL-7)', async () => {
    const owner = await F.user({ name: 'Ada' }); const biz = await F.biz(owner); const unlucky = await F.biz(owner);
    const mails = () => db.select().from(M).where(and(eq(M.userId, owner.id), eq(M.type, 'business_deleted')));
    const d = await deleteBusiness(owner.id, biz.id, { domain: biz.domain });
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });          // a second click queues nothing more
    const [mail, ...rest] = await mails();
    expect(rest).toEqual([]);
    expect(mail).toMatchObject({ businessId: biz.id, status: 'queued', eventKey: `business-deleted:${biz.id}:${d.deletedAt}` });
    expect(mail.expiresAt.getTime()).toBeLessThanOrEqual(new Date(d.purgeAt).getTime());
    expect(mail.expiresAt.getTime() - Date.now()).toBeGreaterThan(2.9 * 864e5);
    const p = decrypt<lifecycleQueue.LifecyclePayload>(mail.payloadEnc)!;
    expect(p.envelope).toMatchObject({ to: [owner.email], subject: 'Fieldnote was deleted from Radar' });
    const until = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(d.purgeAt)) + ' UTC';
    expect(p.envelope.text).toContain(`Radar keeps it until ${until}, then wipes it for good.`);
    expect(p.envelope.text).toContain(`Restore Fieldnote: ${env.appUrl}/restore\n`);
    expect(p.envelope.text).toContain(`(${biz.domain})`);
    expect(p.envelope.text).not.toContain(biz.id);
    expect(p.envelope.headers).toBeUndefined();                // transactional: no unsubscribe header
    // The dispatcher's send-time check lets it go while the delete stands. (Called directly: the batch dispatcher takes
    // one database-wide lock, which other test files on a shared database are waiting for.)
    expect(await lifecycleEligible(mail, p)).toBe(true);
    expect(await lifecycleEligible(mail, p, new Date(new Date(d.purgeAt).getTime() + 1))).toBe(false);   // never after the wipe time

    const report = vi.spyOn(failures, 'reportFailure').mockResolvedValue();
    vi.spyOn(lifecycleQueue, 'queueLifecycle').mockRejectedValue(new Error('mail queue is away'));
    const ok = await deleteBusiness(owner.id, unlucky.id, { domain: unlucky.domain });
    expect(ok).toMatchObject({ id: unlucky.id, nextId: null });
    expect((await row(unlucky.id)).status).toBe('deleted');
    expect(await mails()).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'business.delete.email', businessId: unlucky.id }));
  });

  it('the queued mail is suppressed when the business was restored before it was sent, or belongs to an earlier delete (DEL-7)', async () => {
    const owner = await F.user(); const biz = await F.biz(owner);
    const mails = () => db.select().from(M).where(and(eq(M.userId, owner.id), eq(M.type, 'business_deleted'))).orderBy(M.createdAt);
    const goes = async (m: typeof M.$inferSelect) => lifecycleEligible(m, decrypt<lifecycleQueue.LifecyclePayload>(m.payloadEnc)!);
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });
    const [first] = await mails();
    expect(await goes(first)).toBe(true);
    await restoreBusiness(owner.id, biz.id);
    expect(await goes(first)).toBe(false);                     // the dispatcher marks it suppressed, `no_longer_applicable`
    // Deleted again: the second delete has its own mail, and only that one goes out.
    await new Promise(r => setTimeout(r, 5));
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });
    const [, second] = await mails();
    expect(second.eventKey).not.toBe(first.eventKey);
    expect([await goes(first), await goes(second)]).toEqual([false, true]);
    // Not to anyone but the business's owner, and not for a business that is no longer there.
    const other = await F.user();
    await db.update(B).set({ ownerId: other.id }).where(eq(B.id, biz.id));
    expect(await goes(second)).toBe(false);
    await db.update(B).set({ ownerId: owner.id }).where(eq(B.id, biz.id));
    expect(await goes(second)).toBe(true);
    await db.delete(B).where(eq(B.id, biz.id));
    expect(await goes({ ...second, businessId: biz.id })).toBe(false);
  });

  it('an invite link to a deleted business is invalid; a link in old mail opens the dashboard; its email settings are not listed (DEL-8, DEL-4)', async () => {
    const owner = await F.user(); const invitee = await F.user(); const biz = await F.biz(owner);
    const { token, hash } = newInviteToken();
    await db.insert(schema.members).values({ businessId: biz.id, email: 'new@test.local', role: 'Editor', status: 'invited', tokenHash: hash, invitedAt: new Date() });
    expect((await managedDigestPreferences(owner.id)).map(r => r.id)).toEqual([biz.id]);
    await deleteBusiness(owner.id, biz.id, { domain: biz.domain });

    expect(await acceptInvite(token, invitee)).toEqual({ ok: false, reason: 'invalid' });
    expect(await managedDigestPreferences(owner.id)).toEqual([]);
    expect(await updateDigestPreference(owner.id, biz.id, false)).toBe(false);
    expect(await disableDigestEmail(digestPreferencesToken(biz.id, owner.id))).toBe(true);   // one-click unsubscribe never fails
    await as(owner);
    const hop = await CURRENT(new Request(`http://t/api/b/current?id=${biz.id}&next=%2Fcalendar`));
    expect([hop.status, hop.headers.get('location')]).toEqual([303, `${env.appUrl}/dashboard`]);
    const stranger = await F.user(); await as(stranger);
    expect((await CURRENT(new Request(`http://t/api/b/current?id=${biz.id}&next=%2Fcalendar`))).status).toBe(404);

    await restoreBusiness(owner.id, biz.id);
    expect(await acceptInvite(token, invitee)).toEqual({ ok: true, businessId: biz.id });
  });
});
