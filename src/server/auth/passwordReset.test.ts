import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt, sha256 } from '../crypto';
import { Fixtures, uniq } from '../testing/fixtures';
import { GUEST_COOKIE, SESSION_COOKIE, createSession, hashPassword, verifyPassword } from './session';
import { finishAuth } from './claim';
import { consumePasswordReset, requestPasswordReset } from './passwordReset';
import { POST as FORGOT } from '@/app/api/auth/forgot-password/route';
import { POST as RESET } from '@/app/api/auth/reset-password/route';
import { POST as SIGNIN } from '@/app/api/auth/signin/route';

const F = new Fixtures();
const prefix = `resetqa-${uniq()}`;
const request = (route: string, body: unknown, ip = prefix + '-' + uniq(), headers: Record<string, string> = {}) => new Request(`http://localhost:3000/api/auth/${route}`, { method: 'POST', headers: { 'x-real-ip': ip, ...headers }, body: JSON.stringify(body) });
const mails = (uid: string) => db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId, uid), eq(schema.lifecycleEmails.type, 'password_reset')));
const tokenOf = (row: typeof schema.lifecycleEmails.$inferSelect) => new URLSearchParams(new URL(decrypt<any>(row.payloadEnc).data.resetUrl).hash.slice(1)).get('token')!;
const emailKeys = new Set<string>();
const forgot = async (email: string, ip?: string) => { emailKeys.add(`auth:reset-request:email:${sha256(email.trim().toLowerCase())}@3600`); return FORGOT(request('forgot-password', { email }, ip)); };
afterEach(() => H.jar.clear());

