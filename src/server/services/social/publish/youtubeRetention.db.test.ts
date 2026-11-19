import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; process.env.RADAR_SOCIAL_PUBLISHING = 'all'; process.env.RADAR_FAILURE_ALERTS = 'off'; });
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema as S } from '../../../db';
import { Fixtures, uniq } from '../../../testing/fixtures';
import { decrypt, encrypt } from '../../../crypto';
import { getBiz } from '../../../workspace';
import { summarize } from '../../../events';
import { deleteBusiness, restoreBusiness } from '../../../deletion';
import { YOUTUBE_CACHE_MS, YOUTUBE_LABEL, YOUTUBE_REVOKE_MS } from '@/lib/youtubeLifecycle';
import { youtubeAdapter, YouTubeTokenError } from './youtube';
import { acctPublic, ensureToken, savePendingSocial, setAdapterForTests, tokenFields, tokensOf } from './accounts';
import { cleanupYouTube, expireYouTubeCaches, REVOKE_JOB, revokeYouTubeJob, scrubYouTubeData, verifyYouTubeAccount, youtubeRetentionHooks } from './youtubeRetention';
import { EXPIRE_JOB, VERIFY_JOB, youtubeRetentionTick } from './youtubeRetentionJobs';
import { jobDefs, runJobNow } from '../../../jobs/queue';
import { claimManual, claimScheduled, recoverStuck, runSend } from './send';
import { P, loadTarget, pubOf, pubRow } from './pubs';
import { resolve, writeScheduled } from './schedule';
import { attachVideo } from './video';
import { runYouTubeDeletion, parseYouTubeDeletionArgs } from '../../../../../scripts/operations/youtube-data';
import type { Tokens } from './api';
const ON = !!process.env.DATABASE_URL;
const F = new Fixtures(); const hooks = { ...youtubeRetentionHooks }; let owner: any, biz: any, now: Date, pack: string;
const canary = 'API-CANARY-DO-NOT-RETAIN';
const freshTokens = (): Tokens => ({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_at: Date.now() + 3600e3, youtube: { profileFetchedAt: now.getTime(), authorizationCheckedAt: now.getTime() } });
const account = async (business = biz.id, values: Partial<typeof S.socialAccounts.$inferInsert> = {}) => (await db.insert(S.socialAccounts).values({ businessId: business, ch: 'youtube', remoteId: canary, name: canary, handle: '@' + canary, ...tokenFields(freshTokens()), ...values }).returning())[0];
const receipt = async (acctId: string | null, values: Partial<typeof P.$inferInsert> = {}) => (await db.insert(P).values({ businessId: biz.id, sid: `s:${pack}:youtube`, src: 'pack', ch: 'youtube', platform: 'youtube', acctId, acctLabel: canary, status: 'posted', date: now.toISOString().slice(0, 10), time: '12:00', dueAt: now, remoteId: canary, remoteUrl: 'https://youtube.com/watch?v=' + canary, postedAt: now, ...values }).returning())[0];
const rows = () => db.select().from(P).where(eq(P.businessId, biz.id));
const box = (type: string, data: Buffer) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); data.copy(b, 8); return b; };
function mp4() { const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(6000, 16); const hdlr = Buffer.alloc(12); hdlr.write('vide', 8); return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr)))])), box('mdat', Buffer.from([1]))]); }
const target = async () => { await attachVideo(await getBiz(biz.id), pack, 'youtube', mp4()); return (await loadTarget(biz.id, `s:${pack}:youtube`))!; };
function barrier() { let release!: () => void, entered!: () => void; const at = new Promise<void>(r => { entered = r; }), done = new Promise<void>(r => { release = r; }); return { at, release, wait: async () => { entered(); await done; } }; }
async function reconnect() { return account(); }

