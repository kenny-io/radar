import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { decrypt, randomToken, sha256 } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { queueLifecycle, type LifecyclePayload } from './queue';
import { dispatchLifecycleBatch as dispatchBatch, lifecycleEligible, type DispatchOptions } from './dispatch';
import { onboardingAllowed, preferenceToken, preferenceUser, stopOnboarding } from './preferences';
const ON = !!process.env.DATABASE_URL, F = new Fixtures();
const dispatchLifecycleBatch = (options: DispatchOptions = {}) => dispatchBatch({ ...options, userIds: F.users });
const prior = { key: env.resendKey, stub: env.devStubs };
const M = schema.lifecycleEmails;
const row = async (uid: string) => (await db.select().from(M).where(eq(M.userId, uid)))[0];
const payload = (r: typeof M.$inferSelect) => decrypt<LifecyclePayload>(r.payloadEnc)!;
const ack = () => vi.fn(async () => new Response(JSON.stringify({ id: 'provider-test-id' }), { status: 200 }));
const send = (fetcher: ReturnType<typeof ack>, now = new Date()) => dispatchLifecycleBatch({ now, fetch: fetcher as typeof fetch, sleep: async () => {}, limit: 50 });
async function welcome() { const u = await F.user(); await queueLifecycle(db, { type: 'welcome', userId: u.id, eventKey: `welcome:${u.id}`, data: {} }); return u; }