describe.skipIf(!process.env.DATABASE_URL)('password recovery (database, no mail delivery)', () => {
  afterAll(async () => {
    await F.cleanup();
    await db.delete(schema.rateLimits).where(or(like(schema.rateLimits.key, `%${prefix}%`), inArray(schema.rateLimits.key, [...emailKeys])));
  });

  it('returns the same response for password, Google-only and unknown accounts, stores only hashed reset tokens and encrypted links', async () => {
    const user = await F.user({ password: await hashPassword('old-password') });
    const google = await F.user();
    await db.update(schema.users).set({ googleSub: 'resetqa-' + uniq() }).where(eq(schema.users.id, google.id));
    const replies = await Promise.all([forgot(user.email), forgot(google.email), forgot(`${prefix}-missing@test.local`)]);
    expect(replies.map(r => r.status)).toEqual([200, 200, 200]);
    const bodies = await Promise.all(replies.map(r => r.json()));
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
    expect(await mails(google.id)).toHaveLength(0);
    const rows = await mails(user.id); expect(rows).toHaveLength(1);
    const token = tokenOf(rows[0]); expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rows[0].payloadEnc).not.toContain(token);
    const [stored] = await db.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, user.id));
    expect(stored.tokenHash).toBe(sha256(token)); expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeGreaterThan(3590e3);
    expect(new URL(decrypt<any>(rows[0].payloadEnc).data.resetUrl).search).toBe('');
  });

  it('atomically replaces the password, invalidates every session and other reset link, and never signs in automatically', async () => {
    const user = await F.user({ password: await hashPassword('old-password') });
    await F.signIn(user, H.jar); await F.signIn(user, new Map());
    await requestPasswordReset(user.email); await requestPasswordReset(user.email);
    const rows = await mails(user.id); expect(rows).toHaveLength(2);
    const a = tokenOf(rows[0]), b = tokenOf(rows[1]);
    H.jar.clear();
    const r = await RESET(request('reset-password', { token: a, password: 'new-password' })); expect(r.status).toBe(200);
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id))).toHaveLength(0);
    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(await verifyPassword('new-password', updated.passwordHash!)).toBe(true);
    await expect(consumePasswordReset(a, 'another-password')).rejects.toMatchObject({ code: 'invalid_reset' });
    await expect(consumePasswordReset(b, 'another-password')).rejects.toMatchObject({ code: 'invalid_reset' });
    expect((await SIGNIN(request('signin', { email: user.email, password: 'old-password' }))).status).toBe(401);
    expect((await SIGNIN(request('signin', { email: user.email, password: 'new-password' }))).status).toBe(200);
  });

  it('lets only one of concurrent distinct valid reset links change the password', async () => {
    const user = await F.user({ password: await hashPassword('old-password') });
    await requestPasswordReset(user.email); await requestPasswordReset(user.email);
    const rows = await mails(user.id);
    const results = await Promise.allSettled(rows.map((r, i) => consumePasswordReset(tokenOf(r), `new-password-${i}`)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await db.select().from(schema.passwordResetTokens).where(and(eq(schema.passwordResetTokens.userId, user.id), isNull(schema.passwordResetTokens.usedAt)))).toHaveLength(0);
  });

  it('refuses a session for a password hash verified before a concurrent reset', async () => {
    const oldHash = await hashPassword('old-password');
    const user = await F.user({ password: oldHash });
    await requestPasswordReset(user.email);
    const token = tokenOf((await mails(user.id))[0]);
    await consumePasswordReset(token, 'new-password');
    await expect(createSession(user.id, oldHash)).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, user.id))).toHaveLength(0);
    // A fresh password sign-in remains valid; Google sessions use their independent Google credential, not this proof.
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    await createSession(user.id, u.passwordHash!);
    expect(H.jar.has(SESSION_COOKIE)).toBe(true);
  });

  it('rejects a stale password proof before claiming a guest or replacing either onboarding draft', async () => {
    const oldHash = await hashPassword('old-password');
    const user = await F.user({ password: oldHash });
    const own = await F.biz(user, { status: 'onboarding' });
    const guest = await F.user({ guest: true });
    const incoming = await F.biz(guest, { status: 'onboarding' });
    await F.signIn(guest, H.jar);
    const guestCookie = H.jar.get(GUEST_COOKIE);
    const beforeMembers = await db.select().from(schema.members).where(inArray(schema.members.businessId, [own.id, incoming.id])).orderBy(schema.members.id);
    await requestPasswordReset(user.email);
    await consumePasswordReset(tokenOf((await mails(user.id))[0]), 'new-password');

    await expect(finishAuth(user, undefined, oldHash)).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });

    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, own.id)))[0]).toEqual(own);
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, incoming.id)))[0]).toEqual(incoming);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, guest.id)))[0]).toMatchObject({ id: guest.id, guest: true });
    expect(await db.select().from(schema.members).where(inArray(schema.members.businessId, [own.id, incoming.id])).orderBy(schema.members.id)).toEqual(beforeMembers);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, guest.id))).toHaveLength(1);
    expect(H.jar.get(GUEST_COOKIE)).toBe(guestCookie);
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(schema.events).where(and(eq(schema.events.userId, user.id), inArray(schema.events.kind, ['onboarding.claimed', 'onboarding.draft_replaced'])))).toHaveLength(0);
  });

  it('rejects expired/malformed tokens and invalid passwords without consuming a valid link', async () => {
    const user = await F.user({ password: await hashPassword('old-password') });
    await requestPasswordReset(user.email); const token = tokenOf((await mails(user.id))[0]);
    await expect(consumePasswordReset(token, 'short')).rejects.toMatchObject({ code: 'invalid_password' });
    await expect(consumePasswordReset(token, '😀'.repeat(19))).rejects.toMatchObject({ code: 'invalid_password' });
    const [stillValid] = await db.select().from(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.tokenHash, sha256(token))); expect(stillValid.usedAt).toBeNull();
    await db.update(schema.passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(schema.passwordResetTokens.tokenHash, sha256(token)));
    await expect(consumePasswordReset(token, 'long-enough')).rejects.toMatchObject({ code: 'invalid_reset' });
    expect((await RESET(request('reset-password', { token: 'fake', password: 'long-enough' }))).status).toBe(400);
  });

  it('bounds reset requests by normalized email and source IP and rejects foreign origins/oversized bodies', async () => {
    const email = `${prefix}-rate@test.local`;
    for (let i = 0; i < 3; i++) expect((await forgot(email)).status).toBe(200);
    expect((await forgot(` ${email.toUpperCase()} `)).status).toBe(429);
    const ip = prefix + '-limit';
    for (let i = 0; i < 10; i++) expect((await forgot(`${prefix}-${i}@test.local`, ip)).status).toBe(200);
    expect((await forgot(`${prefix}-final@test.local`, ip)).status).toBe(429);
    expect((await FORGOT(request('forgot-password', { email }, undefined, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await RESET(request('reset-password', { token: 'fake', password: 'long-enough' }, undefined, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await FORGOT(new Request('http://localhost:3000/api/auth/forgot-password', { method: 'POST', body: 'x'.repeat(8193) }))).status).toBe(413);
    expect((await FORGOT(request('forgot-password', { email: 'invalid' }))).status).toBe(400);
  });
});
