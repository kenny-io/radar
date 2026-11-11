import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { db, schema } from '../db';
import { env } from '../env';
import * as rateLimits from '../abuse/rateLimit';
import { decrypt, randomToken, sha256 } from '../crypto';
import { Fixtures, uniq } from '../testing/fixtures';
import { currentUser, createSession, hashPassword, SESSION_COOKIE, verifyPassword } from './session';
import { createGoogleState } from './googleState';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as resend } from '@/app/api/auth/verification/resend/route';
import { POST as verify } from '@/app/api/auth/verify-email/route';
import { POST as signin } from '@/app/api/auth/signin/route';
import { GET as google } from '@/app/api/auth/google/callback/route';
import { GET as metrics } from '@/app/api/admin/metrics/route';
import { confirmEmail, sendVerification } from './verification';
const F = new Fixtures(); const prefix = `verify-${uniq()}`; const address = () => `${prefix}-${uniq()}@test.local`;
const saved = { signupTurnstileRequired: env.signupTurnstileRequired, devStubs: env.devStubs, isProd: env.isProd, turnstileSiteKey: env.turnstileSiteKey, turnstileSecretKey: env.turnstileSecretKey, resendKey: env.resendKey, adminEmails: env.adminEmails };
const request = (body: unknown, ip = `${prefix}-${uniq()}`, origin?: string) => new Request('http://localhost:3000/api/auth', { method: 'POST', headers: { 'x-real-ip': ip, ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const user = async (email: string) => (await db.select().from(schema.users).where(eq(schema.users.email, email)))[0];
async function tokenFor(email: string) {
  const [mail] = await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email)).orderBy(desc(schema.outboxEmails.createdAt)).limit(1);
  expect(mail.text.startsWith('encrypted-auth:')).toBe(true);
  const text = decrypt<{ text: string }>(mail.text.slice('encrypted-auth:'.length))!.text;
  return text.match(/#token=([A-Za-z0-9_-]{43})/)![1];
}
afterEach(() => { H.jar.clear(); Object.assign(env, saved); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe.skipIf(!process.env.DATABASE_URL)('mailbox confirmation security (database)', () => {
  afterAll(async () => {
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`)); users.forEach(u => F.track(u.id));
    await F.cleanup();
    await db.delete(schema.outboxEmails).where(like(schema.outboxEmails.to, `${prefix}%`));
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, `%${prefix}%`));
  });
  it('does not accept a registrant password or grant a session/admin capability before inbox confirmation', async () => {
    const email = address(); env.adminEmails = [email];
    const r = await signup(request({ name: 'Claimed name', email, password: 'AttackerChosen123!' }));
    expect(await r.json()).toEqual({ ok: true, verificationRequired: true });
    const u = await user(email);
    expect(u.passwordHash).toBeNull(); expect(u.emailVerifiedAt).toBeNull();
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    await expect(createSession(u.id)).rejects.toMatchObject({ status: 401 });
    await F.signIn(u, H.jar); // even a legacy/forged fixture session is denied by the principal gate
    expect(await currentUser()).toBeNull();
    expect((await metrics(new Request('http://localhost/api/admin/metrics'))).status).toBe(401);
    const token = await tokenFor(email);
    const [stored] = await db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, u.id));
    expect(stored.tokenHash).toBe(sha256(token)); expect(JSON.stringify(stored)).not.toContain(token);
    const verified = await verify(request({ token, password: 'InboxChosen456!' }));
    expect(verified.status).toBe(200); expect((await currentUser())!.id).toBe(u.id);
    expect(await verifyPassword('InboxChosen456!', (await user(email)).passwordHash!)).toBe(true);
    expect((await signin(request({ email, password: 'AttackerChosen123!' }))).status).toBe(401);
    expect((await verify(request({ token, password: 'OtherChosen789!' }))).status).toBe(400);
  });
  it('recovers legacy account in place, preserves paid/business records and invalidates old sessions and all other links', async () => {
    const u = await F.user({ email: address(), verified: false, password: await hashPassword('LegacyChosen123!') });
    const business = await F.biz(u); await F.account(u.id, { status: 'active', comp: true });
    await F.signIn(u, H.jar); const old = H.jar.get(SESSION_COOKIE)!; H.jar.clear();
    const blocked = await signin(request({ email: u.email, password: 'LegacyChosen123!' }));
    expect(blocked.status).toBe(403); expect((await blocked.json()).code).toBe('verification_required');
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect((await resend(request({ email: u.email }))).status).toBe(200); const first = await tokenFor(u.email);
    expect((await resend(request({ email: u.email }))).status).toBe(200); const second = await tokenFor(u.email);
    expect((await verify(request({ token: second, password: 'RecoveredChosen456!' }))).status).toBe(200);
    const recovered = await currentUser(); expect(recovered!.id).toBe(u.id);
    H.jar.set(SESSION_COOKIE, old); expect(await currentUser()).toBeNull();
    expect(await db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, u.id))).toHaveLength(0);
    await expect(confirmEmail(first, 'AnotherChosen789!')).rejects.toMatchObject({ code: 'verification_invalid' });
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, business.id)))[0].ownerId).toBe(u.id);
    expect((await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, u.id)))[0]).toMatchObject({ status: 'active', comp: true });
  });
  it('expires tokens, binds their email, validates password bytes and permits exactly one concurrent consume', async () => {
    const u = await F.user({ email: address(), verified: false });
    await sendVerification(u); const expired = await tokenFor(u.email);
    await db.update(schema.emailVerificationTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.emailVerificationTokens.userId, u.id));
    expect((await verify(request({ token: expired, password: 'InboxChosen456!' }))).status).toBe(400);
    await sendVerification(u); const fresh = await tokenFor(u.email);
    expect((await verify(request({ token: fresh, password: '😀'.repeat(19) }))).status).toBe(400);
    expect((await verify(request({ token: fresh, password: 'short' }))).status).toBe(400);
    await db.update(schema.emailVerificationTokens).set({ email: 'wrong@test.local' }).where(eq(schema.emailVerificationTokens.tokenHash, sha256(fresh)));
    await expect(confirmEmail(fresh, 'InboxChosen456!')).rejects.toMatchObject({ code: 'verification_invalid' });
    await db.update(schema.emailVerificationTokens).set({ email: u.email }).where(eq(schema.emailVerificationTokens.tokenHash, sha256(fresh)));
    const results = await Promise.allSettled([confirmEmail(fresh, 'InboxChosen456!'), confirmEmail(fresh, 'OtherChosen789!')]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
  });
  it('keeps signup and resend responses generic and throttles an address across rotating IPs', async () => {
    const verified = await F.user({ email: address() }); const unknown = address();
    const expected = { ok: true, verificationRequired: true };
    for (const email of [verified.email, unknown]) expect(await (await resend(request({ email }))).json()).toEqual(expected);
    expect(await db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, verified.id))).toHaveLength(0);
    expect(await user(unknown)).toBeUndefined();
    const pending = address();
    for (let i = 0; i < 3; i++) expect((await signup(request({ name: 'A', email: pending }))).status).toBe(200);
    expect((await resend(request({ email: pending }))).status).toBe(429);
  });
  it('rejects attacker pre-registration Google email collision, while true Google subject return still works', async () => {
    const email = address(); await signup(request({ name: 'Attacker', email, password: 'AttackerChosen123!' }));
    const u = await user(email);
    const state = await createGoogleState('/dashboard');
    const response = await google(new Request(`http://localhost/api/auth/google/callback?state=${state}&code=${encodeURIComponent('dev:' + email)}`));
    expect(response.headers.get('location')).toContain('/signin?error=google_link');
    expect(H.jar.has(SESSION_COOKIE)).toBe(false); expect((await user(email)).googleSub).toBeNull();
    expect((await user(email)).id).toBe(u.id);
    const other = address(); const first = await createGoogleState('/dashboard');
    await google(new Request(`http://localhost/api/auth/google/callback?state=${first}&code=${encodeURIComponent('dev:' + other)}`));
    const provider = (await currentUser())!; expect(provider).toBeTruthy(); H.jar.clear();
    const again = await createGoogleState('/dashboard');
    await google(new Request(`http://localhost/api/auth/google/callback?state=${again}&code=${encodeURIComponent('dev:' + other)}`));
    expect((await currentUser())!.id).toBe(provider.id);
  });
  it('requires configuration consistently and never writes token-bearing mail to production outbox/logs', async () => {
    Object.assign(env, { signupTurnstileRequired: true, devStubs: false, isProd: true, turnstileSiteKey: 'real-key', turnstileSecretKey: 'real-secret', resendKey: '' });
    const email = address();
    expect((await signup(request({ name: 'A', email, turnstileToken: 'token' }))).status).toBe(503);
    expect((await resend(request({ email: address(), turnstileToken: 'token' }))).status).toBe(503);
    expect(await user(email)).toBeUndefined();
    env.resendKey = 'provider-key';
    const fetcher = vi.fn(async (url: string) => url.includes('siteverify') ? Response.json({ success: true, action: 'turnstile-spin-v2', hostname: new URL(env.appUrl).hostname }) : new Response('provider may reflect secret content', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await signup(request({ name: 'A', email, turnstileToken: 'token' }))).status).toBe(503);
    const u = await user(email); expect(u.emailVerifiedAt).toBeNull(); expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await db.select().from(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, u.id))).toHaveLength(0);
    const [mail] = await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email));
    expect(mail.text).toBe('[Security email content redacted]'); expect(mail.error).toBe('Security email delivery unavailable'); expect(mail.html).toBeNull();
    Object.assign(env, saved); expect((await resend(request({ email }))).status).toBe(200);
  });
  it('invalid human challenges spend IP attempts but cannot exhaust a victim mailbox or global mail budget', async () => {
    Object.assign(env, { signupTurnstileRequired: true, devStubs: false, isProd: true, turnstileSiteKey: 'real-key', turnstileSecretKey: 'real-secret', resendKey: 'provider-key' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
    const calls = vi.spyOn(rateLimits, 'enforce');
    const email = address(); const ip = prefix + '-bad-challenge';
    expect((await signup(request({ name: 'A', email }, ip))).status).toBe(403);
    expect((await signup(request({ name: 'A', email, turnstileToken: 'invalid' }, ip))).status).toBe(403);
    expect(calls.mock.calls.flatMap(([limits]) => limits.map(l => l.key))).toEqual([`auth:signup:ip:${ip}`, `auth:verification:shared-ip:${ip}`, `auth:signup:ip:${ip}`, `auth:verification:shared-ip:${ip}`]);
    expect(await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, `auth:verification:email:${sha256(email)}@3600`))).toHaveLength(0);
    const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, `auth:signup:ip:${ip}@3600`));
    expect(row.count).toBe(2); expect(await user(email)).toBeUndefined();
  });
  it('production rate-only mode needs a sender but no Turnstile keys or token and never authenticates signup', async () => {
    Object.assign(env, { signupTurnstileRequired: false, devStubs: false, isProd: true, turnstileSiteKey: '', turnstileSecretKey: '', resendKey: 'provider-key' });
    const fetcher = vi.fn(async (_url: string | URL | Request) => Response.json({ id: 'safe-mail-id' })); vi.stubGlobal('fetch', fetcher);
    const email = address();
    const response = await signup(request({ name: 'Inbox owner', email }));
    expect(await response.json()).toEqual({ ok: true, verificationRequired: true });
    expect((await user(email)).emailVerifiedAt).toBeNull(); expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0][0])).toContain('api.resend.com/emails');
    const [mail] = await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email));
    expect(mail.text).toBe('[Security email content redacted]'); expect(mail.status).toBe('sent');
  });
  it('shares a ten-attempt IP budget across signup and resend even when each route has attempts remaining', async () => {
    env.signupTurnstileRequired = false;
    const ip = prefix + '-shared-ip';
    for (let i = 0; i < 10; i++) {
      const email = address();
      const response = i % 2 ? await resend(request({ email }, ip)) : await signup(request({ name: 'A', email }, ip));
      expect(response.status).toBe(200);
    }
    const denied = address();
    expect((await signup(request({ name: 'A', email: denied }, ip))).status).toBe(429);
    expect(await user(denied)).toBeUndefined();
    const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, `auth:verification:shared-ip:${ip}@3600`));
    expect(row.count).toBe(11);
  });
  it('enforces the global mail budget in rate-only mode before creating another account', async () => {
    env.signupTurnstileRequired = false;
    // Route the global counter to a test-specific key so concurrent auth suites are not throttled.
    const isolated = `auth:verification:${prefix}-global`;
    const original = rateLimits.enforce;
    vi.spyOn(rateLimits, 'enforce').mockImplementation(limits => original(limits.map(l => l.key === 'auth:verification:global' ? { ...l, key: isolated } : l)));
    await db.execute(sql`INSERT INTO rate_limits (key, window_start, count) VALUES (${isolated + '@3600'}, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 300)`);
    const email = address(); const response = await signup(request({ name: 'A', email }));
    expect(response.status).toBe(503); expect((await response.json()).code).toBe('busy'); expect(await user(email)).toBeUndefined();
    const [row] = await db.select().from(schema.rateLimits).where(eq(schema.rateLimits.key, isolated + '@3600')); expect(row.count).toBe(301);
  });
  it('rollout migration trusts Google proof only, clears mixed passwords, revokes real sessions and preserves guests', async () => {
    // Temporary tables shadow these two names on this transaction connection only; no other test's rows are changed.
    await db.transaction(async tx => {
      await tx.execute(sql`CREATE TEMP TABLE users (id text PRIMARY KEY, guest boolean, google_sub text, password_hash text, email_verified_at timestamptz) ON COMMIT DROP`);
      await tx.execute(sql`CREATE TEMP TABLE sessions (id text PRIMARY KEY, user_id text) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO users VALUES ('password',false,NULL,'legacy',NULL),('google',false,'sub1',NULL,NULL),('mixed',false,'sub2','unsafe',NULL),('guest',true,NULL,NULL,NULL)`);
      await tx.execute(sql`INSERT INTO sessions VALUES ('s1','password'),('s2','google'),('s3','mixed'),('s4','guest')`);
      const migration = readFileSync('drizzle/0009_signup_security.sql', 'utf8');
      const policy = migration.slice(migration.indexOf('UPDATE users'));
      for (const statement of policy.split('--> statement-breakpoint')) await tx.execute(sql.raw(statement));
      const rows = (await tx.execute(sql`SELECT * FROM users ORDER BY id`)).rows as any[];
      expect(rows).toHaveLength(4);
      expect(rows.find(r => r.id === 'password')).toMatchObject({ password_hash: 'legacy', email_verified_at: null });
      for (const id of ['google','mixed']) { expect(rows.find(r => r.id === id).email_verified_at).not.toBeNull(); expect(rows.find(r => r.id === id).password_hash).toBeNull(); }
      expect((await tx.execute(sql`SELECT * FROM sessions`)).rows).toEqual([{ id: 's4', user_id: 'guest' }]);
    });
  });
});