describe.skipIf(!ON)('durable lifecycle dispatch (database, fake provider only)', () => {
  beforeEach(() => { env.devStubs = false; env.resendKey = 'test-not-real'; });
  afterEach(async () => { env.devStubs = prior.stub; env.resendKey = prior.key; if (F.users.length) await db.delete(M).where(inArray(M.userId, F.users)); });
  afterAll(() => F.cleanup());
  it('dedupes concurrent event inserts and rolls back with the owning transaction', async () => {
    const u = await F.user(); const event = { type: 'welcome' as const, userId: u.id, eventKey: `welcome:${u.id}`, data: {} };
    await Promise.all([queueLifecycle(db, event), queueLifecycle(db, event)]);
    expect(await db.select().from(M).where(eq(M.userId, u.id))).toHaveLength(1);
    await expect(db.transaction(async tx => { await queueLifecycle(tx, { ...event, eventKey: `rollback:${u.id}` }); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect(await db.select().from(M).where(eq(M.userId, u.id))).toHaveLength(1);
  });
  it('does not queue guests and encrypts reset tokens/body rather than storing bearer links', async () => {
    const guest = await F.user({ guest: true }); await queueLifecycle(db, { type: 'welcome', userId: guest.id, eventKey: `guest:${guest.id}`, data: {} });
    expect(await row(guest.id)).toBeUndefined();
    const u = await F.user({ password: 'hash' }), token = randomToken();
    await db.insert(schema.passwordResetTokens).values({ tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + 3600e3) });
    await queueLifecycle(db, { type: 'password_reset', userId: u.id, eventKey: `reset:${u.id}`, data: { resetUrl: `${env.appUrl}/reset-password#token=${token}` } });
    const r = await row(u.id);
    expect(JSON.stringify(r)).not.toContain(token); expect(payload(r).data.resetUrl).toContain(token);
    expect(await lifecycleEligible(r, payload(r))).toBe(true);
    await db.update(schema.passwordResetTokens).set({ usedAt: new Date() }).where(eq(schema.passwordResetTokens.tokenHash, sha256(token)));
    const fetcher = ack(); await send(fetcher);
    expect(fetcher).not.toHaveBeenCalled(); expect(await row(u.id)).toMatchObject({ status: 'suppressed', payloadEnc: '' });
  });
  it('suppresses a previously queued workspace notice without contacting the provider', async () => {
    const u = await welcome(), fetcher = ack();
    await db.update(M).set({ type: 'workspace_ready' }).where(eq(M.userId, u.id));
    await send(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await row(u.id)).toMatchObject({ status: 'suppressed', attempts: 0, lastError: 'no_longer_applicable' });
  });
  it('stub mode never calls a provider even when a key exists; missing real credentials keep mail queued', async () => {
    const u = await welcome(), fetcher = ack(); env.resendKey = ''; await send(fetcher);
    expect(await row(u.id)).toMatchObject({ status: 'queued', attempts: 0 });
    env.resendKey = 'test-not-real'; env.devStubs = true; await send(fetcher);
    expect(await row(u.id)).toMatchObject({ status: 'logged', providerId: null, sentAt: null }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists a provider acknowledgment and does not send again on later runs', async () => {
    const u = await welcome(), fetcher = ack(); await send(fetcher); await send(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await row(u.id)).toMatchObject({ status: 'sent', providerId: 'provider-test-id', attempts: 1 });
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].signal).toBeInstanceOf(AbortSignal); expect(JSON.parse(init[1].body as string)).toMatchObject({ to: [u.email], reply_to: 'support@thally.io' });
  });
  it('retries transient errors with exactly the same key and body, respecting Retry-After', async () => {
    const u = await welcome(), now = new Date();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } })).mockResolvedValueOnce(new Response('{"id":"after-retry"}'));
    await dispatchLifecycleBatch({ now, fetch: fetcher, sleep: async () => {} });
    const first = await row(u.id); expect(first.status).toBe('queued'); expect(first.nextAttemptAt.getTime()).toBe(now.getTime() + 120000);
    await dispatchLifecycleBatch({ now: new Date(now.getTime() + 119999), fetch: fetcher, sleep: async () => {} }); expect(fetcher).toHaveBeenCalledTimes(1);
    await dispatchLifecycleBatch({ now: new Date(now.getTime() + 120001), fetch: fetcher, sleep: async () => {} });
    expect(await row(u.id)).toMatchObject({ status: 'sent', attempts: 2, providerId: 'after-retry' });
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('marks permanent provider errors terminal and never stores the provider error body', async () => {
    const u = await welcome(), fetcher = vi.fn(async () => new Response('secret provider error content', { status: 403 }));
    await dispatchLifecycleBatch({ fetch: fetcher, sleep: async () => {} });
    await dispatchLifecycleBatch({ fetch: fetcher, sleep: async () => {}, now: new Date(Date.now() + 60e3) });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await row(u.id)).toMatchObject({ status: 'failed', lastError: 'provider_http_403' });
    expect(JSON.stringify(await row(u.id))).not.toContain('secret provider');
  });
  it('recovers a crashed lease safely and refuses retries after the provider dedupe window', async () => {
    const u = await welcome(), now = new Date(), fetcher = ack();
    await db.update(M).set({ status: 'sending', firstAttemptAt: new Date(now.getTime() - 24 * 3600e3), claimedAt: new Date(now.getTime() - 5 * 60e3), claimToken: 'dead', attempts: 1 }).where(eq(M.userId, u.id));
    await send(fetcher, now); expect(fetcher).not.toHaveBeenCalled(); expect(await row(u.id)).toMatchObject({ status: 'failed', lastError: 'expired_delivery_window' });
    const v = await welcome(); await db.update(M).set({ status: 'sending', firstAttemptAt: new Date(now.getTime() - 60e3), claimedAt: new Date(now.getTime() - 5 * 60e3), claimToken: 'dead', attempts: 1 }).where(eq(M.userId, v.id));
    await send(fetcher, now); expect(fetcher).toHaveBeenCalledTimes(1); expect(await row(v.id)).toMatchObject({ status: 'sent', attempts: 2 });
  });
  it('does not acknowledge success without a provider ID and bounds network-error retries', async () => {
    const u = await welcome(), now = new Date(), fetcher = vi.fn(async () => new Response('{}'));
    await dispatchLifecycleBatch({ fetch: fetcher, now, sleep: async () => {} });
    expect(await row(u.id)).toMatchObject({ status: 'queued', lastError: 'provider_missing_acknowledgment', providerId: null });
    await db.update(M).set({ attempts: 7, nextAttemptAt: now }).where(eq(M.userId, u.id));
    const failing = vi.fn(async () => { throw new Error('a network message containing secrets'); });
    await dispatchLifecycleBatch({ fetch: failing, now, sleep: async () => {} });
    expect(await row(u.id)).toMatchObject({ status: 'failed', attempts: 8, lastError: 'provider_network_or_timeout' });
  });
  it('suppresses changed recipients and optional onboarding after a signed, explicit opt-out', async () => {
    const u = await welcome(), fetcher = ack();
    await db.update(schema.users).set({ email: `changed-${u.email}` }).where(eq(schema.users.id, u.id));
    await send(fetcher); expect(await row(u.id)).toMatchObject({ status: 'suppressed' }); expect(fetcher).not.toHaveBeenCalled();
    const v = await F.user(); const t = preferenceToken(v.id); expect(preferenceUser(t)).toBe(v.id); expect(preferenceUser(t + 'bad')).toBeNull();
    expect(await onboardingAllowed(v.id)).toBe(true); await stopOnboarding(v.id); expect(await onboardingAllowed(v.id)).toBe(false);
    await queueLifecycle(db, { type: 'founder_note', userId: v.id, eventKey: `founder:${v.id}`, data: {} });
    await send(fetcher); expect(await row(v.id)).toMatchObject({ status: 'suppressed' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('suppresses stale trial/cancel notices after account state changes', async () => {
    const u = await F.user(), end = new Date(Date.now() + 864e5), sub = 'sub-test';
    await F.account(u.id, { stripeSubscriptionId: sub, status: 'trialing', trialEnd: end });
    await queueLifecycle(db, { type: 'trial_ending', userId: u.id, eventKey: `ending:${u.id}`, data: { trialEnd: end.toISOString(), subscriptionId: sub } });
    const r = await row(u.id); expect(await lifecycleEligible(r, payload(r))).toBe(true);
    await F.account(u.id, { status: 'active' }); expect(await lifecycleEligible(r, payload(r))).toBe(false);
    await db.delete(M).where(eq(M.userId, u.id));
    await F.account(u.id, { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: end });
    await queueLifecycle(db, { type: 'cancellation_scheduled', userId: u.id, eventKey: `cancel:${u.id}`, data: { periodEnd: end.toISOString(), subscriptionId: sub } });
    const cancel = await row(u.id); expect(await lifecycleEligible(cancel, payload(cancel))).toBe(true);
    await F.account(u.id, { cancelAtPeriodEnd: false }); expect(await lifecycleEligible(cancel, payload(cancel))).toBe(false);
  });
  it('prioritizes account recovery and clears its bearer payload after acknowledgment', async () => {
    await welcome();
    const u = await F.user({ password: 'hash' }), token = randomToken();
    await db.insert(schema.passwordResetTokens).values({ tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + 3600e3) });
    await queueLifecycle(db, { type: 'password_reset', userId: u.id, eventKey: `priority-reset:${u.id}`, data: { resetUrl: `${env.appUrl}/reset-password#token=${token}` } });
    const fetcher = ack();
    await dispatchLifecycleBatch({ limit: 1, fetch: fetcher as typeof fetch, sleep: async () => {} });
    expect(await row(u.id)).toMatchObject({ status: 'sent', payloadEnc: '', providerId: 'provider-test-id' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not double-send when two dispatchers compete for a batch', async () => {
    const u = await welcome(), fetcher = ack();
    await Promise.all([send(fetcher), send(fetcher)]);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await row(u.id)).toMatchObject({ status: 'sent' });
  });

  it('stops after the current request without claiming any further row', async () => {
    const u = await welcome(), v = await welcome(); let stopping = false;
    const fetcher = vi.fn(async () => { stopping = true; return new Response('{"id":"one-before-stop"}'); });
    await dispatchLifecycleBatch({ limit: 10, fetch: fetcher, shouldStop: () => stopping, sleep: async () => {} });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const states = [(await row(u.id)).status, (await row(v.id)).status];
    expect(states.sort()).toEqual(['queued', 'sent']);
  });

});