describe.skipIf(!ON)('YouTube scoped lifecycle database boundary', () => {
  beforeAll(async () => { owner = await F.user(); });
  beforeEach(async () => {
    now = new Date(); biz = await F.biz(owner); pack = `retention-${uniq()}`;
    await db.insert(S.socialPacks).values({ id: pack, businessId: biz.id, data: { id: pack, name: 'Owner draft', posts: { youtube: { text: 'Owner caption', style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0, publishOptions: { title: 'Owner video', privacy: 'private', madeForKids: false } } }, order: ['youtube'] } });
    youtubeRetentionHooks.refresh = vi.fn(async t => ({ ...t, access_token: 'renewed-token' }));
    youtubeRetentionHooks.profile = vi.fn(async () => ({ remoteId: canary, name: 'Fresh channel', handle: '@fresh' }));
    youtubeRetentionHooks.revoke = vi.fn(async () => {});
  });
  afterEach(async () => { setAdapterForTests('youtube', null); vi.restoreAllMocks(); Object.assign(youtubeRetentionHooks, hooks); await db.delete(S.jobs).where(inArray(S.jobs.kind, [REVOKE_JOB, EXPIRE_JOB, VERIFY_JOB])); await db.delete(S.cronMarks).where(sql`key LIKE 'youtube.%'`); });
  afterAll(async () => { await F.cleanup(); });
  it('disconnect removes API copies, pending grants and legacy projections while preserving owner content and other tenants/platforms', async () => {
    const a = await account(); const other = await F.biz(owner); const untouched = await account(other.id);
    const posted = await receipt(a.id); await receipt(a.id, { sid: 's:unsent:youtube', status: 'scheduled', remoteId: null, remoteUrl: null, postedAt: null });
    await db.insert(S.socialAccounts).values({ businessId: biz.id, ch: 'x', remoteId: 'x-provider', name: 'X untouched', tokensEnc: encrypt({ access_token: 'x' }) });
    await savePendingSocial(biz.id, owner.id, 'youtube', { tokens: freshTokens(), id: { remoteId: canary, name: canary } });
    await db.insert(S.events).values({ businessId: biz.id, kind: 'social.posted', ref: posted.sid, props: { ch: 'youtube', remoteId: canary, url: canary } });
    await db.execute(sql`UPDATE social_packs SET data = jsonb_set(data, '{posts,youtube,pub}', ${JSON.stringify({ acctLabel: canary, url: canary })}::jsonb) WHERE id = ${pack}`);
    const result = await cleanupYouTube({ bid: biz.id, acctId: a.id, reason: 'disconnect', now });
    expect(result).toEqual({ unscheduled: 1, scrubbedPubs: 2 });
    expect(youtubeRetentionHooks.revoke).toHaveBeenCalledOnce();
    expect((await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.businessId, biz.id))).map(x => x.ch)).toEqual(['x']);
    expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, untouched.id))).toHaveLength(1);
    const all = await rows(); expect(JSON.stringify(all)).not.toContain(canary);
    expect(all.find(r => r.id === posted.id)).toMatchObject({ status: 'posted', payload: { youtubeRetention: { noResend: true } } });
    expect(all.find(r => r.sid === 's:unsent:youtube')).toMatchObject({ status: 'failed', payload: { youtubeRetention: { noResend: false, needsApproval: true } } });
    const [draft] = await db.select().from(S.socialPacks).where(eq(S.socialPacks.id, pack)); expect(draft.data.posts.youtube.text).toBe('Owner caption'); expect(draft.data.posts.youtube.publishOptions.title).toBe('Owner video'); expect(draft.data.posts.youtube.pub).toBeUndefined();
    expect(await db.select().from(S.events).where(and(eq(S.events.businessId, biz.id), eq(S.events.kind, 'social.posted')))).toHaveLength(0);
    expect(await db.select().from(S.oauthStates).where(eq(S.oauthStates.businessId, biz.id))).toHaveLength(0);
  });
  it('permanently blocks a scrubbed uncertain upload through manual, schedule, worker claim and recovery after reconnect', async () => {
    const a = await account(); const t = await target();
    const p = await receipt(a.id, { status: 'sending', stage: 'create', remoteId: null, remoteUrl: null, payload: { providerRef: canary, processingStartedAt: now.getTime() } });
    await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); const b = await reconnect();
    expect(await claimManual({ bid: biz.id, t, acct: b, userId: owner.id, tz: 'UTC' })).toBeNull();
    const resolved = await resolve(biz.id, t.sid, b.id);
    expect(await writeScheduled(db, { biz: await getBiz(biz.id), r: resolved, date: now.toISOString().slice(0, 10), time: '12:00', userId: owner.id })).toBeNull();
    expect(await claimScheduled(p.id)).toBeNull(); expect(await recoverStuck(p.id)).toBeNull();
    expect((await rows())[0].payload?.youtubeRetention?.noResend).toBe(true);
  });
  it('requires explicit approval for an unsent draft; automatic scheduling cannot clear it', async () => {
    const a = await account(); const t = await target(); await receipt(a.id, { status: 'scheduled', remoteId: null, remoteUrl: null, postedAt: null });
    await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); const b = await reconnect(); const r = await resolve(biz.id, t.sid, b.id); const business = await getBiz(biz.id);
    expect(await writeScheduled(db, { biz: business, r, date: now.toISOString().slice(0, 10), time: '12:00', auto: true, userId: null })).toBeNull();
    const scheduled = await writeScheduled(db, { biz: business, r, date: now.toISOString().slice(0, 10), time: '12:00', userId: owner.id });
    expect(scheduled?.payload?.youtubeRetention?.needsApproval).toBe(false);
  });
  it('invalidates an upload response already in flight so it cannot restore removed references', async () => {
    const a = await account(); const t = await target(); const gate = barrier();
    setAdapterForTests('youtube', { ...youtubeAdapter, publish: async (ctx, p) => { await ctx.beforeCreate!(); await p.progress!(canary); await gate.wait(); return { remoteId: canary, url: canary }; } });
    const claim = (await claimManual({ bid: biz.id, t, acct: a, userId: owner.id, tz: 'UTC' }))!; const send = runSend(claim, { manual: true });
    await gate.at; await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); gate.release(); await send;
    const [p] = await rows(); expect(JSON.stringify(p)).not.toContain(canary); expect(p.payload?.youtubeRetention?.noResend).toBe(true); expect(p.status).toBe('failed');
  });
  it('invalidates an in-flight status read and does not restore a link or account after cleanup', async () => {
    const a = await account(); const gate = barrier();
    setAdapterForTests('youtube', { ...youtubeAdapter, resume: async () => { await gate.wait(); return { remoteId: canary, url: canary }; } });
    const p = await receipt(a.id, { status: 'sending', stage: 'create', remoteId: null, remoteUrl: null, claimedAt: new Date(now.getTime() - 181_000), attemptKey: crypto.randomUUID(), payload: { providerRef: canary, processingStartedAt: now.getTime() } });
    const pending = recoverStuck(p.id); await gate.at; await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); gate.release(); await pending;
    expect(JSON.stringify(await rows())).not.toContain(canary); expect((await rows())[0].payload?.youtubeRetention?.noResend).toBe(true);
  });
  it('compares token generation before saving a late profile response', async () => {
    const a = await account(); const gate = barrier(); youtubeRetentionHooks.profile = vi.fn(async () => { await gate.wait(); return { remoteId: canary, name: canary }; });
    const pending = verifyYouTubeAccount(a.id, now); await gate.at; await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); const replacement = await reconnect(); gate.release();
    expect(await pending).toBe('retry'); const [remaining] = await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, replacement.id)); expect(remaining.name).toBe(canary); expect(remaining.tokensEnc).toBe(replacement.tokensEnc);
  });
  it('keeps configuration failure as a persisted hold that blocks all sends and only a successful check releases', async () => {
    const a = await account(); const t = await target(); youtubeRetentionHooks.refresh = vi.fn(async () => { throw new YouTubeTokenError('configuration', 401); });
    expect(await verifyYouTubeAccount(a.id, now)).toBe('retry'); const [held] = await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id));
    expect(held.expired).toBe(true); expect(acctPublic(held).verificationHold).toBe(true); expect(tokensOf(held)?.youtube?.profileFetchedAt).toBe(now.getTime());
    expect(await claimManual({ bid: biz.id, t, acct: a, userId: owner.id, tz: 'UTC' })).toBeNull(); const r = await resolve(biz.id, t.sid, a.id);
    expect(await writeScheduled(db, { biz, r, date: now.toISOString().slice(0, 10), time: '12:00', userId: owner.id })).toBeNull();
    youtubeRetentionHooks.refresh = vi.fn(async t => t); expect(await verifyYouTubeAccount(a.id, now)).toBe('fresh');
    const [fresh] = await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id)); expect(fresh.expired).toBe(false); expect(acctPublic(fresh).verificationHold).toBeUndefined();
  });
  it('scrubs invalid_grant but preserves transient failures until the immutable hard expiry', async () => {
    const a = await account(); await receipt(a.id); youtubeRetentionHooks.refresh = vi.fn(async () => { throw new YouTubeTokenError('retry', 429); });
    expect(await verifyYouTubeAccount(a.id, now)).toBe('retry'); expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(1);
    youtubeRetentionHooks.refresh = vi.fn(async () => { throw new YouTubeTokenError('revoked', 400); });
    expect(await verifyYouTubeAccount(a.id, now)).toBe('revoked'); expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(0); expect(JSON.stringify(await rows())).not.toContain(canary);
  });
  it('scrubs a day28 receipt while retaining a freshly checked connected account', async () => {
    const a = await account(); const p = await receipt(a.id, { postedAt: new Date(now.getTime() - YOUTUBE_CACHE_MS), createdAt: new Date(now.getTime() - YOUTUBE_CACHE_MS) });
    expect(pubOf(p, [acctPublic(a)])).toMatchObject({ url: null, acctLabel: YOUTUBE_LABEL, historyExpired: true });
    const result = await expireYouTubeCaches(now); expect(result.receipts).toBe(1); expect(result.accounts).toBe(0);
    expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(1); expect(JSON.stringify(await rows())).not.toContain(canary);
  });
  it('expires a profile at day28 despite token updatedAt rotation; fresh unstamped legacy accounts survive', async () => {
    const a = await account(); const t = freshTokens(); t.youtube!.profileFetchedAt = now.getTime() - YOUTUBE_CACHE_MS; await db.update(S.socialAccounts).set({ ...tokenFields(t), updatedAt: now }).where(eq(S.socialAccounts.id, a.id));
    expect((await expireYouTubeCaches(now)).accounts).toBe(1);
    const fresh = await account(biz.id, { ...tokenFields({ access_token: 'a', refresh_token: 'r' }), createdAt: now });
    expect((await expireYouTubeCaches(now)).accounts).toBe(0); expect(await verifyYouTubeAccount(fresh.id, now)).toBe('fresh');
  });
  it('retains a revoke retry only encrypted and wipes it at expiry and terminal failure', async () => {
    const a = await account(); youtubeRetentionHooks.revoke = vi.fn(async () => { throw new YouTubeTokenError('retry', 503); });
    const out = await db.transaction(q => scrubYouTubeData(q, { bid: biz.id, reason: 'disconnect', now })); const id = out.revokeJobIds[0];
    expect(await revokeYouTubeJob(id, now)).toBe('retry'); let [j] = await db.select().from(S.jobs).where(eq(S.jobs.id, id)); expect(JSON.stringify(j.payload)).not.toContain('synthetic-refresh'); expect(decrypt<Tokens>(j.payload.tokenEnc)?.refresh_token).toBe('synthetic-refresh');
    await expireYouTubeCaches(new Date(now.getTime() + YOUTUBE_REVOKE_MS)); [j] = await db.select().from(S.jobs).where(eq(S.jobs.id, id)); expect(j.payload).toEqual({});
    await account(); const out2 = await db.transaction(q => scrubYouTubeData(q, { bid: biz.id, reason: 'disconnect', now })); expect(await revokeYouTubeJob(out2.revokeJobIds[0], now, true)).toBe('failed');
    const [terminal] = await db.select().from(S.jobs).where(eq(S.jobs.id, out2.revokeJobIds[0])); expect(terminal.payload).toEqual({});
  });
  it('business delete immediately scrubs YouTube, restore preserves drafts but requires reconnect', async () => {
    const a = await account(); await receipt(a.id); const result = await deleteBusiness(owner.id, biz.id, { domain: biz.domain }); expect(result.id).toBe(biz.id);
    expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(0); expect(JSON.stringify(await rows())).not.toContain(canary);
    await restoreBusiness(owner.id, biz.id); expect((await db.select().from(S.socialPacks).where(eq(S.socialPacks.id, pack)))[0].data.posts.youtube.text).toBe('Owner caption');
  });
  it('runs contact deletion through the same scoped helper with strict dry-run and tenant validation', async () => {
    const a = await account(); await receipt(a.id); const other = await F.biz(owner); const foreign = await account(other.id);
    expect(() => parseYouTubeDeletionArgs(['--business', biz.id, '--apply'])).toThrow();
    await expect(runYouTubeDeletion(['--business', biz.id, '--account', foreign.id, '--apply', '--confirm', biz.id], now)).rejects.toThrow('does not belong');
    expect(await runYouTubeDeletion(['--business', biz.id], now)).toMatchObject({ dryRun: true, localPublicationRows: 1 }); expect(await rows()).toHaveLength(1);
    expect(await runYouTubeDeletion(['--business', biz.id, '--apply', '--confirm', biz.id], now)).toMatchObject({ dryRun: false, scrubbedPubs: 1, remainingApiPublicationCopies: 0 }); expect(JSON.stringify(await rows())).not.toContain(canary);
  });
  it('does not reauthorize an OAuth attempt started before cleanup', async () => {
    await account(); const old = { tokens: freshTokens(), id: { remoteId: canary, name: canary }, authorizationStartedAt: now.getTime() - 1 };
    await cleanupYouTube({ bid: biz.id, reason: 'disconnect', now }); await expect(savePendingSocial(biz.id, owner.id, 'youtube', old)).rejects.toThrow('account expired');
    expect(await savePendingSocial(biz.id, owner.id, 'youtube', { ...old, authorizationStartedAt: now.getTime() + 1 })).toMatch(/^spend_/);
  });
  it('refreshes once more on an API401 before classifying the grant as revoked', async () => {
    const a = await account(); let reads = 0;
    youtubeRetentionHooks.profile = vi.fn(async () => { if (++reads === 1) throw new YouTubeTokenError('revoked', 401); return { remoteId: canary, name: 'Recovered channel' }; });
    expect(await verifyYouTubeAccount(a.id, now)).toBe('fresh'); expect(youtubeRetentionHooks.refresh).toHaveBeenCalledTimes(2); expect(reads).toBe(2);
  });
  it('cleans a definitive send-time token failure only after the refresh transaction commits', async () => {
    const a = await account(biz.id, { ...tokenFields({ ...freshTokens(), expires_at: 1 }) }); await receipt(a.id);
    setAdapterForTests('youtube', { ...youtubeAdapter, refresh: async () => { throw new YouTubeTokenError('revoked', 400); } });
    await expect(ensureToken(a.id, { force: true })).rejects.toThrow('account expired');
    expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(0); expect(JSON.stringify(await rows())).not.toContain(canary);
  });
  it('globally verifies expired accounts while publishing and billing are off, including durable >batch continuation', async () => {
    const originalFlag = process.env.RADAR_SOCIAL_PUBLISHING; const originalBilling = process.env.RADAR_BILLING;
    process.env.RADAR_SOCIAL_PUBLISHING = 'off'; process.env.RADAR_BILLING = 'on';
    try {
      const ids: string[] = [];
      for (let i = 0; i < 12; i++) { const b = await F.biz(owner); ids.push((await account(b.id, { expired: true })).id); }
      const deleted = await F.biz(owner, { status: 'deleted' }); const deletedAccount = await account(deleted.id);
      const upload = vi.fn(); setAdapterForTests('youtube', { ...youtubeAdapter, publish: upload });
      await youtubeRetentionTick(now);
      const [firstJob] = await db.select().from(S.jobs).where(eq(S.jobs.kind, VERIFY_JOB)).orderBy(S.jobs.createdAt);
      await runJobNow(firstJob.id);
      const [executed] = await db.select().from(S.jobs).where(eq(S.jobs.id, firstJob.id)); expect(executed.status).toBe('done'); expect(executed.result?.skipped).toBeUndefined();
      let cursor: string | undefined; const visited = new Set<string>();
      for (let n = 0; n < 30; n++) {
        const batch = await db.select({ id: S.socialAccounts.id }).from(S.socialAccounts).where(and(eq(S.socialAccounts.ch, 'youtube'), ...(cursor ? [sql`${S.socialAccounts.id} > ${cursor}`] : []))).orderBy(S.socialAccounts.id).limit(10);
        batch.forEach(row => visited.add(row.id));
        await jobDefs().get(VERIFY_JOB)!.run({ payload: { day: now.toISOString().slice(0, 10), cursor } } as any);
        if (batch.length < 10) break; cursor = batch[batch.length - 1].id;
      }
      ids.forEach(id => expect(visited.has(id)).toBe(true));
      const records = await db.select().from(S.socialAccounts).where(inArray(S.socialAccounts.id, ids)); expect(records).toHaveLength(12); expect(records.every(a => !a.expired)).toBe(true);
      expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, deletedAccount.id))).toHaveLength(0);
      const jobs = await db.select().from(S.jobs).where(eq(S.jobs.kind, VERIFY_JOB)); expect(jobs.length).toBeGreaterThan(1); expect(jobs.every(j => j.businessId === null)).toBe(true); expect(upload).not.toHaveBeenCalled();
    } finally { process.env.RADAR_SOCIAL_PUBLISHING = originalFlag; process.env.RADAR_BILLING = originalBilling; }
  });
  it('bounds expiry reads and follows keyset continuations past fresh rows without starving old receipts', async () => {
    const a = await account();
    await db.insert(P).values(Array.from({ length: 205 }, (_, n) => ({ businessId: biz.id, sid: `s:batch-${n}-${pack}:youtube`, src: 'pack' as const, ch: 'youtube' as const, platform: 'youtube' as const, acctId: a.id, acctLabel: canary, status: 'posted' as const, date: now.toISOString().slice(0, 10), time: '12:00', dueAt: now, postedAt: new Date(now.getTime() - YOUTUBE_CACHE_MS), remoteId: canary, remoteUrl: canary })));
    let current = await expireYouTubeCaches(now); let count = current.receipts; let passes = 1;
    while (current.next && passes++ < 10) { current = await expireYouTubeCaches(now, current.next); count += current.receipts; }
    expect(count).toBeGreaterThanOrEqual(205); expect(passes).toBeGreaterThan(2); expect(JSON.stringify(await rows())).not.toContain(canary);
    expect(await db.select().from(S.socialAccounts).where(eq(S.socialAccounts.id, a.id))).toHaveLength(1);
  });
  it('clears abandoned terminal revoke credentials before generic job retention and on maximum attempt', async () => {
    await account(); const out = await db.transaction(q => scrubYouTubeData(q, { bid: biz.id, reason: 'disconnect', now }));
    const id = out.revokeJobIds[0]; await db.update(S.jobs).set({ status: 'failed' }).where(eq(S.jobs.id, id));
    await expireYouTubeCaches(now); expect((await db.select().from(S.jobs).where(eq(S.jobs.id, id)))[0].payload).toEqual({});
    await account(); const again = await db.transaction(q => scrubYouTubeData(q, { bid: biz.id, reason: 'disconnect', now })); const [j] = await db.select().from(S.jobs).where(eq(S.jobs.id, again.revokeJobIds[0]));
    youtubeRetentionHooks.revoke = vi.fn(async () => { throw new YouTubeTokenError('retry', 503); });
    expect(await jobDefs().get(REVOKE_JOB)!.run({ job: j, attempt: j.maxAttempts } as any)).toEqual({ status: 'failed' });
    expect((await db.select().from(S.jobs).where(eq(S.jobs.id, j.id)))[0].payload).toEqual({});
  });
  it('clears the daily once mark when enqueue fails, allowing the next tick to recover', async () => {
    const insert = db.insert.bind(db);
    const spy = vi.spyOn(db, 'insert').mockImplementation(((table: any) => {
      if (table !== S.jobs) return insert(table);
      return { values: (values: any) => { if (values.kind === VERIFY_JOB) throw new Error('synthetic enqueue failure'); return insert(table).values(values); } };
    }) as any);
    await expect(youtubeRetentionTick(now)).rejects.toThrow('enqueue failed');
    expect(await db.select().from(S.cronMarks).where(eq(S.cronMarks.key, `youtube.daily:${now.toISOString().slice(0, 10)}`))).toHaveLength(0);
    spy.mockRestore(); await youtubeRetentionTick(now);
    expect(await db.select().from(S.jobs).where(eq(S.jobs.kind, VERIFY_JOB))).toHaveLength(1);
  });
  it('reports only aggregate rollout data, including fresh unstamped account initialization', async () => {
    await account(biz.id, { ...tokenFields({ access_token: canary, refresh_token: canary }), createdAt: now });
    const result = await runYouTubeDeletion(['--report'], now);
    expect(result).toMatchObject({ unstampedAccounts: 1 }); expect(JSON.stringify(result)).not.toContain(canary); expect(JSON.stringify(result)).not.toContain(biz.id);
  });
  it('does not copy channel or video data to action/job/notification snapshots on a successful send', async () => {
    const a = await account(); const t = await target(); setAdapterForTests('youtube', { ...youtubeAdapter, publish: async ctx => { await ctx.beforeCreate!(); return { remoteId: canary, url: 'https://youtube.com/watch?v=' + canary }; } });
    const claimed = (await claimManual({ bid: biz.id, t, acct: a, userId: owner.id, tz: 'UTC' }))!; expect((await runSend(claimed, { manual: true }))?.status).toBe('posted');
    const events = await db.select().from(S.events).where(eq(S.events.businessId, biz.id)); const notifications = await db.select().from(S.notifications).where(eq(S.notifications.businessId, biz.id));
    expect(JSON.stringify({ events, notifications, action: summarize({ input: { ch: 'youtube' }, result: { account: acctPublic(a) } }), job: summarize({ result: { status: 'posted' } }) })).not.toContain(canary);
  });
});
